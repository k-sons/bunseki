/**
 * 두 축(화면 · 동작 흐름) 분류 — 기존 연쇄 스텝을 갈라 놓는 규칙만 고정합니다.
 *
 * 엔진이 만드는 steps 는 그대로입니다. 시간별 값 스냅샷은 여기서 다루지 않습니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'
import { railOf, meshCaption, idleCaption, toRailRows } from '../src/core/behavior/rails.js'

const SAMPLE = `import { useState, useEffect, useCallback } from 'react'
import { fetchPosts } from './api'

export default function UserDashboard({ userId, onLogout }) {
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

test('빈 입력은 빈 행', () => {
  assert.deepEqual(toRailRows(null), [])
  assert.deepEqual(toRailRows([]), [])
})

test('모르는 kind 는 동작 흐름 쪽으로', () => {
  assert.equal(railOf(null), 'flow')
  assert.equal(railOf({}), 'flow')
  assert.equal(railOf({ kind: 'nope' }), 'flow')
})

test('kind 별 레일', () => {
  assert.equal(railOf({ kind: 'event' }), 'screen')
  assert.equal(railOf({ kind: 'rerender' }), 'screen')
  assert.equal(railOf({ kind: 'setter' }), 'mesh')
  assert.equal(railOf({ kind: 'call' }), 'flow')
  assert.equal(railOf({ kind: 'effect' }), 'flow')
  assert.equal(railOf({ kind: 'wait' }), 'flow')
  assert.equal(railOf({ kind: 'gate' }), 'flow')
  assert.equal(railOf({ kind: 'boundary' }), 'flow')
})

test('맞물림 캡션은 상태 이름을 고른다', () => {
  assert.equal(meshCaption({ kind: 'call' }), null)
  assert.equal(meshCaption({ kind: 'setter', detail: '→  tab' }), 'tab 변경')
  assert.equal(meshCaption({ kind: 'setter', detail: '→  posts' }), 'posts 변경')
  assert.equal(meshCaption({ kind: 'setter', detail: null }), '상태 변경')
  assert.equal(meshCaption({ kind: 'setter' }), '상태 변경')
})

test('탭 선택 연쇄는 화면·동작·맞물림이 시간순으로 갈린다', () => {
  const b = parseBehavior(SAMPLE)
  const dash = b.components.find(c => c.name === 'UserDashboard')
  const tabEvent = dash.events.find(e =>
    e.flows.some(f => f.steps.some(s => s.label.includes('setTab'))))
  const rows = toRailRows(tabEvent.flows[0].steps)
  const pair = rows.map(r => `${r.step.kind}:${r.rail}`)

  assert.equal(rows[0].step.kind, 'event')
  assert.equal(rows[0].rail, 'screen')
  assert.ok(pair.includes('call:flow'), '함수 호출은 동작 흐름')
  assert.ok(pair.includes('effect:flow'), 'Effect 는 동작 흐름')
  assert.ok(pair.includes('wait:flow'), '대기도 동작 흐름 (비동기 전용이 아님)')
  assert.ok(pair.includes('gate:flow'), '관문은 동작 흐름')
  assert.ok(rows.filter(r => r.step.kind === 'setter').every(r => r.rail === 'mesh'))
  const last = rows[rows.length - 1]
  assert.equal(last.step.kind, 'rerender')
  assert.equal(last.rail, 'screen')
})

test('prop 경계는 동작 흐름 쪽 (따라갈 수 없는 제어)', () => {
  const b = parseBehavior(SAMPLE)
  const dash = b.components.find(c => c.name === 'UserDashboard')
  const logout = dash.events.find(e =>
    e.flows.some(f => f.steps.some(s => s.kind === 'boundary')))
  const rows = toRailRows(logout.flows[0].steps)
  const boundary = rows.find(r => r.step.kind === 'boundary')
  assert.ok(boundary)
  assert.equal(boundary.rail, 'flow')
  assert.equal(rows[0].rail, 'screen')
})

test('스텝 배열은 갈라 놓아도 길이와 순서가 같다', () => {
  const b = parseBehavior(SAMPLE)
  const flow = b.components.find(c => c.name === 'UserDashboard').events[0].flows[0]
  const rows = toRailRows(flow.steps)
  assert.equal(rows.length, flow.steps.length)
  rows.forEach((r, i) => {
    assert.equal(r.step, flow.steps[i])
    assert.equal(r.index, i)
  })
})

test('빈 칸 문구 — 흐름만 움직이면 화면 유지, 화면만 움직이면 흐름 대기', () => {
  assert.equal(idleCaption('flow'), '화면 유지')
  assert.equal(idleCaption('screen'), '흐름 대기')
  assert.equal(idleCaption('mesh'), null)
  assert.equal(idleCaption(null), null)

  const b = parseBehavior(SAMPLE)
  const dash = b.components.find(c => c.name === 'UserDashboard')
  const tabEvent = dash.events.find(e =>
    e.flows.some(f => f.steps.some(s => s.label.includes('setTab'))))
  const rows = toRailRows(tabEvent.flows[0].steps)

  const wait = rows.find(r => r.step.kind === 'wait')
  assert.ok(wait)
  assert.equal(wait.rail, 'flow')
  assert.equal(idleCaption(wait.rail), '화면 유지')

  const event = rows.find(r => r.step.kind === 'event')
  assert.equal(event.rail, 'screen')
  assert.equal(idleCaption(event.rail), '흐름 대기')

  const setter = rows.find(r => r.step.kind === 'setter')
  assert.equal(setter.rail, 'mesh')
  assert.equal(idleCaption(setter.rail), null)
})
