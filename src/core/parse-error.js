/**
 * 파싱 오류를 사람이 읽을 수 있는 형태로 바꿉니다.
 *
 * 구조 분석기(`parser.js`)와 동작 분석기(`behavior/index.js`)가 **같은 @babel/parser 를
 * 쓰므로 같은 오류를 만납니다.** 두 곳이 다른 말을 하면 사용자가 헷갈리므로 한 곳에 둡니다.
 */

/** 알려진 오류만 번역하고, 나머지는 원문을 그대로 보여 줍니다. */
const KNOWN = {
  UnterminatedJsxContent: 'JSX 태그가 닫히지 않았습니다. 코드가 중간에 잘렸는지 확인해 주세요.',
  UnexpectedToken: '예상하지 못한 토큰이 있습니다.',
  UnterminatedString: '문자열이 닫히지 않았습니다.',
  UnterminatedComment: '주석이 닫히지 않았습니다.',
  MissingSemicolon: '구문이 올바르게 끝나지 않았습니다.',
}

/**
 * @param {Error} err - @babel/parser 가 던진 오류
 * @returns {string}
 */
export function translateParseError(err) {
  const raw = String(err.message || '').replace(/\s*\(\d+:\d+\)\s*$/, '')
  return KNOWN[err.reasonCode] || raw
}

/**
 * 오류를 결과 객체에 실어 보낼 형태로 만듭니다.
 * @param {Error} err
 * @returns {{message: string, line: number|null}}
 */
export function toParseError(err) {
  return {
    message: translateParseError(err),
    line: err.loc ? err.loc.line : null,
  }
}
