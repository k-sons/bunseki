# 🔄 Code Bunseki — 작업 인계문 (Handoff)

> 갱신: 2026-08-24 · 새 세션에서 이어서 작업하기 위한 인수인계 문서.
> **이 문서 하나만 읽으면 현재 상태와 다음 할 일을 파악할 수 있게** 정리합니다.

---

## 0. 새 세션이면 여기부터 (3분)

1. `git log --oneline -5` — 맨 위가 **인계문 갱신**, 그 아래가 `ee3cd82`(다-2) 인지 확인.
2. `npm test` — **142 pass / 0 fail** 이면 출발점이 맞음.
3. 이 문서 **3장(현재 상태)** 과 **6장(다음 할 일)** 만 보면 바로 이어서 작업 가능.
4. 코드를 만지기 전, 손댈 파일이 4장 "계약" 3개 중 어디에 걸리는지 확인.

> **다음 할 일은 아직 정해지지 않았습니다** — 6장에 후보를 적어 두었으니
> 무엇을 할지 **먼저 합의하고** 착수할 것.

지금 ⚡ 동작 탭은 **세 덩어리**입니다 — 위에서부터
**이벤트 연쇄**(칩 고르면 세로 스텝) · **⏱ 타이밍 · deps 점검**(가로 타임라인) ·
**🔗 Effect 사이 관계**(루프/경합/연쇄 카드).
상태·Effect 가 커스텀 훅 안에 있으면 세 곳 모두 **🪝 훅 표시**가 붙습니다
(연쇄는 스텝을 상자로 묶는 **훅 구역**, 나머지 둘은 배지).

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

### (5) A 트랙 3단계 — 다중 effect 경합 — 커밋 `69226e5` + `e0a3521`
- **`behavior/interplay.js`(신규)**: timing 결과만 재료로 써서 Effect 사이 관계를 봅니다.
  "쓴다"(`setters[].state`) 와 "읽는다"(`trigger==='deps'` 이고 deps 에 그 상태가 있음) 를
  간선으로 이어 그래프를 만든 뒤:
  - **무한 루프(loop)** — 고리. 스스로 되받거나(`[count]` 인데 `setCount`) 둘이 서로 되받음.
    **deps 배열이 아예 없는 Effect**(매 렌더 재실행)가 상태를 바꾸는 것도 같은 카드.
    setter 가 전부 조건문 안이면 `warn`, 아니면 `risk`.
  - **경합(contention)** — 같은 상태를 Effect 둘 이상이 바꿈. 하나라도 비동기면 `risk`
    (응답 순서에 따라 늦게 온 옛 요청이 새 값을 덮어씀), 전부 동기면 `info`(선언 순서대로).
  - **연쇄(cascade)** — 고리가 아닌 간선을 최대 4단계까지 한 줄로 묶음. `info`.
  - 고리에 속한 간선은 연쇄로 중복 보고하지 않음. 항목은 심각도순 정렬, 컴포넌트당 최대 8개.
- `timing.js`: setter 마다 **`nested`**(중첩 함수 안에서 불리는가) 추가.
  `setInterval(() => setX())` 처럼 나중에 불리는 setter 를 매 렌더 루프로 오탐하지 않으려는 것.
  매 렌더 루프는 `!nested && !deferred` 인 **곧바로 부르는 setter** 만 셉니다.
- `index.js`: `timing` 을 변수로 뽑아 `interplay: analyzeInterplay(timing)` 추가.
- UI: ⏱ 타이밍 섹션 **아래**에 **`🔗 Effect 사이 관계`** 섹션.
  카드마다 `[무한 루프]/[경합]/[연쇄]` 배지 + 제목 + 알약 흐름 + 설명.
  연쇄·루프는 `→`, 경합은 순서가 정해져 있지 않다는 뜻으로 `⇄` 로 잇습니다.
  setter 알약 꼬리표는 `응답 뒤`(비동기) / `조건부`(if 안).

### (6) A 트랙 4단계 — 상대 시간감 — 커밋 `25c8249`
- 타임라인의 모든 스텝이 같은 크기의 알약이라 `setLoading(true)` 와 "응답 대기" 가
  똑같은 무게로 보였음. **기다리는 구간만 폭을 키워** "여기서 시간이 흐른다" 를 눈에 보이게 함.
- `timing.js`: `kind:'async-wait'` 스텝에 세 필드 추가 —
  `weight`(즉시 스텝을 1 로 본 상대 눈금, **2~12**) · `waitMs`(리터럴로 확인된 ms, 모르면 `null`) ·
  `detail`(`≈3초` / `시간 미상`).
  - **`await` 하는 식 안에서만** 지연 리터럴을 찾음: `await sleep(2000)` ·
    `await new Promise(r => setTimeout(r, 300))`. `setTimeout/setInterval` 의 2번째 인자,
    `sleep|delay|wait|pause` 의 1번째 인자가 `NumericLiteral` 일 때만.
  - effect 어딘가의 `setInterval(…, 1000)` 을 **응답 대기 시간으로 오해하지 않으려고**
    await 바깥의 타이머는 세지 않음. 못 찾으면 `WAIT_WEIGHT_UNKNOWN = 6`.
  - ms→무게는 계단식(`weightForMs`): <100→2 · <500→4 · <1000→5 · <3000→8 · <10000→10 · 그 이상→12.
- UI: `renderTimingPill()` 이 `step.weight > 1` 이면 `minWidth = weight × 22px`(상한 12) +
  `.timing-pill--wide` 클래스 + 툴팁. CSS 는 대기 알약에 **줄무늬 결**(지나가는 시간처럼).
- **`isAsync`/`risk` 판정은 건드리지 않음** — 순수하게 보여주기만 추가.

### (7) B) 이벤트 연쇄에도 기다리는 구간 — 커밋 `0daccf8`
- 상대 시간감이 ⏱ 타임라인에만 있어, 위쪽 이벤트 연쇄에서는 응답을 기다리는 자리가
  드러나지 않았음. 두 섹션이 **같은 눈금**(weight)을 쓰게 맞춤.
