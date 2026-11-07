// 6단계: 추천. 상품 태그로 점수를 매겨 고르고, 왜 골랐는지 이유를 같이 준다.
// 고르는 건 항상 DB 규칙이라 매번 같은 결과가 나오고, 품절 상품은 추천하지 않는다.
// 옵션 상품의 가격은 판매 중 옵션의 최저가라 "~부터"로 보여 준다 (has_options)
import express from 'express'
import { cached } from './cache.js'
import { pool } from './db.js'

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

// 추천할 때마다 DB를 읽지 않게 15초 동안 기억한다 (상품이 바뀌면 cache.js가 바로 지운다)
export function loadActive() {
  return cached('recommend:active', 15_000, async () => {
    const [products, tags] = await Promise.all([
      pool.query(`SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category, i.show_brix,
                         s.name AS seller_name, s.region AS seller_region,
                         EXISTS (SELECT 1 FROM product_options o WHERE o.product_code = p.product_code) AS has_options,
                         (SELECT count(*) FILTER (WHERE r.info_match = 'no') >= 3 AND count(*) FILTER (WHERE r.info_match = 'no') * 2 >= count(r.info_match) FROM reviews r WHERE r.product_code = p.product_code AND NOT r.hidden) AS info_disputed
                  FROM products p JOIN items i ON i.item_code = p.item_code JOIN sellers s ON s.seller_code = p.seller_code
                  WHERE p.status = 'active'`),
      pool.query('SELECT * FROM tags'),
    ])
    // 후기에서 '표시와 달랐어요'가 많은 상품은 당도를 내세우지 않는다
    return { products: products.rows.map((p) => (p.info_disputed ? { ...p, brix: null } : p)), tagLabel: Object.fromEntries(tags.rows.map((t) => [t.tag_code, t.label])) }
  })
}

const brixReason = (p) => (p.show_brix && p.brix ? `당도 ${p.brix}Brix${p.brix_measured_at ? `(${p.brix_measured_at.slice(5).replace('-', '/')} 측정)` : ''}` : null)

// want: 원하는 태그 코드, budget: 최대 가격, categories: 과일·채소·가공품 중 고른 것.
// 원하는 태그가 하나도 안 맞는 상품은 뺀다. matched·missed는 추천받기 화면에서 맞은 조건과 안 맞은 조건을 보여 줄 때 쓴다
export function recommend({ products, tagLabel }, { want = [], budget = null, categories = [], exclude = null, limit = 3 }) {
  return products
    .filter((p) => !p.sold_out && p.product_code !== exclude && (!budget || p.price <= budget) && (!categories.length || categories.includes(p.category)))
    .map((p) => {
      const hit = want.filter((t) => p.tags.includes(t))
      // 맞는 태그 수가 먼저, 같으면 제철·당도 측정 상품, 그다음 싼 순
      const score = hit.length * 100 + (p.tags.includes('season') ? 5 : 0) + (p.brix && p.show_brix ? 3 : 0)
      return { p, hit, score }
    })
    .filter((x) => !want.length || x.hit.length > 0)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, limit)
    .map(({ p, hit }) => ({
      ...card(p),
      matched: hit.map((t) => tagLabel[t] ?? t),
      missed: want.filter((t) => !hit.includes(t)).map((t) => tagLabel[t] ?? t),
      reasons: [...hit.map((t) => tagLabel[t] ?? t), p.tags.includes('season') && !hit.includes('season') ? tagLabel.season : null, brixReason(p)]
        .filter(Boolean),
    }))
}

function card(p) {
  return {
    product_code: p.product_code, name: p.name, price: p.price, unit: p.unit, category: p.category, has_options: p.has_options,
    seller_name: p.seller_name, seller_region: p.seller_region, image_url: p.image_url, brix: p.show_brix ? p.brix : null,
  }
}

