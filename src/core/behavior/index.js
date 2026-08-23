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
import { analyzeEffectsTiming } from './timing.js'
import { analyzeInterplay } from './interplay.js'
import { translateParseError } from '../parse-error.js'

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

    // 훅이 관리하는 상태·Effect 를 컴포넌트 것으로 끌어옵니다.
    // 훅이 돌려준 콜백은 컴포넌트가 부르는 이름으로 로컬 함수 목록에 합쳐,
    // 핸들러를 따라갈 때 컴포넌트 함수와 똑같이 다뤄지게 합니다
    // (이름이 겹치면 컴포넌트 자신의 것이 이깁니다).
    const merged = {
      ...collected,
      states: [...collected.states, ...hookUsage.states],
      effects: [...collected.effects, ...hookUsage.effects],
      localFns: { ...Object.fromEntries(hookUsage.hookFns), ...collected.localFns },
    }

    const scope = {
      propNames: getPropNames(comp.node),
      outOfScope: hookUsage.outOfScope,
    }

    const timing = analyzeEffectsTiming(merged.effects, merged.states, code)

    return {
      name: comp.name,
      startLine: comp.startLine,
      parent: comp.parent,
      states: merged.states,
      effects: describeEffects(merged.effects),
      timing,
      interplay: analyzeInterplay(timing),
      events: buildEvents(comp.name, merged, scope, code),
    }
  })

  return { components, error: null }
}