- `timing.js` 가 `describeWait(body)` · `describeAsyncPhase(body, setterNames)` 를 **export**,
  `chain.js` 가 가져다 씁니다 (behavior 안쪽 의존, 순환 없음).
- `chain.js`: 비동기 Effect 의 setter 를 응답 전/후로 갈라 사이에 `kind:'wait'` 스텝을
  **한 번만** 끼움. 응답 뒤에 바뀌는 상태가 없으면(fire and forget) 넣지 않음.
  - 연쇄는 setter 를 **이름 단위**로 나열하므로 `setLoading(true) … setLoading(false)` 처럼
    응답 전후 모두 불리는 이름은 **"응답 전"** 으로 봅니다.
- UI: 세로 목록이라 **높이**로 (`weight × 7px`). 대기 스텝은 번호를 먹지 않음(번호가 안 건너뜀).
- **덧 — `.then(setUser)`**: setter 를 그대로 넘기는 형태를 `timing.js` 가 통째로 놓치고 있었음.
  콜백으로 감싼 것과 같은 뜻이라 같게 셉니다. 그 결과 이 형태의 **언마운트 위험·Effect 관계도
  이제 잡힙니다**(전에는 조용히 비어 있었음).

### (8) E) 다지기 — 커밋 `75a06da`
실제형 파일(최대 2643줄)과 좁은 화면으로 훑어 나온 것들:
- **오탐 1건 수정** — `if (!alive) return` 을 가드로 못 봐 헛경보. `isEarlyReturnGuard()` 추가.
  `if (…) return|throw` 뒤의 문장은 조건이 참일 때만 실행되므로 감싼 것과 같게 봄.
  **else 가 붙으면 세지 않음**(갈림길일 뿐 "여기서 끝" 이 아님).
- **버그 1건 수정** — `<button onClick>` 라벨이 innerHTML 에서 **진짜 `<button>` 으로 렌더**돼
  이벤트 스텝이 빈칸으로 보였음. `ui/behavior.js` 에 `esc()` 를 두고 **코드에서 온 문자열은
  전부 통과**시킴 (라벨·detail·note·배지·deps 이름·훅 이름·상태 요약).
  → **새 innerHTML 을 쓸 땐 반드시 `esc()` 를 거칠 것.**
- **좁은 화면** — 대기 알약의 `min-width` 가 `max-width` 를 이겨 넘칠 수 있었음 →
  `min(Npx, 100%)`. 360/768/1280 에서 가로 넘침 0px 확인.
- **접근성** — 폭·높이로만 전해지던 대기 시간을 `aria-label` 로도 제공.
- **성능은 문제 없음** — 2643줄에서 behavior 70ms · parser 71ms, 대략 선형.
- 다른 렌더러(structure/metrics/flow)는 식별자만 끼워 넣어 `<` 가 새지 않음 — 손대지 않음.

### (9) C) 조건부 실행 표시 — 커밋 `e20abb0`
- 타임라인이 알약을 죽 늘어놓기만 해서, 첫 줄에서 되돌아 나가는 effect 도
  **"언제나 끝까지 간다" 처럼** 보였음. 이른 반환 조건을 **관문(gate)** 으로 그립니다.
- `timing.js`: **`findGates(body, code)`(신규)** — effect 본문 **최상위**의
  `if (…) return|throw` 를 모아 `{ line, stop:'return'|'throw', cond }`.
  `cond` 는 **원본 소스를 그대로 잘라** 씁니다(공백 정리 + 32자 잘림) →
  `analyzeEffectsTiming(effects, states, code)` 로 **code 를 넘기게** 됨(`index.js` 한 줄).
  - **곧바로 부르는 함수 한 겹까지** 들어감 — `(async () => {…})()` IIFE,
    최상위에 선언하고 최상위에서 부르는 `load()`. 비동기 effect 의 흔한 형태라서.
  - **관문으로 세지 않는 것**(헛경보 방지):
    **await 뒤의 이른 반환**(`if (!alive) return` — 관문이 아니라 언마운트 가드,
    이미 `🛡 가드됨` 으로 보임) · **나중에 불릴 콜백 안**(`setInterval(() => …)`) ·
    **else 가 붙은 if**.
    (당시엔 **블록에 문장이 둘 이상인 if** 도 안 셌지만 → **(14) C-3 에서 넓힘**)
- 타임라인: `kind:'gate'` 스텝. 관문과 **즉시 setter 를 줄 번호로 세워** 코드에 적힌
  차례대로 놓습니다 — 무엇 **앞에서** 멈추는지가 맞아야 하므로.
- `analyzeBody` 에 **`inIf`** 추가 — 조건문 가지 안의 setter. `guarded` 와 달리
  **이른 반환 뒤는 세지 않음**(관문 알약이 이미 말하므로 setter 마다 또 붙이면 시끄러움).
  즉시 setter 스텝의 `conditional` 로 나가 `조건부` 꼬리표가 됨.
- UI: `.timing-pill--gate` — 끊긴 테두리 + `↩` + 노란 계열(위험이 아니라 정보).
  `title`/`aria-label` 로 "이 조건이 참이면 아래 단계는 실행되지 않습니다".
- **⏱ 섹션에 나오는 조건은 바뀌지 않음** — 관문만 있는 동기 effect 는 여전히 생략.
  관문은 문제가 아니라 흐름 설명이라, 그것 때문에 섹션을 늘리지 않았습니다.

### (10) D) 커스텀 훅 경계 시각화 — 커밋 `15da9d2`
- `viaHook` 배지는 있었지만 **훅 안팎의 상태 흐름이 한눈에 안 보였음**. 연쇄를 죽
  늘어놓기만 하면 컴포넌트 상태와 훅이 관리하는 상태가 **같은 자리에 있는 것처럼** 보임.
