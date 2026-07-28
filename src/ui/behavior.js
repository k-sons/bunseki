/**
 * Behavior View — 동작 연쇄 렌더러
 *
 * 상단에서 이벤트를 고르면, 그 이벤트가 일으키는 연쇄를 세로 스텝으로 보여줍니다.
 * 스텝을 클릭하면 하이라이트 탭의 해당 코드로 이동합니다.
 */

/** 스텝 종류별 표시 이름 */
const STEP_KIND_LABEL = {
  event: '이벤트',
  call: '함수 호출',
  setter: '상태 변경',
  effect: 'Effect 실행',
  rerender: '화면 갱신',
  boundary: '여기서부터 범위 밖',
}

/**
 * @param {import('../core/behavior/index.js').BehaviorResult} result
 * @param {(line: number) => void} onNavigate
 * @returns {HTMLElement}
 */
export function renderBehaviorView(result, onNavigate) {
  const container = document.createElement('div')
  container.className = 'behavior-view animate-in'

  if (result.error) {
    container.appendChild(renderError(result.error))
    return container
  }

  const withEvents = result.components.filter(c => c.events.length > 0)

  if (result.components.length === 0) {
    container.appendChild(
      renderEmpty('컴포넌트를 찾지 못했습니다', '대문자로 시작하는 함수 컴포넌트를 분석합니다.')
    )
    return container
  }

  if (withEvents.length === 0) {
    container.appendChild(
      renderEmpty(
        '이벤트 핸들러가 없습니다',
        'onClick, onChange 같은 이벤트에서 시작하는 상태 변화를 추적합니다.'
      )
    )
    container.appendChild(renderStateSummary(result.components, onNavigate))
    return container
  }

  // ===== 상단: 컴포넌트별 이벤트 칩 =====
  const picker = document.createElement('div')
  picker.className = 'behavior-picker'

  const detail = document.createElement('div')
  detail.className = 'behavior-detail'

  const allChips = []

  withEvents.forEach(comp => {
    const group = document.createElement('div')
    group.className = 'behavior-comp'

    const name = document.createElement('div')
    name.className = 'behavior-comp__name'
    name.textContent = comp.name
    if (comp.parent) {
      const inside = document.createElement('span')
      inside.className = 'behavior-comp__parent'
      inside.textContent = `${comp.parent} 안에 중첩됨`
      name.appendChild(inside)
    }
    group.appendChild(name)

    const chips = document.createElement('div')
    chips.className = 'behavior-chips'

    comp.events.forEach(ev => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'behavior-chip'
      chip.dataset.eventId = ev.id
      chip.title = `${ev.element} 의 ${ev.event} — L${ev.line}`
      chip.innerHTML = `
        <span class="behavior-chip__el">${ev.element}</span>
        <span class="behavior-chip__ev">${ev.event}</span>
        <span class="behavior-chip__line">L${ev.line}</span>
      `

      chip.addEventListener('click', () => {
        allChips.forEach(c => c.classList.remove('active'))
        chip.classList.add('active')
        detail.innerHTML = ''
        detail.appendChild(renderEventDetail(comp, ev, onNavigate))
      })

      chips.appendChild(chip)
      allChips.push(chip)
    })

    group.appendChild(chips)
    picker.appendChild(group)
  })

  container.appendChild(picker)
  container.appendChild(detail)

  // 첫 이벤트를 기본 선택
  allChips[0].click()

  return container
}

/** 선택된 이벤트의 연쇄 */
function renderEventDetail(comp, ev, onNavigate) {
  const wrap = document.createElement('div')
  wrap.className = 'behavior-flows'

  ev.flows.forEach((flow, i) => {
    if (ev.flows.length > 1) {
      const label = document.createElement('div')
      label.className = 'behavior-flow__label'
      label.textContent = `경로 ${i + 1} / ${ev.flows.length}`
      wrap.appendChild(label)
    }

    const flowEl = document.createElement('div')
    flowEl.className = 'behavior-flow stagger'

    flow.steps.forEach((step, idx) => {
      if (idx > 0) flowEl.appendChild(renderConnector(step))
      flowEl.appendChild(renderStep(step, idx + 1, onNavigate))
    })

    wrap.appendChild(flowEl)
  })

  if (ev.flows.length === 0) {
    wrap.appendChild(
      renderEmpty('상태를 바꾸지 않는 이벤트입니다', '이 핸들러에서 setState 호출을 찾지 못했습니다.')
    )
  }

  return wrap
}

