/**
 * 타이밍 엔진 테스트 — 비동기 effect 의 "언마운트 후 setState" 위험 판정을 고정합니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'

const wrap = (bodyEffect) => `import { useState, useEffect } from 'react'
export default function C({ id }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
${bodyEffect}
  return <div>{user}</div>
}`

const timingOf = (code) => parseBehavior(wrap(code)).components.find(c => c.name === 'C').timing
const firstAsync = (t) => t.find(e => e.isAsync)

test('.then 콜백의 setState — 가드 없으면 위험', () => {
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [id])`)
  const e = firstAsync(t)
  assert.ok(e, '비동기 effect 로 인식되어야 한다')
  assert.equal(e.asyncKind, '.then')
  assert.equal(e.risk, 'unmount-setstate')
  assert.ok(e.setters.some(s => s.name === 'setUser' && s.deferred))
})

test('await 이후 setState — 가드 없으면 위험', () => {
  const t = timingOf(`  useEffect(() => {
    async function load() {
      const u = await fetchUser(id)
      setUser(u)
    }
    load()
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.risk, 'unmount-setstate')
  assert.ok(e.setters.some(s => s.name === 'setUser' && s.deferred))
})

test('await 이전 setState 는 즉시 실행 — deferred 가 아니다', () => {
  const t = timingOf(`  useEffect(() => {
    async function load() {
      setLoading(true)
      const u = await fetchUser(id)
      setUser(u)
    }
    load()
  }, [id])`)
  const e = firstAsync(t)
  const setLoading = e.setters.find(s => s.name === 'setLoading')
  const setUser = e.setters.find(s => s.name === 'setUser')
  assert.equal(setLoading.deferred, false, 'setLoading(true) 는 await 이전이라 즉시')
  assert.equal(setUser.deferred, true, 'setUser 는 await 이후라 지연')
})

test('alive 가드가 있으면 안전 (위험 없음)', () => {
  const t = timingOf(`  useEffect(() => {
    let alive = true
    fetchUser(id).then((u) => { if (alive) setUser(u) })
    return () => { alive = false }
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.risk, null, 'if (alive) 가드가 있으면 위험 아님')
  assert.equal(e.hasCleanup, true)
  assert.equal(e.hasGuard, true)
})

test('AbortController 로 취소하면 안전', () => {
  const t = timingOf(`  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/u/' + id, { signal: ctrl.signal }).then((u) => setUser(u))
    return () => ctrl.abort()
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.risk, null, 'AbortController 취소가 있으면 위험 아님')
  assert.equal(e.hasGuard, true)
})

test('동기 effect 는 위험이 없다', () => {
  const t = timingOf(`  useEffect(() => {
    setUser(null)
  }, [id])`)
  const e = t.find(x => x.line)
  assert.equal(e.isAsync, false)
  assert.equal(e.risk, null)
})

test('타임라인에 대기→응답→setter→(위험) 순서가 담긴다', () => {
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [id])`)
  const e = firstAsync(t)
  const kinds = e.timeline.map(s => s.kind)
  assert.ok(kinds.indexOf('async-wait') < kinds.indexOf('resolve'), '대기가 응답보다 먼저')
  assert.ok(kinds.includes('rerender'))
  assert.equal(kinds[kinds.length - 1], 'risk', '위험이 마지막 스텝으로 붙는다')
})

test('cleanup 만 있고 가드가 없으면 여전히 위험 (정리≠가드)', () => {
  // 정리 함수가 있어도 그 안에서 setState 를 막지 않으면 위험은 남는다
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
    return () => { console.log('bye') }
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.hasCleanup, true)
  assert.equal(e.risk, 'unmount-setstate')
})

test('중첩 함수 안에서 부르는 setState 는 nested 로 표시된다', () => {
  // effect 본문에서 곧바로 부르는 것과, 콜백·타이머가 나중에 부르는 것을 구분합니다
  const t = timingOf(`  useEffect(() => {
    setLoading(true)
    const timer = setInterval(() => setUser(null), 1000)
    return () => clearInterval(timer)
  }, [id])`)
  const e = t.find(x => x.line)
  assert.equal(e.setters.find(s => s.name === 'setLoading').nested, false)
  assert.equal(e.setters.find(s => s.name === 'setUser').nested, true)
})


/* ── 상대 시간감 (대기 구간의 폭) ───────────────────────────────────────────
 * 타임라인에서 "기다리는 구간" 만 폭을 키웁니다. 실제 ms 는 알 수 없으므로
 * weight 는 상대적인 눈금일 뿐이고, 코드에 지연 리터럴이 보일 때만 ms 를 답니다.
 */

