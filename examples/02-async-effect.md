# 예제 2 — 비동기 데이터 로딩 (Effect 연쇄)

> **학습 목표**: 버튼 하나가 `useEffect` 를 깨우고, 비동기 요청을 거쳐 상태 두 개를 더 바꾸는
> 7단계 연쇄를 읽습니다. React 에서 "왜 렌더가 여러 번 도는가" 의 정체를 봅니다.

---

## 붙여넣을 코드

```jsx
import { useState, useEffect } from 'react'

export default function UserCard() {
  const [userId, setUserId] = useState(1)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchUser(userId).then((data) => {
      setUser(data)
      setLoading(false)
    })
  }, [userId])

  return (
    <div className="card">
      {loading ? <p>불러오는 중…</p> : <p>{user?.name}</p>}
      <button onClick={() => setUserId(userId + 1)}>다음 사용자</button>
    </div>
  )
}
```

---

## 먼저 스스로 예상해 보세요

1. Hook 수는 몇 개로 나올까요?
2. 「다음 사용자」 버튼을 누르면 상태가 **몇 개** 바뀔까요?
3. 연쇄는 몇 단계일까요?

---

## 앱 실행 결과

### 상태바

```
줄 23 · 함수 0 · 컴포넌트 1 · Hook 4 · Import 1
```

**Hook 4** = `useState` 3회(L4, L5, L6) + `useEffect` 1회(L8)

### 구조맵

```
컴포넌트
  UserCard   L3–22 (20줄)   hooks=[useState, useEffect]   handlers=[onClick]   export
Import
  react { useState, useEffect }   L1
```

`hooks=[...]` 는 **종류** 목록이라 `useState` 가 세 번 쓰여도 한 번만 표시됩니다. 횟수는 아래 Hook 사용 현황에서 봅니다.

### Hook 사용 현황

```
useState    3회   L4, L5, L6
useEffect   1회   L8
```

### ⚡ 동작 탭

```
UserCard
 [button onClick L19]
```

```
① 이벤트        <button onClick>                     L19
       ↓
② 상태 변경     setUserId()  →  userId               L19
       ↓  deps [userId] 에 'userId' 가 있어 다시 실행됩니다
③ Effect 실행   useEffect 재실행        [.then]      L8
       ↓
④ 함수 호출     fetchUser()             [비동기]     L10
       ↓
⑤ 상태 변경     setLoading()  →  loading             L8
       ↓
⑥ 상태 변경     setUser()  →  user                   L8
       ↓
⑦ 화면 갱신     리렌더
```

---

## 결과 해석

### 버튼 하나에 상태 3개가 바뀝니다

`userId` → `loading` → `user`. 이것이 화면이 여러 번 갱신되는 이유입니다.
예제 1 이 3단계였던 것과 비교하면 `useEffect` 하나가 연쇄를 두 배 이상 늘립니다.

### ② → ③ 사이 문구가 핵심입니다

```
deps [userId] 에 'userId' 가 있어 다시 실행됩니다
```

`useEffect` 의 두 번째 인자 `[userId]` 를 읽어, ② 에서 바뀐 상태와 대조한 결과입니다.
**이 문구가 있으면 "상태 변경이 Effect 를 깨웠다"** 는 뜻입니다.

### 배지 두 개의 위치가 다릅니다

| 배지 | 붙은 곳 | 의미 |
| :--- | :--- | :--- |
| `[.then]` | ③ Effect 스텝 | 이 Effect **안에** `.then` 이 있다 |
| `[비동기]` | ④ 함수 호출 스텝 | 이 호출이 비동기 흐름의 일부다 |

---

## ⚠️ 해석할 때 주의할 점 2가지

### 1. 스텝 순서 ≠ 코드 실행 순서

코드에서는 `setLoading(true)` 가 `fetchUser()` **앞**에 있습니다.

```jsx
setLoading(true)        // ← 먼저
fetchUser(userId).then(...)  // ← 나중
```

그런데 표에서는 ④ `fetchUser()` 다음에 ⑤ `setLoading()` 이 나옵니다.

도구가 Effect 안을 **"함수 호출 먼저, 상태 변경 나중"** 으로 묶어 나열하기 때문입니다.
**연쇄에 무엇이 포함되는지는 정확하지만, 그 안의 실행 순서까지 보장하지는 않습니다.**

### 2. ⑤·⑥의 `L8` 은 Effect 시작 줄입니다

실제 호출 위치는 `setLoading` 이 L9·L12, `setUser` 가 L11 입니다.
Effect 내부의 상태 변경은 **Effect 선언 줄(L8)** 을 가리키도록 되어 있습니다.

클릭하면 L8 로 이동하니, 거기서부터 Effect 본문을 읽으시면 됩니다.
반면 ④ `fetchUser()` 의 **L10 은 실제 호출 줄** 이라 정확합니다.

---

## 확인 문제

- **Q.** `setLoading` 은 코드에서 두 번(L9, L12) 호출되는데 왜 스텝에 한 번만 나올까요?
  <details><summary>답</summary>같은 setter 는 한 번만 표시합니다. 동작 탭은 "몇 번 불렀는가" 가 아니라 <strong>"어떤 상태가 바뀌는가"</strong> 를 보여줍니다.</details>

- **Q.** `deps` 를 `[userId]` 에서 `[]` 로 바꾸면 동작 탭은 어떻게 달라질까요?
  <details><summary>답</summary>연쇄가 ②③④⑤⑥ 없이 <code>setUserId() → 리렌더</code> 3단계로 줄고, Effect 목록에는 "마운트 시 1회만 실행" 으로 표시됩니다. 빈 deps 는 어떤 상태 변경에도 반응하지 않기 때문입니다.</details>

---

**이전**: [01 — 카운터](./01-counter.md) · **다음**: [03 — 커스텀 훅](./03-custom-hook.md)
