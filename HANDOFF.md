# 🔄 Code Bunseki — 작업 인계문 (Handoff)

> 작성: 2026-08-23 · 새 세션에서 이어서 작업하기 위한 인수인계 문서.
> 이 문서 하나만 읽으면 현재 상태와 다음 할 일을 파악할 수 있게 정리함.

---

## 1. 이 앱이 뭔가

**Code Bunseki** — React / React Native 코드 한 파일을 붙여넣으면 **5개 탭**으로 분석해 주는
브라우저 정적 분석 도구. Vite + Vanilla JS(프레임워크 없음). 사용자 목적은 **"코드 이해"**.

| 탭 | 답하는 질문 | 엔진 |
| :--- | :--- | :--- |
| 🎨 하이라이트 | 어느 구역이 무슨 역할인가 | `parser.js` |
| 🗺️ 구조맵 | 파일 안에 뭐가 있나 | `parser.js` |
| 📊 메트릭 | 어디가 비대하고 Hook이 몰렸나 | `parser.js` |
| 🔄 플로우 | 컴포넌트·함수가 어떻게 연결되나 | `parser.js` |
| ⚡ 동작 | **버튼을 누르면 실제로 무슨 일이 일어나나** | `behavior/` (AST) |

---

## 2. 이번 세션에서 한 일 (요약)

### (1) 진단 — 왜 결과가 불만족스러웠나
- 4개 탭을 굴리던 `parser.js`가 **정규식 기반**이라 흔한 React 패턴에서 붕괴:
  구조분해 props `{ }`·`memo`/`forwardRef` 래핑·타입스크립트 제네릭·여러 줄 시그니처.
- 예: `function Card({ title })` → **1줄로** 오판, `memo(() => …)` 컴포넌트는 **아예 누락**.
- 반면 `behavior/`(⚡동작 탭)는 **AST(@babel/parser) 기반**이라 견고했음. → 품질 격차의 원인.

### (2) 수정 — 정규식 파서를 AST로 통일 ✅ **커밋됨 (`91f1a13`)**
- `src/core/parser.js`를 **@babel/parser AST 기반으로 전면 재작성**.
  **출력 형태(`ParseResult`)는 그대로 유지** → 렌더러 4개(highlighter/structure/metrics/flow) **무수정**.
- `src/main.js`: `analyze()`를 async로 바꿔 **파서를 동적 import**(babel이 초기 번들에서 빠지고
  ⚡동작 엔진과 같은 `lib` 청크 공유). export 리포트의 `[object Object]` 버그도 수정.
- 결과: `Card` 1줄→6줄, `memo` 컴포넌트 감지, God Component 1줄→43줄, 섹션맵/관계 정확.

### (3) 테스트 스위트 신설 ✅ **커밋됨 (`91f1a13`)**
- `test/` + `npm test`(Node 내장 러너 `node --test`, **의존성 0**).
- `parser.test.mjs`(하드 케이스+계약), `behavior.test.mjs`(연쇄+경계), `examples.test.mjs`(내장 예제),
  `browser-verify.html`(브라우저 실제 렌더 하네스, 참고용).

### (4) A 트랙 1단계 — 비동기 타이밍 분석 ⚠️ **미커밋 (작업트리에만 있음)**
- 사용자가 기능 확장 방향으로 **A(비동기 타이밍 시각화)** 선택 → ⚡동작 탭 **안에** 넣기로 함(옵션 a).
- **`src/core/behavior/timing.js`(신규)**: effect마다
  - `isAsync`(await/.then/fetch), **deferred setter**(await 이후·.then 콜백 = 응답 뒤 실행되는 setState.
    `await 이전` setter는 즉시로 구분), `hasCleanup`, `hasGuard`(`if(alive)` / `AbortController`),
  - **risk = 비동기 + 가드 없는 deferred setState → "언마운트 후 setState 위험"**,
  - UI가 순서대로 그리기만 하면 되는 `timeline` 배열.
- `behavior/index.js`: 컴포넌트마다 `timing` 필드 연결.
- `ui/behavior.js` + `styles/index.css`: ⚡동작 탭 하단에 `⏱ 비동기 타이밍` 섹션(가로 타임라인+위험 배지).
- **`test/timing.test.mjs`(신규, 8개)**: 위 판정 회귀 고정. 브라우저에서 실제 렌더도 확인함.

---

## 3. 현재 상태 (스냅샷)

