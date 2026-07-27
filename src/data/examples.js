/**
 * 예제 코드 — 사용자가 제공한 React 코드를 기본 예제로 포함
 */

export const EXAMPLE_REACT_TODO = `import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const MODES = [
  { id: 'instant', label: '코드1 · filter 즉시삭제 (고장)' },
  { id: 'manual', label: '코드2 · exiting 수동관리 (학습용)' },
  { id: 'presence', label: '코드3 · AnimatePresence (실무)' },
]

const SEED = [
  { id: 'a', text: '장보기' },
  { id: 'b', text: '운동하기' },
  { id: 'c', text: '문서 읽기' },
  { id: 'd', text: '코드 리뷰' },
]

const EXIT_MS = 280

/**
 * STEP 4 — 삭제 가능한 할 일 목록
 * 핵심: 언마운트 퇴장은 CSS로 불가 → DOM이 먼저 사라져 애니메이션 틈이 없음
 *   코드1 고장 = filter 즉시 제거 / 코드2 학습용 = exiting 수동 / 코드3 실무 = AnimatePresence
 */
export default function Step4TodoList() {
  const [mode, setMode] = useState('instant')

  return (
    <section className="step4">
      <h2>STEP 4 · 삭제 가능한 할 일 목록</h2>
      <p className="step4-desc">
        × → 페이드아웃 + 높이 축소 → 아래 항목이 위로 슬라이드.
        React는 트리에 <strong>있거나 없거나</strong>뿐 — 퇴장 중간 상태가 없음
      </p>

      <div className="step4-modes" role="tablist" aria-label="해법 비교">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? 'active' : undefined}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="step4-hint">{hintFor(mode)}</p>

      {mode === 'instant' && <InstantTodo key="instant" />}
      {mode === 'manual' && <ManualExitTodo key="manual" />}
      {mode === 'presence' && <PresenceTodo key="presence" />}

      <hr className="step4-hr" />

      <details className="step4-compare">
        <summary>해법 비교 · key / mode / Fragment</summary>
        <table>
          <thead>
            <tr>
              <th>방식</th>
              <th>한계</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>코드1 filter 즉시삭제</td>
              <td>DOM이 바로 사라져 퇴장 애니 불가</td>
              <td className="step4-tag-learn">고장 — React 언마운트 타이밍</td>
            </tr>
            <tr>
              <td>코드2 exiting 수동관리</td>
              <td>동시 삭제·중간에 재추가하면 상태 꼬임</td>
              <td className="step4-tag-learn">학습용 — 한계를 느끼기 위한 것</td>
            </tr>
            <tr>
              <td>코드3 AnimatePresence</td>
              <td>안정적인 key 필수 (index 금지)</td>
              <td className="step4-tag-prod">실무 빈출 — layout으로 위로 밀림</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  )
}

function hintFor(mode) {
  switch (mode) {
    case 'instant':
      return '학습용 — setItems(filter) → 커밋 즉시 DOM 제거 → CSS transition 볼 틈 없음'
    case 'manual':
      return '학습용 — exiting Set으로 잠시 남긴 뒤 transitionend에 진짜 삭제. 연속 삭제·재추가에 취약'
    case 'presence':
      return '실무 빈출 — AnimatePresence가 언마운트를 exit 끝날 때까지 유예 + layout으로 위 슬라이드'
    default:
      return ''
  }
}

function seedItems() {
  return SEED.map((t) => ({ ...t }))
}

function TodoShell({ children, onAdd, onReset, status, note }) {
  return (
    <div className="step4-demo">
      <ul className="step4-list">{children}</ul>
      <div className="step4-actions">
        <button type="button" className="step4-add" onClick={onAdd}>
          항목 추가
        </button>
        <button type="button" className="step4-reset" onClick={onReset}>
          초기화
        </button>
      </div>
      {status ? <p className="step4-status">{status}</p> : null}
      {note ? <p className="step4-note">{note}</p> : null}
    </div>
  )
}

/** 학습용 — filter만 하면 퇴장 애니 없음 */
function InstantTodo() {
  const [items, setItems] = useState(seedItems)
  const nextId = useRef(1)

  function remove(id) {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }

  function add() {
    const n = nextId.current++ 
    setItems((prev) => [...prev, { id: 'n-' + n, text: '새 할 일 ' + n }])
  }

  return (
    <TodoShell
      onAdd={add}
      onReset={() => {
        nextId.current = 1
        setItems(seedItems())
      }}
      status={'남은 항목: ' + items.length}
      note="× 를 눌러 보세요 — 애니메이션 없이 바로 사라집니다."
    >
      {items.map((item) => (
        <li key={item.id} className="step4-item">
          <span>{item.text}</span>
          <button
            type="button"
            className="step4-x"
            aria-label={item.text + ' 삭제'}
            onClick={() => remove(item.id)}
          >
            ×
          </button>
        </li>
      ))}
    </TodoShell>
  )
}

/**
 * 학습용 — exiting 상태를 따로 두고 CSS transition 후 진짜 삭제
 */
function ManualExitTodo() {
  const [items, setItems] = useState(seedItems)
  const [exiting, setExiting] = useState(() => new Set())
  const nextId = useRef(1)
  const timers = useRef(new Map())

  function clearTimers() {
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
  }

  function remove(id) {
    if (timers.current.has(id)) return

    setExiting((prev) => new Set(prev).add(id))

    const fallback = setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
      setExiting((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      timers.current.delete(id)
    }, EXIT_MS + 40)
    timers.current.set(id, fallback)
  }

  function onExitEnd(id, e) {
    if (e.propertyName !== 'opacity') return
    if (e.target !== e.currentTarget) return
    if (!timers.current.has(id)) return

    const t = timers.current.get(id)
    clearTimeout(t)
    timers.current.delete(id)

    setItems((prev) => prev.filter((t) => t.id !== id))
    setExiting((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function add() {
    const n = nextId.current++
    setItems((prev) => [...prev, { id: 'n-' + n, text: '새 할 일 ' + n }])
  }

  return (
    <TodoShell
      onAdd={add}
      onReset={() => {
        clearTimers()
        nextId.current = 1
        setExiting(new Set())
        setItems(seedItems())
      }}
      status={'남은: ' + items.length + ' · 퇴장중: ' + exiting.size}
      note="연속으로 빠르게 × 하거나, 퇴장 중 추가해 보세요 — 상태가 쉽게 꼬입니다."
    >
      {items.map((item) => {
        const isExit = exiting.has(item.id)
        return (
          <li
            key={item.id}
            className={'step4-item step4-item--manual' + (isExit ? ' is-exit' : '')}
            onTransitionEnd={(e) => onExitEnd(item.id, e)}
          >
            <span>{item.text}</span>
            <button
              type="button"
              className="step4-x"
              aria-label={item.text + ' 삭제'}
              disabled={isExit}
              onClick={() => remove(item.id)}
            >
              ×
            </button>
          </li>
        )
      })}
    </TodoShell>
  )
}

/** 실무 빈출 — AnimatePresence + layout (안정 key) */
function PresenceTodo() {
  const [items, setItems] = useState(seedItems)
  const nextId = useRef(1)

  function remove(id) {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }

  function add() {
    const n = nextId.current++
    setItems((prev) => [...prev, { id: 'n-' + n, text: '새 할 일 ' + n }])
  }

  return (
    <TodoShell
      onAdd={add}
      onReset={() => {
        nextId.current = 1
        setItems(seedItems())
      }}
      status={'남은 항목: ' + items.length}
      note="연속 삭제해도 퇴장 + 위 슬라이드가 유지됩니다. key는 id (index 금지)."
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <motion.li
            key={item.id}
            className="step4-item step4-item--motion"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: EXIT_MS / 1000, ease: 'easeOut' }}
          >
            <span>{item.text}</span>
            <button
              type="button"
              className="step4-x"
              aria-label={item.text + ' 삭제'}
              onClick={() => remove(item.id)}
            >
              ×
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </TodoShell>
  )
}
`

