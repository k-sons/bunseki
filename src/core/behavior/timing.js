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
 *   - gates         : `if (tab !== 'posts') return` 처럼 **여기서 멈출 수 있는** 지점.
 *                     타임라인이 "항상 끝까지 간다" 처럼 보이지 않게 합니다.
 */

import { walk, calleeName, isFunctionNode, lineOf } from './collect.js'
import { findStaleDeps } from './deps.js'

/**
 * 컴포넌트의 effect 목록(본문 AST 포함)과 상태 목록으로 타이밍을 분석합니다.
 * @param {Array} effects - collect.js 가 모은 raw effect (body 포함)
 * @param {Array} states  - { state, setter, ... }
 * @param {string} [code] - 원본 소스. 조건식을 그대로 보여주려고 잘라 씁니다.
 * @returns {Array} 각 effect 의 타이밍 정보
 */
export function analyzeEffectsTiming(effects, states, code) {
  const setterNames = states.map(s => s.setter).filter(Boolean)
  const setterToState = {}
  // 바꾸는 대상이 컴포넌트 밖에 있는 것(redux dispatch) — 흐름에는 그리되
  // **언마운트 위험으로는 세지 않습니다**. 없는 컴포넌트에 상태를 쓰는 게 아니라
  // 살아 있는 스토어에 보내는 것이라 React 가 경고하지 않습니다.
  const storeSetters = new Set()
  for (const s of states) {
    if (!s.setter) continue
    setterToState[s.setter] = s.state || null
    if (s.kind === 'store') storeSetters.add(s.setter)
  }

  return effects
    .filter(e => e && e.body)
    .map(e => analyzeOne(e, setterNames, setterToState, storeSetters, code))
}

function analyzeOne(effect, setterNames, setterToState, storeSetters, code) {
  const body = effect.body

  // ── 비동기 여부 ──
  const { isAsync, asyncKind } = detectAsync(body)

  // ── setter 들을 실행 시점(즉시 / 비동기 이후)과 가드 여부로 분류 ──
  //    같은 훑기로 effect 가 읽는 이름(refs)도 모읍니다 — deps 대조에 씁니다.
  const { setters, refs } = analyzeBody(body, setterNames)
  const immediate = setters.filter(s => !s.deferred)
  const deferred = setters.filter(s => s.deferred)
  // 위험을 묻는 대상은 **컴포넌트 상태**뿐입니다 (store 는 밖에 있어 언마운트와 무관)
  const deferredState = deferred.filter(s => !storeSetters.has(s.name))
  const unguardedDeferred = deferredState.filter(s => !s.guarded)

  // ── 여기서 멈출 수 있는 지점 (이른 반환 조건) ──
  const gates = findGates(body, code)

  // ── 정리 함수 / 취소 수단 ──
  const hasCleanup = returnsFunction(body)
  const hasAbort = usesAbort(body)

  // ── 위험 판정 ──
  const risk = (isAsync && deferredState.length > 0 && !hasAbort && unguardedDeferred.length > 0)
    ? 'unmount-setstate'
    : null

  const hasGuard = hasAbort || (deferredState.length > 0 && unguardedDeferred.length === 0)

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
    gates,
    setters: setters.map(s => ({ ...s, state: setterToState[s.name] || null })),
    timeline: buildTimeline({
      effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, staleDeps, gates, setterToState,
    }),
  }
}

/**
 * Promise 사슬 메서드 — 콜백이 **응답 이후**에 불립니다.
 * `.then` 만 세면 `fetch().catch(setError)` 처럼 흔한 줄이 통째로 비어 보이고,
 * `.finally(() => setLoading(false))` 는 응답 *전* 에 끄는 것처럼 거꾸로 그려집니다.
 */
