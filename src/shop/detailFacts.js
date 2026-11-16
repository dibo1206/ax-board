// 자동 상세 카드 (2026-11-14): 모든 상품의 상세 화면에 저장된 값만으로 그리는 카드의 내용을 고른다
// 사진 카드와 달리 화면에서 그려서 가격·재고·당도가 바뀌면 바로 같이 바뀐다. 지어낸 값은 없다 (빈칸은 카드에서 빠진다)
// React 없이 쓰는 순수 함수만 둔다 → scripts/blocks-test.js 에서 시험한다
import { unitPrice } from './shared.js'

const cleanName = (s) => String(s ?? '').replace(/\[예시\]\s*/g, '').trim()
const monthDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : null
}

// 상품 페이지 맨 위 구매 칸과 같은 규칙: 당도를 보여 주는 품목이고, 값이 있고, 후기에서 '표시와 달랐어요'로 내려가지 않았을 때만
export const showsBrix = (product) => Boolean(product.item?.show_brix && product.brix && !product.info_disputed)

// [한눈에 보기] 칸: 있는 값만 { label, value, note }
export function keyFacts(product) {
  const item = product.item ?? {}
  const fresh = item.category !== '가공품'
  const facts = []
  const add = (label, value, note = null) => { if (value) facts.push({ label, value: String(value), note }) }
  add('원산지', product.notice?.origin)
  if (product.variety && !['공통', '기타'].includes(product.variety)) add('품종', product.variety)
  if (showsBrix(product)) add('당도', `${Number(product.brix)}Brix`, product.brix_measured_at ? `${monthDay(product.brix_measured_at)} 판매 농가 측정` : '판매 농가 측정')
  if (fresh && product.harvest_date) add('수확일', monthDay(product.harvest_date), product.harvest_days != null ? `수확 ${product.harvest_days}일째` : null)
  if (product.preorder && product.ship_from) add('출고 시작', `${monthDay(product.ship_from)}부터`, '예약 판매')
  add('구성', product.notice?.composition || product.unit)
  add('보내는 곳', product.seller?.region ?? product.seller_region) // 판매 농가 지역 (원산지와 다를 수 있어 따로 적는다)
  if (product.weight_g) add('1개 무게', `${product.weight_g}g`)
  if (product.count_per_box) add('박스당', `${product.count_per_box}개`)
  return facts
}

// 머리글: 농가·지역 한 줄과 상품 소개(없으면 상품 이름)
export function headline(product) {
  return {
    kicker: [cleanName(product.seller?.name ?? product.seller_name), product.seller?.region ?? product.seller_region].filter(Boolean).join(' · '),
    title: (product.summary ?? '').trim() || cleanName(product.name),
  }
}

// 당도 눈금: 품목의 보통 범위(brix_min~max)와 공식 기준(높은 당도·매우높은 당도)이 다 들어가게 잡는다
export function brixGauge(product) {
  if (!showsBrix(product)) return null
  const value = Number(product.brix)
  const item = product.item ?? {}
  const marks = [Number(item.brix_min), Number(item.brix_max), Number(product.brix_high), Number(product.brix_top), value].filter((n) => Number.isFinite(n) && n > 0)
  let lo = Math.floor(Math.min(...marks)) - 1
  let hi = Math.ceil(Math.max(...marks)) + 1
  if (hi - lo < 6) { lo = Math.max(0, Math.floor(value) - 4); hi = lo + 8 } // 범위를 모르면 값 둘레 8칸
  const at = (n) => Math.round(((n - lo) / (hi - lo)) * 1000) / 10 // 0~100 (%)
  const std = (n, label) => (Number.isFinite(Number(n)) && Number(n) > 0 ? { value: Number(n), label, at: at(Number(n)) } : null)
  return {
    value, lo, hi, at: at(value),
    grade: product.brix_grade ?? null,
    standards: [std(product.brix_high, '높은 당도'), std(product.brix_top, '매우높은 당도')].filter(Boolean),
    measuredAt: monthDay(product.brix_measured_at),
    photo: product.brix_photo_url ?? null,
    source: product.brix_standard_source ?? null,
    variety: product.variety && !['공통', '기타'].includes(product.variety) ? product.variety : null,
  }
}

// [구성 비교]: 옵션이 2개 이상일 때만 (하나면 위 구매 칸과 같아서). 100g당 가격으로 비교하게
export function optionRows(product) {
  const options = product.options ?? []
  if (options.length < 2) return null
  const rows = options.map((o) => ({ id: o.id, name: o.name, price: Number(o.price), per100: unitPrice(o.price, o.name), soldOut: Number(o.stock) === 0 }))
  // 100g당 가격이 가장 낮은 판매 중 옵션 (모두 읽을 수 있을 때만)
  // "100g당 9,580원" 에서 9580 만 (앞의 100 까지 읽지 않게)
  const priced = rows.filter((r) => !r.soldOut).map((r) => ({ r, n: Number(/당\s*([\d,]+)원/.exec(r.per100 ?? '')?.[1]?.replace(/,/g, '') ?? 0) }))
  const sameBase = new Set(priced.map((x) => String(x.r.per100).split('당')[0])).size === 1 // 100g 끼리, 100ml 끼리만 비교
  if (priced.length >= 2 && sameBase && priced.every((x) => x.n > 0)) {
    const best = priced.reduce((a, b) => (b.n < a.n ? b : a))
    if (priced.some((x) => x.n !== best.n)) best.r.best = true
  }
  return rows
}

// 보관법 글을 단계로 나눈다 ("A. B. C" → ["A", "B", "C"]). 한 문장이면 단계로 나누지 않는다
export function storageSteps(text) {
  const steps = String(text ?? '').split(/(?<=[.。])\s+|\.$/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean)
  return steps.length >= 2 ? steps : null
}

// 쿠팡식 지그재그 (2026-11-16): 사진 블록과 글 블록이 붙어 있으면 한 줄(사진 | 글)로 묶고, 줄마다 사진 쪽을 바꾼다.
// 혼자 있는 사진(세로로 긴 상세 이미지 등)과 글은 전처럼 가운데 한 칸. 휴대폰에서는 사진 위·글 아래로 쌓인다
export function pairBlocks(blocks) {
  const rows = []
  let pairs = 0
  for (let i = 0; i < blocks.length; i += 1) {
    const a = blocks[i]
    const b = blocks[i + 1]
    if (b && a.type !== b.type) {
      rows.push({ image: a.type === 'image' ? a : b, text: a.type === 'image' ? b : a, flip: pairs % 2 === 1 })
      pairs += 1
      i += 1
    } else rows.push({ single: a })
  }
  return rows
}
