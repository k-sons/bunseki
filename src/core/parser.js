/**
 * Code Parser — React / React Native 코드 분석 엔진
 *
 * @babel/parser 로 만든 AST 에서 구조 정보를 추출합니다.
 * (예전에는 줄 단위 정규식으로 훑었는데, 구조분해 props `{ }`·memo/forwardRef 래퍼·
 *  타입스크립트 제네릭·여러 줄 시그니처에서 함수를 놓치거나 줄 수를 1 로 잘못 세었습니다.
 *  동작 탭에서 이미 검증된 AST 방식으로 통일했습니다.)
 *
 * 추출하는 것:
 * - Import 문
 * - 함수/화살표 함수/래핑된 컴포넌트 선언
 * - React 컴포넌트 (대문자 시작 최상위 선언 또는 JSX 를 담은 중첩 선언)
 * - 상수/변수 정의
 * - React Hook 호출
 * - RN 전용 패턴 (StyleSheet, Animated 등)
 * - JSX 컴포넌트 사용
 * - 주석 (한줄, 여러줄, JSDoc)
 * - Export 문
 * - 함수/컴포넌트 사이의 호출·렌더 관계
 *
 * 출력 형태(ParseResult)는 예전 정규식 파서와 동일하게 유지합니다 —
 * 하이라이트/구조맵/메트릭/플로우 렌더러가 그대로 소비할 수 있게.
 */

import { parse } from '@babel/parser'
import { toParseError } from './parse-error.js'

/**
 * @typedef {Object} ParseResult
 * @property {ImportInfo[]} imports
 * @property {FunctionInfo[]} functions
 * @property {ConstInfo[]} constants
 * @property {HookCall[]} hooks
 * @property {string[]} jsxComponents
 * @property {CommentInfo[]} comments
 * @property {ExportInfo[]} exports
 * @property {SectionMap[]} sections
 * @property {RNPattern[]} rnPatterns
 * @property {ComponentRelation[]} relations
 * @property {number} totalLines
 * @property {{message: string, line: number|null}|null} error
 *   파싱에 실패했으면 그 사유. **이때 나머지 필드는 "세어 보니 없다" 가 아니라
 *   "못 셌다" 는 뜻입니다** — 렌더러는 0 을 사실처럼 보여 주지 말고 이 필드를 먼저 봐야 합니다.
 */

const PARSE_OPTIONS = {
  sourceType: 'module',
  errorRecovery: true,
  plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
}

const REACT_HOOKS = [
  'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
  'useSyncExternalStore', 'useInsertionEffect', 'memo', 'useDispatch', 'useSelector', 'useStore',
]

const RN_HOOKS = [
  'useAnimatedStyle', 'useSharedValue', 'useAnimatedGestureHandler',
  'useNavigation', 'useRoute', 'useFocusEffect',
  'useWindowDimensions', 'useColorScheme', 'useAnimatedProps',
  'useDerivedValue', 'useAnimatedScrollHandler',
]

const STORE_KEYWORDS = ['dispatch']

const BUILTIN_HOOK_SET = new Set([...REACT_HOOKS, ...RN_HOOKS, ...STORE_KEYWORDS])
const RN_HOOK_SET = new Set(RN_HOOKS)

/** memo(Comp)/forwardRef(fn)/useCallback(fn)/observer(fn) 처럼 함수를 감싸는 래퍼 */
const FN_WRAPPERS = new Set(['memo', 'forwardRef', 'useCallback', 'observer'])

/**
 * 코드 전체를 분석하여 구조 정보를 반환합니다.
 * @param {string} code - 분석할 코드 문자열
 * @returns {ParseResult}
 */