const waitStep = (e) => e.timeline.find(s => s.kind === 'async-wait')

test('네트워크 대기는 폭이 생기되 시간은 미상으로 둔다', () => {
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [id])`)
  const w = waitStep(firstAsync(t))
  assert.ok(w.weight > 1, '즉시 스텝(1)보다는 넓어야 한다')
  assert.equal(w.waitMs, null, '왕복 시간은 코드로 알 수 없다')
  assert.equal(w.detail, '시간 미상')
})

test('await 하는 지연 리터럴은 폭에 반영된다', () => {
  const t = timingOf(`  useEffect(() => {
    async function load() {
      await sleep(2000)
      setUser(await fetchUser(id))
    }
    load()
  }, [id])`)
  const w = waitStep(firstAsync(t))
  assert.equal(w.waitMs, 2000)
  assert.equal(w.detail, '≈2초')
  assert.ok(w.weight > 6, '미상(기본값)보다 무거워야 한다')
})

test('new Promise(setTimeout) 로 감싼 지연도 읽는다', () => {
  const t = timingOf(`  useEffect(() => {
    async function load() {
      await new Promise((r) => setTimeout(r, 300))
      setUser(1)
    }
    load()
  }, [id])`)
  const w = waitStep(firstAsync(t))
  assert.equal(w.waitMs, 300)
  assert.equal(w.detail, '≈300ms')
})

test('await 밖의 타이머는 대기 시간으로 세지 않는다', () => {
  // setInterval 은 effect 가 기다리는 구간이 아니라 나중에 반복될 일입니다.
  const t = timingOf(`  useEffect(() => {
    const timer = setInterval(() => setLoading(false), 1000)
    fetchUser(id).then(setUser)
    return () => clearInterval(timer)
  }, [id])`)
  const w = waitStep(firstAsync(t))
  assert.equal(w.waitMs, null, '타이머 주기를 응답 대기로 오해하면 안 된다')
})

test('아주 긴 지연도 정해진 최대 무게를 넘지 않는다', () => {
  const t = timingOf(`  useEffect(() => {
    async function load() {
      await sleep(600000)
      setUser(1)
    }
    load()
  }, [id])`)
  assert.equal(waitStep(firstAsync(t)).weight, 12, '레이아웃이 깨지지 않도록 상한을 둔다')
})

test('동기 effect 에는 대기 스텝 자체가 없다', () => {
  const t = timingOf(`  useEffect(() => {
    setLoading(true)
  }, [id])`)
  assert.equal(t.filter(e => waitStep(e)).length, 0)
})


test('.then(setUser) 처럼 그대로 넘긴 setter 도 응답 뒤 호출로 센다', () => {
  // 콜백으로 감싼 .then((u) => setUser(u)) 과 같은 뜻입니다.
  // 이 형태를 놓치면 위험 판정·연쇄·Effect 관계가 모두 비어 버립니다.
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  const s = e.setters.find(x => x.name === 'setUser')
  assert.ok(s, '넘긴 setter 를 찾아야 한다')
  assert.equal(s.deferred, true)
  assert.equal(e.risk, 'unmount-setstate', '가드가 있을 수 없는 형태라 위험이 맞다')
})


/* ── 이른 반환 가드 ─────────────────────────────────────────────────────────
 * if (alive) { setUser(u) } 만 가드로 보면, 훨씬 흔한
 * if (!alive) return 형태를 헛경보로 올립니다.
 */

test('if (!alive) return 뒤의 setState 는 가드된 것으로 본다', () => {
  const t = timingOf(`  useEffect(() => {
    let alive = true
    fetchUser(id).then((u) => {
      if (!alive) return
      setUser(u)
      setLoading(false)
    })
    return () => { alive = false }
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.risk, null, '헛경보를 내면 안 된다')
  assert.equal(e.hasGuard, true)
  assert.ok(e.setters.filter(s => s.deferred).every(s => s.guarded))
})

