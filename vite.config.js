import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 화면은 $PORT, 백엔드는 $PORT + 100. 화면의 /api 요청을 백엔드로 넘긴다.
const port = Number(process.env.PORT || 3066)

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${port + 100}`, changeOrigin: true, xfwd: true },
      '/uploads': { target: `http://127.0.0.1:${port + 100}`, changeOrigin: true },
    },
  },
})
