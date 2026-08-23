/**
 * Behavior Timing — Effect 의 "비동기 타이밍" 을 분석합니다.
 *
 * 동작 탭이 "무엇이 → 무엇을 바꾸는가" 라면, 타이밍은 "그게 언제 일어나는가" 입니다.
 * 특히 흔한 함정을 짚습니다:
 *
 *   useEffect(() => {
 *     fetchUser(id).then(setUser)   // ← 응답은 나중에 온다.
 *   }, [id])                        //   그 사이 컴포넌트가 언마운트되면
 *                                   //   "unmounted 컴포넌트에 setState" 경고.
 *
 * 판정 기준:
 *   - isAsync       : effect 안에 await / .then / fetch 가 있는가
 *   - deferred setter: 그 비동기가 끝난 뒤 실행되는 setState (await 이후 · .then 콜백 안)
 *   - hasCleanup    : 정리 함수를 return 하는가
 *   - guard         : `if (alive)` 류로 setState 를 감싸거나 AbortController 로 취소하는가
 *   - risk          : 비동기 + 가드 없는 deferred setState → 언마운트 후 setState 위험
 *   - staleDeps     : effect 가 읽는데 deps 에는 없는 값 (deps.js) → 옛 값을 붙잡고 있음
 *   - wait weight   : 기다리는 구간의 상대적 무게 — 타임라인에서 폭으로 그려
 *                     "여기서 시간이 흐른다" 를 눈에 보이게 합니다 (실제 ms 아님)
 */

import { walk, calleeName, isFunctionNode, lineOf } from './collect.js'
import { findStaleDeps } from './deps.js'

/**
 * 컴포넌트의 effect 목록(본문 AST 포함)과 상태 목록으로 타이밍을 분석합니다.
 * @param {Array} effects - collect.js 가 모은 raw effect (body 포함)
 * @param {Array} states  - { state, setter, ... }
 * @returns {Array} 각 effect 의 타이밍 정보
 */
export function analyzeEffectsTiming(effects, states) {
  const setterNames = states.map(s => s.setter).filter(Boolean)
  const setterToState = {}
  for (const s of states) if (s.setter) setterToState[s.setter] = s.state || null

  return effects
    .filter(e => e && e.body)
    .map(e => analyzeOne(e, setterNames, setterToState))
}

function analyzeOne(effect, setterNames, setterToState) {
  const body = effect.body

  // ── 비동기 여부 ──
  let hasAwait = false, hasThen = false, hasFetch = false
  walk(body, (n) => {
    if (n.type === 'AwaitExpression') hasAwait = true
    if (n.type === 'CallExpression') {
      const name = calleeName(n)
      if (name === 'then') hasThen = true
      if (name === 'fetch') hasFetch = true
    }
  })
  const isAsync = hasAwait || hasThen || hasFetch
  const asyncKind = hasAwait ? 'await' : hasThen ? '.then' : hasFetch ? 'fetch' : null

  // ── setter 들을 실행 시점(즉시 / 비동기 이후)과 가드 여부로 분류 ──
  //    같은 훑기로 effect 가 읽는 이름(refs)도 모읍니다 — deps 대조에 씁니다.
  const { setters, refs } = analyzeBody(body, setterNames)
  const immediate = setters.filter(s => !s.deferred)
  const deferred = setters.filter(s => s.deferred)
  const unguardedDeferred = deferred.filter(s => !s.guarded)

  // ── 정리 함수 / 취소 수단 ──
  const hasCleanup = returnsFunction(body)
  const hasAbort = usesAbort(body)

  // ── 위험 판정 ──
  const risk = (isAsync && deferred.length > 0 && !hasAbort && unguardedDeferred.length > 0)
    ? 'unmount-setstate'
    : null

  const hasGuard = hasAbort || (deferred.length > 0 && unguardedDeferred.length === 0)

  // ── deps 에서 빠진 값 (stale closure) ──
  const staleDeps = findStaleDeps({
    owner: effect.owner,
    deps: effect.deps,
    depRoots: effect.depRoots,
    body,
    refs,
  })

  return {
    line: effect.line,
    hook: effect.hook,
    trigger: effect.trigger,           // 'mount' | 'deps' | 'every-render'
    deps: effect.deps,
    viaHook: effect.viaHook || null,
    isAsync,
    asyncKind,
    hasCleanup,
    hasGuard,
    risk,
    staleDeps,
    setters: setters.map(s => ({ ...s, state: setterToState[s.name] || null })),
    timeline: buildTimeline({
      effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, staleDeps, setterToState,
    }),
  }
}

