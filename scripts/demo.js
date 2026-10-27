// 화면(Vite)과 백엔드를 한 번에 켜기 (npm run demo). Ctrl+C 를 누르면 둘 다 꺼진다
// 실습서버처럼 터미널 2개(npm run server / npm run dev)를 열지 않아도 된다
import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
]
console.log('[demo] 화면과 백엔드를 켜는 중… 잠시 뒤 브라우저에서 http://localhost:3066 (Codespaces 는 자동으로 열려요)')

let stopping = false
function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
// 하나가 멈추면(오류 등) 다른 하나도 끈다
for (const child of children) child.on('exit', (code) => stopAll(code ?? 0))
