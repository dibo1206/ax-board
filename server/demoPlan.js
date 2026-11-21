// [예시] 상품 상세 블록 설계 (2026-11-16). DB·파일을 쓰지 않는 순수 함수만 → scripts/blocks-test.js 에서 DB 없이 시험
// 실제로 사진을 복사하고 저장하는 쪽은 server/demoBlocks.js
export const DEMO_CAPTION = '[예시] 참고 사진 — 실제 상품과 다를 수 있어요'
// 이 기능이 채운 블록인지: 사진이 하나 이상 있고 모든 사진에 [예시] 참고 사진이 적혀 있다 (농가가 사진을 바꾸거나 더하면 아니게 된다)
export function isDemoMade(blocks) {
  const images = (Array.isArray(blocks) ? blocks : []).filter((b) => b?.type === 'image')
  return images.length > 0 && images.every((b) => b.caption === DEMO_CAPTION)
}
const SAMPLE = /^\[예시\]\s*/

const plainName = (name) => String(name ?? '').replace(SAMPLE, '').trim()
const monthDay = (date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date instanceof Date ? date.toISOString() : String(date ?? ''))
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : null
}
// 받침에 맞춰 '이에요/예요' (한글로 끝나지 않으면 '이에요')
const ieyo = (word) => {
  const last = String(word).trim().slice(-1)
  const code = last.charCodeAt(0) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 === 0 ? `${word}예요` : `${word}이에요`
}
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trim()}…` : s)

// ---------- 품목 장면 사진 + POINT 설명 (2026-11-21, data/demo_detail_photos.json) ----------
// 품목마다 장면 4개(사진 public/product-photos/detail/품목-번호.webp, Figma AI 시연용)와 설명 글이 있으면 그걸로 4쌍을 만든다.
// 설명 글의 {원산지}·{품종}·{당도}·{당도측정일}·{수확일}·{구성}·{보내는곳}·{농가} 는 그 상품에 저장된 값으로 채우고, 값이 없으면 그 문장을 뺀다
// {원산지:이에요} 처럼 쓰면 값 끝 글자 받침에 맞춰 이에요/예요·은/는·이/가·을/를·으로/로 를 고른다
export const scenePhotoUrl = (itemCode, n) => `/product-photos/detail/${itemCode}-${n}.webp`
const JOSA = { 이에요: ['이에요', '예요'], 은: ['은', '는'], 이: ['이', '가'], 을: ['을', '를'], 으로: ['으로', '로'] }
export function withJosa(value, josa) {
  const pair = JOSA[josa]
  if (!pair) return `${value}${josa}`
  const last = [...String(value)].reverse().find((c) => c >= '가' && c <= '힣') // 괄호·숫자 뒤라도 마지막 한글 글자로 본다
  const batchim = last ? (last.charCodeAt(0) - 0xac00) % 28 : 0
  return `${value}${batchim !== 0 && !(josa === '으로' && batchim === 8) ? pair[0] : pair[1]}` // ㄹ 받침은 '로'
}
export function fillCopy(text, values) {
  return String(text ?? '').split(/(?<=[.!?])\s+/).map((sentence) => {
    let ok = true
    const out = sentence.replace(/\{([^}:]+)(?::([^}]+))?\}/g, (_, key, josa) => {
      const v = values[key]
      if (v == null || v === '') { ok = false; return '' }
      return josa ? withJosa(v, josa) : v
    })
    return ok ? out : null
  }).filter(Boolean).join(' ')
}
// 상품 값: 당도는 상품 화면과 같은 규칙 (검수 전 품목·당도를 보여 주지 않는 품목·'표시와 달랐어요'로 내린 상품은 빼기)
export function sceneValues(product, item, seller) {
  const showBrix = item?.status !== 'pending' && item?.show_brix !== false && product.brix != null && !product.info_disputed
  return {
    원산지: product.notice?.origin || null,
    품종: product.variety && !['공통', '기타'].includes(product.variety) ? product.variety : null,
    당도: showBrix ? `${Number(product.brix)}Brix` : null,
    당도측정일: showBrix ? monthDay(product.brix_measured_at) : null,
    수확일: item?.category !== '가공품' ? monthDay(product.harvest_date) : null,
    구성: String(product.notice?.composition || product.unit || '').replace(/\s*\([^)]*옵션[^)]*\)/g, '').trim() || null, // "(옵션에서 고름)" 같은 안내는 뺀다
    보내는곳: seller?.region || null,
    농가: plainName(seller?.name) || null,
  }
}
// scene: { shots: [[모양, 만들 문장, 사진 설명, 제목, 설명 글], …] } (data/demo_detail_photos.json 의 품목 하나)
export function planScenePairs(product, item, seller, scene) {
  const values = sceneValues(product, item, seller)
  return (scene?.shots ?? []).map(([, , alt, headline, copy], i) => {
    const body = fillCopy(copy, values)
    return body && headline ? { photo: scenePhotoUrl(scene.item_code, i + 1), alt, title: `POINT ${i + 1} · ${headline}`, body } : null
  }).filter(Boolean)
}

// 상품 하나의 블록 설계 (DB·파일을 쓰지 않는 순수 함수 → scripts/blocks-test.js 에서 시험)
// photos: [{ key, from }] — from 은 원본 사진 주소(/product-photos/… 등). 실제 블록 사진 주소는 복사한 뒤 채운다
// scene: 그 품목의 장면 사진·설명이 있으면 그걸로 4쌍 (위), 없으면 아래처럼 대표 사진·레시피 사진으로
export function planDemoBlocks(product, item, seller, scene = null) {
  if (scene) {
    const pairs = planScenePairs(product, item, seller, scene)
    if (pairs.length) return { pairs }
  }
  const name = plainName(product.name)
  const farm = plainName(seller?.name) // 예시 농가 이름의 [예시] 도 뗀다 (화면 머리글과 같게)
  const pairs = []

  // 1) 대표 사진 | 이런 상품이에요 (한 줄 소개 + 저장된 사실)
  const facts = []
  const origin = product.notice?.origin || (seller?.region ? `국내산 (${seller.region})` : null)
  if (farm && seller?.region) facts.push(`${seller.region}의 ${farm}에서 보내는 ${ieyo(name)}.`)
  else if (origin) facts.push(`원산지는 ${ieyo(origin)}.`)
  if (product.variety) facts.push(`품종은 ${ieyo(product.variety)}.`)
  const harvested = monthDay(product.harvest_date)
  if (harvested && item?.category !== '가공품') facts.push(`${harvested}에 수확했어요.`)
  const measured = monthDay(product.brix_measured_at)
  if (product.brix && measured) facts.push(`판매 농가가 ${measured}에 잰 당도는 ${Number(product.brix)}Brix예요.`)
  if (product.unit) facts.push(`구성은 ${ieyo(product.unit)}.`)
  const intro = [product.summary, facts.join(' ')].filter(Boolean).join('\n\n')
  if (product.image_url && intro) {
    pairs.push({ photo: product.image_url, alt: `${name} 사진`, title: cut(product.summary ? '이런 상품이에요' : name, 40), body: intro })
  }

  // 2) 레시피 사진 | 이렇게 즐겨 보세요 (검수 전 품목은 손님 화면에서 레시피를 숨기므로 쓰지 않는다)
  const recipes = item && item.status !== 'pending' ? (item.recipes ?? []).filter((r) => r?.title && r?.image) : []
  for (const [i, r] of recipes.slice(0, 2).entries()) {
    const lines = [`${r.title}`, [r.ingredients && `재료: ${String(r.ingredients).replace(/·/g, ', ')}`, r.method && `만드는 법: ${r.method}`].filter(Boolean).join('\n')]
    pairs.push({ photo: r.image, alt: `${r.title} 사진`, title: i === 0 ? '이렇게 즐겨 보세요' : '이렇게도 즐겨요', body: lines.filter(Boolean).join('\n\n') })
  }

  // 농가 이야기·보관법은 상세 화면 아래 칸에 이미 나와서 블록으로 다시 쓰지 않는다 (README 블록형 상세페이지 '쓸 때 주의')
  return { pairs }
}
