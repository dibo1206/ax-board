// 찜한 상품·단골 농가 목록 (2026-11-20): 켜진 목록은 한 번만 받아 두고(getSaved) 누를 때마다 서버에 담기·빼기를 보낸 뒤
// 'saved-change' 이벤트로 다른 버튼도 맞춘다. 로그인하지 않았으면 로그인 화면으로 보내고, 로그인하면 보던 화면으로 돌아온다
import { useEffect, useState } from 'react'
import { get, send } from './shared.js'

let savedPromise
export function getSaved() {
  savedPromise ??= get('/account/saved')
    .then((s) => ({ products: new Set(s.products), farms: new Set(s.farms) }))
    .catch(() => null) // 로그인하지 않았으면 null
  return savedPromise
}
if (typeof window !== 'undefined') window.addEventListener('account-change', () => { savedPromise = null })

const goLogin = () => {
  const here = window.location.pathname + window.location.search
  window.location.href = `/account/login?next=${encodeURIComponent(here)}`
}

// 켜짐 여부 훅: kind 는 'products' | 'farms'
export function useSaved(kind, code) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    const read = () => getSaved().then((s) => { if (alive) setOn(Boolean(s?.[kind].has(code))) })
    read()
    window.addEventListener('saved-change', read)
    return () => { alive = false; window.removeEventListener('saved-change', read) }
  }, [kind, code])
  return on
}

// 담기·빼기. 성공하면 true(켜짐)/false(꺼짐), 로그인 안 했으면 로그인 화면으로
export async function toggle(kind, code) {
  const saved = await getSaved()
  if (!saved) { goLogin(); return null }
  const set = saved[kind]
  const path = kind === 'products' ? '/account/wishlist' : '/account/follows'
  const turnOn = !set.has(code)
  try {
    await send(turnOn ? 'PUT' : 'DELETE', `${path}/${encodeURIComponent(code)}`)
  } catch (e) {
    if (e.status === 401) { savedPromise = null; goLogin(); return null }
    window.alert(e.message)
    return set.has(code)
  }
  if (turnOn) set.add(code)
  else set.delete(code)
  window.dispatchEvent(new Event('saved-change'))
  return turnOn
}
