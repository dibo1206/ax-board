// SQL 인젝션 공격 시험 (2026-11-19 OWASP A03 점검): npm run test-sqli
// 손님이 값을 넣는 주소(검색·필터·추천·주문 조회·로그인)에 실제 공격 문구를 보내고,
// 하나라도 통하면 실패한다:
//   1) 시간 지연  '; SELECT pg_sleep(N)--  → 응답이 느려지면 주입됨
//   2) 참/거짓    ' OR '1'='1              → 없는 검색어인데 상품이 쏟아지면 주입됨
//   3) 오류 노출  ' ') \ UNION SELECT      → 500 이거나 SQL 오류 글자가 새면 주입됨
//   4) 로그인 우회 admin'--                → 비밀번호 없이 200 이면 주입됨
//   5) 주문 조회  ' OR '1'='1              → 아무 주문이나 보이면 주입됨
// 읽기·시간지연 공격만 쓴다(데이터를 바꾸지 않는다). 백엔드 사본은 빈 포트로 따로 띄운다.
import 'dotenv/config'
import { spawn } from 'node:child_process'

const SLEEP = 4 // 초: 이 시간만큼 느려지면 주입으로 본다
const SQL_ERROR = /\bSQL\b|syntax error|unterminated|pg_|PostgreSQL|column .* does not exist|invalid input syntax|relation .* does not exist/i
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '통과' : '실패'} ${name}${detail ? `  (${detail})` : ''}`)
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    const onData = (chunk) => {
      logs += chunk
      const m = logs.match(/\[server\] http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !child.port) { child.port = Number(m[1]); resolve(child) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => { if (!child.port) reject(new Error(`백엔드가 켜지지 않음: ${logs.slice(-500)}`)) })
  })
}

const backend = await startBackend()
const base = `http://127.0.0.1:${backend.port}`
let n = 0
async function hit(method, path, body) {
  n += 1
  const t0 = Date.now()
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.123.${Math.floor(n / 250)}.${n % 250}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, text, seconds: (Date.now() - t0) / 1000 }
}
const q = encodeURIComponent

try {
  // 대조: 공개 주소가 열려 있어야 시험이 유효하다
  const control = await hit('GET', '/api/products')
  if (control.status !== 200) {
    console.log(`대조 실패: /api/products 가 ${control.status} — .env 의 PROXY_SECRET·DATABASE_URL 확인`)
    backend.kill('SIGTERM'); process.exit(2)
  }

  const SLEEP_PAYLOADS = [`'; SELECT pg_sleep(${SLEEP})--`, `' OR pg_sleep(${SLEEP})--`, `'||pg_sleep(${SLEEP})||'`]
  const GET_SURFACES = [
    (p) => `/api/catalog?q=${q(p)}`,
    (p) => `/api/catalog?category=${q(p)}`,
    (p) => `/api/catalog?group=${q(p)}`,
    (p) => `/api/catalog?min=${q(p)}`,
    (p) => `/api/season-items?q=${q(p)}`,
    (p) => `/api/recommend?tags=${q(p)}&budget=${q(p)}`,
    (p) => `/api/posts?kind=${q(p)}`,
    (p) => `/api/reviews/zzz?page=${q(p)}`,
  ]

  // 1) 시간 지연
  let worstSleep = 0
  for (const make of GET_SURFACES) for (const p of SLEEP_PAYLOADS) {
    const r = await hit('GET', make(p))
    worstSleep = Math.max(worstSleep, r.seconds)
  }
  for (const p of SLEEP_PAYLOADS) {
    worstSleep = Math.max(worstSleep, (await hit('POST', '/api/admin/login', { loginId: `a${p}`, password: 'x' })).seconds)
    worstSleep = Math.max(worstSleep, (await hit('POST', '/api/orders/lookup', { orderNo: `x${p}`, phone: '01000000000' })).seconds)
  }
  check('시간 지연 공격이 안 통함 (pg_sleep)', worstSleep < SLEEP - 1, `가장 느린 응답 ${worstSleep.toFixed(2)}s`)

  // 2) 참/거짓: 없는 검색어 + OR '1'='1 이 전체 상품을 열지 않는다
  const none = Number((await hit('GET', '/api/catalog?q=zzqxqzzx')).text.match(/"total":(\d+)/)?.[1] ?? -1)
  const full = Number((await hit('GET', '/api/catalog?q=')).text.match(/"total":(\d+)/)?.[1] ?? -1)
  let boolLeaked = false
  for (const p of [`zzqxqzzx' OR '1'='1`, `zzqxqzzx' OR 1=1--`, `zzqxqzzx') OR ('1'='1`]) {
    const got = Number((await hit('GET', `/api/catalog?q=${q(p)}`)).text.match(/"total":(\d+)/)?.[1] ?? -1)
    if (got >= full && full > none) boolLeaked = true
  }
  check('참/거짓 공격이 전체 상품을 열지 못함', !boolLeaked, `없는검색어 ${none} / 전체 ${full}`)

  // 3) 오류 노출: 500 도 SQL 오류 글자도 없어야 한다
  let errLeak = ''
  for (const make of GET_SURFACES) for (const p of [`'`, `')--`, `\\`, `' UNION SELECT version()--`, `1;SELECT 1`]) {
    const r = await hit('GET', make(p))
    if (r.status >= 500) errLeak = `${make(p)} → ${r.status}`
    if (SQL_ERROR.test(r.text)) errLeak = `${make(p)} → SQL 오류 노출`
  }
  check('오류 유발 공격에 500·SQL 오류가 안 샘', !errLeak, errLeak)

  // 4) 로그인 우회
  let bypass = ''
  for (const path of ['/api/admin/login', '/api/account/login']) {
    for (const p of [`admin'--`, `admin' OR '1'='1`, `' OR 1=1--`, `' OR 1=1 LIMIT 1--`]) {
      const r = await hit('POST', path, { loginId: p, password: 'anything' })
      if (r.status === 200) bypass = `${path} ← ${p}`
      if (SQL_ERROR.test(r.text) || r.status >= 500) bypass = `${path} ← ${p} (오류)`
    }
  }
  check('로그인 우회 공격이 안 통함 (전부 401)', !bypass, bypass)

  // 5) 주문 조회: 어떤 주입도 주문을 열지 못한다 (전부 404)
  let orderLeak = ''
  for (const p of [`FM000000-AAAAAAAAAA' OR '1'='1`, `' OR 1=1--`, `' OR '1'='1' --`]) {
    const r = await hit('POST', '/api/orders/lookup', { orderNo: p, phone: '01000000000' })
    if (r.status === 200) orderLeak = `orderNo ← ${p}`
  }
  const rp = await hit('POST', '/api/orders/lookup', { orderNo: 'FM000000-AAAAAAAAAA', phone: `0' OR '1'='1` })
  if (rp.status === 200) orderLeak = 'phone 주입'
  check('주문 조회 우회 공격이 안 통함 (전부 404)', !orderLeak, orderLeak)
} finally {
  backend.kill('SIGTERM')
}
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} 통과`)
process.exit(ok === results.length ? 0 : 1)
