/**
 * Custom Hook 해석
 *
 * 로직을 커스텀 훅으로 빼는 것은 React 권장 패턴입니다. 그래서 잘 짜인 코드일수록
 * 상태와 Effect 가 컴포넌트가 아니라 훅 안에 있습니다. 훅을 못 보면 정작 잘 만든
 * 코드에서 아무것도 못 찾게 됩니다.
 *
 * 여기서는 붙여넣은 코드 **안에** 있는 훅을 따라가고,
 * 다른 파일에서 import 한 훅은 "범위 밖"으로 표시할 수 있게 이름을 남깁니다.
 */

import { walk, collectComponent, lineOf, calleeName, isFunctionNode } from './collect.js'

/** React 내장 훅 — 커스텀 훅 탐색에서 제외합니다 */
const BUILTIN_HOOKS = [
  'useState', 'useReducer', 'useEffect', 'useLayoutEffect', 'useInsertionEffect',
  'useRef', 'useMemo', 'useCallback', 'useContext', 'useImperativeHandle',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
  'useDispatch', 'useSelector', 'useStore',
]

const isCustomHookName = (name) => /^use[A-Z]/.test(name) && !BUILTIN_HOOKS.includes(name)

/**
 * 붙여넣은 코드 안에 선언된 커스텀 훅을 찾습니다.
 * @returns {Map<string, {name, node, startLine}>}
 */
export function findCustomHooks(ast) {
  const hooks = new Map()

  const add = (name, fnNode, declNode) => {
    if (!isCustomHookName(name) || !fnNode) return
    hooks.set(name, { name, node: fnNode, startLine: lineOf(declNode || fnNode) })
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

  return hooks
}

/**
 * 함수가 마지막으로 돌려주는 식을 꺼냅니다.
 * 중첩 함수의 return 에 휘둘리지 않도록 본문 최상위만 봅니다.
 */
function getReturnExpr(fnNode) {
  if (!fnNode || !fnNode.body) return null
  if (fnNode.body.type !== 'BlockStatement') return fnNode.body // 화살표 축약형

  const body = fnNode.body.body
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i].type === 'ReturnStatement') return body[i].argument
  }
  return null
}

/**
 * 훅이 내보내는 이름 ↔ 훅 내부 이름의 대응표를 만듭니다.
 *
 *   return { query, setQuery, user }   → { query: 'query', setQuery: 'setQuery', ... }
 *   return [query, setQuery]           → ['query', 'setQuery']
 */
function buildReturnMap(fnNode) {
  const ret = getReturnExpr(fnNode)
  if (!ret) return null

  if (ret.type === 'ObjectExpression') {
    const props = {}
    for (const p of ret.properties) {
      if (p.type !== 'ObjectProperty' && p.type !== 'Property') continue
      const key = p.key && (p.key.name || p.key.value)
      const val = p.value && p.value.type === 'Identifier' ? p.value.name : null
      if (key && val) props[key] = val
    }
    return { kind: 'object', props }
  }

  if (ret.type === 'ArrayExpression') {
    return {
      kind: 'array',
      items: ret.elements.map(e => (e && e.type === 'Identifier' ? e.name : null)),
    }
  }

  return null
}

/**
 * 커스텀 훅 하나를 분석합니다. 구조는 컴포넌트 분석과 같습니다.
 */
export function analyzeHook(hook, skipNodes) {
  const collected = collectComponent(hook, skipNodes)
  return {
    name: hook.name,
    startLine: hook.startLine,
    states: collected.states,
    effects: collected.effects,
    returnMap: buildReturnMap(hook.node),
  }
}

/**
 * 컴포넌트가 받는 prop 이름들을 모읍니다.
 * prop 으로 받은 콜백은 이 파일 밖에서 온 것이므로 흐름의 경계가 됩니다.
 */
export function getPropNames(fnNode) {
  const names = new Set()
  const first = fnNode.params && fnNode.params[0]
  if (!first) return names

  if (first.type === 'ObjectPattern') {
    for (const p of first.properties) {
      if (p.type === 'RestElement') continue
      const key = p.key && (p.key.name || p.key.value)
      if (key) names.add(key)
    }
  }
  return names
}

/**
 * 구조분해 패턴에서 "내보낸 이름 → 이 코드에서 쓰는 이름" 쌍을 뽑습니다.
 * @returns {{exported: string|number, local: string}[]}
 */
