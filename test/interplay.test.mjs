/**
 * Effect 사이 관계 테스트 — 연쇄 · 무한 루프 · 경합 판정을 고정합니다.
 *
 * 오탐 정책은 stale-deps 와 같습니다: "잡으면 안 되는 것" 을 먼저 지킵니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'

const wrap = (body) => `import { useState, useEffect } from 'react'
export default function C({ id, q }) {
  const [user, setUser] = useState(null)
  const [count, setCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
${body}
  return <div>{user}{count}{x}{y}</div>
}`

const interplayOf = (body) =>
  parseBehavior(wrap(body)).components.find(c => c.name === 'C').interplay

const kinds = (list) => list.map(f => f.kind)

// ─────────────────────────── 연쇄 ───────────────────────────

test('A 가 바꾼 상태를 B 가 deps 로 쓰면 연쇄로 잡는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setUser({ id })
  }, [id])

  useEffect(() => {
    console.log(user)
  }, [user])`)

  const cascade = found.find(f => f.kind === 'cascade')
  assert.ok(cascade, '연쇄가 하나 나와야 한다')
  assert.deepEqual(cascade.lines, [8, 12], 'setUser 하는 effect → user 를 deps 로 쓰는 effect')
  assert.equal(cascade.severity, 'info')
  assert.deepEqual(
    cascade.steps.map(s => s.kind),
    ['effect', 'setter', 'effect'],
    'Effect → setter → 재실행 순서로 그린다'
  )
})

test('연쇄는 세 단계까지 이어 붙는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setUser({ id })
  }, [id])

  useEffect(() => {
    setCount(1)
  }, [user])

  useEffect(() => {
    console.log(count)
  }, [count])`)

  const cascade = found.find(f => f.kind === 'cascade')
  assert.ok(cascade)
  assert.deepEqual(cascade.lines, [8, 12, 16], '한 줄로 이어진 연쇄는 하나로 묶는다')
})

test('deps 가 없는(마운트 1회) Effect 는 연쇄로 이어지지 않는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setUser({ id })
  }, [id])

  useEffect(() => {
    console.log(user)
  }, [])`)

  assert.equal(found.filter(f => f.kind === 'cascade').length, 0)
})

// ────────────────────────── 무한 루프 ──────────────────────────

test('deps 로 쓰는 상태를 스스로 바꾸면 무한 루프 위험', () => {
  const found = interplayOf(`  useEffect(() => {
    setCount(count + 1)
  }, [count])`)

  const loop = found.find(f => f.kind === 'loop')
  assert.ok(loop, '자기 자신을 되부르는 고리를 잡아야 한다')
  assert.equal(loop.severity, 'risk')
  assert.deepEqual(loop.lines, [8])
  assert.equal(loop.steps[loop.steps.length - 1].kind, 'loopback', '마지막에 처음으로 돌아가는 표시')
})

test('조건문 안에서 바꾸면 루프이되 위험도는 낮춘다', () => {
  const found = interplayOf(`  useEffect(() => {
    if (!ready) setReady(true)
  }, [ready])`)

  const loop = found.find(f => f.kind === 'loop')
  assert.ok(loop)
  assert.equal(loop.severity, 'warn', '조건이 거짓이 되면 멈추므로 경고 수준')
})

test('두 Effect 가 서로 되받으면 고리로 잡는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setX(1)
  }, [y])

  useEffect(() => {
    setY(2)
  }, [x])`)

  const loops = found.filter(f => f.kind === 'loop')
  assert.equal(loops.length, 1, '같은 고리를 두 번 세지 않는다')
  assert.deepEqual(loops[0].lines, [8, 12])
  assert.equal(loops[0].severity, 'risk')
})

test('고리를 이루는 간선은 연쇄로 중복해 보고하지 않는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setX(1)
  }, [y])

  useEffect(() => {
    setY(2)
  }, [x])`)

  assert.deepEqual(kinds(found), ['loop'], '고리 하나만 남는다')
})

// ─────────────────────────── 경합 ───────────────────────────

test('같은 상태를 두 Effect 가 바꾸면 경합으로 알린다', () => {
  const found = interplayOf(`  useEffect(() => {
    setUser({ id })
  }, [id])

  useEffect(() => {
    setUser({ q })
  }, [q])`)

  const race = found.find(f => f.kind === 'contention')
  assert.ok(race)
  assert.equal(race.severity, 'info', '둘 다 동기면 선언 순서대로라 정보 수준')
  assert.deepEqual(race.lines, [8, 12])
  assert.ok(race.label.includes('user'))
})

test('경합하는 쪽이 비동기면 위험으로 올린다', () => {
  const found = interplayOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  }, [id])

  useEffect(() => {
    setUser({ q })
  }, [q])`)

  const race = found.find(f => f.kind === 'contention')
  assert.ok(race)
  assert.equal(race.severity, 'risk', '응답 순서에 따라 결과가 뒤바뀔 수 있다')
  assert.ok(race.steps.some(s => s.phase === 'async'))
})

test('한 Effect 가 같은 상태를 두 번 바꾸는 것은 경합이 아니다', () => {
  const found = interplayOf(`  useEffect(() => {
    setCount(0)
    setCount(1)
  }, [id])`)

  assert.equal(found.filter(f => f.kind === 'contention').length, 0)
})

// ──────────────────── 잡으면 안 되는 것 ────────────────────

test('서로 다른 상태를 건드리는 Effect 들은 아무것도 보고하지 않는다', () => {
  const found = interplayOf(`  useEffect(() => {
    setUser({ id })
  }, [id])

  useEffect(() => {
    setCount(1)
  }, [q])`)

  assert.deepEqual(found, [])
})

test('deps 에 없는 상태를 바꾸는 것만으로는 루프가 아니다', () => {
  const found = interplayOf(`  useEffect(() => {
    setCount(1)
  }, [id])`)

  assert.deepEqual(found, [])
})

test('Effect 가 하나도 없으면 빈 배열', () => {
  const found = interplayOf('  const noop = () => setCount(1)')
  assert.deepEqual(found, [])
})

// ─────────────────── deps 배열이 없는 Effect ───────────────────

test('deps 배열이 없는 Effect 가 상태를 바꾸면 무한 루프 위험', () => {
  const found = interplayOf(`  useEffect(() => {
    setCount(count + 1)
  })`)

  const loop = found.find(f => f.kind === 'loop')
  assert.ok(loop, '매 렌더 재실행 + 상태 변경 = 고리')
  assert.equal(loop.severity, 'risk')
  assert.deepEqual(loop.lines, [8])
  assert.ok(loop.label.includes('deps 배열이 없어'))
  assert.equal(loop.steps[loop.steps.length - 1].kind, 'loopback')
})

test('deps 배열이 없어도 조건문 안이면 위험도를 낮춘다', () => {
  const found = interplayOf(`  useEffect(() => {
    if (!ready) setReady(true)
  })`)

  const loop = found.find(f => f.kind === 'loop')
  assert.ok(loop)
  assert.equal(loop.severity, 'warn')
})

test('타이머·콜백 안에서만 바꾸는 것은 매 렌더 루프가 아니다', () => {
  // effect 가 도는 그 순간에 실행되는 것이 아니라 나중에 불립니다
  const found = interplayOf(`  useEffect(() => {
    const t = setInterval(() => setCount(1), 1000)
    return () => clearInterval(t)
  })`)

  assert.deepEqual(found, [])
})

test('비동기 응답 뒤에만 바꾸는 것도 매 렌더 루프로 세지 않는다', () => {
  const found = interplayOf(`  useEffect(() => {
    fetchUser(id).then((u) => setUser(u))
  })`)

  assert.deepEqual(found.filter(f => f.kind === 'loop'), [])
})

test('deps 가 빈 배열([])이면 마운트 1회라 루프가 아니다', () => {
  const found = interplayOf(`  useEffect(() => {
    setCount(1)
  }, [])`)

  assert.deepEqual(found, [])
})

test('deps 배열이 없어도 상태를 안 바꾸면 아무 말 하지 않는다', () => {
  const found = interplayOf(`  useEffect(() => {
    console.log(count)
  })`)

  assert.deepEqual(found, [])
})
