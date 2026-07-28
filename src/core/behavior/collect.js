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
 *
 * @param {object} node
 * @param {(n: object) => void} visit
 * @param {((n: object) => boolean)} [skip] - true 를 돌려주면 그 가지 전체를 건너뜁니다.
 *   중첩 컴포넌트의 상태·Effect 가 바깥 컴포넌트 것으로 섞이지 않게 하는 데 씁니다.
 */
export function walk(node, visit, skip) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit, skip)
    return
  }
  if (typeof node.type === 'string') {
    if (skip && skip(node)) return
    visit(node)
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    walk(node[key], visit, skip)
  }
}

/** 이 노드 안에 JSX 가 있는가 — 중첩 컴포넌트 판별에 씁니다 */
function containsJSX(node) {
  let found = false
  walk(node, (n) => {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') found = true
  })
  return found
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
 * React 컴포넌트로 보이는 함수를 찾습니다.
 *
 * 최상위 선언은 "대문자로 시작하는 이름"만으로 판별합니다 (기존 파서와 동일).
 * 다른 함수 안에 중첩된 것은 대문자 + JSX 포함까지 확인합니다 — 이름만 보고
 * 넘기면 대문자로 시작하는 평범한 헬퍼까지 컴포넌트로 잡히기 때문입니다.
 *
 * @returns {{name, node, startLine, parent: string|null}[]}
 */
export function findComponents(ast) {
  const top = []

  const add = (name, fnNode, declNode) => {
    if (!name || !/^[A-Z]/.test(name) || !fnNode) return
    top.push({ name, node: fnNode, startLine: lineOf(declNode || fnNode), parent: null })
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

  // 최상위 컴포넌트 안쪽에 숨어 있는 컴포넌트들
  const nested = []
  for (const comp of top) {
    walk(comp.node, (n) => {
      if (n === comp.node) return

      let name = null
      let fnNode = null
      let declNode = null

      if (n.type === 'FunctionDeclaration' && n.id) {
        name = n.id.name
        fnNode = n
        declNode = n
      } else if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && isFunctionNode(n.init)) {
        name = n.id.name
        fnNode = n.init
        declNode = n
      }

      if (!name || !/^[A-Z]/.test(name)) return
      if (!containsJSX(fnNode)) return

      nested.push({ name, node: fnNode, startLine: lineOf(declNode), parent: comp.name })
    })
  }

  return [...top, ...nested]
}

/**
 * 컴포넌트 하나의 내부를 수집합니다.
 *
 * @param {{name: string, node: object}} comp
 * @param {Set<object>} [componentNodes] - 전체 컴포넌트 노드 집합.
 *   자기 자신을 뺀 나머지는 건너뛰어, 중첩 컴포넌트의 상태가
 *   바깥 컴포넌트 것으로 섞이지 않게 합니다.
 */
export function collectComponent(comp, componentNodes) {
  const skip = componentNodes
    ? (n) => n !== comp.node && componentNodes.has(n)
    : undefined

  return {
    states: collectStates(comp.node, skip),
    effects: collectEffects(comp.node, skip),
    localFns: collectLocalFunctions(comp.node, skip),
    handlers: collectHandlers(comp.node, skip),
  }
}

/** `const [open, setOpen] = useState(...)` 에서 상태 ↔ setter 결합을 뽑습니다 */
function collectStates(root, skip) {
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
  }, skip)
  return states
}

/** useEffect 의 의존성 배열과 본문을 수집합니다 */
function collectEffects(root, skip) {
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
  }, skip)
  return effects
}

/**
 * 컴포넌트 안에 선언된 이름붙은 함수 — 핸들러의 간접 호출을 따라가는 데 씁니다.
 * 선언된 줄도 함께 담아 스텝에서 그 위치로 이동할 수 있게 합니다.
 */
function collectLocalFunctions(root, skip) {
  const fns = {}
  walk(root, (n) => {
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && isFunctionNode(n.init)) {
      fns[n.id.name] = { node: n.init, line: lineOf(n) }
    }
    if (n.type === 'FunctionDeclaration' && n.id) {
      fns[n.id.name] = { node: n, line: lineOf(n) }
    }
  }, skip)
  return fns
}

/** JSX 의 onXxx 속성을 수집합니다 */
function collectHandlers(root, skip) {
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
  }, skip)

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

  const calls = new Map() // name -> line (첫 호출 위치)
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return
    const name = calleeName(n)
    if (!name) return
    if (exclude.includes(name)) return
    if (declaredHere.has(name)) return
    if (NOISE_METHODS.includes(name)) return
    if (/^use[A-Z]/.test(name)) return
    if (!calls.has(name)) calls.set(name, lineOf(n))
  })
  return [...calls].map(([name, line]) => ({ name, line }))
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
