// 검색엔진·배포용
//  - robots.txt, sitemap.xml (개발 중에도 Vite 가 이 서버로 넘긴다)
//  - 배포(npm start): 빌드한 화면(dist)을 이 서버가 직접 보낸다
//    · 파일 이름에 해시가 붙은 /assets 는 1년 캐시, index.html 은 매번 새로 확인
//    · 상품 주소(/p/상품코드)는 검색 결과·카톡 공유 미리보기에 쓰이게 제목·설명·사진·가격을 HTML에 넣어 보낸다
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { cached } from './cache.js'
import { pool } from './db.js'

const SHOP_NAME = 'YOONJU MARKET'
const PRIVATE_PAGES = /^\/(admin|seller|account|cart|checkout|order|restock)(\/|$)/ // restock: 재입고 알림 취소 화면
// 손님이 여는 공개 화면 (여기 없는 주소는 404 + 화면은 '찾으시는 페이지가 없어요'). 화면 주소를 새로 만들면 여기에도 더한다
// 농가별로 보기 [가설] 농가 페이지 주소 (/farms/농가코드)
const FARM_PAGE = /^\/farms\/[A-Za-z0-9_-]{1,60}$/
const PUBLIC_PAGES = ['/', '/products', '/farms', '/about', '/notice', '/press', '/guide', '/sitemap', '/policy/terms', '/policy/privacy', '/policy/refund', '/policy/noemail']
const CODE = /^[A-Za-z0-9_-]{1,64}$/
// 화면에서 불러도 되는 곳: 우리 서버, 토스페이먼츠(결제창), 다음 우편번호(주소 검색 창), 구글·jsDelivr 글꼴. 나머지 스크립트·틀(iframe)은 막는다
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.tosspayments.com https://*.tosspayments.com https://t1.daumcdn.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.tosspayments.com",
  "frame-src https://*.tosspayments.com https://*.toss.im",
  "form-action 'self' https://*.tosspayments.com",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

