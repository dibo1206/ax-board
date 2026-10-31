// Codespaces 에서 편집기 창이 붙을 때마다 (postAttachCommand): 쇼핑몰이 켜질 때까지 기다렸다가 주소와 여는 방법을 보여 준다
// 쇼핑몰은 컨테이너 지킴이(.devcontainer/docker-compose.yml 의 app command)가 뒤에서 켜 둔다 → 터미널을 닫아도 꺼지지 않는다
// 브라우저 새 창이 팝업 차단으로 안 열려도 [포트] 탭에서 열 수 있게 안내한다. 1분 넘게 안 켜지면 여기서 직접 켠다
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const LOG = '/tmp/farm-mall-demo.log'
// 화면(Vite)이 먼저 켜지고 백엔드는 DB 준비 뒤에 켜진다 → 둘 다 응답할 때 "켜졌어요"
const ok = (url) => fetch(url).then((r) => r.ok).catch(() => false)
const up = async () => (await ok('http://127.0.0.1:3066/')) && ok('http://127.0.0.1:3066/api/products')

function address() {
  const name = process.env.CODESPACE_NAME
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  if (name && domain) return `https://${name}-3066.${domain}`
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
  return env.match(/^PUBLIC_URL=(.+)$/m)?.[1] ?? 'http://localhost:3066'
}

console.log('[쇼핑몰] 켜지는 중인지 확인하고 있어요…')
let ready = false
for (let i = 0; i < 60 && !ready; i += 1) {
  ready = await up()
  if (!ready) await new Promise((r) => setTimeout(r, 1000))
}

if (ready) {
  console.log(`
============================================================
 쇼핑몰이 켜졌어요 → ${address()}
 - 새 창이 자동으로 안 열리면(팝업 차단): 아래 [포트(PORTS)] 탭 → 3066 "쇼핑몰 화면" 줄 → 지구본 아이콘
 - 처음 열 때 깃허브 로그인 화면이 나오면 이 Codespace 를 만든 계정으로 로그인하세요
 - 관리자 화면: 주소 뒤에 /admin  ·  판매자 화면: /seller
============================================================
`)
} else {
  // 뒤에서 켜기가 실패했으면 기록을 보여 주고 여기서 직접 켠다 (이 터미널을 닫으면 꺼진다)
  console.log(`[쇼핑몰] 1분이 지나도 안 켜져서 여기서 직접 켤게요. 이전 기록(${LOG}):`)
  if (existsSync(LOG)) console.log(readFileSync(LOG, 'utf8').split('\n').slice(-15).join('\n'))
  console.log(`잠시 뒤 주소: ${address()} (안 열리면 [포트] 탭 → 3066 → 지구본 아이콘)`)
  spawn('npm', ['run', 'demo'], { stdio: 'inherit' })
}
