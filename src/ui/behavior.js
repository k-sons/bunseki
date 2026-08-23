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
  wait: '대기',
  boundary: '여기서부터 범위 밖',
}

/**
 * 붙여넣은 코드에서 온 문자열은 **반드시** 이걸 거쳐야 합니다.
 * 그러지 않으면 `<button onClick>` 같은 라벨이 innerHTML 에서 진짜 엘리먼트로
 * 렌더돼 스텝이 깨집니다(그리고 남의 코드를 이 페이지에 심는 통로가 됩니다).
 */
const esc = (v) => escapeHtml(String(v ?? ''))

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
    appendAnalysisSections(container, result.components, onNavigate)
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
        <span class="behavior-chip__el">${esc(ev.element)}</span>
        <span class="behavior-chip__ev">${esc(ev.event)}</span>
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

  appendAnalysisSections(container, result.components, onNavigate)

  return container
}

/** 이벤트 연쇄 아래에 붙는 분석 섹션들 — 순서: 타이밍 → Effect 사이 관계 */
function appendAnalysisSections(container, components, onNavigate) {
  const timing = renderTimingSection(components, onNavigate)
  if (timing) container.appendChild(timing)

  const interplay = renderInterplaySection(components, onNavigate)
  if (interplay) container.appendChild(interplay)
}

/**
 * ⏱ 타이밍 — effect 가 언제 무엇을 하는지 가로 타임라인으로 보여주고,
 * 두 가지 함정을 경고합니다.
 *   - 응답 전 언마운트되면 없는 컴포넌트에 setState 하는 위험
 *   - deps 에서 빠진 값 — effect 가 옛 값을 붙잡고 있음 (stale closure)
 * 흐름 안에는 관문(gate)도 함께 그립니다 — 조건이 참이면 되돌아 나가는 자리라
 * 타임라인이 "언제나 끝까지 간다" 처럼 보이지 않게 합니다.
 * 짚을 것이 없는 동기 effect 는 흐름이 단순하므로 여기서는 생략합니다.
 */
function renderTimingSection(components, onNavigate) {
  const notable = components
    .map(c => ({
      name: c.name,
      effects: (c.timing || []).filter(e => e.isAsync || staleNames(e).length > 0),
    }))
    .filter(c => c.effects.length > 0)

  if (notable.length === 0) return null

  const section = document.createElement('div')
  section.className = 'behavior-timing'

  const title = document.createElement('div')
  title.className = 'behavior-timing__title'
  const riskCount = notable.reduce((n, c) => n + c.effects.filter(e => e.risk).length, 0)
  const staleCount = notable.reduce((n, c) => n + c.effects.filter(e => staleNames(e).length > 0).length, 0)
  title.innerHTML = [
    '⏱ 타이밍 · deps 점검',
    riskCount ? `<span class="behavior-timing__riskcount">위험 ${riskCount}</span>` : '',
    staleCount ? `<span class="behavior-timing__stalecount">deps 빠짐 ${staleCount}</span>` : '',
  ].filter(Boolean).join(' ')
  section.appendChild(title)

  notable.forEach(comp => {
    const name = document.createElement('div')
    name.className = 'behavior-comp__name'
    name.textContent = comp.name
    section.appendChild(name)

    comp.effects.forEach(effect => {
      section.appendChild(renderTimingTrack(effect, onNavigate))
    })
  })

  return section
}

/** 대기 알약의 폭 = weight × 이 값(px). 최대 무게는 12 (timing.js 와 맞춘 상한). */
const WAIT_PX_PER_WEIGHT = 22
const WAIT_WEIGHT_MAX = 12
/** 이벤트 연쇄는 세로라 높이로 나타냅니다 — 세로 공간이 아까워 더 촘촘하게 */
const WAIT_PX_PER_WEIGHT_V = 7

/** deps 에서 빠진 값 이름들 (없으면 빈 배열) */
function staleNames(effect) {
  return (effect.staleDeps || []).map(d => d.name)
}

