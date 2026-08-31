/**
 * Structure View — 구조맵 사이드바 렌더러
 *
 * 함수/컴포넌트/상수/import 목록을 트리 형태로 표시합니다.
 * 각 항목 클릭 시 하이라이트 뷰에서 해당 코드로 스크롤합니다.
 */

import { escapeHtml } from '../core/escape.js'

/**
 * 구조맵 뷰를 렌더합니다.
 * @param {import('../core/parser').ParseResult} analysis
 * @param {Function} onNavigate - 라인 번호로 이동하는 콜백
 * @returns {HTMLElement}
 */
export function renderStructureView(analysis, onNavigate) {
  const container = document.createElement('div')
  container.className = 'structure-view animate-in'

  // Components section
  const components = analysis.functions.filter(f => f.type === 'component')
  if (components.length > 0) {
    container.appendChild(
      createSection('컴포넌트', components.map(fn => ({
        icon: 'comp',
        iconLabel: 'C',
        name: fn.name,
        meta: formatMeta(fn),
        lines: `L${fn.startLine}–${fn.endLine}`,
        startLine: fn.startLine,
        badges: formatBadges(fn),
      })), onNavigate)
    )
  }

  // Functions section
  const helpers = analysis.functions.filter(f => f.type === 'function')
  if (helpers.length > 0) {
    container.appendChild(
      createSection('함수', helpers.map(fn => ({
        icon: 'fn',
        iconLabel: 'F',
        name: fn.name,
        meta: formatMeta(fn),
        lines: `L${fn.startLine}–${fn.endLine}`,
        startLine: fn.startLine,
        badges: formatBadges(fn),
      })), onNavigate)
    )
  }

  // Constants section
  if (analysis.constants.length > 0) {
    container.appendChild(
      createSection('상수 / 데이터', analysis.constants.map(c => ({
        icon: 'const',
        iconLabel: 'V',
        name: c.name,
        meta: c.kind + (c.isArray ? ' [ ]' : c.isObject ? ' { }' : ''),
        lines: `L${c.startLine}`,
        startLine: c.startLine,
        badges: '',
      })), onNavigate)
    )
  }

  // Imports section
  if (analysis.imports.length > 0) {
    container.appendChild(
      createSection('Import', analysis.imports.map(imp => {
        let badge = ''
        if (imp.isRN) badge = '<span class="hl-badge hl-badge--rn">RN</span>'
        else if (imp.isReact) badge = '<span class="hl-badge hl-badge--hook">React</span>'

        return {
          icon: 'import',
          iconLabel: 'I',
          name: imp.module,
          meta: imp.names.length > 0 ? `{ ${imp.names.slice(0, 3).join(', ')}${imp.names.length > 3 ? ' ...' : ''} }` : '',
          lines: `L${imp.startLine}`,
          startLine: imp.startLine,
          badges: badge,
        }
      }), onNavigate)
    )
  }

  // Hooks summary
  if (analysis.hooks.length > 0) {
    const hookNames = [...new Set(analysis.hooks.map(h => h.name))]
    container.appendChild(
      createSection('Hook 사용', hookNames.map(name => {
        const matches = analysis.hooks.filter(h => h.name === name)
        const count = matches.length
        const first = matches[0]
        const lineStr = matches.map(m => `L${m.line}`).join(', ')
        const isRN = first.isRN

        return {
          icon: 'hook',
          iconLabel: 'H',
          name: name,
          meta: `${count}회 사용`,
          lines: lineStr,
          startLine: first.line,
          badges: isRN ? '<span class="hl-badge hl-badge--rn">RN</span>' : '',
        }
      }), onNavigate)
    )
  }

  return container
}

function createSection(title, items, onNavigate) {
  const section = document.createElement('div')
  section.className = 'structure-section'

  const titleEl = document.createElement('div')
  titleEl.className = 'structure-section__title'
  titleEl.textContent = `${title} (${items.length})`
  section.appendChild(titleEl)

  const list = document.createElement('div')
  list.className = 'stagger'

  items.forEach(item => {
    const el = document.createElement('div')
    el.className = 'structure-item'
    el.title = `${item.name} — ${item.lines}`

    // badges 는 이 파일이 직접 만든 HTML 이라 그대로 넣습니다.
    // 나머지는 붙여넣은 코드에서 온 문자열이므로 전부 이스케이프합니다.
    el.innerHTML = `
      <div class="structure-item__icon structure-item__icon--${item.icon}">${item.iconLabel}</div>
      <span class="structure-item__name">${escapeHtml(item.name)}</span>
      ${item.badges || ''}
      <span class="structure-item__meta">${escapeHtml(item.meta)}</span>
      <span class="structure-item__lines">${escapeHtml(item.lines)}</span>
    `

    el.addEventListener('click', () => {
      // Navigate to line in highlight view
      if (onNavigate) onNavigate(item.startLine)

      // Mark active
      list.querySelectorAll('.structure-item.active').forEach(el => el.classList.remove('active'))
      el.classList.add('active')
    })

    list.appendChild(el)
  })

  section.appendChild(list)
  return section
}

function formatMeta(fn) {
  const parts = []
  if (fn.params.length > 0) {
    parts.push(`(${fn.params.slice(0, 3).join(', ')}${fn.params.length > 3 ? '...' : ''})`)
  } else {
    parts.push('()')
  }
  parts.push(`${fn.lineCount}줄`)
  return parts.join(' · ')
}

function formatBadges(fn) {
  let badges = ''
  
  // Complexity Warnings
  // hooks 는 배지용이라 이름 기준 중복 제거된 목록입니다 — 덩치 판정에 쓰면
  // useState 를 마흔 번 부른 컴포넌트도 1 로 세어 그냥 지나갑니다.
  const hookCalls = fn.hookCallCount ?? (fn.hooks ? fn.hooks.length : 0)
  const isTooLong = fn.lineCount > 100
  const hasTooManyHooks = hookCalls > 5

  if (isTooLong || hasTooManyHooks) {
    const reason = isTooLong && hasTooManyHooks ? `Too long & many hooks (${hookCalls})`
                 : isTooLong ? 'Too long (>100 lines)'
                 : `Too many hooks (${hookCalls} > 5)`
    badges += `<span class="hl-badge" style="background:hsla(0,80%,55%,0.15); color:hsl(0,80%,60%)" title="Refactoring Recommended: ${reason}">🚨 Refactor</span>`
  }

  if (fn.isAsync) {
    badges += `<span class="hl-badge" style="background:hsla(200,80%,55%,0.15); color:hsl(200,80%,65%)">Async</span>`
  }

  if (fn.hooks && fn.hooks.length > 0) {
    badges += fn.hooks.slice(0, 2).map(h =>
      `<span class="hl-badge hl-badge--hook-${h.category || 'other'}" style="font-size:0.58rem">${escapeHtml(h.name)}</span>`
    ).join('')
    if (fn.hooks.length > 2) {
      badges += `<span class="hl-badge" style="font-size:0.58rem">+${fn.hooks.length - 2}</span>`
    }
  }
  if (fn.handlers && fn.handlers.length > 0) {
    badges += `<span class="hl-badge hl-badge--handler" style="font-size:0.58rem">${fn.handlers.length} handler</span>`
  }
  if (fn.isExported) {
    badges += `<span class="hl-badge" style="font-size:0.58rem; background:hsla(15,80%,60%,0.15); color:hsl(15,80%,65%)">export</span>`
  }
  return badges
}