export function parseCode(code) {
  const lines = code.split('\n')
  const totalLines = lines.length

  let ast
  try {
    ast = parse(code, PARSE_OPTIONS)
  } catch (err) {
    // 심하게 깨진 코드 — 분석은 비워 두되 하이라이트가 코드 자체는 그릴 수 있게 합니다.
    // **왜 비었는지를 함께 실어 보냅니다.** 안 그러면 화면에서 "없다" 와 "못 셌다" 가
    // 똑같이 0 으로 보여, 조용히 틀린 결과를 내놓는 셈이 됩니다.
    return emptyResult(totalLines, toParseError(err))
  }

  const exportedNames = collectExportedNames(ast)

  const functions = collectFunctions(ast, exportedNames)
  const componentNodes = new Set(functions.filter(f => f.type === 'component').map(f => f._node))

  // 각 함수의 hooks/handlers/async 를, 자기 안에 중첩된 다른 컴포넌트 영역은 빼고 채웁니다.
  for (const fn of functions) {
    const skip = (n) => n !== fn._node && componentNodes.has(n)
    fn.hooks = collectHooksInScope(fn._node, skip)
    fn.hookCallCount = countHookCallsInScope(fn._node, skip)
    fn.handlers = collectHandlersInScope(fn._node, skip)
    const asyncKeywords = collectAsyncKeywords(fn._node, skip)
    fn.asyncKeywords = asyncKeywords
    fn.isAsync = fn._async || asyncKeywords.length > 0
  }

  const imports = collectImports(ast)
  const constants = collectConstants(ast)
  const hooks = collectHookCalls(ast)
  const jsxComponents = collectJSXComponents(ast)
  const comments = collectComments(ast)
  const exports = collectExports(ast, lines)
  const rnPatterns = collectRNPatterns(ast)
  const handlerMarks = collectHandlerMarks(ast)
  const asyncMarks = collectAsyncMarks(ast)
  const relations = buildRelations(functions, componentNodes)
  const sections = buildSectionMap(lines, imports, functions, constants, exports)

  // 내부용 AST 참조는 결과에서 제거합니다.
  for (const fn of functions) {
    delete fn._node
    delete fn._async
  }

  return {
    imports,
    functions,
    constants,
    hooks,
    jsxComponents,
    comments,
    exports,
    rnPatterns,
    handlerMarks,
    asyncMarks,
    sections,
    relations,
    totalLines,
    error: null,
  }
}

function emptyResult(totalLines, error = null) {
  return {
    imports: [], functions: [], constants: [], hooks: [],
    jsxComponents: [], comments: [], exports: [], rnPatterns: [],
    handlerMarks: [], asyncMarks: [],
    sections: new Array(totalLines).fill(null),
    relations: [], totalLines, error,
  }
}

/* ===== AST 순회 ===== */

/**
 * AST 를 재귀로 훑습니다.
 * @param {object} node
 * @param {(n: object) => void} visit
 * @param {(n: object) => boolean} [skip] - true 를 돌려주면 그 가지를 통째로 건너뜁니다.
 */
function walk(node, visit, skip) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit, skip)
    return
  }
  if (typeof node.type === 'string') {
    if (skip && skip(node)) return
    visit(node)
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'comments') continue
    walk(node[key], visit, skip)
  }
}

const lineOf = (n) => (n && n.loc ? n.loc.start.line : null)
const endLineOf = (n) => (n && n.loc ? n.loc.end.line : null)

const isFunctionNode = (n) =>
  n && (n.type === 'ArrowFunctionExpression' ||
        n.type === 'FunctionExpression' ||
        n.type === 'FunctionDeclaration')

/** 호출식의 대상 이름 (foo() → 'foo', a.b() → 'b') */
function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null
  const c = node.callee
  if (!c) return null
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier') {
    return c.property.name
  }
  return null
}

/** memo/forwardRef/useCallback 래퍼를 벗겨 실제 함수 노드를 꺼냅니다 */
function unwrapFunction(node, depth = 0) {
  if (!node || depth > 3) return null
  if (isFunctionNode(node)) return node
  if (node.type === 'CallExpression') {
    const name = calleeName(node)
    if (FN_WRAPPERS.has(name) && node.arguments && node.arguments[0]) {
      return unwrapFunction(node.arguments[0], depth + 1)
    }
  }
  return null
}

/** 이 노드 안에 JSX 가 있는가 — 중첩 컴포넌트 판별에 씁니다 */
function containsJSX(node) {
  let found = false
  walk(node, (n) => {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') found = true
  })
  return found
}

/* ===== 함수 / 컴포넌트 ===== */

