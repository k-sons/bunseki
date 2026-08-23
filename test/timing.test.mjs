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
