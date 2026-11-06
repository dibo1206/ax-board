// 예시 농가 가입 시뮬레이션: data/sample_farms.json(npm run simulate-farms 가 만든 계획)대로
//   1) 농가가 판매자 가입 화면과 같은 API로 가입 신청 → 2) 관리자가 승인 → 3) 농가가 로그인해서 농가 소개를 쓰고
//   4) 상품을 올리고 검토를 요청 (믿을 만한 농가의 문제없는 상품은 바로 판매, 아니면 관리자 검토) → 5) 관리자가 검토할 상품을 승인
//   6) 손님이 상품 문의를 남기고 농가가 답한다 (답이 비어 있는 문의는 답변 대기로 둔다)
//   npm run onboard-farms → docs/farm_onboarding.md   (처음부터 다시: npm run onboard-farms -- --reset)
// 이미 가입한 농가(같은 아이디)는 저장해 둔 계정으로 이어서, 아직 안 올린 상품과 문의만 한다. 백엔드 사본을 빈 포트로 띄워 돌린다. AI는 부르지 않는다.
// 농가 비밀번호는 만들어서 .farm-accounts.local.json(저장소에 올리지 않음, 본인만 읽기)에만 둔다. 화면·로그에 쓰지 않는다
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import sharp from 'sharp'
import { hashPassword } from '../server/auth.js'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
const PLAN = JSON.parse(readFileSync(new URL('../data/sample_farms.json', import.meta.url), 'utf8'))
const ACCOUNTS_FILE = new URL('../.farm-accounts.local.json', import.meta.url)
const REPORT = new URL('../docs/farm_onboarding.md', import.meta.url)

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: '1', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', TOSS_CLIENT_KEY: '', TOSS_SECRET_KEY: '', OPENROUTER_API_KEY: '' }
    const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs = ''
    const onData = (chunk) => {
      logs += chunk
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

let child
let ip = 0
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// DB 연결이 잠깐 모자라 503이 오면 조금 기다렸다가 같은 요청을 다시 보낸다 (실습 계정은 DB 연결이 5개뿐)
async function call(who, method, path, body) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await callOnce(who, method, path, body)
    if (result.status !== 503 || attempt >= 4) return result
    await wait(1500 * attempt)
  }
}
async function callOnce(who, method, path, body) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.79.${Math.floor(ip / 250)}.${ip % 250 + 1}`,
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (who) {
    const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
    if (cookies.length) who.cookie = cookies.join('; ')
  }
  return { status: response.status, data: response.status === 204 ? null : await response.json().catch(() => null) }
}

// 당도계 사진: 예시 데이터에서 쓰는 "[예시] 당도계 사진 자리" 그림을 PNG로 바꿔 올린다 (진짜 측정 사진처럼 보이지 않게).
// 판매자가 당도를 적은 상품은 이 사진이 있어야 관리자가 승인할 수 있다
const BRIX_PHOTO = await sharp(fileURLToPath(new URL('../public/product-photos/brix-example.svg', import.meta.url))).png().toBuffer()
async function upload(who, path, buffer, type) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': type, 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.79.${Math.floor(ip / 250)}.${ip % 250 + 1}`, Cookie: who.cookie },
    body: buffer,
    signal: AbortSignal.timeout(20_000),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}

// 비밀번호: 영문 대소문자·숫자·기호를 섞은 20자 (가입 화면의 비밀번호 규칙을 넘게)
const newPassword = () => `Yj!${randomBytes(12).toString('base64url')}9a`
const readAccounts = () => (existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {})
function saveAccount(login, password, farmName) {
  const all = readAccounts()
  all[login] = { farmName, password, note: '예시 농가 계정 (npm run onboard-farms). 저장소에 올리지 않는다' }
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  chmodSync(ACCOUNTS_FILE, 0o600)
}

const log = []
const note = (farm, step, result, ok = true) => {
  log.push({ farm, step, result, ok })
  console.log(`${ok ? '✓' : '✗'} ${farm} · ${step} — ${result}`)
}

