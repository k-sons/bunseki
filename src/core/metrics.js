/**
 * Metrics — 코드 메트릭 계산 및 시각화 렌더러
 */

import { escapeHtml } from './escape.js'

/**
 * 분석 결과에서 메트릭을 계산합니다.
 * @param {import('./parser').ParseResult} analysis
 * @returns {Object}
 */
export function calculateMetrics(analysis) {
  const components = analysis.functions.filter(f => f.type === 'component')
  const helpers = analysis.functions.filter(f => f.type === 'function')

  const hookDetails = {}
  for (const hook of analysis.hooks) {
    if (!hookDetails[hook.name]) {
      hookDetails[hook.name] = { count: 0, lines: [] }
    }
    hookDetails[hook.name].count++
    hookDetails[hook.name].lines.push(hook.line)
  }

  return {
    totalLines: analysis.totalLines,
    importCount: analysis.imports.length,
    componentCount: components.length,
    functionCount: helpers.length,
    hookCount: analysis.hooks.length,
    constantCount: analysis.constants.length,
    exportCount: analysis.exports.length,
    commentCount: analysis.comments.length,
    jsxComponentCount: analysis.jsxComponents.length,
    rnPatternCount: analysis.rnPatterns.length,

    components: components.map(c => ({
      name: c.name,
      lines: c.lineCount,
      startLine: c.startLine,
      endLine: c.endLine,
      hooks: c.hooks,
      handlers: c.handlers,
    })),

    hookBreakdown: hookDetails,

    functionSizes: analysis.functions.map(f => ({
      name: f.name,
      lines: f.lineCount,
      startLine: f.startLine,
      endLine: f.endLine,
      type: f.type,
    })),
  }
}

/**
 * 메트릭 대시보드를 렌더합니다.
 * @param {Object} metrics
 * @returns {HTMLElement}
 */
export function renderMetricsView(metrics, onNavigate) {
  const container = document.createElement('div')
  container.className = 'metrics-view animate-in'

  // Summary Cards
  const grid = document.createElement('div')
  grid.className = 'metrics-grid stagger'

  const cards = [
    { label: '총 줄 수', value: metrics.totalLines, color: 'hsl(220, 80%, 65%)' },
    { label: '컴포넌트', value: metrics.componentCount, color: 'hsl(280, 70%, 65%)' },
    { label: '함수', value: metrics.functionCount, color: 'hsl(45, 85%, 55%)' },
    { label: 'Hook', value: metrics.hookCount, color: 'hsl(200, 80%, 55%)' },
    { label: 'Import', value: metrics.importCount, color: 'hsl(160, 70%, 50%)' },
    { label: '상수', value: metrics.constantCount, color: 'hsl(30, 80%, 55%)' },
    { label: 'JSX 요소', value: metrics.jsxComponentCount, color: 'hsl(340, 70%, 60%)' },
    { label: '주석', value: metrics.commentCount, color: 'hsl(120, 50%, 55%)' },
  ]

  cards.forEach(({ label, value, color }) => {
    const card = document.createElement('div')
    card.className = 'metric-card'
    card.innerHTML = `
      <span class="metric-card__value">${value}</span>
      <span class="metric-card__label">${label}</span>
      <div class="metric-card__accent" style="background: ${color}"></div>
    `
    grid.appendChild(card)
  })

  container.appendChild(grid)

  // Function Size Chart
  if (metrics.functionSizes.length > 0) {
    const chart = document.createElement('div')
    chart.className = 'metrics-chart'

    const title = document.createElement('div')
    title.className = 'metrics-chart__title'
    title.textContent = '함수/컴포넌트별 코드 줄 수 (클릭 시 해당 코드로 이동)'
    chart.appendChild(title)

    const maxLines = Math.max(...metrics.functionSizes.map(f => f.lines))

    const sorted = [...metrics.functionSizes].sort((a, b) => b.lines - a.lines)
    sorted.forEach(fn => {
      const bar = document.createElement('div')
      bar.className = 'metrics-bar'
      bar.style.cursor = 'pointer'
      const lineRange = `L${fn.startLine}–L${fn.endLine}`
      bar.title = `${fn.name} (${lineRange}, 총 ${fn.lines}줄) — 클릭 시 코드 이동`

      const pct = Math.round((fn.lines / maxLines) * 100)
      const color = fn.type === 'component'
        ? 'linear-gradient(90deg, hsl(280,70%,55%), hsl(280,70%,65%))'
        : 'linear-gradient(90deg, hsl(45,80%,50%), hsl(45,80%,60%))'

      const safeName = escapeHtml(fn.name)
      bar.innerHTML = `
        <span class="metrics-bar__label" title="${safeName}">${safeName} <small style="opacity:0.6; font-size:0.75rem;">(${lineRange})</small></span>
        <div class="metrics-bar__track">
          <div class="metrics-bar__fill" style="width:${pct}%; background:${color}">
            ${fn.lines}줄
          </div>
        </div>
      `

      if (onNavigate) {
        bar.addEventListener('click', () => onNavigate(fn.startLine))
      }

      chart.appendChild(bar)
    })

    container.appendChild(chart)
  }

  // Hook Breakdown
  if (Object.keys(metrics.hookBreakdown).length > 0) {
    const hookSection = document.createElement('div')
    hookSection.className = 'metrics-chart'
    hookSection.style.marginTop = '24px'

    const title = document.createElement('div')
    title.className = 'metrics-chart__title'
    title.textContent = 'Hook 사용 현황 (클릭 시 감지 위치로 이동)'
    hookSection.appendChild(title)

    const counts = Object.values(metrics.hookBreakdown).map(d => d.count)
    const maxHook = Math.max(...counts)

    Object.entries(metrics.hookBreakdown)
      .sort(([, a], [, b]) => b.count - a.count)
      .forEach(([name, details]) => {
        const bar = document.createElement('div')
        bar.className = 'metrics-bar'
        bar.style.cursor = 'pointer'
        const pct = Math.round((details.count / maxHook) * 100)
        const lineList = details.lines.map(l => `L${l}`).join(', ')
        bar.title = `${name}: 총 ${details.count}회 사용 (감지 라인: ${lineList}) — 클릭 시 이동`

        bar.innerHTML = `
          <span class="metrics-bar__label">${escapeHtml(name)}</span>
          <div class="metrics-bar__track" title="감지 위치: ${lineList}">
            <div class="metrics-bar__fill" style="width:${pct}%; background:linear-gradient(90deg, hsl(200,80%,50%), hsl(200,80%,60%))">
              ${details.count}회 (${lineList})
            </div>
          </div>
        `

        if (onNavigate && details.lines.length > 0) {
          bar.addEventListener('click', () => onNavigate(details.lines[0]))
        }

        hookSection.appendChild(bar)
      })

    container.appendChild(hookSection)
  }

  return container
}
