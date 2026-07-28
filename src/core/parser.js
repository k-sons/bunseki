/**
 * Code Parser — React / React Native 코드 분석 엔진
 *
 * 정규식 기반으로 JS/JSX/TSX 코드에서 구조 정보를 추출합니다.
 * - Import 문
 * - 함수/화살표 함수 선언
 * - React 컴포넌트 (대문자 시작 함수)
 * - 상수/변수 정의
 * - React Hook 호출
 * - RN 전용 패턴 (StyleSheet, Animated 등)
 * - JSX 컴포넌트 사용
 * - 주석 (한줄, 여러줄, JSDoc)
 * - Export 문
 */

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
 */

/**
 * 함수 선언 파싱 (function 키워드 + 화살표 함수)
 */
/**
 * 선언부가 여러 줄에 걸친 경우 한 줄로 합쳐서 돌려줍니다.
 *
 *   function Card({
 *     title,
 *     body
 *   }) {
 *
 * 아래 정규식들은 매개변수 목록 `(...)` 이 같은 줄에서 닫히기를 요구하므로,
 * 합쳐 주지 않으면 이런 선언은 함수로 인식되지 않습니다.
 * 괄호가 닫힐 때까지만 이어 붙입니다.
 */
function joinDeclaration(lines, startIdx) {
  let joined = lines[startIdx].trim()
  if (!joined.includes('(')) return joined

  let depth = 0
  const countParens = (s) => {
    for (const c of s) {
      if (c === '(') depth++
      else if (c === ')') depth--
    }
  }

  countParens(joined)
  if (depth <= 0) return joined

  const MAX_SPAN = 20
  for (let i = startIdx + 1; i < lines.length && i - startIdx <= MAX_SPAN; i++) {
    joined += ' ' + lines[i].trim()
    countParens(lines[i])
    if (depth <= 0) break
  }

  return joined
}

function parseFunctions(lines, code) {
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = joinDeclaration(lines, i)

    // function declaration: async function Name(...) or function Name(...)
    let match = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:(async)\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
    if (match) {
      const isAsync = !!match[1]
      const name = match[2]
      const params = match[3] ? match[3].split(',').map(p => p.trim()).filter(Boolean) : []
      const endLine = findBlockEnd(lines, i)
      const isComponent = /^[A-Z]/.test(name)

      results.push({
        name,
        type: isComponent ? 'component' : 'function',
        isAsync,
        params,
        startLine: i + 1,
        endLine: endLine + 1,
        lineCount: endLine - i + 1,
        hooks: findHooksInRange(lines, i, endLine),
        handlers: findHandlersInRange(lines, i, endLine),
        asyncKeywords: findAsyncKeywordsInRange(lines, i, endLine),
        isExported: trimmed.startsWith('export'),
        isDefault: trimmed.includes('export default'),
      })
      continue
    }

    // Arrow function: const Name = async (...) => or const Name = (...) =>
    match = trimmed.match(/^(?:export\s+(?:default\s+)?)?(const|let|var)\s+(\w+)\s*=\s*(?:(async)\s*)?(?:\(([^)]*)\)|(\w+))\s*=>/)
    if (!match) {
      match = trimmed.match(/^(?:export\s+(?:default\s+)?)?(const|let|var)\s+(\w+)\s*=\s*(?:(async)\s+)?function\s*\(([^)]*)\)/)
    }
    if (match) {
      const isAsync = !!match[3]
      const name = match[2]
      const params = (match[4] || match[5] || '').split(',').map(p => p.trim()).filter(Boolean)
      const endLine = findBlockEnd(lines, i)
      const isComponent = /^[A-Z]/.test(name)

      // Only check for async internally if not explicitly async, but let's record internal async keywords anyway
      const asyncKeywords = findAsyncKeywordsInRange(lines, i, endLine)

      results.push({
        name,
        type: isComponent ? 'component' : 'function',
        isAsync: isAsync || asyncKeywords.length > 0, // Fallback if they use Promise/fetch heavily
        params,
        startLine: i + 1,
        endLine: endLine + 1,
        lineCount: endLine - i + 1,
        hooks: findHooksInRange(lines, i, endLine),
        handlers: findHandlersInRange(lines, i, endLine),
        asyncKeywords,
        isExported: trimmed.startsWith('export'),
        isDefault: trimmed.includes('export default'),
      })
    }
  }

  return results
}