const adminLogin = `ob_admin_${randomBytes(3).toString('hex')}`
const adminPassword = newPassword()
let exitCode = 0
const counts = { signedUp: 0, resumed: 0, skipped: 0, products: 0, auto: 0, reviewed: 0, failed: 0, questions: 0, answered: 0 }
try {
  // 예전 방식(CSV)으로 넣었던 시뮬레이션 농가·상품이 DB에 남아 있으면 지운다 (같은 상품 코드를 가입한 농가가 다시 올린다).
  // 주문 기록이 있는 상품은 지우지 않는다
  const old = await db.query(`SELECT product_code FROM products p WHERE p.source LIKE $1
    AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_code = p.product_code)`, [`${PLAN.source}%`])
  const oldCodes = old.rows.map((r) => r.product_code)
  if (oldCodes.length) {
    for (const table of ['questions', 'product_changes', 'product_options', 'reviews']) await db.query(`DELETE FROM ${table} WHERE product_code = ANY($1)`, [oldCodes])
    await db.query('DELETE FROM rag_chunks WHERE product_code = ANY($1)', [oldCodes])
    await db.query('DELETE FROM products WHERE product_code = ANY($1)', [oldCodes])
    const sellers = await db.query(`DELETE FROM sellers s WHERE s.source LIKE $1 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.seller_code = s.seller_code) RETURNING seller_code`, [`${PLAN.source}%`])
    note('준비', '예전 CSV 시뮬레이션 줄 정리', `상품 ${oldCodes.length}개, 농가 ${sellers.rowCount}곳 지움`)
  }

  // --reset: 계획에 있는 예시 농가(가입 아이디)와 그 농가 상품·문의를 지우고 처음부터 다시 가입한다 (주문 기록이 있는 농가는 건드리지 않는다)
  if (process.argv.includes('--reset')) {
    const logins = PLAN.farms.map((f) => f.login)
    const { rows } = await db.query(`SELECT a.login_id, a.seller_code FROM admins a WHERE a.login_id = ANY($1)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.seller_code = a.seller_code)`, [logins])
    const sellerCodes = rows.map((r) => r.seller_code)
    const codes = (await db.query('SELECT product_code FROM products WHERE seller_code = ANY($1)', [sellerCodes])).rows.map((r) => r.product_code)
    for (const table of ['questions', 'product_changes', 'product_options', 'reviews', 'rag_chunks']) await db.query(`DELETE FROM ${table} WHERE product_code = ANY($1)`, [codes])
    await db.query('DELETE FROM products WHERE product_code = ANY($1)', [codes])
    await db.query('DELETE FROM access_logs WHERE login_id = ANY($1)', [rows.map((r) => r.login_id)])
    await db.query('DELETE FROM admins WHERE login_id = ANY($1)', [rows.map((r) => r.login_id)])
    await db.query('DELETE FROM sellers WHERE seller_code = ANY($1)', [sellerCodes])
    const all = readAccounts()
    for (const r of rows) delete all[r.login_id]
    writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
    note('준비', '처음부터 다시 (--reset)', `농가 ${rows.length}곳, 상품 ${codes.length}개 지움`)
  }

  child = await startBackend()
  // 승인만 하는 임시 관리자 (끝나면 지운다. 승인 기록에는 이 아이디가 남는다)
  await db.query("INSERT INTO admins (login_id, password_hash, role) VALUES ($1, $2, 'admin')", [adminLogin, await hashPassword(adminPassword)])
  const admin = {}
  const adminIn = await call(admin, 'POST', '/admin/login', { loginId: adminLogin, password: adminPassword })
  if (adminIn.status !== 200) throw new Error(`관리자 로그인 실패 ${adminIn.status}`)

  // 회사가 처음부터 등록해 둔 농가(data/sellers.csv)는 가입 신청을 거치지 않았다. 계정이 없으면 관리자가 계정을 만들어 준다
  // (npm run create-admin -- 아이디 --seller 농가코드 와 같은 방식)
  const LEGACY = { farm_pear: 'naju_pear', farm_peach: 'yeongcheon_peach', farm_sweet_potato: 'yeoju_goguma', farm_potato: 'cheorwon_potato', farm_green: 'gujwa_carrot' }
  for (const [code, loginId] of Object.entries(LEGACY)) {
    const { rows: [s] } = await db.query(`SELECT s.name, EXISTS (SELECT 1 FROM admins a WHERE a.seller_code = s.seller_code) AS has_login,
      EXISTS (SELECT 1 FROM admins a WHERE a.login_id = $2) AS id_taken FROM sellers s WHERE s.seller_code = $1`, [code, loginId])
    if (!s || s.has_login || s.id_taken) continue
    const password = newPassword()
    await db.query("INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, 'seller', $3)", [loginId, await hashPassword(password), code])
    saveAccount(loginId, password, s.name)
    const me = {}
    const login = await call(me, 'POST', '/admin/login', { loginId, password })
    const own = (await call(me, 'GET', '/seller/products')).data ?? []
    note(s.name.replace('[예시] ', ''), '기존 농가 계정 만들기', `로그인 ${login.status}, 내 상품 ${own.length}개 보임`, login.status === 200 && own.length > 0)
  }

  const existing = new Set((await db.query("SELECT login_id FROM admins WHERE role = 'seller'")).rows.map((r) => r.login_id))
  const saved = readAccounts()
  for (const farm of PLAN.farms) {
    const name = farm.farmName.replace('[예시] ', '')
    let password = saved[farm.login]?.password
    if (existing.has(farm.login)) {
      // 이미 가입했으면 저장해 둔 계정으로 이어서 한다 (지난번에 못 올린 상품·문의만)
      if (!password) {
        counts.skipped += 1
        note(name, '가입', '이미 가입한 아이디인데 저장된 비밀번호가 없어 건너뜀', false)
        continue
      }
      counts.resumed += 1
    } else {
      // 1) 가입 신청
      password = newPassword()
      const signup = await call(null, 'POST', '/seller-signup', {
        loginId: farm.login, password, farmName: farm.farmName, region: farm.region, ownerName: farm.ownerName,
        phone: farm.phone, businessNo: farm.businessNo, email: farm.email, agreeTerms: true, agreePrivacy: true,
      })
      if (signup.status !== 201) {
        counts.failed += 1
        note(name, '가입 신청', `${signup.status} ${signup.data?.error ?? ''}`, false)
        continue
      }
      saveAccount(farm.login, password, farm.farmName)
      counts.signedUp += 1
    }
    const { rows: [seller] } = await db.query('SELECT a.seller_code, s.status FROM admins a JOIN sellers s USING (seller_code) WHERE a.login_id = $1', [farm.login])
    if (seller.status === 'pending') {
      // 승인 전에는 로그인해도 상품을 못 올린다
      const before = {}
      await call(before, 'POST', '/admin/login', { loginId: farm.login, password })
      const early = await call(before, 'POST', '/seller/products', { name: '시험', price: '1000', unit: '1개', stock: '1', item_code: 'apple' })
      note(name, '가입 신청', `상태 ${seller.status}, 승인 전 상품 등록 ${early.status}`, early.status === 403)
      // 2) 관리자 승인
      const approve = await call(admin, 'POST', `/admin/sellers/${seller.seller_code}/approve`)
      note(name, '관리자 승인', `${approve.status}`, approve.status === 200)
    }

    // 3) 농가 로그인 → 소개
    const me = {}
    const login = await call(me, 'POST', '/admin/login', { loginId: farm.login, password })
    const profile = await call(me, 'PATCH', '/seller/profile', { intro: farm.intro, story: farm.story })
    note(name, '로그인·농가 소개', `로그인 ${login.status}, 소개 저장 ${profile.status}`, login.status === 200 && profile.status === 200)
    if (login.status !== 200) {
      counts.failed += 1
      continue
    }
    const have = new Set((await db.query('SELECT product_code FROM products WHERE seller_code = $1', [seller.seller_code])).rows.map((r) => r.product_code))

    // 4) 상품 등록 → 검토 요청
    const mine = PLAN.products.filter((p) => p.login === farm.login && !have.has(p.product_code))
    const results = []
    let auto = 0
    let reviewed = 0
    const why = new Set()
    for (const p of mine) {
      const { login: _l, ...body } = p
      const created = await call(me, 'POST', '/seller/products', { ...body, price: String(p.price), stock: String(p.stock), options: p.options.map((o) => ({ ...o, price: String(o.price), stock: String(o.stock) })), status: 'pending' })
      if (created.status !== 201) {
        counts.failed += 1
        results.push(`${p.name}: 등록 ${created.status} ${created.data?.error ?? ''}`)
        continue
      }
      if (p.brix) {
        const photo = await upload(me, `/seller/products/${p.product_code}/image?role=brix`, BRIX_PHOTO, 'image/png')
        if (photo.status !== 200) results.push(`${p.name}: 당도계 사진 ${photo.status} ${photo.data?.error ?? ''}`)
      }
      const submitted = await call(me, 'POST', `/seller/products/${p.product_code}/submit`)
      counts.products += 1
      if (submitted.data?.status === 'active') {
        auto += 1
        continue
      }
      // 5) 관리자 검토: 사유를 보고 승인 (검수 전 품목·당도계 사진 없음·처음 상품 3개)
      for (const r of submitted.data?.reasons ?? []) why.add(r.replace(/\s*\(지금까지 \d+개 승인\)/, ''))
      const ok = await call(admin, 'PATCH', `/admin/products/${p.product_code}`, { status: 'active' })
      if (ok.status === 200) reviewed += 1
      else {
        counts.failed += 1
        results.push(`${p.name}: 관리자 승인 ${ok.status} ${ok.data?.error ?? ''}`)
      }
    }
    counts.auto += auto
    counts.reviewed += reviewed
    if (mine.length) {
      note(name, '상품 등록', `${mine.length}개 중 바로 판매 ${auto}개, 관리자 검토 뒤 판매 ${reviewed}개${results.length ? ` · 실패: ${results.join(' / ')}` : ''}`, results.length === 0)
      if (why.size) note(name, '관리자 검토 이유', [...why].join(' / '))
    }

    // 6) 손님 문의 → 농가 답변 (이미 남긴 문의는 건너뛴다)
    const askedBefore = new Set((await db.query('SELECT product_code || $2 || question AS k FROM questions q JOIN products p USING (product_code) WHERE p.seller_code = $1', [seller.seller_code, '\u0001'])).rows.map((r) => r.k))
    const asked = PLAN.questions.filter((q) => PLAN.products.some((p) => p.login === farm.login && p.product_code === q.product_code) && !askedBefore.has(`${q.product_code}\u0001${q.question}`))
    let answered = 0
    let posted = 0
    for (const q of asked) {
      const sent = await call(null, 'POST', `/products/${q.product_code}/questions`, { author: q.author, question: q.question })
      if (sent.status !== 201) {
        counts.failed += 1
        note(name, '손님 문의', `${q.product_code}: ${sent.status} ${sent.data?.error ?? ''}`, false)
        continue
      }
      posted += 1
      if (!q.answer) continue
      const list = (await call(me, 'GET', '/seller/questions')).data ?? []
      const target = list.find((x) => x.product_code === q.product_code && x.question === q.question && !x.answer)
      const reply = target && await call(me, 'PATCH', `/seller/questions/${target.id}`, { answer: q.answer })
      if (reply?.status === 200) answered += 1
    }
    counts.questions += posted
    counts.answered += answered
    if (asked.length) note(name, '손님 문의·농가 답변', `문의 ${posted}개, 농가 답변 ${answered}개, 답변 대기 ${posted - answered}개`, posted === asked.length)
  }
} catch (error) {
  console.error(`가입 시뮬레이션 중단: ${error.stack}`)
  exitCode = 1
} finally {
  child?.kill()
  try {
    await db.query('DELETE FROM access_logs WHERE login_id = $1', [adminLogin])
    await db.query('DELETE FROM admins WHERE login_id = $1', [adminLogin])
  } catch (error) {
    console.error(`임시 관리자 정리 실패: ${error.message}`)
    exitCode = 1
  }
}

