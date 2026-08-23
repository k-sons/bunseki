/**
 * Stale Closure 감지 — effect 가 읽는 값이 deps 에서 빠졌는지 봅니다.
 *
 *   useEffect(() => {
 *     fetchUser(id).then(setUser)   // ← id 를 읽는데
 *   }, [])                          //   deps 는 비어 있다
 *
 * effect 는 만들어질 때의 값을 붙잡아 둡니다(closure). deps 에서 빠진 값은
 * 바깥에서 아무리 바뀌어도 이 안에서는 **처음 값 그대로** 입니다.
 * 비동기 콜백이면 응답이 온 한참 뒤에 옛 값을 쓰게 되니 더 헷갈립니다.
 *
 * 오탐이 나면 힌트를 믿지 않게 되므로, 다음은 세지 않습니다:
 *   - 컴포넌트(훅) 밖에서 온 이름 — import·전역·모듈 상수는 애초에 안 바뀜
 *   - 바뀌지 않는 것 — useState 의 setter, dispatch, useRef 의 ref
 *   - 값이 고정된 지역 상수 — const LIMIT = 20
 *   - effect 안에서 선언한 이름 — 그건 실행할 때마다 새로 만들어짐
 */

import { walk, calleeName, isFunctionNode } from './collect.js'

/** 결과가 렌더마다 그대로인 훅 — deps 에 넣을 필요가 없습니다 */
const STABLE_HOOKS = ['useRef', 'useDispatch']

/** 이 값으로 초기화된 const 는 절대 안 바뀝니다 */
const LITERALS = [
  'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'RegExpLiteral',
]

/**
 * effect 가 읽는 이름 중 deps 에 없는 것을 골라냅니다.
 *
 * @param {object}   p.owner    - effect 를 감싼 함수(컴포넌트 또는 커스텀 훅) 노드
 * @param {string[]|null} p.deps - deps 배열. null 이면 매 렌더 새로 만들어져 문제가 없습니다
 * @param {string[]} p.depRoots - `props.id` 처럼 식으로 쓴 deps 의 뿌리 이름
 * @param {object}   p.body     - effect 본문 노드
 * @param {Array}    p.refs     - timing 이 훑으며 모은 참조 { name, line, deferred }
 * @returns {{name, kind, line, inAsync}[]}
 */
export function findStaleDeps({ owner, deps, depRoots, body, refs }) {
  if (!owner || deps === null || !refs) return []

  const scope = collectScope(owner)
  const declared = collectDeclaredNames(body)
  const known = new Set([...deps, ...(depRoots || [])])

  const missing = new Map()

  for (const ref of refs) {
    if (known.has(ref.name)) continue
    if (declared.has(ref.name)) continue

    const found = scope.get(ref.name)
    if (!found || found.stable) continue

    const prev = missing.get(ref.name)
    if (!prev) {
      missing.set(ref.name, {
        name: ref.name,
        kind: found.kind,       // 'prop' | 'state' | 'local'
        line: ref.line,
        inAsync: !!ref.deferred,
      })
    } else if (ref.deferred) {
      prev.inAsync = true       // 한 번이라도 비동기 뒤에서 읽으면 그쪽이 더 위험
    }
  }

  return [...missing.values()]
}

/**
 * 컴포넌트(또는 커스텀 훅) 본문에 선언된 이름을 훑어
 * "렌더마다 바뀔 수 있는 값"인지 표시합니다.
 *
 * 본문 **최상위**만 봅니다. React 의 반응값은 컴포넌트 본문에서 만들어지고,
 * 더 깊이 들어가면 다른 함수 안의 지역 변수까지 섞여 오탐이 늘어납니다.
 */
function collectScope(owner) {
  const scope = new Map()

  // 파라미터 = props (커스텀 훅이면 인자)
  for (const p of owner.params || []) addPattern(p, 'prop', scope)

  const body = owner.body
  if (!body || body.type !== 'BlockStatement') return scope

  for (const stmt of body.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      scope.set(stmt.id.name, { kind: 'local' })
    } else if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) readDeclarator(d, stmt.kind, scope)
    }
  }

  return scope
}

function readDeclarator(d, declKind, scope) {
  if (!d.id) return
  const initHook = calleeName(d.init)

  // const [value, setValue] = useState() → value 는 반응값, setValue 는 고정
  if (d.id.type === 'ArrayPattern' && (initHook === 'useState' || initHook === 'useReducer')) {
    const [value, setter] = d.id.elements
    if (value && value.type === 'Identifier') scope.set(value.name, { kind: 'state' })
    if (setter && setter.type === 'Identifier') scope.set(setter.name, { kind: 'setter', stable: true })
    return
  }

  if (d.id.type === 'Identifier') {
    if (STABLE_HOOKS.includes(initHook)) {
      scope.set(d.id.name, { kind: 'stable', stable: true })
      return
    }
    if (declKind === 'const' && isFixedValue(d.init)) {
      scope.set(d.id.name, { kind: 'const', stable: true })
      return
    }
    scope.set(d.id.name, { kind: 'local' })
    return
  }

  addPattern(d.id, 'local', scope)
}

/** const 로 묶인 리터럴 — 렌더가 몇 번 돌아도 같은 값입니다 */
function isFixedValue(init) {
  if (!init) return false
  if (LITERALS.includes(init.type)) return true
  if (init.type === 'TemplateLiteral' && init.expressions.length === 0) return true
  if (init.type === 'UnaryExpression' && LITERALS.includes(init.argument.type)) return true  // -1
  return false
}

/** 구조분해를 포함한 선언 패턴에서 이름을 꺼내 scope 에 담습니다 */
function addPattern(node, kind, scope) {
  if (!node) return

  switch (node.type) {
    case 'Identifier':
      scope.set(node.name, { kind })
      return
    case 'ObjectPattern':
      for (const p of node.properties) {
        if (p.type === 'RestElement') addPattern(p.argument, kind, scope)
        else addPattern(p.value, kind, scope)
      }
      return
    case 'ArrayPattern':
      for (const el of node.elements) addPattern(el, kind, scope)
      return
    case 'AssignmentPattern':
      addPattern(node.left, kind, scope)
      return
    case 'RestElement':
      addPattern(node.argument, kind, scope)
      return
  }
}

/**
 * effect 안에서 선언된 이름들 — 바깥 값을 가린(shadow) 것일 수도 있으므로
 * 여기 있는 이름은 deps 대조에서 빼둡니다. (놓치는 쪽이 헛경보보다 낫습니다.)
 */
function collectDeclaredNames(body) {
  const names = new Set()
  const box = new Map()

  walk(body, (n) => {
    if (n.type === 'VariableDeclarator') addPattern(n.id, 'x', box)
    if (n.type === 'FunctionDeclaration' && n.id) box.set(n.id.name, 1)
    if (n.type === 'ClassDeclaration' && n.id) box.set(n.id.name, 1)
    if (n.type === 'CatchClause' && n.param) addPattern(n.param, 'x', box)
    if (isFunctionNode(n)) {
      for (const p of n.params || []) addPattern(p, 'x', box)
    }
  })

  for (const key of box.keys()) names.add(key)
  return names
}
