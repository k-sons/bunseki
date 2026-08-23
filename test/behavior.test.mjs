/**
 * behavior 엔진 테스트 — 이벤트에서 시작하는 상태 변화 연쇄를 고정합니다.
 *
 * 핵심 취지(버튼을 누르면 실제로 무슨 일이 일어나는가)가 회귀하지 않게:
 *   이벤트 → setter → 상태 → deps 일치 Effect 재실행 → 비동기 → setter → 리렌더
 * 그리고 붙여넣은 코드 밖으로 나가는 지점(prop/외부 훅)의 경계 표시.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'

const SAMPLE = `import { useState, useEffect, useCallback } from 'react'
import { fetchUser, fetchPosts } from './api'

function useUser(userId) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    fetchUser(userId).then((data) => { setUser(data); setLoading(false) })
  }, [userId])
  return { user, loading }
}

export default function UserDashboard({ userId, onLogout }) {
  const { user, loading } = useUser(userId)
  const [tab, setTab] = useState('profile')
  const [posts, setPosts] = useState([])

  useEffect(() => {
    if (tab !== 'posts') return
    fetchPosts(userId).then(setPosts)
  }, [tab, userId])

  const handleSelect = useCallback((next) => { setTab(next) }, [])

  return (
    <nav>
      <button onClick={onLogout}>logout</button>
      <button onClick={() => handleSelect('posts')}>posts</button>
    </nav>
  )
}
`

const comp = (b, name) => b.components.find(c => c.name === name)
const stepLabels = (flow) => flow.steps.map(s => s.label)

test('문법이 온전한 코드는 파싱 에러가 없다', () => {
  const b = parseBehavior(SAMPLE)
  assert.equal(b.error, null)
  assert.ok(comp(b, 'UserDashboard'))
})

test('이벤트 → setter → Effect 재실행 → 비동기 → setter → 리렌더 연쇄', () => {
  const b = parseBehavior(SAMPLE)
  const dash = comp(b, 'UserDashboard')

  // 탭 선택 버튼 이벤트를 찾는다
  const tabEvent = dash.events.find(e =>
    e.flows.some(f => stepLabels(f).some(l => l.includes('setTab'))))
  assert.ok(tabEvent, '탭 선택 연쇄를 가진 이벤트가 있어야 한다')

  const labels = stepLabels(tabEvent.flows[0])
  const joined = labels.join(' → ')
  // 순서대로 핵심 스텝이 등장해야 한다
  assert.ok(/handleSelect/.test(joined), 'handleSelect 호출')
  assert.ok(/setTab/.test(joined), 'setTab 상태 변경')
  assert.ok(labels.some(l => /재실행/.test(l)), 'deps 일치 useEffect 재실행')
  assert.ok(/fetchPosts/.test(joined), '비동기 fetchPosts 호출')
  assert.ok(/setPosts/.test(joined), 'setPosts 상태 변경')
  assert.ok(labels.some(l => l.includes('리렌더')), '마지막에 리렌더')
})

test('prop 으로 받은 콜백은 경계로 표시된다', () => {
  const b = parseBehavior(SAMPLE)
  const dash = comp(b, 'UserDashboard')

  const logoutEvent = dash.events.find(e =>
    e.flows.some(f => f.steps.some(s => s.label === 'onLogout')))
  assert.ok(logoutEvent, 'onLogout 이벤트가 있어야 한다')

  const boundary = logoutEvent.flows[0].steps.find(s => s.kind === 'boundary')
  assert.ok(boundary, '경계 스텝이 있어야 한다')
  assert.match(boundary.detail, /prop/)
})

test('같은 파일의 커스텀 훅 상태를 컴포넌트로 끌어온다', () => {
  const b = parseBehavior(SAMPLE)
  const dash = comp(b, 'UserDashboard')
  // useUser 가 관리하는 user 상태가 컴포넌트 상태 목록에 나타나야 한다
  assert.ok(dash.states.some(s => s.state === 'user'),
    'useUser 훅의 user 상태가 컴포넌트로 병합되어야 한다')
})

test('문법 오류 코드는 error 를 돌려주고 throw 하지 않는다', () => {
  const b = parseBehavior('export default function Broken({ ) { return <div>')
  assert.ok(b.error, '에러 객체가 있어야 한다')
  assert.equal(b.components.length, 0)
})


/* ── 이벤트 연쇄의 기다리는 구간 ────────────────────────────────────────────
 * 비동기 Effect 는 "응답 전에 곧바로 바뀌는 상태" 와 "응답 뒤에 바뀌는 상태" 사이에
 * kind:'wait' 스텝이 끼어들어야 합니다. ⏱ 타임라인과 같은 눈금(weight)을 씁니다.
 */

