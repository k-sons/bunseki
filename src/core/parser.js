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
function parseFunctions(lines, code) {
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

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

/** React Hook 호출 파싱 */
function parseHooks(lines) {
  const results = []
  const allHooks = [...REACT_HOOKS, ...RN_HOOKS, ...STORE_KEYWORDS]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

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

/** 블록({...}) 끝 라인 찾기 */
function findBlockEnd(lines, startIdx) {
  let depth = 0
  let started = false

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      if (ch === '}') { depth--; }
      if (started && depth === 0) return i
    }
  }

  return Math.min(startIdx + 1, lines.length - 1)
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
