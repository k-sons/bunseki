# 🔄 Code Bunseki — 작업 인계문 (Handoff)

> 갱신: 2026-08-23 · 새 세션에서 이어서 작업하기 위한 인수인계 문서.
> **이 문서 하나만 읽으면 현재 상태와 다음 할 일을 파악할 수 있게** 정리합니다.

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

## 2. 여기까지 온 과정 (누적 요약)

### (1) 정규식 파서 → AST 전면 재작성 — 커밋 `91f1a13`
- 4개 탭을 굴리던 `parser.js`가 정규식 기반이라 흔한 React 패턴에서 붕괴했음:
  구조분해 props `{ }` · `memo`/`forwardRef` 래핑 · TS 제네릭 · 여러 줄 시그니처.
  (`function Card({ title })` → **1줄로 오판**, `memo(() => …)` 컴포넌트는 **아예 누락**)
- `@babel/parser` AST 기반으로 다시 씀. **출력 형태(`ParseResult`)는 그대로 유지** →
  렌더러 4개(highlighter/structure/metrics/flow) **무수정**.
- `main.js`의 `analyze()`를 async 로 바꿔 **파서를 동적 import**
  (babel 이 초기 번들에서 빠지고 ⚡동작 엔진과 같은 `lib` 청크를 공유).

### (2) 테스트 스위트 신설 — 커밋 `91f1a13`
- `test/` + `npm test` (Node 내장 러너 `node --test`, **의존성 0**).

### (3) A 트랙 1단계 — 비동기 타이밍 — 커밋 `9ecf3d5`
- `behavior/timing.js`: effect 마다 `isAsync` · **deferred setter**(await 이후·`.then` 콜백에서
  실행되는 setState) · `hasCleanup` · `hasGuard`(`if (alive)` / `AbortController`) 판정.
- **risk = 비동기 + 가드 없는 deferred setState → "언마운트 후 setState 위험"**.
- UI 가 순서대로 그리기만 하면 되는 `timeline` 배열 → ⚡동작 탭 하단 가로 타임라인.

### (4) A 트랙 2단계 — stale closure 감지 — 커밋 `de33b6f`
- **`behavior/deps.js`(신규)**: effect 가 **읽는** 이름과 deps 를 대조해 빠진 값을 찾음.
  결과 `{ name, kind: 'prop'|'state'|'local', line, inAsync }`.
  - 반응값의 범위 = effect 를 감싼 함수(컴포넌트 **또는 커스텀 훅**) 본문 **최상위** 선언 + 파라미터.
  - **헛경보를 안 내는 것이 이 검사의 전부**라 다음은 세지 않음:
    모듈/전역 이름 · setter · `useRef`/`useDispatch` 결과 · `const` 리터럴 상수 ·
    effect 안에서 선언한 이름(가림 포함) · `user.id` 의 속성 이름 · 중첩 함수 파라미터 ·
    deps 배열이 아예 없는 effect(매 렌더 새로 만들어져 옛 값을 붙잡을 일이 없음).
  - `[props.id]` 처럼 식으로 쓴 deps 도 **뿌리 이름**(`props`)으로 인정.
- `collect.js`: effect 에 `owner`(감싼 함수 노드) · `depRoots` 추가.
- `timing.js`: `analyzeSetters` → **`analyzeBody`** (한 번 훑어 setter + 참조를 함께 수집,
  `await`/`.then` 이후 참조는 `inAsync`). 결과에 `staleDeps` + `kind:'stale'` 타임라인 스텝.
- UI: 섹션 제목이 **`⏱ 타이밍 · deps 점검`**, `위험 N`/`deps 빠짐 N` 배지,
  트랙 머리말에 **`⚠ [id] 빠짐?`** 칩 + 주황 경고 박스.
  **deps 가 빠진 effect 는 동기여도** 이 섹션에 나옴(경고를 숨기지 않으려고).

