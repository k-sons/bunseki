/**
 * parser.js (AST 엔진) 테스트
 *
 * 예전 정규식 파서가 놓치던 흔한 React 패턴들을 회귀 테스트로 고정합니다:
 *   구조분해 props · memo/forwardRef 래핑 · 타입스크립트 제네릭 ·
 *   여러 줄 시그니처 · 기본값 파라미터.
 * 의존성 없이 Node 내장 러너(node --test)로 돕니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCode } from '../src/core/parser.js'

const byName = (r, name) => r.functions.find(f => f.name === name)
const components = (r) => r.functions.filter(f => f.type === 'component')

test('구조분해 props — 줄 수·hook·핸들러가 정확히 잡힌다', () => {
  const r = parseCode(`function Card({ title, onClose }) {
  const [open, setOpen] = useState(true)
  useEffect(() => {}, [open])
  const toggle = () => setOpen(o => !o)
  return <div onClick={toggle}>{title}</div>
}`)
  const card = byName(r, 'Card')
  assert.ok(card, 'Card 컴포넌트를 찾아야 한다')
  assert.equal(card.type, 'component')
  assert.equal(card.lineCount, 6)          // 예전 엔진은 1로 잘못 셌음
  assert.equal(card.hooks.length, 2)       // useState + useEffect
  assert.ok(card.handlers.includes('onClick'))
})

test('memo / forwardRef 로 감싼 컴포넌트도 감지된다', () => {
  const r = parseCode(`const Button = memo(({ label, onPress }) => {
  const [hover, setHover] = useState(false)
  return <button onClick={onPress}>{label}</button>
})
const Input = forwardRef(({ value }, ref) => {
  return <input ref={ref} value={value} />
})`)
  const names = components(r).map(c => c.name)
  assert.ok(names.includes('Button'), 'memo 래핑 Button 이 보여야 한다')
  assert.ok(names.includes('Input'), 'forwardRef 래핑 Input 이 보여야 한다')
})

test('타입스크립트 제네릭 + 타입 주석 시그니처', () => {
  const r = parseCode(`function List<T>({ items }: Props<T>) {
  const [sel, setSel] = useState<number>(0)
  return <ul onClick={() => setSel(1)}>{items.length}</ul>
}`)
  const list = byName(r, 'List')
  assert.ok(list, 'TS 제네릭 컴포넌트를 찾아야 한다')
  assert.equal(list.type, 'component')
  assert.ok(list.hooks.some(h => h.name === 'useState'))
})

test('여러 줄 시그니처', () => {
  const r = parseCode(`function Form({
  onSubmit,
  initial,
}) {
  const [v, setV] = useState(initial)
  return <form onSubmit={onSubmit} />
}`)
  const form = byName(r, 'Form')
  assert.ok(form)
  assert.equal(form.lineCount, 7)
})

test('기본값 객체 파라미터가 블록 끝 계산을 망가뜨리지 않는다', () => {
  const r = parseCode(`function Widget(props = {}) {
  const [x, setX] = useState(0)
  useEffect(() => {}, [])
  return <div>{x}</div>
}`)
  const w = byName(r, 'Widget')
  assert.ok(w)
  assert.equal(w.lineCount, 5)             // 예전 엔진은 = {} 때문에 1로 셌음
  assert.equal(w.hooks.length, 2)
})

test('God Component — 큰 줄 수와 hook 총량을 정확히 센다', () => {
  const code = 'function Dashboard({ user, config, onLogout }) {\n' +
    Array.from({ length: 40 }, (_, i) => `  const [s${i}, setS${i}] = useState(0)`).join('\n') +
    '\n  return <div onClick={onLogout}>x</div>\n}'
  const r = parseCode(code)
  const d = byName(r, 'Dashboard')
  assert.equal(d.lineCount, 43)            // 예전 엔진은 1
  assert.equal(r.hooks.length, 40)         // 전체 hook 호출 목록
  assert.equal(d.hooks.length, 1)          // 배지는 이름 기준 중복 제거(useState 1종)
})

test('섹션 맵 — 컴포넌트 본문 전체가 component 로 칠해진다', () => {
  const r = parseCode(`function Card({ title }) {
  const [open, setOpen] = useState(true)
  return <div>{title}</div>
}`)
  assert.equal(r.sections.length, r.totalLines)
  // 4줄짜리 컴포넌트 — 전부 component 여야 한다 (예전엔 1줄만)
  assert.deepEqual(r.sections, ['component', 'component', 'component', 'component'])
})

test('관계 — 렌더/호출이 스코프를 새지 않고 이어진다', () => {
  const r = parseCode(`function Parent() {
  const v = compute()
  return <Child />
}
function Child() { return <span /> }
function compute() { return 1 }`)
  const rel = r.relations
  assert.ok(rel.some(x => x.from === 'Parent' && x.to === 'Child' && x.type === 'renders'))
  assert.ok(rel.some(x => x.from === 'Parent' && x.to === 'compute' && x.type === 'calls'))
})

test('ParseResult 계약 — 렌더러가 기대하는 필드가 모두 있다', () => {
  const r = parseCode(`import { useState } from 'react'
const N = 1
export default function App({ a }) {
  const [x, setX] = useState(0)
  return <div onClick={() => setX(1)} />
}`)
  for (const key of ['imports', 'functions', 'constants', 'hooks', 'jsxComponents',
    'comments', 'exports', 'rnPatterns', 'sections', 'relations', 'totalLines']) {
    assert.ok(key in r, `결과에 ${key} 가 있어야 한다`)
  }
  const app = byName(r, 'App')
  assert.equal(app.isExported, true)
  assert.equal(app.isDefault, true)
  assert.deepEqual(app.params, ['{ a }'])
  assert.equal(r.imports[0].isReact, true)
  assert.equal(r.constants[0].name, 'N')
})

test('엣지 케이스 — 빈 코드/문법 오류/순수 JS 에서 throw 하지 않는다', () => {
  for (const code of ['', 'function X( {', 'const a = 1\nfunction sum(a,b){return a+b}']) {
    const r = parseCode(code || '\n')
    assert.equal(r.sections.length, r.totalLines)
    assert.ok(Array.isArray(r.functions))
  }
})
