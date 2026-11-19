// XSS 공격 시험 (2026-11-19 OWASP 점검): npm run test-xss
// 손님이 로그인 없이 글을 남기는 곳(상품 문의)에 악성 스크립트를 실제로 저장하고 되불러와서,
// 다른 사람 화면에서 '코드로 실행'되지 않고 '글자로만' 보이는지 확인한다.
//   1) 저장형 XSS: 상품 문의에 <script> 등을 넣고 → 상품 상세 API(JSON)로 되받아 → 글자 그대로인지
//   2) 응답이 HTML 이 아니라 JSON 으로 오는지 (브라우저가 JSON 안의 <script> 를 실행하지 않음)
//   3) 서버가 만드는 상품 페이지(/p/코드) HTML 에 공격 문구가 살아 있는 태그로 들어가지 않는지
//   4) CSP 방어막: script-src 에 'unsafe-inline' 이 없어 인라인 <script>·onerror= 가 아예 안 돌아감
// 만든 문의는 끝나고 번호(id)로만 지운다. 백엔드 사본은 빈 포트로 따로 띄운다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import pg from 'pg'
import { CSP, esc } from '../server/web.js'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '통과' : '실패'} ${name}${detail ? `  (${detail})` : ''}`)
}

const TAG = `xsstest_${Math.random().toString(36).slice(2, 8)}`
// 고전 XSS 공격 문구 5종 (뒤에 TAG 를 붙여 우리가 넣은 글만 찾고 지운다)
const PAYLOADS = [
  `<script>alert(1)</script> 맛있나요 ${TAG}`,
  `<img src=x onerror=alert(1)> 질문있어요 ${TAG}`,
  `"><svg onload=alert(1)> 이거 괜찮나요 ${TAG}`,
  `<a href="javascript:alert(1)">클릭</a> 문의드려요 ${TAG}`,
  `<body onload=alert(1)> 배송 언제와요 ${TAG}`,
]

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

const code = (await db.query("SELECT product_code FROM products WHERE status = 'active' ORDER BY created_at LIMIT 1")).rows[0]?.product_code
if (!code) { console.log('활성 상품이 없어요'); await db.end(); process.exit(2) }
const backend = await startBackend()
const base = `http://127.0.0.1:${backend.port}`
let n = 0
const headers = () => ({ 'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.210.${Math.floor(++n / 250)}.${n % 250}` })
const ids = []

try {
  // 1) 공격 문구를 상품 문의로 저장
  let posted = 0
  for (let i = 0; i < PAYLOADS.length; i++) {
    const res = await fetch(`${base}/api/${'products'}/${code}/questions`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ author: `해커${i}`, question: PAYLOADS[i] }),
    })
    if (res.status === 201) { posted++; ids.push((await res.json()).id) }
    else console.log(`  (문의 저장 실패 ${res.status} ${(await res.text()).slice(0, 80)})`)
  }
  check('상품 문의로 공격 문구 저장됨', posted === PAYLOADS.length, `${posted}/${PAYLOADS.length}`)

  // 2) 상품 상세 API 로 되받기: JSON 이고, 공격 문구가 글자 그대로인지
  const detail = await fetch(`${base}/api/products/${code}`, { headers: headers() })
  const ctype = detail.headers.get('content-type') ?? ''
  const body = await detail.text()
  check('상품 상세가 HTML 이 아니라 JSON 으로 옴', /application\/json/.test(ctype), ctype)
  const data = JSON.parse(body)
  const got = (data.questions ?? []).map((q) => q.question)
  const allStored = PAYLOADS.every((p) => got.includes(p)) // 글자 그대로 저장·반환 (화면 React 가 그릴 때 이스케이프)
  check('공격 문구가 글자 그대로 저장·반환됨 (변형 없음)', allStored)
  // 응답이 application/json 이라 브라우저는 안의 <script> 를 데이터로만 읽는다 (HTML 로 해석·실행하지 않음)
  check('상품 상세가 text/html 이 아님 (JSON 안의 태그는 실행 안 됨)', !/text\/html/.test(ctype))

  // 3) 서버가 만드는 상품 페이지(/p/코드) 의 제목·소개(meta)에 넣는 글자는 esc() 로 이스케이프된다
  for (const p of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', `' onmouseover='alert(1)`]) {
    const out = esc(p)
    const safe = !out.includes('<') && !out.includes('>') && !out.includes('"') && out.includes('&lt;') === p.includes('<')
    check(`서버 HTML 이스케이프: ${p.slice(0, 24)}…`, safe, out.slice(0, 40))
  }

  // 4) CSP 방어막: 인라인 스크립트·이벤트 핸들러가 아예 못 돈다 (저장·반사형 XSS 가 뚫려도 실행 차단)
  const scriptSrc = CSP.match(/script-src([^;]*)/)?.[1] ?? ''
  check('CSP script-src 에 unsafe-inline 없음 (인라인 <script>·onerror= 차단)', Boolean(scriptSrc) && !/unsafe-inline/.test(scriptSrc), scriptSrc.trim())
  check("CSP: unsafe-eval 없음, object-src 'none', base-uri 'self', frame-ancestors 'none'",
    !/unsafe-eval/.test(CSP) && /object-src 'none'/.test(CSP) && /base-uri 'self'/.test(CSP) && /frame-ancestors 'none'/.test(CSP))
} finally {
  backend.kill('SIGTERM')
  if (ids.length) await db.query('DELETE FROM questions WHERE id = ANY($1::int[])', [ids])
  // 혹시 id 를 못 받은 글이 있으면 TAG 로도 지운다 (우리가 만든 글만)
  await db.query('DELETE FROM questions WHERE question LIKE $1', [`%${TAG}%`])
  await db.end()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} 통과`)
process.exit(ok === results.length ? 0 : 1)