- ✅ `npm test` → **26 pass / 0 fail** (parser 10, behavior 5, examples 3, timing 8)
- ✅ `npx vite build` 정상. 초기 번들 59KB, `@babel/parser`는 `lib` 청크(≈300KB)로 **지연 로드**.
- **커밋 상태**:
  - `91f1a13 문제해결고도화전` = (2)(3) 파서 재작성 + 테스트. (이미 커밋)
  - **미커밋 = A 트랙 1단계 전부** ↓
    ```
    M src/core/behavior/index.js      # timing 연결
    M src/styles/index.css            # ⏱ 타이밍 CSS
    M src/ui/behavior.js              # ⏱ 타이밍 UI
    ?? src/core/behavior/timing.js    # 타이밍 엔진 (신규)
    ?? test/timing.test.mjs           # 타이밍 테스트 (신규)
    ```
  - ⚠️ 이 인계문(`HANDOFF.md`)도 아직 미커밋.

---

## 4. 파일 지도 (핵심만)

```
src/
├── main.js                     # 앱 진입. analyze()가 파서를 동적 import → 4개 탭 렌더
├── core/
│   ├── parser.js               # [AST] 4개 탭용. parseCode(code) → ParseResult (계약 유지!)
│   ├── highlighter.js          # 🎨 (sections 소비)
│   ├── metrics.js              # 📊 (functions/hooks 소비)
│   ├── flow.js                 # 🔄 (relations 소비)
│   └── behavior/               # ⚡ 동작 엔진 (AST)
│       ├── index.js            # parseBehavior(code) → { components[], error }
│       ├── collect.js          # AST에서 상태/effect/핸들러/컴포넌트 수집 (walk 등 공용 헬퍼)
│       ├── chain.js            # 이벤트→setter→상태→Effect 연쇄(Step 배열)
│       ├── hooks.js            # 같은 파일 커스텀 훅 추적 + 스코프 경계
│       └── timing.js           # ⏱ 비동기 타이밍 + 위험 (이번에 신규)
├── ui/
│   ├── structure.js            # 🗺️
│   └── behavior.js             # ⚡ + ⏱ 타이밍 UI (renderTimingSection)
└── data/examples.js            # 내장 예제 2개
test/                           # node --test. *.test.mjs + browser-verify.html
```

### ⚠️ 반드시 지킬 계약 (`ParseResult`)
`parser.js`를 또 손댈 땐 **출력 형태를 깨지 말 것**. 렌더러 4개가 이 필드를 그대로 읽음:
`imports · functions[{name,type,isAsync,params,startLine,endLine,lineCount,hooks:[{name,category}],handlers[],isExported,isDefault}] · constants · hooks[{name,line,isRN,category}] · jsxComponents · comments · exports · rnPatterns · sections(길이=totalLines) · relations[{from,to,type,isAsync}] · totalLines`

---

## 5. 실행 방법

```bash
npm run dev        # 개발 서버 (http://localhost:5173)
npm test           # 전체 테스트 (node --test "test/**/*.test.mjs")
npx vite build     # 프로덕션 빌드

# 브라우저 실제 렌더 확인 (선택):
npx vite &
"<Chrome 경로>" --headless --disable-gpu --virtual-time-budget=6000 \
  --dump-dom "http://localhost:5173/test/browser-verify.html"
```

---

## 6. 다음 할 일 (A 트랙 이어가기)

사용자가 승인한 순서. **먼저 미커밋 1단계를 커밋할지 물어볼 것.**

- **2단계 — stale closure 감지**: 비동기 콜백이 참조하는 변수가 effect deps에서 빠졌는지
  검사 → `⚠ [id] 빠짐?` 힌트. (`timing.js`에 deps vs 콜백 참조 비교 추가)
- **3단계 — 다중 effect 경합**: 같은 상태를 여러 effect가 건드릴 때 실행 순서/충돌 시각화.
- **4단계 — 상대 시간감**: 타임라인의 "대기" 구간을 실제 폭으로 표현.

작업 방식(이 세션에서 확립): **작게 구현 → 테스트 추가 → `npm test` → 브라우저 렌더 확인**.

---

## 7. 환경/함정 메모

- **OS Windows**. Node로 `src` 모듈을 직접 import할 땐 절대경로 대신 **`file:///C:/...` URL** 필요
  (테스트는 상대경로 import라 문제없음).
- `npm test`는 **`node --test "test/**/*.test.mjs"`**. 디렉터리 인자(`node --test test/`)는 Node24에서
  파일로 오인해 실패하므로 **glob 패턴 유지**.
- `.html` 하네스는 `node --test`가 무시함(참고용).
- babel 지연 로드 설계 유지: `parser.js`/`behavior/`는 **정적 import 금지**, main에서 **동적 import**.
- 임시 검증 파일은 repo 루트에 만들고 반드시 삭제(작업트리 깨끗이). 임시물은 `$CLAUDE_JOB_DIR/tmp` 사용.
