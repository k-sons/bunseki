# 📘 Code Bunseki — 개발자/실무자용 메트릭 & 아키텍처 가이드 (Pro Version)

> **Code Bunseki**는 React / React Native 및 JSX/TSX 코드의 구문, 상태 관리 패턴, 훅(Hook) 사용 비중, 컴포넌트 간 호출 지도를 정밀 시각화하여 **코드 품질 및 가독성을 정량화하는 개발자 도구**입니다.

---

## 📑 목차
1. [핵심 아키텍처 & 분석 파서 원리](#1-핵심-아키텍처--분석-파서-원리)
2. [분석 출력 대시보드 4가지 탭 기술 명세](#2-분석-출력-대시보드-4가지-탭-기술-명세)
   - [① 하이라이트 (Highlight View)](#-하이라이트-highlight-view)
   - [② 구조맵 (Structure Map View)](#-구조맵-structure-map-view)
   - [③ 메트릭 대시보드 (Metrics Dashboard)](#-메트릭-대시보드-metrics-dashboard)
   - [④ 컴포넌트 플로우 (Flow Chart)](#-컴포넌트-플로우-flow-chart)
3. [정량적 메트릭 수치를 활용한 코드 리팩토링 전략](#3-정량적-메트릭-수치를-활용한-코드-리팩토링-전략)
4. [조각/부분 코드(Truncated Code) 분석 매커니즘](#4-조각부분-코드truncated-code-분석-매커니즘)
5. [협업 및 문서화 (Export & Markdown Report)](#5-협업-및-문서화-export--markdown-report)

---

## 1. 핵심 아키텍처 & 분석 파서 원리

Code Bunseki의 분석 엔진(`src/core/parser.js`)은 파싱 트리가 깨지기 쉬운 엄격한 AST(Abstract Syntax Tree) 파서 대신, 라인 단위 **정규식(Regex) & 블록 뎁스(Bracket Depth) 트래킹 파서**로 구현되어 있습니다.

- **Import / Export 파싱**: ESM 모듈 의존성 및 Default/Named Export 추적
- **컴포넌트 & 함수 식별**: 대문자로 시작하는 Identifier를 React Component로 분류
- **Hook 식별 및 분류**: Standard React Hooks (`useState`, `useEffect`, `useMemo` 등), State Store Hooks (`useSelector`, `useDispatch`), Custom Hooks (`useXxx`)를 자동 분주
- **내톨성 (Fault Tolerance)**: 불완전하거나 괄호가 닫히지 않은 부분 조각 코드에서도 구문 방해 없이 유효 구조를 추출

---

## 2. 분석 출력 대시보드 4가지 탭 기술 명세

### 🎨 ① 하이라이트 (Highlight View)
코드 라인별 AST 역할에 따라 전용 배지(Badge)와 구문 색상을 주입(Injection)하여 보여줍니다.
- `Import`: 모듈 바인딩 및 외부 패키지
- `Constant`: 파일 상위 상수 선언
- `Component`: React 컴포넌트 스코프
- `State`: `useState`, `useReducer` 상태 정의
- `Effect`: `useEffect`, `useLayoutEffect` 부수 효과
- `Handler`: 이벤트 리스너/핸들러 함수 (`handleXxx`, `onXxx`)
- `JSX Render`: JSX 리턴 문 및 템플릿 영역

---

### 🗺️ ② 구조맵 (Structure Map View)
파일 내부 구성 요소(컴포넌트, 헬퍼 함수, 커스텀 훅, 모듈 상수, External Dependencies)를 계층적 카드로 구조화합니다.
- **라인 범위 표기**: 컴포넌트 및 함수 카드에 정확한 소스 코드 시작-끝 범위(`L11–L33`) 명시
- **Hook 감지 위치 나열**: 2회 이상 사용된 Hook의 경우 감지된 모든 라인 번호(`L25, L175`) 명시
- **인터랙티브 스크롤**: 구조맵 카드를 클릭하면 하이라이트 뷰의 해당 코드 시작 라인으로 자동 이동되어 1:1 대조 가능

---

### 📊 ③ 메트릭 대시보드 (Metrics Dashboard)
코드 품질을 지표화하여 대시보드로 출력합니다.
- **Summary Cards**: 총 라인 수, 컴포넌트 수, 함수 수, Hook 수, Import 수, JSX 요소 수, 주석 비중
- **Function Size Bar Chart**: 라인 수 기준 내림차순 정렬 (`L11–L33` 라인 범위 표시 및 클릭 시 코드 이동)
- **Hook Breakdown Chart**: Hook 사용 비중 시각화 (마우스 호버 시 `L25, L175` 등 감지 라인 툴팁 표시 및 클릭 시 코드 이동)
- **이중 검증 (Traceability)**: 메트릭 그래프 및 항목 클릭/호버 시 파서가 감지한 소스 코드 라인 근거를 투명하게 제시하여 사용자가 직접 1초 만에 상호 검증 가능

---

### 🔄 ④ 컴포넌트 플로우 (Flow Chart)
컴포넌트 간 렌더링 부모-자식 관계 및 헬퍼 함수/Hook의 의존 호출 흐름을 방향성 아시클릭 그래프(DAG, Directed Acyclic Graph)로 표현합니다.

#### 1) 노드(Node) 타입 명세
- 🟣 **Component Node**: React 컴포넌트 (오른쪽 스코프 내부에서 사용되는 `useState`, `useRef` 등 Hook 배지 부착)
- 🟡 **Function Node**: 헬퍼/유틸리티 함수 (라인 수 및 `Async` 비동기 특성 배지 부착)

#### 2) 엣지(Edge/Connector) 관계 및 표기 명세
- **`renders` (실선 엣지 `↓`)**: 부모 컴포넌트가 하위 컴포넌트를 JSX 내에서 직접 **선언 및 렌더링(Component Instantiation)**함을 나타냄
- **`calls` (점선 엣지 `⋮`)**: 함수/컴포넌트 스코프 내부에서 헬퍼 함수를 **동기적 호출(Synchronous Function Invocation)**함을 나타냄
- **`calls Async` (하늘색 점선 엣지 + `Async` 배지)**: `await`, `fetch`, `Promise`, `.then` 등의 키워드를 포함하는 **비동기 처리 함수(Asynchronous Invocation)**를 호출함을 나타냄

#### 3) 아키텍처 관점에서의 플로우 독해 요령
1. **단방향 의존성 흐름 검증**: 상위 렌더링 노드부터 하위 헬퍼 함수로 결합도가 단방향으로 수직 내려가는지 확인 (순환 의존성/Cyclic Dependency 감지 가능)
2. **비동기 부작용(Side Effect) 병목 지점 추적**: `calls Async` 라인을 추적하여 애니메이션 완료 대기, 타이머, 네트워크 API 호출 등 비동기 스레드 대기가 일어나는 핵심 포인트를 빠르게 식별
3. **High Fan-out (과도한 렌더링/호출 파출) 노드 식별**: 하나의 노드에서 지나치게 많은 `renders` 및 `calls` 화살표가 뻗어나가는 경우 단일 책임 원칙(SRP) 위반 지점으로 판단하여 모듈 분리 대상으로 진단

---

## 3. 정량적 메트릭 수치를 활용한 코드 리팩토링 전략

1. **God Component 해체 기준 (라인 수 > 150 lines, State Hook > 5개)**
   - 로직 및 상태 관리 코드를 **Custom Hook**으로 모듈화
   - JSX Render 템플릿의 하위 뷰 항목을 **Sub-component**로 분리

2. **Effect Side-Effect 오남용 방지**
   - Hook Breakdown에서 `useEffect` 비중이 높을 경우 계산 로직의 `useMemo` 전환 및 렌더링 타임 계산으로 리팩토링

3. **Props Drilling & 결합도 진단**
   - Flow Chart에서 상위 노드로 집중되는 고밀도 호출 화살표가 관찰되면 Context API 또는 전역 상태 관리(Zustand/Redux) 도입 검토

4. **🟡 헬퍼 함수(Helper Functions) 진단 및 분리 전략**
   - **고립된 헬퍼 함수(Dead Code) 감지**: 플로우 차트 하단에 연결선 없이 독립된 '헬퍼 함수' 카드로 표기된 함수는 코드 내에서 호출되지 않는 미사용 잔재 코드일 가능성이 높으므로 제거 대상 검토
   - **비동기 헬퍼 함수(`Async`) 예외 처리 점검**: `calls Async` 연결이 된 헬퍼 함수는 네트워크 통신/타이머/애니메이션 등 예외가 터지기 쉬운 구역이므로 `try/catch` 블록 및 Error Boundary 처리 필수 확인
   - **공통 유틸리티 모듈 분리**: 여러 컴포넌트나 함수에서 중복 호출되는 헬퍼 함수는 컴포넌트 파일 내부가 아닌 `src/utils/` 또는 `src/helpers/` 전용 파일로 추출하여 순수 함수(Pure Function)로 캡슐화

---

## 4. 조각/부분 코드(Truncated Code) 분석 매커니즘

- 코드가 중간에 잘리거나 문법적으로 완전하지 않더라도 라인 스캐닝 파서가 유효한 선언과 Hook 사용 현황을 정상적으로 파악합니다.
- 전체 파일이 아닌 **특정 컴포넌트나 함수 단위의 Partial Snippet**도 즉시 분석 및 리팩토링 검토가 가능합니다.

---

## 5. 협업 및 문서화 (Export & Markdown Report)

- 상단 **[Export]** 버튼 클릭 시, 코드 구조 및 정량 메트릭 통계가 Clean Markdown 양식으로 클립보드에 자동 생성됩니다.
- Pull Request(PR) 본문, 코드 리뷰 문서, 기술 블로그 및 아키텍처 보고서에 즉시 활용 가능합니다.
