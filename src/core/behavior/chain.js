/**
 * Behavior Chain — 수집한 정보를 이어 붙여 "동작 연쇄"를 만듭니다.
 *
 * 만들어지는 것:
 *   이벤트 → setter 호출 → 상태 변경 → deps 가 일치하는 Effect 재실행
 *          → Effect 안의 호출/비동기 → 또 다른 setter → 상태 변경 → 리렌더
 *
 * 비동기 Effect 는 응답 전/후로 갈라 그 사이에 `kind:'wait'` 스텝을 끼웁니다 —
 * ⏱ 타임라인과 같은 눈금(weight)이라, 두 섹션의 "기다리는 시간" 표현이 맞습니다.
 * 되돌아 나가는 자리(`kind:'gate'`)도 같은 문장으로 함께 보여 줍니다.
 *
 * 스텝마다 `hook` 을 달아 둡니다 — 그 상태·Effect 가 컴포넌트가 아니라
 * 커스텀 훅 안에 있다는 뜻입니다. UI 는 이어지는 같은 훅 스텝을 한 구역으로 묶어
 * "흐름이 훅 안으로 들어갔다 나오는" 모습을 보여 줍니다.
 *
 * UI 가 단순해지도록 여기서 **평탄화된 Step 배열**까지 만들어 넘깁니다.
 * 렌더러는 배열을 순서대로 그리기만 하면 됩니다.
 */

import { findSetterUsage, findCalls, findDirectCalls, findAsyncMarks, lineOf } from './collect.js'
import { describeAsyncPhase, findGates, describeGate } from './timing.js'

/** 핸들러에서 로컬 함수를 따라 들어가는 최대 깊이 */
const MAX_FN_DEPTH = 3
/** Effect → 상태 변경 → 다른 Effect 로 이어지는 연쇄를 따라가는 최대 깊이 */
const MAX_EFFECT_DEPTH = 3

/**
 * 컴포넌트 하나의 이벤트별 동작 연쇄를 만듭니다.
 * @returns {object[]} EventEntry[]
 */
