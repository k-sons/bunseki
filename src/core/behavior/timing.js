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
 */

import { walk, calleeName, isFunctionNode, lineOf } from './collect.js'

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
  const setters = analyzeSetters(body, setterNames)
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
    setters: setters.map(s => ({ ...s, state: setterToState[s.name] || null })),
    timeline: buildTimeline({
      effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, setterToState,
    }),
  }
}

/**
 * effect 본문의 setter 호출을 훑으며 각각이
 *   - deferred: 비동기(await/.then)가 끝난 뒤 실행되는가
 *   - guarded : if 문 안에 감싸여 있는가 (`if (alive) setX()` 류)
 * 인지 판정합니다.
 *
 * 실행 순서를 흉내 내려고 블록 안 문장을 순서대로 보며 await 를 만난 뒤부터
 * deferred 로 넘깁니다. 중첩 함수는 경계에서 멈춰 서로 섞이지 않게 합니다.
 */
function analyzeSetters(effectBody, setterNames) {
  const found = []

  function visit(node, deferred, guarded) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) visit(n, deferred, guarded)
      return
    }
    if (typeof node.type !== 'string') return

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        // 중첩 함수: 그 함수 본문을 순서대로 다시 훑습니다.
        visitFunctionBody(node, deferred, guarded)
        return

      case 'IfStatement':
        visit(node.test, deferred, guarded)
        visit(node.consequent, deferred, true)
        if (node.alternate) visit(node.alternate, deferred, true)
        return

      case 'CallExpression': {
        // .then(cb): 콜백은 응답 이후에 실행됩니다 → deferred
        if (calleeName(node) === 'then') {
          visit(node.callee, deferred, guarded)
          for (const arg of node.arguments) {
            if (isFunctionNode(arg)) visitFunctionBody(arg, true, guarded)
            else visit(arg, deferred, guarded)
          }
          return
        }
        // setter 직접 호출
        if (node.callee && node.callee.type === 'Identifier' && setterNames.includes(node.callee.name)) {
          found.push({ name: node.callee.name, line: lineOf(node), deferred, guarded })
        }
        break
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
      visit(node[key], deferred, guarded)
    }
  }

  function visitFunctionBody(fnNode, deferredEntry, guarded) {
    const body = fnNode.body
    if (!body) return
    if (body.type === 'BlockStatement') {
      let deferred = deferredEntry
      for (const stmt of body.body) {
        const awaitHere = containsDirectAwait(stmt)
        visit(stmt, deferred || awaitHere, guarded)
        if (awaitHere) deferred = true
      }
    } else {
      // 화살표 축약형 (본문이 식)
      visit(body, deferredEntry || containsDirectAwait(body), guarded)
    }
  }

  visitFunctionBody(effectBody, false, false)
  return found
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
function buildTimeline({ effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, setterToState }) {
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
    steps.push({ kind: 'async-wait', label: `${asyncKind === '.then' ? 'Promise' : asyncKind} 대기`, badges: [asyncKind] })
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

  return steps
}