/** 훑을 때 들어가지 않는 가지 — 위치 정보와 타입 표기는 실행되는 코드가 아닙니다 */
const SKIP_KEYS = new Set([
  'loc', 'leadingComments', 'trailingComments',
  'typeAnnotation', 'returnType', 'typeParameters',
])

/**
 * effect 본문을 한 번 훑으며 두 가지를 모읍니다.
 *
 *   setters — setter 호출이 각각
 *             - deferred: 비동기(await/.then)가 끝난 뒤 실행되는가
 *             - guarded : if 문 안에 감싸여 있는가 (`if (alive) setX()` 류)
 *             - nested  : 중첩 함수 안에서 불리는가 (`setInterval(() => setX())` 류).
 *                         effect 가 도는 그 순간에 실행되는 것이 아니라 나중에 불립니다.
 *   refs    — effect 가 **읽는** 이름들. deps 와 대조해 빠진 값을 찾는 데 씁니다.
 *             `user.id` 의 id, `{ id: 1 }` 의 키처럼 값을 읽는 자리가 아닌 이름과
 *             중첩 함수의 파라미터는 세지 않습니다.
 *
 * 실행 순서를 흉내 내려고 블록 안 문장을 순서대로 보며 await 를 만난 뒤부터
 * deferred 로 넘깁니다. 중첩 함수는 경계에서 멈춰 서로 섞이지 않게 합니다.
 */
function analyzeBody(effectBody, setterNames) {
  const found = []
  const refs = []

  function visit(node, deferred, guarded, nested) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) visit(n, deferred, guarded, nested)
      return
    }
    if (typeof node.type !== 'string') return

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        // 중첩 함수: 그 함수 본문을 순서대로 다시 훑습니다.
        //            여기서부터의 setter 는 effect 실행 중이 아니라 나중에 불릴 수 있습니다.
        visitFunctionBody(node, deferred, guarded, true)
        return

      case 'IfStatement':
        visit(node.test, deferred, guarded, nested)
        visit(node.consequent, deferred, true, nested)
        if (node.alternate) visit(node.alternate, deferred, true, nested)
        return

      case 'Identifier':
        // 여기까지 내려온 Identifier 는 "값을 읽는" 자리입니다.
        refs.push({ name: node.name, line: lineOf(node), deferred })
        return

      case 'MemberExpression':
      case 'OptionalMemberExpression':
        // user.id → 읽는 값은 user 뿐, id 는 속성 이름입니다.
        visit(node.object, deferred, guarded, nested)
        if (node.computed) visit(node.property, deferred, guarded, nested)
        return

      case 'ObjectProperty':
      case 'Property':
        if (node.computed) visit(node.key, deferred, guarded, nested)
        visit(node.value, deferred, guarded, nested)
        return

      case 'ObjectMethod':
        if (node.computed) visit(node.key, deferred, guarded, nested)
        visitFunctionBody(node, deferred, guarded, true)
        return

      case 'CallExpression':
      case 'OptionalCallExpression': {
        // .then(cb): 콜백은 응답 이후에 실행됩니다 → deferred
        if (calleeName(node) === 'then') {
          visit(node.callee, deferred, guarded, nested)
          for (const arg of node.arguments) {
            if (isFunctionNode(arg)) visitFunctionBody(arg, true, guarded, true)
            else visit(arg, deferred, guarded, nested)
          }
          return
        }
        // setter 직접 호출
        if (node.callee && node.callee.type === 'Identifier' && setterNames.includes(node.callee.name)) {
          found.push({ name: node.callee.name, line: lineOf(node), deferred, guarded, nested })
        }
        break
      }
    }

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue
      visit(node[key], deferred, guarded, nested)
    }
  }

  function visitFunctionBody(fnNode, deferredEntry, guarded, nested) {
    const body = fnNode.body
    if (!body) return
    if (body.type === 'BlockStatement') {
      let deferred = deferredEntry
      for (const stmt of body.body) {
        const awaitHere = containsDirectAwait(stmt)
        visit(stmt, deferred || awaitHere, guarded, nested)
        if (awaitHere) deferred = true
      }
    } else {
      // 화살표 축약형 (본문이 식)
      visit(body, deferredEntry || containsDirectAwait(body), guarded, nested)
    }
  }

  visitFunctionBody(effectBody, false, false, false)
  return { setters: found, refs }
}