const PROMISE_METHODS = new Set(['then', 'catch', 'finally'])

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
 *             - onError : **에러일 때만** 불리는 자리인가 (`.catch(cb)` · `try/catch` ·
 *                         `.then(onOk, onErr)` 의 두 번째 인자). 실행되는 시점은
 *                         응답 뒤로 같지만, **늘 불리는 것은 아니라는** 뜻입니다.
 *             - inIf    : **조건문 가지 안**에 있는가. `guarded` 와 달리 이른 반환
 *                         뒤에 온 것은 세지 않습니다 — 그건 관문(gate)으로 따로 보여
 *                         주므로, 뒤따르는 setter 마다 "조건부" 를 또 붙이면 시끄럽습니다.
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

  function visit(node, deferred, guarded, nested, inIf, onError) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) visit(n, deferred, guarded, nested, inIf, onError)
      return
    }
    if (typeof node.type !== 'string') return

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        // 중첩 함수: 그 함수 본문을 순서대로 다시 훑습니다.
        //            여기서부터의 setter 는 effect 실행 중이 아니라 나중에 불릴 수 있습니다.
        visitFunctionBody(node, deferred, guarded, true, inIf, onError)
        return

      case 'IfStatement':
        visit(node.test, deferred, guarded, nested, inIf, onError)
        visit(node.consequent, deferred, true, nested, true, onError)
        if (node.alternate) visit(node.alternate, deferred, true, nested, true, onError)
        return

      case 'BlockStatement':
        // try 블록 · 그냥 블록 — 함수 본문과 똑같이 문장 순서대로 봅니다.
        visitBlock(node, deferred, guarded, nested, inIf, onError)
        return

      case 'CatchClause':
        // try/catch 의 catch 절도 `.catch(cb)` 와 같은 자리 — 에러일 때만 실행됩니다.
        // 잡은 오류의 이름(`catch (err)`)은 **읽는 값이 아니라 새로 묶는 이름**이라
        // refs 에 넣지 않습니다 — 같은 이름의 상태가 있으면 deps 헛경보가 됩니다.
        visit(node.body, deferred, guarded, nested, inIf, true)
        return

      case 'Identifier':
        // 여기까지 내려온 Identifier 는 "값을 읽는" 자리입니다.
        refs.push({ name: node.name, line: lineOf(node), deferred })
        return

      case 'MemberExpression':
      case 'OptionalMemberExpression':
        // user.id → 읽는 값은 user 뿐, id 는 속성 이름입니다.
        visit(node.object, deferred, guarded, nested, inIf, onError)
        if (node.computed) visit(node.property, deferred, guarded, nested, inIf, onError)
        return

      case 'ObjectProperty':
      case 'Property':
        if (node.computed) visit(node.key, deferred, guarded, nested, inIf, onError)
        visit(node.value, deferred, guarded, nested, inIf, onError)
        return

      case 'ObjectMethod':
        if (node.computed) visit(node.key, deferred, guarded, nested, inIf, onError)
        visitFunctionBody(node, deferred, guarded, true, inIf, onError)
        return

      case 'CallExpression':
      case 'OptionalCallExpression': {
        // .then / .catch / .finally — 콜백은 셋 다 **응답 이후**에 실행됩니다 → deferred
        const method = calleeName(node)
        if (PROMISE_METHODS.has(method)) {
          visit(node.callee, deferred, guarded, nested, inIf, onError)
          node.arguments.forEach((arg, i) => {
            // 에러일 때만 불리는 자리 — `.catch(cb)` 와 `.then(onOk, onErr)` 의 둘째 인자.
            // `.finally` 는 성공·실패 양쪽에서 불리므로 여기 넣지 않습니다.
            const errPath = onError || method === 'catch' || (method === 'then' && i === 1)
            if (isFunctionNode(arg)) {
              visitFunctionBody(arg, true, guarded, true, inIf, errPath)
            } else if (arg.type === 'Identifier' && setterNames.includes(arg.name)) {
              // .then(setUser) · .catch(setError) — 값을 읽는 자리가 아니라,
              // 응답이 오면 그대로 불립니다. 콜백으로 감싼 것과 같은 뜻이라 같게 셉니다.
              found.push({
                name: arg.name, line: lineOf(arg),
                deferred: true, guarded, nested: true, inIf, onError: errPath,
              })
            } else {
              visit(arg, deferred, guarded, nested, inIf, onError)
            }
          })
          return
        }
        // setter 직접 호출
        if (node.callee && node.callee.type === 'Identifier' && setterNames.includes(node.callee.name)) {
          found.push({ name: node.callee.name, line: lineOf(node), deferred, guarded, nested, inIf, onError })
        }
        break
      }
    }

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue
      visit(node[key], deferred, guarded, nested, inIf, onError)
    }
  }

  function visitFunctionBody(fnNode, deferredEntry, guarded, nested, inIf, onError) {
    const body = fnNode.body
    if (!body) return
    if (body.type === 'BlockStatement') {
      visitBlock(body, deferredEntry, guarded, nested, inIf, onError)
    } else {
      // 화살표 축약형 (본문이 식)
      visit(body, deferredEntry || containsDirectAwait(body), guarded, nested, inIf, onError)
    }
  }

  /**
   * 블록 하나를 **문장 순서대로** 훑습니다 — await 를 지나면 그 뒤는 응답 뒤(deferred),
   * 응답 뒤의 이른 반환은 그 뒤를 지키는 가드.
   *
   * 함수 본문뿐 아니라 `try { … }` 같은 **그냥 블록에도 같은 훑기가 필요합니다**.
   * 안 그러면 try 안의 `if (!alive) return` 을 못 봐 헛경보가 납니다.
   */
  function visitBlock(block, deferredEntry, guarded, nested, inIf, onError) {
    let deferred = deferredEntry
    let guardedHere = guarded
    for (const stmt of block.body) {
      const awaitHere = containsDirectAwait(stmt)
      visit(stmt, deferred || awaitHere, guardedHere, nested, inIf, onError)
      if (awaitHere) deferred = true
      // if (!alive) return — 이 뒤의 문장은 조건이 참일 때만 실행됩니다.
      // if (alive) { … } 로 감싼 것과 같은 보호라 똑같이 가드로 봅니다.
      // (inIf 는 올리지 않습니다 — 이 조건은 관문 스텝으로 따로 보여집니다)
      //
      // **응답을 기다린 뒤여야만** 언마운트 가드입니다. `findGates` 가 await 에서 멈추는 것과
      // 같은 경계입니다 — 응답 전의 `if (!id) return` 은 실행을 막는 관문일 뿐,
      // "응답이 온 시점에 아직 살아 있는가" 를 묻지 않으므로 뒤의 setState 를 지키지 못합니다.
      if (deferred && isEarlyReturnGuard(stmt)) guardedHere = true
    }
  }

  visitFunctionBody(effectBody, false, false, false, false, false)
  return { setters: found, refs }
}