function renderTimingTrack(effect, onNavigate) {
  const stale = staleNames(effect)

  const track = document.createElement('div')
  track.className = 'timing-track'
    + (effect.risk ? ' timing-track--risk' : stale.length ? ' timing-track--stale' : '')

  const head = document.createElement('div')
  head.className = 'timing-track__head'
  const triggerStep = effect.timeline.find(s => s.kind === 'trigger')
  head.innerHTML = `
    <span class="timing-track__when">${esc(triggerStep ? triggerStep.label : effect.hook)}</span>
    ${effect.viaHook ? `<span class="hl-badge">${esc(effect.viaHook)}</span>` : ''}
    ${stale.length ? `<span class="timing-track__stale">⚠ [${esc(stale.join(', '))}] 빠짐?</span>` : ''}
    ${effect.hasCleanup ? '<span class="timing-track__flag">정리 있음</span>' : '<span class="timing-track__flag timing-track__flag--off">정리 없음</span>'}
    ${effect.line ? `<span class="timing-track__line">L${effect.line}</span>` : ''}
  `
  if (effect.line && onNavigate) {
    head.classList.add('is-clickable')
    head.addEventListener('click', () => onNavigate(effect.line))
  }
  track.appendChild(head)

  const flow = document.createElement('div')
  flow.className = 'timing-flow'
  const visualSteps = effect.timeline.filter(
    s => s.kind !== 'trigger' && s.kind !== 'risk' && s.kind !== 'stale'
  )
  visualSteps.forEach((step, i) => {
    if (i > 0) {
      const arrow = document.createElement('span')
      arrow.className = 'timing-arrow'
      arrow.textContent = '→'
      flow.appendChild(arrow)
    }
    flow.appendChild(renderTimingPill(step, onNavigate))
  })
  track.appendChild(flow)

  const risk = effect.timeline.find(s => s.kind === 'risk')
  if (risk) track.appendChild(renderTimingWarn(risk, ''))

  const staleStep = effect.timeline.find(s => s.kind === 'stale')
  if (staleStep) track.appendChild(renderTimingWarn(staleStep, ' timing-warn--stale'))

  return track
}

function renderTimingWarn(step, modifier) {
  const warn = document.createElement('div')
  warn.className = 'timing-warn' + modifier
  warn.innerHTML = `<span class="timing-warn__label">⚠ ${esc(step.label)}</span><span class="timing-warn__note">${esc(step.note)}</span>`
  return warn
}

function renderTimingPill(step, onNavigate) {
  const pill = document.createElement('span')
  pill.className = `timing-pill timing-pill--${step.kind}` + (step.phase ? ` timing-pill--${step.phase}` : '')

  // 기다리는 구간만 폭을 키웁니다 — 모든 스텝이 같은 크기면 setLoading(true) 와
  // "응답 대기" 가 같은 무게로 보여, 시간이 흐르는 자리가 드러나지 않습니다.
  // step.weight 는 즉시 실행을 1 로 본 상대적인 눈금입니다 (실제 ms 아님).
  if (step.weight > 1) {
    pill.classList.add('timing-pill--wide')
    pill.style.minWidth = `min(${Math.min(step.weight, WAIT_WEIGHT_MAX) * WAIT_PX_PER_WEIGHT}px, 100%)`
    pill.title = step.waitMs != null
      ? '기다리는 구간 — 코드에 적힌 지연값을 폭으로 옮겼습니다'
      : '기다리는 구간 — 실제 시간은 코드로 알 수 없어 대략적인 폭입니다'
  }

  const detail = step.detail ? `<span class="timing-pill__detail">${esc(step.detail)}</span>` : ''
  // setter 꼬리표는 단계마다 궁금한 것이 다릅니다 —
  // 응답 뒤에는 "언마운트 가드가 있나", 곧바로 부르는 자리에서는 "늘 실행되나".
  const guard = step.kind !== 'setter' ? ''
    : step.phase === 'async'
      ? `<span class="timing-pill__guard">${step.guarded ? '🛡 가드됨' : '가드 없음'}</span>`
      : step.conditional
        ? '<span class="timing-pill__guard">조건부</span>'
        : ''
  pill.innerHTML = `<span class="timing-pill__label">${esc(step.label)}${detail}</span>${guard}`
  if (step.kind === 'async-wait') pill.setAttribute('aria-label', `${step.label} — ${step.detail}`)

  // 관문 — 조건이 참이면 아래 단계로 가지 않는다는 뜻입니다.
  // 끊긴 테두리만으로는 전해지지 않으므로 설명을 함께 답니다.
  if (step.kind === 'gate' && step.note) {
    pill.title = step.note
    pill.setAttribute('aria-label', `${step.label} — ${step.note}`)
  }

  if (step.line && onNavigate) {
    pill.classList.add('is-clickable')
    pill.addEventListener('click', () => onNavigate(step.line))
  }
  return pill
}

