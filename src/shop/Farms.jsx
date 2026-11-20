import { useEffect, useState } from 'react'
import { ProductCard } from './home/Home.jsx'
import { NotFound } from './NotFound.jsx'
import { FollowButton } from './Saved.jsx'
import { get, getPolicy, thumbUrl, won } from './shared.js'

// 손님이 농가별로 보기 (2026-11-09)
//  · /farms        농가 모아보기: 지역으로 걸러 보기 · 이름·지역·품목 찾기 · 정렬 · 12곳씩 더 보기 (농가가 많아져도)
//  · /farm/농가코드 농가 페이지: 소개·이야기 + 그 농가의 판매 중 상품. 배송비는 주문 한 번에 한 번이라 무료 배송 기준도 알려 준다 (다른 농가 상품과 합쳐도 된다)
// 서버는 판매 중 상품이 있는 활동 중 농가만, 공개 칸(이름·지역·소개·이야기)만 보낸다 (server/index.js /api/farms)

const PAGE = 12
const clean = (name) => name.replace(/\[예시\]\s*/g, '')
// '경상남도 거창군 고제면' → '경상남도', '충남 천안시' → '충남' (지역 칸의 첫 낱말로 묶는다)
const province = (region) => (region ?? '').trim().split(/\s+/)[0] || '기타'
const SORTS = [
  ['products', '상품 많은 순', (a, b) => b.products - a.products],
  ['new', '새 상품 순', (a, b) => String(b.newest_at).localeCompare(String(a.newest_at))],
  ['name', '이름순', (a, b) => clean(a.name).localeCompare(clean(b.name), 'ko')],
]
const go = (path) => window.location.assign(path)