/**
 * 최상위 함수·컴포넌트 + 중첩 컴포넌트를 수집합니다.
 * 중첩된 이름붙은 핸들러(소문자)는 컴포넌트 본문의 일부로 보고 목록에 넣지 않습니다 —
 * 그래야 크기 막대나 God Component 판정이 중복 없이 정확합니다.
 */
function collectFunctions(ast, exportedNames) {
  const results = []
  const seen = new Set()

  const add = (name, fnNode, declNode, { isDefault = false } = {}) => {
    if (!name || !fnNode || seen.has(fnNode)) return
    seen.add(fnNode)
    const start = lineOf(declNode || fnNode)
    const end = endLineOf(fnNode)
    const isComponent = /^[A-Z]/.test(name)
    results.push({
      name,
      type: isComponent ? 'component' : 'function',
      _node: fnNode,
      _async: !!fnNode.async,
      isAsync: !!fnNode.async,
      params: readParams(fnNode.params),
      startLine: start,
      endLine: end,
      lineCount: (start != null && end != null) ? (end - start + 1) : 1,
      hooks: [],
      hookCallCount: 0,
      handlers: [],
      asyncKeywords: [],
      isExported: exportedNames.default === name || exportedNames.named.has(name) || isDefault,
      isDefault: isDefault || exportedNames.default === name,
    })
  }

  // 최상위 선언
  for (const stmt of ast.program.body) {
    let target = stmt
    let isDefault = false
    if (stmt.type === 'ExportDefaultDeclaration') { target = stmt.declaration; isDefault = true }
    else if (stmt.type === 'ExportNamedDeclaration') { target = stmt.declaration }
    if (!target) continue

    if (target.type === 'FunctionDeclaration' && target.id) {
      add(target.id.name, target, target, { isDefault })
    } else if (target.type === 'VariableDeclaration') {
      for (const d of target.declarations) {
        if (!d.id || d.id.type !== 'Identifier') continue
        const fn = unwrapFunction(d.init)
        if (fn) add(d.id.name, fn, d, { isDefault })
      }
    } else if (isDefault) {
      // export default memo(() => …) 처럼 이름 없는 기본 내보내기
      const fn = unwrapFunction(target)
      if (fn) add('default', fn, stmt, { isDefault: true })
    }
  }

  // 중첩 컴포넌트 (대문자 + JSX 포함) — 목록에 없던 것만
  const topNodes = new Set(results.map(r => r._node))
  for (const comp of [...results]) {
    walk(comp._node, (n) => {
      if (n === comp._node) return
      let name = null, fnNode = null, declNode = null
      if (n.type === 'FunctionDeclaration' && n.id) {
        name = n.id.name; fnNode = n; declNode = n
      } else if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier') {
        const unwrapped = unwrapFunction(n.init)
        if (unwrapped) { name = n.id.name; fnNode = unwrapped; declNode = n }
      }
      if (!name || !/^[A-Z]/.test(name) || !fnNode) return
      if (topNodes.has(fnNode) || seen.has(fnNode)) return
      if (!containsJSX(fnNode)) return
      add(name, fnNode, declNode)
    })
  }

  return results
}

/** 파라미터 노드를 사람이 읽는 문자열로 바꿉니다 */
function readParams(params) {
  if (!params || params.length === 0) return []
  return params.map(paramToString).filter(Boolean)
}

function paramToString(p) {
  if (!p) return ''
  switch (p.type) {
    case 'Identifier': return p.name
    case 'RestElement': return '...' + paramToString(p.argument)
    case 'AssignmentPattern': return paramToString(p.left)
    case 'ObjectPattern': {
      const keys = p.properties.map(prop => {
        if (prop.type === 'RestElement') return '...' + paramToString(prop.argument)
        return (prop.key && (prop.key.name || prop.key.value)) || ''
      }).filter(Boolean)
      return '{ ' + keys.join(', ') + ' }'
    }
    case 'ArrayPattern':
      return '[ ' + p.elements.map(e => (e ? paramToString(e) : '')).join(', ') + ' ]'
    default:
      return p.name || ''
  }
}

/* ===== Hook / 핸들러 / 비동기 (범위 내) ===== */

