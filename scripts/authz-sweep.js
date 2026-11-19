// 권한 검사 시험 (OWASP A01 Broken Access Control): 로그인 없이 관리자·판매자·회원 주소를 전부 불러 보고,
// 401/403 이 아닌 답(=문이 열려 있음)이 하나라도 있으면 실패한다.
// 주소 목록은 소스(server/*.js)에서 자동으로 뽑는다 → 새 주소를 만들고 로그인 검사를 빠뜨리면 이 시험이 잡는다.
// 데이터가 바뀌지 않게: 주소의 번호는 없는 값(999999999), 보내는 내용은 빈 객체. 백엔드 사본은 빈 포트로 따로 띄운다.
// npm run test-authz
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const SRC = 'server'
const files = Object.fromEntries(readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(`${SRC}/${f}`, 'utf8')]))
const index = files['index.js']

// app.use('/api/admin/orders', adminOrderRouter) → 라우터 이름별 앞주소
const mounts = {}
for (const m of index.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*([A-Za-z]+Router)\s*\)/g)) (mounts[m[2]] ??= []).push(m[1])

const routes = []
const add = (method, path) => routes.push({ method: method.toUpperCase(), path })
for (const [file, text] of Object.entries(files)) {
  for (const m of text.matchAll(/\b([A-Za-z]+Router)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    for (const prefix of mounts[m[1]] ?? []) add(m[2], prefix + (m[3] === '/' ? '' : m[3]))
  }
  if (file === 'index.js') for (const m of text.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']+)'/g)) add(m[1], m[2])
}

// 로그인해야만 쓰는 주소 (손님 공개 주소·로그인 주소 자체·판매자 가입 신청은 뺀다)
const PUBLIC = [
  /^\/api\/admin\/(login|logout|me|2fa)/, // 로그인 화면이 쓰는 주소: 로그인 전에 불러야 한다
  /^\/api\/account\/(login|logout|signup|me|password-reset|find-id|check)/,
  /^\/api\/account\/oauth\//, // 카카오·네이버 간편 로그인 과정 (로그인 전에 부른다)
  /^\/api\/seller-signup/,
  /^\/api\/orders\/(lookup|guest|confirm|fail|toss|webhook|quote|pending)/,
]
const NEED_LOGIN = /^\/api\/(admin|seller|account)(\/|$)/
const targets = routes.filter((r) => NEED_LOGIN.test(r.path) && !PUBLIC.some((re) => re.test(r.path)))
const uniq = [...new Map(targets.map((r) => [`${r.method} ${r.path}`, r])).values()]

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
// 대조: 공개 주소는 열려야 한다. 여기서 막히면 로그인 검사가 아니라 앞단(PROXY_SECRET 등)에 걸린 것이라 시험이 무의미하다
const control = await fetch(`http://127.0.0.1:${backend.port}/api/products`, { headers: { 'x-proxy-secret': process.env.PROXY_SECRET ?? '' } })
if (control.status !== 200) {
  backend.kill('SIGTERM')
  console.log(`대조 실패: 공개 주소 /api/products 가 ${control.status} — .env 의 PROXY_SECRET·DATABASE_URL 을 확인해 주세요`)
  process.exit(2)
}
let open = 0
const seen = {}
try {
  let n = 0
  for (const r of uniq) {
    n += 1
    const path = r.path.replace(/:[A-Za-z_]+/g, '999999999')
    const res = await fetch(`http://127.0.0.1:${backend.port}${path}`, {
      method: r.method,
      headers: { 'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.88.${Math.floor(n / 250)}.${n % 250}` },
      body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}',
    })
    seen[res.status] = (seen[res.status] ?? 0) + 1
    // 401: 로그인 필요, 403: 권한·접속 허용 IP 밖 (둘 다 '문이 닫힘')
    if (res.status !== 401 && res.status !== 403) {
      open += 1
      console.log(`열림 ${res.status} ${r.method} ${r.path}  ${(await res.text()).slice(0, 120)}`)
    }
  }
} finally {
  backend.kill('SIGTERM')
}
console.log(`\n로그인이 필요한 주소 ${uniq.length}개 시험 · 응답 ${JSON.stringify(seen)} · 로그인 없이 열린 주소 ${open}개`)
process.exit(open ? 1 : 0)
