# 예제 1 — 카운터 (가장 단순한 상태 변화)

> **학습 목표**: 이벤트 하나가 상태를 바꾸고 화면이 다시 그려지는 가장 짧은 연쇄를 읽습니다.
> `useEffect` 가 없을 때 동작 탭이 어디서 끝나는지 확인합니다.

---

## 붙여넣을 코드

```jsx
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div className="counter">
      <p>현재 값: {count}</p>
      <button onClick={() => setCount(count + 1)}>증가</button>
      <button onClick={() => setCount(0)}>초기화</button>
    </div>
  )
}
```

---

## 먼저 스스로 예상해 보세요

앱에 붙여넣기 **전에** 답해 보고, 아래 결과와 맞춰 보세요.

1. 상태바의 컴포넌트 수와 Hook 수는 각각 몇 개일까요?
2. 동작 탭에 이벤트 칩은 몇 개 생길까요?
3. 「증가」 버튼의 연쇄는 몇 단계에서 끝날까요?

---

## 앱 실행 결과

### 상태바

```
줄 14 · 함수 0 · 컴포넌트 1 · Hook 1 · Import 1
```

| 항목 | 값 | 왜 |
| :--- | :--- | :--- |
| 함수 | **0** | 헬퍼 함수가 없습니다. `onClick` 안의 화살표 함수는 이름이 없어 세지 않습니다 |
| 컴포넌트 | **1** | `Counter` — 대문자로 시작하므로 컴포넌트로 분류됩니다 |
| Hook | **1** | `useState` 를 L4 에서 한 번 호출 |

### 구조맵

```
컴포넌트
  Counter   L3–13 (11줄)   hooks=[useState]   handlers=[onClick]   export
Import
  react { useState }   L1
```

### 메트릭

```
Counter   11줄   L3–13   (component)
```

막대가 하나뿐입니다. 비교 대상이 없으니 이 차트는 예제 2 이후부터 의미가 생깁니다.

### 플로우

```
(관계 없음)
```

컴포넌트가 하나뿐이고 다른 함수를 부르지 않아 화살표가 없습니다.

### ⚡ 동작 탭

이벤트 칩이 **2개** 생깁니다.

```
Counter
 [button onClick L9]  [button onClick L10]
```

**「증가」 버튼 (L9)**

```
① 이벤트        <button onClick>           L9
       ↓
② 상태 변경     setCount()  →  count       L9
       ↓
③ 화면 갱신     리렌더
                'count' 를 deps 로 쓰는 Effect 는 없습니다
```

**「초기화」 버튼 (L10)** — 연쇄가 완전히 같습니다. 값만 다를 뿐 둘 다 `count` 를 바꿉니다.

---

## 결과 해석

### 3단계에서 끝나는 이유

`useEffect` 가 없기 때문입니다. 상태가 바뀌면 React 는 화면을 다시 그리고, 그것으로 끝입니다.

### 「deps 로 쓰는 Effect 는 없습니다」는 경고가 아닙니다

이 문구는 **정상 종료** 표시입니다. `count` 가 바뀌어도 깨울 `useEffect` 가 없다는 뜻이며, 오히려 단순하고 예측 가능한 구조라는 신호입니다.

예제 2·5 에서는 이 자리에 `useEffect 재실행` 이 끼어들면서 연쇄가 길어집니다.

### 칩이 2개인데 결과가 같은 경우

두 버튼이 **같은 상태**(`count`)를 바꾸기 때문입니다. 동작 탭은 "어떤 값으로 바꾸는가"(`count + 1` vs `0`)는 구분하지 않고, **"무엇을 바꾸는가"** 만 추적합니다.

값까지 알고 싶으면 스텝을 클릭해 코드로 이동하세요.

---

## 확인 문제

- **Q.** 「초기화」 버튼의 ② 스텝을 클릭하면 몇 번 줄로 이동할까요?
  <details><summary>답</summary>L10 입니다. 스텝 오른쪽에 표시된 라인 번호가 이동 위치입니다.</details>

- **Q.** `<p>현재 값: {count}</p>` 는 왜 동작 탭에 나오지 않을까요?
  <details><summary>답</summary>동작 탭은 <strong>이벤트에서 시작하는 연쇄</strong>만 추적합니다. 값을 화면에 표시하는 것은 이벤트가 아니라 리렌더 결과이며, ③ 화면 갱신 스텝에 포함된 것으로 봅니다.</details>

---

**다음 예제**: [02 — 비동기 데이터 로딩](./02-async-effect.md)
