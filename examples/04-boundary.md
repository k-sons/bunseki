# 예제 4 — 범위 경계 (도구가 못 보는 곳 읽기)

> **학습 목표**: 같은 파일에 컴포넌트 두 개가 있을 때, 부모에서는 흐름이 보이고
> 자식에서는 끊기는 이유를 이해합니다.
> **「상태 변화 없음」과 「범위 밖」이 어떻게 다른지** 구분합니다.

---

## 붙여넣을 코드

```jsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'

function SearchBox({ onSearch, onClear }) {
  return (
    <div className="search-box">
      <input onChange={(e) => onSearch(e.target.value)} />
      <button onClick={onClear}>지우기</button>
    </div>
  )
}

export default function SearchPage() {
  const [keyword, setKeyword] = useState('')
  const { toggleTheme } = useTheme()

  return (
    <div>
      <SearchBox onSearch={setKeyword} onClear={() => setKeyword('')} />
      <p>검색어: {keyword}</p>
      <button onClick={toggleTheme}>테마 변경</button>
    </div>
  )
}
```

`useTheme` 은 `./hooks/useTheme` 에서 가져옵니다. **그 파일은 붙여넣지 않았습니다.**

---

## 먼저 스스로 예상해 보세요

1. 동작 탭에 컴포넌트가 몇 개 나올까요?
2. `SearchBox` 의 `<input onChange>` 는 어떤 결과가 나올까요?
3. 「테마 변경」 버튼은 `SearchBox` 의 버튼과 같은 결과일까요, 다를까요?

---

## 앱 실행 결과

### 상태바

```
줄 25 · 함수 0 · 컴포넌트 2 · Hook 2 · Import 2
```

### 구조맵

```
컴포넌트
  SearchBox    L4–11 (8줄)    hooks=[]                  handlers=[onChange, onClick]
  SearchPage   L13–24 (12줄)  hooks=[useState, useTheme]  handlers=[onClick]   export
Import
  react { useState }              L1
  ./hooks/useTheme { useTheme }   L2
```

### 플로우

```
SearchPage  --renders-->  SearchBox
```

### ⚡ 동작 탭

컴포넌트 그룹이 **2개** 생깁니다.

#### SearchBox — 두 핸들러 모두 경계에서 끊깁니다

```
① 이벤트           <input onChange>                      L7
       ↓
·  여기서부터 범위 밖
   onSearch   ← prop 으로 전달받은 함수
   이 컴포넌트를 사용하는 쪽에 있습니다.
   부모 코드도 함께 붙여넣으면 이어서 볼 수 있습니다
```

```
① 이벤트           <button onClick>                      L8
       ↓
·  여기서부터 범위 밖
   onClear    ← prop 으로 전달받은 함수
```

#### SearchPage — 자식에게 넘긴 콜백이 정상 추적됩니다

```
① 이벤트        <SearchBox onSearch>                     L19
       ↓
② 상태 변경     setKeyword()  →  keyword                 L19
       ↓
③ 화면 갱신     리렌더
                'keyword' 를 deps 로 쓰는 Effect 는 없습니다
```

`<SearchBox onClear>` 도 동일하게 `setKeyword()` 까지 이어집니다.

#### 그런데 「테마 변경」 버튼은 또 다른 경계입니다

```
① 이벤트        <button onClick>                         L21
       ↓
·  여기서부터 범위 밖
   toggleTheme   ← useTheme 에서 받아옴
   이 훅은 다른 파일에 있어 여기서부터는 따라갈 수 없습니다
```

---

## 결과 해석

### 같은 코드를 두 방향에서 봅니다

`SearchBox` 의 `onSearch` 와 `SearchPage` 의 `<SearchBox onSearch={setKeyword}>` 는 **같은 함수**입니다. 그런데 결과가 다릅니다.

| 보는 위치 | 결과 | 이유 |
| :--- | :--- | :--- |
| `SearchBox` 안 | 🟠 경계 | 이 함수가 **어디서 왔는지** 모릅니다 |
| `SearchPage` 안 | ✅ 추적 | 자기가 **넘겨준 것**이라 압니다 |

