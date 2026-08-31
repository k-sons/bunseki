/**
 * Code Bunseki — Main Application
 *
 * 모든 모듈을 연결하고 앱 전체를 구동합니다.
 */

import { renderHighlightView, scrollToLine, highlightCode } from './core/highlighter.js'
import { calculateMetrics, renderMetricsView } from './core/metrics.js'
import { renderFlowView } from './core/flow.js'
import { renderStructureView } from './ui/structure.js'
import { escapeHtml } from './core/escape.js'
import { EXAMPLES } from './data/examples.js'

// ===== DOM References =====
const codeInput = document.getElementById('code-input')
const editorLines = document.getElementById('editor-lines')
const editorHighlight = document.getElementById('editor-highlight')
const selectLang = document.getElementById('select-lang')
const btnAnalyze = document.getElementById('btn-analyze')
const btnExample = document.getElementById('btn-example')
const btnExport = document.getElementById('btn-export')
const btnTheme = document.getElementById('btn-theme')
const btnClear = document.getElementById('btn-clear')
const btnClearEditor = document.getElementById('btn-clear-editor')

const panelHighlight = document.getElementById('panel-highlight')
const panelStructure = document.getElementById('panel-structure')
const panelMetrics = document.getElementById('panel-metrics')
const panelFlow = document.getElementById('panel-flow')
const panelBehavior = document.getElementById('panel-behavior')

const statusLines = document.getElementById('status-lines')
const statusFunctions = document.getElementById('status-functions')
const statusComponents = document.getElementById('status-components')
const statusHooks = document.getElementById('status-hooks')
const statusImports = document.getElementById('status-imports')
const statusLang = document.getElementById('status-lang')

const resizer = document.getElementById('panel-resizer')
const panelInput = document.getElementById('panel-input')

// ===== State =====
let currentAnalysis = null
let highlightContainer = null
/** 마지막으로 분석한 코드 원문. 지금 편집 중인 코드와 다르면 상태바 숫자는 옛것입니다. */
let analyzedCode = null

// ===== Editor Line Numbers =====
function updateLineNumbers() {
  const lines = codeInput.value.split('\n')
  const count = lines.length
  let html = ''
  for (let i = 1; i <= count; i++) {
    html += `<span>${i}</span>`
  }
  editorLines.innerHTML = html
}

// ===== Editor Syntax Highlight (입력칸 뒤판) =====
// textarea 는 토큰별 색을 못 칠하므로, 같은 위치에 겹쳐 둔 <pre> 를 Prism 으로
// 칠해 색을 보여줍니다. 앞의 textarea 글자는 투명이라 뒤판 색이 그대로 드러납니다.
const editorHighlightCode = editorHighlight.querySelector('code')

function renderEditorHighlight() {
  const language = selectLang.value
  // 마지막 줄이 개행으로 끝나면 <pre> 에서 잘려 보이므로 여유 개행을 덧댑니다.
  const src = codeInput.value + '\n'
  editorHighlightCode.innerHTML = highlightCode(src, language)
  syncEditorScroll()
}

function syncEditorScroll() {
  editorHighlight.scrollTop = codeInput.scrollTop
  editorHighlight.scrollLeft = codeInput.scrollLeft
}

// 매 키 입력마다 전체를 다시 칠하면 긴 코드에서 버벅일 수 있어 디바운스합니다.
let highlightTimer = null
function scheduleEditorHighlight() {
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(renderEditorHighlight, 120)
}

// Sync scroll between textarea and line numbers + highlight overlay
codeInput.addEventListener('scroll', () => {
  editorLines.scrollTop = codeInput.scrollTop
  syncEditorScroll()
})

codeInput.addEventListener('input', () => {
  updateLineNumbers()
  updateQuickStatus()
  scheduleEditorHighlight()
})

// Tab key support in textarea
codeInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return
  e.preventDefault()
  insertAtCursor('  ')
  updateLineNumbers()
  renderEditorHighlight()
})