const REACT_HOOKS = [
  'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
  'useSyncExternalStore', 'useInsertionEffect', 'memo', 'useDispatch', 'useSelector', 'useStore'
]

const RN_HOOKS = [
  'useAnimatedStyle', 'useSharedValue', 'useAnimatedGestureHandler',
  'useNavigation', 'useRoute', 'useFocusEffect',
  'useWindowDimensions', 'useColorScheme', 'useAnimatedProps',
  'useDerivedValue', 'useAnimatedScrollHandler',
]

const STORE_KEYWORDS = ['dispatch']

const RN_COMPONENTS = [
  'View', 'Text', 'TouchableOpacity', 'TouchableHighlight', 'Pressable',
  'ScrollView', 'FlatList', 'SectionList', 'Image', 'ImageBackground',
  'TextInput', 'Switch', 'ActivityIndicator', 'Modal', 'Alert',
  'SafeAreaView', 'KeyboardAvoidingView', 'StatusBar', 'Platform',
  'StyleSheet', 'Animated', 'Dimensions', 'PixelRatio',
]

const EVENT_HANDLERS = [
  'onClick', 'onChange', 'onSubmit', 'onPress', 'onLongPress',
  'onChangeText', 'onFocus', 'onBlur', 'onScroll', 'onLayout',
  'onKeyDown', 'onKeyUp', 'onMouseEnter', 'onMouseLeave',
  'onTransitionEnd', 'onAnimationEnd', 'onEndReached',
]

/**
 * 코드 전체를 분석하여 구조 정보를 반환합니다.
 * @param {string} code - 분석할 코드 문자열
 * @returns {ParseResult}
 */
export function parseCode(code) {
  const lines = code.split('\n')

  const imports = parseImports(lines)
  const functions = parseFunctions(lines, code)
  const constants = parseConstants(lines)
  const hooks = parseHooks(lines)
  const jsxComponents = parseJSXComponents(code)
  const comments = parseComments(lines, code)
  const exports = parseExports(lines)
  const rnPatterns = parseRNPatterns(lines)
  const sections = buildSectionMap(lines, imports, functions, constants, exports, comments)
  const relations = buildRelations(functions, code)

  return {
    imports,
    functions,
    constants,
    hooks,
    jsxComponents,
    comments,
    exports,
    rnPatterns,
    sections,
    relations,
    totalLines: lines.length,
  }
}

