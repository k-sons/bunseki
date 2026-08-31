이 앱은 **위험하면 펼치고, 당장 위험하지 않으면 접거나 숨깁니다.**

---

### 안전 — 코너가 안 나오거나 접힘

**안 나옴** (짚을 것이 없음)

```jsx
useEffect(() => {
  document.title = query
}, [query])
```

동기 Effect, 빠진 값 없음, Effect끼리 안 건드림.

**접힘** (보이긴 하지만 잔소리로 안 펼침)

```jsx
useEffect(() => {
  let alive = true
  fetch(url).then(r => r.json()).then(data => {
    if (!alive) return
    setItems(data)
  })
  return () => { alive = false }
}, [url])
```

비동기지만 **가드 있음** → 타이밍 코너는 접힘.

```jsx
useEffect(() => { setPage(1) }, [query])
useEffect(() => { fetchPage(query, page) }, [query, page])
```

한쪽이 바꾸면 다음이 따라감 (**이어서 실행**, 정보) → 관계 코너는 접힘.

같은 상태를 Effect 둘이 **곧바로** 바꿔도, 비동기가 아니면 정보 표시라 접힙니다.

---

### 위험 — 처음부터 펼침

**가드 없는 fetch** (앞에서 본 코드)

```jsx
useEffect(() => {
  mockFetch(`/api?q=${query}&page=${page}`)
    .then(res => res.json())
    .then(data => {
      setItems(data.list)
      setTotal(data.total)
    })
}, [query, page])
```

답이 오기 전에 화면이 바뀌면 없는 화면에 `setItems`를 칩니다.

**의존 목록에 없는 값**

```jsx
useEffect(() => {
  fetchUser(userId).then(setUser)  // userId 를 읽는데
}, [])                             // 목록에는 없음
```

옛 `userId`를 붙잡고 요청할 수 있습니다.

**무한 루프**

```jsx
useEffect(() => {
  setCount(count + 1)
}, [count])
```

가드가 있어도 루프면 **펼칩니다.** 조건이 어긋나면 안 멈출 수 있어서입니다.

**매 렌더 + setState**

```jsx
useEffect(() => {
  setN(n + 1)   // deps 없음 → 렌더할 때마다
})
```

**늦게 온 답이 덮음** (누가 마지막에 쓰나)

```jsx
useEffect(() => { fetchA().then(setItems) }, [a])
useEffect(() => { fetchB().then(setItems) }, [b])
```

같은 `items`를 비동기 둘이 바꿉니다.

---

한 줄로 보면, **펼침 = 지금 볼 위험**, **접힘 = 알아 두면 됨**, **없음 = 이 검사가 말할 것이 없음**입니다.