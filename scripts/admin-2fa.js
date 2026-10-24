// 관리자·판매자 계정의 2단계 인증(인증 앱) 등록·해제
//   npm run admin-2fa -- 아이디            등록 (화면에 나온 비밀값을 인증 앱에 넣고, 앱의 6자리 코드를 입력해 확인)
//   npm run admin-2fa -- 아이디 --off      해제
// 비밀값은 화면에만 한 번 보이고, DB에는 DATA_KEY로 암호화해서 저장한다. 주변에 화면이 보이지 않는지 확인하세요.
import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { encrypt, newTotpSecret, otpauthUri, verifyTotp } from '../server/crypto.js'
import { initDb, pool } from '../server/db.js'

const [loginId, flag] = process.argv.slice(2)
if (!loginId) {
  console.error('사용법: npm run admin-2fa -- 아이디  (해제: npm run admin-2fa -- 아이디 --off)')
  process.exit(1)
}

await initDb()
const { rows } = await pool.query('SELECT id FROM admins WHERE login_id = $1', [loginId])
if (!rows.length) {
  console.error(`계정 "${loginId}"이(가) 없어요.`)
  await pool.end()
  process.exit(1)
}

if (flag === '--off') {
  await pool.query('UPDATE admins SET totp_secret_enc = NULL, totp_last_counter = 0 WHERE id = $1', [rows[0].id])
  console.log(`"${loginId}"의 2단계 인증을 해제했어요.`)
  await pool.end()
  process.exit(0)
}

const secret = newTotpSecret()
console.log('\n1) 휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator 등)에서 "설정 키 입력"을 고르고 아래 값을 넣으세요.')
console.log(`   계정 이름: farm-mall:${loginId}`)
console.log(`   키: ${secret.match(/.{1,4}/g).join(' ')}`)
console.log(`   (QR 코드 만들기용 주소: ${otpauthUri(loginId, secret)})\n`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const code = (await rl.question('2) 앱에 나온 6자리 코드를 입력하세요: ')).replace(/\s/g, '')
rl.close()

const counter = verifyTotp(secret, code)
if (counter === null) {
  console.error('코드가 맞지 않아요. 등록하지 않았어요. 휴대폰 시간이 자동으로 맞춰져 있는지 확인하고 다시 해 주세요.')
  await pool.end()
  process.exit(1)
}
await pool.query('UPDATE admins SET totp_secret_enc = $1, totp_last_counter = $2 WHERE id = $3', [encrypt(secret), counter, rows[0].id])
console.log(`"${loginId}"에 2단계 인증을 등록했어요. 다음 로그인부터 인증 앱 코드가 필요해요.`)
await pool.end()
