import { useState } from 'react'

// 긴 목록을 한 번에 그리지 않고 size 개씩 나눠 보여 준다 (2026-11-08 관리자 화면 정리).
// resetKey(걸러 보기·검색어·새로 받은 목록 등)가 바뀌면 첫 쪽으로 돌아간다 (쪽 번호를 그 key와 함께 기억)
export function usePage(items, size = 20, resetKey = '') {
  const [saved, setSaved] = useState({ key: resetKey, page: 1 })
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(saved.key === resetKey ? saved.page : 1, pages)
  const setPage = (page) => setSaved({ key: resetKey, page })
  return { rows: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length, size, setPage }
}
