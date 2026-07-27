/**
 * Highlighter — 구문 하이라이팅 + 섹션 컬러밴드 렌더러
 *
 * Prism.js 위에 커스텀 레이어를 추가하여:
 * - 코드 섹션별 배경 컬러밴드
 * - 라인별 호버/클릭 인터랙션
 * - 인라인 배지 (Hook, 핸들러, 컴포넌트)
 * - 주석 강조
 */

const SECTION_LABELS = {
  import: 'IMPORT',
  const: 'CONST',
  helper: 'HELPER',
  component: 'COMPONENT',
  export: 'EXPORT',
}

// Parser에서 함수 가져오기 (비동기로 모듈 로딩 시 import 지원 안 할 수 있으므로 임시로 자체 함수 구현)
function categorizeHookLocal(name) {
  if (['useState', 'useReducer'].includes(name)) return 'state'
  if (['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(name)) return 'effect'
  if (['useMemo', 'useCallback', 'useDeferredValue', 'memo'].includes(name)) return 'memo'
  if (['useSelector', 'useDispatch', 'useStore', 'dispatch', 'useContext'].includes(name)) return 'store'
  return 'other'
}

const HOOK_PATTERN = /\b(use[A-Z]\w+|dispatch|memo)\s*(?:<[^>]*>)?\s*\(/g
const HANDLER_PATTERN = /\b(on[A-Z]\w+)\s*[=:{]/g
const ASYNC_PATTERN = /\b(async|await)\b/g

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
  const highlighted = highlightCode(code, language)
  const highlightedLines = highlighted.split('\n')

  // Track which sections have already shown their label
  const shownSections = new Set()

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
    const badges = generateBadges(rawLine, idx + 1, analysis)
    if (badges.length > 0) {
      badges.forEach(badge => content.appendChild(badge))
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
 */
function highlightCode(code, language) {
  const grammar = Prism.languages[language] || Prism.languages.javascript
  try {
    return Prism.highlight(code, grammar, language)
  } catch {
    // Fallback: escape HTML
    return escapeHtml(code)
  }
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * 해당 라인에 표시할 인라인 배지를 생성합니다.
 */
function generateBadges(line, lineNum, analysis) {
  const badges = []

  // Hook badge
  const hookMatch = [...line.matchAll(HOOK_PATTERN)]
  for (const m of hookMatch) {
    badges.push(createBadge(m[1], 'hook'))
  }

  // Handler badge
  if (line.match(HANDLER_PATTERN)) {
    const handlers = [...line.matchAll(HANDLER_PATTERN)]
    for (const m of handlers) {
      badges.push(createBadge(m[1], 'handler'))
    }
  }

  // RN pattern badge
  if (line.includes('StyleSheet.create')) {
    badges.push(createBadge('StyleSheet', 'rn'))
  }
  if (line.match(/Animated\.\w+/)) {
    badges.push(createBadge('Animated', 'rn'))
  }

  // Hook badge
  if (line.match(HOOK_PATTERN)) {
    const hooks = [...new Set([...line.matchAll(HOOK_PATTERN)].map(m => m[1]))]
    hooks.forEach(hook => {
      badges.push(createBadge(hook, `hook-${categorizeHookLocal(hook)}`))
    })
  }

  // Async badge (for keywords in the line)
  if (line.match(ASYNC_PATTERN)) {
    const keywords = [...new Set([...line.matchAll(ASYNC_PATTERN)].map(m => m[1]))]
    keywords.forEach(kw => {
      badges.push(createBadge(kw, 'async'))
    })
  }

  return badges
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
