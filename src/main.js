/**
 * Code Bunseki — Main Application
 *
 * 모든 모듈을 연결하고 앱 전체를 구동합니다.
 */

import { parseCode } from './core/parser.js'
import { renderHighlightView, scrollToLine } from './core/highlighter.js'
import { calculateMetrics, renderMetricsView } from './core/metrics.js'
import { renderFlowView } from './core/flow.js'
import { renderStructureView } from './ui/structure.js'
import { EXAMPLES } from './data/examples.js'

// ===== DOM References =====
const codeInput = document.getElementById('code-input')
const editorLines = document.getElementById('editor-lines')
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

// Sync scroll between textarea and line numbers
codeInput.addEventListener('scroll', () => {
  editorLines.scrollTop = codeInput.scrollTop
})

codeInput.addEventListener('input', () => {
  updateLineNumbers()
  updateQuickStatus()
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
function analyze() {
  const code = codeInput.value.trim()
  if (!code) return

  const language = selectLang.value

  try {
    // Parse
    currentAnalysis = parseCode(code)

    // Update status bar
    updateStatusBar(currentAnalysis)

    // Render Highlight View
    highlightContainer = renderHighlightView(code, currentAnalysis, language)
    panelHighlight.innerHTML = ''
    panelHighlight.appendChild(highlightContainer)

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
  } catch (err) {
    console.error('Analysis error:', err)
    alert('코드 분석 중 오류가 발생했습니다: ' + err.message)
  }
}

function updateStatusBar(analysis) {
  statusLines.textContent = `줄: ${analysis.totalLines}`
  statusFunctions.textContent = `함수: ${analysis.functions.filter(f => f.type === 'function').length}`
  statusComponents.textContent = `컴포넌트: ${analysis.functions.filter(f => f.type === 'component').length}`
  statusHooks.textContent = `Hook: ${analysis.hooks.length}`
  statusImports.textContent = `Import: ${analysis.imports.length}`
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
      md += `  - Hooks: \`${c.hooks.join(', ')}\`\n`
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

// ===== Analyze Button =====
btnAnalyze.addEventListener('click', analyze)

// ===== Language Select =====
selectLang.addEventListener('change', () => {
  updateQuickStatus()
  // Re-analyze if already analyzed
  if (currentAnalysis && codeInput.value.trim()) {
    analyze()
  }
})

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

// Show a welcome hint
console.log(
  '%c🔬 Code Bunseki%c — React/RN 코드 가독성 분석 도구',
  'font-size:16px; font-weight:bold; color:#818cf8',
  'font-size:14px; color:#888'
)
