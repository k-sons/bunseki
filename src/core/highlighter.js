/**
 * Highlighter — 구문 하이라이팅 + 섹션 컬러밴드 렌더러
 *
 * Prism.js 위에 커스텀 레이어를 추가하여:
 * - 코드 섹션별 배경 컬러밴드
 * - 라인별 호버/클릭 인터랙션
 * - 인라인 배지 (Hook, 핸들러, 컴포넌트)
 * - 주석 강조
 */

// Prism 을 번들에 포함시킵니다 (CDN 불필요).
// 로딩 순서 주의: core → typescript → jsx → tsx (tsx 는 앞의 둘에 의존)
import Prism from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import { escapeHtml } from './escape.js'

// 페이지 로드 시 Prism 이 DOM 을 자동으로 훑지 않도록 함 (하이라이팅은 수동 호출)
Prism.manual = true

const SECTION_LABELS = {
  import: 'IMPORT',
  const: 'CONST',
  helper: 'HELPER',
  component: 'COMPONENT',
  export: 'EXPORT',
}

/**
 * 하이라이팅된 코드 뷰를 생성합니다.
 * @param {string} code - 원본 코드
 * @param {import('./parser').ParseResult} analysis - 파서 분석 결과
 * @param {string} language - Prism 언어 (jsx, tsx, javascript, typescript)
 * @returns {HTMLElement}
 */
export function renderHighlightView(code, analysis, language = 'jsx') {
  const container = document.createElement('div')
  container.className = 'highlight-view'

  const wrap = document.createElement('div')
  wrap.className = 'highlight-code-wrap'

  const lines = code.split('\n')

  // Prism highlight the entire code
  // (여러 줄에 걸친 토큰의 <span> 이 잘리지 않도록 태그를 인식해 줄 단위로 나눕니다)
  const highlighted = highlightCode(code, language)
  const highlightedLines = splitHighlightedLines(highlighted)

  // Track which sections have already shown their label
  const shownSections = new Set()

  const badgeIndex = buildBadgeIndex(analysis)

  lines.forEach((rawLine, idx) => {
    const lineEl = document.createElement('div')
    lineEl.className = 'hl-line'
    lineEl.dataset.lineNum = idx + 1

    const section = analysis.sections[idx]
    if (section) {
      lineEl.dataset.section = section
    }

    // Check if this line is a comment
    const trimmed = rawLine.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      lineEl.classList.add('hl-comment-line')
    }

    // Gutter (line number)
    const gutter = document.createElement('span')
    gutter.className = 'hl-gutter'
    gutter.textContent = idx + 1

    // Content
    const content = document.createElement('span')
    content.className = 'hl-content'
    content.innerHTML = highlightedLines[idx] || ''

    // Add inline badges
    const badges = badgeIndex.get(idx + 1)
    if (badges) {
      badges.forEach(({ text, type }) => content.appendChild(createBadge(text, type)))
    }

    lineEl.appendChild(gutter)
    lineEl.appendChild(content)

    // Section label on first line of section
    if (section && !shownSections.has(section + '-' + findSectionStart(analysis.sections, idx))) {
      const sectionStart = findSectionStart(analysis.sections, idx)
      if (idx === sectionStart) {
        const label = document.createElement('span')
        label.className = 'hl-section-label'
        label.dataset.section = section
        label.textContent = SECTION_LABELS[section] || section
        lineEl.appendChild(label)
        shownSections.add(section + '-' + sectionStart)
      }
    }

    // Click handler: highlight this line
    lineEl.addEventListener('click', () => {
      wrap.querySelectorAll('.hl-line.active').forEach(el => el.classList.remove('active'))
      lineEl.classList.add('active')
    })

    wrap.appendChild(lineEl)
  })

  container.appendChild(wrap)
  return container
}

/**
 * Prism.js로 코드를 하이라이트합니다.
 * 실패하더라도 하이라이팅만 포기하고 코드 자체는 그대로 보여줍니다.
 */
export function highlightCode(code, language) {
  try {
    const grammar = Prism.languages[language] || Prism.languages.javascript
    return Prism.highlight(code, grammar, language)
  } catch (err) {
    console.warn('Prism 하이라이팅 실패 — 원본 코드로 표시합니다.', err)
    return escapeHtml(code)
  }
}