/** 중첩 함수를 건너뛰고, 이 함수 레벨에 await 가 직접 있는지 봅니다 */
function containsDirectAwait(node) {
  let found = false
  ;(function rec(n) {
    if (found || !n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(rec); return }
    if (typeof n.type !== 'string') return
    if (n.type === 'AwaitExpression') { found = true; return }
    if (isFunctionNode(n)) return // 중첩 함수 경계에서 멈춤
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue
      rec(n[k])
    }
  })(node)
  return found
}

/** effect 가 정리 함수를 return 하는가 (본문 최상위 return 만 봅니다) */
function returnsFunction(fnNode) {
  const body = fnNode.body
  if (!body) return false
  if (body.type !== 'BlockStatement') return isFunctionNode(body)
  for (const stmt of body.body) {
    if (stmt.type === 'ReturnStatement' && stmt.argument && isFunctionNode(stmt.argument)) return true
  }
  return false
}

/** AbortController / signal / abort() 로 요청을 취소하는가 */
function usesAbort(node) {
  let found = false
  walk(node, (n) => {
    if (n.type === 'NewExpression' && n.callee && n.callee.name === 'AbortController') found = true
    if (n.type === 'CallExpression' && calleeName(n) === 'abort') found = true
    if (n.type === 'Identifier' && n.name === 'signal') found = true
  })
  return found
}

/**
 * UI 가 순서대로 그리기만 하면 되도록 타임라인 스텝을 평탄화합니다.
 */
function buildTimeline({ effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, staleDeps, setterToState }) {
  const steps = []
  const triggerLabel = effect.trigger === 'mount' ? '마운트 시 1회'
    : effect.trigger === 'every-render' ? '매 렌더마다'
    : `deps [${(effect.deps || []).join(', ')}] 변경 시`

  steps.push({ kind: 'trigger', label: triggerLabel })
  steps.push({ kind: 'effect', label: `${effect.hook} 실행`, line: effect.line })

  for (const s of immediate) {
    steps.push({
      kind: 'setter', phase: 'sync',
      label: `${s.name}()`,
      detail: setterToState[s.name] ? `→ ${setterToState[s.name]}` : null,
      line: s.line,
    })
  }

  if (isAsync) {
    const wait = estimateWait(effect.body)
    steps.push({
      kind: 'async-wait',
      label: `${asyncKind === '.then' ? 'Promise' : asyncKind} 대기`,
      badges: [asyncKind],
      weight: wait.weight,
      waitMs: wait.ms,
      detail: wait.ms != null ? `≈${formatDuration(wait.ms)}` : '시간 미상',
    })
    steps.push({ kind: 'resolve', label: '응답 도착' })
    for (const s of deferred) {
      steps.push({
        kind: 'setter', phase: 'async',
        label: `${s.name}()`,
        detail: setterToState[s.name] ? `→ ${setterToState[s.name]}` : null,
        guarded: s.guarded,
        line: s.line,
      })
    }
  }

  steps.push({ kind: 'rerender', label: '리렌더' })

  if (hasCleanup) {
    steps.push({ kind: 'cleanup', label: '정리(cleanup) 실행', note: 'deps 변경·언마운트 시' })
  }

  if (risk === 'unmount-setstate') {
    steps.push({
      kind: 'risk',
      label: '언마운트 후 setState 위험',
      note: '응답이 오기 전에 컴포넌트가 사라지면, 없는 컴포넌트에 상태를 바꾸려 합니다. 정리 함수에서 취소하거나 alive 가드를 두세요.',
    })
  }

  if (staleDeps && staleDeps.length > 0) {
    const names = staleDeps.map(d => d.name).join(', ')
    const late = staleDeps.some(d => d.inAsync)
    steps.push({
      kind: 'stale',
      names: staleDeps.map(d => d.name),
      label: `deps 에 빠진 값: ${names}`,
      note: late
        ? `effect 는 만들어질 때의 값을 붙잡아 둡니다. ${names} 가 deps 에 없으니, 응답이 온 뒤에도 처음 값 그대로를 씁니다.`
        : `effect 는 만들어질 때의 값을 붙잡아 둡니다. ${names} 가 바뀌어도 이 effect 는 다시 실행되지 않고, 안에서는 처음 값 그대로입니다.`,
    })
  }

  return steps
}