/** Import 문 파싱 */
function parseImports(lines) {
  const results = []
  let inMultiLineImport = false
  let current = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (inMultiLineImport) {
      if (trimmed.includes('from ') || trimmed.endsWith("'") || trimmed.endsWith('"')) {
        current.endLine = i + 1
        const fromMatch = line.match(/from\s+['"](.+?)['"]/)
        if (fromMatch) current.module = fromMatch[1]
        results.push(current)
        inMultiLineImport = false
        current = null
      }
      continue
    }

    const importMatch = trimmed.match(/^import\s+/)
    if (importMatch) {
      const fromMatch = line.match(/from\s+['"](.+?)['"]/)
      const singleImport = line.match(/import\s+['"](.+?)['"]/)

      if (fromMatch || singleImport) {
        // Single-line import
        const moduleName = fromMatch ? fromMatch[1] : singleImport[1]
        const namedMatch = line.match(/\{([^}]+)\}/)
        const defaultMatch = line.match(/import\s+(\w+)/)

        const names = []
        if (namedMatch) {
          names.push(...namedMatch[1].split(',').map(s => s.trim()).filter(Boolean))
        }
        if (defaultMatch && defaultMatch[1] !== 'type') {
          names.push(defaultMatch[1])
        }

        results.push({
          startLine: i + 1,
          endLine: i + 1,
          module: moduleName,
          names,
          isReact: moduleName === 'react' || moduleName.startsWith('react-'),
          isRN: moduleName === 'react-native' || moduleName.startsWith('react-native-'),
          raw: trimmed,
        })
      } else {
        // Multi-line import starts
        inMultiLineImport = true
        current = {
          startLine: i + 1,
          endLine: i + 1,
          module: '',
          names: [],
          isReact: false,
          isRN: false,
          raw: trimmed,
        }
        const namedMatch = line.match(/\{([^}]*)/)
        if (namedMatch) {
          current.names.push(...namedMatch[1].split(',').map(s => s.trim()).filter(Boolean))
        }
      }
    }
  }
  return results
}


/** 상수/변수 정의 파싱 (함수가 아닌 최상위 const/let/var) */
function parseConstants(lines) {
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip imports
    if (trimmed.startsWith('import ')) continue

    const match = trimmed.match(/^(?:export\s+)?(const|let|var)\s+(\w+)\s*=\s*(?!function|.*=>)/)
    if (match) {
      // Check indentation — only top-level (0 or minimal indent)
      const indent = line.length - line.trimStart().length
      if (indent > 2) continue

      const endLine = findValueEnd(lines, i)
      results.push({
        name: match[2],
        kind: match[1],
        startLine: i + 1,
        endLine: endLine + 1,
        isArray: trimmed.includes('['),
        isObject: trimmed.includes('{'),
      })
    }
  }

  return results
}

/**
 * 커스텀 훅을 "정의하는" 줄인지 판별합니다.
 *
 *   function useSearch() {          ← 정의. 사용 횟수로 세면 안 됨
 *   const useSearch = () => {       ← 정의
 *   const { data } = useSearch()    ← 사용
 *
 * 정의 줄도 `useXxx(` 패턴에 걸리기 때문에, 걸러내지 않으면 선언만 해도
 * "1회 사용"으로 집계되고 자기 자신을 훅 목록에 넣게 됩니다.
 */
function isHookDeclaration(line) {
  const trimmed = line.trim()
  return /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+use[A-Z]/.test(trimmed) ||
         /^(?:export\s+)?(?:const|let|var)\s+use[A-Z]\w*\s*=/.test(trimmed)
}

/** React Hook 호출 파싱 */
function parseHooks(lines) {
  const results = []
  const allHooks = [...REACT_HOOKS, ...RN_HOOKS, ...STORE_KEYWORDS]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isHookDeclaration(line)) continue

    for (const hook of allHooks) {
      if (line.includes(hook + '(') || line.includes(hook + '<')) {
        const isRN = RN_HOOKS.includes(hook)
        results.push({
          name: hook,
          line: i + 1,
          isRN,
          category: categorizeHook(hook),
        })
      }
    }

    // Custom hooks (use로 시작하는 함수 호출)
    const customMatch = line.match(/\buse[A-Z]\w+\s*(?:<[^>]*>)?\s*\(/)
    if (customMatch) {
      const hookName = customMatch[0].replace(/\s*(?:<[^>]*>)?\s*\($/, '')
      if (!allHooks.includes(hookName)) {
        results.push({
          name: hookName,
          line: i + 1,
          isRN: false,
          category: 'other',
        })
      }
    }
  }

  return results
}

/** JSX 컴포넌트 사용 파싱 */
function parseJSXComponents(code) {
  const matches = new Set()
  const regex = /<([A-Z]\w+)[\s/>]/g
  let match
  while ((match = regex.exec(code)) !== null) {
    matches.add(match[1])
  }
  return [...matches]
}

/** 주석 파싱 */
function parseComments(lines, code) {
  const results = []
  let inBlock = false
  let blockStart = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (inBlock) {
      if (trimmed.includes('*/')) {
        results.push({
          type: 'block',
          startLine: blockStart + 1,
          endLine: i + 1,
          text: lines.slice(blockStart, i + 1).join('\n'),
          isJSDoc: lines[blockStart].trim().startsWith('/**'),
        })
        inBlock = false
      }
      continue
    }

    if (trimmed.startsWith('//')) {
      results.push({
        type: 'line',
        startLine: i + 1,
        endLine: i + 1,
        text: trimmed,
        isJSDoc: false,
      })
    } else if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      if (trimmed.includes('*/')) {
        results.push({
          type: 'block',
          startLine: i + 1,
          endLine: i + 1,
          text: trimmed,
          isJSDoc: trimmed.startsWith('/**'),
        })
      } else {
        inBlock = true
        blockStart = i
      }
    }
  }

  return results
}

/** Export 문 파싱 */
function parseExports(lines) {
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (trimmed.startsWith('export ')) {
      const isDefault = trimmed.includes('export default')
      const nameMatch = trimmed.match(/export\s+(?:default\s+)?(?:function|const|let|var|class)\s+(\w+)/)
      results.push({
        line: i + 1,
        isDefault,
        name: nameMatch ? nameMatch[1] : null,
        raw: trimmed,
      })
    }
  }

  return results
}