/**
 * Prism 이 만든 HTML 을 줄 단위로 자릅니다.
 *
 * 단순히 '\n' 으로 split 하면 블록 주석·템플릿 리터럴처럼 여러 줄에 걸친 토큰의
 * <span> 이 중간에서 잘려 색이 새거나 사라집니다. 열려 있는 태그를 스택으로 추적해
 * 줄 끝에서 닫고 다음 줄 앞에서 다시 열어줍니다.
 *
 * @param {string} html - Prism.highlight 결과
 * @returns {string[]} 각 줄의 완결된 HTML
 */
function splitHighlightedLines(html) {
  const lines = []
  const openTags = [] // { raw: '<span class="...">', name: 'span' }
  let current = ''

  // 현재까지 열린 태그를 모두 닫고 줄을 확정한 뒤, 다음 줄에서 동일하게 다시 엽니다.
  const breakLine = () => {
    for (let i = openTags.length - 1; i >= 0; i--) {
      current += `</${openTags[i].name}>`
    }
    lines.push(current)
    current = openTags.map(t => t.raw).join('')
  }

  const appendText = (text) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) breakLine()
      current += part
    })
  }

  const tagPattern = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g
  let cursor = 0
  let match

  while ((match = tagPattern.exec(html)) !== null) {
    appendText(html.slice(cursor, match.index))

    const raw = match[0]
    const name = match[1]

    if (raw.startsWith('</')) {
      if (openTags.length > 0) openTags.pop()
    } else if (!raw.endsWith('/>')) {
      openTags.push({ raw, name })
    }

    current += raw
    cursor = tagPattern.lastIndex
  }

  appendText(html.slice(cursor))
  lines.push(current)

  return lines
}

/**
 * 줄 번호 → 배지 목록.
 *
 * 예전에는 줄 원문을 정규식으로 다시 훑어 배지를 붙였습니다. 그래서 주석이나 문자열 안에
 * 적힌 `useEffect(` · `await` 에도 배지가 달렸습니다 — 코드가 하지 않는 일을 한다고
 * 말한 셈입니다. 파서가 AST 에서 이미 찾아 둔 자리만 씁니다.
 *
 * 파싱에 실패하면 이 목록들이 비어 배지도 사라집니다. 그게 맞습니다 —
 * 못 읽은 코드에 대해 "여기 Hook 이 있다" 고 말할 근거가 없습니다.
 *
 * @param {import('./parser').ParseResult} analysis
 * @returns {Map<number, {text: string, type: string}[]>}
 */
function buildBadgeIndex(analysis) {
  const index = new Map()
  const seen = new Set()

  const add = (line, text, type) => {
    if (!line) return
    // 같은 줄에 같은 배지는 한 번만 (useState 를 한 줄에서 두 번 불러도 배지는 하나)
    const key = `${line}|${type}|${text}`
    if (seen.has(key)) return
    seen.add(key)
    if (!index.has(line)) index.set(line, [])
    index.get(line).push({ text, type })
  }

  for (const h of analysis.hooks || []) add(h.line, h.name, `hook-${h.category || 'other'}`)
  for (const h of analysis.handlerMarks || []) add(h.line, h.name, 'handler')
  for (const p of analysis.rnPatterns || []) add(p.line, p.type, 'rn')
  for (const a of analysis.asyncMarks || []) add(a.line, a.keyword, 'async')

  return index
}

/**
 * 배지 HTML 요소를 생성합니다.
 */
function createBadge(text, type) {
  const badge = document.createElement('span')
  badge.className = `hl-badge hl-badge--${type}`
  badge.textContent = text
  return badge
}

/**
 * 섹션 시작 인덱스를 찾습니다.
 */
function findSectionStart(sections, idx) {
  const section = sections[idx]
  let start = idx
  while (start > 0 && sections[start - 1] === section) {
    start--
  }
  return start
}

/**
 * 특정 라인으로 스크롤합니다.
 */
export function scrollToLine(container, lineNum) {
  const lineEl = container.querySelector(`[data-line-num="${lineNum}"]`)
  if (lineEl) {
    // Remove previous active
    container.querySelectorAll('.hl-line.active').forEach(el => el.classList.remove('active'))
    lineEl.classList.add('active')
    lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}