- `chain.js`: 스텝마다 **`hook`**(+`hookLine`) — "이 일이 일어나는 곳이 어느 훅 안인가".
  훅이 관리하는 setter · 훅 안의 Effect · 그 Effect 안에서 일어나는 모든 것
  (호출 · 응답 대기 · 응답 뒤 setter)이 **한 구역**. 이벤트 · 리렌더 · 컴포넌트 자신의
  상태는 `null` 이라 **구역이 리렌더에서 닫힘**(흐름이 훅에서 나온다).
  - 구역이 말해 주므로 setter 의 **훅 배지·"…훅이 관리하는 상태입니다" 문구는 뺐음**(중복).
  - 여기서 `hook` 은 **코드가 적힌 자리가 아니라 상태·Effect 가 사는 자리**입니다.
    `setQuery()` 는 컴포넌트에서 부르지만 그 상태는 훅 것이라 구역 안에 놓입니다.
- `hooks.js`: 병합한 상태·Effect 에 **`hookLine`**(훅 선언 줄), 이름을 바꿔 받았으면
  **`hookInternal`** — `const [on, toggle] = useToggle()` 이면 훅 안에서 찾을 이름은 `setOn`.
- `interplay.js`: `effectStep` 에 `hook` — 얽힌 Effect 가 훅 안에 있으면 **고칠 파일이 그 훅**.
- UI: 이어지는 같은 훅 스텝을 상자(`.behavior-hookzone`)로 묶고 머리말 클릭 =
  훅 선언으로 이동. ⏱ 트랙 머리말 · 상태 요약 · 🔗 관계 알약에는 `🪝 훅이름` 배지.
  훅 안에서만 바뀌는 상태(`internalOnly`)는 "컴포넌트에서는 직접 부를 수 없습니다" 라고 적음.
  색은 **175**(청록) — 이 탭의 스텝 색(이벤트 200 · setter 280 · Effect 45 · 호출 160 ·
  경계 30)과 겹치지 않게. 구역은 스텝이 아니므로 **점선 테두리**.
- **다른 파일에서 import 한 훅은 그대로 경계(boundary)** — 안을 못 보는데 상자를 치면
  "따라가 봤다" 는 거짓말이 됩니다.

### (11) D-2) 훅이 내보낸 핸들러 — 커밋 `ca36ca2`
- 커스텀 훅은 상태만 돌려주지 않습니다. `const { onSelect } = useSelection()` 처럼
  **콜백을 돌려주고 그걸 그대로 `onClick` 에 꽂는** 형태가 흔한데, `resolveHookCalls` 가
  **setter 만** 대응시켜서 그 핸들러는 "상태를 바꾸지 않는 이벤트" 로 보였음.
- `hooks.js`: `analyzeHook` 이 훅의 **`localFns`** 도 들고 나옵니다. 내보낸 이름이 setter 가
  아니면 훅 안의 함수인지 보고, 맞으면 **`hookFns`** 로 내보냄.
  `buildReturnMap` 은 `return { inc: () => setN(n+1) }` 처럼 **그 자리에서 만들어 돌려주는
  콜백**도 노드째로 잡습니다(객체 `fns` · 배열 `fns` 양쪽).
- `index.js`: `hookFns` 를 **컴포넌트가 부르는 이름**으로 `localFns` 에 합침.
  이름이 겹치면 **컴포넌트 자신의 함수가 이김**.
- `chain.js`: `viaFns` 가 `hook`/`hookLine`/`hookInternal` 을 함께 실어 나릅니다 →
  **`call` 스텝에서 훅 구역이 열리고** 그 뒤 setter·Effect 까지 끊기지 않음.
- **import 한 훅이 돌려준 콜백은 그대로 경계** — 안을 못 보는 건 변함없음.

### (12) C-2) 이벤트 연쇄에도 관문 — 커밋 `d8f6a25`
- ⏱ 타임라인에만 있던 관문(gate)을 위쪽 **이벤트 연쇄에도** 끼웁니다. B 에서 대기 구간을
  맞췄듯, **두 섹션이 같은 말을 하게** 맞추는 작업.
- `timing.js`: `findGates` 를 **export**, 문장을 만드는 **`describeGate(g)`(신규)** 를 두고
  타임라인도 그것을 쓰게 함 → **라벨이 한 곳에서만 만들어짐**(두 섹션이 글자까지 같음).
- `index.js`: `buildEvents(comp.name, merged, scope, **code**)` — 연쇄에는 원본 소스가
  흐르지 않아 **조건식을 그대로 잘라 쓸 길을 하나 더 뚫음**(없으면 `조건` 으로 적힘).
- `chain.js`: **Effect 재실행 스텝 바로 뒤에** 관문을 모아 놓습니다. 타임라인은 관문과 즉시
  setter 를 **줄 번호로 세우지만**, 연쇄는 호출·setter 를 단계별로 늘어놓으므로 관문은
  Effect 뒤에 모음 — 말하려는 건 **"아래 단계로 못 갈 수 있다"** 하나뿐이라 그걸로 충분함.
  관문 스텝에도 **`hook`/`hookLine`** 을 답니다(훅 구역이 중간에 끊기면 안 되므로).
- UI: **`↩` 표시로 번호를 먹지 않음**(번호가 안 건너뜀) + 끊긴 테두리(`.behavior-step--gate`).
  설명은 **알약 안(hint)에만** 두고 화살표 `note` 는 건너뜁니다 — 안 그러면 같은 문장이
  두 번 나옴.
- **판정은 그대로** — `findGates` 규칙을 넓히지 않았으므로 관문으로 안 세는 것 3개
  (await 뒤 · 나중에 불릴 콜백 안 · else 붙은 if)도 연쇄에서 똑같이 적용됨.

### (13) F) Promise 사슬의 나머지 — `.catch` / `.finally` — 커밋 `3355595`
- `.then` 만 세고 있어서 **가장 흔한 한 줄이 거꾸로** 그려지고 있었음:
  `fetchIt(id).then(setData).catch(setError).finally(() => setLoading(false))`
  → `setError` 는 **통째로 사라지고**, `.finally` 의 `setLoading(false)` 이 응답 **전** 으로
  그려져 **"로딩이 언제 꺼지나" 가 정반대**로 보였음. 안 잡는 것(false negative)이 아니라
  **틀린 그림**이라 고쳤습니다.
