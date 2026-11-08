import { useEffect, useState } from 'react'
import { ABOUT } from './home/content.js'
import { getPolicy } from './shared.js'

// 회사 소개 (/about): 회사 홈페이지(yunjufarm.co.kr)의 회사소개·로컬푸드·지역상생·오시는 길을 한 화면에.
// 홈페이지에서 그림 속 글이던 내용은 화면 글로 옮겼다 (화면 낭독기·휴대폰에서 읽히게). 글은 src/shop/home/content.js 의 ABOUT,
// 관리자가 [홈페이지 관리 → 회사 소개]에서 고치면 그 값으로 바뀐다. 제목의 {개수}는 목록 개수로 바꾼다
const count = (title, list) => String(title ?? '').replace('{개수}', String(list?.length ?? 0))
const SECTIONS = [['intro', '회사소개'], ['values', '핵심 가치'], ['localfood', '로컬푸드'], ['products', '만드는 것'], ['location', '오시는 길']]

export function AboutPage() {
  const a = ABOUT
  // 오시는 길은 [쇼핑몰 설정]의 사업자 정보 값 (못 받으면 이 파일의 기본값)
  const [shop, setShop] = useState(null)
  useEffect(() => { getPolicy().then((p) => setShop(p.shop)).catch(() => {}) }, [])
  const loc = shop ? { ceo: shop.ceo, address: shop.address, phone: shop.phone, email: shop.email, hours: shop.hours } : a.location
  const mapQuery = encodeURIComponent(loc.address)
  return (
    <article className="about">
      <header className="about-hero">
        <div>
          <p className="about-eyebrow">{a.eyebrow}</p>
          <h1>{a.name}</h1>
          <p className="about-lead">{a.lead}</p>
        </div>
        <img src={a.heroImage.src} alt={a.heroImage.alt} width="1200" height="500" />
      </header>

      <nav className="about-nav" aria-label="회사 소개 차례">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="intro" className="about-section">
        <h2>회사소개</h2>
        <div className="about-promises">
          {a.promises.map((p, i) => (
            <div key={i} className="about-card">
              <span className="about-num">{i + 1}</span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="values" className="about-section">
        {a.valuesEyebrow && <p className="about-eyebrow">{a.valuesEyebrow}</p>}
        <h2>{count(a.valuesTitle, a.values)}</h2>
        <ol className="about-values">
          {a.values.map((v, i) => (
            <li key={i}>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="localfood" className="about-section">
        <p className="about-eyebrow">SAFE LOCAL FOOD</p>
        <h2>{a.localfood.title}</h2>
        <p className="about-lead">{a.localfood.lead}</p>
        <div className="about-split">
          <img src={a.localfood.image.src} alt={a.localfood.image.alt} loading="lazy" width="1200" height="500" />
          <div className="about-qa">
            {a.localfood.qa.map((q, i) => (
              <div key={i}>
                <h3>{q.q}</h3>
                <p>{q.a}</p>
              </div>
            ))}
          </div>
        </div>
        <h3 className="about-sub">{count(a.localfood.keywordsTitle, a.localfood.keywords)}</h3>
        <ul className="about-keywords">
          {a.localfood.keywords.map((k, i) => (
            <li key={i}><b>{k.title}</b><span>{k.text}</span></li>
          ))}
        </ul>
      </section>

      <section id="products" className="about-section">
        <h2>{a.productsTitle}</h2>
        <div className="about-products">
          {a.products.map((p, i) => (
            <a key={i} className="about-product" href={p.href}>
              <img src={p.image} alt="" loading="lazy" />
              <span><b>{p.title}</b><small>{p.text}</small><em>상품 보기 →</em></span>
            </a>
          ))}
        </div>
      </section>

      <section id="location" className="about-section">
        <h2>오시는 길</h2>
        <div className="about-location">
          <dl>
            <dt>회사명</dt><dd>{a.name}</dd>
            <dt>대표</dt><dd>{loc.ceo}</dd>
            <dt>주소</dt><dd>{loc.address}</dd>
            <dt>대표전화</dt><dd><a href={`tel:${loc.phone.replace(/\D/g, '')}`}>{loc.phone}</a></dd>
            <dt>이메일</dt><dd>{loc.email}</dd>
            <dt>업무시간</dt><dd>{loc.hours}</dd>
          </dl>
          <div className="about-maps">
            <p className="muted">지도에서 보기</p>
            <a className="button ghost" href={`https://map.naver.com/p/search/${mapQuery}`} target="_blank" rel="noopener noreferrer">네이버 지도 ↗</a>
            <a className="button ghost" href={`https://map.kakao.com/?q=${mapQuery}`} target="_blank" rel="noopener noreferrer">카카오맵 ↗</a>
            <a className="button ghost" href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noopener noreferrer">구글 지도 ↗</a>
          </div>
        </div>
      </section>
      <p className="note">{a.note}</p>
    </article>
  )
}

// 사이트맵 (/sitemap): 사람이 보는 전체 메뉴
const SITEMAP = [
  ['쇼핑', [['상품', '/products'], ['제철 달력', '/#season'], ['추천받기', '/#recommend'], ['장바구니', '/cart'], ['주문조회', '/order/lookup']]],
  ['윤주(주)', [['회사소개', '/about#intro'], ['핵심 가치', '/about#values'], ['로컬푸드', '/about#localfood'], ['오시는 길', '/about#location']]],
  ['고객센터', [['공지사항', '/notice'], ['언론보도', '/press'], ['자주 묻는 질문', '/#faq'], ['1분 사용 안내', '/guide']]],
  ['회원', [['로그인', '/account/login'], ['회원가입', '/account/signup'], ['마이페이지', '/account'], ['판매 농가 입점 신청', '/account/signup?type=seller']]],
  ['약관·정책', [['이용약관', '/policy/terms'], ['개인정보 처리방침', '/policy/privacy'], ['교환·환불 정책', '/policy/refund'], ['이메일무단수집거부', '/policy/noemail']]],
]

export function SitemapPage() {
  return (
    <article className="box sitemap">
      <h2>사이트맵</h2>
      <div className="sitemap-grid">
        {SITEMAP.map(([group, links]) => (
          <section key={group}>
            <h3>{group}</h3>
            <ul>{links.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul>
          </section>
        ))}
      </div>
    </article>
  )
}
