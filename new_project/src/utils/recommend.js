import { PRODUCTS } from '../data/products.js'

export const QUESTIONS = [
  {
    key: 'purpose',
    title: '어떤 용도로 구매하시나요?',
    options: [
      { value: 'gift', label: '선물용' },
      { value: 'home', label: '가정용' },
    ],
  },
  {
    key: 'budget',
    title: '예산은 어느 정도인가요?',
    options: [
      { value: 'low', label: '2만 원 이하' },
      { value: 'mid', label: '2만~5만 원' },
      { value: 'high', label: '5만 원 이상' },
    ],
  },
  {
    key: 'taste',
    title: '어떤 맛을 좋아하세요?',
    options: [
      { value: 'sweet', label: '달콤한 맛' },
      { value: 'sour', label: '새콤한 맛' },
    ],
  },
  {
    key: 'type',
    title: '어떤 상품을 찾으세요?',
    options: [
      { value: 'fresh', label: '농산물' },
      { value: 'processed', label: '가공식품' },
    ],
  },
]

const MAX_RESULTS = 3

export function optionLabel(key, value) {
  const question = QUESTIONS.find((q) => q.key === key)
  return question?.options.find((o) => o.value === value)?.label ?? ''
}

function inBudget(price, budget) {
  if (budget === 'low') return price <= 20000
  if (budget === 'mid') return price > 20000 && price <= 50000
  return price > 50000
}

const MATCHERS = {
  purpose: (p, v) => p.purposes.includes(v),
  budget: (p, v) => inBudget(p.price, v),
  taste: (p, v) => p.taste === v,
  type: (p, v) => p.type === v,
}

function buildReason(product, answers) {
  const parts = QUESTIONS.filter((q) => MATCHERS[q.key](product, answers[q.key])).map((q) =>
    optionLabel(q.key, answers[q.key])
  )
  if (product.brix) parts.push(`당도 ${product.brix}Brix`)
  return `${parts.join(' · ')} — ${product.features[0]}`
}

// 품절 상품은 제외하고, 4개 조건이 모두 맞는 상품을 최대 3개 고른다.
// 모두 맞는 상품이 없으면 가장 많이 맞는 상품을 "가까운 상품"으로 돌려준다.
export function recommend(answers) {
  const scored = PRODUCTS.filter((p) => !p.soldOut).map((product) => {
    const mismatches = QUESTIONS.filter((q) => !MATCHERS[q.key](product, answers[q.key])).map(
      (q) => q.key
    )
    return { product, mismatches, reason: buildReason(product, answers) }
  })

  const byQuality = (a, b) => (b.product.brix ?? 0) - (a.product.brix ?? 0)
  const exact = scored.filter((s) => s.mismatches.length === 0).sort(byQuality)
  if (exact.length > 0) return { exact: true, items: exact.slice(0, MAX_RESULTS) }

  const best = Math.min(...scored.map((s) => s.mismatches.length))
  const closest = scored.filter((s) => s.mismatches.length === best).sort(byQuality)
  return { exact: false, items: closest.slice(0, MAX_RESULTS) }
}