export function buildEvents(compName, collected, scope = {}, code = null) {
  const { states, effects, localFns, handlers } = collected
  const { propNames = new Set(), outOfScope = new Map() } = scope

  const setterNames = states.map(s => s.setter).filter(Boolean)
  const setterToState = {}
  const setterKind = {}
  // setter → 이 상태를 관리하는 커스텀 훅 (컴포넌트 자신의 상태면 null)
  const setterHook = {}
  for (const s of states) {
    if (!s.setter) continue
    setterToState[s.setter] = s.state
    setterKind[s.setter] = s.kind || 'state'
    setterHook[s.setter] = s.viaHook
      ? { name: s.viaHook, line: s.hookLine || null, internal: s.hookInternal || null }
      : null
  }

  return handlers.map(handler => {
    const { setters, viaFns } = resolveHandlerSetters(handler, localFns, setterNames)

    const flows = setters.map(setter =>
      buildFlow({
        handler, setter, viaFns,
        setterToState, setterKind, setterHook,
        effects, setterNames, code,
      })
    )

    // 상태를 바꾸지 않는 것처럼 보일 때, 진짜 안 바꾸는 것인지
    // 붙여넣은 코드 밖으로 이어지는 것인지 구분해 줍니다.
    if (flows.length === 0) {
      const boundary = detectBoundary(handler, localFns, setterNames, propNames, outOfScope)
      if (boundary) flows.push(boundary)
    }

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
 * 흐름이 붙여넣은 코드 밖으로 나가는 지점을 찾습니다.
 *
 * 두 경우를 구분합니다:
 *   - prop 으로 받은 콜백   → 이 컴포넌트를 쓰는 쪽(부모)에 있음
 *   - import 한 훅에서 온 것 → 다른 파일에 있음
 *
 * 둘 다 아니면 정말로 상태를 바꾸지 않는 핸들러입니다.
 */
function detectBoundary(handler, localFns, setterNames, propNames, outOfScope) {
  // 핸들러가 참조하는 이름들을 모읍니다
  const referenced = []
  if (handler.expr.type === 'Identifier') {
    referenced.push(handler.expr.name)
  } else {
    findDirectCalls(handler.expr, setterNames).forEach(n => referenced.push(n))
  }

  for (const name of referenced) {
    if (localFns[name]) continue // 이 파일 안에 있음 — 경계 아님

    if (outOfScope.has(name)) {
      return {
        steps: [
          { kind: 'event', label: `<${handler.element} ${handler.event}>`, line: handler.line, hook: null, badges: [] },
          {
            kind: 'boundary',
            label: `${name}`,
            detail: `${outOfScope.get(name)} 에서 받아옴`,
            note: '이 훅은 다른 파일에 있어 여기서부터는 따라갈 수 없습니다',
            line: null,
            hook: null,
            badges: [],
          },
        ],
      }
    }

    if (propNames.has(name)) {
      return {
        steps: [
          { kind: 'event', label: `<${handler.element} ${handler.event}>`, line: handler.line, hook: null, badges: [] },
          {
            kind: 'boundary',
            label: `${name}`,
            detail: 'prop 으로 전달받은 함수',
            note: '이 컴포넌트를 사용하는 쪽에 있습니다. 부모 코드도 함께 붙여넣으면 이어서 볼 수 있습니다',
            line: null,
            hook: null,
            badges: [],
          },
        ],
      }
    }
  }

  return null
}

/**
 * 핸들러가 결국 어떤 setter 들을 부르는지 알아냅니다.
 *
 * 세 가지 경우를 다룹니다:
 *   onClick={() => setOpen(true)}   — 인라인에서 직접
 *   onChange={handleSearch}          — 이름붙은 함수 참조
 *   onClick={reset}                  — reset 이 다시 clearAll 을 부르는 간접 호출
 *   onClick={onSelect}               — 커스텀 훅이 돌려준 콜백 (localFns 에 합쳐져 들어옴)
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

    // 선언된 줄을 함께 담아 스텝에서 그 위치로 이동할 수 있게 합니다.
    // 훅이 돌려준 콜백이면 그 함수가 사는 훅도 함께 — 훅 구역이 여기서 열립니다.
    viaFns.push({
      name: fnName,
      line: fn.line,
      hook: fn.hook || null,
      hookLine: fn.hookLine || null,
      hookInternal: fn.hookInternal || null,
    })
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
function buildFlow({ handler, setter, viaFns, setterToState, setterKind, setterHook, effects, setterNames, code }) {
  const steps = []

  steps.push({
    kind: 'event',
    label: `<${handler.element} ${handler.event}>`,
    line: handler.line,
    hook: null,
    badges: [],
  })

  // 거쳐 가는 함수는 각각 별도 스텝으로 — 저마다 선언 위치로 이동할 수 있게
  viaFns.forEach(fn => {
    steps.push({
      kind: 'call',
      label: `${fn.name}()`,
      line: fn.line,
      hook: fn.hook || null,
      hookLine: fn.hookLine || null,
      hookInternal: fn.hookInternal || null,
      badges: [],
    })
  })

  const state = setterToState[setter]
  const kind = setterKind ? setterKind[setter] : 'state'
  const via = setterHook ? setterHook[setter] : null

  // 훅이 관리하는 상태라는 사실은 아래 hook 필드(=UI 의 훅 구역)가 말해 줍니다.
  const note = kind === 'reducer' ? 'useReducer 로 관리되는 상태입니다' : undefined

  steps.push({
    kind: 'setter',
    label: `${setter}()`,
    detail: state ? `→  ${state}` : null,
    note,
    line: handler.line,
    hook: via ? via.name : null,
    hookLine: via ? via.line : null,
    hookInternal: via ? via.internal : null,
    badges: [],
  })

  // 외부 스토어(Redux)는 바뀌는 대상이 이 컴포넌트 밖이라 Effect 연결을 따지지 않습니다
  if (kind === 'store') {
    steps.push({
      kind: 'rerender',
      label: '리렌더',
      detail: '외부 스토어가 바뀌어, 구독 중인 컴포넌트들이 다시 그려집니다',
      line: null,
      hook: null,
      badges: [],
    })
    return { steps }
  }

  appendEffectSteps({
    steps, state, effects, setterToState, setterHook, setterNames, code,
    depth: 0, visited: new Set(),
  })

  return { steps }
}

/**
 * 상태가 바뀐 뒤 이어지는 Effect 재실행을 스텝으로 붙입니다.
 * Effect 안에서 또 상태가 바뀌면 재귀로 따라갑니다 (연쇄).
 */
function appendEffectSteps({ steps, state, effects, setterToState, setterHook, setterNames, code, depth, visited }) {
  const triggered = effects.filter(
    e => e.trigger === 'deps' && e.deps.includes(state) && !visited.has(e.line)
  )

  if (triggered.length === 0 || depth > MAX_EFFECT_DEPTH) {
    // 리렌더는 훅이 아니라 컴포넌트에서 일어납니다 — 여기서 훅 구역이 닫힙니다
    steps.push({ kind: 'rerender', label: '리렌더', line: null, hook: null, badges: [] })
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
    // 이 Effect 가 커스텀 훅 안에 있으면, 안에서 일어나는 일도 모두 훅 안입니다
    const inHook = effect.viaHook || null
    const inHookLine = effect.hookLine || null

    steps.push({
      kind: 'effect',
      label: `${effect.hook} 재실행`,
      note: `deps [${effect.deps.join(', ')}] 에 '${state}' 가 있어 다시 실행됩니다`,
      line: effect.line,
      hook: inHook,
      hookLine: inHookLine,
      badges: async,
    })

    // 이 Effect 는 첫 줄에서 되돌아 나갈 수 있습니다 — ⏱ 타임라인과 같은 관문.
    // 타임라인은 관문과 즉시 setter 를 줄 번호로 세우지만, 연쇄는 호출·setter 를
    // 단계별로 늘어놓으므로 관문은 Effect 바로 뒤에 모읍니다.
    // 말하려는 것은 "아래 단계로 못 갈 수 있다" 하나뿐이라 그걸로 충분합니다.
    // 훅 안의 Effect 면 관문도 그 훅 안입니다 — 구역이 여기서 끊기면 안 됩니다.
    for (const g of findGates(effect.body, code)) {
      steps.push({
        kind: 'gate',
        ...describeGate(g),
        hook: inHook,
        hookLine: inHookLine,
        badges: [],
      })
    }

    for (const fn of calls) {
      steps.push({
        kind: 'call',
        label: `${fn.name}()`,
        line: fn.line,
        hook: inHook,
        hookLine: inHookLine,
        badges: async.length ? ['비동기'] : [],
      })
    }

    // 비동기 Effect 는 "응답 전에 곧바로 바뀌는 상태" 와 "응답이 온 뒤 바뀌는 상태" 가
    // 섞여 있습니다. 사이에 기다리는 구간을 끼워 넣으려고 순서를 갈라 둡니다.
    const phase = async.length ? describeAsyncPhase(effect.body, setterNames) : null
    const ordered = phase
      ? [
          ...innerSetters.filter(s => !phase.deferred.has(s)),
          ...innerSetters.filter(s => phase.deferred.has(s)),
        ]
      : innerSetters
    let waitShown = false

    for (const s of ordered) {
      // 응답 뒤에 바뀌는 첫 상태 앞에서 한 번만 — 여기서 시간이 흐릅니다
      if (phase && !waitShown && phase.deferred.has(s)) {
        steps.push({
          kind: 'wait',
          label: '응답 대기',
          detail: phase.wait.detail,
          weight: phase.wait.weight,
          waitMs: phase.wait.ms,
          line: null,
          hook: inHook,
          hookLine: inHookLine,
          badges: [],
        })
        waitShown = true
      }

      const nextState = setterToState[s]
      const via = setterHook ? setterHook[s] : null
      steps.push({
        kind: 'setter',
        label: `${s}()`,
        detail: nextState ? `→  ${nextState}` : null,
        line: effect.line,
        hook: via ? via.name : inHook,
        hookLine: via ? via.line : inHookLine,
        hookInternal: via ? via.internal : null,
        badges: [],
      })

      // 이 상태가 또 다른 Effect 를 트리거하는지 따라갑니다
      const chained = effects.filter(
        e => e.trigger === 'deps' && e.deps.includes(nextState) && !visited.has(e.line)
      )
      if (chained.length > 0) {
        appendEffectSteps({
          steps, state: nextState, effects, setterToState, setterHook, setterNames, code,
          depth: depth + 1, visited,
        })
        return
      }
    }

    steps.push({ kind: 'rerender', label: '리렌더', line: null, hook: null, badges: [] })
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

    return {
      line: e.line,
      hook: e.hook,
      trigger: e.trigger,
      deps: e.deps,
      when,
      viaHook: e.viaHook || null,   // 이 Effect 가 사는 커스텀 훅
    }
  })
}

export { lineOf }
