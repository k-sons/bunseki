/**
 * Effect Interplay — 여러 Effect 가 같은 상태를 두고 서로 얽히는 모습을 봅니다.
 *
 *   useEffect(() => { setUser(u) }, [id])      // A 가 user 를 바꾸면
 *   useEffect(() => { … }, [user])             // B 가 이어서 돈다        → 연쇄
 *
 *   useEffect(() => { setCount(count + 1) }, [count])   // 스스로를 다시 부름 → 무한 루프
 *   useEffect(() => { setCount(1) })                    // deps 가 없어 매 렌더 실행 → 무한 루프
 *
 *   useEffect(() => { setUser(a) }, [id])      // 둘 다 user 를 쓴다
 *   useEffect(() => { setUser(b) }, [q])       //   누가 마지막에 쓰나?    → 경합
 *
 * 재료는 timing.js 결과뿐입니다. Effect 마다 있는
 *   "쓴다"  = setters[].state
 *   "읽는다" = deps 에 그 상태가 있다 (trigger === 'deps')
 * 를 간선으로 이어 그래프를 만들고 — 고리면 **무한 루프**, 아니면 **연쇄**,
 * 같은 상태에 쓰는 Effect 가 둘 이상이면 **경합** 입니다.
 * deps 배열이 아예 없는 Effect 는 간선 없이도 혼자 고리를 이룹니다(매 렌더 재실행).
 *
 * 오탐 정책은 deps.js 와 같습니다: 확실한 것만 말합니다.
 * 여기서 쓰는 사실(어떤 setter 가 어떤 상태를 바꾸는가 · deps 에 무엇이 있는가)은
 * 모두 AST 에서 그대로 읽어낸 것이라 추측이 섞이지 않습니다.
 */

/** 그래프가 너무 크면 분석을 포기합니다 (경로 폭발 방지) */
const MAX_NODES = 40
/** 연쇄·고리를 따라갈 최대 간선 수 */
const MAX_CHAIN = 4
/** 한 컴포넌트에서 보여줄 최대 항목 수 */
const MAX_FINDINGS = 8

const SEVERITY_RANK = { risk: 0, warn: 1, info: 2 }
const KIND_RANK = { loop: 0, contention: 1, cascade: 2 }

/**
 * @typedef {Object} Interplay
 * @property {'loop'|'contention'|'cascade'} kind
 * @property {'risk'|'warn'|'info'} severity
 * @property {string} label                 - 한 줄 제목
 * @property {string} note                  - 무슨 일이 벌어지는지 설명
 * @property {number[]} lines               - 관련 Effect 줄 번호
 * @property {object[]} steps               - UI 가 순서대로 그리기만 하면 되는 알약들
 */

/**
 * 컴포넌트 하나의 Effect 들이 서로 어떻게 얽히는지 분석합니다.
 * @param {Array} timing - analyzeEffectsTiming() 결과
 * @returns {Interplay[]}
 */
export function analyzeInterplay(timing) {
  const effects = (timing || []).filter(e => e && e.line != null)
  if (effects.length === 0 || effects.length > MAX_NODES) return []

  const nodes = effects.map((e, i) => ({
    i,
    line: e.line,
    hook: e.hook,
    viaHook: e.viaHook || null,
    trigger: e.trigger,
    deps: e.deps || [],
    writes: mergeWrites(e.setters || []),
  }))

  // A --state--> B : A 가 바꾼 상태가 B 의 deps 에 있으면 B 가 이어서 실행됩니다.
  const edges = []
  for (const from of nodes) {
    for (const w of from.writes) {
      for (const to of nodes) {
        if (to.trigger !== 'deps') continue
        if (!to.deps.includes(w.state)) continue
        edges.push({ from: from.i, to: to.i, state: w.state, write: w })
      }
    }
  }

  const cycles = findCycles(nodes, edges)
  const cycleEdges = new Set()
  cycles.forEach(c => c.forEach(e => cycleEdges.add(edgeKey(e))))

  const findings = [
    ...cycles.map(c => loopFinding(c, nodes)),
    ...everyRenderFindings(nodes),
    ...contentionFindings(nodes),
    ...cascadeFindings(nodes, edges.filter(e => e.from !== e.to && !cycleEdges.has(edgeKey(e)))),
  ]

  findings.sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    (KIND_RANK[a.kind] - KIND_RANK[b.kind]) ||
    (a.lines[0] - b.lines[0])
  )

  return findings.slice(0, MAX_FINDINGS)
}

/**
 * 한 Effect 가 같은 상태를 여러 번 바꾸면 한 줄로 합칩니다.
 * 합칠 때 "하나라도 비동기면 비동기", "전부 조건문 안이어야 가드됨" 으로 봅니다.
 */
function mergeWrites(setters) {
  const byState = new Map()
  for (const s of setters) {
    if (!s.state) continue
    const prev = byState.get(s.state)
    if (!prev) {
      byState.set(s.state, {
        state: s.state,
        name: s.name,
        line: s.line,
        deferred: !!s.deferred,
        guarded: !!s.guarded,
        nested: !!s.nested,
      })
    } else {
      prev.deferred = prev.deferred || !!s.deferred
      prev.guarded = prev.guarded && !!s.guarded
      prev.nested = prev.nested && !!s.nested
    }
  }
  return [...byState.values()]
}

