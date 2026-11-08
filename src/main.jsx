import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { netFetch } from './net.js'
import { applySiteContent } from './shop/home/content.js'

// 관리자가 [홈페이지 관리]에서 고친 첫 화면 글·사진을 먼저 받아 기본값을 바꾼 뒤 그린다 (1.5초 안에 못 받으면 기본값으로)
const saved = await Promise.race([
  netFetch('/api/site-content').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
])
applySiteContent(saved)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
