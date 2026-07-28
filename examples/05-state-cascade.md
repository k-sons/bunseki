# 예제 5 — 상태 도미노 (찾아야 할 안티패턴)

> **학습 목표**: 상태가 Effect 를 깨우고, 그 Effect 가 또 상태를 바꿔 다음 Effect 를 깨우는
> **도미노**를 동작 탭에서 알아봅니다. 그리고 이 연쇄를 없애는 방법을 배웁니다.

---

## 붙여넣을 코드

```jsx
import { useState, useEffect } from 'react'

export default function OrderSummary() {
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [label, setLabel] = useState('')

  useEffect(() => {
    setTotal(count * 1000)
  }, [count])

  useEffect(() => {
    setLabel('합계 ' + total + '원')
  }, [total])

  return (
    <div>
      <p>{label}</p>
      <button onClick={() => setCount(count + 1)}>담기</button>
    </div>
  )
}
```

---

## 먼저 스스로 예상해 보세요

1. 「담기」 버튼을 **한 번** 누르면 상태가 몇 개 바뀔까요?
2. `useEffect` 는 몇 번 실행될까요?
3. 연쇄는 몇 단계일까요?

---

## 앱 실행 결과

### 상태바

```
줄 23 · 함수 0 · 컴포넌트 1 · Hook 5 · Import 1
```

**Hook 5** = `useState` 3회(L4, L5, L6) + `useEffect` 2회(L8, L12)

### 구조맵

```
컴포넌트
  OrderSummary   L3–22 (20줄)   hooks=[useState, useEffect]   handlers=[onClick]   export
```

### Effect 목록

```
L8    deps [count] 이 바뀔 때 실행
L12   deps [total] 이 바뀔 때 실행
```

**두 Effect 의 deps 가 서로 다릅니다.** 이 차이가 도미노의 씨앗입니다.

### ⚡ 동작 탭

```
① 이벤트        <button onClick>                     L19
       ↓
② 상태 변경     setCount()  →  count                 L19
       ↓  deps [count] 에 'count' 가 있어 다시 실행됩니다
③ Effect 실행   useEffect 재실행                     L8
       ↓
④ 상태 변경     setTotal()  →  total                 L8
       ↓  deps [total] 에 'total' 가 있어 다시 실행됩니다
⑤ Effect 실행   useEffect 재실행                     L12      ← 또 깨어남!
       ↓
⑥ 상태 변경     setLabel()  →  label                 L12
       ↓
⑦ 화면 갱신     리렌더
```

---

## 결과 해석

### 버튼 한 번에 Effect 가 두 번 돕니다

```
클릭 1회  →  상태 3개 변경  →  Effect 2회 실행  →  리렌더
```

예제 2 도 7단계였지만 **성격이 다릅니다.**

| | 예제 2 | 예제 5 |
| :--- | :--- | :--- |
| Effect 실행 | 1회 | **2회 (연쇄)** |
| Effect 가 하는 일 | 서버에서 데이터 가져오기 | **다른 상태로부터 값 계산** |
| 필요한가 | ✅ 필요합니다 | ❌ 불필요합니다 |

### 도미노를 알아보는 신호

동작 탭에서 이 모양이 반복되면 도미노입니다.

```
상태 변경  →  Effect 실행  →  상태 변경  →  Effect 실행  →  ...
```

②③④⑤⑥ 처럼 **`상태 변경` 과 `Effect 실행` 이 번갈아 나오는 구간**을 찾으세요.
연쇄가 깊을수록 화면이 여러 번 깜빡이고, 중간에 값이 어긋난 상태가 잠깐 보입니다.

### 무엇이 문제인가

`total` 과 `label` 은 **`count` 로부터 계산할 수 있는 값**입니다.

```
count  ──계산──▶  total  ──계산──▶  label
```

계산으로 구할 수 있는 값을 `useState` 로 보관하면, 원본이 바뀔 때마다 `useEffect` 로 따라가며 갱신해야 합니다. 그 과정이 도미노가 됩니다.

---

## ✅ 고치는 법

```jsx
import { useState } from 'react'

export default function OrderSummary() {
  const [count, setCount] = useState(0)

  // 렌더링할 때마다 그냥 계산합니다
  const total = count * 1000
  const label = '합계 ' + total + '원'

  return (
    <div>
      <p>{label}</p>
      <button onClick={() => setCount(count + 1)}>담기</button>
    </div>
  )
}
```

이 코드를 앱에 붙여넣으면 결과가 이렇게 바뀝니다.

```
줄 17 · 함수 0 · 컴포넌트 1 · Hook 1 · Import 1     ← Hook 5개에서 1개로
Effect 없음
상수: total(L7), label(L8)                          ← 상태가 아니라 상수로 잡힙니다

① 이벤트      <button onClick>       L13
② 상태 변경   setCount() → count     L13
③ 화면 갱신   리렌더
              'count' 를 deps 로 쓰는 Effect 는 없습니다
```

**7단계 → 3단계.** 예제 1 과 같은 모양이 되었습니다.

구조맵에서 `total` 과 `label` 이 **상수** 로 분류된 것도 확인해 보세요. 상태가 아니라
매 렌더마다 계산되는 값이라는 뜻입니다.

상태 3개가 1개로 줄고, `useEffect` 두 개가 사라지고, 리렌더도 한 번만 일어납니다.
**직접 두 버전을 번갈아 붙여넣어 비교해 보세요.** 도구가 리팩토링 효과를 눈에 보이게 해줍니다.

---

## 판단 기준

모든 `useEffect` 가 나쁜 것은 아닙니다.

| Effect 가 하는 일 | 판단 |
| :--- | :--- |
| 서버 요청, 타이머, 구독, DOM 직접 조작 | ✅ 적절합니다 (예제 2) |
| **다른 상태로부터 값을 계산해 setState** | ❌ 계산으로 대체하세요 (예제 5) |

동작 탭에서 **Effect 스텝 바로 다음이 상태 변경뿐이고 함수 호출이 없다면** 의심하세요.
예제 2 는 ③ Effect 다음에 ④ `fetchUser()` 라는 실제 작업이 있었지만,
예제 5 는 ③ Effect 다음이 곧바로 ④ `setTotal()` 입니다.

---

## 확인 문제

- **Q.** 두 번째 `useEffect` 의 deps 를 `[total]` 에서 `[count]` 로 바꾸면 도미노가 사라질까요?
  <details><summary>답</summary>연쇄는 짧아지지만 근본 해결은 아닙니다. 두 Effect 가 <code>count</code> 하나에 함께 반응하므로 ⑤ 단계가 사라집니다. 다만 <code>label</code> 이 <code>total</code> 의 <strong>이전 값</strong>으로 계산될 수 있어 오히려 버그가 생깁니다. 계산으로 바꾸는 것이 정답입니다.</details>

- **Q.** 계산 비용이 큰 값이라면 어떻게 할까요?
  <details><summary>답</summary><code>useMemo</code> 를 씁니다. 상태가 아니라 <strong>계산 결과 캐시</strong>이므로 Effect 를 깨우지 않아 도미노가 생기지 않습니다. 하이라이트 탭에서 🟠 주황 <code>Memo</code> 배지로 표시됩니다.</details>

---

**이전**: [04 — 범위 경계](./04-boundary.md) · **처음으로**: [01 — 카운터](./01-counter.md)
