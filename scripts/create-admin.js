// 관리자 계정 만들기 (또는 비밀번호 바꾸기)
//   npm run create-admin -- 아이디
// 비밀번호는 실행하면 물어본다. 화면에 비밀번호가 보이니 주변을 확인하세요.
import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../server/auth.js'
import { initDb, pool } from '../server/db.js'

const loginId = process.argv[2]
if (!loginId || !/^[a-z0-9_]{3,20}$/.test(loginId)) {
  console.error('아이디를 영문 소문자·숫자·밑줄 3~20자로 적어 주세요. 예: npm run create-admin -- farm_admin')
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
await pool.query(
  `INSERT INTO admins (login_id, password_hash) VALUES ($1, $2)
   ON CONFLICT (login_id) DO UPDATE SET password_hash = $2`,
  [loginId, await hashPassword(password)],
)
console.log(`관리자 "${loginId}"를 저장했어요.`)
await pool.end()
