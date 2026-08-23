/**
 * 커스텀 훅 경계 — 스텝마다 붙는 `hook` 을 고정합니다.
 *
 * 잘 짜인 React 코드일수록 상태와 Effect 가 컴포넌트가 아니라 커스텀 훅 안에 삽니다.
 * 연쇄를 죽 늘어놓기만 하면 그 둘이 같은 자리에 있는 것처럼 보이므로,
 * 스텝마다 "이건 어느 훅 안에서 일어나는가" 를 달아 UI 가 구역으로 묶게 합니다.
 *
 * 여기서 지키는 것:
 *   - 훅이 관리하는 상태 · 훅 안의 Effect 와 그 안의 모든 일 → 그 훅 이름
 *   - 이벤트 · 리렌더 · 컴포넌트 자신의 상태          → null (구역 밖)
 *   - 이름을 바꿔 받았으면 훅 안에서 부르는 이름도 함께
 *   - 다른 파일에서 import 한 훅은 구역이 아니라 **경계**로 남는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBehavior } from '../src/core/behavior/index.js'

const SAMPLE = `import { useState, useEffect } from 'react'

function useSearch() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState([])
  useEffect(() => {
    search(query).then(setHits)
  }, [query])
  return { query, setQuery, hits }
}

function useToggle() {
  const [on, setOn] = useState(false)
  return [on, setOn]
}

export default function Panel() {
  const { setQuery, hits } = useSearch()
  const [open, toggle] = useToggle()
  const [tab, setTab] = useState('a')
  return (
    <div>
      <input onChange={(e) => setQuery(e.target.value)} />
      <button onClick={() => toggle(true)}>t</button>
      <button onClick={() => setTab('b')}>b</button>
    </div>
  )
}
`

const panel = (code = SAMPLE) =>
  parseBehavior(code).components.find(c => c.name === 'Panel')

/** 라벨로 스텝 하나를 집습니다 */
const stepBy = (steps, label) => steps.find(s => s.label === label)

/** 이벤트 하나의 첫 흐름 */
const flowOf = (comp, label) =>
  comp.events.find(e => e.flows.some(f => stepBy(f.steps, label)))
    .flows.find(f => stepBy(f.steps, label)).steps

test('훅이 관리하는 상태의 setter 는 그 훅 구역에 놓인다', () => {
  const steps = flowOf(panel(), 'setQuery()')
  const setter = stepBy(steps, 'setQuery()')

  assert.equal(setter.hook, 'useSearch')
  assert.equal(setter.hookLine, 3, '훅 선언 줄로 이동할 수 있어야 한다')
})

test('훅 안의 Effect 와 그 안에서 일어나는 일은 모두 같은 구역이다', () => {
  const steps = flowOf(panel(), 'setQuery()')

  const inHook = steps.filter(s => s.hook === 'useSearch').map(s => s.kind)
  // setter → Effect 재실행 → 호출 → 응답 대기 → 응답 뒤 setter 까지 한 구역
  assert.deepEqual(inHook, ['setter', 'effect', 'call', 'wait', 'setter'])

  // 구역이 중간에 끊기지 않아야 UI 가 상자 하나로 묶을 수 있다
  const first = steps.findIndex(s => s.hook === 'useSearch')
  const last = steps.map(s => s.hook).lastIndexOf('useSearch')
  for (let i = first; i <= last; i++) {
    assert.equal(steps[i].hook, 'useSearch', `L${i} 스텝이 구역을 끊는다`)
  }
})

test('이벤트와 리렌더는 훅 구역 밖이다 — 흐름이 훅에서 나온다', () => {
  const steps = flowOf(panel(), 'setQuery()')

  assert.equal(steps[0].kind, 'event')
  assert.equal(steps[0].hook, null, '이벤트는 컴포넌트에서 일어난다')

  const last = steps[steps.length - 1]
  assert.equal(last.kind, 'rerender')
  assert.equal(last.hook, null, '리렌더에서 다시 컴포넌트로 나온다')
})

test('컴포넌트 자신의 상태 흐름에는 훅 구역이 없다', () => {
  const steps = flowOf(panel(), 'setTab()')
  assert.ok(steps.every(s => !s.hook), '전부 컴포넌트 구역이어야 한다')
})

test('이름을 바꿔 받으면 훅 안에서 부르는 이름도 알려준다', () => {
  const setter = stepBy(flowOf(panel(), 'toggle()'), 'toggle()')

  assert.equal(setter.hook, 'useToggle')
  assert.equal(setter.hookLine, 12)
  // 훅 코드를 열면 toggle 이 아니라 setOn 을 찾아야 한다
  assert.equal(setter.hookInternal, 'setOn')
})