동작 탭은 **컴포넌트 단위로** 분석합니다. 자식은 부모를 올려다볼 수 없고, 부모는 자기가 넘긴 것을 압니다.

### 경계 문구가 두 종류입니다

| 문구 | 어디에 있나 | 해결책 |
| :--- | :--- | :--- |
| `prop 으로 전달받은 함수` | **부모 컴포넌트** | 부모도 같이 붙여넣기 |
| `useTheme 에서 받아옴` | **다른 파일** | 그 훅 파일도 같이 붙여넣기 |

이 예제에서 `SearchPage` 는 이미 같은 파일에 있으므로, `SearchBox` 의 경계는 **바로 아래에서 답을 볼 수 있는 상태**입니다. 반면 `useTheme` 은 파일 자체가 없어 답이 화면에 없습니다.

### 「상태 변화 없음」과 다릅니다

세 가지를 반드시 구분하세요.

```
상태 변화 없음                     → 진짜로 아무 상태도 안 바꿉니다
🟠 prop 으로 전달받은 함수          → 부모에 답이 있습니다
🟠 useXxx 에서 받아옴               → 다른 파일에 답이 있습니다
```

주황 점선이 보이면 **"코드를 더 붙여넣으면 더 보인다"** 는 신호입니다.

### `setKeyword` 를 그대로 넘긴 것도 잡힙니다

```jsx
<SearchBox onSearch={setKeyword} />
```

`setKeyword()` 처럼 **호출**한 게 아니라 함수를 **값으로** 넘겼는데도 ② 스텝에 나옵니다.
setter 를 prop 으로 전달하는 흔한 패턴이라 별도로 처리합니다.

---

## 직접 해보기

`./hooks/useTheme` 의 내용을 상상해서 **같은 파일 맨 위에 붙여** 다시 분석해 보세요.

```jsx
function useTheme() {
  const [theme, setTheme] = useState('dark')
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  return { theme, toggleTheme }
}
```

`import { useTheme } from './hooks/useTheme'` 줄은 지우고 실행하면 경계가 사라집니다.

```
① 이벤트        <button onClick>                     L26
       ↓
② 함수 호출     toggleTheme()                        L5     ← 훅 안의 선언 위치
       ↓
③ 상태 변경     setTheme()  →  theme   [useTheme]    L26
                useTheme 훅이 관리하는 상태입니다
       ↓
④ 화면 갱신     리렌더
```

`toggleTheme` 은 setter 가 아니라 **setter 를 감싼 함수**인데도 ② → ③ 으로 이어집니다.
`useToggle` → `toggle`, `useCounter` → `increment` 처럼 훅이 동작을 함수로 내보내는
형태를 그대로 따라갑니다.

`SearchPage` 의 상태 목록도 `keyword` 하나에서 **`keyword`, `theme` 두 개**로 늘어납니다.

---

## 확인 문제

- **Q.** `SearchBox` 를 다른 파일로 옮기면 `SearchPage` 의 분석은 어떻게 될까요?
  <details><summary>답</summary><code>SearchPage</code> 쪽은 그대로입니다. <code>&lt;SearchBox onSearch={setKeyword}&gt;</code> 는 <code>SearchPage</code> 안에 있는 코드이므로 <code>setKeyword</code> 를 계속 추적합니다. 대신 <code>SearchBox</code> 컴포넌트 그룹 자체가 목록에서 사라집니다.</details>

- **Q.** 「지우기」 버튼(`onClear`)이 `SearchPage` 에서는 왜 `L19` 로 표시될까요? 실제 버튼은 `L8` 인데요.
  <details><summary>답</summary><code>SearchPage</code> 관점의 이벤트는 <strong><code>&lt;SearchBox onClear={...}&gt;</code> 를 쓴 줄</strong>(L19)입니다. L8 의 버튼은 <code>SearchBox</code> 관점의 이벤트이고, 그쪽 그룹에 따로 표시됩니다.</details>

---

**이전**: [03 — 커스텀 훅](./03-custom-hook.md) · **다음**: [05 — 상태 도미노](./05-state-cascade.md)