/**
 * 커서 자리에 글자를 끼워 넣습니다.
 *
 * `codeInput.value = …` 로 통째로 갈아 끼우면 브라우저가 쌓아 둔 되돌리기 기록이
 * 통째로 날아갑니다 — Tab 한 번 눌렀다고 Ctrl+Z 가 먹통이 되면 편집기라고 하기 어렵습니다.
 * `execCommand` 는 낡았지만 되돌리기 기록에 남는 유일한 길이라 먼저 시도하고,
 * 막힌 환경에서만 직접 대입으로 물러섭니다.
 */
function insertAtCursor(text) {
  codeInput.focus()
  if (document.execCommand && document.execCommand('insertText', false, text)) return

  const start = codeInput.selectionStart
  const end = codeInput.selectionEnd
  codeInput.value = codeInput.value.slice(0, start) + text + codeInput.value.slice(end)
  codeInput.selectionStart = codeInput.selectionEnd = start + text.length
}

// Ctrl+Enter → analyze
// 에디터에 포커스가 없어도 눌리게 문서 전체에서 받습니다 — 탭이나 버튼을 만지다가
// 누르면 아무 일도 일어나지 않는 것이 안내문(“Ctrl + Enter”)과 어긋났습니다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  analyze()
})

// ===== Quick Status (before analysis) =====
function updateQuickStatus() {
  const code = codeInput.value
  statusLines.textContent = `줄: ${code.split('\n').length}`
  statusLang.textContent = selectLang.value.toUpperCase()

  // 코드를 고친 뒤에도 지난 분석 숫자가 그대로 남아 있으면, 지금 화면의 코드를 세어 본
  // 값처럼 읽힙니다. 아직 세지 않았다는 뜻으로 — 로 되돌립니다.
  if (analyzedCode !== null && code !== analyzedCode) markCountsUnknown()
}

/** 셀 수 없었거나 아직 세지 않은 상태 — 0 은 "세어 보니 없다" 는 뜻이라 쓰면 안 됩니다. */
function markCountsUnknown() {
  statusFunctions.textContent = '함수: —'
  statusComponents.textContent = '컴포넌트: —'
  statusHooks.textContent = 'Hook: —'
  statusImports.textContent = 'Import: —'
}

// ===== Analysis =====
// 분석은 중간에 await 을 거치므로 여러 번이 겹쳐 돌 수 있습니다 (버튼 연타·Ctrl+Enter·
// 언어 변경). 실행마다 번호를 매기고, 기다렸다 돌아올 때마다 자기가 아직 최신인지
// 확인합니다 — 그러지 않으면 늦게 끝난 옛 분석이 새 결과를 덮어씁니다.
let analyzeRunId = 0

