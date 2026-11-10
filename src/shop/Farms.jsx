import { useEffect, useState } from 'react'
import { ProductCard } from './home/Home.jsx'
import { get, thumbUrl } from './shared.js'

// 농가별로 모아 보기 [가설: PRD에 없는 실험 기능 — 팀원 제안]. 서버는 공개 칸(이름·지역·소개·이야기)만 보낸다.
// 데이터는 DB에 저장된 값 그대로, 없는 칸은 보여 주지 않는다 (빈칸을 지어내지 않는다)
const farmName = (name = '') => name.replace(/\[예시\]\s*/g, '')

function useTitle(title) {
  useEffect(() => {
    const before = document.title
    document.title = `${title} · YOONJU MARKET`
    return () => { document.title = before }
  }, [title])
}

export function FarmListPage() {
  const [farms, setFarms] = useState(null)
  const [error, setError] = useState('')
  useTitle('농가별로 보기')
  useEffect(() => { get('/farms').then(setFarms).catch(() => setError('농가 목록을 불러오지 못했어요.')) }, [])

  return (
    <div className="farm-page">
      <h1>농가별로 보기</h1>
      <p className="muted">농가를 누르면 그 농가의 상품만 모아 볼 수 있어요.</p>
      {error ? <p className="error">{error}</p> : !farms ? <p className="muted">불러오는 중…</p> : (
        <ul className="farm-list">
          {farms.map((f) => (
            <li key={f.seller_code}>
              <a className="farm-card" href={`/farms/${encodeURIComponent(f.seller_code)}`}>
                <span className="farm-card-img">
                  {f.image_url ? <img src={thumbUrl(f.image_url)} alt="" loading="lazy" width="400" height="400" /> : <span className="photo-need"><span>사진 준비 중</span></span>}
                </span>
                <strong>{farmName(f.name)}</strong>
                {f.region && <span className="muted">{f.region}</span>}
                <span className="farm-card-count">상품 {f.product_count}개</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FarmPage({ code }) {
  const [farm, setFarm] = useState(null)
  const [error, setError] = useState('')
  useTitle(farm ? farmName(farm.name) : '농가')
  useEffect(() => { get(`/farms/${encodeURIComponent(code)}`).then(setFarm).catch(() => setError('농가를 찾지 못했어요.')) }, [code])

  if (error) return <div className="farm-page"><p className="error">{error}</p><p><a href="/farms">농가별로 보기로 돌아가기</a></p></div>
  if (!farm) return <div className="farm-page"><p className="muted">불러오는 중…</p></div>
  return (
    <div className="farm-page">
      <p className="farm-crumb">
        <a className="button ghost farm-btn" href="/farms">← 농가별로 보기</a>
        <a className="button ghost farm-btn" href="/#products">상품 목록으로</a>
      </p>
      <header className="farm-head">
        <h1>{farmName(farm.name)}{farm.region && <small className="farm-region">{farm.region}</small>}</h1>
        {farm.intro && <p>{farm.intro}</p>}
        {farm.story && <p className="muted">{farm.story}</p>}
      </header>
      <h2>판매 중인 상품 <small className="muted">{farm.products.length}개</small></h2>
      {farm.products.length === 0 ? <p className="muted">지금 판매 중인 상품이 없어요.</p> : (
        <ul className="pgrid">
          {farm.products.map((p) => (
            <li key={p.product_code}><ProductCard p={p} onOpen={(c) => { window.location.href = `/p/${encodeURIComponent(c)}` }} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}