function readPattern(idNode) {
  const pairs = []

  if (idNode.type === 'ObjectPattern') {
    for (const p of idNode.properties) {
      if (p.type === 'RestElement') continue
      const exported = p.key && (p.key.name || p.key.value)
      const local = p.value && p.value.type === 'Identifier' ? p.value.name : null
      if (exported && local) pairs.push({ exported, local })
    }
  } else if (idNode.type === 'ArrayPattern') {
    idNode.elements.forEach((el, i) => {
      if (el && el.type === 'Identifier') pairs.push({ exported: i, local: el.name })
    })
  }

  return pairs
}

/**
 * 컴포넌트 안의 커스텀 훅 호출을 해석합니다.
 *
 * 붙여넣은 코드 안에 훅이 있으면 그 상태·Effect 를 컴포넌트 것으로 끌어옵니다.
 * 없으면(= 다른 파일에서 import) 그 훅에서 받아온 이름들을 기록해 두었다가,
 * 나중에 "범위 밖" 으로 표시하는 데 씁니다.
 *
 * @returns {{states, effects, outOfScope: Map<string, string>}}
 *   outOfScope: 이 코드에서 쓰는 이름 → 어느 훅에서 왔는지
 */
export function resolveHookCalls(componentNode, analyzedHooks, skipNodes) {
  const states = []
  const effects = []
  const outOfScope = new Map()
  const mergedHooks = new Set()

  walk(componentNode, (n) => {
    if (n.type !== 'VariableDeclarator' || !n.init) return
    const hookName = calleeName(n.init)
    if (!hookName || !isCustomHookName(hookName)) return
    if (n.init.type !== 'CallExpression') return

    const analyzed = analyzedHooks.get(hookName)

    // 다른 파일에서 온 훅 — 여기서 흐름이 끊깁니다
    if (!analyzed) {
      for (const { local } of readPattern(n.id)) outOfScope.set(local, hookName)
      if (n.id.type === 'Identifier') outOfScope.set(n.id.name, hookName)
      return
    }

    const setterOf = {}
    for (const s of analyzed.states) if (s.setter) setterOf[s.setter] = s

    // 훅이 내보낸 이름을 이 컴포넌트에서 쓰는 이름에 연결합니다
    for (const { exported, local } of readPattern(n.id)) {
      let internal = exported
      if (analyzed.returnMap) {
        if (analyzed.returnMap.kind === 'object') internal = analyzed.returnMap.props[exported] || exported
        else if (analyzed.returnMap.kind === 'array') internal = analyzed.returnMap.items[exported]
      }
      if (!internal) continue

      const src = setterOf[internal]
      if (!src) continue

      states.push({
        state: src.state,
        setter: local,          // 컴포넌트에서 실제로 부르는 이름
        kind: src.kind,
        line: src.line,         // 선언 위치는 훅 안
        viaHook: hookName,
        hookLine: analyzed.startLine,
        // 이름을 바꿔 받았으면(`const [on, toggle] = useToggle()`) 훅 안에서 부르는
        // 이름이 다릅니다. 훅 코드를 읽을 때 어느 이름을 찾아야 하는지 알려 줍니다.
        hookInternal: internal !== local ? internal : null,
      })
    }

    if (!mergedHooks.has(hookName)) {
      mergedHooks.add(hookName)

      // 훅의 Effect 는 훅 내부 상태 이름을 deps 로 쓰므로 그대로 가져옵니다
      effects.push(...analyzed.effects.map(
        e => ({ ...e, viaHook: hookName, hookLine: analyzed.startLine })
      ))

      // 훅 안에서만 쓰는 상태도 함께 가져옵니다.
      // 컴포넌트에서 직접 부를 수는 없지만, 훅의 Effect 안에서 일어나는
      // 상태 변경(setUser 등)을 연쇄에 보여주려면 필요합니다.
      for (const s of analyzed.states) {
        if (!s.setter) continue
        if (states.some(x => x.setter === s.setter)) continue
        states.push({
          ...s,
          viaHook: hookName,
          hookLine: analyzed.startLine,
          internalOnly: true,
        })
      }
    }
  }, skipNodes ? (node) => node !== componentNode && skipNodes.has(node) : undefined)

  return { states, effects, outOfScope }
}
