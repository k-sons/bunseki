/**
 * 붙여넣은 코드에서 온 문자열을 HTML 에 넣기 전에 반드시 거치는 곳.
 *
 * 렌더러들이 `innerHTML` 로 화면을 만드는데, 거기 섞이는 이름 중에는
 * **식별자가 아닌 것**이 있습니다 — import 경로(`'…'`), 구조분해 키의 문자열 리터럴 등.
 * 그대로 넣으면 남의 코드에 적힌 태그가 이 페이지의 진짜 엘리먼트가 됩니다.
 *
 * DOM 대신 문자열 치환을 쓰는 이유:
 * - 따옴표까지 막아야 `title="…"` 같은 **속성 자리**에서도 안전합니다
 *   (`textContent` 방식은 `<`, `>`, `&` 만 바꿔 속성 밖으로 새어 나갈 수 있습니다).
 * - DOM 이 없는 환경에서도 그대로 검증할 수 있습니다.
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}