- `timing.js`: **`PROMISE_METHODS`(`then`·`catch`·`finally`)** — 콜백을 셋 다 응답 이후
  (`deferred`)로 봅니다. `.catch`/`.finally` 만 있어도 **비동기로 셈**(`asyncKind` 는 `.then`,
  대기 알약은 `Promise 대기`).
- **에러 경로 표시 `onError`(신규)** — 어디가 에러일 때만 가는 길인가:
  `.catch(cb)` · `.then(onOk, onErr)` 의 **둘째 인자** · **`try/catch` 의 catch 절**.
  실행 시점은 응답 뒤로 같지만 **늘 불리지는 않는다**는 뜻이라 가드 꼬리표와 **따로** 답니다.
  **`.finally` 는 성공·실패 양쪽에서 불리므로 붙이지 않음.**
- `analyzeBody` 의 훑기 인자에 `onError` 가 하나 늘었습니다(`visit`/`visitFunctionBody`).
  한 번 켜지면 그 아래로 그대로 내려갑니다.
- `chain.js`: 연쇄에도 같은 표시 — `describeAsyncPhase` 가 **`errorOnly`** 를 함께 내고
  setter 스텝에 **`오류 시` 배지**. 연쇄는 이름 단위라, **성공 쪽에서도 한 번 불리는 이름**에는
  붙이지 않습니다("늘 불린다" 가 사실이므로).
- UI: `.timing-pill__when` — `오류 시`. 위험이 아니라 "늘 불리지는 않는다" 는 뜻이라
  붉은 계열을 피해 주황(25).
- **덤으로 헛경보 하나 막음** — `catch (error)` 의 이름을 **읽는 값으로 세고 있었음**.
  같은 이름의 상태가 있으면 `deps 빠짐` 으로 잘못 나올 수 있었는데, 그 자리에서 **새로
  묶는 이름**이므로 `refs` 에서 뺐습니다.

### (14) C-3) 관문의 사각지대 — 커밋 `e6496ad`
- 이른 반환의 블록에 문장이 **둘 이상**이면 못 보고 있었음:
  `if (!id) { reset(); return }` → 관문으로도 안 서고, 뒤의 setter 도 가드로 안 봤음.
  의미로 따지면 **흐름을 끝내는 건 블록의 마지막 문장**이고, 앞의 문장들은
  나가는 길에 하는 일일 뿐이라 **문장 개수는 상관이 없습니다**.
- `timing.js`: `isEarlyReturnGuard()` 를 **"else 없음 + 블록의 마지막 문장이 return/throw"** 로
  넓힘(`lastStatement()`/`isStop()` 로 갈라 둠). 이 함수 하나가 **두 곳을 먹이므로**
  관문 스텝(보여주기)과 뒤따르는 setter 의 `guarded`(**언마운트 위험 판정**)가 함께 넓어집니다.
- `stopKind()` 도 **마지막 문장** 기준으로 고침. 첫 문장을 보면
  `if (x) { log(); throw e }` 를 "오류" 가 아니라 **"중단" 으로 잘못 적었음**.
- **판정이 조용히 사라진 곳 없음** — 기존 118개가 그대로 통과. 넓히기는 `guarded` 를 늘려
  `risk` 를 지우는 쪽으로 움직이는데, 실제로 지켜지는 코드만 늘어났습니다.
- **관문으로 안 세는 것 3개는 그대로** (await 뒤 · 나중에 불릴 콜백 안 · else 붙은 if).
  `findGates` 를 두 섹션이 공유하므로 **이벤트 연쇄에도 같이** 넓어졌습니다(테스트로 확인).
- **남겨 둔 자리**: `if (x) { setY(); return }` 은 관문 알약 + setter 의 `조건부` 꼬리표가
  **함께** 섭니다. 둘이 말하는 게 달라(어디서 멈추나 / 이 setter 는 그 가지에서만 불리나)
  그대로 뒀습니다.

### (15) 라) 다지기 — 커밋 `de1fd8d`
실제형 파일(2577줄 · TS · redux · 커스텀 훅 3개)과 좁은 화면으로 훑어 나온 것들.
**넷 다 "못 잡는 것" 이 아니라 "틀리게 적는 것"** 이었습니다.
- **오탐/누락 1 (가장 큰 것) — 응답 전의 이른 반환을 언마운트 가드로 세고 있었음.**
  `if (!id) return; fetchUser(id).then(setUser)` 에서 **위험 경고가 통째로 사라졌음**.
  관문은 "여기서 멈출 수 있다" 일 뿐, **"응답이 온 시점에 아직 살아 있는가" 를 묻지 않습니다**.
  → `findGates` 가 await 에서 멈추는 것과 **같은 경계**로 맞춤:
  `visitBlock` 에서 **`deferred && isEarlyReturnGuard(stmt)`** 일 때만 가드.
- **오탐 2 — try 블록 안의 가드를 못 봤음**(위와 짝). 블록에는 문장 순서 훑기가 없어
  `try { await …; if (!alive) return; setX() }` 가 헛경보였음.
  → **`visitBlock`(신규)** 을 두고 `case 'BlockStatement'` 를 추가, 함수 본문과 같게 훑음.
- **오탐 3 — redux `dispatch()` 를 언마운트 위험으로 셌음.** 바뀌는 대상이 컴포넌트 밖이라
  없는 컴포넌트에 상태를 쓰는 게 아닙니다. `states` 의 **`kind:'store'`** 를 timing 으로
  넘겨(`storeSetters`) **위험 판정에서만 제외** — 흐름에는 그대로 그립니다.
- **틀린 말 1 — 바뀌는 상태가 없는데 "리렌더" 를 적었음.** `fetch('/log')` 같은
  fire and forget effect. → setter 가 하나도 없으면 리렌더 스텝을 넣지 않음.