/** 스텝 사이 화살표 — Effect 로 넘어갈 때는 이유를 함께 보여줍니다 */
function renderConnector(nextStep) {
  const conn = document.createElement('div')
  conn.className = 'behavior-connector'

  const arrow = document.createElement('span')
  arrow.className = 'behavior-connector__arrow'
  arrow.textContent = '↓'
  conn.appendChild(arrow)

  if (nextStep.note) {
    const note = document.createElement('span')
    note.className = 'behavior-connector__note'
    note.textContent = nextStep.note
    conn.appendChild(note)
  }

  return conn
}

function renderStep(step, num, onNavigate) {
  const el = document.createElement('div')
  el.className = `behavior-step behavior-step--${step.kind}`

  const badges = step.badges
    .map(b => `<span class="hl-badge behavior-step__badge">${b}</span>`)
    .join('')

  const detail = step.detail
    ? `<span class="behavior-step__detail">${step.detail}</span>`
    : ''

  const lineTag = step.line
    ? `<span class="behavior-step__line">L${step.line}</span>`
    : ''

  // 경계 스텝은 이유를 함께 보여줘야 "도구가 못 찾은 것"과 구분됩니다
  const note = step.kind === 'boundary' && step.note
    ? `<span class="behavior-step__hint">${step.note}</span>`
    : ''

  el.innerHTML = `
    <span class="behavior-step__num">${step.kind === 'boundary' ? '·' : num}</span>
    <span class="behavior-step__body">
      <span class="behavior-step__kind">${STEP_KIND_LABEL[step.kind] || step.kind}</span>
      <span class="behavior-step__label">${step.label}${detail}${badges}</span>
      ${note}
    </span>
    ${lineTag}
  `

  if (step.line && onNavigate) {
    el.classList.add('is-clickable')
    el.title = `L${step.line} 로 이동`
    el.addEventListener('click', () => onNavigate(step.line))
  }

  return el
}

/** 이벤트가 없을 때라도 상태/Effect 는 보여줍니다 */
function renderStateSummary(components, onNavigate) {
  const wrap = document.createElement('div')
  wrap.className = 'behavior-summary'

  components.forEach(comp => {
    if (comp.states.length === 0 && comp.effects.length === 0) return

    const name = document.createElement('div')
    name.className = 'behavior-comp__name'
    name.textContent = comp.name
    wrap.appendChild(name)

    comp.states.forEach(s => {
      const row = document.createElement('div')
      row.className = 'behavior-step behavior-step--setter is-clickable'

      const kindLabel = s.kind === 'store' ? '외부 스토어'
        : s.kind === 'reducer' ? '상태 (useReducer)'
        : '상태'
      const target = s.state || 'Redux 스토어'

      row.innerHTML = `
        <span class="behavior-step__body">
          <span class="behavior-step__kind">${kindLabel}</span>
          <span class="behavior-step__label">${target}<span class="behavior-step__detail">← ${s.setter || '?'}</span></span>
        </span>
        <span class="behavior-step__line">L${s.line}</span>
      `
      if (onNavigate) row.addEventListener('click', () => onNavigate(s.line))
      wrap.appendChild(row)
    })

    comp.effects.forEach(e => {
      const row = document.createElement('div')
      row.className = 'behavior-step behavior-step--effect is-clickable'
      row.innerHTML = `
        <span class="behavior-step__body">
          <span class="behavior-step__kind">Effect</span>
          <span class="behavior-step__label">${e.when}</span>
        </span>
        <span class="behavior-step__line">L${e.line}</span>
      `
      if (onNavigate) row.addEventListener('click', () => onNavigate(e.line))
      wrap.appendChild(row)
    })
  })

  return wrap
}

function renderError(error) {
  const el = document.createElement('div')
  el.className = 'behavior-error'
  el.innerHTML = `
    <div class="behavior-error__title">문법 오류로 동작을 분석할 수 없습니다</div>
    <div class="behavior-error__msg">${escapeHtml(error.message)}</div>
    ${error.line ? `<div class="behavior-error__line">L${error.line}</div>` : ''}
    <div class="behavior-error__hint">
      동작 분석은 문법이 온전한 코드에만 적용됩니다.
      다른 탭은 그대로 사용할 수 있습니다.
    </div>
  `
  return el
}

function renderEmpty(title, hint) {
  const el = document.createElement('div')
  el.className = 'placeholder-msg'
  el.innerHTML = `<p><strong>${title}</strong></p><span class="placeholder-shortcut">${hint}</span>`
  return el
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