/**
 * 이 본문이 **응답을 기다리는가**, 기다린다면 어떤 형태인가.
 *
 * Effect 든 이벤트 핸들러든 묻는 것은 같으므로 한 곳에 둡니다
 * (`chain.js` 가 핸들러를 볼 때 같은 판정을 씁니다).
 *
 * @returns {{isAsync: boolean, asyncKind: 'await'|'.then'|'fetch'|null}}
 */
export function detectAsync(body) {
  let hasAwait = false, hasChain = false, hasFetch = false
  walk(body, (n) => {
    if (n.type === 'AwaitExpression') hasAwait = true
    if (n.type === 'CallExpression') {
      const name = calleeName(n)
      if (PROMISE_METHODS.has(name)) hasChain = true
      if (name === 'fetch') hasFetch = true
    }
  })
  return {
    isAsync: hasAwait || hasChain || hasFetch,
    // `.catch`/`.finally` 만 있어도 Promise 사슬이라 기다리는 구간은 똑같습니다.
    asyncKind: hasAwait ? 'await' : hasChain ? '.then' : hasFetch ? 'fetch' : null,
  }
}

/**
 * `if (…) return` / `if (…) throw` — 뒤의 문장을 지키는 이른 반환 가드인가.
 *
 * 블록 안에 문장이 몇 개든 **마지막이 return/throw 면** 그 뒤는 조건이 거짓일 때만
 * 실행됩니다 — 앞의 문장들은 나가는 길에 하는 일일 뿐이라 개수는 상관이 없습니다.
 *
 *   if (!id) { reset(); return }   // ← 이것도 이른 반환입니다
 *
 * else 가 붙어 있으면 흐름이 갈라지는 것이지 "여기서 끝" 이 아니므로 세지 않습니다.
 */