const accounts = readAccounts()
const cell = (s) => String(s).replace(/\|/g, '\\|')
writeFileSync(REPORT, `# 예시 농가 가입 시뮬레이션

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · \`npm run onboard-farms\` · 계획 \`data/sample_farms.json\` (씨앗 \`${PLAN.seed}\`)
- 가입 ${counts.signedUp}곳 (이미 가입해서 이어서 한 농가 ${counts.resumed}곳, 건너뜀 ${counts.skipped}곳), 상품 ${counts.products}개 (바로 판매 ${counts.auto}개, 관리자 검토 뒤 판매 ${counts.reviewed}개), 실패 ${counts.failed}건
- 손님 문의 ${counts.questions}개, 농가 답변 ${counts.answered}개
- 농가 계정 ${Object.keys(accounts).length}개의 비밀번호는 서버의 \`.farm-accounts.local.json\`(본인만 읽기, 저장소에 올리지 않음)에 있다
- 모든 값은 예시다. 사업자등록번호는 999로 시작하는 가짜 번호, 이메일은 example.com이다

## 흐름

1. 농가가 판매자 가입 신청 (\`POST /api/seller-signup\`): 아이디, 비밀번호, 농가 이름, 지역, 대표자, 연락처, 사업자등록번호, 이메일, 약관 동의
2. 승인 전에는 상품을 올릴 수 없는지 확인
3. 관리자가 승인 (\`POST /api/admin/sellers/:code/approve\`) → 승인 메일이 대기열에 들어감
4. 농가가 로그인해서 농가 소개를 쓰고, 상품을 올려 검토를 요청
5. 서버의 자동 승인 규칙: 처음 상품 ${3}개, 검수 전 품목, 당도계 사진 없는 상품은 관리자가 확인. 그 밖에는 바로 판매
6. 관리자가 검토할 상품을 승인 (실제로는 사유를 보고 사진을 다시 받거나 반려할 수 있다)
7. 손님이 상품 문의를 남기고, 농가가 [문의 답변]에서 답한다

## 기록

| 농가 | 단계 | 결과 | 판정 |
|---|---|---|---|
${log.map((l) => `| ${cell(l.farm)} | ${cell(l.step)} | ${cell(l.result)} | ${l.ok ? '맞음' : '어긋남'} |`).join('\n')}

## 한계

- 관리자는 검토할 상품을 모두 승인했다. 당도계 사진을 받지 않았으니 당도 등급은 붙지 않는다
- 가입 승인 메일은 메일 서버가 없어 대기열에만 남는다
- 상품 사진은 올리지 않았다
`)
console.log(`\n가입 ${counts.signedUp} · 이어서 ${counts.resumed} · 건너뜀 ${counts.skipped} · 상품 ${counts.products} (바로 ${counts.auto}, 검토 ${counts.reviewed}) · 실패 ${counts.failed} · 문의 ${counts.questions}/${counts.answered} → docs/farm_onboarding.md`)
await db.end()
process.exit(exitCode || (counts.failed ? 1 : 0))