/**
 * 🔗 Effect 사이 관계 — 여러 Effect 가 같은 상태를 두고 얽히는 모습.
 *   무한 루프 : deps 로 쓰는 상태를 스스로(혹은 서로) 되받아 멈추지 않음
 *   경합      : 같은 상태를 여러 Effect 가 바꿈 — 누가 마지막에 쓰나
 *   연쇄      : A 가 바꾼 상태를 B 가 deps 로 써서 이어서 실행됨
 */
function renderInterplaySection(components, onNavigate) {
  const notable = components
    .map(c => ({ name: c.name, items: c.interplay || [] }))
    .filter(c => c.items.length > 0)

  if (notable.length === 0) return null

  const all = notable.flatMap(c => c.items)
  const loopCount = all.filter(i => i.kind === 'loop').length
  const raceCount = all.filter(i => i.kind === 'contention').length

  const section = document.createElement('div')
  section.className = 'behavior-timing behavior-interplay'

  const title = document.createElement('div')
  title.className = 'behavior-timing__title'
  title.innerHTML = [
    '🔗 Effect 사이 관계',
    loopCount ? `<span class="behavior-timing__riskcount">무한 루프 ${loopCount}</span>` : '',
    raceCount ? `<span class="behavior-timing__stalecount">경합 ${raceCount}</span>` : '',
  ].filter(Boolean).join(' ')
  section.appendChild(title)

  notable.forEach(comp => {
    const name = document.createElement('div')
    name.className = 'behavior-comp__name'
    name.textContent = comp.name
    section.appendChild(name)

    comp.items.forEach(item => section.appendChild(renderInterplayCard(item, onNavigate)))
  })

  return section
}

/** 항목 종류별 표시 이름 */
const INTERPLAY_KIND_LABEL = {
  loop: '무한 루프',
  contention: '경합',
  cascade: '연쇄',
}

function renderInterplayCard(item, onNavigate) {
  const card = document.createElement('div')
  card.className = `interplay-card interplay-card--${item.severity}`

  const head = document.createElement('div')
  head.className = 'timing-track__head'
  head.innerHTML = `
    <span class="interplay-card__kind interplay-card__kind--${item.kind}">${INTERPLAY_KIND_LABEL[item.kind] || item.kind}</span>
    <span class="interplay-card__label">${esc(item.label)}</span>
    <span class="timing-track__line">${item.lines.map(l => `L${l}`).join(' · ')}</span>
  `
  card.appendChild(head)

  // 경합은 순서가 정해져 있지 않다는 뜻으로 ⇄, 연쇄·루프는 흐르는 방향으로 →
  const separator = item.kind === 'contention' ? '⇄' : '→'
  const flow = document.createElement('div')
  flow.className = 'timing-flow'
  item.steps.forEach((step, i) => {
    if (i > 0) {
      const arrow = document.createElement('span')
      arrow.className = 'timing-arrow'
      arrow.textContent = separator
      flow.appendChild(arrow)
    }
    flow.appendChild(renderInterplayPill(step, onNavigate))
  })
  card.appendChild(flow)

  const note = document.createElement('div')
  note.className = 'timing-warn interplay-card__note'
    + (item.severity === 'info' ? ' interplay-card__note--info' : '')
    + (item.severity === 'warn' ? ' timing-warn--stale' : '')
  note.innerHTML = `<span class="timing-warn__note">${esc(item.note)}</span>`
  card.appendChild(note)

  return card
}