function isEarlyReturnGuard(stmt) {
  if (!stmt || stmt.type !== 'IfStatement' || stmt.alternate) return false
  return isStop(lastStatement(stmt.consequent))
}

/** if 의 consequent 에서 실제로 흐름을 끝내는 마지막 문장 */
function lastStatement(c) {
  if (!c) return null
  if (c.type !== 'BlockStatement') return c
  return c.body.length ? c.body[c.body.length - 1] : null
}

function isStop(stmt) {
  return !!stmt && (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement')
}

/* ── 조건부 실행: 여기서 멈출 수 있는 지점 ────────────────────────────────────
 *
 * 타임라인이 알약을 죽 늘어놓기만 하면 "언제나 끝까지 간다" 처럼 보입니다.
 * 실제로는 첫 줄에서 되돌아 나가는 effect 가 많습니다:
 *
 *   useEffect(() => {
 *     if (tab !== 'posts') return   // ← 아래는 조건이 거짓일 때만 실행됩니다
 *     fetchPosts().then(setPosts)
 *   }, [tab])
 *
 * 관문으로 **세지 않는** 것 (헛경보를 안 내는 쪽으로):
 *   - **await 뒤의 이른 반환** — `if (!alive) return` 은 실행을 막는 관문이 아니라
 *     응답이 온 뒤의 언마운트 가드입니다. 이미 setter 의 `🛡 가드됨` 으로 보입니다.
 *   - **나중에 불릴 콜백 안** — `setInterval(() => { if (!on) return … })` 은
 *     effect 가 도는 그 순간의 관문이 아닙니다.
 *   - **else 가 붙은 if** — 갈림길일 뿐 "여기서 끝" 이 아닙니다(isEarlyReturnGuard).
 *
 * 반대로 effect 가 돌자마자 실행되는 함수(IIFE · 바로 부르는 로컬 함수) 안의
 * 이른 반환은 본문에 그대로 쓴 것과 같으므로 셉니다 — 비동기 effect 의 흔한 형태입니다.
 */

/** 로컬 함수를 따라 들어가는 깊이 — 곧바로 부르는 한 겹까지만 */
const GATE_MAX_DEPTH = 1

/**
 * @returns {Array<{line:number|null, stop:'return'|'throw', cond:string}>}
 */
export function findGates(effectBody, code) {
  const gates = []
  const seen = new Set()

  function scan(fnNode, depth) {
    if (!fnNode || seen.has(fnNode)) return
    seen.add(fnNode)

    const body = fnNode.body
    if (!body || body.type !== 'BlockStatement') return

    const locals = depth < GATE_MAX_DEPTH ? collectLocalFns(body) : null

    for (const stmt of body.body) {
      // await 를 만나면 그 뒤는 관문이 아니라 "응답 뒤" 입니다 — 여기서 멈춥니다.
      if (containsDirectAwait(stmt)) break

      if (isEarlyReturnGuard(stmt)) {
        gates.push({
          line: lineOf(stmt),
          stop: stopKind(stmt),
          cond: condText(stmt.test, code),
        })
        continue
      }

      if (locals) {
        const called = immediatelyCalledFn(stmt, locals)
        if (called) scan(called, depth + 1)
      }
    }
  }

  scan(effectBody, 0)
  return gates
}

/**
 * 관문 하나를 스텝의 재료로 바꿉니다.
 * ⏱ 타임라인과 ⚡ 이벤트 연쇄가 **같은 문장**을 쓰도록 여기 한 곳에 둡니다.
 */
export function describeGate(g) {
  return {
    label: `${g.cond} 면 ${g.stop === 'throw' ? '오류' : '중단'}`,
    note: '이 조건이 참이면 아래 단계는 실행되지 않습니다',
    line: g.line,
  }
}

/**
 * `if (…) return` 인가 `if (…) throw` 인가.
 * 흐름을 끝내는 건 블록의 **마지막** 문장이라, 첫 문장을 보면
 * `if (x) { log(); throw e }` 를 "중단" 으로 잘못 적습니다.
 */
function stopKind(stmt) {
  const last = lastStatement(stmt.consequent)
  return last && last.type === 'ThrowStatement' ? 'throw' : 'return'
}

/** 이 블록 최상위에 선언된 함수들 — 이름 → 함수 노드 */
function collectLocalFns(block) {
  const map = new Map()
  for (const stmt of block.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      map.set(stmt.id.name, stmt)
    } else if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id && d.id.type === 'Identifier' && isFunctionNode(d.init)) map.set(d.id.name, d.init)
      }
    }
  }
  return map
}

