import { statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 개발 서버는 프로젝트 폴더의 파일을 주소로 그대로 보여 준다. 화면에 필요 없는 서버 코드·데이터·문서·키 파일은 404로 막는다
const PRIVATE = /^\/(\.env|\.git|server\/|scripts\/|data\/|docs\/|package(-lock)?\.json$|README\.md$|CLAUDE\.md$)/

// Vite 는 /@fs/절대경로 로도 파일을 보여 준다(같은 서버의 다른 사용자도 이 포트에 접속할 수 있다).
// 그래서 주소를 실제 파일 위치로 바꿔 보고, 화면용 폴더(src·public·node_modules)와 index.html 밖의 파일이면 막는다
const ROOT = process.cwd()
const SERVABLE = ['src', 'public', 'node_modules'].map((dir) => resolve(ROOT, dir) + sep)
function exposesFile(path) {
  const target = path.startsWith('/@fs/') ? resolve(path.slice(4)) : resolve(ROOT, `.${path}`)
  if (target === resolve(ROOT, 'index.html') || SERVABLE.some((dir) => target.startsWith(dir))) return false
  try {
    return statSync(target).isFile()
  } catch {
    return false // 없는 파일 = 화면 주소(/cart 등)라서 Vite 가 index.html 을 보낸다
  }
}

function blockPrivateFiles() {
  return {
    name: 'block-private-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path = (req.url ?? '').split('?')[0]
        try {
          path = decodeURIComponent(path)
        } catch {
          res.statusCode = 400
          return res.end()
        }
        const clean = path.replace(/\/{2,}/g, '/')
        if (PRIVATE.test(clean) || exposesFile(clean)) {
          res.statusCode = 404
          return res.end()
        }
        next()
      })
    },
  }
}

// 화면은 $PORT, 백엔드는 $PORT + 100. 화면의 /api 요청을 백엔드로 넘긴다.
// 넘길 때 .env의 PROXY_SECRET을 머리글로 붙인다 (백엔드는 이게 없는 직접 접속을 막는다). 이 값은 화면 코드에 들어가지 않는다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(process.env.PORT || 3066)
  const target = `http://127.0.0.1:${port + 100}`
  const headers = env.PROXY_SECRET ? { 'x-proxy-secret': env.PROXY_SECRET } : {}
  return {
    plugins: [blockPrivateFiles(), react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true, xfwd: true, headers },
        '/uploads': { target, changeOrigin: true, headers },
        '/robots.txt': { target, changeOrigin: true, xfwd: true, headers },
        '/sitemap.xml': { target, changeOrigin: true, xfwd: true, headers },
      },
    },
  }
})
