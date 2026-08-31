이해했습니다. `danger.md`의 **처음부터 펼치는 위험 5종**을, 이전에 드린 것과 같은 붙여넣기용 예시로 나눕니다. 동작 탭 → 이벤트 칩 → 아래로 스크롤.

---

앱에 붙여넣고 **동작 탭**을 연 뒤, 이벤트 칩을 하나 누르고 **아래로 스크롤**하면 됩니다. 코너가 비어 있으면 접혀 있거나, Effect가 안 짚힌 겁니다.

---

### 1) `가드 없는 fetch` — 답이 오기 전에 화면이 사라지면

한 Effect가 **서버 답을 기다리다가**, 가드 없이 `setUser` 합니다. 의존 목록은 맞습니다.

```jsx
import { useState, useEffect } from 'react'

export default function UserCard({ userId }) {
  const [user, setUser] = useState(null)

  // 위험 — 답이 오기 전에 화면이 사라지면 없는 화면에 setUser
  useEffect(() => {
    fetch('/api/user/' + userId)
      .then((res) => res.json())
      .then(setUser)
  }, [userId])

  return <button onClick={() => setUser(null)}>비우기 {user ? user.name : '없음'}</button>
}
```

여기서 볼 것:

| 표시 | 이 코드에서 |
| :--- | :--- |
| `위험` | `fetch` 뒤에 가드 없이 `setUser` |
| 가로 알약 | 언제 실행 → ⏳ 대기 → setState · **가드 없음** |

처음부터 **펼쳐져** 있어야 정상입니다. `목록에 없는 값` 은 안 뜹니다 (`userId` 가 목록에 있음).

---

### 2) `목록에 없는 값` — 옛 값을 붙잡음

동기 Effect라 **언마운트 위험은 없고**, `query` 를 쓰는데 `[]` 만 적습니다.

```jsx
import { useState, useEffect } from 'react'

export default function TabTitle({ query }) {
  const [n, setN] = useState(0)

  // 목록에 없는 값 — query 를 쓰는데 [] 만 적음
  useEffect(() => {
    document.title = query
  }, [])

  return <button onClick={() => setN(n + 1)}>눌러 보기 {n}</button>
}
```

여기서 볼 것:

| 표시 | 이 코드에서 |
| :--- | :--- |
| `목록에 없는 값` | `query` 가 `[]` 에 없음 |
| 가로 알약 | 마운트 1회 → `document.title` (⏳ 없음) |

처음부터 **펼쳐져** 있어야 정상입니다. `위험` 배지는 안 뜹니다 (답을 기다리지 않음).

---

### 3) `무한 루프` — 읽고 다시 씀

한 Effect가 **deps로 보는 상태**를 스스로 바꿉니다.

```jsx
import { useState, useEffect } from 'react'

export default function TickLoop() {
  const [count, setCount] = useState(0)

  // 무한 루프 — count 를 읽고 다시 setCount
  useEffect(() => {
    setCount(count + 1)
  }, [count])

  return <button onClick={() => setCount(0)}>리셋 {count}</button>
}
```

여기서 볼 것:

| 배지 | 이 코드에서 |
| :--- | :--- |
| **무한 루프** | `count` 가 바뀌면 Effect가 다시 `setCount` |

처음부터 **펼쳐져** 있어야 정상입니다. 위쪽 타이밍 코너는 안 나와도 됩니다 (비동기도, 빠진 값도 없음).

---

### 4) `매 렌더 + setState` — 의존 목록 자체가 없음

`[]` 조차 없어서 **그릴 때마다** Effect가 돌고, 그때마다 상태를 바꿉니다.

```jsx
import { useState, useEffect } from 'react'

export default function EveryRender() {
  const [n, setN] = useState(0)

  // 매 렌더 + setState — 두 번째 인자가 없음
  useEffect(() => {
    setN(n + 1)
  })

  return <button onClick={() => setN(0)}>리셋 {n}</button>
}
```

여기서 볼 것:

| 배지 | 이 코드에서 |
| :--- | :--- |
| **무한 루프** | 의존 목록이 없어 렌더마다 재실행 + `setN` |

처음부터 **펼쳐져** 있어야 정상입니다. `목록에 없는 값` 은 안 뜹니다 (목록이 없으면 그 검사는 안 함).

