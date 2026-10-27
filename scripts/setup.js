// 처음 한 번: .env 만들기 (npm run setup). 이미 .env 가 있으면 건드리지 않는다
// 비밀값(SESSION_SECRET·DATA_KEY·PROXY_SECRET)은 이 컴퓨터에서 새로 만든다 → 다른 사람과 같은 값을 쓰지 않는다
// DB 주소: 환경변수 DATABASE_URL 이 있으면 그것, 없으면 postgres:postgres@localhost (Codespaces 의 DB)
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../.env', import.meta.url)
if (existsSync(file)) {
  console.log('[setup] .env 가 이미 있어요. 그대로 둡니다.')
  process.exit(0)
}

const hex = (bytes) => randomBytes(bytes).toString('hex')
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: DOMAIN } = process.env
const values = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/farm_mall',
  PORT: '3066',
  SESSION_SECRET: hex(32),
  DATA_KEY: hex(32),
  PROXY_SECRET: hex(24),
  // Codespaces 에서는 브라우저 주소가 https://<이름>-3066.<도메인> 이라 그 주소를 우리 주소로 알려 준다 (요청 출처 확인에 쓰임)
  PUBLIC_URL: CODESPACE_NAME && DOMAIN ? `https://${CODESPACE_NAME}-3066.${DOMAIN}` : 'http://localhost:3066',
}

// .env.sample 의 빈 칸(NAME=)을 채우고, 샘플에 없는 이름은 끝에 붙인다
let text = readFileSync(new URL('../.env.sample', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => {
    const name = line.match(/^([A-Z0-9_]+)=$/)?.[1]
    return name && name in values ? `${name}=${values[name]}` : line
  })
  .join('\n')
for (const [name, value] of Object.entries(values)) {
  if (!new RegExp(`^${name}=`, 'm').test(text)) text += `\n${name}=${value}`
}
writeFileSync(file, `${text.trimEnd()}\n`, { mode: 0o600 })
console.log(`[setup] .env 를 만들었어요. 쇼핑몰 주소: ${values.PUBLIC_URL}`)