function categorizeHook(name) {
  if (['useState', 'useReducer'].includes(name)) return 'state'
  if (['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(name)) return 'effect'
  if (['useMemo', 'useCallback', 'useDeferredValue', 'memo'].includes(name)) return 'memo'
  if (['useSelector', 'useDispatch', 'useStore', 'dispatch', 'useContext'].includes(name)) return 'store'
  return 'other'
}

const isHookName = (name) =>
  !!name && (BUILTIN_HOOK_SET.has(name) || /^use[A-Z]/.test(name))

/** 범위 안에서 호출된 Hook 을 {name, category} 로, 이름 기준 중복 제거해 반환 */
function collectHooksInScope(root, skip) {
  const seen = new Set()
  const found = []
  walk(root, (n) => {
    if (n.type !== 'CallExpression') return
    const name = calleeName(n)
    if (!isHookName(name)) return
    if (seen.has(name)) return
    seen.add(name)
    found.push({ name, category: categorizeHook(name) })
  }, skip)
  return found
}

/**
 * 범위 안에서 **실제로 호출된 횟수**. `hooks` 는 배지용이라 이름 기준으로 중복을 없애므로
 * `useState` 를 마흔 번 부른 컴포넌트도 거기서는 1 입니다. 덩치를 재려면 이 값을 봐야 합니다.
 */
function countHookCallsInScope(root, skip) {
  let count = 0
  walk(root, (n) => {
    if (n.type !== 'CallExpression') return
    if (isHookName(calleeName(n))) count++
  }, skip)
  return count
}

/** 범위 안 JSX 의 onXxx 이벤트 속성 이름들 (중복 제거) */
function collectHandlersInScope(root, skip) {
  const found = new Set()
  walk(root, (n) => {
    if (n.type !== 'JSXAttribute') return
    if (!n.name || n.name.type !== 'JSXIdentifier') return
    if (/^on[A-Z]/.test(n.name.name)) found.add(n.name.name)
  }, skip)
  return [...found]
}

/** 범위 안 비동기 흔적 (await/Promise/fetch/.then) */
function collectAsyncKeywords(root, skip) {
  const found = new Set()
  walk(root, (n) => {
    if (n.type === 'AwaitExpression') found.add('await')
    if (n.type === 'Identifier' && n.name === 'Promise') found.add('Promise')
    if (n.type === 'CallExpression') {
      const name = calleeName(n)
      if (name === 'fetch') found.add('fetch')
      if (name === 'then') found.add('.then')
    }
  }, skip)
  return [...found]
}

/* ===== Import ===== */

function collectImports(ast) {
  const results = []
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ImportDeclaration') continue
    const module = stmt.source.value
    const names = []
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') names.push(spec.local.name)
      else if (spec.type === 'ImportNamespaceSpecifier') names.push('* as ' + spec.local.name)
      else if (spec.type === 'ImportSpecifier') {
        names.push((spec.imported && (spec.imported.name || spec.imported.value)) || spec.local.name)
      }
    }
    results.push({
      startLine: lineOf(stmt),
      endLine: endLineOf(stmt),
      module,
      names,
      isReact: module === 'react' || module.startsWith('react-'),
      isRN: module === 'react-native' || module.startsWith('react-native-'),
      raw: '',
    })
  }
  return results
}

/* ===== 상수 ===== */

function collectConstants(ast) {
  const results = []
  for (const stmt of ast.program.body) {
    let target = stmt
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) target = stmt.declaration
    if (!target || target.type !== 'VariableDeclaration') continue

    for (const d of target.declarations) {
      if (!d.id || d.id.type !== 'Identifier') continue
      if (unwrapFunction(d.init)) continue // 함수는 functions 로 감
      const init = d.init
      results.push({
        name: d.id.name,
        kind: target.kind,
        startLine: lineOf(d),
        endLine: endLineOf(d),
        isArray: !!init && init.type === 'ArrayExpression',
        isObject: !!init && init.type === 'ObjectExpression',
      })
    }
  }
  return results
}

/* ===== Hook 호출 (전체 목록) ===== */

