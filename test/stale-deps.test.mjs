/**
 * Stale closure 테스트 — "effect 가 읽는데 deps 에는 없는 값" 판정을 고정합니다.
 *
 * 이 검사는 헛경보가 나면 바로 안 믿게 되므로,
 * 잡아야 하는 경우만큼이나 **잡으면 안 되는 경우**를 촘촘히 박아 둡니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'

/** 컴포넌트 하나짜리 코드를 감싸는 틀 */
const wrap = (body) => `import { useState, useEffect, useRef } from 'react'
const API_URL = '/api'

export default function C({ id, onDone }) {
  const [user, setUser] = useState(null)
  const [count, setCount] = useState(0)
  const box = useRef(null)
  const LIMIT = 20
${body}
  return <div onClick={onDone}>{user}</div>
}`

const timingOf = (code, name = 'C') =>
  parseBehavior(code).components.find(c => c.name === name).timing

const staleOf = (body, i = 0) => timingOf(wrap(body))[i].staleDeps
const names = (stale) => stale.map(s => s.name).sort()

test('deps 가 비어 있는데 prop 을 읽으면 빠진 값으로 잡는다', () => {
  const stale = staleOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [])`)
  assert.deepEqual(names(stale), ['id'])
  assert.equal(stale[0].kind, 'prop')
})

test('state 를 읽으면 state 로 잡는다 (setInterval 안의 옛 값)', () => {
  const stale = staleOf(`  useEffect(() => {
    const t = setInterval(() => setCount(count + 1), 1000)
    return () => clearInterval(t)
  }, [])`)
  assert.deepEqual(names(stale), ['count'])
  assert.equal(stale[0].kind, 'state')
})

test('deps 에 들어 있으면 잡지 않는다', () => {
  const stale = staleOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [id])`)
  assert.deepEqual(stale, [])
})

test('deps 배열이 없으면(매 렌더 실행) 검사하지 않는다', () => {
  const stale = staleOf(`  useEffect(() => {
    console.log(id, count)
  })`)
  assert.deepEqual(stale, [], '매 렌더 새로 만들어지므로 옛 값을 붙잡을 일이 없다')
})

test('안 바뀌는 것들은 세지 않는다 — setter · ref · 모듈 상수 · 리터럴 지역 상수', () => {
  const stale = staleOf(`  useEffect(() => {
    setCount(LIMIT)
    box.current = API_URL
  }, [])`)
  assert.deepEqual(stale, [])
})

test('effect 안에서 선언한 이름은 세지 않는다', () => {
  const stale = staleOf(`  useEffect(() => {
    const limit = 5
    function step(n) { return n + limit }
    console.log(step(1))
  }, [])`)
  assert.deepEqual(stale, [])
})

test('멤버 속성 이름은 읽는 값이 아니다 (user.id 의 id)', () => {
  const stale = staleOf(`  useEffect(() => {
    track(user.id)
  }, [user])`)
  assert.deepEqual(stale, [], "prop 'id' 와 이름이 같아도 속성 이름은 참조가 아니다")
})

test('식으로 쓴 deps 는 뿌리 이름으로 인정한다 ([props.id])', () => {
  const code = `import { useEffect } from 'react'
export default function P(props) {
  useEffect(() => {
    load(props.id)
  }, [props.id])
  return null
}`
  assert.deepEqual(timingOf(code, 'P')[0].staleDeps, [])
})

test('await 뒤에서 읽으면 inAsync 로 표시한다', () => {
  const stale = staleOf(`  useEffect(() => {
    async function run() {
      await wait()
      report(count)
    }
    run()
  }, [])`)
  assert.deepEqual(names(stale), ['count'])
  assert.equal(stale[0].inAsync, true, '응답이 온 뒤에 옛 값을 쓰는 쪽이 더 헷갈린다')
})

test('커스텀 훅 안의 effect 는 훅의 스코프로 검사한다', () => {
  const code = `import { useState, useEffect } from 'react'
function useSearch(query) {
  const [hits, setHits] = useState([])
  useEffect(() => {
    search(query).then(setHits)
  }, [])
  return { hits }
}
export function Page() {
  const { hits } = useSearch('a')
  return <ul>{hits}</ul>
}`
  const stale = timingOf(code, 'Page')[0].staleDeps
  assert.deepEqual(names(stale), ['query'], '훅의 인자도 반응값이다')
})

test('타임라인에 stale 스텝이 실려 UI 가 그대로 그릴 수 있다', () => {
  const t = timingOf(wrap(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [])`))[0]
  const step = t.timeline.find(s => s.kind === 'stale')
  assert.ok(step, 'stale 스텝이 있어야 한다')
  assert.deepEqual(step.names, ['id'])
  assert.match(step.label, /id/)
  assert.ok(step.note.length > 0)
})
