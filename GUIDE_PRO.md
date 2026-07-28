# 📘 Code Bunseki — 개발자/실무자용 메트릭 & 아키텍처 가이드 (Pro Version)

> **Code Bunseki**는 React / React Native 및 JSX/TSX 코드의 구문, 상태 관리 패턴, 훅(Hook) 사용 비중, 컴포넌트 간 호출 지도, 그리고 **이벤트에서 시작하는 상태 변화 연쇄**를 시각화하여 **코드 구조와 런타임 동작을 함께 파악하는 개발자 도구**입니다.

---

## 📑 목차
1. [핵심 아키텍처 — 두 개의 분석 엔진](#1-핵심-아키텍처--두-개의-분석-엔진)
2. [분석 출력 대시보드 5가지 탭 기술 명세](#2-분석-출력-대시보드-5가지-탭-기술-명세)
   - [① 하이라이트 (Highlight View)](#-하이라이트-highlight-view)
   - [② 구조맵 (Structure Map View)](#-구조맵-structure-map-view)
   - [③ 메트릭 대시보드 (Metrics Dashboard)](#-메트릭-대시보드-metrics-dashboard)
   - [④ 컴포넌트 플로우 (Flow Chart)](#-컴포넌트-플로우-flow-chart)
   - [⑤ 동작 분석 (Behavior View)](#-동작-분석-behavior-view)
3. [동작 분석 상세 — 상태 변화 연쇄 추적](#3-동작-분석-상세--상태-변화-연쇄-추적)
4. [스코프 경계(Boundary) — 단일 파일 분석의 한계 표기](#4-스코프-경계boundary--단일-파일-분석의-한계-표기)
5. [정량적 메트릭 수치를 활용한 코드 리팩토링 전략](#5-정량적-메트릭-수치를-활용한-코드-리팩토링-전략)
6. [조각/부분 코드(Truncated Code) 분석 매커니즘](#6-조각부분-코드truncated-code-분석-매커니즘)
7. [도구가 보장하는 것과 보장하지 않는 것](#7-도구가-보장하는-것과-보장하지-않는-것)
8. [협업 및 문서화 (Export & Markdown Report)](#8-협업-및-문서화-export--markdown-report)

---

## 1. 핵심 아키텍처 — 두 개의 분석 엔진

Code Bunseki 는 목적이 다른 **두 개의 파서**를 병행 운용합니다.

```
                      코드 입력
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  정규식 파서                           AST 파서
  src/core/parser.js                    src/core/behavior/
  (동기, 항상 로드)                      (@babel/parser, 지연 로드)
        │                                    │
  ┌─────┼─────┬───────┐                      ▼
  ▼     ▼     ▼       ▼                 ⑤ 동작
① 하이라이트 ② 구조맵 ③ 메트릭 ④ 플로우
```

### 1-1. 정규식 & 블록 뎁스 파서 (`src/core/parser.js`)

라인 단위 **정규식(Regex) + 중괄호 깊이(Bracket Depth) 트래킹** 방식입니다.

- **Import / Export 파싱**: ESM 모듈 의존성 및 Default/Named Export 추적
- **컴포넌트 & 함수 식별**: 대문자로 시작하는 Identifier 를 React Component 로 분류
- **Hook 식별 및 분류**: Standard Hooks (`useState`, `useEffect`, `useMemo`), Store Hooks (`useSelector`, `useDispatch`), Custom Hooks (`useXxx`) 자동 분류
- **내결함성 (Fault Tolerance)**: 괄호가 닫히지 않은 조각 코드에서도 구문 방해 없이 유효 구조 추출

**한계**: 선언의 존재는 알지만 **의미 관계는 모릅니다.** `setOpen` 이 `open` 의 setter 라는 사실, `onClick` 이 어떤 함수에 바인딩됐는지, `useEffect` 의 deps 가 무엇인지를 결합할 수 없습니다.

### 1-2. AST 파서 (`src/core/behavior/`)

`@babel/parser` 기반이며 **동작 탭 전용**입니다. 위 한계를 넘기 위해 도입했습니다.

| 모듈 | 역할 |
| :--- | :--- |
| `collect.js` | AST 순회, 상태·Effect·핸들러·로컬 함수 수집 |
| `hooks.js` | 커스텀 훅 분석, 반환값 이름 대응, prop 이름 수집 |
| `chain.js` | 연쇄 조립 및 평탄화된 `Step[]` 생성 |
| `index.js` | 진입점 `parseBehavior(code)`, 파싱 오류 한국어 변환 |

**번들 전략**: `@babel/parser` 는 `behavior/` 내부에서만 import 되므로 Vite 가 별도 청크로 분리합니다. `main.js` 에서 첫 분석 시 동적 `import()` 로 로드합니다.

```
index.js       gzip  21.9 KB   ← 초기 로딩 (파서 미포함)
behavior.js    gzip   1.9 KB   ← 동작 분석 로직
behavior.js    gzip  83.3 KB   ← @babel/parser (첫 분석 시 로드)
```

AST 분석 실패는 동작 탭에만 국한되며, 나머지 4개 탭은 영향을 받지 않습니다.

---

## 2. 분석 출력 대시보드 5가지 탭 기술 명세

### 🎨 ① 하이라이트 (Highlight View)

Prism.js 구문 강조 위에 섹션 컬러밴드와 인라인 배지를 주입합니다.

**섹션 밴드** (`buildSectionMap` 이 각 라인에 할당)
`IMPORT` · `CONST` · `COMPONENT` · `HELPER` · `EXPORT`

**인라인 배지** (Hook 카테고리별 색상 구분)

| 카테고리 | 대상 |
| :--- | :--- |
| `state` | `useState`, `useReducer` |
| `effect` | `useEffect`, `useLayoutEffect`, `useInsertionEffect` |
| `memo` | `useMemo`, `useCallback`, `useDeferredValue`, `memo` |
| `store` | `useSelector`, `useDispatch`, `useStore`, `useContext`, `dispatch` |
| `handler` | `onClick`, `onChange`, `onPress` 등 `on[A-Z]` 패턴 |
| `rn` | `StyleSheet.create`, `Animated.*` |
| `async` | `async`, `await` |

> **알려진 표시 이슈**: `handler`(`hsl(35,90%,60%)`)와 `memo`(`hsl(35,90%,55%)`)는 색상이 사실상 동일하여 시각적으로 구분되지 않습니다. `async` 배지는 전용 스타일 규칙이 없어 기본 배지 색으로 렌더됩니다.

> **구현 노트**: Prism 출력을 라인 단위로 자를 때 열린 태그를 스택으로 추적해 줄 끝에서 닫고 다음 줄에서 다시 엽니다. 단순 `split('\n')` 을 쓰면 블록 주석·템플릿 리터럴처럼 여러 줄에 걸친 토큰의 `<span>` 이 잘려 색상이 유실됩니다.

---

### 🗺️ ② 구조맵 (Structure Map View)

파일 내부 구성 요소를 계층적 카드로 구조화합니다.

- **라인 범위 표기**: `L11–L33` 형식으로 시작–끝 범위 명시
- **Hook 감지 위치 나열**: 2회 이상 사용된 Hook 의 모든 라인 번호(`L25, L175`) 명시
- **복잡도 경고**: 라인 수 > 100 또는 Hook > 5개 → `🚨 Refactor` 배지
- **인터랙티브 스크롤**: 카드 클릭 시 하이라이트 뷰의 해당 라인으로 이동

---

### 📊 ③ 메트릭 대시보드 (Metrics Dashboard)

- **Summary Cards**: 총 라인 수, 컴포넌트 수, 함수 수, Hook 수, Import 수, 상수 수, JSX 요소 수, 주석 수
- **Function Size Bar Chart**: 라인 수 내림차순 정렬, `L11–L33` 범위 표시, 클릭 시 이동
- **Hook Breakdown Chart**: 사용 빈도 시각화, 호버 시 감지 라인 툴팁, 클릭 시 이동
- **이중 검증 (Traceability)**: 모든 수치가 소스 라인 근거를 함께 제시하여 즉시 상호 검증 가능

---

### 🔄 ④ 컴포넌트 플로우 (Flow Chart)

컴포넌트 간 렌더링 관계 및 함수 호출 흐름을 DAG 로 표현합니다.

- 🟣 **Component Node**: React 컴포넌트 (사용 Hook 배지 부착)
- 🟡 **Function Node**: 헬퍼/유틸리티 함수 (라인 수, `Async` 배지 부착)

**엣지 관계**

| 표기 | 의미 |
| :--- | :--- |
| `renders` (실선) | 부모가 하위 컴포넌트를 JSX 에서 인스턴스화 |
| `calls` (점선) | 스코프 내부에서 헬퍼 함수를 동기 호출 |
| `calls Async` (하늘색 + 배지) | `await` / `fetch` / `.then` 을 포함하는 비동기 호출 |

**독해 요령**
1. **단방향 의존성 검증** — 상위 노드에서 하위로 결합도가 수직 하강하는지 확인
2. **비동기 병목 추적** — `calls Async` 라인으로 네트워크·타이머 대기 지점 식별
3. **High Fan-out 식별** — 화살표가 과도하게 뻗는 노드는 SRP 위반 후보

> ⚠️ 이 탭은 정규식 파서 기반이라 **주석이나 문자열 안의 함수명도 호출로 집계될 수 있습니다.** 정밀한 호출 관계가 필요하면 동작 탭을 참고하세요.

---

### ⚡ ⑤ 동작 분석 (Behavior View)

앞의 네 탭이 **"무엇이 있는가"** 를 다룬다면, 이 탭은 **"어떻게 동작하는가"** 를 다룹니다.

**UI 구성**
1. 상단 — 컴포넌트별 이벤트 핸들러 칩 (`<button onClick> L13`)
2. 하단 — 선택된 이벤트의 연쇄를 번호 매긴 세로 스텝으로 표시

**스텝 종류와 색상**

| `kind` | 표시 | 색 | 클릭 이동 |
| :--- | :--- | :--- | :--- |
| `event` | 이벤트 | 🔵 파랑 | JSX 속성 위치 |
| `setter` | 상태 변경 | 🟣 보라 | 호출 위치 |
| `effect` | Effect 실행 | 🟡 노랑 | `useEffect` 선언 위치 |
| `call` | 함수 호출 | 🟢 초록 | 로컬 함수는 선언 위치, Effect 내부 호출은 호출 위치 |
| `rerender` | 화면 갱신 | ⚪ 회색 | — (특정 라인 없음) |
| `boundary` | 범위 밖 | 🟠 주황 점선 | — |

---

## 3. 동작 분석 상세 — 상태 변화 연쇄 추적

### 3-1. 추적하는 연쇄

```
이벤트 → setter 호출 → 상태 변경 → deps 가 일치하는 Effect 재실행
       → 내부 호출 / 비동기 → 또 다른 setter → 리렌더
```

실제 출력 예시:

```
① 이벤트         <button onClick>              L13
② 상태 변경      setOpen()  →  open            L13
   └ deps [open] 에 'open' 가 있어 다시 실행됩니다
③ Effect 실행    useEffect 재실행   [.then]     L8
④ 함수 호출      fetchData()   [비동기]         L10
⑤ 상태 변경      setData()  →  data
⑥ 화면 갱신      리렌더
```

### 3-2. 상태로 인식하는 대상

| 선언 | `kind` | 비고 |
| :--- | :--- | :--- |
| `const [x, setX] = useState()` | `state` | ArrayPattern 구조분해로 결합 |
| `const [s, dispatch] = useReducer()` | `reducer` | 동일 구조로 처리 |
| `const dispatch = useDispatch()` | `store` | 대상이 컴포넌트 밖 → Effect 연결 미판정 |

`store` 는 상태가 외부에 있으므로 로컬 Effect 연결을 따지지 않고 *"외부 스토어가 바뀌어 구독 중인 컴포넌트들이 다시 그려집니다"* 로 종료합니다.

### 3-3. 핸들러 해석 규칙

| 패턴 | 처리 |
| :--- | :--- |
| `onClick={() => setOpen(true)}` | 인라인 표현식에서 setter 직접 탐지 |
| `onChange={setQuery}` | setter 를 값으로 전달 — 참조 자체를 setter 호출로 간주 |
| `onClick={handleClick}` | 로컬 함수로 진입해 내부 setter 탐지 |
| `onClick={reset}` → `reset()` → `clearAll()` | 최대 3단계까지 간접 호출 추적 |
| `.then(setData)` | 인자로 넘긴 setter 참조도 호출로 간주 |

**함수 래퍼 해제**: `memo` / `forwardRef` / `useCallback` / `observer` 로 감싼 선언은 래퍼를 벗겨 실제 함수 노드를 추출합니다. `memo(forwardRef(fn))` 처럼 중첩된 경우도 처리합니다.

**오탐 방지**
- 로컬 함수 추적 시 `obj.foo()` 형태(MemberExpression)는 따라가지 않습니다. `new Set().add(id)` 의 `add` 가 동명의 로컬 함수 `add()` 로 오인되는 문제가 실제로 발생했습니다.
- 해당 범위 안에서 선언된 함수는 호출 목록에서 제외합니다. 본문도 함께 순회하므로 `load()` 와 그 안의 `fetchUser()` 가 중복 노출됩니다.
- 배열 / Set / Map / 문자열 내장 메서드(`map`, `filter`, `has`, `then` 등)는 흐름 설명이 아니라 노이즈이므로 제외합니다.

### 3-4. 컴포넌트 탐색

- **최상위**: 대문자로 시작하는 함수 선언 및 변수 할당 (기존 규칙과 동일)
- **중첩**: 다른 함수 내부에 선언된 것은 **대문자 + JSX 포함** 조건을 추가로 확인합니다. 이름만 보면 대문자로 시작하는 일반 헬퍼까지 컴포넌트로 오인되기 때문입니다.
- 수집 시 다른 컴포넌트의 서브트리를 가지치기하여, 중첩 컴포넌트의 상태가 바깥 컴포넌트에 귀속되지 않도록 합니다.

### 3-5. 커스텀 훅 추적

로직을 커스텀 훅으로 추출하는 것은 권장 패턴이므로, **잘 분리된 코드일수록 상태와 Effect 가 컴포넌트가 아니라 훅 안에 있습니다.** 훅을 보지 못하면 정작 잘 만든 코드에서 아무것도 찾지 못합니다.

**해석 절차**
1. `use[A-Z]` 로 시작하는 최상위 함수를 훅으로 식별 (React 내장 훅 제외)
2. 훅의 `return` 문을 읽어 **내보낸 이름 → 내부 이름** 대응표 생성
   - `return { query, setQuery }` (ObjectExpression)
   - `return [query, setQuery]` (ArrayExpression)
3. 호출부 구조분해를 대응표로 해석
   - `const { setQuery } = useSearch()`
   - `const { setQuery: setQ } = useSearch()` — 이름 변경도 연결
4. 훅의 Effect 와 **훅 내부에서만 쓰는 setter** 도 함께 병합

4번이 필요한 이유: 컴포넌트가 `setUser` 를 구조분해하지 않더라도, 훅의 Effect 안에서 일어나는 `setUser()` 호출을 연쇄에 표시해야 하기 때문입니다.

상태에는 출처가 기록되어 `[useSearch]` 배지와 *"useSearch 훅이 관리하는 상태입니다"* 주석이 붙습니다.

---

## 4. 스코프 경계(Boundary) — 단일 파일 분석의 한계 표기

### 4-1. 문제 정의

Code Bunseki 는 **단일 파일(또는 붙여넣은 스니펫) 단위 도구**입니다. `import` 대상의 본문은 알 수 없습니다. 이는 고칠 수 있는 결함이 아니라 **입력 범위에서 오는 구조적 제약**입니다.

문제는 제약 자체가 아니라, 초기 구현에서 아래 세 가지가 모두 `상태 변화 없음` 이라는 **동일한 출력**으로 수렴했다는 점이었습니다.

1. 실제로 상태를 변경하지 않는 핸들러
2. prop 으로 전달받아 부모에 정의된 콜백
3. 다른 파일에서 import 한 훅에서 받아온 함수

사용자가 **"도구가 못 찾은 것"과 "실제로 없는 것"을 구분할 수 없었습니다.**

### 4-2. 해결 — `boundary` 스텝

흐름이 범위를 벗어나면 그 지점과 이유를 명시합니다.

```
·  여기서부터 범위 밖
   onChange   ← prop 으로 전달받은 함수
   이 컴포넌트를 사용하는 쪽에 있습니다.
   부모 코드도 함께 붙여넣으면 이어서 볼 수 있습니다
```

```
·  여기서부터 범위 밖
   setQuery   ← useSearch 에서 받아옴
   이 훅은 다른 파일에 있어 여기서부터는 따라갈 수 없습니다
```

**판정 로직** — 핸들러가 참조하는 식별자에 대해:

| 조건 | 결과 |
| :--- | :--- |
| 로컬 함수 목록에 있음 | 경계 아님 — 계속 추적 |
| import 한 훅의 구조분해 결과 | `boundary` — 훅 이름 명시 |
| 컴포넌트 파라미터(prop) 이름 | `boundary` — 부모 참조 안내 |
| 위 어디에도 없음 | 실제로 상태 미변경 |

### 4-3. 실무 활용

경계 표시는 **"어떤 코드를 더 붙여넣어야 하는가"** 에 대한 답입니다. 컴포넌트와 그 컴포넌트가 사용하는 커스텀 훅을 함께 붙여넣으면 연쇄가 끊기지 않습니다.

---

## 5. 정량적 메트릭 수치를 활용한 코드 리팩토링 전략

1. **God Component 해체 (라인 수 > 100, State Hook > 5개 → `🚨 Refactor` 배지)**
   - 로직 및 상태 관리를 **Custom Hook** 으로 모듈화
   - JSX 하위 뷰를 **Sub-component** 로 분리

2. **Effect 오남용 방지**
   - Hook Breakdown 에서 `useEffect` 비중이 높으면 `useMemo` 전환 또는 렌더 타임 계산으로 대체

3. **상태 연쇄(Cascade) 진단** ⭐ 동작 탭 활용
   - 동작 탭에서 `setter → effect → setter → effect` 가 반복되면 **파생 상태를 상태로 관리하고 있다는 신호**입니다.
   ```jsx
   // ❌ 불필요한 연쇄
   const [total, setTotal] = useState(0)
   useEffect(() => { setTotal(items.length) }, [items])

   // ✅ 렌더 타임 계산
   const total = items.length
   ```
   - 연쇄 깊이가 3단계를 넘으면 리렌더 횟수와 중간 상태 불일치를 의심하십시오.

4. **Props Drilling & 결합도 진단**
   - 동작 탭에서 `prop 으로 전달받은 함수` 경계가 여러 컴포넌트에 반복 등장하면 Context 또는 전역 상태 도입 검토

5. **헬퍼 함수 진단 및 분리**
   - **Dead Code 감지**: 플로우 차트 하단에 연결선 없이 독립된 헬퍼 카드 → 미사용 잔재 가능성
   - **비동기 예외 처리 점검**: `calls Async` 연결 함수는 `try/catch` 및 Error Boundary 확인 필수
   - **공통 유틸 분리**: 중복 호출되는 헬퍼는 `src/utils/` 로 추출하여 순수 함수로 캡슐화

---

## 6. 조각/부분 코드(Truncated Code) 분석 매커니즘

**탭에 따라 동작이 다릅니다.**

| 탭 | 조각 코드 | 근거 |
| :--- | :--- | :--- |
| ① ~ ④ | ✅ 분석 가능 | 라인 스캐닝 파서라 구문 완결성 불필요 |
| ⑤ 동작 | ❌ 분석 불가 | AST 구성에 구문 완결성 필요 |

동작 탭은 파싱 실패 시 오류 위치와 사유를 표시하고 **해당 탭만 비활성화**됩니다.

```
문법 오류로 동작을 분석할 수 없습니다
JSX 태그가 닫히지 않았습니다. 코드가 중간에 잘렸는지 확인해 주세요.
L30
```

`@babel/parser` 의 `errorRecovery: true` 는 복구 가능한 오류만 처리하며, 잘린 JSX(`UnterminatedJsxContent`) 같은 토크나이저 수준 실패는 예외를 발생시킵니다. 절단 후 재시도하는 휴리스틱 복구도 검토했으나, **부분 복구된 결과가 사용자에게 완전한 분석으로 오인될 위험**이 더 크다고 판단하여 채택하지 않았습니다.

> **설계 원칙**: 조용히 틀린 결과를 내놓느니 실패 지점을 정확히 알리는 편이 낫습니다. 정규식 파서는 잘린 함수를 `Math.min(startIdx + 1, ...)` 로 처리해 **2줄짜리로 보고**하며, 사용자는 이것이 틀렸다는 사실을 알 방법이 없습니다.

---

## 7. 도구가 보장하는 것과 보장하지 않는 것

### ✅ 보장하는 것

- **구문이 완전한 코드에서 오탐(false positive)이 없습니다.** 표시되는 연쇄는 실제 코드 구조와 일치합니다.
- 모든 스텝은 소스 라인 근거를 가지며 클릭으로 검증 가능합니다.
- 동작 분석 실패가 다른 탭에 전파되지 않습니다.

### ⚠️ 보장하지 않는 것

**1. 완전성 (Completeness)**  
붙여넣은 범위 밖의 흐름은 추적하지 않습니다. 다만 그 지점을 `boundary` 로 명시하므로, 누락이 침묵하지는 않습니다.

**2. 실행 경로 (Runtime Path)**  
정적 분석은 **가능한 경로**를 보여줄 뿐 **실제 실행**을 알지 못합니다.

```jsx
useEffect(() => {
  if (!open) return        // ← 런타임 값에 따라 조기 반환
  fetchData()
}, [open])
```

`open` 이 `false` 로 전이될 때도 `fetchData()` 스텝이 표시됩니다. 조건 분기는 표현되지 않습니다.

**3. 미지원 패턴**  
클래스 컴포넌트, Context 값 전파, 파일 간 컴포넌트 트리 추적은 현재 범위 밖입니다.

### 📌 함의

**"잘 짜인 코드일수록 분석이 잘 된다"는 성립하지 않습니다.** 커스텀 훅 추출, 프레젠테이션 컴포넌트 분리, prop 콜백은 모두 권장 패턴이지만 단일 파일 분석에는 불리하게 작용합니다. 로직이 한 컴포넌트에 집중된 코드가 오히려 완전하게 분석됩니다.

이 역설을 완화하기 위해 **같은 파일 안의 커스텀 훅은 끝까지 추적**하고, 파일을 벗어나는 지점은 **경계로 명시**하는 방향을 택했습니다.

---

## 8. 협업 및 문서화 (Export & Markdown Report)

- 상단 **[Export]** 버튼 클릭 시 코드 구조 및 정량 메트릭이 Markdown 으로 클립보드에 복사됩니다.
- Pull Request 본문, 코드 리뷰 문서, 아키텍처 보고서에 즉시 활용 가능합니다.

> **현재 Export 범위**: 정규식 파서 기반의 메트릭·컴포넌트·플로우 정보만 포함되며, **동작 분석 연쇄는 포함되지 않습니다.**