test('else 가 붙으면 이른 반환이 아니라 갈림길이다', () => {
  // if (x) return; 은 "여기서 끝" 이지만 if (x) …; else … 는 흐름이 갈릴 뿐입니다
  const t = timingOf(`  useEffect(() => {
    fetchUser(id).then((u) => {
      if (!u) { setUser(null) } else { log(u) }
      setLoading(false)
    })
  }, [id])`)
  const e = firstAsync(t)
  const late = e.setters.find(s => s.name === 'setLoading')
  assert.equal(late.guarded, false, 'else 가 있으면 뒤 문장을 지키지 못한다')
  assert.equal(e.risk, 'unmount-setstate')
})


/* ── 조건부 실행: 관문(gate) ─────────────────────────────────────────────────
 * 타임라인이 알약을 죽 늘어놓기만 하면 "언제나 끝까지 간다" 처럼 보입니다.
 * 첫 줄에서 되돌아 나가는 effect 를 "여기서 멈출 수 있음" 으로 그리기 위한 재료.
 */

const gatesOf = (code) => firstAsync(timingOf(code)).gates
const gateSteps = (e) => e.timeline.filter(s => s.kind === 'gate')

test('이른 반환 조건을 관문으로 잡고, 조건식을 원본 그대로 보여준다', () => {
  const t = timingOf(`  useEffect(() => {
    if (!id) return
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.gates.length, 1)
  assert.equal(e.gates[0].cond, '!id')
  assert.equal(e.gates[0].stop, 'return')
  assert.equal(gateSteps(e)[0].label, '!id 면 중단')
})

test('비교식도 그대로 — if (tab !== \'posts\') return', () => {
  const g = gatesOf(`  useEffect(() => {
    if (tab !== 'posts') return
    fetchUser(id).then(setUser)
  }, [id])`)
  assert.equal(g.length, 1)
  assert.equal(g[0].cond, "tab !== 'posts'")
})

test('throw 로 끝나는 관문은 중단이 아니라 오류로 적는다', () => {
  const t = timingOf(`  useEffect(() => {
    if (!id) throw new Error('id required')
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.gates[0].stop, 'throw')
  assert.equal(gateSteps(e)[0].label, '!id 면 오류')
})

test('곧바로 부르는 로컬 함수 안의 이른 반환도 관문이다', () => {
  const g = gatesOf(`  useEffect(() => {
    async function load() {
      if (!id) return
      const u = await fetchUser(id)
      setUser(u)
    }
    load()
  }, [id])`)
  assert.equal(g.length, 1)
  assert.equal(g[0].cond, '!id')
})

test('IIFE 안의 이른 반환도 관문이다', () => {
  const g = gatesOf(`  useEffect(() => {
    ;(async () => {
      if (!id) return
      const u = await fetchUser(id)
      setUser(u)
    })()
  }, [id])`)
  assert.equal(g.length, 1)
})

test('관문은 코드에 적힌 차례대로, 즉시 setter 와 섞여 놓인다', () => {
  const t = timingOf(`  useEffect(() => {
    setLoading(true)
    if (!id) return
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  const kinds = e.timeline
    .filter(s => s.kind === 'setter' || s.kind === 'gate')
    .map(s => s.kind)
  assert.deepEqual(kinds, ['setter', 'gate', 'setter'], 'setLoading → 관문 → setUser')
})

/* ── 나가는 길에 뭔가 하고 나가는 이른 반환 ─────────────────────────────────
 * 흐름을 끝내는 건 블록의 **마지막** 문장입니다. 앞에 문장이 몇 개 더 있어도
 * 그 뒤는 여전히 조건이 거짓일 때만 실행됩니다.
 */

test('블록에 문장이 여럿이어도 마지막이 return 이면 관문이다', () => {
  const t = timingOf(`  useEffect(() => {
    if (!id) { reset(); return }
    fetchPosts(id).then(setPosts)
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.gates.length, 1, '나가는 길에 reset() 을 부른다고 관문이 아닌 게 아니다')
  assert.equal(e.gates[0].cond, '!id')
  assert.equal(e.gates[0].stop, 'return')
  assert.equal(gateSteps(e)[0].label, '!id 면 중단')
})

test('마지막 문장이 throw 면 중단이 아니라 오류로 적는다', () => {
  // 첫 문장만 보면 log() 를 보고 "중단" 으로 잘못 적습니다.
  const t = timingOf(`  useEffect(() => {
    if (!id) { log('no id'); throw new Error('id required') }
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.gates.length, 1)
  assert.equal(e.gates[0].stop, 'throw')
  assert.equal(gateSteps(e)[0].label, '!id 면 오류')
})

test('마지막 문장이 return 이 아니면 관문이 아니다', () => {
  const g = gatesOf(`  useEffect(() => {
    if (!id) { return; }
    if (stale) { cleanup(); log('done') }
    fetchUser(id).then(setUser)
  }, [id])`)
  assert.equal(g.length, 1, '나가지 않는 if 는 그냥 조건문일 뿐이다')
  assert.equal(g[0].cond, '!id')
})

test('문장이 여럿인 이른 반환 뒤의 setState 도 가드된 것으로 본다', () => {
  const t = timingOf(`  useEffect(() => {
    let alive = true
    fetchUser(id).then((u) => {
      if (!alive) { cleanup(); return }
      setUser(u)
    })
    return () => { alive = false }
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.risk, null, '실제로 지켜지고 있으므로 헛경보다')
  assert.ok(e.setters.filter(s => s.deferred).every(s => s.guarded))
})


/* ── 관문으로 잡으면 안 되는 것 (헛경보 방지) ─────────────────────────────── */

test('await 뒤의 if (!alive) return 은 관문이 아니라 언마운트 가드다', () => {
  const t = timingOf(`  useEffect(() => {
    let alive = true
    async function load() {
      const u = await fetchUser(id)
      if (!alive) return
      setUser(u)
    }
    load()
    return () => { alive = false }
  }, [id])`)
  const e = firstAsync(t)
  assert.equal(e.gates.length, 0, '응답을 기다린 뒤의 조건은 실행을 막는 관문이 아니다')
  assert.equal(e.hasGuard, true, '가드로는 이미 세고 있다')
})

test('나중에 불릴 콜백 안의 이른 반환은 관문이 아니다', () => {
  const g = gatesOf(`  useEffect(() => {
    const t = setInterval(() => {
      if (!enabled) return
      setLoading(true)
    }, 1000)
    fetchUser(id).then(setUser)
    return () => clearInterval(t)
  }, [id])`)
  assert.equal(g.length, 0, 'effect 가 도는 그 순간의 관문이 아니다')
})

test('else 가 붙은 if 는 관문이 아니다', () => {
  const g = gatesOf(`  useEffect(() => {
    if (!id) { return } else { log(id) }
    fetchUser(id).then(setUser)
  }, [id])`)
  assert.equal(g.length, 0)
})

test('조건이 없는 effect 에는 관문 스텝이 없다', () => {
  const e = firstAsync(timingOf(`  useEffect(() => {
    fetchUser(id).then(setUser)
  }, [id])`))
  assert.equal(e.gates.length, 0)
  assert.equal(gateSteps(e).length, 0)
})

/* ── 조건문 안의 setter 는 "조건부" 로 표시 ───────────────────────────────── */

test('if 안에서 부르는 즉시 setter 는 조건부로 표시된다', () => {
  const t = timingOf(`  useEffect(() => {
    if (id) setLoading(true)
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  const step = e.timeline.find(s => s.kind === 'setter' && s.label === 'setLoading()')
  assert.equal(step.conditional, true)
})

test('관문 뒤에 온 setter 는 조건부로 또 표시하지 않는다', () => {
  // 멈출 수 있다는 것은 관문 알약이 이미 말합니다 — setter 마다 또 붙이면 시끄럽습니다.
  const t = timingOf(`  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetchUser(id).then(setUser)
  }, [id])`)
  const e = firstAsync(t)
  const step = e.timeline.find(s => s.kind === 'setter' && s.label === 'setLoading()')
  assert.equal(step.conditional, false)
})


/* ── Promise 사슬의 나머지 — .catch / .finally ─────────────────────────────
 *
 * `.then` 만 세면 가장 흔한 한 줄이 거꾸로 그려집니다:
 *   fetchIt().then(setData).catch(setError).finally(() => setLoading(false))
 * → setError 는 통째로 사라지고, 로딩을 끄는 자리가 응답 **전** 으로 갑니다.
 */

const wrapErr = (bodyEffect) => `import { useState, useEffect } from 'react'
export default function E({ id }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
${bodyEffect}
  return <div>{data}</div>
}`

const errTiming = (code) =>
  parseBehavior(wrapErr(code)).components.find(c => c.name === 'E').timing.find(e => e.isAsync)

/** 타임라인에서 '응답 도착' 뒤에 오는 setter 스텝만 */
const afterResolve = (e) => {
  const i = e.timeline.findIndex(s => s.kind === 'resolve')
  return e.timeline.slice(i + 1).filter(s => s.kind === 'setter')
}

test('.catch(setError) 도 응답 뒤에 불리는 setter 로 센다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).then(setData).catch(setError)
  }, [id])`)
  const names = afterResolve(e).map(s => s.label)
  assert.deepEqual(names, ['setData()', 'setError()'])
  assert.ok(e.setters.some(s => s.name === 'setError' && s.deferred))
})

test('.finally 의 setter 는 응답 뒤로 간다 — 로딩 끄는 자리가 앞으로 오면 거꾸로다', () => {
  const e = errTiming(`  useEffect(() => {
    setLoading(true)
    fetchIt(id).then(setData).catch(setError).finally(() => setLoading(false))
  }, [id])`)
  const before = e.timeline
    .slice(0, e.timeline.findIndex(s => s.kind === 'async-wait'))
    .filter(s => s.kind === 'setter')
  assert.deepEqual(before.map(s => s.label), ['setLoading()'], '응답 전 setLoading 은 한 번뿐')
  assert.deepEqual(
    afterResolve(e).map(s => s.label),
    ['setData()', 'setError()', 'setLoading()'],
    '끄는 자리는 응답 뒤'
  )
})

test('.catch 만 있어도 Promise 사슬이라 기다리는 구간이 있다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).catch(setError)
  }, [id])`)
  assert.ok(e, '비동기 effect 로 인식되어야 한다')
  assert.equal(e.asyncKind, '.then')
  assert.ok(e.timeline.some(s => s.kind === 'async-wait'))
})

test('에러일 때만 불리는 setter 에는 오류 표시가 붙는다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).then(setData).catch(setError)
  }, [id])`)
  const byName = Object.fromEntries(afterResolve(e).map(s => [s.label, s]))
  assert.equal(byName['setError()'].onError, true)
  assert.equal(byName['setData()'].onError, false, '성공 쪽에는 붙지 않는다')
})