---

### 5) `누가 마지막에 쓰나` — 늦게 온 답이 덮음

두 Effect가 **같은 상태**를 비동기로 바꿉니다.

```jsx
import { useState, useEffect } from 'react'

export default function DualSource({ a, b }) {
  const [items, setItems] = useState([])

  // A. a 가 바뀌면 items 를 받음
  useEffect(() => {
    fetch('/api/a/' + a)
      .then((res) => res.json())
      .then(setItems)
  }, [a])

  // B. b 가 바뀌면 같은 items 를 받음 → 늦게 온 쪽이 덮음
  useEffect(() => {
    fetch('/api/b/' + b)
      .then((res) => res.json())
      .then(setItems)
  }, [b])

  return <button onClick={() => setItems([])}>비우기 {items.length}</button>
}
```

여기서 볼 것:

| 표시 | 이 코드에서 |
| :--- | :--- |
| `위험` (위 코너) | A·B 둘 다 가드 없는 `fetch` → `setItems` |
| **누가 마지막에 쓰나** | A와 B가 둘 다 `items` 를 씀. 비동기라 늦게 온 답이 덮을 수 있음 |

두 코너 모두 처음부터 **펼쳐져** 있어야 정상입니다.

---

한 파일에 다 넣고 싶으면 컴포넌트 다섯 개를 이어 붙이면 됩니다. bunseki는 파일 안 컴포넌트를 각각 그립니다.

---
---

붙여넣기용으로 import는 한 줄만 두고, 컴포넌트 다섯 개를 이었습니다.

## 한 파일

```jsx
import { useState, useEffect } from 'react'

export default function UserCard({ userId }) {
  const [user, setUser] = useState(null)

  // ① 위험 — 답이 오기 전에 화면이 사라지면 없는 화면에 setUser
  useEffect(() => {
    fetch('/api/user/' + userId)
      .then((res) => res.json())
      .then(setUser)
  }, [userId])

  return <button onClick={() => setUser(null)}>비우기 {user ? user.name : '없음'}</button>
}

export function TabTitle({ query }) {
  const [n, setN] = useState(0)

  // ② 목록에 없는 값 — query 를 쓰는데 [] 만 적음
  useEffect(() => {
    document.title = query
  }, [])

  return <button onClick={() => setN(n + 1)}>눌러 보기 {n}</button>
}

export function TickLoop() {
  const [count, setCount] = useState(0)

  // ③ 무한 루프 — count 를 읽고 다시 setCount
  useEffect(() => {
    setCount(count + 1)
  }, [count])

  return <button onClick={() => setCount(0)}>리셋 {count}</button>
}

export function EveryRender() {
  const [n, setN] = useState(0)

  // ④ 매 렌더 + setState — 두 번째 인자가 없음
  useEffect(() => {
    setN(n + 1)
  })

  return <button onClick={() => setN(0)}>리셋 {n}</button>
}

export function DualSource({ a, b }) {
  const [items, setItems] = useState([])

  // ⑤ A. a 가 바뀌면 items 를 받음
  useEffect(() => {
    fetch('/api/a/' + a)
      .then((res) => res.json())
      .then(setItems)
  }, [a])

  // ⑤ B. b 가 바뀌면 같은 items 를 받음 → 늦게 온 쪽이 덮음
  useEffect(() => {
    fetch('/api/b/' + b)
      .then((res) => res.json())
      .then(setItems)
  }, [b])

  return <button onClick={() => setItems([])}>비우기 {items.length}</button>
}
```

## 동작 탭에서 볼 것

| 컴포넌트 | 펼쳐져야 하는 코너 |
| :--- | :--- |
| `UserCard` | 이 Effect는 언제·무엇을 보나? → `위험` |
| `TabTitle` | 이 Effect는 언제·무엇을 보나? → `목록에 없는 값` |
| `TickLoop` | Effect끼리 서로 건드리나? → `무한 루프` |
| `EveryRender` | Effect끼리 서로 건드리나? → `무한 루프` (목록 없음) |
| `DualSource` | 위 코너 `위험` + 아래 코너 `누가 마지막에 쓰나` |

이 코드를 `5compo.md`에 그대로 넣어 둘까요?