// 사이트 주소: 배포 때는 .env 의 PUBLIC_URL, 없으면 요청이 들어온 주소
// (req.host 는 믿을 수 있는 앞단 프록시가 붙인 X-Forwarded-Host 를 먼저 본다)
const siteUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.host}`).replace(/\/$/, '')

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (text, n) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export const seoRouter = express.Router()

seoRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
    ['User-agent: *', 'Disallow: /admin', 'Disallow: /seller', 'Disallow: /account', 'Disallow: /cart', 'Disallow: /checkout', 'Disallow: /order', 'Disallow: /api/', '', `Sitemap: ${siteUrl(req)}/sitemap.xml`, ''].join('\n'),
  )
})

seoRouter.get('/sitemap.xml', async (req, res) => {
  const base = siteUrl(req)
  const xml = await cached(`sitemap:${base}`, 10 * 60_000, async () => {
    const { rows } = await pool.query(
      "SELECT product_code, to_char(COALESCE(updated_at, created_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day FROM products WHERE status = 'active' ORDER BY product_code",
    )
    const urls = [
      ...PUBLIC_PAGES.map((path) => `<url><loc>${esc(base + path)}</loc></url>`),
      ...rows.map((p) => `<url><loc>${esc(`${base}/p/${encodeURIComponent(p.product_code)}`)}</loc><lastmod>${p.day}</lastmod></url>`),
    ]
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  })
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml)
})

function loadProductMeta(code) {
  return cached(`meta:${code}`, 60_000, async () => {
    const { rows } = await pool.query(
      `SELECT p.product_code, p.name, p.summary, p.description, p.price, p.stock, p.image_url, s.name AS seller_name, rv.rating, rv.review_count,
              opt.n AS option_count, opt.high AS high_price
       FROM products p JOIN sellers s ON s.seller_code = p.seller_code
       LEFT JOIN (SELECT product_code, round(avg(rating)::numeric, 1)::float AS rating, count(*)::int AS review_count
                  FROM reviews WHERE NOT hidden AND product_code = $1 GROUP BY product_code) rv ON rv.product_code = p.product_code
       -- 판매 옵션: 상품 가격은 판매 중 옵션의 최저가라 옵션이 있으면 가격 범위로 알린다
       LEFT JOIN LATERAL (SELECT count(*)::int AS n, max(price) AS high FROM product_options WHERE product_code = p.product_code AND status = 'active') opt ON true
       WHERE p.status = 'active' AND p.product_code = $1`,
      [code],
    )
    return rows[0] ?? null
  })
}

// index.html 의 제목·설명을 이 주소에 맞게 바꾸고, 미리보기 사진·대표 주소·상품 정보(JSON-LD)를 덧붙인다
function renderHead(html, { title, description, url, image, noindex, jsonLd }) {
  const extra = [
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    noindex && '<meta name="robots" content="noindex" />',
    // </script> 로 빠져나가지 못하게 < 를 바꿔 둔다
    jsonLd && `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean)
  // 바꿔 넣을 글은 함수로 넘긴다: 상품 이름·설명에 $& · $` 같은 기호가 있어도 원래 HTML 조각이 끼어들지 않게
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, () => `<meta property="og:title" content="${esc(title)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, () => `<meta property="og:description" content="${esc(description)}" />`)
    .replace('</head>', () => `    ${extra.join('\n    ')}\n  </head>`)
}

async function pageHead(req, html) {
  const base = siteUrl(req)
  const url = base + req.path
  const defaults = { title: SHOP_NAME, description: html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? SHOP_NAME, url }
  if (PRIVATE_PAGES.test(req.path)) return { status: 200, head: { ...defaults, noindex: true } }
  if (!req.path.startsWith('/p/')) return { status: PUBLIC_PAGES.includes(req.path) || req.path.startsWith('/policy/') || /^\/(notice|press)\/\d{1,9}$/.test(req.path) || FARM_PAGE.test(req.path) ? 200 : 404, head: { ...defaults, url: base + (PUBLIC_PAGES.includes(req.path) || FARM_PAGE.test(req.path) ? req.path : '/') } }

  let code = ''
  try {
    code = decodeURIComponent(req.path.slice(3))
  } catch {
    // 잘못된 주소는 아래에서 '없는 상품'으로
  }
  const product = CODE.test(code) ? await loadProductMeta(code) : null
  if (!product) return { status: 404, head: { ...defaults, title: `상품을 찾지 못했어요 | ${SHOP_NAME}`, noindex: true } }

  const image = product.image_url ? base + product.image_url : null
  const summary = clip(product.summary || product.description || `${product.seller_name}에서 보내는 ${product.name}`, 120)
  return {
    status: 200,
    head: {
      title: `${product.name} | ${SHOP_NAME}`,
      description: `${summary} · ${Number(product.price).toLocaleString('ko-KR')}원${product.option_count ? '부터' : ''}`,
      url: `${base}/p/${encodeURIComponent(product.product_code)}`,
      image,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: clip(product.description || product.summary, 500) || undefined,
        image: image ? [image] : undefined,
        sku: product.product_code,
        brand: { '@type': 'Brand', name: product.seller_name },
        offers: {
          url: `${base}/p/${encodeURIComponent(product.product_code)}`,
          priceCurrency: 'KRW',
          ...(product.option_count
            ? { '@type': 'AggregateOffer', lowPrice: product.price, highPrice: product.high_price, offerCount: product.option_count }
            : { '@type': 'Offer', price: product.price }),
          availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
        aggregateRating: product.review_count > 0 ? { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.review_count } : undefined,
      },
    },
  }
}

// 배포 모드에서만: dist 의 파일을 보내고, 나머지 주소는 모두 index.html (화면이 주소를 보고 알맞은 페이지를 그린다)
export async function serveDist(app) {
  const dist = new URL('../dist/', import.meta.url)
  let html
  try {
    html = await readFile(new URL('index.html', dist), 'utf8')
  } catch {
    throw new Error('dist/index.html 이 없어요. 먼저 npm run build 를 실행해 주세요.')
  }
  app.use('/assets', express.static(fileURLToPath(new URL('assets/', dist)), { immutable: true, maxAge: '1y', fallthrough: false }))
  // redirect: false — dist/about/ 같은 사진 폴더와 화면 주소(/about)가 이름이 같으면, 기본값은 /about/ 로 넘겨서 404가 났다 (2026-11-09)
  app.use(express.static(fileURLToPath(dist), { index: false, redirect: false, maxAge: '1h' }))
  app.use(async (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
    try {
      const { status, head } = await pageHead(req, html)
      res.status(status).set({ 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP }).type('html').send(renderHead(html, head))
    } catch (error) {
      next(error)
    }
  })
}
