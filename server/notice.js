// 상품정보 제공 고시 (공정거래위원회 「전자상거래 등에서의 상품 등의 정보제공에 관한 고시」의 농수축산물·가공식품 항목)
// 품목·용량·생산자·보관법·상담 전화는 이미 있는 정보로 채우고, 판매자는 원산지·소비기한 같은 칸만 적는다
// 안전·법적 정보라 AI 가 채우지 않는다. 필수 칸이 비면 판매로 넘어가지 못한다 (임시 저장은 된다)
import { SHOP } from './policy.js'

const FIELDS = ['origin', 'packed', 'expiry', 'gmo', 'geo', 'composition', 'importer', 'food_type', 'address', 'ingredients', 'nutrition']
const NONE = '해당 없음'
const WAITING = '판매자가 확인 중이에요'
const IMPORT_TEXT = '수입식품안전관리 특별법에 따른 수입신고를 필함'
const plain = (v) => String(v ?? '').replace(/\[예시\]\s*/g, '')

export function readNotice(input) {
  const notice = {}
  for (const key of FIELDS) {
    const value = typeof input?.[key] === 'string' ? input[key].trim().slice(0, 300) : ''
    if (value) notice[key] = value
  }
  notice.imported = input?.imported === true
  return notice
}

// 비어 있는 필수 칸의 이름들
export function noticeMissing(category, notice, product) {
  const n = notice ?? {}
  const required = category === '가공품'
    ? [['food_type', '식품의 유형'], ['address', '생산자 소재지'], ['packed', '제조연월일'], ['expiry', '소비기한 또는 품질유지기한'], ['ingredients', '원재료명·원산지·함량'], ['nutrition', '영양성분']]
    : [['origin', '원산지'], ['expiry', '소비기한 또는 품질유지기한'], ['composition', '상품 구성']]
  const missing = required.filter(([key]) => !n[key]).map(([, name]) => name)
  // 신선 농산물의 제조연월일은 수확일로 갈음할 수 있다
  if (category !== '가공품' && !product?.harvest_date && !n.packed) missing.push('수확일 또는 포장일·생산연도')
  if (n.imported && !n.importer) missing.push('수입자')
  return missing
}

const safety = (item) => {
  if (item.pending) return '담당자가 확인 중이에요'
  const parts = []
  if (item.allergens?.length) parts.push(`알레르기 표시: ${item.allergens.join(', ')}`)
  if (item.allergen_note) parts.push(item.allergen_note)
  return parts.join(' / ') || '보관·섭취 안내를 확인해 주세요'
}

// 상품 페이지에 보여 줄 표. missing 은 아직 안 채운 칸
export function buildNotice(product, item, seller) {
  const n = product.notice ?? {}
  const row = (label, value) => ({ label, value: value || WAITING, missing: !value })
  const filled = (key) => n[key]
  // 판매 옵션(5kg·10kg …)이 있으면 옵션 이름이 포장 단위라 함께 적는다
  const options = product.options?.length ? `옵션: ${product.options.map((o) => o.name).join(', ')}` : null
  const amount = [product.unit, options, product.count_per_box && `${product.count_per_box}개`, product.weight_g && `1개 ${product.weight_g}g 정도`].filter(Boolean).join(' · ')
  const producer = `${plain(seller.name)}${seller.region ? ` (${seller.region})` : ''}${n.imported && n.importer ? ` / 수입자: ${n.importer}` : ''}`
  const imported = n.imported ? [row('수입 신고', IMPORT_TEXT)] : []
  const answered = Boolean(n.origin || n.ingredients) // 판매자가 표를 적은 뒤에는 고르지 않은 표시는 해당 없음
  if (item.category === '가공품') {
    return {
      title: '가공식품',
      rows: [
        row('제품명', plain(product.name)),
        row('식품의 유형', filled('food_type')),
        row('생산자 및 소재지', n.address ? `${producer} · ${n.address}` : ''),
        row('제조연월일', filled('packed')),
        row('소비기한 또는 품질유지기한', filled('expiry')),
        row('포장단위별 용량(중량)·수량', amount),
        row('원재료명·원산지·함량', filled('ingredients')),
        row('영양성분', filled('nutrition')),
        row('유전자변형식품 표시', n.gmo || (answered ? NONE : '')),
        ...imported,
        row('소비자 안전을 위한 주의사항', safety(item)),
        row('소비자 상담 전화', SHOP.phone),
      ],
    }
  }
  const made = [product.harvest_date && `수확일 ${String(product.harvest_date).slice(0, 10)}`, n.packed].filter(Boolean).join(' · ')
  return {
    title: '농수축산물',
    rows: [
      row('품목 또는 명칭', `${item.name} · ${plain(product.name)}`),
      row('포장단위별 용량(중량)·수량·크기', amount),
      row('생산자', producer),
      row('원산지', filled('origin')),
      row('제조연월일 (포장일 또는 생산연도)', made),
      row('소비기한 또는 품질유지기한', filled('expiry')),
      row('유전자변형농산물 표시', n.gmo || (answered ? NONE : '')),
      row('지리적 표시', n.geo || (answered ? NONE : '')),
      ...imported,
      row('상품 구성', filled('composition')),
      row('보관 방법 또는 취급 방법', item.pending ? '담당자가 확인 중이에요' : item.storage_method),
      row('소비자 안전을 위한 주의사항', safety(item)),
      row('소비자 상담 전화', SHOP.phone),
    ],
  }
}