### (5) A 트랙 3단계 — 다중 effect 경합 — 이번 작업
- **`behavior/interplay.js`(신규)**: timing 결과만 재료로 써서 Effect 사이 관계를 봅니다.
  "쓴다"(`setters[].state`) 와 "읽는다"(`trigger==='deps'` 이고 deps 에 그 상태가 있음) 를
  간선으로 이어 그래프를 만든 뒤:
  - **무한 루프(loop)** — 고리. 스스로 되받거나(`[count]` 인데 `setCount`) 둘이 서로 되받음.
    setter 가 전부 조건문 안이면 `warn`, 아니면 `risk`.
  - **경합(contention)** — 같은 상태를 Effect 둘 이상이 바꿈. 하나라도 비동기면 `risk`
    (응답 순서에 따라 늦게 온 옛 요청이 새 값을 덮어씀), 전부 동기면 `info`(선언 순서대로).
  - **연쇄(cascade)** — 고리가 아닌 간선을 최대 4단계까지 한 줄로 묶음. `info`.
  - 고리에 속한 간선은 연쇄로 중복 보고하지 않음. 항목은 심각도순 정렬, 컴포넌트당 최대 8개.
- `index.js`: `timing` 을 변수로 뽑아 `interplay: analyzeInterplay(timing)` 추가.
- UI: ⏱ 타이밍 섹션 **아래**에 **`🔗 Effect 사이 관계`** 섹션.
  카드마다 `[무한 루프]/[경합]/[연쇄]` 배지 + 제목 + 알약 흐름 + 설명.
  연쇄·루프는 `→`, 경합은 순서가 정해져 있지 않다는 뜻으로 `⇄` 로 잇습니다.
  setter 알약 꼬리표는 `응답 뒤`(비동기) / `조건부`(if 안).

---

## 3. 현재 상태 (스냅샷)

- ✅ **작업트리 깨끗. 미커밋 없음.** `main` 최신 = A 트랙 3단계 커밋.
- ✅ `npm test` → **50 pass / 0 fail**
  (parser 10 · behavior 5 · examples 3 · timing 8 · stale-deps 11 · interplay 13)
- ✅ `npx vite build` 정상. 초기 번들 59KB, `@babel/parser` 는 `lib` 청크(≈300KB)로 **지연 로드**.
- ✅ 브라우저 실제 렌더 확인(headless Chrome + `test/browser-verify.html`):
  `⏱ 타이밍 · deps 점검 / 위험 1 / deps 빠짐 2`, `⚠ [userId] 빠짐?` 칩,
  `🔗 Effect 사이 관계 / 무한 루프 2 / 경합 1` 카드 4장까지 그려짐.
- ✅ 노이즈 점검: useMemo/useCallback/AbortController/ref 가 섞인 대시보드 컴포넌트에서
  **오탐 0**(deps·interplay 모두), ESLint `exhaustive-deps` 와 같은 지점만 지적.

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
│       ├── collect.js          # 상태/effect/핸들러/컴포넌트 수집 (walk 등 공용 헬퍼)
│       ├── chain.js            # 이벤트→setter→상태→Effect 연쇄(Step 배열)
│       ├── hooks.js            # 같은 파일 커스텀 훅 추적 + 스코프 경계
│       ├── timing.js           # ⏱ 비동기 타이밍 + 언마운트 위험 + 참조 수집
│       ├── deps.js             # ⚠ deps 에서 빠진 값 = stale closure
│       └── interplay.js        # 🔗 Effect 사이 관계 = 루프/경합/연쇄
├── ui/
│   ├── structure.js            # 🗺️
│   └── behavior.js             # ⚡ + ⏱ 타이밍/deps UI + 🔗 관계 UI (renderInterplaySection)
└── data/examples.js            # 내장 예제 2개
test/                           # node --test. *.test.mjs + browser-verify.html
```

### ⚠️ 반드시 지킬 계약 (`ParseResult`)
`parser.js` 를 또 손댈 땐 **출력 형태를 깨지 말 것**. 렌더러 4개가 이 필드를 그대로 읽음:
`imports · functions[{name,type,isAsync,params,startLine,endLine,lineCount,hooks:[{name,category}],handlers[],isExported,isDefault}] · constants · hooks[{name,line,isRN,category}] · jsxComponents · comments · exports · rnPatterns · sections(길이=totalLines) · relations[{from,to,type,isAsync}] · totalLines`

### ⚡ 동작 엔진의 effect 객체 (내부용)
`collect.js` 가 만드는 raw effect: `{ hook, deps, depRoots, trigger, line, body, owner }`
→ `timing.js` 가 소비해 `{ line, hook, trigger, deps, viaHook, isAsync, asyncKind,
hasCleanup, hasGuard, risk, staleDeps, setters[], timeline[] }` 로 바꿔 UI 에 넘김.
**`owner`(AST 노드)는 UI 로 새어 나가지 않음** — timing 결과에는 담기지 않는다.

### 🔗 interplay 항목 (UI 계약)
`{ kind:'loop'|'contention'|'cascade', severity:'risk'|'warn'|'info', label, note,
lines:number[], steps:[{kind:'effect'|'setter'|'loopback', label, detail, line, phase?, guarded?}] }`
UI 는 `steps` 를 순서대로 알약으로 그리기만 한다.

---

## 5. 실행 방법

```bash
npm run dev        # 개발 서버 (http://localhost:5173)
npm test           # 전체 테스트 (node --test "test/**/*.test.mjs")
npx vite build     # 프로덕션 빌드