/**
 * 이 문장이 "지금 바로 함수를 부르는" 문장이면 그 함수 노드를 돌려줍니다.
 *   (async () => { … })()   — IIFE
 *   load()                   — 바로 위에서 선언한 로컬 함수
 * 조건문 안이나 콜백으로 넘긴 호출은 여기 오지 않습니다(최상위 문장만 봅니다).
 */
function immediatelyCalledFn(stmt, locals) {
  if (stmt.type !== 'ExpressionStatement') return null
  let expr = stmt.expression
  if (expr && expr.type === 'AwaitExpression') expr = expr.argument
  if (!expr || (expr.type !== 'CallExpression' && expr.type !== 'OptionalCallExpression')) return null

  const callee = expr.callee
  if (isFunctionNode(callee)) return callee
  if (callee && callee.type === 'Identifier' && locals.has(callee.name)) return locals.get(callee.name)
  return null
}

/** 조건식을 사람이 읽는 짧은 문자열로 — 원본을 그대로 잘라 씁니다 */
const COND_MAX_LEN = 32

function condText(node, code) {
  if (!node) return '조건'
  if (typeof code === 'string' && typeof node.start === 'number' && typeof node.end === 'number') {
    const raw = code.slice(node.start, node.end).replace(/\s+/g, ' ').trim()
    if (raw) return raw.length > COND_MAX_LEN ? `${raw.slice(0, COND_MAX_LEN - 1)}…` : raw
  }
  return '조건'
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
function buildTimeline({ effect, isAsync, asyncKind, immediate, deferred, hasCleanup, risk, staleDeps, gates, setterToState }) {
  const steps = []
  const triggerLabel = effect.trigger === 'mount' ? '마운트 시 1회'
    : effect.trigger === 'every-render' ? '매 렌더마다'
    : `deps [${(effect.deps || []).join(', ')}] 변경 시`

  steps.push({ kind: 'trigger', label: triggerLabel })
  steps.push({ kind: 'effect', label: `${effect.hook} 실행`, line: effect.line })

  // 응답을 기다리기 전 구간 — 관문(gate)과 곧바로 부르는 setter 가 섞여 있습니다.
  // 코드에 적힌 차례대로 보여야 "무엇 앞에서 멈추는지" 가 맞으므로 줄 번호로 세웁니다.
  const before = [
    ...gates.map(g => ({ kind: 'gate', ...describeGate(g) })),
    ...immediate.map(s => ({
      kind: 'setter', phase: 'sync',
      label: `${s.name}()`,
      detail: setterToState[s.name] ? `→ ${setterToState[s.name]}` : null,
      conditional: !!s.inIf,
      line: s.line,
    })),
  ].sort((a, b) => (a.line == null ? Infinity : a.line) - (b.line == null ? Infinity : b.line))

  for (const step of before) steps.push(step)

  if (isAsync) {
    const wait = describeWait(effect.body)
    steps.push({
      kind: 'async-wait',
      label: `${asyncKind === '.then' ? 'Promise' : asyncKind} 대기`,
      badges: [asyncKind],
      weight: wait.weight,
      waitMs: wait.ms,
      detail: wait.detail,
    })
    steps.push({ kind: 'resolve', label: '응답 도착' })
    for (const s of deferred) {
      steps.push({
        kind: 'setter', phase: 'async',
        label: `${s.name}()`,
        detail: setterToState[s.name] ? `→ ${setterToState[s.name]}` : null,
        guarded: s.guarded,
        // 응답 뒤라는 점은 같지만 **늘 불리는 것은 아닌** 자리입니다 (.catch · try/catch)
        onError: !!s.onError,
        line: s.line,
      })
    }
  }

  // 바뀌는 상태가 하나도 없으면 리렌더도 없습니다 — fire and forget 인 effect
  // (`fetch('/log')` · `api.track()`)에 "리렌더" 를 적으면 틀린 말이 됩니다.
  if (immediate.length > 0 || deferred.length > 0) {
    steps.push({ kind: 'rerender', label: '리렌더' })
  }

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
export function describeWait(body) {
  let ms = null
  walk(body, (n) => {
    if (n.type !== 'AwaitExpression') return
    const found = maxDelayLiteral(n.argument)
    if (found != null && (ms == null || found > ms)) ms = found
  })
  return {
    ms,
    weight: ms == null ? WAIT_WEIGHT_UNKNOWN : weightForMs(ms),
    detail: ms == null ? '시간 미상' : `≈${formatDuration(ms)}`,
  }
}

/**
 * 이벤트 연쇄(chain.js)도 같은 눈금을 쓰도록, effect 본문을 응답 전/후로 갈라 줍니다.
 *   deferred  — 응답이 온 뒤에야 불리는 setter 이름들
 *   errorOnly — 그중 **에러일 때만** 불리는 이름들 (.catch · try/catch)
 *   wait      — 그 사이 기다리는 구간의 무게/표기 (describeWait 와 같은 값)
 */
export function describeAsyncPhase(body, setterNames) {
  const { setters } = analyzeBody(body, setterNames)
  const immediate = new Set(setters.filter(s => !s.deferred).map(s => s.name))
  return {
    // 응답 **전**에 한 번은 불리는 이름들. 본문이 여럿인 핸들러를 합칠 때 씁니다.
    immediate,
    // 연쇄는 setter 를 **이름 단위**로 나열하므로, 같은 setter 가 응답 전후로 모두
    // 불릴 수 있습니다(setLoading(true) … .then(() => setLoading(false))).
    // 그럴 땐 "응답 전" 으로 봅니다 — 이벤트 직후 곧바로 한 번 바뀌는 것이 사실이니까.
    deferred: new Set(
      setters.filter(s => s.deferred && !immediate.has(s.name)).map(s => s.name)
    ),
    // 연쇄도 이름 단위라, **에러 경로에서만** 바뀌는 상태만 오류 표시를 답니다.
    // 성공 쪽에서도 한 번 불리는 이름이면 "늘 불린다" 가 사실이므로 붙이지 않습니다.
    errorOnly: new Set(
      setters
        .filter(s => s.deferred && s.onError && !immediate.has(s.name))
        .map(s => s.name)
        .filter(name => setters.every(s => s.name !== name || !s.deferred || s.onError))
    ),
    wait: describeWait(body),
  }
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