- **성능 선형 확인**: 795줄 30ms → 3171줄 88ms(behavior) · 52ms(parser).
- 360/768/1280 가로 넘침 0px · 라벨 HTML 주입 0건.

### (16) 다-1) 이벤트 핸들러 안의 비동기 — 커밋 `862e62b`
- ⏱ 섹션은 **Effect 만** 봅니다. `onClick={async () => { … await … setX() }}` 도
  똑같이 기다리는 구간이 있는데 **두 섹션 어디에도 안 나와** 누르자마자 다 끝나는
  것처럼 보였음.
- `timing.js`: 비동기 판정을 **`detectAsync(body)`** 로 꺼내 export(Effect·핸들러가 같은 판정).
  `describeAsyncPhase` 가 **`immediate`** 도 함께 내보냄.
- `chain.js`: `resolveHandlerSetters` 가 **`bodies`**(인라인 화살표 + 거쳐 가는 로컬 함수)도
  내보내고, **`describeHandlerAsync`(신규)** 가 그것을 합칩니다 — 한 곳이라도 기다리면
  기다리는 것, 대기 무게는 **가장 오래 기다리는 쪽**, 이름 단위라 **한 곳에서라도 응답 전에
  불리면 응답 전**.
- 흐름 순서는 **응답 전 상태부터**. 응답 뒤 setter 앞에 `kind:'wait'`,
  catch 에서만 바뀌는 상태에 **`오류 시`** — ⏱ 타임라인과 같은 말.
- **위험 판정은 붙이지 않았습니다.** async 핸들러의 await 뒤 setState 는 거의 모든 React
  코드에 있는 형태이고 **React 18 이 이 경고를 없앴습니다** — 빨간 배지를 달면 이 프로젝트의
  "헛경보를 안 내는 쪽" 기준을 정면으로 어깁니다. (원하면 나중에 정보성 표시로 추가 가능)

### (17) 다-2) 핸들러에도 관문 — 커밋 `ee3cd82`
- C) 가 Effect 에 한 것과 같은 문제가 핸들러에 남아 있었음 —
  `onClick={() => { if (!id) return; setX() }}` 의 setX 가 **언제나 불리는 것처럼** 보였음.
- `chain.js`: **`collectHandlerGates`(신규)** — `bodies` 에서 `findGates` 를 모아 줄 번호 순
  (같은 자리는 한 번만). **부르는 자리 바로 뒤에 모읍니다**(Effect 연쇄와 같은 방식).
- `describeGate()` 를 그대로 써서 **세 곳이 글자까지 같은 문장**을 씁니다.
- **판정은 그대로** — else 붙은 if · 응답 뒤의 이른 반환 · 나중에 불릴 콜백 안은
  핸들러에서도 관문이 아닙니다(테스트로 고정).

---

## 3. 현재 상태 (스냅샷)

- ✅ **작업트리 깨끗. 미커밋 없음.** `main` 최신 = `ee3cd82`
  (A 트랙 + B + E + C + D + D-2 + C-2 + F + C-3 + **라(다지기)** + **다-1** + **다-2** 완료).
- ✅ `npm test` → **142 pass / 0 fail**
  (parser 10 · behavior 29 · examples 3 · timing 51 · stale-deps 12 · interplay 19 ·
  hook-boundary 18)
- ✅ `npx vite build` 정상. 초기 번들 59KB, `@babel/parser` 는 `lib` 청크(≈300KB)로 **지연 로드**.
- ✅ 브라우저 실제 렌더 확인(headless Chrome + `test/browser-verify.html`):
  `⏱ 타이밍 · deps 점검 / 위험 1 / deps 빠짐 2`, `⚠ [userId] 빠짐?` 칩,
  `🔗 Effect 사이 관계 / 무한 루프 3 / 경합 2` 카드 7장까지 그려짐.
  대기 알약도 실제 폭으로: `Promise 대기 · 시간 미상 [132px]`, `await 대기 · ≈3초 [220px]`.
  이벤트 연쇄에도 `⏳ 응답 대기 · 시간 미상 [높이 42px]`, **라벨 HTML 주입 0건**,
  **가로 넘침 0px**(360/768/1280).
  관문도 제자리에: `setLoading() → ↩ tab !== 'posts' 면 중단 → Promise 대기 → …`,
  `↩ !id 면 중단 → await 대기 → 응답 도착 → setPosts() 🛡 가드됨`(= await 뒤 `!alive` 는
  관문이 아니라 가드로 갔다는 확인).
- ✅ 훅 경계도 실제 렌더 확인: 구역 안이
  `setQuery()→query → useEffect 재실행 → search() → ⏳ 응답 대기 → setHits()`,
  구역 밖이 `<input onChange> → 리렌더`. 이름을 바꿔 받은 것은
  `toggle()→on (useToggle 안에서는 setOn() 입니다)`. 훅을 안 쓰는 흐름은 **구역 0개**.
  🔗 카드도 `useEffect L5 🪝 useCounter · setCount()→count · ↺ 다시 L5`.
  훅이 돌려준 콜백도 구역 안: `pick() (useSelection 안에서는 onSelect() 입니다) → setSel()→sel`.
- ✅ 연쇄의 관문도 실제 렌더 확인:
  `setTab()→tab → useEffect 재실행 → ↩ tab !== 'posts' 면 중단 → fetchPosts() → ⏳ 응답 대기 → setPosts()`.
  스텝 번호 `1 2 3 4 ↩ 5 6 7`(**안 건너뜀**), 화살표에 관문 설명 **중복 0건**.
- ✅ 오류 경로도 실제 렌더 확인:
  ⏱ `setLoading() · Promise 대기 · 응답 도착 · setData() · setError() 오류 시 · setLoading()`,
  ⚡ `setLoading() → ⏳ 응답 대기 → setError() 오류 시 → setData() → 리렌더`.
  **꼬리표는 setError 에만** (`.finally` 의 setLoading 에는 안 붙음).
