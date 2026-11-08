import { ABOUT } from './home/content.js'

// 회사 소개 (/about): 회사 홈페이지(yunjufarm.co.kr)의 회사소개·로컬푸드·지역상생·오시는 길을 한 화면에.
// 홈페이지에서 그림 속 글이던 내용은 화면 글로 옮겼다 (화면 낭독기·휴대폰에서 읽히게). 글은 src/shop/home/content.js 의 ABOUT
const SECTIONS = [['intro', '회사소개'], ['values', '핵심 가치'], ['localfood', '로컬푸드'], ['products', '만드는 것'], ['location', '오시는 길']]

export function AboutPage() {
  const a = ABOUT
  const mapQuery = encodeURIComponent(a.location.address)
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
            <div key={p.title} className="about-card">
              <span className="about-num">{i + 1}</span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="values" className="about-section">
        <p className="about-eyebrow">윤주(주) 핵심가치</p>
        <h2>윤주(주)를 만드는 7가지 원칙</h2>
        <ol className="about-values">
          {a.values.map((v) => (
            <li key={v.title}>
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
            {a.localfood.qa.map((q) => (
              <div key={q.q}>
                <h3>{q.q}</h3>
                <p>{q.a}</p>
              </div>
            ))}
          </div>
        </div>
        <h3 className="about-sub">로컬푸드의 5가지 키워드</h3>
        <ul className="about-keywords">
          {a.localfood.keywords.map((k) => (
            <li key={k.title}><b>{k.title}</b><span>{k.text}</span></li>
          ))}
        </ul>
      </section>

      <section id="products" className="about-section">
        <h2>윤주(주)가 만드는 것</h2>
        <div className="about-products">
          {a.products.map((p) => (
            <a key={p.title} className="about-product" href={p.href}>
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
            <dt>대표</dt><dd>{a.location.ceo}</dd>
            <dt>주소</dt><dd>{a.location.address}</dd>
            <dt>대표전화</dt><dd><a href={`tel:${a.location.phone.replace(/\D/g, '')}`}>{a.location.phone}</a></dd>
            <dt>이메일</dt><dd>{a.location.email}</dd>
            <dt>업무시간</dt><dd>{a.location.hours}</dd>
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
  ['쇼핑', [['상품', '/#products'], ['제철 달력', '/#season'], ['추천받기', '/#recommend'], ['장바구니', '/cart'], ['주문조회', '/order/lookup']]],
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