export function FarmsPage() {
  const [farms, setFarms] = useState(null)
  const [error, setError] = useState('')
  const [area, setArea] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('products')
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    const before = document.title
    document.title = '농가 모아보기 · YOONJU MARKET'
    get('/farms').then(setFarms).catch((e) => setError(e.message))
    return () => { document.title = before }
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!farms) return <p className="muted">불러오는 중…</p>

  const areas = [...new Set(farms.filter((f) => !f.is_company).map((f) => province(f.region)))].sort((a, b) => a.localeCompare(b, 'ko'))
  const q = query.trim()
  const list = farms
    .filter((f) => area === 'all' || province(f.region) === area)
    .filter((f) => !q || `${clean(f.name)} ${f.region ?? ''} ${(f.items ?? []).join(' ')}`.includes(q))
    .sort((a, b) => (b.is_company ? 1 : 0) - (a.is_company ? 1 : 0) || SORTS.find(([key]) => key === sort)[2](a, b))
  const reset = (fn) => (value) => { fn(value); setShown(PAGE) }

  return (
    <section className="farms">
      <nav className="pcrumbs" aria-label="현재 위치"><a href="/">홈</a><span aria-hidden="true">›</span><b>농가</b><span className="muted">(총 {farms.length}곳)</span></nav>
      <h2 className="plist-title">농가 모아보기</h2>
      <p className="muted farms-lead">이 쇼핑몰에 직접 상품을 올리는 농가예요. 농가를 누르면 그 농가의 이야기와 상품을 모아 볼 수 있어요.</p>

      <div className="farms-bar">
        <div className="farms-areas" role="group" aria-label="지역">
          <button type="button" className={area === 'all' ? 'on' : ''} aria-pressed={area === 'all'} onClick={() => reset(setArea)('all')}>전체</button>
          {areas.map((a) => <button key={a} type="button" className={area === a ? 'on' : ''} aria-pressed={area === a} onClick={() => reset(setArea)(a)}>{a}</button>)}
        </div>
        <div className="farms-tools">
          <label htmlFor="farms-q" className="sr-only">농가 찾기</label>
          <input id="farms-q" type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder="농가 이름·지역·품목" maxLength={30} />
          <select value={sort} onChange={(e) => reset(setSort)(e.target.value)} aria-label="정렬">
            {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {list.length === 0 ? <p className="muted farms-empty">맞는 농가가 없어요. 다른 지역이나 말로 찾아보세요.</p> : (
        <>
          <ul className="farm-grid">
            {list.slice(0, shown).map((f) => (
              <li key={f.seller_code}>
                <a className="farm-card" href={`/farm/${encodeURIComponent(f.seller_code)}`}>
                  <span className="farm-cover">
                    {f.image_url ? <img src={thumbUrl(f.image_url)} alt="" loading="lazy" width="400" height="300" /> : <span className="farm-cover-empty" />}
                    {f.is_company && <em className="farm-badge">회사 직영</em>}
                  </span>
                  <span className="farm-body">
                    <strong>{clean(f.name)}</strong>
                    <span className="farm-region">{f.region || '지역 정보 없음'}</span>
                    {f.intro && <span className="farm-intro">{f.intro}</span>}
                    {f.items?.length > 0 && <span className="farm-items">{f.items.slice(0, 4).map((it) => <i key={it}>{it}</i>)}</span>}
                    <span className="farm-foot"><b>상품 {f.products}개</b>{f.min_price > 0 && <span>{won(f.min_price)}부터</span>}<span aria-hidden="true">→</span></span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {shown < list.length && (
            <button type="button" className="btn-line more" onClick={() => setShown((n) => n + PAGE)}>농가 더 보기 ({shown}/{list.length})</button>
          )}
        </>
      )}
    </section>
  )
}

export function FarmPage({ code }) {
  const [farm, setFarm] = useState(null)
  const [error, setError] = useState('')
  const [policy, setPolicy] = useState(null)
  const [openStory, setOpenStory] = useState(false)

  useEffect(() => {
    get(`/farms/${encodeURIComponent(code)}`).then(setFarm).catch((e) => setError(e.status === 404 ? 'not-found' : e.message))
    getPolicy().then(setPolicy).catch(() => {})
  }, [code])

  useEffect(() => {
    if (!farm) return undefined
    const before = document.title
    document.title = `${clean(farm.name)} · YOONJU MARKET`
    return () => { document.title = before }
  }, [farm])

  if (error === 'not-found') return <NotFound kind="farm" />
  if (error) return <p className="error">{error}</p>
  if (!farm) return <p className="muted">불러오는 중…</p>

  const story = farm.story?.trim() ?? ''
  const longStory = story.length > 260
  const inStock = farm.products.filter((p) => !p.sold_out)
  const freeOver = policy?.shipping?.freeOver

  return (
    <section className="farm-page">
      <nav className="pcrumbs" aria-label="현재 위치"><a href="/">홈</a><span aria-hidden="true">›</span><a href="/farms">농가</a><span aria-hidden="true">›</span><b>{clean(farm.name)}</b></nav>
      <header className="farm-head">
        <div>
          <p className="farm-region">{farm.region}{farm.is_company && <em className="farm-badge inline">회사 직영</em>}</p>
          <h1>{clean(farm.name)}</h1>
          {farm.intro && <p className="farm-intro-lg">{farm.intro}</p>}
          <p className="farm-stats"><b>판매 중 상품 {farm.products.length}개</b>{inStock.length < farm.products.length && <span> · 품절 {farm.products.length - inStock.length}개</span>}</p>
          {/* 단골 맺기 (2026-11-20): 마이페이지 [단골 농가]에서 모아 본다 */}
          <FollowButton code={farm.seller_code} name={clean(farm.name)} count={farm.followers ?? 0} />
        </div>
        {freeOver > 0 && (
          <p className="farm-ship">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7zM7 19a1.8 1.8 0 1 0 0 .01M17 19a1.8 1.8 0 1 0 0 .01" /></svg>
            <span>다른 농가 상품과 합쳐 <b>{won(freeOver)} 이상</b> 담으면 배송비가 무료예요</span>
          </p>
        )}
      </header>

      {farm.photos?.length > 0 && (
        <div className="farm-photos">
          {farm.photos.map((url, n) => <img key={url} src={url} alt={`${clean(farm.name)} 농가 사진 ${n + 1}`} loading="lazy" />)}
        </div>
      )}

      {story && (
        <div className={`farm-story${longStory && !openStory ? ' folded' : ''}`}>
          <h2>농가 이야기</h2>
          <p>{story}</p>
          {longStory && <button type="button" className="link" onClick={() => setOpenStory((v) => !v)} aria-expanded={openStory}>{openStory ? '접기' : '이야기 더 보기'}</button>}
        </div>
      )}

      <h2 className="farm-products-title">{clean(farm.name)}의 상품</h2>
      {farm.products.length === 0 ? <p className="muted">지금 판매 중인 상품이 없어요.</p> : (
        <ul className="pgrid">
          {farm.products.map((p) => <li key={p.product_code}><ProductCard p={p} onOpen={(c) => go(`/p/${encodeURIComponent(c)}`)} /></li>)}
        </ul>
      )}
      <p className="farm-back"><a href="/farms">← 다른 농가 보기</a></p>
    </section>
  )
}
