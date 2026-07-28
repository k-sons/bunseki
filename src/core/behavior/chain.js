/**
 * Behavior Chain — 수집한 정보를 이어 붙여 "동작 연쇄"를 만듭니다.
 *
 * 만들어지는 것:
 *   이벤트 → setter 호출 → 상태 변경 → deps 가 일치하는 Effect 재실행
 *          → Effect 안의 호출/비동기 → 또 다른 setter → 상태 변경 → 리렌더
 *
 * UI 가 단순해지도록 여기서 **평탄화된 Step 배열**까지 만들어 넘깁니다.
 * 렌더러는 배열을 순서대로 그리기만 하면 됩니다.
 */

import { findSetterUsage, findCalls, findDirectCalls, findAsyncMarks, lineOf } from './collect.js'

/** 핸들러에서 로컬 함수를 따라 들어가는 최대 깊이 */
const MAX_FN_DEPTH = 3
/** Effect → 상태 변경 → 다른 Effect 로 이어지는 연쇄를 따라가는 최대 깊이 */
const MAX_EFFECT_DEPTH = 3

/**
 * 컴포넌트 하나의 이벤트별 동작 연쇄를 만듭니다.
 * @returns {object[]} EventEntry[]
 */
export function buildEvents(compName, collected) {
  const { states, effects, localFns, handlers } = collected

  const setterNames = states.map(s => s.setter).filter(Boolean)
  const setterToState = {}
  const setterKind = {}
  for (const s of states) {
    if (!s.setter) continue
    setterToState[s.setter] = s.state
    setterKind[s.setter] = s.kind || 'state'
  }

  return handlers.map(handler => {
    const { setters, viaFns } = resolveHandlerSetters(handler, localFns, setterNames)

    const flows = setters.map(setter =>
      buildFlow({ handler, setter, viaFns, setterToState, setterKind, effects, setterNames })
    )

    return {
      id: `${compName}:${handler.element}:${handler.event}:${handler.line}`,
      element: handler.element,
      event: handler.event,
      line: handler.line,
      flows,
    }
  })
}

/**
 * 핸들러가 결국 어떤 setter 들을 부르는지 알아냅니다.
 *
 * 세 가지 경우를 다룹니다:
 *   onClick={() => setOpen(true)}   — 인라인에서 직접
 *   onChange={handleSearch}          — 이름붙은 함수 참조
 *   onClick={reset}                  — reset 이 다시 clearAll 을 부르는 간접 호출
 */
function resolveHandlerSetters(handler, localFns, setterNames) {
  const setters = new Set(findSetterUsage(handler.expr, setterNames))
  const viaFns = []
  const seen = new Set()

  const follow = (fnName, depth) => {
    if (depth > MAX_FN_DEPTH || seen.has(fnName)) return
    seen.add(fnName)

    const fn = localFns[fnName]
    if (!fn) return

    // 선언된 줄을 함께 담아 스텝에서 그 위치로 이동할 수 있게 합니다
    viaFns.push({ name: fnName, line: fn.line })
    findSetterUsage(fn.node, setterNames).forEach(s => setters.add(s))
    // 메서드 호출(obj.foo())은 로컬 함수가 아니므로 따라가지 않습니다
    findDirectCalls(fn.node, setterNames).forEach(next => follow(next, depth + 1))
  }

  if (handler.expr.type === 'Identifier') {
    // onChange={setQuery} — setter 를 그대로 넘기면 호출식이 아니라
    // findSetterUsage 로는 잡히지 않습니다. 여기서 직접 처리합니다.
    if (setterNames.includes(handler.expr.name)) {
      setters.add(handler.expr.name)
    } else {
      follow(handler.expr.name, 0)
    }
  } else {
    // 인라인 화살표 안에서 로컬 함수를 부르는 경우
    findDirectCalls(handler.expr, setterNames).forEach(name => follow(name, 0))
  }

  return { setters: [...setters], viaFns }
}

/**
 * setter 하나에서 시작하는 흐름을 Step 배열로 평탄화합니다.
 */
