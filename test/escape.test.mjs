/**
 * escapeHtml — 붙여넣은 코드의 문자열이 innerHTML 에 섞여도
 * 이 페이지의 엘리먼트가 되지 않게 막는지 고정합니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml } from '../src/core/escape.js'

test('태그·따옴표를 엔티티로 바꿉니다', () => {
  assert.equal(
    escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;',
  )
  assert.equal(
    escapeHtml(`'"><script>`),
    '&#39;&quot;&gt;&lt;script&gt;',
  )
})

test('import 경로처럼 쓰이는 문자열도 통과시킵니다', () => {
  const module = '<img src=x onerror=alert(1)>'
  const html = `<span class="structure-item__name">${escapeHtml(module)}</span>`
  assert.equal(html.includes('<img'), false)
  assert.equal(html.includes('&lt;img'), true)
})