// 파서는 @babel/parser 를 쓰기 때문에 번들이 큽니다. 동작 분석과 마찬가지로
// 첫 분석 때 동적 import 로 불러와 초기 로딩에서 제외합니다(둘이 같은 청크를 공유).
async function analyze() {
  const rawCode = codeInput.value
  const code = rawCode.trim()
  if (!code) return

  const language = selectLang.value
  const runId = ++analyzeRunId
  btnAnalyze.disabled = true

  try {
    // Parse
    const { parseCode } = await import('./core/parser.js')
    if (runId !== analyzeRunId) return
    currentAnalysis = parseCode(code)
    analyzedCode = rawCode

    // Update status bar
    updateStatusBar(currentAnalysis)

    // Render Highlight View
    highlightContainer = renderHighlightView(code, currentAnalysis, language)
    panelHighlight.innerHTML = ''
    // 문법이 깨져 못 읽었으면 **먼저 그 사실부터** 말합니다.
    // 코드 자체는 그대로 보여 줍니다 — 어디가 잘렸는지 눈으로 찾을 수 있게.
    if (currentAnalysis.error) panelHighlight.appendChild(renderParseError(currentAnalysis.error))
    panelHighlight.appendChild(highlightContainer)

    // 구조맵·메트릭·플로우는 셀 수 없었던 것을 0 으로 보여 주면 거짓말이 됩니다.
    // 세 탭 모두 같은 안내로 바꾸고 여기서 끝냅니다.
    if (currentAnalysis.error) {
      for (const panel of [panelStructure, panelMetrics, panelFlow]) {
        panel.innerHTML = ''
        panel.appendChild(renderParseError(currentAnalysis.error))
      }
      activateTab('highlight')
      analyzeBehavior(code, runId)
      return
    }

    // Render Structure View
    const structureView = renderStructureView(currentAnalysis, (lineNum) => {
      // Switch to highlight tab and scroll to line
      activateTab('highlight')
      if (highlightContainer) {
        scrollToLine(highlightContainer, lineNum)
      }
    })
    panelStructure.innerHTML = ''
    panelStructure.appendChild(structureView)

    // Render Metrics View
    const metrics = calculateMetrics(currentAnalysis)
    const metricsView = renderMetricsView(metrics, (lineNum) => {
      activateTab('highlight')
      if (highlightContainer) {
        scrollToLine(highlightContainer, lineNum)
      }
    })
    panelMetrics.innerHTML = ''
    panelMetrics.appendChild(metricsView)

    // Render Flow View
    const flowView = renderFlowView(currentAnalysis, (lineNum) => {
      activateTab('highlight')
      if (highlightContainer) {
        scrollToLine(highlightContainer, lineNum)
      }
    })
    panelFlow.innerHTML = ''
    panelFlow.appendChild(flowView)

    // Switch to highlight tab
    activateTab('highlight')

    // Render Behavior View (동작 분석은 별도 청크라 비동기로 붙입니다)
    analyzeBehavior(code, runId)
  } catch (err) {
    if (runId !== analyzeRunId) return
    console.error('Analysis error:', err)
    alert('코드 분석 중 오류가 발생했습니다: ' + err.message)
  } finally {
    // 뒤이어 시작된 분석이 있으면 그쪽이 버튼을 맡습니다.
    if (runId === analyzeRunId) btnAnalyze.disabled = false
  }
}

/**
 * 동작 분석은 @babel/parser 를 쓰기 때문에 번들이 큽니다.
 * 첫 분석 때 동적 import 로 불러와 초기 로딩에서 제외합니다.
 * 여기서 실패해도 나머지 탭은 그대로 동작해야 하므로 예외를 가둡니다.
 */
async function analyzeBehavior(code, runId) {
  if (runId !== analyzeRunId) return
  panelBehavior.innerHTML = '<div class="placeholder-msg"><p>동작을 분석하는 중…</p></div>'

  try {
    const [{ parseBehavior }, { renderBehaviorView }] = await Promise.all([
      import('./core/behavior/index.js'),
      import('./ui/behavior.js'),
    ])
    if (runId !== analyzeRunId) return

    const behavior = parseBehavior(code)
    const view = renderBehaviorView(behavior, (lineNum) => {
      activateTab('highlight')
      if (highlightContainer) {
        scrollToLine(highlightContainer, lineNum)
      }
    })

    panelBehavior.innerHTML = ''
    panelBehavior.appendChild(view)
  } catch (err) {
    if (runId !== analyzeRunId) return
    console.error('Behavior analysis error:', err)
    panelBehavior.innerHTML = `
      <div class="placeholder-msg">
        <p>동작 분석을 불러오지 못했습니다</p>
        <span class="placeholder-shortcut">${escapeHtml(err.message)}</span>
      </div>`
  }
}

function updateStatusBar(analysis) {
  statusLines.textContent = `줄: ${analysis.totalLines}`

  // 못 읽은 것을 0 으로 적으면 "세어 보니 없다" 로 읽힙니다. 셀 수 없었으면 그렇게 적습니다.
  if (analysis.error) {
    markCountsUnknown()
    return
  }

  statusFunctions.textContent = `함수: ${analysis.functions.filter(f => f.type === 'function').length}`
  statusComponents.textContent = `컴포넌트: ${analysis.functions.filter(f => f.type === 'component').length}`
  statusHooks.textContent = `Hook: ${analysis.hooks.length}`
  statusImports.textContent = `Import: ${analysis.imports.length}`
}