/** RN 전용 패턴 파싱 */
function parseRNPatterns(lines) {
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.includes('StyleSheet.create')) {
      results.push({ type: 'StyleSheet', line: i + 1 })
    }
    if (line.includes('Animated.')) {
      const match = line.match(/Animated\.(\w+)/)
      if (match) results.push({ type: 'Animated', subtype: match[1], line: i + 1 })
    }
    if (line.includes('Platform.OS') || line.includes('Platform.select')) {
      results.push({ type: 'Platform', line: i + 1 })
    }
    if (line.includes('Dimensions.get')) {
      results.push({ type: 'Dimensions', line: i + 1 })
    }
  }

  return results
}

/** 섹션 맵 빌드 — 각 라인에 섹션 레이블 할당 */
export function buildSectionMap(lines, imports, functions, constants, exports, comments) {
  const map = new Array(lines.length).fill(null)

  // Mark import lines
  for (const imp of imports) {
    for (let i = imp.startLine - 1; i < imp.endLine; i++) {
      map[i] = 'import'
    }
  }

  // Mark function/component lines
  for (const fn of functions) {
    const section = fn.type === 'component' ? 'component' : 'helper'
    for (let i = fn.startLine - 1; i < fn.endLine; i++) {
      if (!map[i]) map[i] = section
    }
  }

  // Mark constant lines
  for (const c of constants) {
    for (let i = c.startLine - 1; i < c.endLine; i++) {
      if (!map[i]) map[i] = 'const'
    }
  }

  // Mark export lines
  for (const exp of exports) {
    if (!map[exp.line - 1]) map[exp.line - 1] = 'export'
  }

  return map
}

/** 컴포넌트 간 호출 관계 빌드 */
function buildRelations(functions, code) {
  const relations = []
  const fnNames = functions.map(f => f.name)

  for (const fn of functions) {
    if (fn.type !== 'component' && fn.type !== 'function') continue

    const bodyLines = code.split('\n').slice(fn.startLine - 1, fn.endLine)
    const body = bodyLines.join('\n')

    for (const other of functions) {
      if (other.name === fn.name) continue
      
      // Check if this component uses another component in JSX
      if (fn.type === 'component' && other.type === 'component') {
        const regex = new RegExp(`<${other.name}[\\s/>]`)
        if (regex.test(body)) {
          relations.push({
            from: fn.name,
            to: other.name,
            type: 'renders',
            isAsync: false
          })
        }
      }
      
      // Check if it calls a function
      const callRegex = new RegExp(`\\b${other.name}\\s*\\(`)
      if (callRegex.test(body) && other.type !== 'component') {
        // Is it an async call? (await or .then chain near the call)
        const isAsyncCall = other.isAsync || 
                            bodyLines.some(l => l.includes(`await ${other.name}`) || (l.includes(`${other.name}(`) && l.includes('.then')))
        
        relations.push({
          from: fn.name,
          to: other.name,
          type: 'calls',
          isAsync: isAsyncCall
        })
      }
    }
  }

  return relations
}

/* ===== Helpers ===== */

/**
 * 블록({...}) 끝 라인 찾기
 *
 * 매개변수 구조분해를 건너뛰어야 합니다.
 *
 *   function SearchBox({ onSearch, onClear }) {
 *                      ↑          ↑
 *                      여기 중괄호를 본문으로 세면 깊이가 0으로 돌아가
 *                      함수가 1줄짜리로 보고됩니다.
 *
 * 그래서 괄호 깊이도 함께 추적해, 매개변수 목록이 닫히기 전의 중괄호는
 * 세지 않습니다.
 */