// ---------- AI 상담에서 쓰는 말 → 태그 ----------
const WORDS = {
  gift: /선물|명절|부모님|답례|어버이/,
  home: /집에서|가정|우리 가족|혼자|자취/,
  cafe: /카페|가게|매장|식당/,
  kids: /아이들?|애들|손주|손자|손녀|어린이|간식/,
  raw: /생으로|바로 먹|그냥 먹|깎아/,
  cook: /요리|반찬|볶|조림|구워|쪄/,
  drink: /음료|마시|에이드|주스/,
  spread: /빵|토스트|발라/,
  sweet: /달콤|달달|단맛|단 ?거|달게|달아/,
  sour: /새콤|상큼|신맛/,
  mild: /담백|안 단|덜 단/,
  keep_long: /오래|두고/,
  eat_soon: /바로 먹을|금방 먹/,
  season: /제철/,
}

export function readWish(text) {
  const want = Object.entries(WORDS).filter(([, re]) => re.test(text)).map(([tag]) => tag)
  const man = text.match(/(\d+)\s*만\s*원?/)
  const plain = text.match(/(\d{4,})\s*원/)
  const budget = man ? Number(man[1]) * 10_000 : plain ? Number(plain[1]) : null
  const categories = [/과일/.test(text) && '과일', /채소|야채/.test(text) && '채소'].filter(Boolean)
  return { want, budget, categories }
}

export function describeRecommendation(items, { want, budget, categories = [] }, tagLabel) {
  const condition = [...want.map((t) => tagLabel[t] ?? t), ...categories, budget ? `${won(budget)} 이하` : null].filter(Boolean).join(' · ')
  if (!items.length) return `${condition ? `${condition} 조건에 ` : ''}맞는 상품이 지금은 없어요. 조건을 바꿔 보시거나 상품 목록 위의 [추천 받기]를 써 보세요.`
  const list = items.map((x) => `${x.name.replace(/\[예시\]\s*/g, '')} (${[`${won(x.price)}${x.has_options ? '부터' : ''}`, ...x.reasons].join(' · ')})`).join(', ')
  return `${condition ? `${condition} 조건으로 ` : ''}이런 상품을 추천해요: ${list}. 상품 이름을 누르면 자세히 볼 수 있어요.`
}

// ---------- API ----------
export const recommendRouter = express.Router()

recommendRouter.get('/recommend', async (req, res) => {
  const data = await loadActive()
  const want = String(req.query.tags ?? '').split(',').filter((t) => t in data.tagLabel)
  const budget = /^\d+$/.test(req.query.budget ?? '') ? Number(req.query.budget) : null
  const categories = String(req.query.category ?? '').split(',').filter(Boolean)
  // 추천받기 화면은 맞는 상품을 모두 보여 준다 (limit=all). 상담 챗봇은 지금처럼 3개
  const limit = req.query.limit === 'all' ? Infinity : 3
  res.json({ items: recommend(data, { want, budget, categories, limit }) })
})

// 추천받기 화면의 선택지: 태그와 종류마다 지금 살 수 있는 상품이 몇 개인지 세려고 상품의 태그, 종류, 가격만 준다
recommendRouter.get('/recommend/options', async (req, res) => {
  const { products } = await loadActive()
  const live = products.filter((p) => !p.sold_out)
  res.json({ products: live.map((p) => ({ tags: p.tags, category: p.category, price: p.price })), soldOut: products.length - live.length })
})

// 이번 주 추천: 제철 → 당도 측정 상품 순 (조건 없이 점수만)
recommendRouter.get('/featured', async (req, res) => {
  res.json({ items: recommend(await loadActive(), { limit: 3 }) })
})

// 함께 보면 좋은 상품: 같은 품목이 먼저, 그다음 태그가 2개 이상 겹치는 상품
recommendRouter.get('/products/:code/related', async (req, res) => {
  const data = await loadActive()
  const me = data.products.find((p) => p.product_code === req.params.code)
  if (!me) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  const items = data.products
    .filter((p) => p.product_code !== me.product_code && !p.sold_out)
    .map((p) => {
      const shared = p.tags.filter((t) => me.tags.includes(t))
      const sameItem = p.item_code === me.item_code
      return { p, shared, sameItem, score: (sameItem ? 100 : 0) + shared.length }
    })
    .filter((x) => x.sameItem || x.shared.length >= 2)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, 3)
    .map(({ p, shared, sameItem }) => ({
      ...card(p),
      reasons: [sameItem ? `같은 ${me.item_name}` : null, ...shared.slice(0, 2).map((t) => data.tagLabel[t] ?? t)].filter(Boolean),
    }))
  res.json({ items })
})
