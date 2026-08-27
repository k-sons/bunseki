/**
 * Code Bunseki — Main Application
 *
 * 모든 모듈을 연결하고 앱 전체를 구동합니다.
 */

import { renderHighlightView, scrollToLine, highlightCode } from './core/highlighter.js'
import { calculateMetrics, renderMetricsView } from './core/metrics.js'
import { renderFlowView } from './core/flow.js'
import { renderStructureView } from './ui/structure.js'
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
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = codeInput.selectionStart
    const end = codeInput.selectionEnd
    codeInput.value = codeInput.value.substring(0, start) + '  ' + codeInput.value.substring(end)
    codeInput.selectionStart = codeInput.selectionEnd = start + 2
    updateLineNumbers()
    renderEditorHighlight()
  }

  // Ctrl+Enter → analyze
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    analyze()
  }
})

// ===== Quick Status (before analysis) =====
function updateQuickStatus() {
  const code = codeInput.value
  const lines = code.split('\n')
  statusLines.textContent = `줄: ${lines.length}`

  const lang = selectLang.value.toUpperCase()
  statusLang.textContent = lang
}

// ===== Analysis =====
// 파서는 @babel/parser 를 쓰기 때문에 번들이 큽니다. 동작 분석과 마찬가지로
// 첫 분석 때 동적 import 로 불러와 초기 로딩에서 제외합니다(둘이 같은 청크를 공유).
async function analyze() {
  const code = codeInput.value.trim()
  if (!code) return

  const language = selectLang.value

  try {
    // Parse
    const { parseCode } = await import('./core/parser.js')
    currentAnalysis = parseCode(code)

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
      analyzeBehavior(code)
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
    analyzeBehavior(code)
  } catch (err) {
    console.error('Analysis error:', err)
    alert('코드 분석 중 오류가 발생했습니다: ' + err.message)
  }
}

/**
 * 동작 분석은 @babel/parser 를 쓰기 때문에 번들이 큽니다.
 * 첫 분석 때 동적 import 로 불러와 초기 로딩에서 제외합니다.
 * 여기서 실패해도 나머지 탭은 그대로 동작해야 하므로 예외를 가둡니다.
 */
async function analyzeBehavior(code) {
  panelBehavior.innerHTML = '<div class="placeholder-msg"><p>동작을 분석하는 중…</p></div>'

  try {
    const [{ parseBehavior }, { renderBehaviorView }] = await Promise.all([
      import('./core/behavior/index.js'),
      import('./ui/behavior.js'),
    ])

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
    console.error('Behavior analysis error:', err)
    panelBehavior.innerHTML = `
      <div class="placeholder-msg">
        <p>동작 분석을 불러오지 못했습니다</p>
        <span class="placeholder-shortcut">${err.message}</span>
      </div>`
  }
}

function updateStatusBar(analysis) {
  statusLines.textContent = `줄: ${analysis.totalLines}`

  // 못 읽은 것을 0 으로 적으면 "세어 보니 없다" 로 읽힙니다. 셀 수 없었으면 그렇게 적습니다.
  if (analysis.error) {
    statusFunctions.textContent = '함수: —'
    statusComponents.textContent = '컴포넌트: —'
    statusHooks.textContent = 'Hook: —'
    statusImports.textContent = 'Import: —'
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
  codeInput.value = ''
  updateLineNumbers()
  updateQuickStatus()
  renderEditorHighlight()
  currentAnalysis = null

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
btnExport.addEventListener('click', async () => {
  if (!currentAnalysis) {
    alert('먼저 코드를 분석해주세요.')
    return
  }

  const originalText = btnExport.innerHTML
  
  try {
    const md = generateMarkdown(currentAnalysis)
    await navigator.clipboard.writeText(md)
    btnExport.innerHTML = '<span style="color:var(--accent)">복사 완료!</span>'
  } catch (err) {
    btnExport.innerHTML = '<span style="color:red">복사 실패</span>'
    console.error(err)
  }

  setTimeout(() => {
    btnExport.innerHTML = originalText
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
    if (c.lineCount > 100 || (c.hooks && c.hooks.length > 5)) badges.push('🚨 Complex')
    
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
let isResizing = false

resizer.addEventListener('mousedown', (e) => {
  isResizing = true
  resizer.classList.add('active')
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  e.preventDefault()
})

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return

  const mainRect = document.getElementById('app-main').getBoundingClientRect()
  const newWidth = e.clientX - mainRect.left
  const minWidth = 280
  const maxWidth = mainRect.width - 280

  if (newWidth >= minWidth && newWidth <= maxWidth) {
    panelInput.style.width = newWidth + 'px'
  }
})

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false
    resizer.classList.remove('active')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
})

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