- ✅ 문장이 여럿인 이른 반환도 실제 렌더 확인:
  `setLoading() → ↩ tab !== 'posts' 면 중단 → Promise 대기 → 응답 도착 → setPosts() 🛡 가드됨`
  (`{ reset(); return }` 형태). 같은 화면의 `if (!alive) return` 은 **여전히 관문이 아니라 가드**.
  ⏱ 위험 1 / deps 빠짐 2 · 🔗 무한 루프 3 / 경합 2 / 카드 7 — **넓히기 전과 같은 숫자**.
- ✅ 핸들러 비동기·관문도 실제 렌더 확인:
  `<button onClick> → save() → ↩ !id 면 중단 → ⏳ 응답 대기 [높이 42px] → setDone()`,
  오류 흐름은 `… → setErr() 오류 시`. 관문 표시 `↩`(번호를 먹지 않음),
  기다리지 않는 핸들러에는 대기 스텝 0개.
- ✅ 노이즈 점검: useMemo/useCallback/AbortController/ref 가 섞인 대시보드 컴포넌트에서
  **오탐 0**(deps·interplay·gate 모두), ESLint `exhaustive-deps` 와 같은 지점만 지적.

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
│       ├── chain.js            # 이벤트→setter→상태→Effect 연쇄(Step 배열) + 대기 · 관문 · 훅 구역
│       ├── hooks.js            # 같은 파일 커스텀 훅 추적 + 스코프 경계 + 안팎 이름 대응 + 돌려준 콜백
│       ├── timing.js           # ⏱ 비동기 타이밍 + 언마운트 위험 + 참조 수집 + 대기 무게 + 관문
│       ├── deps.js             # ⚠ deps 에서 빠진 값 = stale closure
│       └── interplay.js        # 🔗 Effect 사이 관계 = 루프/경합/연쇄
├── ui/
│   ├── structure.js            # 🗺️
│   └── behavior.js             # ⚡ + 🪝 훅 구역 + ⏱ 타이밍/deps UI + 🔗 관계 UI
└── data/examples.js            # 내장 예제 2개
test/                           # node --test. *.test.mjs + browser-verify.html
```

### ⚠️ 반드시 지킬 계약 (`ParseResult`)
`parser.js` 를 또 손댈 땐 **출력 형태를 깨지 말 것**. 렌더러 4개가 이 필드를 그대로 읽음:
`imports · functions[{name,type,isAsync,params,startLine,endLine,lineCount,hooks:[{name,category}],handlers[],isExported,isDefault}] · constants · hooks[{name,line,isRN,category}] · jsxComponents · comments · exports · rnPatterns · sections(길이=totalLines) · relations[{from,to,type,isAsync}] · totalLines`

### ⚡ 동작 엔진의 effect 객체 (내부용)
`collect.js` 가 만드는 raw effect: `{ hook, deps, depRoots, trigger, line, body, owner }`
커스텀 훅에서 끌어온 effect 에는 `viaHook`(훅 이름) · `hookLine`(훅 선언 줄)이 더 붙는다.
→ `timing.js` 가 소비해(setter 마다 `deferred`/`guarded`/`nested`/`inIf`/`onError`)
`{ line, hook, trigger, deps, viaHook, isAsync, asyncKind,
hasCleanup, hasGuard, risk, staleDeps, gates[], setters[], timeline[] }` 로 바꿔 UI 에 넘김.
**`owner`(AST 노드)는 UI 로 새어 나가지 않음** — timing 결과에는 담기지 않는다.
`analyzeEffectsTiming(effects, states, code)` — **세 번째 인자는 원본 소스**.
`states` 의 **`kind:'store'`**(redux `dispatch`)는 setter 로 그리되 **위험 판정에서 제외**한다 —
바뀌는 대상이 컴포넌트 밖이라 언마운트와 무관하다.
**리렌더 스텝은 바뀌는 상태가 있을 때만** 붙는다(fire and forget 인 effect 에는 없다).
관문의 조건식을 그대로 잘라 보여주는 데만 쓰고, 없으면 `조건` 으로 적는다.

### ⏱ 타임라인 스텝 (UI 계약)
`kind: 'trigger'|'effect'|'setter'|'gate'|'async-wait'|'resolve'|'rerender'|'cleanup'|'risk'|'stale'`
UI 는 `trigger·risk·stale` 을 뺀 나머지를 순서대로 알약으로 그린다.
`async-wait` 만 `weight`(2~12) 를 갖고, UI 가 그 값으로 **폭**을 정한다 — 실제 ms 가 아니라 눈금.
`gate` 는 `{ label, note, line }` — 조건이 참이면 **아래 단계로 가지 않는다**는 뜻.
즉시 setter 와 함께 **줄 번호 순서로** 놓이므로, UI 는 순서를 다시 만지지 않는다.
`phase:'sync'` setter 의 `conditional` 은 "조건문 가지 안" 이라는 뜻(`조건부` 꼬리표).
`phase:'async'` setter 의 **`onError`** 는 "에러일 때만 불린다" 는 뜻(`오류 시` 꼬리표) —
`guarded` 와 **묻는 것이 다르다**(늘 불리나 / 가드가 있나). 둘은 함께 붙을 수 있다.

### 🔗 이벤트 연쇄 스텝 (UI 계약)
`kind: 'event'|'call'|'setter'|'effect'|'gate'|'wait'|'rerender'|'boundary'`
`wait` 만 `weight` 를 갖고, 세로 목록이라 **높이**로 그린다(`weight × 7px`).
**`wait` 와 `gate` 는 스텝 번호를 먹지 않는다**(`gate` 는 `↩`, `boundary` 는 `·`).
`gate` 는 ⏱ 타임라인과 **같은 `describeGate()` 로 만든 같은 문장**이고, `note` 는
**알약 안(hint)에만** 그린다 — 화살표 `note` 로도 그리면 같은 말이 두 번 나온다.
연쇄의 `gate` 는 줄 번호로 세우지 않고 **Effect 스텝 바로 뒤에 모인다**.
에러일 때만 바뀌는 상태의 setter 스텝에는 **`badges: ['오류 시']`** — ⏱ 의 `onError` 와 같은 말.
연쇄는 **이름 단위**라, 성공 쪽에서도 불리는 이름에는 붙이지 않는다(`describeAsyncPhase`
의 `errorOnly`).
`buildEvents(name, collected, scope, code)` — **네 번째 인자는 원본 소스**(관문 조건식용).

**핸들러도 Effect 와 같은 말을 한다** — `wait`·`gate`·`오류 시` 는 Effect 연쇄뿐 아니라
**이벤트 핸들러 흐름에도** 붙습니다. 재료는 `resolveHandlerSetters` 가 함께 내보내는
**`bodies`**(인라인 화살표 + 거쳐 가는 로컬 함수) → `describeHandlerAsync` ·
`collectHandlerGates`. 핸들러의 관문은 줄 번호로 세우지 않고 **부르는 자리 바로 뒤**에 모입니다.
**핸들러에는 위험 배지가 없습니다** — 판정을 안 넣은 것이지 못 잡는 것이 아닙니다((16) 참고).

**`hook`** — 이 상태·Effect 가 사는 커스텀 훅 이름(컴포넌트 것이면 `null`).
⚠️ **이름이 겹친다** — raw effect 의 `hook` 은 `useEffect`/`useLayoutEffect` 같은 **훅 종류**고,
스텝의 `hook` 은 **커스텀 훅 이름**이다(그쪽은 raw 에서 `viaHook`).
UI 는 **이어지는 같은 `hook` 스텝을 상자 하나로 묶는다** — 그래서 엔진은 한 흐름 안에서
훅 스텝이 **끊기지 않게** 내보내야 한다. `hookLine` 은 훅 선언 줄(머리말 클릭 = 이동),
`hookInternal` 은 이름을 바꿔 받았을 때 **훅 안에서 부르는 이름**(같으면 `null`).
`hook` 은 **코드가 적힌 자리가 아니라 상태·Effect 가 사는 자리**다 —
`setQuery()` 는 컴포넌트에서 부르지만 그 상태는 훅 것이라 구역 안에 놓인다.

### 🔒 UI 이스케이프 규칙
`ui/behavior.js` 에서 `innerHTML` 에 **코드에서 온 문자열**을 넣을 땐 반드시 `esc()`.
안 그러면 `<button onClick>` 같은 라벨이 진짜 엘리먼트로 렌더된다.

### 🔗 interplay 항목 (UI 계약)
`{ kind:'loop'|'contention'|'cascade', severity:'risk'|'warn'|'info', label, note,
lines:number[], steps:[{kind:'effect'|'setter'|'loopback', label, detail, line, phase?, guarded?, hook?}] }`
`effect` 알약의 `hook` 은 그 Effect 가 사는 커스텀 훅 — 고칠 파일이 그쪽이라는 뜻.
UI 는 `steps` 를 순서대로 알약으로 그리기만 한다.

---

## 4-B. 사용자 문서 (코드 만지기 전에 함께 갱신할 것)

| 문서 | 무엇 |
| :--- | :--- |
| `GUIDE.md` | 가이드 색인 |
| `GUIDE_BEGINNER.md` | **초보자용** — 사용법 · 각 표시 읽는 법 · 주의사항 8가지 |
| `GUIDE_PRO.md` | 실무자용 |
| `VERIFICATION.md` | **실제 앱을 브라우저에서 눌러 확인한 기록**(빌드 · 5개 탭 · 대용량 · 오탐 · 성능) |

⚠️ **UI 표시를 바꾸면 `GUIDE_BEGINNER.md` 도 같이 고칠 것.** 실제로 D)에서 훅 배지를 빼고
C)에서 관문을 넣었는데 문서는 옛 화면을 설명한 채로 남아 있었습니다(2026-08-24 에 바로잡음).

✅ **`GUIDE_PRO.md` 도 2026-08-24 에 정리 완료** — 두 분석기가 모두 AST 라는 사실,
⏱ 타이밍·deps · 🔗 Effect 관계 · 관문 · 훅 구역 · 핸들러 비동기 명세, 가드와 관문의 경계,
검증 체계(9장)를 반영했습니다. 남아 있는 "정규식" 언급은 전부 **이력으로 표시된 것**입니다.

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

## 6. 다음 할 일

A 트랙(1~4) · B · E · C · D · D-2 · C-2 · F · C-3 ·
**라) 다지기** · **다-1) 핸들러 비동기** · **다-2) 핸들러 관문** 까지 완료·커밋됨.
합의했던 (라)·(다)가 **둘 다 끝났습니다.** (가)·(나)는 중요도가 낮아 **버리기로 했습니다.**

### 🚧 먼저 볼 것 — **잘린 코드에서 "조용한 0"** (문서 정리 중 발견, 2026-08-24)

**이건 후보가 아니라 실제 문제입니다.**

`91f1a13` 에서 `parser.js` 를 AST 로 재작성하면서, **잘린 코드에 대한 내성이 사라졌습니다.**
예전 정규식 파서는 괄호가 안 닫혀도 훑었지만, 지금은 `parse()` 가 던지면
`emptyResult(totalLines)` 를 돌려줍니다. 실측 결과 사용자에게는 이렇게 보입니다:

| 탭 | 실제 화면 |
| :--- | :--- |
| 하이라이트 | 코드는 그려지나 섹션 밴드·배지 없음 |
| 구조맵 | **완전히 빈 화면** (안내 없음) |
| 메트릭 | 줄 수만 맞고 **나머지 전부 `0`** |
| 플로우 | `컴포넌트 관계가 발견되지 않았습니다` |
| 동작 | 오류 위치·사유를 정확히 표시 |

**왜 문제인가** — 이 프로젝트의 설계 원칙은 *"조용히 틀린 결과를 내놓느니 실패 지점을
정확히 알린다"* 입니다. 그런데 지금 ①~④ 는 **"세어 보니 없다" 와 "못 셌다" 를 똑같이 `0`**
으로 보여 줍니다. 게다가 동작 탭 오류 문구 마지막 줄이
**"다른 탭은 그대로 사용할 수 있습니다"** 인데 **이제 사실이 아닙니다**(`src/ui/behavior.js`).

**고치는 방향 (합의 필요)**
1. **최소** — 동작 탭의 저 문장을 사실에 맞게 고치고, `parseCode` 가 파싱 실패를
   `ParseResult` 에 실어 보내 ①~④ 가 **"문법 오류로 분석하지 못했습니다"** 를 표시.
   → 계약(`ParseResult`)에 필드 하나 추가. **틀린 말을 없애는 것이 핵심.**
2. **더 나아가면** — 잘린 코드를 잘라내고 재시도하는 복구. 다만 `GUIDE_PRO.md` 6장에
   적힌 이유(부분 복구를 완전한 분석으로 오인)로 **한 번 기각된 방향**임.

**추천은 1번.** 문서(`GUIDE_BEGINNER.md` 7장 · `GUIDE_PRO.md` 6장)에는 현재 동작을
있는 그대로 적어 두었으니, 코드를 고치면 두 문서의 "알려진 문제" 문단도 함께 지울 것.

---

### ▶ 그다음: **아직 정하지 않음 — 먼저 합의할 것**

이번 라운드에서 새로 드러난 것과, 남겨 둔 것들입니다.

**(A) 핸들러의 "응답 뒤" 를 정보로 알려 줄 것인가 — 작음**
(16)에서 **일부러 위험 배지를 안 달았습니다**. 대신 응답 뒤 setter 에
"그 사이 화면이 바뀌었을 수 있습니다" 같은 **정보성 한 줄**을 붙일 수는 있습니다.
붙일지 말지가 결정 사항 — **붙인다면 붉은 계열은 피할 것**(위험이 아니므로).

**(B) ⏱ 섹션에 핸들러 트랙을 둘 것인가 — 중간**
지금은 핸들러가 **⚡ 연쇄에만** 나옵니다. ⏱ 는 "위험·deps 점검" 자리인데 핸들러는 deps 도
위험 배지도 없어, 트랙을 만들면 **연쇄와 같은 말을 가로로 한 번 더** 하게 됩니다.
그래서 이번엔 **안 만들었습니다.** 필요하다고 판단되면 그때.

**(C) 정리(cleanup) 함수가 하는 일 — 중간**
지금 `정리(cleanup) 실행` 은 **있다/없다** 뿐입니다. 무엇을 되돌리는지
(`clearInterval` · `abort()` · `alive = false` · 구독 해제)를 읽어 적으면
"이 effect 가 나갈 때 무엇이 멈추나" 가 보입니다. 새 판정이 아니라 **읽어서 적기**.

**(D) 큰 파일에서의 읽기 경험 — 중간**
26개 컴포넌트짜리 파일을 넣으면 섹션이 아주 길어집니다(성능은 문제 없음).
접기·컴포넌트 고르기 같은 **탐색 수단**이 필요한지 실제로 써 보고 판단할 것.

**추천**: **(C) → (D)**. (C)는 이미 있는 정보를 읽어 적는 일이라 위험이 낮고 바로 값이 되고,
(D)는 그다음에 실제 사용감을 보고 정하면 됩니다. (A)·(B)는 **하지 않는 쪽에 근거가 있으니**
누가 요청하기 전엔 건드리지 말 것.

---

작업 방식(확립됨): **작게 구현 → 테스트 추가 → `npm test` → 브라우저 실제 렌더 확인 → 커밋.**
그리고 마지막에 **이 문서를 갱신**하고 커밋.

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
- **가드와 관문의 경계(중요)**: 이른 반환은 **응답 뒤**에 있을 때만 언마운트 가드다.
  응답 **전**의 `if (!id) return` 은 관문일 뿐이라 뒤의 setState 를 지키지 못한다
  (`visitBlock` 의 `deferred && isEarlyReturnGuard`). `findGates` 가 await 에서 멈추는 것과
  **같은 경계**이니, 한쪽을 넓히면 다른 쪽도 같이 볼 것.
- **오탐 정책**: `deps.js`·`interplay.js` 의 판정은
  **놓치는 쪽(false negative)이 헛경보보다 낫다**는 기준.
  규칙을 넓힐 땐 `test/stale-deps.test.mjs` 의 "잡으면 안 되는 것" 6개와
  `test/interplay.test.mjs` 의 "잡으면 안 되는 것" 3개 +
  `test/timing.test.mjs` 의 "await 밖의 타이머는 대기 시간으로 세지 않는다" ·
  "else 가 붙으면 이른 반환이 아니라 갈림길이다" ·
  **"관문으로 잡으면 안 되는 것" 3개**(await 뒤 · 나중에 불릴 콜백 안 · else 붙은 if) ·
  **"마지막 문장이 return 이 아니면 관문이 아니다"** +
  `test/behavior.test.mjs` 의 **"await 뒤의 이른 반환은 연쇄에서도 관문이 아니다"** ·
  **"성공 쪽에서도 불리는 이름에는 오류 표시가 붙지 않는다"** +
  `test/timing.test.mjs` 의 **".finally 는 성공·실패 양쪽에서 불리므로 오류 표시가 아니다"** +
  `test/stale-deps.test.mjs` 의 **"잡은 오류의 이름은 빠진 deps 가 아니다"** +
  `test/hook-boundary.test.mjs` 의 **"잡으면 안 되는 것" 2개**(import 한 훅은 구역이 아니라
  경계 · 훅을 안 쓰는 컴포넌트에는 아무 스텝에도 훅이 안 붙음) +
  "deps 배열이 없는 Effect" 절의 안 잡는 케이스 4개를 먼저 확인.
- 임시 검증 파일은 repo 밖(세션 scratchpad)에 만들 것. 작업트리는 깨끗하게 유지.