/**
 * 문법 오류 안내 — 구조맵·메트릭·플로우·하이라이트가 함께 씁니다.
 *
 * 예전에는 파싱이 실패하면 이 탭들이 **빈 화면이나 0** 을 보여 줬습니다.
 * "세어 보니 없다" 와 "못 셌다" 가 화면에서 구분되지 않아, 조용히 틀린 결과를
 * 내놓는 셈이었습니다. 이제 왜 비었는지를 먼저 말합니다.
 */
function renderParseError(error) {
  const el = document.createElement('div')
  el.className = 'parse-error'
  el.innerHTML = `
    <div class="parse-error__title">문법 오류로 코드를 읽지 못했습니다</div>
    <div class="parse-error__msg"></div>
    <div class="parse-error__line"></div>
    <div class="parse-error__hint">
      괄호나 태그가 닫히지 않으면 <strong>다섯 탭 모두</strong> 분석하지 못합니다.
      컴포넌트를 통째로(여는 <code>function</code> 부터 닫는 <code>}</code> 까지) 붙여넣어 주세요.
    </div>
  `
  // 코드에서 온 문자열은 textContent 로 넣습니다 — innerHTML 에 그대로 넣으면
  // 오류 메시지에 섞인 <태그> 가 진짜 엘리먼트로 렌더됩니다.
  el.querySelector('.parse-error__msg').textContent = error.message
  const lineEl = el.querySelector('.parse-error__line')
  if (error.line) lineEl.textContent = `L${error.line}`
  else lineEl.remove()
  return el
}

// ===== Tabs =====
const tabs = document.querySelectorAll('.tab')
const tabPanels = document.querySelectorAll('.tab-panel')

function activateTab(tabId) {
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId)
    t.setAttribute('aria-selected', t.dataset.tab === tabId)
  })
  tabPanels.forEach(p => {
    const isActive = p.id === `panel-${tabId}`
    p.classList.toggle('active', isActive)
    p.hidden = !isActive
  })
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    activateTab(tab.dataset.tab)
  })
})

// ===== Theme Toggle =====
function toggleTheme() {
  const html = document.documentElement
  const current = html.getAttribute('data-theme')
  const next = current === 'dark' ? 'light' : 'dark'
  html.setAttribute('data-theme', next)

  const moonIcon = btnTheme.querySelector('.icon-moon')
  const sunIcon = btnTheme.querySelector('.icon-sun')

  if (next === 'light') {
    moonIcon.style.display = 'none'
    sunIcon.style.display = 'block'
  } else {
    moonIcon.style.display = 'block'
    sunIcon.style.display = 'none'
  }

  // Save preference
  localStorage.setItem('code-bunseki-theme', next)
}

btnTheme.addEventListener('click', toggleTheme)
btnAnalyze.addEventListener('click', analyze)
selectLang.addEventListener('change', () => {
  updateQuickStatus()
  renderEditorHighlight()
  if (codeInput.value.trim()) {
    analyze()
  }
})

// Load saved theme
const savedTheme = localStorage.getItem('code-bunseki-theme')
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme)
  if (savedTheme === 'light') {
    btnTheme.querySelector('.icon-moon').style.display = 'none'
    btnTheme.querySelector('.icon-sun').style.display = 'block'
  }
}