# 브라우저 실제 렌더 확인 (선택):
npx vite --port 5199 &
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --virtual-time-budget=8000 --dump-dom "http://localhost:5199/test/browser-verify.html"
```

---

## 6. 다음 할 일 (A 트랙 이어가기)

사용자가 승인한 순서. 1·2·3단계는 완료·커밋됨.

- **4단계 — 상대 시간감** ← **여기부터**
  타임라인의 "대기" 구간을 실제 폭으로 표현(즉시 실행 vs 네트워크 응답 대기).
- 남겨 둔 후보(3단계에서 의도적으로 안 건드린 것):
  - **deps 배열이 없는 Effect 가 상태를 바꾸는 경우** — 매 렌더 재실행 → 무한 루프.
    지금 그래프는 `trigger==='deps'` 인 Effect 로만 간선을 만들어서 잡히지 않음.
    같은 `loop` 카드로 붙이면 자연스러움(단일 effect 라 3단계 범위 밖이라 보류).

작업 방식(확립됨): **작게 구현 → 테스트 추가 → `npm test` → 브라우저 실제 렌더 확인 → 커밋.**

---

## 7. 환경/함정 메모

- **OS Windows**. Node 로 `src` 모듈을 직접 import 할 땐 절대경로 대신
  **`file:///C:/...` URL** 필요 (테스트는 상대경로 import 라 문제없음).
- `npm test` 는 **`node --test "test/**/*.test.mjs"`**. 디렉터리 인자(`node --test test/`)는
  Node24 에서 파일로 오인해 실패하므로 **glob 패턴 유지**.
- `.html` 하네스는 `node --test` 가 무시함(참고용).
- babel 지연 로드 설계 유지: `parser.js`/`behavior/` 는 **정적 import 금지**,
  main 에서 **동적 import**.
- **줄바꿈이 파일마다 섞여 있음**(CRLF/LF). `core.autocrlf=true` 라 커밋 시 LF 로 정규화되니,
  스크립트로 파일을 고칠 땐 **읽을 때 `\n` 으로 맞추고 원래 형식으로 되돌려 쓸 것**
  (안 그러면 파일 전체가 diff 로 잡힘).
- **오탐 정책**: `deps.js`·`interplay.js` 의 판정은
  **놓치는 쪽(false negative)이 헛경보보다 낫다**는 기준.
  규칙을 넓힐 땐 `test/stale-deps.test.mjs` 의 "잡으면 안 되는 것" 6개와
  `test/interplay.test.mjs` 의 마지막 3개를 먼저 확인.
- 임시 검증 파일은 repo 밖(세션 scratchpad)에 만들 것. 작업트리는 깨끗하게 유지.
