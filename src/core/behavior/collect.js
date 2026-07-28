/**
 * Behavior Collect — AST 에서 컴포넌트의 상태/Effect/이벤트 핸들러를 수집합니다.
 *
 * 여기서는 "무엇이 있는가"만 모읍니다.
 * 이것들을 이어 붙여 동작 연쇄를 만드는 일은 chain.js 가 맡습니다.
 */

/** Effect 계열 Hook */
const EFFECT_HOOKS = ['useEffect', 'useLayoutEffect', 'useInsertionEffect']

/**
 * 호출 목록에서 걸러낼 내장 메서드.
 * 흐름을 설명하지 않고 목록만 어지럽히는 것들입니다.
 */
const NOISE_METHODS = [
  // 프로미스
  'then', 'catch', 'finally',
  // 배열
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'includes', 'indexOf', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice',
  'concat', 'join', 'sort', 'reverse', 'flat', 'flatMap',
  // Set / Map
  'has', 'get', 'set', 'add', 'delete', 'clear', 'keys', 'values', 'entries',
  // 문자열
  'split', 'trim', 'replace', 'toLowerCase', 'toUpperCase', 'startsWith', 'endsWith',
  'padStart', 'padEnd', 'toString',
  // 콘솔 / 기타
  'log', 'warn', 'error', 'info', 'preventDefault', 'stopPropagation',
]

/**
 * AST 노드를 재귀로 훑습니다.
 * @param {object} node
 * @param {(n: object) => void} visit
 */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit)
    return
  }
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    walk(node[key], visit)
  }
}

const lineOf = (n) => (n && n.loc ? n.loc.start.line : null)

/** 호출식의 대상 이름 (foo() → 'foo', a.b() → 'b') */
function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null
  const c = node.callee
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier') {
    return c.property.name
  }
  return null
}

const isFunctionNode = (n) =>
  n && (n.type === 'ArrowFunctionExpression' ||
        n.type === 'FunctionExpression' ||
        n.type === 'FunctionDeclaration')

/**
 * 최상위에서 React 컴포넌트로 보이는 함수를 찾습니다.
 * 판별 기준은 기존 파서와 동일하게 "대문자로 시작하는 이름"입니다.
 * @returns {{name: string, node: object, startLine: number}[]}
 */
export function findComponents(ast) {
  const found = []

  const add = (name, fnNode, declNode) => {
    if (!name || !/^[A-Z]/.test(name) || !fnNode) return
    found.push({ name, node: fnNode, startLine: lineOf(declNode || fnNode) })
  }

  for (const stmt of ast.program.body) {
    const target =
      stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration'
        ? stmt.declaration
        : stmt
    if (!target) continue

    if (target.type === 'FunctionDeclaration' && target.id) {
      add(target.id.name, target, target)
    } else if (target.type === 'VariableDeclaration') {
      for (const d of target.declarations) {
        if (d.id && d.id.type === 'Identifier' && isFunctionNode(d.init)) {
          add(d.id.name, d.init, d)
        }
      }
    }
  }

  return found
}

/**
 * 컴포넌트 하나의 내부를 수집합니다.
 * @param {{name: string, node: object}} comp
 */
export function collectComponent(comp) {
  return {
    states: collectStates(comp.node),
    effects: collectEffects(comp.node),
    localFns: collectLocalFunctions(comp.node),
    handlers: collectHandlers(comp.node),
  }
}

/** `const [open, setOpen] = useState(...)` 에서 상태 ↔ setter 결합을 뽑습니다 */
function collectStates(root) {
  const states = []
  walk(root, (n) => {
    if (n.type !== 'VariableDeclarator') return
    if (calleeName(n.init) !== 'useState') return
    if (!n.id || n.id.type !== 'ArrayPattern') return

    const [stateEl, setterEl] = n.id.elements
    if (!stateEl || stateEl.type !== 'Identifier') return

    states.push({
      state: stateEl.name,
      setter: setterEl && setterEl.type === 'Identifier' ? setterEl.name : null,
      line: lineOf(n),
    })
  })
  return states
}

/** useEffect 의 의존성 배열과 본문을 수집합니다 */
function collectEffects(root) {
  const effects = []
  walk(root, (n) => {
    const name = calleeName(n)
    if (!EFFECT_HOOKS.includes(name)) return

    const [fnArg, depsArg] = n.arguments
    let deps = null
    if (depsArg && depsArg.type === 'ArrayExpression') {
      deps = depsArg.elements.map(e => (e && e.type === 'Identifier' ? e.name : '<식>'))
    }

    let trigger
    if (deps === null) trigger = 'every-render'
    else if (deps.length === 0) trigger = 'mount'
    else trigger = 'deps'

    effects.push({ hook: name, deps, trigger, line: lineOf(n), body: fnArg })
  })
  return effects
}