// ===== Clear Code =====
function clearCode() {
  // 돌고 있던 분석이 뒤늦게 돌아와 방금 비운 화면을 다시 채우지 않도록 번호를 넘깁니다.
  analyzeRunId++
  btnAnalyze.disabled = false

  codeInput.value = ''
  currentAnalysis = null
  analyzedCode = null
  // 패널을 통째로 갈아 끼우므로 예전 컨테이너는 화면에 없는 DOM 입니다.
  // 남겨 두면 다음 이동 요청이 보이지 않는 노드를 가리킵니다.
  highlightContainer = null

  updateLineNumbers()
  updateQuickStatus()
  renderEditorHighlight()

  // Reset panels to placeholder
  panelHighlight.innerHTML = `
    <div class="placeholder-msg">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
        <rect x="6" y="6" width="36" height="36" rx="8" stroke="currentColor" stroke-width="2"/>
        <path d="M14 18h8M14 24h16M14 30h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>왼쪽에 코드를 입력하고 <strong>분석하기</strong>를 클릭하세요</p>
      <span class="placeholder-shortcut">Ctrl + Enter</span>
    </div>`
  panelStructure.innerHTML = `<div class="placeholder-msg"><p>분석 결과가 여기에 표시됩니다</p></div>`
  panelMetrics.innerHTML = `<div class="placeholder-msg"><p>분석 결과가 여기에 표시됩니다</p></div>`
  panelFlow.innerHTML = `<div class="placeholder-msg"><p>분석 결과가 여기에 표시됩니다</p></div>`
  panelBehavior.innerHTML = `<div class="placeholder-msg"><p>이벤트를 눌렀을 때 무슨 일이 일어나는지 보여줍니다</p></div>`

  statusLines.textContent = '줄: 0'
  statusFunctions.textContent = '함수: 0'
  statusComponents.textContent = '컴포넌트: 0'
  statusHooks.textContent = 'Hook: 0'
  statusImports.textContent = 'Import: 0'

  codeInput.focus()
}

if (btnClear) btnClear.addEventListener('click', clearCode)
if (btnClearEditor) btnClearEditor.addEventListener('click', clearCode)

// ===== Example Code =====
let currentExampleIndex = 0

btnExample.addEventListener('click', () => {
  const example = EXAMPLES[currentExampleIndex]
  codeInput.value = example.code
  selectLang.value = example.language
  updateLineNumbers()
  updateQuickStatus()
  renderEditorHighlight()

  // Auto-analyze
  analyze()
  
  // Cycle to next example for the next click
  currentExampleIndex = (currentExampleIndex + 1) % EXAMPLES.length
})

// ===== Export to Markdown =====
// 버튼의 원래 모습은 한 번만 붙잡아 둡니다. 누를 때마다 읽으면 2 초 안에 다시 눌렀을 때
// "복사 완료!" 를 원본으로 착각해 그 라벨이 그대로 굳습니다.
const EXPORT_LABEL = btnExport.innerHTML
let exportResetTimer = null

btnExport.addEventListener('click', async () => {
  if (!currentAnalysis) {
    alert('먼저 코드를 분석해주세요.')
    return
  }

  // 파싱에 실패한 결과로 마크다운을 만들면 빈 목록이 "컴포넌트 없음" 으로 적힙니다.
  // 다른 탭은 "못 셌다" 라고 말하는데 추출본만 0 을 사실처럼 옮기는 셈입니다.
  if (currentAnalysis.error) {
    alert('문법 오류로 코드를 읽지 못해 추출할 수 없습니다.\n\n' + currentAnalysis.error.message)
    return
  }

  try {
    const md = generateMarkdown(currentAnalysis)
    await navigator.clipboard.writeText(md)
    btnExport.innerHTML = '<span style="color:var(--accent)">복사 완료!</span>'
  } catch (err) {
    btnExport.innerHTML = '<span style="color:red">복사 실패</span>'
    console.error(err)
  }

  if (exportResetTimer) clearTimeout(exportResetTimer)
  exportResetTimer = setTimeout(() => {
    btnExport.innerHTML = EXPORT_LABEL
    exportResetTimer = null
  }, 2000)
})