export const EXAMPLES = [
  {
    id: 'complex-state',
    title: '복잡한 상태관리 (State/Memo/Store)',
    language: 'jsx',
    code: `import React, { useState, useReducer, useCallback, useMemo, memo } from 'react'
import { useDispatch, useSelector } from 'react-redux'

const listReducer = (state, action) => {
  switch(action.type) {
    case 'ADD': return [...state, action.payload]
    default: return state
  }
}

export const ComplexApp = () => {
  const [query, setQuery] = useState('')
  const [list, dispatchLocal] = useReducer(listReducer, [])
  const dispatch = useDispatch()
  const globalData = useSelector(state => state.data)

  const handleSearch = useCallback(async () => {
    const res = await fetch('/api/search?q='+query)
    const data = await res.json()
    dispatch({ type: 'SET_DATA', payload: data })
  }, [query, dispatch])

  const filtered = useMemo(() => {
    return list.filter(item => item.includes(query))
  }, [list, query])

  return (
    <div>
      <SearchBar onSearch={handleSearch} onChange={setQuery} />
      <MemoizedList items={filtered} globalData={globalData} />
    </div>
  )
}

const SearchBar = memo(({ onSearch, onChange }) => {
  return <input onChange={e => onChange(e.target.value)} onBlur={onSearch} />
})

const MemoizedList = memo(({ items, globalData }) => {
  return <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
})
`
  },
  {
    id: 'todo-list',
    name: 'React Todo List (애니메이션 비교)',
    language: 'jsx',
    code: EXAMPLE_REACT_TODO,
  },
]