test('이름이 같으면 훅 안 이름을 군더더기로 붙이지 않는다', () => {
  const setter = stepBy(flowOf(panel(), 'setQuery()'), 'setQuery()')
  assert.equal(setter.hookInternal, null)
})

test('훅 안에서만 쓰는 상태도 어느 훅 것인지 남는다', () => {
  const comp = panel()

  const hits = comp.states.find(s => s.setter === 'setHits')
  assert.equal(hits.viaHook, 'useSearch')
  assert.equal(hits.hookLine, 3)
  assert.equal(hits.internalOnly, true, '컴포넌트에서 직접 부를 수 없는 상태')

  const query = comp.states.find(s => s.setter === 'setQuery')
  assert.ok(!query.internalOnly, '훅이 내보낸 setter 는 컴포넌트에서 부른다')
})

test('상태 요약의 Effect 도 어느 훅 안에 있는지 전한다', () => {
  const effect = panel().effects.find(e => e.line === 6)
  assert.equal(effect.viaHook, 'useSearch')
})

/* ── 잡으면 안 되는 것 ─────────────────────────────────────────────────────
 * 붙여넣은 코드 안에 없는 훅은 구역으로 그릴 수 없습니다 —
 * 안을 못 보는데 상자를 치면 "따라가 봤다" 는 거짓말이 됩니다.
 */

test('import 한 훅은 구역이 아니라 경계로 남는다', () => {
  const comp = panel(`import { useState } from 'react'
import { useCart } from './cart'

export default function Panel() {
  const { addItem } = useCart()
  return <button onClick={() => addItem(1)}>add</button>
}
`)

  const steps = comp.events[0].flows[0].steps
  assert.ok(steps.every(s => !s.hook), '따라갈 수 없는 훅에는 구역을 치지 않는다')

  const boundary = steps.find(s => s.kind === 'boundary')
  assert.ok(boundary, '대신 경계 스텝으로 알린다')
  assert.match(boundary.detail, /useCart/)
})

test('컴포넌트가 부르는 훅이 없으면 아무 스텝에도 훅이 붙지 않는다', () => {
  const comp = panel(`import { useState, useEffect } from 'react'

export default function Panel() {
  const [n, setN] = useState(0)
  useEffect(() => { log(n) }, [n])
  return <button onClick={() => setN(1)}>go</button>
}
`)

  const steps = comp.events[0].flows[0].steps
  assert.ok(steps.every(s => !s.hook))
  assert.ok(comp.states.every(s => !s.viaHook))
})

test('🔗 관계 카드도 얽힌 Effect 가 어느 훅 안에 있는지 알려준다', () => {
  // 무한 루프가 훅 안에 있으면 고칠 자리는 컴포넌트가 아니라 그 훅 파일입니다
  const comp = parseBehavior(`import { useState, useEffect } from 'react'

function useCounter() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(count + 1)
  }, [count])
  return count
}

export default function Panel() {
  const count = useCounter()
  return <div>{count}</div>
}
`).components.find(c => c.name === 'Panel')

  const loop = comp.interplay.find(i => i.kind === 'loop')
  assert.ok(loop, '스스로를 되받는 루프를 찾아야 한다')

  const effectStep = loop.steps.find(s => s.kind === 'effect')
  assert.equal(effectStep.hook, 'useCounter')
})

/* ------------------------------------------------------------------
 * 훅이 돌려준 핸들러
 *
 * 훅은 상태만 돌려주지 않습니다. `const { onSelect } = useSelection()` 처럼
 * 콜백을 돌려주고 그걸 그대로 `onClick` 에 꽂는 형태가 흔합니다.
 * setter 만 대응시키면 그 핸들러는 "아무 일도 안 하는 것" 처럼 보입니다.
 * ---------------------------------------------------------------- */

const RETURNS_FN = `import { useState, useEffect } from 'react'

function useSelection() {
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const onSelect = (id) => { setSelected(id) }
  useEffect(() => {
    fetchDetail(selected).then(setDetail)
  }, [selected])
  return { selected, onSelect }
}

function useToggle() {
  const [on, setOn] = useState(false)
  function flip() { setOn(true) }
  return { on, flip }
}

function useCounter() {
  const [n, setN] = useState(0)
  return { n, inc: () => setN(n + 1) }
}

export default function Panel() {
  const { onSelect } = useSelection()
  const { flip: toggleIt } = useToggle()
  const { inc } = useCounter()
  return (
    <div>
      <button onClick={onSelect}>a</button>
      <button onClick={() => toggleIt()}>b</button>
      <button onClick={inc}>c</button>
    </div>
  )
}
`