const flowOf = (code, i = 0) => {
  const comp = parseBehavior(code).components.find(c => c.events.length > 0)
  return comp.events[i].flows[0].steps
}

const WAIT_SAMPLE = `import { useState, useEffect } from 'react'
export default function P({ id }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState([])
  useEffect(() => {
    setLoading(true)
    search(q).then((res) => { setItems(res); setLoading(false) })
  }, [q])
  return <input onChange={(e) => setQ(e.target.value)} />
}
`

test('비동기 Effect 안에서 응답 전/후 사이에 대기 스텝이 끼어든다', () => {
  const steps = flowOf(WAIT_SAMPLE)
  const kinds = steps.map(s => s.kind)
  assert.ok(kinds.includes('wait'), '대기 스텝이 있어야 한다')

  const w = kinds.indexOf('wait')
  const labels = steps.map(s => s.label)
  // setLoading(true) 는 응답 전, setItems/setLoading(false) 는 응답 뒤
  assert.ok(labels.indexOf('setLoading()') < w, '곧바로 바뀌는 상태는 대기보다 앞')
  assert.ok(labels.indexOf('setItems()') > w, '응답 뒤에 바뀌는 상태는 대기보다 뒤')
})

test('대기 스텝은 ⏱ 타임라인과 같은 눈금을 쓴다', () => {
  const wait = flowOf(WAIT_SAMPLE).find(s => s.kind === 'wait')
  assert.equal(wait.label, '응답 대기')
  assert.equal(wait.detail, '시간 미상', '네트워크 왕복은 알 수 없다')
  assert.ok(wait.weight > 1 && wait.weight <= 12)
  assert.equal(wait.waitMs, null)
})

test('await 하는 지연 리터럴은 연쇄에서도 읽힌다', () => {
  const steps = flowOf(`import { useState, useEffect } from 'react'
export default function P() {
  const [q, setQ] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    async function run() {
      await sleep(1500)
      setDone(true)
    }
    run()
  }, [q])
  return <input onChange={(e) => setQ(e.target.value)} />
}
`)
  const wait = steps.find(s => s.kind === 'wait')
  assert.equal(wait.waitMs, 1500)
  assert.equal(wait.detail, '≈1.5초')
})

test('동기 Effect 에는 대기 스텝을 넣지 않는다', () => {
  const steps = flowOf(`import { useState, useEffect } from 'react'
export default function P() {
  const [q, setQ] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => { setN(q.length) }, [q])
  return <input onChange={(e) => setQ(e.target.value)} />
}
`)
  assert.equal(steps.filter(s => s.kind === 'wait').length, 0)
})

test('응답 뒤에 바뀌는 상태가 없으면 대기 스텝도 없다', () => {
  // 기다린 뒤에 아무 일도 안 일어나면 보여줄 것이 없습니다 (fire and forget)
  const steps = flowOf(`import { useState, useEffect } from 'react'
export default function P() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(true)
    logSearch(q).then(() => {})
  }, [q])
  return <input onChange={(e) => setQ(e.target.value)} />
}
`)
  assert.equal(steps.filter(s => s.kind === 'wait').length, 0)
})
