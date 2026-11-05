// 벡터 검색 자동 반영 테스트: 상품을 승인·수정·판매 중지하면 검색 자료가 따라오는지 실제 서버로 확인한다
//   npm run test-rag
// 벡터 계산만 부르고 AI 답은 부르지 않는다 (몇 원도 안 든다). 시험 상품과 계정은 끝나면 지운다
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { hashPassword } from '../server/auth.js'
import { clearCache } from '../server/cache.js'
import { chooseQuote, findEvidence, loadCatalog, pickContext } from '../server/chat.js'
import { pool as db } from '../server/db.js'
import { prepareRag, searchChunks, syncRag } from '../server/rag.js'

const backendLogs = []
function startBackend(extra = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BACKEND_PORT: '0', NODE_ENV: 'development', DB_POOL_MAX: '2', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', ...extra }
    const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs = ''
    const onData = (chunk) => {
      logs += chunk
      backendLogs.push(`${new Date().toLocaleTimeString('ko-KR')} ${String(chunk).trim()}`)
      const m = logs.match(/\[server\] http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !child.port) {
        child.port = Number(m[1])
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { if (!child.port) reject(new Error(`백엔드가 켜지지 않음 (${code}): ${logs}`)) })
  })
}

let ip = 0
async function call(child, who, method, path, body) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.78.${Math.floor(ip / 250)}.${ip % 250 + 1}`,
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (who) {
    const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
    if (cookies.length) who.cookie = cookies.join('; ')
  }
  return { status: response.status, data: await response.json().catch(() => null) }
}

let failed = 0
const started = Date.now()
function check(name, ok, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${((Date.now() - started) / 1000).toFixed(1)}초 ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitFor(test, ms = 40_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await test()) return true
    await new Promise((ok) => setTimeout(ok, 500))
  }
  return false
}
const chunkText = async (key) => (await db.query('SELECT text FROM rag_chunks WHERE key = $1', [key])).rows[0]?.text ?? null

const tag = randomBytes(3).toString('hex')
const code = `rt_item_${tag}`
const key = `product:${code}:about:0`
const accounts = [[`rt_admin_${tag}`, 'admin', null], [`rt_sunny_${tag}`, 'seller', 'farm_sunny']]
const password = `rt-${randomBytes(9).toString('hex')}`
let backend
let questionId = null

async function main() {
  await prepareRag()
  backend = await startBackend()
  const hashed = await hashPassword(password)
  for (const [login, role, seller] of accounts) {
    await db.query('INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, $3, $4)', [login, hashed, role, seller])
  }
  const admin = {}
  const seller = {}
  await call(backend, admin, 'POST', '/admin/login', { loginId: accounts[0][0], password })
  await call(backend, seller, 'POST', '/admin/login', { loginId: accounts[1][0], password })

  // 1. 승인 전에는 들어가지 않는다
  const created = await call(backend, seller, 'POST', '/seller/products', {
    product_code: code, name: '[예시] 시험 피클용 당근 1kg', price: '5000', unit: '1kg 1봉', stock: '3', item_code: 'carrot', tags: ['home'], status: 'pending',
    summary: '새콤한 피클을 담가 먹기 좋게 작게 자란 당근',
    notice: { origin: '국내산', expiry: '수확 후 7일', composition: '당근 1kg', packed: '2026-11-01', imported: false },
  })
  check('판매자 상품 등록', created.status === 201, `응답 ${created.status} ${created.status === 201 ? '' : created.data?.error}`)
  await new Promise((ok) => setTimeout(ok, 5000))
  check('승인 전에는 검색 자료에 없음', !(await chunkText(key)))

  // 2. 승인하면 자동으로 들어간다
  const approved = await call(backend, admin, 'PATCH', `/admin/products/${code}`, { status: 'active' })
  check('관리자 승인', approved.status === 200, `응답 ${approved.status}`)
  check('승인하면 자동으로 들어감', await waitFor(() => chunkText(key)))

  clearCache()
  const found = await searchChunks('피클 담그기 좋은 재료', { limit: 5 })
  check('말을 바꾼 질문으로 찾음', found.some((c) => c.key === key), found.slice(0, 2).map((c) => `${c.key} ${c.score.toFixed(3)}`).join(', '))

  // 3. 판매자 글은 찾아도 답으로 그대로 내지 않고 AI 자료로만 쓴다
  const sellerText = found.find((c) => c.key === key)
  check('판매자 글은 답으로 그대로 내지 않음', sellerText && !sellerText.trusted && !chooseQuote([sellerText], '피클 담그기 재료'))

  // 4. 수정하면 새 글로 바뀐다
  const edited = await call(backend, admin, 'PATCH', `/admin/products/${code}`, { summary: '달콤한 라페를 만들기 좋게 가늘게 자란 당근' })
  check('수정 저장', edited.status === 200, `응답 ${edited.status}`)
  check('수정하면 새 글로 바뀜', await waitFor(async () => (await chunkText(key))?.includes('라페')))

  // 5. 판매를 멈추면 다시 계산되기 전이라도 바로 안 나오고, 곧 자료에서도 빠진다
  const stopped = await call(backend, admin, 'PATCH', `/admin/products/${code}`, { status: 'draft' })
  check('판매 중지', stopped.status === 200, `응답 ${stopped.status}`)
  clearCache()
  const catalog = await loadCatalog()
  const message = '라페 만들기 좋은 재료'
  const evidence = await findEvidence(message, catalog, pickContext(catalog, { message, history: [], productCode: null }))
  check('판매 중지하면 바로 안 나옴', !evidence.some((c) => c.product_code === code))
  check('판매 중지하면 자료에서도 빠짐', await waitFor(async () => !(await chunkText(key))))

  // 6. 숨긴 Q&A는 빠진다
  const inserted = await db.query(
    "INSERT INTO questions (product_code, author, question, answer, answered_at) VALUES ('carrot_3kg', '시험', '시험 질문 보라색 당근이 있나요', '시험 답 보라색은 없어요', now()) RETURNING id",
  )
  questionId = inserted.rows[0].id
  await syncRag()
  check('답한 Q&A는 들어감', Boolean(await chunkText(`qna:${questionId}`)))
  await db.query('UPDATE questions SET hidden = true WHERE id = $1', [questionId])
  await syncRag()
  check('숨긴 Q&A는 빠짐', !(await chunkText(`qna:${questionId}`)))

  // 7. 모델을 못 써도 챗봇은 죽지 않는다
  backend.kill() // 실습 DB 연결 수 제한(5개)을 넘지 않게 먼저 끈다
  await new Promise((ok) => setTimeout(ok, 1000))
  const noRag = await startBackend({ RAG_ENABLED: '0', DB_POOL_MAX: '1' })
  const off = await call(noRag, null, 'POST', '/chat', { message: '오늘 날씨 어때요' })
  noRag.kill()
  await new Promise((ok) => setTimeout(ok, 1000))
  check('벡터 검색을 꺼도 답함', off.status === 200 && Boolean(off.data?.answer), `응답 ${off.status}`)
  const badModel = await startBackend({ RAG_MODEL: 'no-such/model-for-test', DB_POOL_MAX: '1' })
  const broken = await call(badModel, null, 'POST', '/chat', { message: '오늘 날씨 어때요' })
  await new Promise((ok) => setTimeout(ok, 3000))
  const brokenAgain = await call(badModel, null, 'POST', '/chat', { message: '보관은 어떻게 해요' })
  badModel.kill()
  check('벡터 호출이 실패해도 답함', broken.status === 200 && brokenAgain.status === 200, `응답 ${broken.status}, ${brokenAgain.status}`)
}

try {
  await Promise.race([main(), new Promise((_, no) => setTimeout(() => no(new Error('150초 안에 끝나지 않음')), 150_000))])
} catch (error) {
  failed += 1
  console.error(`시험 중단: ${error.stack}`)
} finally {
  if (failed) console.log(`백엔드 로그 끝부분:\n${backendLogs.slice(-15).join('\n')}`)
  backend?.kill()
  if (questionId) await db.query('DELETE FROM questions WHERE id = $1', [questionId])
  await db.query('DELETE FROM product_changes WHERE product_code = $1', [code])
  await db.query('DELETE FROM products WHERE product_code = $1', [code])
  await db.query('DELETE FROM rag_chunks WHERE product_code = $1 OR key = $2', [code, `qna:${questionId}`])
  await db.query('DELETE FROM access_logs WHERE login_id = ANY($1)', [accounts.map((a) => a[0])])
  await db.query('DELETE FROM admins WHERE login_id = ANY($1)', [accounts.map((a) => a[0])])
}
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과')
await db.end()
process.exit(failed ? 1 : 0)
