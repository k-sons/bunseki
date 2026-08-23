/**
 * 내장 예제 테스트 — 앱이 기본으로 싣는 코드가 렌더러가 읽는 필드를 빠짐없이
 * 채우는지(= 렌더 중 undefined 접근으로 깨지지 않는지) 확인합니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCode } from '../src/core/parser.js'
import { calculateMetrics } from '../src/core/metrics.js'
import { EXAMPLES } from '../src/data/examples.js'

/** 각 탭 렌더러가 실제로 읽는 필드를 그대로 접근 — 없으면 throw */
function touchRendererFields(a) {
  a.sections.forEach(s => void s)
  assert.equal(a.sections.length, a.totalLines, 'sections 길이 = totalLines')

  a.functions.forEach(fn => {
    void `${fn.name} ${fn.type} ${fn.lineCount} L${fn.startLine}-${fn.endLine} ${fn.isAsync} ${fn.isExported}`
    fn.params.slice(0, 3).join(',')
    fn.hooks.forEach(h => void `${h.name}-${h.category}`)
    void fn.handlers.length
  })
  a.constants.forEach(c => void `${c.name} ${c.kind} ${c.isArray} ${c.isObject} ${c.startLine}`)
  a.imports.forEach(i => void `${i.module} ${i.names.join(',')} ${i.isRN} ${i.isReact} ${i.startLine}`)
  a.hooks.forEach(h => void `${h.name} ${h.line} ${h.isRN}`)
  a.relations.forEach(r => void `${r.from} ${r.to} ${r.type} ${r.isAsync}`)

  const m = calculateMetrics(a)
  if (m.functionSizes.length) void Math.max(...m.functionSizes.map(f => f.lines))
  Object.entries(m.hookBreakdown).forEach(([n, d]) => void `${n} ${d.count} ${d.lines.join(',')}`)
  return m
}

for (const ex of EXAMPLES) {
  test(`내장 예제 렌더 필드 완비: ${ex.title || ex.name}`, () => {
    const a = parseCode(ex.code)
    const m = touchRendererFields(a)
    assert.ok(m.componentCount > 0, '컴포넌트가 하나 이상 잡혀야 한다')
    assert.ok(m.totalLines > 0)
  })
}

test('복잡한 상태관리 예제 — memo 컴포넌트가 누락되지 않는다', () => {
  const complex = EXAMPLES.find(e => e.id === 'complex-state')
  const a = parseCode(complex.code)
  const names = a.functions.filter(f => f.type === 'component').map(f => f.name)
  // 예전 엔진은 memo() 로 감싼 SearchBar/MemoizedList 를 완전히 놓쳤음
  assert.ok(names.includes('ComplexApp'))
  assert.ok(names.includes('SearchBar'))
  assert.ok(names.includes('MemoizedList'))
})