/**
 * 관계 알약 — 타이밍 알약과 같은 모양이되 꼬리표가 다릅니다.
 * 여기서 궁금한 것은 "언마운트 가드가 있나" 가 아니라
 * "이 변경이 비동기라 순서가 흔들리나 · 조건 안이라 멈출 수 있나" 입니다.
 */
function renderInterplayPill(step, onNavigate) {
  const pill = document.createElement('span')
  pill.className = `timing-pill timing-pill--${step.kind}` + (step.phase ? ` timing-pill--${step.phase}` : '')

  const detail = step.detail ? `<span class="timing-pill__detail">${esc(step.detail)}</span>` : ''
  const tag = step.kind !== 'setter' ? ''
    : step.phase === 'async' ? '<span class="timing-pill__guard">응답 뒤</span>'
    : step.guarded ? '<span class="timing-pill__guard">조건부</span>'
    : ''
  pill.innerHTML = `<span class="timing-pill__label">${esc(step.label)}${detail}</span>${tag}`

  if (step.line && onNavigate) {
    pill.classList.add('is-clickable')
    pill.addEventListener('click', () => onNavigate(step.line))
  }
  return pill
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

    let num = 0
    flow.steps.forEach((step, idx) => {
      if (idx > 0) flowEl.appendChild(renderConnector(step))
      if (step.kind === 'wait') {
        flowEl.appendChild(renderWaitStep(step))
        return
      }
      flowEl.appendChild(renderStep(step, ++num, onNavigate))
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

/**
 * 이벤트 연쇄의 기다리는 구간.
 *
 * ⏱ 타임라인은 가로라 폭으로, 이 연쇄는 세로라 **높이**로 같은 눈금을 나타냅니다.
 * 세로 공간은 아까우니 가로보다 촘촘하게(weight × 7px) 씁니다.
 */
function renderWaitStep(step) {
  const el = document.createElement('div')
  el.className = 'behavior-wait'
  el.style.minHeight = `${Math.min(step.weight || 1, WAIT_WEIGHT_MAX) * WAIT_PX_PER_WEIGHT_V}px`
  el.setAttribute('aria-label', `${step.label} — ${step.detail}`)
  el.title = step.waitMs != null
    ? '기다리는 구간 — 코드에 적힌 지연값을 높이로 옮겼습니다'
    : '기다리는 구간 — 실제 시간은 코드로 알 수 없어 대략적인 높이입니다'
  el.innerHTML = `
    <span class="behavior-wait__label">⏳ ${esc(step.label)}</span>
    <span class="behavior-wait__detail">${esc(step.detail)}</span>
  `
  return el
}

function renderStep(step, num, onNavigate) {
  const el = document.createElement('div')
  el.className = `behavior-step behavior-step--${step.kind}`

  const badges = step.badges
    .map(b => `<span class="hl-badge behavior-step__badge">${esc(b)}</span>`)
    .join('')

  const detail = step.detail
    ? `<span class="behavior-step__detail">${esc(step.detail)}</span>`
    : ''

  const lineTag = step.line
    ? `<span class="behavior-step__line">L${step.line}</span>`
    : ''

  // 경계 스텝은 이유를 함께 보여줘야 "도구가 못 찾은 것"과 구분됩니다
  const note = step.kind === 'boundary' && step.note
    ? `<span class="behavior-step__hint">${esc(step.note)}</span>`
    : ''

  el.innerHTML = `
    <span class="behavior-step__num">${step.kind === 'boundary' ? '·' : num}</span>
    <span class="behavior-step__body">
      <span class="behavior-step__kind">${STEP_KIND_LABEL[step.kind] || step.kind}</span>
      <span class="behavior-step__label">${esc(step.label)}${detail}${badges}</span>
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
          <span class="behavior-step__label">${esc(target)}<span class="behavior-step__detail">← ${esc(s.setter || '?')}</span></span>
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
          <span class="behavior-step__label">${esc(e.when)}</span>
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