const edgeKey = (e) => `${e.from}>${e.to}:${e.state}`

/**
 * 그래프에서 고리를 찾습니다.
 * 같은 고리를 여러 번 세지 않도록 **가장 작은 번호의 노드에서 출발한 것만** 인정하고,
 * 지나가는 노드 순서로 한 번 더 걸러 냅니다(같은 노드를 도는 고리는 하나로).
 */
function findCycles(nodes, edges) {
  const adj = new Map()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push(e)
  }

  const cycles = []
  const seen = new Set()

  for (const start of nodes.map(n => n.i)) {
    const path = []
    const onPath = new Set([start])

    const step = (v) => {
      if (cycles.length >= MAX_FINDINGS) return
      for (const e of adj.get(v) || []) {
        if (e.to === start) {
          const cycle = [...path, e]
          const key = [start, ...cycle.map(x => x.to)].join('>')
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push(cycle)
          }
          continue
        }
        // 더 작은 번호에서 출발한 고리는 그쪽에서 이미 찾습니다
        if (e.to < start || onPath.has(e.to) || path.length >= MAX_CHAIN) continue
        onPath.add(e.to)
        path.push(e)
        step(e.to)
        path.pop()
        onPath.delete(e.to)
      }
    }

    step(start)
  }

  return cycles
}

/** 고리 하나를 "무한 루프 위험" 항목으로 */
function loopFinding(cycle, nodes) {
  const first = nodes[cycle[0].from]
  const guarded = cycle.every(e => e.write.guarded)
  const isSelf = cycle.length === 1 && cycle[0].from === cycle[0].to

  const steps = [effectStep(first, null)]
  cycle.forEach((e, idx) => {
    steps.push(setterStep(e.write))
    if (idx < cycle.length - 1) steps.push(effectStep(nodes[e.to], e.state))
  })
  steps.push({ kind: 'loopback', label: `↺ 다시 L${first.line}`, line: first.line })

  const lines = [first.line, ...cycle.slice(0, -1).map(e => nodes[e.to].line)]
  const guardNote = loopGuardNote(guarded)

  if (isSelf) {
    const state = cycle[0].state
    return {
      kind: 'loop',
      severity: guarded ? 'warn' : 'risk',
      label: `L${first.line} 이 스스로를 다시 부릅니다 — 무한 루프 위험`,
      note: `의존 목록에 있는 '${state}' 값을 이 Effect 가 직접 바꿉니다. 바뀌면 다시 실행되고, 또 바꾸고 — 멈출 지점이 없습니다.${guardNote}`,
      lines,
      steps,
    }
  }

  const chain = cycle
    .map((e, idx) => `L${lines[idx]} 이 '${e.state}' 를 바꾸면 L${nodes[e.to].line} 이 실행되고`)
    .join(', ')

  return {
    kind: 'loop',
    severity: guarded ? 'warn' : 'risk',
    label: `${lines.map(l => `L${l}`).join(' ↔ ')} 이 서로를 다시 부릅니다 — 무한 루프 위험`,
    note: `${chain} — 고리가 닫혀 있어 처음으로 되돌아옵니다.${guardNote}`,
    lines,
    steps,
  }
}

/** 고리를 멈출 수 있는가 — 루프 설명 끝에 붙는 한 마디 */
function loopGuardNote(guarded) {
  return guarded
    ? ' 조건문 안에서 바꾸므로 조건이 거짓이 되면 멈추지만, 조건이 어긋나면 끝없이 반복합니다.'
    : ' 같은 값을 그대로 다시 쓰면 React 가 멈춰 주지만, 새 객체·배열을 만들어 넣으면 계속 돕니다.'
}

/**
 * deps 배열이 **아예 없는** Effect 는 매 렌더 다시 실행됩니다.
 * 그 안에서 상태를 바꾸면 → 리렌더 → 또 실행 → 또 바꾸고, 고리가 닫힙니다.
 * 간선 그래프로는 잡히지 않습니다(읽는 deps 가 없으니 간선이 안 생김).
 *
 * 헛경보를 피하려고 **effect 본문에서 곧바로 부르는 setter** 만 셉니다.
 * `setInterval(() => setX())` 처럼 콜백·타이머 안에서 부르는 것은
 * effect 가 도는 그 순간에 실행되는 것이 아니라 나중에 불리므로 제외합니다.
 */
function everyRenderFindings(nodes) {
  const out = []

  for (const node of nodes) {
    if (node.trigger !== 'every-render') continue

    const direct = node.writes.filter(w => !w.nested && !w.deferred)
    if (direct.length === 0) continue

    const guarded = direct.every(w => w.guarded)
    const states = direct.map(w => `'${w.state}'`).join(' · ')

    out.push({
      kind: 'loop',
      severity: guarded ? 'warn' : 'risk',
      label: `L${node.line} 은 의존 목록이 없어 매 렌더 실행됩니다 — 무한 루프 위험`,
      note: `의존 목록이 없으면 렌더할 때마다 다시 실행됩니다. 그런데 이 Effect 는 ${states} 를 바꾸므로 다시 렌더되고, 그래서 또 실행됩니다.${loopGuardNote(guarded)}`,
      lines: [node.line],
      steps: [
        { kind: 'effect', label: node.hook, detail: '의존 목록 없음', line: node.line, hook: node.viaHook },
        ...direct.map(setterStep),
        { kind: 'loopback', label: `↺ 다시 L${node.line}`, line: node.line },
      ],
    })
  }

  return out
}

