import { useEffect, useState } from 'react'
import { get, thumbUrl, won } from './shared.js'

// 없는 주소·내려간 상품 (2026-11-09 배포 전 정리). 전에는 없는 주소면 첫 화면이 그대로 나오고,
// 지운 상품 링크는 "상품을 찾지 못했어요." 한 줄만 나왔다 → 무엇이 없는지 알리고, 찾기 칸·갈 곳·지금 인기 상품을 보여 준다.
// 서버(배포 모드)는 이런 주소에 404를 보내서 검색엔진에도 없는 페이지로 알린다 (server/web.js pageHead)
const COPY = {
  page: ['찾으시는 페이지가 없어요', '주소가 바뀌었거나 잘못 입력됐을 수 있어요. 아래에서 찾아보세요.'],
  product: ['판매가 끝났거나 내려간 상품이에요', '같은 품목의 다른 상품이 있을 수 있어요. 아래에서 찾아보거나 지금 인기 있는 상품을 둘러보세요.'],
  farm: ['찾으시는 농가가 없어요', '판매를 쉬고 있거나 주소가 바뀌었을 수 있어요. 농가 모아보기에서 다른 농가를 둘러보세요.'],
}

export function NotFound({ kind = 'page', onOpen }) {
  const [title, text] = COPY[kind] ?? COPY.page
  const [q, setQ] = useState('')
  const [popular, setPopular] = useState([])

  useEffect(() => {
    const before = document.title
    document.title = `${title} · YOONJU MARKET`
    // 검색엔진이 화면을 읽을 때도 색인하지 않게
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.appendChild(robots)
    get(`/catalog?${new URLSearchParams({ sort: 'popular', size: 4 })}`).then((r) => setPopular(r.items ?? [])).catch(() => {})
    return () => { document.title = before; robots.remove() }
  }, [title])

  const open = (code) => {
    if (onOpen) onOpen(code)
    else window.location.assign(`/p/${encodeURIComponent(code)}`)
  }

  return (
    <section className="notfound" aria-labelledby="notfound-title">
      <span className="notfound-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48"><circle cx="21" cy="21" r="12" /><path d="m30 30 9 9M17 17l8 8M25 17l-8 8" /></svg>
      </span>
      <h1 id="notfound-title">{title}</h1>
      <p className="muted">{text}</p>
      <form className="notfound-search" role="search" onSubmit={(e) => { e.preventDefault(); window.location.assign(q.trim() ? `/products?${new URLSearchParams({ q: q.trim() })}` : '/products') }}>
        <label htmlFor="notfound-q" className="sr-only">상품 찾기</label>
        <input id="notfound-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="무엇을 찾으세요?" maxLength={50} />
        <button type="submit">찾기</button>
      </form>
      <div className="notfound-links">
        <a className="notfound-go" href="/">첫 화면으로</a>
        <a className="notfound-ghost" href={kind === 'farm' ? '/farms' : '/products'}>{kind === 'farm' ? '농가 모아보기' : '상품 전체 보기'}</a>
      </div>
      {popular.length > 0 && (
        <div className="notfound-popular">
          <h2>지금 인기 있는 상품</h2>
          <ul>
            {popular.map((p) => (
              <li key={p.product_code}>
                <a href={`/p/${encodeURIComponent(p.product_code)}`} onClick={(e) => { e.preventDefault(); open(p.product_code) }}>
                  {p.image_url ? <img src={thumbUrl(p.image_url)} alt="" width="160" height="160" loading="lazy" /> : <span className="notfound-ph" />}
                  <strong>{p.name}</strong>
                  <span>{won(p.price)}{p.has_options ? '부터' : ''}{p.sold_out ? ' · 품절' : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
