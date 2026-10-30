// 관리자 화면에서 들어온 상품 입력 검사. 데이터 불러오기 스크립트와 같은 규칙을 쓴다.
export const FORBIDDEN = ['면역력', '다이어트', '치료', '예방', '해독', '항암', '혈압', '혈당']

const isCode = (v) => /^[a-z0-9_]+$/.test(v)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

// 통과하면 { product }, 아니면 { errors: [사람이 읽을 문장] }
// findBanned: 서버는 금지어 사전(banned.js), 데이터 불러오기 스크립트는 기본 목록
const defaultFindBanned = (value) => FORBIDDEN.filter((w) => value.includes(w))
export function validateProduct(input, { itemCodes, sellerCodes, tagCodes, isNew, findBanned = defaultFindBanned }) {
  const errors = []
  const p = {
    product_code: text(input.product_code),
    seller_code: text(input.seller_code),
    item_code: text(input.item_code),
    name: text(input.name),
    price: text(input.price),
    unit: text(input.unit),
    stock: text(input.stock),
    weight_g: text(input.weight_g),
    count_per_box: text(input.count_per_box),
    brix: text(input.brix),
    brix_measured_at: text(input.brix_measured_at),
    harvest_date: text(input.harvest_date),
    summary: text(input.summary),
    description: text(input.description),
    external_url: text(input.external_url),
    b2b_available: Boolean(input.b2b_available),
    tags: Array.isArray(input.tags) ? input.tags.map(text).filter(Boolean) : [],
    status: ['draft', 'pending'].includes(input.status) ? input.status : 'active',
    review_note: text(input.review_note) || null,
    // 자주 묻는 질문 [{q, a}] (AI 초안을 판매자가 고쳐서 저장)
    faq: (Array.isArray(input.faq) ? input.faq : []).slice(0, 7).map((f) => ({ q: text(f?.q), a: text(f?.a) })).filter((f) => f.q || f.a),
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
  if (!/^\d+$/.test(p.price) || Number(p.price) === 0) errors.push('가격은 0보다 큰 숫자(원)만 적어 주세요.')
  if (!/^\d+$/.test(p.stock)) errors.push('재고는 숫자만 적어 주세요. 없으면 0')
  for (const [key, label] of [['weight_g', '1개 무게'], ['count_per_box', '박스당 개수']]) {
    if (p[key] && !/^\d+$/.test(p[key])) errors.push(`${label}는 숫자만 적어 주세요.`)
  }
  if (p.brix) {
    if (!/^\d+(\.\d)?$/.test(p.brix)) errors.push('당도는 숫자만 적어 주세요. (예: 14.8)')
    else if (Number(p.brix) === 0) errors.push('당도를 모르면 0 대신 비워 두세요.')
  }
  for (const [key, label] of [['brix_measured_at', '당도 잰 날'], ['harvest_date', '수확일']]) {
    if (p[key] && !isDate(p[key])) errors.push(`${label}는 2026-10-17 형식으로 적어 주세요.`)
  }
  if (p.external_url && !/^https?:\/\//.test(p.external_url)) errors.push('판매 링크는 http로 시작해야 해요.')
  const unknown = p.tags.filter((t) => !tagCodes.has(t))
  if (unknown.length) errors.push(`없는 태그예요: ${unknown.join(', ')}`)
  if (p.faq.length > 6) errors.push('자주 묻는 질문은 6개까지 적어 주세요.')
  if (p.faq.some((f) => !f.q || !f.a || f.q.length > 100 || f.a.length > 300)) errors.push('자주 묻는 질문은 질문(100자)과 답(300자)을 모두 적어 주세요.')
  const all = `${p.name} ${p.summary} ${p.description} ${p.faq.map((f) => `${f.q} ${f.a}`).join(' ')}`
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
      brix_measured_at: orNull(p.brix_measured_at),
      harvest_date: orNull(p.harvest_date),
      summary: orNull(p.summary),
      description: orNull(p.description),
      external_url: orNull(p.external_url),
    },
  }
}