/** 같은 상태를 둘 이상의 Effect 가 바꾸는 경우 */
function contentionFindings(nodes) {
  const byState = new Map()
  for (const node of nodes) {
    for (const write of node.writes) {
      if (!byState.has(write.state)) byState.set(write.state, [])
      byState.get(write.state).push({ node, write })
    }
  }

  const out = []
  for (const [state, writers] of byState) {
    if (writers.length < 2) continue
    writers.sort((a, b) => a.node.line - b.node.line)

    const lines = writers.map(w => w.node.line)
    const async = writers.filter(w => w.write.deferred)
    const last = lines[lines.length - 1]

    const steps = writers.map(({ node, write }) => ({
      kind: 'setter',
      phase: write.deferred ? 'async' : 'sync',
      label: `${write.name}()`,
      detail: `L${node.line}`,
      line: write.line,
    }))

    const note = async.length > 0
      ? `소스 순서는 ${lines.map(l => `L${l}`).join(' → ')} 이지만, ${async.map(w => `L${w.node.line}`).join(' · ')} 은 비동기라 응답이 온 뒤에 씁니다. 어느 쪽이 마지막에 쓸지는 응답 속도에 달려 있어, 늦게 온 옛 요청이 새 값을 덮어쓸 수 있습니다.`
      : `한 렌더에서 둘 다 실행되면 선언 순서대로 돌아 L${last} 이 마지막에 씁니다. 서로 다른 값을 쓰면 위쪽 결과는 화면에 나타나지 않습니다.`

    out.push({
      kind: 'contention',
      severity: async.length > 0 ? 'risk' : 'info',
      label: `'${state}' 를 Effect ${writers.length}개가 바꿉니다`,
      note,
      lines,
      steps,
    })
  }

  return out
}

/** 고리가 아닌 간선들 → "A 다음에 B 가 이어서 돈다" 연쇄 */
function cascadeFindings(nodes, edges) {
  if (edges.length === 0) return []

  const adj = new Map()
  const hasIncoming = new Set()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push(e)
    hasIncoming.add(e.to)
  }

  // 고리를 걷어낸 그래프는 DAG 라, 들어오는 간선이 없는 시작점이 반드시 있습니다.
  const roots = nodes.filter(n => (adj.get(n.i) || []).length > 0 && !hasIncoming.has(n.i))

  const paths = []
  const walkPath = (v, path) => {
    if (paths.length >= MAX_FINDINGS) return
    const next = adj.get(v) || []
    if (next.length === 0 || path.length >= MAX_CHAIN) {
      if (path.length > 0) paths.push([...path])
      return
    }
    for (const e of next) walkPath(e.to, [...path, e])
  }
  roots.forEach(r => walkPath(r.i, []))

  return paths.map(path => {
    const first = nodes[path[0].from]
    const lines = [first.line, ...path.map(e => nodes[e.to].line)]

    const steps = [effectStep(first, null)]
    for (const e of path) {
      steps.push(setterStep(e.write))
      steps.push(effectStep(nodes[e.to], e.state))
    }

    const deferred = path.some(e => e.write.deferred)
    const detail = path
      .map((e, idx) => `L${lines[idx]} 가 '${e.state}' 를 바꾸면 '${e.state}' 를 의존 목록에 둔 L${lines[idx + 1]} 이 이어서 실행됩니다`)
      .join('. ')

    return {
      kind: 'cascade',
      severity: 'info',
      label: `${lines.map(l => `L${l}`).join(' → ')} 순서로 이어집니다`,
      note: `${detail}. 한 번의 변경이 렌더 ${lines.length}번으로 이어집니다.` +
        (deferred ? ' 앞 Effect 는 비동기라, 응답이 온 뒤에야 다음이 돕니다.' : ''),
      lines,
      steps,
    }
  })
}

/** 알약 하나 — Effect */
function effectStep(node, viaState) {
  return {
    kind: 'effect',
    label: viaState ? `${node.hook} 재실행` : node.hook,
    detail: viaState ? `의존 목록 [${viaState}]` : `L${node.line}`,
    line: node.line,
    // 얽힌 Effect 가 컴포넌트가 아니라 커스텀 훅 안에 있으면
    // 그 훅 코드를 열어야 고칠 수 있으니, 어디 것인지 함께 답니다.
    hook: node.viaHook,
  }
}

/** 알약 하나 — setter */
function setterStep(write) {
  return {
    kind: 'setter',
    phase: write.deferred ? 'async' : 'sync',
    label: `${write.name}()`,
    detail: `→ ${write.state}`,
    line: write.line,
    guarded: write.guarded,
  }
}
