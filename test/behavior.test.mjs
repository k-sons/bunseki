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
