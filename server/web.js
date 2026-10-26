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
const PRIVATE_PAGES = /^\/(admin|seller|account|cart|checkout|order)(\/|$)/
const PUBLIC_PAGES = ['/', '/policy/terms', '/policy/privacy', '/policy/refund']
const CODE = /^[A-Za-z0-9_-]{1,64}$/

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
      `SELECT p.product_code, p.name, p.summary, p.description, p.price, p.stock, p.image_url, s.name AS seller_name, rv.rating, rv.review_count
       FROM products p JOIN sellers s ON s.seller_code = p.seller_code
       LEFT JOIN (SELECT product_code, round(avg(rating)::numeric, 1)::float AS rating, count(*)::int AS review_count
                  FROM reviews WHERE NOT hidden AND product_code = $1 GROUP BY product_code) rv ON rv.product_code = p.product_code
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
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}" />`)
    .replace('</head>', `    ${extra.join('\n    ')}\n  </head>`)
}

async function pageHead(req, html) {
  const base = siteUrl(req)
  const url = base + req.path
  const defaults = { title: SHOP_NAME, description: html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? SHOP_NAME, url }
  if (PRIVATE_PAGES.test(req.path)) return { status: 200, head: { ...defaults, noindex: true } }
  if (!req.path.startsWith('/p/')) return { status: PUBLIC_PAGES.includes(req.path) || req.path.startsWith('/policy/') ? 200 : 404, head: { ...defaults, url: base + (PUBLIC_PAGES.includes(req.path) ? req.path : '/') } }

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
      description: `${summary} · ${Number(product.price).toLocaleString('ko-KR')}원`,
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
          '@type': 'Offer',
          url: `${base}/p/${encodeURIComponent(product.product_code)}`,
          priceCurrency: 'KRW',
          price: product.price,
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
  app.use(express.static(fileURLToPath(dist), { index: false, maxAge: '1h' }))
  app.use(async (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
    try {
      const { status, head } = await pageHead(req, html)
      res.status(status).set('Cache-Control', 'no-cache').type('html').send(renderHead(html, head))
    } catch (error) {
      next(error)
    }
  })
}