function findBlockEnd(lines, startIdx) {
  let braceDepth = 0
  let parenDepth = 0
  let paramsDone = false   // 매개변수 목록이 닫혔는가
  let started = false      // 본문 블록이 시작됐는가

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '(') {
        parenDepth++
      } else if (ch === ')') {
        parenDepth--
        if (parenDepth === 0) paramsDone = true
      } else if (ch === '{') {
        if (!paramsDone && parenDepth > 0) continue  // 매개변수 안의 중괄호
        braceDepth++
        started = true
      } else if (ch === '}') {
        if (!paramsDone && parenDepth > 0) continue
        braceDepth--
      }

      if (started && braceDepth === 0) return i
    }
  }

  // 본문 블록을 아예 못 찾음 → 중괄호 없는 한 줄 화살표 함수
  //   const add = (a, b) => a + b
  if (!started) return startIdx

  // 블록은 열렸는데 안 닫힘 → 코드가 잘림. 파일 끝까지로 봅니다.
  return lines.length - 1
}

/** 값 정의 끝 라인 찾기 (배열/객체 포함) */
function findValueEnd(lines, startIdx) {
  const line = lines[startIdx]
  const hasOpen = line.includes('[') || line.includes('{')

  if (!hasOpen) return startIdx

  let depth = 0
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '[' || ch === '{') depth++
      if (ch === ']' || ch === '}') depth--
      if (depth === 0 && i > startIdx) return i
    }
  }

  return startIdx
}

/** 범위 내 Hook 사용 찾기 */
function findHooksInRange(lines, start, end) {
  const found = []
  const allHooks = [...REACT_HOOKS, ...RN_HOOKS, ...STORE_KEYWORDS]

  for (let i = start; i <= end && i < lines.length; i++) {
    // 훅을 정의하는 줄은 사용이 아닙니다 (자기 자신이 목록에 들어가는 것을 막습니다)
    if (isHookDeclaration(lines[i])) continue

    for (const hook of allHooks) {
      if (lines[i].includes(hook + '(')) {
        found.push({ name: hook, category: categorizeHook(hook) })
      }
    }
    // Custom hooks
    const customMatch = lines[i].match(/\b(use[A-Z]\w+)\s*\(/)
    if (customMatch && !allHooks.includes(customMatch[1])) {
      found.push({ name: customMatch[1], category: 'other' })
    }
  }

  // Deduplicate by name
  const unique = []
  const seen = new Set()
  for (const h of found) {
    if (!seen.has(h.name)) {
      seen.add(h.name)
      unique.push(h)
    }
  }

  return unique
}

/** 범위 내 이벤트 핸들러 찾기 */
function findHandlersInRange(lines, start, end) {
  const found = []
  for (let i = start; i <= end && i < lines.length; i++) {
    for (const handler of EVENT_HANDLERS) {
      if (lines[i].includes(handler)) {
        found.push(handler)
      }
    }
  }
  return [...new Set(found)]
}

/** 비동기 관련 키워드 찾기 */
function findAsyncKeywordsInRange(lines, start, end) {
  const found = []
  for (let i = start; i <= end && i < lines.length; i++) {
    const line = lines[i]
    if (/\bawait\b/.test(line)) found.push('await')
    if (/\bPromise\b/.test(line)) found.push('Promise')
    if (/\bfetch\s*\(/.test(line)) found.push('fetch')
    if (/\.then\s*\(/.test(line)) found.push('.then')
  }
  return [...new Set(found)]
}

/** Hook 카테고리 분류 */
function categorizeHook(name) {
  if (['useState', 'useReducer'].includes(name)) return 'state'
  if (['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(name)) return 'effect'
  if (['useMemo', 'useCallback', 'useDeferredValue', 'memo'].includes(name)) return 'memo'
  if (['useSelector', 'useDispatch', 'useStore', 'dispatch', 'useContext'].includes(name)) return 'store'
  return 'other'
}