test('.finally 는 성공·실패 양쪽에서 불리므로 오류 표시가 아니다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).then(setData).finally(() => setLoading(false))
  }, [id])`)
  const step = afterResolve(e).find(s => s.label === 'setLoading()')
  assert.equal(step.onError, false)
})

test('.then(onOk, onErr) 는 둘째 인자만 오류 경로다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).then(setData, setError)
  }, [id])`)
  const byName = Object.fromEntries(afterResolve(e).map(s => [s.label, s]))
  assert.equal(byName['setData()'].onError, false)
  assert.equal(byName['setError()'].onError, true)
})

test('try/catch 의 catch 절도 .catch 와 같은 오류 경로다', () => {
  const e = errTiming(`  useEffect(() => {
    (async () => {
      try { const d = await fetchIt(id); setData(d) }
      catch (err) { setError(err) }
      finally { setLoading(false) }
    })()
  }, [id])`)
  const byName = Object.fromEntries(afterResolve(e).map(s => [s.label, s]))
  assert.equal(byName['setError()'].onError, true)
  assert.equal(byName['setData()'].onError, false)
  assert.equal(byName['setLoading()'].onError, false, 'finally 절은 양쪽에서 불린다')
})

test('.catch 의 setState 도 가드가 없으면 언마운트 위험이다', () => {
  const e = errTiming(`  useEffect(() => {
    fetchIt(id).catch(setError)
  }, [id])`)
  assert.equal(e.risk, 'unmount-setstate')
})

test('.catch 안에서도 가드가 있으면 위험이 아니다', () => {
  const e = errTiming(`  useEffect(() => {
    let alive = true
    fetchIt(id).catch((err) => { if (alive) setError(err) })
    return () => { alive = false }
  }, [id])`)
  assert.equal(e.risk, null)
})