test('훅이 돌려준 콜백을 그대로 꽂아도 흐름이 이어진다', () => {
  const steps = flowOf(panel(RETURNS_FN), 'onSelect()')

  assert.deepEqual(
    steps.map(s => s.kind),
    ['event', 'call', 'setter', 'effect', 'call', 'wait', 'setter', 'rerender'],
    '이벤트 → 훅이 돌려준 콜백 → 훅 상태 → 훅의 Effect 까지 이어져야 한다'
  )
  assert.equal(stepBy(steps, 'setSelected()').detail, '→  selected')
})

test('돌려준 콜백은 훅 구역 안에서 시작한다', () => {
  const steps = flowOf(panel(RETURNS_FN), 'onSelect()')

  assert.equal(stepBy(steps, '<button onClick>').hook, null, '이벤트는 구역 밖')

  // 콜백부터 그 뒤 Effect 까지 한 구역 — UI 가 상자 하나로 묶는다
  const inHook = steps.slice(1, -1)
  assert.ok(inHook.every(s => s.hook === 'useSelection'), '구역이 중간에 끊기면 안 된다')
  assert.equal(stepBy(steps, 'onSelect()').hookLine, 3, '머리말 클릭 = 훅 선언으로 이동')

  assert.equal(steps[steps.length - 1].hook, null, '리렌더에서 구역이 닫힌다')
})

test('이름을 바꿔 받으면 훅 안에서 부르는 이름도 함께 알려준다', () => {
  const steps = flowOf(panel(RETURNS_FN), 'toggleIt()')

  const call = stepBy(steps, 'toggleIt()')
  assert.equal(call.hook, 'useToggle')
  assert.equal(call.hookInternal, 'flip', '훅 코드에서 찾을 이름은 flip')
  assert.equal(stepBy(steps, 'setOn()').hook, 'useToggle')
})

test('그 자리에서 만들어 돌려준 콜백도 따라간다', () => {
  // return { inc: () => setN(n + 1) } — 훅 안에 찾아갈 이름이 없는 형태
  const steps = flowOf(panel(RETURNS_FN), 'inc()')

  const call = stepBy(steps, 'inc()')
  assert.equal(call.hook, 'useCounter')
  assert.equal(call.hookInternal, null, '이름이 없으니 알려줄 내부 이름도 없다')
  assert.equal(stepBy(steps, 'setN()').detail, '→  n')
})

test('배열로 돌려준 콜백도 따라간다', () => {
  const comp = panel(`import { useState } from 'react'

function useToggle() {
  const [on, setOn] = useState(false)
  const flip = () => setOn(true)
  return [on, flip]
}

export default function Panel() {
  const [on, toggle] = useToggle()
  return <button onClick={toggle}>{on}</button>
}
`)

  const steps = flowOf(comp, 'toggle()')
  assert.equal(stepBy(steps, 'toggle()').hook, 'useToggle')
  assert.equal(stepBy(steps, 'toggle()').hookInternal, 'flip')
  assert.equal(stepBy(steps, 'setOn()').detail, '→  on')
})

/* --- 잡으면 안 되는 것 --- */

test('컴포넌트에 같은 이름의 함수가 있으면 그쪽이 이긴다', () => {
  // 실제로 불리는 것은 컴포넌트 자신의 함수입니다. 훅 구역을 치면 거짓말이 됩니다.
  const comp = panel(`import { useState } from 'react'

function useThing() {
  const [a, setA] = useState(0)
  const run = () => setA(1)
  return { run }
}

export default function Panel() {
  const [b, setB] = useState(0)
  useThing()
  const run = () => setB(1)
  return <button onClick={run}>go</button>
}
`)

  const steps = flowOf(comp, 'run()')
  assert.equal(stepBy(steps, 'run()').hook, null, '컴포넌트 함수에는 훅 구역이 없다')
  assert.ok(stepBy(steps, 'setB()'), '바뀌는 것은 컴포넌트 상태')
  assert.ok(!stepBy(steps, 'setA()'))
})

test('import 한 훅이 돌려준 콜백은 여전히 경계다', () => {
  const comp = panel(`import { useState } from 'react'
import { useCart } from './cart'

export default function Panel() {
  const { addItem } = useCart()
  return <button onClick={addItem}>add</button>
}
`)

  const steps = comp.events[0].flows[0].steps
  assert.ok(steps.every(s => !s.hook), '안을 못 보는 훅에는 구역을 치지 않는다')
  assert.equal(steps.find(s => s.kind === 'boundary').detail, 'useCart 에서 받아옴')
})