/* ── 상대 시간감 ─────────────────────────────────────────────────────────────
 *
 * 타임라인의 모든 스텝이 같은 크기면 setLoading(true) 와 "응답 대기" 가 같은
 * 무게로 보입니다. 기다리는 구간만 폭을 키워 시간이 흐르는 자리를 드러냅니다.
 *
 * 실제 ms 는 정적으로 알 수 없으므로 **상대적인 눈금**만 냅니다.
 * 즉시 실행 스텝을 1 로 봤을 때, 대기는 2~12.
 * 코드에 지연 리터럴이 보이면(await sleep(2000) 등) 그 값을 참고하고,
 * 네트워크처럼 알 수 없으면 중간값을 씁니다.
 */

/** 왕복 시간을 알 수 없는 대기(네트워크 등)의 기본 무게 — 눈에 띄되 최대는 아니게 */
const WAIT_WEIGHT_UNKNOWN = 6

function weightForMs(ms) {
  if (ms < 100) return 2        // 눈 깜짝할 사이
  if (ms < 500) return 4
  if (ms < 1000) return 5
  if (ms < 3000) return 8
  if (ms < 10000) return 10
  return 12                     // 10초 이상 — 최대치
}

/** 사람이 읽는 길이 표기: 900 → "900ms", 3000 → "3초", 1500 → "1.5초" */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  return `${Number.isInteger(sec) ? sec : sec.toFixed(1)}초`
}

/**
 * 이 effect 의 대기 구간이 얼마나 긴지 어림합니다.
 *
 * **await 하는 식 안에서만** 지연 리터럴을 찾습니다.
 * effect 어딘가의 setInterval(…, 1000) 을 "응답 대기 시간" 으로 잘못 읽지 않으려는 것.
 *   await sleep(2000)                          → 2000
 *   await new Promise(r => setTimeout(r, 300)) → 300
 * 못 찾으면 ms 는 null (= 시간 미상, 기본 무게).
 */
function estimateWait(body) {
  let ms = null
  walk(body, (n) => {
    if (n.type !== 'AwaitExpression') return
    const found = maxDelayLiteral(n.argument)
    if (found != null && (ms == null || found > ms)) ms = found
  })
  return { ms, weight: ms == null ? WAIT_WEIGHT_UNKNOWN : weightForMs(ms) }
}

/** 지연을 뜻하는 호출의 ms 리터럴 중 가장 큰 값 (없으면 null) */
const DELAY_CALLS = new Set(['sleep', 'delay', 'wait', 'pause'])

function maxDelayLiteral(node) {
  let ms = null
  const take = (v) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && (ms == null || v > ms)) ms = v
  }
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return
    const name = calleeName(n)
    const args = n.arguments || []
    if (name === 'setTimeout' || name === 'setInterval') {
      if (args[1] && args[1].type === 'NumericLiteral') take(args[1].value)
    } else if (DELAY_CALLS.has(name)) {
      if (args[0] && args[0].type === 'NumericLiteral') take(args[0].value)
    }
  })
  return ms
}