function collectHookCalls(ast) {
  const results = []
  const seen = new Set()
  walk(ast.program, (n) => {
    if (n.type !== 'CallExpression') return
    const name = calleeName(n)
    if (!isHookName(name)) return
    const line = lineOf(n)
    const key = name + ':' + line
    if (seen.has(key)) return
    seen.add(key)
    results.push({
      name,
      line,
      isRN: RN_HOOK_SET.has(name),
      category: categorizeHook(name),
    })
  })
  return results.sort((a, b) => a.line - b.line)
}

/* ===== JSX 컴포넌트 사용 ===== */

function collectJSXComponents(ast) {
  const set = new Set()
  walk(ast.program, (n) => {
    if (n.type !== 'JSXOpeningElement') return
    const name = n.name
    if (name && name.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) {
      set.add(name.name)
    } else if (name && name.type === 'JSXMemberExpression') {
      // motion.li 같은 것 — object 이름을 남깁니다
      const obj = name.object
      if (obj && obj.type === 'JSXIdentifier' && /^[A-Z]/.test(obj.name)) set.add(obj.name)
    }
  })
  return [...set]
}

/* ===== 주석 ===== */

function collectComments(ast) {
  const comments = ast.comments || []
  return comments.map(c => {
    const isBlock = c.type === 'CommentBlock'
    const text = isBlock ? '/*' + c.value + '*/' : '//' + c.value
    return {
      type: isBlock ? 'block' : 'line',
      startLine: c.loc ? c.loc.start.line : null,
      endLine: c.loc ? c.loc.end.line : null,
      text,
      isJSDoc: isBlock && c.value.startsWith('*'),
    }
  })
}

/* ===== Export ===== */

function collectExportedNames(ast) {
  const named = new Set()
  let def = null
  for (const stmt of ast.program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      const d = stmt.declaration
      if (d && d.id && d.id.name) def = d.id.name
      else if (d && d.type === 'Identifier') def = d.name
      else def = def || '__default__'
    } else if (stmt.type === 'ExportNamedDeclaration') {
      if (stmt.declaration) {
        if (stmt.declaration.type === 'FunctionDeclaration' && stmt.declaration.id) {
          named.add(stmt.declaration.id.name)
        } else if (stmt.declaration.type === 'VariableDeclaration') {
          for (const d of stmt.declaration.declarations) {
            if (d.id && d.id.type === 'Identifier') named.add(d.id.name)
          }
        }
      }
      for (const spec of stmt.specifiers || []) {
        if (spec.local && spec.local.name) named.add(spec.local.name)
      }
    }
  }
  return { named, default: def }
}

function collectExports(ast, lines) {
  const results = []
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration' &&
        stmt.type !== 'ExportNamedDeclaration' &&
        stmt.type !== 'ExportAllDeclaration') continue

    const line = lineOf(stmt)
    const isDefault = stmt.type === 'ExportDefaultDeclaration'
    let name = null
    const decl = stmt.declaration
    if (decl) {
      if (decl.id && decl.id.name) name = decl.id.name
      else if (decl.type === 'VariableDeclaration' && decl.declarations[0] && decl.declarations[0].id) {
        name = decl.declarations[0].id.name
      } else if (decl.type === 'Identifier') name = decl.name
    }
    results.push({
      line,
      isDefault,
      name,
      raw: (line != null && lines[line - 1]) ? lines[line - 1].trim() : '',
    })
  }
  return results
}

/* ===== RN 패턴 ===== */

function collectRNPatterns(ast) {
  const results = []
  walk(ast.program, (n) => {
    if (n.type !== 'MemberExpression') return
    const obj = n.object
    const prop = n.property
    if (!obj || obj.type !== 'Identifier' || !prop || prop.type !== 'Identifier') return
    const line = lineOf(n)
    if (obj.name === 'StyleSheet' && prop.name === 'create') {
      results.push({ type: 'StyleSheet', line })
    } else if (obj.name === 'Animated') {
      results.push({ type: 'Animated', subtype: prop.name, line })
    } else if (obj.name === 'Platform' && (prop.name === 'OS' || prop.name === 'select')) {
      results.push({ type: 'Platform', line })
    } else if (obj.name === 'Dimensions' && prop.name === 'get') {
      results.push({ type: 'Dimensions', line })
    }
  })
  return results
}

