# 예제 3 — 커스텀 훅 (상태가 컴포넌트 밖에 있을 때)

> **학습 목표**: 로직을 커스텀 훅으로 분리했을 때, 컴포넌트 자신은 상태가 0개인데도
> 동작 탭이 상태 2개를 찾아내는 이유를 이해합니다.
> 구조맵과 동작 탭이 **같은 코드를 다르게 분류**하는 것도 확인합니다.

---

## 붙여넣을 코드

```jsx
import { useState, useEffect } from 'react'

function useSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  useEffect(() => {
    if (!query) return
    searchApi(query).then(setResults)
  }, [query])

  return { query, setQuery, results }
}

export default function SearchPanel() {
  const { query, setQuery, results } = useSearch()

  const clear = () => {
    setQuery('')
  }

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={clear}>지우기</button>
      <ul>
        {results.map((r) => (
          <li key={r.id}>{r.title}</li>
        ))}
      </ul>
    </div>
  )
}
```

---

## 먼저 스스로 예상해 보세요

1. `useSearch` 는 구조맵에서 **컴포넌트**로 나올까요, **함수**로 나올까요?
2. `SearchPanel` 의 상태는 몇 개일까요?
3. 「지우기」 버튼의 연쇄는 「입력창」 보다 길까요, 짧을까요?

---

## 앱 실행 결과

### 상태바

```
줄 34 · 함수 2 · 컴포넌트 1 · Hook 4 · Import 1
```

**함수 2** = `useSearch` + `clear`
**Hook 4** = `useState` 2회 + `useEffect` 1회 + `useSearch` 1회

### 구조맵

```
컴포넌트
  SearchPanel   L15–33 (19줄)   hooks=[useSearch]   handlers=[onChange, onClick]   export

함수
  useSearch     L3–13 (11줄)    hooks=[useState, useEffect]
  clear         L18–20 (3줄)    hooks=[]
```

**`useSearch` 가 「함수」 로 분류됩니다.** 소문자로 시작하기 때문입니다.
구조맵은 이름 첫 글자만 보고 컴포넌트/함수를 나눕니다.

### Hook 사용 현황

```
useState    2회   L4, L5
useEffect   1회   L7
useSearch   1회   L16
```

`useSearch` 가 **1회**(L16)입니다. L3 의 `function useSearch() {` 은 **정의**이므로 세지 않습니다.

### 플로우

```
SearchPanel  --calls-->  useSearch
```

### ⚡ 동작 탭

```
SearchPanel
 [input onChange L24]  [button onClick L25]
```

**입력창 (L24)**

```
① 이벤트        <input onChange>                        L24
       ↓
② 상태 변경     setQuery()  →  query      [useSearch]   L24
                useSearch 훅이 관리하는 상태입니다
       ↓  deps [query] 에 'query' 가 있어 다시 실행됩니다
③ Effect 실행   useEffect 재실행           [.then]      L7
       ↓
④ 함수 호출     searchApi()                [비동기]     L9
       ↓
⑤ 상태 변경     setResults()  →  results                L7
       ↓
⑥ 화면 갱신     리렌더
```

**「지우기」 버튼 (L25)** — 한 단계가 더 있습니다.

```
① 이벤트        <button onClick>                        L25
       ↓
② 함수 호출     clear()                                 L18   ← 추가된 단계
       ↓
③ 상태 변경     setQuery()  →  query      [useSearch]   L25
       ↓
④ Effect 실행   useEffect 재실행                        L7
       ↓
⑤ 함수 호출     searchApi()                [비동기]     L9
       ↓
⑥ 상태 변경     setResults()  →  results                L7
       ↓
⑦ 화면 갱신     리렌더
```

---

## 결과 해석

### 구조맵과 동작 탭이 서로 다르게 봅니다

| | `useSearch` 를 무엇으로 보는가 |
| :--- | :--- |
| 구조맵 | **함수** (소문자로 시작하므로) |
| 동작 탭 | **상태를 관리하는 훅** (`use` + 대문자 패턴) |

모순이 아니라 **관점의 차이**입니다. 구조맵은 "파일에 무엇이 있는가", 동작 탭은 "상태가 어디서 오는가" 를 봅니다.

### `SearchPanel` 자신의 상태는 0개입니다

`SearchPanel` 안에 `useState` 가 하나도 없습니다. 그런데 동작 탭 상태 목록에는 `query` 와 `results` 가 있습니다.

**전부 `useSearch` 에서 끌어온 것**이며, `[useSearch]` 배지와 *"useSearch 훅이 관리하는 상태입니다"* 문구가 출처를 알려줍니다.

### ⑤ `setResults()` 는 어디서 왔을까요

`SearchPanel` 은 `const { query, setQuery, results } = useSearch()` 로 **`setResults` 를 꺼내지 않았습니다.**

그런데도 연쇄에 나옵니다. 훅의 `useEffect` **안에서** 호출되기 때문입니다.
컴포넌트가 직접 부를 수 없어도, 그 Effect 가 실행되면 실제로 상태가 바뀌므로 표시합니다.

### 「지우기」 가 한 단계 더 긴 이유

```jsx
onClick={clear}          →  ② clear() 를 거쳐
const clear = () => {
  setQuery('')           →  ③ setQuery 에 도달
}
```

이름 붙은 함수를 한 번 경유하기 때문입니다. 입력창은 `onChange={(e) => setQuery(...)}` 로 **직접** 호출해 이 단계가 없습니다.

② 스텝의 **L18 은 `clear` 가 선언된 줄** 입니다. 클릭하면 함수 정의로 이동합니다.

---

## 💡 이 예제가 중요한 이유

로직을 커스텀 훅으로 빼는 것은 **React 권장 패턴**입니다. 그리고 훅이 **같은 파일 안에 있으면** 도구가 끝까지 따라갑니다.

훅이 다른 파일에 있으면 어떻게 되는지는 [예제 4](./04-boundary.md) 에서 확인합니다.

---

## 확인 문제

- **Q.** `useSearch` 안의 `if (!query) return` 은 동작 탭에 반영될까요?
  <details><summary>답</summary>반영되지 않습니다. <code>query</code> 가 빈 문자열이면 실제로는 <code>searchApi()</code> 가 호출되지 않지만, 동작 탭은 ④ 스텝을 그대로 보여줍니다. 정적 분석이라 실행 시점의 값을 모르기 때문이며, <strong>"가능한 경로"</strong> 를 보여주는 것입니다.</details>

- **Q.** `useSearch` 를 `SearchHelper` 로 이름만 바꾸면 무엇이 달라질까요?
  <details><summary>답</summary>구조맵에서 <strong>컴포넌트</strong>로 분류되고(대문자 시작), 동작 탭은 이를 훅으로 인식하지 못해 <code>SearchPanel</code> 의 상태가 0개가 됩니다. React 의 <code>use</code> 접두사 규칙을 도구도 동일하게 따릅니다.</details>

---

**이전**: [02 — 비동기 데이터 로딩](./02-async-effect.md) · **다음**: [04 — 범위 경계](./04-boundary.md)
