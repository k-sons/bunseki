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
