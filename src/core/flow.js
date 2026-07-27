/**
 * Flow — 컴포넌트 의존성 플로우 다이어그램 렌더러
 *
 * 파서의 relations 데이터를 받아 트리 형태의 플로우 다이어그램을 생성합니다.
 */

/**
 * 플로우 뷰를 렌더합니다.
 * @param {import('./parser').ParseResult} analysis
 * @returns {HTMLElement}
 */
export function renderFlowView(analysis, onNavigate) {
  const container = document.createElement('div')
  container.className = 'flow-view animate-in'

  if (analysis.relations.length === 0 && analysis.functions.length === 0) {
    container.innerHTML = `
      <div class="placeholder-msg">
        <p>컴포넌트 관계가 발견되지 않았습니다</p>
      </div>
    `
    return container
  }

  const title = document.createElement('div')
  title.className = 'metrics-chart__title'
  title.textContent = '컴포넌트 / 함수 관계도 (상자를 클릭하면 해당 코드로 이동)'
  title.style.textAlign = 'center'
  title.style.marginBottom = '16px'
  container.appendChild(title)

  const diagram = document.createElement('div')
  diagram.className = 'flow-diagram stagger'

  // Build adjacency
  const adj = new Map()
  for (const rel of analysis.relations) {
    if (!adj.has(rel.from)) adj.set(rel.from, [])
    adj.get(rel.from).push(rel)
  }

  // Find root nodes (nodes that are not targets)
  const allTargets = new Set(analysis.relations.map(r => r.to))
  const roots = analysis.functions
    .filter(f => f.type === 'component' && !allTargets.has(f.name))

  // If no roots found, show all components
  const nodesToShow = roots.length > 0 ? roots : analysis.functions.filter(f => f.type === 'component')

  if (nodesToShow.length === 0) {
    // Show all functions as flat list
    analysis.functions.forEach(fn => {
      diagram.appendChild(createFlowNode(fn, analysis, onNavigate))
    })
  } else {
    // Render tree
    const rendered = new Set()
    nodesToShow.forEach(root => {
      renderFlowTree(diagram, root, adj, analysis, 0, rendered, onNavigate)
    })

    // Show orphan helpers
    const helpers = analysis.functions.filter(
      f => f.type === 'function' && !rendered.has(f.name)
    )
    if (helpers.length > 0) {
      const helperTitle = document.createElement('div')
      helperTitle.className = 'metrics-chart__title'
      helperTitle.textContent = '독립 헬퍼 함수 (미사용 가능성 높음)'
      helperTitle.style.marginTop = '20px'
      helperTitle.style.marginBottom = '8px'
      diagram.appendChild(helperTitle)

      helpers.forEach(fn => {
        diagram.appendChild(createFlowNode(fn, analysis, onNavigate))
      })
    }
  }

  container.appendChild(diagram)

  // Legend & Beginner Guide
  const legend = document.createElement('div')
  legend.style.cssText = 'margin-top: 20px; display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; background: var(--bg-panel); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);'
  legend.innerHTML = `
    <span style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-secondary)">
      <span style="width:10px;height:10px;border-radius:3px;background:hsl(280,70%,60%)"></span> 🟣 화면 상자(컴포넌트)
    </span>
    <span style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-secondary)">
      <span style="width:10px;height:10px;border-radius:3px;background:hsl(45,85%,55%)"></span> 🟡 도우미 상자(함수)
    </span>
    <span style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-secondary)">
      <svg width="16" height="10"><line x1="0" y1="5" x2="16" y2="5" stroke="var(--text-tertiary)" stroke-width="1.5"/></svg> ─── renders (화면에 그림)
    </span>
    <span style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-secondary)">
      <svg width="16" height="10"><line x1="0" y1="5" x2="16" y2="5" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-dasharray="3,2"/></svg> - - - calls (일 시킴)
    </span>
    <span style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:hsl(200,80%,60%); font-weight:600">
      🩵 calls Async (비동기 처리)
    </span>
  `
  container.appendChild(legend)

  return container
}

function renderFlowTree(parent, fn, adj, analysis, depth, rendered, onNavigate) {
  if (rendered.has(fn.name)) return
  rendered.add(fn.name)

  const node = createFlowNode(fn, analysis, onNavigate)
  parent.appendChild(node)

  const children = adj.get(fn.name) || []
  if (children.length > 0) {
    const childContainer = document.createElement('div')
    childContainer.className = 'flow-children'

    children.forEach(rel => {
      // Connector
      const connector = document.createElement('div')
      connector.className = 'flow-connector'
      
      const isDashed = rel.type === 'calls'
      const strokeColor = rel.isAsync ? 'hsl(200, 80%, 60%)' : 'currentColor'
      
      connector.innerHTML = `
        <svg width="16" height="20" viewBox="0 0 16 20">
          <line x1="8" y1="0" x2="8" y2="20" stroke="${strokeColor}" stroke-width="1.5"
            ${isDashed ? 'stroke-dasharray="3,2"' : ''} />
          <polygon points="4,14 12,14 8,20" fill="${strokeColor}" opacity="0.5"/>
        </svg>
        <span style="font-size:0.62rem;color:var(--text-tertiary); display:flex; align-items:center; gap:3px;">
          ${rel.type}
          ${rel.isAsync ? '<span style="color:hsl(200,80%,60%); font-weight:bold">Async</span>' : ''}
        </span>
      `
      childContainer.appendChild(connector)

      const targetFn = analysis.functions.find(f => f.name === rel.to)
      if (targetFn) {
        renderFlowTree(childContainer, targetFn, adj, analysis, depth + 1, rendered, onNavigate)
      }
    })

    parent.appendChild(childContainer)
  }
}

function createFlowNode(fn, analysis, onNavigate) {
  const node = document.createElement('div')
  node.className = 'flow-node'
  node.dataset.fnName = fn.name
  node.style.cursor = 'pointer'
  const lineRange = `L${fn.startLine}–L${fn.endLine}`
  node.title = `${fn.name} (${lineRange}, 총 ${fn.lineCount}줄) — 클릭 시 해당 코드로 이동`

  const isComponent = fn.type === 'component'
  const typeColor = isComponent ? 'hsl(280,70%,60%)' : 'hsl(45,85%,55%)'
  const typeLabel = isComponent ? 'Component' : 'Function'

  let hookBadges = ''
  if (fn.hooks && fn.hooks.length > 0) {
    hookBadges = fn.hooks.map(h => 
      `<span class="hl-badge hl-badge--hook-${h.category || 'other'}" style="font-size:0.58rem; margin-left:2px">${h.name}</span>`
    ).join('')
  }

  let asyncBadge = ''
  if (fn.isAsync) {
    asyncBadge = `<span class="hl-badge" style="background:hsla(200,80%,55%,0.15); color:hsl(200,80%,60%)">Async</span>`
  }

  node.innerHTML = `
    <span class="flow-node__type" style="background:${typeColor}; color:white">${typeLabel}</span>
    <span class="flow-node__name">${fn.name}</span>
    <span style="font-size:0.68rem; color:var(--text-tertiary)">${lineRange} (${fn.lineCount}줄)</span>
    ${asyncBadge}
    ${hookBadges}
  `

  if (onNavigate) {
    node.addEventListener('click', () => onNavigate(fn.startLine))
  }

  return node
}