function buildFlow({ handler, setter, viaFns, setterToState, setterKind, effects, setterNames }) {
  const steps = []

  steps.push({
    kind: 'event',
    label: `<${handler.element} ${handler.event}>`,
    line: handler.line,
    badges: [],
  })

  // 거쳐 가는 함수는 각각 별도 스텝으로 — 저마다 선언 위치로 이동할 수 있게
  viaFns.forEach(fn => {
    steps.push({
      kind: 'call',
      label: `${fn.name}()`,
      line: fn.line,
      badges: [],
    })
  })

  const state = setterToState[setter]
  const kind = setterKind ? setterKind[setter] : 'state'

  steps.push({
    kind: 'setter',
    label: `${setter}()`,
    detail: state ? `→  ${state}` : null,
    note: kind === 'reducer' ? 'useReducer 로 관리되는 상태입니다' : undefined,
    line: handler.line,
    badges: [],
  })

  // 외부 스토어(Redux)는 바뀌는 대상이 이 컴포넌트 밖이라 Effect 연결을 따지지 않습니다
  if (kind === 'store') {
    steps.push({
      kind: 'rerender',
      label: '리렌더',
      detail: '외부 스토어가 바뀌어, 구독 중인 컴포넌트들이 다시 그려집니다',
      line: null,
      badges: [],
    })
    return { steps }
  }

  appendEffectSteps({ steps, state, effects, setterToState, setterNames, depth: 0, visited: new Set() })

  return { steps }
}

/**
 * 상태가 바뀐 뒤 이어지는 Effect 재실행을 스텝으로 붙입니다.
 * Effect 안에서 또 상태가 바뀌면 재귀로 따라갑니다 (연쇄).
 */
function appendEffectSteps({ steps, state, effects, setterToState, setterNames, depth, visited }) {
  const triggered = effects.filter(
    e => e.trigger === 'deps' && e.deps.includes(state) && !visited.has(e.line)
  )

  if (triggered.length === 0 || depth > MAX_EFFECT_DEPTH) {
    steps.push({ kind: 'rerender', label: '리렌더', line: null, badges: [] })
    if (triggered.length === 0 && depth === 0) {
      steps[steps.length - 1].detail = `'${state}' 를 deps 로 쓰는 Effect 는 없습니다`
    }
    return
  }

  for (const effect of triggered) {
    visited.add(effect.line)

    const async = findAsyncMarks(effect.body)
    const calls = findCalls(effect.body, setterNames)
    const innerSetters = findSetterUsage(effect.body, setterNames)

    steps.push({
      kind: 'effect',
      label: `${effect.hook} 재실행`,
      note: `deps [${effect.deps.join(', ')}] 에 '${state}' 가 있어 다시 실행됩니다`,
      line: effect.line,
      badges: async,
    })

    for (const fn of calls) {
      steps.push({
        kind: 'call',
        label: `${fn.name}()`,
        line: fn.line,
        badges: async.length ? ['비동기'] : [],
      })
    }

    for (const s of innerSetters) {
      const nextState = setterToState[s]
      steps.push({
        kind: 'setter',
        label: `${s}()`,
        detail: nextState ? `→  ${nextState}` : null,
        line: effect.line,
        badges: [],
      })

      // 이 상태가 또 다른 Effect 를 트리거하는지 따라갑니다
      const chained = effects.filter(
        e => e.trigger === 'deps' && e.deps.includes(nextState) && !visited.has(e.line)
      )
      if (chained.length > 0) {
        appendEffectSteps({
          steps, state: nextState, effects, setterToState, setterNames,
          depth: depth + 1, visited,
        })
        return
      }
    }

    steps.push({ kind: 'rerender', label: '리렌더', line: null, badges: [] })
  }
}

/**
 * Effect 목록을 사람이 읽는 문장으로 바꿉니다.
 */
export function describeEffects(effects) {
  return effects.map(e => {
    let when
    if (e.trigger === 'every-render') when = '매 렌더마다 실행'
    else if (e.trigger === 'mount') when = '마운트 시 1회만 실행'
    else when = `deps [${e.deps.join(', ')}] 이 바뀔 때 실행`

    return { line: e.line, hook: e.hook, trigger: e.trigger, deps: e.deps, when }
  })
}

export { lineOf }