function generateMarkdown(analysis) {
  const components = analysis.functions.filter(f => f.type === 'component')
  const helpers = analysis.functions.filter(f => f.type === 'function')
  
  let md = `# Code Bunseki Analysis\n\n`
  md += `## 📊 Metrics\n`
  md += `- **Total Lines**: ${analysis.totalLines}\n`
  md += `- **Components**: ${components.length}\n`
  md += `- **Functions**: ${helpers.length}\n`
  md += `- **Hooks Used**: ${analysis.hooks.length}\n\n`

  md += `## 🧩 Components\n`
  components.forEach(c => {
    const badges = []
    if (c.isAsync) badges.push('Async')
    // hooks 는 이름 기준 중복 제거된 목록이라 덩치 판정에는 실제 호출 수를 씁니다.
    const hookCalls = c.hookCallCount ?? (c.hooks ? c.hooks.length : 0)
    if (c.lineCount > 100 || hookCalls > 5) badges.push('🚨 Complex')
    
    md += `- **${c.name}** (${c.lineCount} lines) ${badges.length ? `[${badges.join(', ')}]` : ''}\n`
    if (c.hooks && c.hooks.length > 0) {
      md += `  - Hooks: \`${c.hooks.map(h => h.name || h).join(', ')}\`\n`
    }
  })
  if (components.length === 0) md += `- None\n`
  md += '\n'

  md += `## 🔗 Component Flow\n`
  if (analysis.relations.length === 0) {
    md += `- No component relations found.\n`
  } else {
    analysis.relations.forEach(r => {
      md += `- ${r.from} ${r.type === 'renders' ? 'renders' : (r.isAsync ? 'calls (Async)' : 'calls')} **${r.to}**\n`
    })
  }

  return md
}

// ===== Panel Resizer =====
// 마우스 전용 이벤트 대신 포인터 이벤트를 씁니다 — 터치·펜에서도 같은 코드로 끌립니다.
const PANEL_MIN_WIDTH = 280
const PANEL_WIDTH_KEY = 'code-bunseki-input-width'

const appMain = document.getElementById('app-main')
let isResizing = false

/** 창 크기가 달라져도 두 패널이 모두 최소 폭을 지키도록 가둡니다 */
function clampPanelWidth(width, containerWidth) {
  const maxWidth = containerWidth - PANEL_MIN_WIDTH
  if (maxWidth < PANEL_MIN_WIDTH) return null
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), maxWidth)
}

resizer.addEventListener('pointerdown', (e) => {
  isResizing = true
  resizer.classList.add('active')
  resizer.setPointerCapture(e.pointerId)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  e.preventDefault()
})

resizer.addEventListener('pointermove', (e) => {
  if (!isResizing) return
  const mainRect = appMain.getBoundingClientRect()
  const width = clampPanelWidth(e.clientX - mainRect.left, mainRect.width)
  if (width !== null) panelInput.style.width = width + 'px'
})

function endResize(e) {
  if (!isResizing) return
  isResizing = false
  resizer.releasePointerCapture(e.pointerId)
  resizer.classList.remove('active')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  // 정한 폭을 기억합니다 — 새로고침마다 기본값으로 돌아가면 매번 다시 끌어야 합니다.
  if (panelInput.style.width) {
    localStorage.setItem(PANEL_WIDTH_KEY, parseInt(panelInput.style.width, 10))
  }
}

resizer.addEventListener('pointerup', endResize)
resizer.addEventListener('pointercancel', endResize)

// Restore saved width
const savedWidth = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10)
if (Number.isFinite(savedWidth)) {
  const width = clampPanelWidth(savedWidth, appMain.getBoundingClientRect().width)
  if (width !== null) panelInput.style.width = width + 'px'
}

// ===== Initialize =====
updateLineNumbers()
updateQuickStatus()
renderEditorHighlight()

// Show a welcome hint
console.log(
  '%c🔬 Code Bunseki%c — React/RN 코드 가독성 분석 도구',
  'font-size:16px; font-weight:bold; color:#818cf8',
  'font-size:14px; color:#888'
)
