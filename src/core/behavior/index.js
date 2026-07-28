/**
 * Behavior Analysis — 진입점
 *
 * 코드가 "무엇으로 이루어졌는가"(기존 parser.js)가 아니라
 * "어떻게 동작하는가"를 분석합니다.
 *
 * 이 모듈만 @babel/parser 를 import 하므로, main.js 에서 동적 import 하면
 * 파서가 별도 청크로 분리되어 초기 로딩에 포함되지 않습니다.
 */

import { parse } from '@babel/parser'
import { findComponents, collectComponent } from './collect.js'
import { findCustomHooks, analyzeHook, resolveHookCalls, getPropNames } from './hooks.js'
import { buildEvents, describeEffects } from './chain.js'

/**
 * @typedef {Object} Step
 * @property {'event'|'setter'|'effect'|'call'|'rerender'} kind
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [note]
 * @property {number|null} line
 * @property {string[]} badges
 */

/**
 * @typedef {Object} BehaviorResult
 * @property {ComponentBehavior[]} components
 * @property {{message: string, line: number|null}|null} error
 */

const PARSE_OPTIONS = {
  sourceType: 'module',
  errorRecovery: true,
  plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
}

/**
 * 코드의 동작 연쇄를 분석합니다.
 * @param {string} code
 * @returns {BehaviorResult}
 */
export function parseBehavior(code) {
  let ast
  try {
    ast = parse(code, PARSE_OPTIONS)
  } catch (err) {
    return {
      components: [],
      error: {
        message: translateParseError(err),
        line: err.loc ? err.loc.line : null,
      },
    }
  }

  const found = findComponents(ast)

  // 중첩 컴포넌트의 상태·Effect 가 바깥 컴포넌트 것으로 섞이지 않도록,
  // 수집할 때 다른 컴포넌트의 영역은 건너뜁니다.
  const componentNodes = new Set(found.map(c => c.node))

  // 같은 파일 안에 선언된 커스텀 훅을 먼저 분석해 둡니다.
  const analyzedHooks = new Map()
  for (const [name, hook] of findCustomHooks(ast)) {
    analyzedHooks.set(name, analyzeHook(hook, componentNodes))
  }

  const components = found.map(comp => {
    const collected = collectComponent(comp, componentNodes)
    const hookUsage = resolveHookCalls(comp.node, analyzedHooks, componentNodes)

    // 훅이 관리하는 상태·Effect 를 컴포넌트 것으로 끌어옵니다
    const merged = {
      ...collected,
      states: [...collected.states, ...hookUsage.states],
      effects: [...collected.effects, ...hookUsage.effects],
    }

    const scope = {
      propNames: getPropNames(comp.node),
      outOfScope: hookUsage.outOfScope,
    }

    return {
      name: comp.name,
      startLine: comp.startLine,
      parent: comp.parent,
      states: merged.states,
      effects: describeEffects(merged.effects),
      events: buildEvents(comp.name, merged, scope),
    }
  })

  return { components, error: null }
}

/**
 * Babel 오류 메시지를 읽기 쉽게 바꿉니다.
 * 알려진 것만 번역하고, 나머지는 원문을 그대로 보여줍니다.
 */
function translateParseError(err) {
  const raw = String(err.message || '').replace(/\s*\(\d+:\d+\)\s*$/, '')

  const known = {
    UnterminatedJsxContent: 'JSX 태그가 닫히지 않았습니다. 코드가 중간에 잘렸는지 확인해 주세요.',
    UnexpectedToken: '예상하지 못한 토큰이 있습니다.',
    UnterminatedString: '문자열이 닫히지 않았습니다.',
    UnterminatedComment: '주석이 닫히지 않았습니다.',
    MissingSemicolon: '구문이 올바르게 끝나지 않았습니다.',
  }

  return known[err.reasonCode] || raw
}
