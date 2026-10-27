// 같은 곳(IP)에서 정해진 시간 안에 정해진 횟수까지만 허용한다 (서버 메모리 기준, 재시작하면 초기화)
// key: 무엇을 기준으로 셀지 (기본 IP, 회원은 계정 번호로 셀 수 있다)
export function createLimiter({ limit, windowMs, key: keyOf = (req) => req.ip }) {
  const recent = new Map()
  return function tooMany(req) {
    const key = keyOf(req)
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
