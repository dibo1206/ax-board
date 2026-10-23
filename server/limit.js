// 같은 곳(IP)에서 정해진 시간 안에 정해진 횟수까지만 허용한다 (서버 메모리 기준, 재시작하면 초기화)
export function createLimiter({ limit, windowMs }) {
  const recent = new Map()
  return function tooMany(req) {
    const key = req.ip
    const now = Date.now()
    const times = (recent.get(key) ?? []).filter((t) => now - t < windowMs)
    if (times.length >= limit) return true
    times.push(now)
    recent.set(key, times)
    if (recent.size > 5000) {
      for (const [k, v] of recent) if (now - v[v.length - 1] >= windowMs) recent.delete(k)
    }
    return false
  }
}
