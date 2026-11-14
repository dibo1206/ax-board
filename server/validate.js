// 관리자 화면에서 들어온 상품 입력 검사. 데이터 불러오기 스크립트와 같은 규칙을 쓴다.
import { randomBytes } from 'node:crypto'
import { blocksText, readBlocks } from './blocks.js'
import { readNotice } from './notice.js'

export const FORBIDDEN = ['면역력', '다이어트', '치료', '예방', '해독', '항암', '혈압', '혈당']
export const MAX_OPTIONS = 20 // 상품 하나의 판매 옵션 수
export const MAX_PREORDER_DAYS = 180 // 예약 판매 출고 시작일은 오늘부터 이 날짜 안
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const isCode = (v) => /^[a-z0-9_]+$/.test(v)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

// 통과하면 { product }, 아니면 { errors: [사람이 읽을 문장] }
// findBanned: 서버는 금지어 사전(banned.js), 데이터 불러오기 스크립트는 기본 목록
const defaultFindBanned = (value) => FORBIDDEN.filter((w) => value.includes(w))
// itemRanges: 판매자 입력만 품목별 보통 당도 범위로 검사한다 (Map 품목 코드 → {name, min, max}). 관리자는 넘기지 않음
export function validateProduct(input, { itemCodes, sellerCodes, tagCodes, isNew, findBanned = defaultFindBanned, itemRanges = null }) {
  const errors = []
  const p = {
    // 새 상품의 코드는 비어 있으면 서버가 만든다 (판매자는 코드를 몰라도 된다)
    product_code: text(input.product_code) || (isNew ? `p_${randomBytes(5).toString('hex')}` : ''),
    seller_code: text(input.seller_code),
    item_code: text(input.item_code),
    name: text(input.name),
    price: text(input.price),
    unit: text(input.unit),
    stock: text(input.stock),
    weight_g: text(input.weight_g),
    count_per_box: text(input.count_per_box),
    brix: text(input.brix),
    variety: text(input.variety).slice(0, 30),
    brix_measured_at: text(input.brix_measured_at),
    harvest_date: text(input.harvest_date),
    // 예약 판매: 이 날짜부터 보낸다 (오늘보다 뒤면 예약 상품). 비우면 결제 후 바로 보내는 상품
    ship_from: text(input.ship_from),
    summary: text(input.summary),
    description: text(input.description),
    external_url: text(input.external_url),
    b2b_available: Boolean(input.b2b_available),
    tags: Array.isArray(input.tags) ? input.tags.map(text).filter(Boolean) : [],
    status: ['draft', 'pending'].includes(input.status) ? input.status : 'active',
    review_note: text(input.review_note) || null,
    // 자주 묻는 질문 [{q, a}] (AI 초안을 판매자가 고쳐서 저장)
    notice: readNotice(input.notice), // 상품정보 제공 고시
    faq: (Array.isArray(input.faq) ? input.faq : []).slice(0, 7).map((f) => ({ q: text(f?.q), a: text(f?.a) })).filter((f) => f.q || f.a),
    // 판매 옵션 [{id, name, price, stock, status}] (예: 5kg·10kg). 보내지 않으면(null) 저장된 옵션을 그대로 둔다
    options: Array.isArray(input.options)
      ? input.options.slice(0, MAX_OPTIONS + 1).map((o) => ({
        id: /^\d{1,9}$/.test(text(o?.id)) ? Number(o.id) : null,
        name: text(o?.name),
        price: text(o?.price),
        stock: text(o?.stock),
        status: o?.status === 'stopped' ? 'stopped' : 'active',
      }))
      : null,
  }
  // 블록형 상세페이지 (server/blocks.js): 사진은 이 상품에 올린 파일만
  const readBlocksResult = readBlocks(input.detail_blocks, p.product_code)
  if (readBlocksResult.errors) errors.push(...readBlocksResult.errors)
  p.detail_blocks = readBlocksResult.blocks ?? []

  // 옵션이 있으면 가격·재고는 옵션마다 적는다. 상품 가격·재고는 판매 중 옵션의 최저가·재고 합으로 맞춘다 (server/options.js)
  if (p.options?.length) {
    const before = errors.length
    if (p.options.length > MAX_OPTIONS) errors.push(`옵션은 ${MAX_OPTIONS}개까지 만들 수 있어요.`)
    if (p.options.some((o) => !o.name || o.name.length > 30)) errors.push('옵션 이름을 30자 안으로 적어 주세요. (예: 5kg 1박스)')
    if (new Set(p.options.map((o) => o.name)).size !== p.options.length) errors.push('같은 이름의 옵션이 두 개 있어요.')
    if (p.options.some((o) => !/^\d+$/.test(o.price) || Number(o.price) === 0)) errors.push('옵션 가격은 0보다 큰 숫자(원)만 적어 주세요.')
    if (p.options.some((o) => !/^\d+$/.test(o.stock))) errors.push('옵션 재고는 숫자만 적어 주세요. 없으면 0')
    const active = p.options.filter((o) => o.status === 'active')
    if (errors.length === before) {
      // 판매 중 옵션이 없으면(모두 판매 중지) 품절로 보이고, 가격 칸은 비워 둘 수 없어서 옵션 중 최저가를 둔다
      p.price = String(Math.min(...(active.length ? active : p.options).map((o) => Number(o.price))))
      p.stock = String(active.reduce((sum, o) => sum + Number(o.stock), 0))
    }
  }

  if (isNew && !isCode(p.product_code)) errors.push('상품 코드는 영문 소문자·숫자·밑줄만 쓸 수 있어요.')
  if (!p.name) errors.push('상품 이름을 적어 주세요.')
  if (!p.unit) errors.push('판매 단위를 적어 주세요. (예: 5kg 1박스)')
  // 상품 글은 AI 상담 자료로도 들어가므로 길이를 제한한다 (긴 지시문을 숨겨 넣는 것 방지)
  for (const [key, label, max] of [['name', '상품 이름', 60], ['unit', '판매 단위', 30], ['summary', '한 줄 소개', 200], ['description', '상품 설명', 3000], ['external_url', '판매 링크', 300]]) {
    if (p[key].length > max) errors.push(`${label}은(는) ${max}자 안으로 적어 주세요.`)
  }
  if (!itemCodes.has(p.item_code)) errors.push('품목을 골라 주세요.')
  if (!sellerCodes.has(p.seller_code)) errors.push('판매 농가를 골라 주세요.')
  if (!p.options?.length) {
    if (!/^\d+$/.test(p.price) || Number(p.price) === 0) errors.push('가격은 0보다 큰 숫자(원)만 적어 주세요.')
    if (!/^\d+$/.test(p.stock)) errors.push('재고는 숫자만 적어 주세요. 없으면 0')
  }
  for (const [key, label] of [['weight_g', '1개 무게'], ['count_per_box', '박스당 개수']]) {
    if (p[key] && !/^\d+$/.test(p[key])) errors.push(`${label}는 숫자만 적어 주세요.`)
  }
  if (p.brix) {
    if (!/^\d+(\.\d)?$/.test(p.brix)) errors.push('당도는 숫자만 적어 주세요. (예: 14.8)')
    else if (Number(p.brix) === 0) errors.push('당도를 모르면 0 대신 비워 두세요.')
  }
  for (const [key, label] of [['brix_measured_at', '당도 잰 날'], ['harvest_date', '수확일'], ['ship_from', '출고 시작일']]) {
    if (p[key] && !isDate(p[key])) errors.push(`${label}는 2026-10-17 형식으로 적어 주세요.`)
  }
  // 거짓 표시 막기: 날짜끼리 맞는지 (오늘은 한국 날짜), 당도를 적으면 잰 날도
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const dated = (key) => p[key] && isDate(p[key])
  if (dated('harvest_date') && p.harvest_date > today) errors.push('수확일이 오늘보다 뒤예요. 날짜를 확인해 주세요.')
  if (dated('brix_measured_at') && p.brix_measured_at > today) errors.push('당도 잰 날이 오늘보다 뒤예요. 날짜를 확인해 주세요.')
  if (p.brix && !p.brix_measured_at) errors.push('당도를 적으면 잰 날도 적어 주세요.')
  if (dated('harvest_date') && dated('brix_measured_at') && p.brix_measured_at < p.harvest_date) {
    errors.push('당도를 수확일보다 먼저 잰 것으로 되어 있어요. 날짜를 확인해 주세요.')
  }
  // 예약은 반년 안까지만 (손님 돈을 너무 오래 묶지 않게) [가설: 기간은 회사가 정함]
  if (dated('ship_from') && p.ship_from > addDays(today, MAX_PREORDER_DAYS)) errors.push(`출고 시작일은 오늘부터 ${MAX_PREORDER_DAYS}일 안으로 적어 주세요.`)
  const range = itemRanges?.get(p.item_code)
  if (range && /^\d+(\.\d)?$/.test(p.brix) && ((range.min != null && Number(p.brix) < range.min) || (range.max != null && Number(p.brix) > range.max))) {
    errors.push(`${range.name} 당도는 보통 ${range.min ?? '?'}~${range.max ?? '?'}Brix예요. 측정값이 맞으면 회사에 문의해 주세요.`)
  }
  if (p.external_url && !/^https?:\/\//.test(p.external_url)) errors.push('판매 링크는 http로 시작해야 해요.')
  const unknown = p.tags.filter((t) => !tagCodes.has(t))
  if (unknown.length) errors.push(`없는 태그예요: ${unknown.join(', ')}`)
  if (p.faq.length > 6) errors.push('자주 묻는 질문은 6개까지 적어 주세요.')
  if (p.faq.some((f) => !f.q || !f.a || f.q.length > 100 || f.a.length > 300)) errors.push('자주 묻는 질문은 질문(100자)과 답(300자)을 모두 적어 주세요.')
  const all = `${p.name} ${(p.options ?? []).map((o) => o.name).join(' ')} ${p.summary} ${p.description} ${p.faq.map((f) => `${f.q} ${f.a}`).join(' ')} ${Object.values(p.notice).filter((v) => typeof v === 'string').join(' ')} ${blocksText(p.detail_blocks)}`
  const bad = findBanned(all)
  if (bad.length) errors.push(`효능 표현은 쓰지 않아요: ${bad.join(', ')}`)
  if (p.review_note && p.review_note.length > 300) errors.push('반려 사유는 300자 안으로 적어 주세요.')

  if (errors.length) return { errors }
  const orNull = (v) => (v === '' ? null : v)
  return {
    product: {
      ...p,
      price: Number(p.price),
      stock: Number(p.stock),
      weight_g: orNull(p.weight_g),
      count_per_box: orNull(p.count_per_box),
      brix: orNull(p.brix),
      variety: orNull(p.variety),
      brix_measured_at: orNull(p.brix_measured_at),
      harvest_date: orNull(p.harvest_date),
      ship_from: orNull(p.ship_from),
      summary: orNull(p.summary),
      description: orNull(p.description),
      external_url: orNull(p.external_url),
      options: p.options && p.options.map((o) => ({ ...o, price: Number(o.price), stock: Number(o.stock) })),
    },
  }
}