/** 컴포넌트 안에 선언된 이름붙은 함수 — 핸들러의 간접 호출을 따라가는 데 씁니다 */
function collectLocalFunctions(root) {
  const fns = {}
  walk(root, (n) => {
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && isFunctionNode(n.init)) {
      fns[n.id.name] = n.init
    }
    if (n.type === 'FunctionDeclaration' && n.id) {
      fns[n.id.name] = n
    }
  })
  return fns
}

/** JSX 의 onXxx 속성을 수집합니다 */
function collectHandlers(root) {
  const handlers = []

  walk(root, (n) => {
    if (n.type !== 'JSXOpeningElement') return
    const element = n.name && n.name.name ? n.name.name : '?'

    for (const attr of n.attributes || []) {
      if (!attr || attr.type !== 'JSXAttribute') continue
      if (!attr.name || attr.name.type !== 'JSXIdentifier') continue
      if (!/^on[A-Z]/.test(attr.name.name)) continue
      if (!attr.value || attr.value.type !== 'JSXExpressionContainer') continue

      handlers.push({
        element,
        event: attr.name.name,
        line: lineOf(attr),
        expr: attr.value.expression,
      })
    }
  })

  return handlers
}

/**
 * 어떤 노드 안에서 사용된 setter 를 찾습니다.
 *
 * setter 는 두 가지 형태로 쓰입니다:
 *   setData(x)       — 직접 호출
 *   .then(setData)   — 참조로 넘겨져 나중에 호출됨
 */
export function findSetterUsage(node, setterNames) {
  const used = new Set()
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return

    const name = calleeName(n)
    if (setterNames.includes(name)) used.add(name)

    for (const arg of n.arguments) {
      if (arg && arg.type === 'Identifier' && setterNames.includes(arg.name)) {
        used.add(arg.name)
      }
    }
  })
  return [...used]
}

/**
 * 어떤 노드 안에서 호출된 함수 이름들을 찾습니다.
 *
 * 제외 대상:
 * - setter, Hook, 프로미스 체인 메서드 — 흐름 설명에 도움이 안 됨
 * - 이 범위 안에서 선언된 함수 — 그 본문도 어차피 같이 훑으므로,
 *   이름을 따로 보여주면 `load()` 와 그 안의 `fetchUser()` 가 중복 노출됨
 */
export function findCalls(node, exclude = []) {
  const declaredHere = new Set()
  walk(node, (n) => {
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && isFunctionNode(n.init)) {
      declaredHere.add(n.id.name)
    }
    if (n.type === 'FunctionDeclaration' && n.id) {
      declaredHere.add(n.id.name)
    }
  })

  const calls = new Set()
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return
    const name = calleeName(n)
    if (!name) return
    if (exclude.includes(name)) return
    if (declaredHere.has(name)) return
    if (NOISE_METHODS.includes(name)) return
    if (/^use[A-Z]/.test(name)) return
    calls.add(name)
  })
  return [...calls]
}

/**
 * `foo()` 형태의 직접 호출만 찾습니다. `obj.foo()` 는 제외합니다.
 *
 * 로컬 함수를 따라 들어갈 때 반드시 이걸 써야 합니다.
 * calleeName 은 `new Set().add(id)` 에서도 'add' 를 돌려주기 때문에,
 * 같은 이름의 로컬 함수 `add()` 가 있으면 엉뚱한 흐름을 만들어냅니다.
 */
export function findDirectCalls(node, exclude = []) {
  const calls = new Set()
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return
    if (!n.callee || n.callee.type !== 'Identifier') return
    const name = n.callee.name
    if (exclude.includes(name)) return
    if (/^use[A-Z]/.test(name)) return
    calls.add(name)
  })
  return [...calls]
}

/** 비동기 흔적을 찾습니다 */
export function findAsyncMarks(node) {
  const marks = new Set()
  walk(node, (n) => {
    if (n.type === 'AwaitExpression') marks.add('await')
    if (n.type === 'CallExpression') {
      const name = calleeName(n)
      if (name === 'then') marks.add('.then')
      if (name === 'fetch') marks.add('fetch')
    }
    if (isFunctionNode(n) && n.async) marks.add('async')
  })
  return [...marks]
}

export { lineOf, calleeName, isFunctionNode }
