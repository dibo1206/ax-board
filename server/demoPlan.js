// [예시] 상품 상세 블록 설계 (2026-11-16). DB·파일을 쓰지 않는 순수 함수만 → scripts/blocks-test.js 에서 DB 없이 시험
// 실제로 사진을 복사하고 저장하는 쪽은 server/demoBlocks.js
export const DEMO_CAPTION = '[예시] 참고 사진 — 실제 상품과 다를 수 있어요'
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

// 상품 하나의 블록 설계 (DB·파일을 쓰지 않는 순수 함수 → scripts/blocks-test.js 에서 시험)
// photos: [{ key, from }] — from 은 원본 사진 주소(/product-photos/… 등). 실제 블록 사진 주소는 복사한 뒤 채운다
export function planDemoBlocks(product, item, seller) {
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
