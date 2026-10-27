// 관리자·판매자 계정 만들기 (또는 비밀번호 바꾸기)
//   npm run create-admin -- 아이디                       관리자
//   npm run create-admin -- 아이디 --seller 농가코드      판매자 (그 농가 상품만 관리)
// 비밀번호는 실행하면 물어본다. 화면에 비밀번호가 보이니 주변을 확인하세요.
import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../server/auth.js'
import { initDb, pool } from '../server/db.js'

const [loginId, flag, sellerCode] = process.argv.slice(2)
if (!loginId || !/^[a-z0-9_]{3,20}$/.test(loginId)) {
  console.error('아이디를 영문 소문자·숫자·밑줄 3~20자로 적어 주세요. 예: npm run create-admin -- farm_admin')
  process.exit(1)
}
if (flag && (flag !== '--seller' || !sellerCode)) {
  console.error('판매자 계정은 이렇게 만들어요: npm run create-admin -- 아이디 --seller 농가코드')
  process.exit(1)
}

let password = process.env.ADMIN_PASSWORD
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  password = await rl.question('비밀번호 (10자 이상): ')
  rl.close()
}
if (password.length < 10) {
  console.error('비밀번호는 10자 이상으로 정해 주세요.')
  process.exit(1)
}

await initDb()
if (sellerCode) {
  const { rows } = await pool.query('SELECT name FROM sellers WHERE seller_code = $1', [sellerCode])
  if (!rows.length) {
    const all = await pool.query('SELECT seller_code, name FROM sellers ORDER BY seller_code')
    console.error(`농가 코드 "${sellerCode}"가 없어요. 있는 농가: ${all.rows.map((r) => `${r.seller_code}(${r.name})`).join(', ')}`)
    await pool.end()
    process.exit(1)
  }
}
const role = sellerCode ? 'seller' : 'admin'
await pool.query(
  `INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, $3, $4)
   ON CONFLICT (login_id) DO UPDATE SET password_hash = $2, role = $3, seller_code = $4, session_version = admins.session_version + 1`, // 예전 로그인 끊기
  [loginId, await hashPassword(password), role, sellerCode ?? null],
)
console.log(sellerCode ? `판매자 "${loginId}"(${sellerCode})를 저장했어요. /seller 에서 로그인해요.` : `관리자 "${loginId}"를 저장했어요.`)
await pool.end()
