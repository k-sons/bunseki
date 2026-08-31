/**
 * Dual rails — 화면(React) 과 동작 흐름을 같은 시간축에 나란히 놓습니다.
 *
 * 엔진이 만드는 steps 배열은 바꾸지 않습니다. 각 스텝이 어느 레일에
 * 놓이는지만 붙입니다. UI 는 이 배열을 순서대로 그리기만 하면 됩니다.
 *
 *   screen — 눈에 보이는 변화 (클릭, 리렌더)
 *   flow   — 뒤에서 흐르는 제어 (함수 호출, Effect, 관문, 대기, 경계)
 *   mesh   — 두 축이 맞물리는 자리 (setState — 흐름이 화면을 건드림)
 *
 * flow 쪽만 움직이는 동안 화면 레일에는 "화면 유지" 를 달아,
 * 뒤에서는 일이 진행 중인데 화면은 아직 그대로라는 것을 보여 줍니다.
 * screen 쪽만 움직이는 동안 흐름 레일에는 "흐름 대기" 를 답니다.
 *
 * 비동기는 동작 흐름의 한 예일 뿐입니다. wait 도 call 과 같은 flow 레일입니다.
 */

const KIND_RAIL = {
  event: 'screen',
  rerender: 'screen',
  setter: 'mesh',
  call: 'flow',
  effect: 'flow',
  wait: 'flow',
  gate: 'flow',
  boundary: 'flow',
}

/**
 * @param {{kind?: string}|null} step
 * @returns {'screen'|'flow'|'mesh'}
 */
export function railOf(step) {
  if (!step || !step.kind) return 'flow'
  return KIND_RAIL[step.kind] || 'flow'
}

/**
 * setter 스텝의 화면 쪽 짧은 말 — "tab 변경".
 * detail 이 `→  tab` 형태가 아니면 "상태 변경".
 * @param {{kind?: string, detail?: string|null}} step
 * @returns {string|null}
 */
export function meshCaption(step) {
  if (!step || step.kind !== 'setter') return null
  const raw = String(step.detail || '').replace(/^→\s*/, '').trim()
  return raw ? `${raw} 변경` : '상태 변경'
}

/**
 * 비는 칸에 붙는 말. mesh 는 양쪽 다 내용이라 빈 칸이 없습니다.
 * @param {'screen'|'flow'|'mesh'|string|null} rail
 * @returns {'화면 유지'|'흐름 대기'|null}
 */
export function idleCaption(rail) {
  if (rail === 'flow') return '화면 유지'
  if (rail === 'screen') return '흐름 대기'
  return null
}

/**
 * @typedef {Object} RailRow
 * @property {object} step
 * @property {'screen'|'flow'|'mesh'} rail
 * @property {number} index
 */

/**
 * @param {object[]|null|undefined} steps
 * @returns {RailRow[]}
 */
export function toRailRows(steps) {
  if (!steps || steps.length === 0) return []
  return steps.map((step, index) => ({
    step,
    rail: railOf(step),
    index,
  }))
}
