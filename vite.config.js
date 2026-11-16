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
// 올린 사진 폴더(uploads/)는 Vite 가 직접 보여 주지 않고 아래 proxy 로 백엔드에 넘긴다 (백엔드가 그림 전용 머리글을 붙여 보냄).
// 전에는 이 폴더도 '화면용 폴더 밖 파일'로 막혀서 개발 화면에서만 올린 사진·당도계 사진이 404였다 (2026-11-16)
const UPLOADS = resolve(ROOT, 'uploads') + sep
function exposesFile(path) {
  const target = path.startsWith('/@fs/') ? resolve(path.slice(4)) : resolve(ROOT, `.${path}`)
  if (target === resolve(ROOT, 'index.html') || SERVABLE.some((dir) => target.startsWith(dir))) return false
  if (!path.startsWith('/@fs/') && target.startsWith(UPLOADS)) return false
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
  const port = Number(process.env.PORT || env.PORT || 3066) // 집 컴퓨터는 .env 의 PORT
  const target = `http://127.0.0.1:${port + 100}`
  const headers = env.PROXY_SECRET ? { 'x-proxy-secret': env.PROXY_SECRET } : {}
  return {
    plugins: [blockPrivateFiles(), react()],
    server: {
      port,
      strictPort: true,
      // Codespaces 의 포트 연결은 컨테이너 밖에서 들어온다. 127.0.0.1 로만 받으면 [포트] 탭 주소가 연결을 거부당한다
      // 공용 실습 서버에서는 다른 계정이 들어오지 못하게 지금처럼 이 컴퓨터 안에서만 받는다
      host: process.env.CODESPACES === 'true' || /\.app\.github\.dev/.test(env.PUBLIC_URL ?? '') ? true : undefined,
      // Vite 는 모르는 주소로 들어온 요청을 막는다. Codespaces 처럼 https://<이름>-3066.app.github.dev 로 들어오는 경우
      // npm run setup 이 .env 에 적어 둔 PUBLIC_URL 의 주소를 허용한다 (환경변수가 안 넘어오는 터미널에서도 되게)
      allowedHosts: [
        env.PUBLIC_URL && new URL(env.PUBLIC_URL).hostname,
        process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN && `.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`,
      ].filter((host) => host && host !== 'localhost'),
      proxy: {
        '/api': { target, changeOrigin: true, xfwd: true, headers },
        '/uploads': { target, changeOrigin: true, headers },
        '/robots.txt': { target, changeOrigin: true, xfwd: true, headers },
        '/sitemap.xml': { target, changeOrigin: true, xfwd: true, headers },
      },
    },
  }
})
