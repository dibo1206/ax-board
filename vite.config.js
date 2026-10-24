import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 개발 서버는 프로젝트 폴더의 파일을 주소로 그대로 보여 준다. 화면에 필요 없는 서버 코드·데이터·문서·키 파일은 404로 막는다
const PRIVATE = /^\/(\.env|\.git|server\/|scripts\/|data\/|docs\/|package(-lock)?\.json$|README\.md$|CLAUDE\.md$)/

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
        if (PRIVATE.test(path.replace(/\/{2,}/g, '/'))) {
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
      },
    },
  }
})