/* ===== 줄 번호가 붙은 표식 (하이라이트 배지용) ===== */

/**
 * 하이라이트 배지는 예전에 줄 원문을 정규식으로 다시 훑어 붙였습니다.
 * 그래서 주석이나 문자열 안에 적힌 `onClick=` · `await` 에도 배지가 달렸습니다.
 * AST 가 이미 아는 것을 다시 추측하지 않도록, 여기서 줄 번호와 함께 내보냅니다.
 */

/** JSX 의 onXxx 이벤트 속성 — {name, line} */
function collectHandlerMarks(ast) {
  const results = []
  walk(ast.program, (n) => {
    if (n.type !== 'JSXAttribute') return
    if (!n.name || n.name.type !== 'JSXIdentifier') return
    if (!/^on[A-Z]/.test(n.name.name)) return
    results.push({ name: n.name.name, line: lineOf(n) })
  })
  return results
}

/** async 선언과 await 식이 적힌 자리 — {keyword, line} */
function collectAsyncMarks(ast) {
  const results = []
  walk(ast.program, (n) => {
    if (n.async === true && (isFunctionNode(n) || n.type === 'ObjectMethod' || n.type === 'ClassMethod')) {
      results.push({ keyword: 'async', line: lineOf(n) })
    }
    if (n.type === 'AwaitExpression') {
      results.push({ keyword: 'await', line: lineOf(n) })
    }
  })
  return results
}

/* ===== 관계 (렌더 / 호출) ===== */

/**
 * 컴포넌트가 JSX 로 그리는 다른 컴포넌트, 함수가 부르는 다른 함수를 잇습니다.
 * 본문을 훑을 때 자기 안의 다른 컴포넌트 영역은 건너뛰어 관계가 새지 않게 합니다.
 */
function buildRelations(functions, componentNodes) {
  const relations = []
  const byName = new Map(functions.map(f => [f.name, f]))

  for (const fn of functions) {
    const skip = (n) => n !== fn._node && componentNodes.has(n)

    const renderedComponents = new Set()
    const calledFns = new Set()

    walk(fn._node, (n) => {
      if (n.type === 'JSXOpeningElement' && n.name && n.name.type === 'JSXIdentifier') {
        if (/^[A-Z]/.test(n.name.name)) renderedComponents.add(n.name.name)
      }
      if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier') {
        calledFns.add(n.callee.name)
      }
    }, skip)

    if (fn.type === 'component') {
      for (const name of renderedComponents) {
        const other = byName.get(name)
        if (other && other !== fn && other.type === 'component') {
          relations.push({ from: fn.name, to: name, type: 'renders', isAsync: false })
        }
      }
    }

    for (const name of calledFns) {
      const other = byName.get(name)
      if (other && other !== fn && other.type !== 'component') {
        relations.push({ from: fn.name, to: name, type: 'calls', isAsync: !!other.isAsync })
      }
    }
  }

  return relations
}

/* ===== 섹션 맵 ===== */

/** 각 라인에 섹션 레이블(import/component/helper/const/export)을 할당합니다 */
export function buildSectionMap(lines, imports, functions, constants, exports) {
  const map = new Array(lines.length).fill(null)

  for (const imp of imports) {
    if (imp.startLine == null) continue
    for (let i = imp.startLine - 1; i < imp.endLine && i < map.length; i++) map[i] = 'import'
  }

  for (const fn of functions) {
    if (fn.startLine == null) continue
    const section = fn.type === 'component' ? 'component' : 'helper'
    for (let i = fn.startLine - 1; i < fn.endLine && i < map.length; i++) {
      if (!map[i]) map[i] = section
    }
  }

  for (const c of constants) {
    if (c.startLine == null) continue
    for (let i = c.startLine - 1; i < c.endLine && i < map.length; i++) {
      if (!map[i]) map[i] = 'const'
    }
  }

  for (const exp of exports) {
    if (exp.line == null) continue
    if (!map[exp.line - 1]) map[exp.line - 1] = 'export'
  }

  return map
}
