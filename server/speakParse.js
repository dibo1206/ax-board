// 말로 상품 등록하기 (2026-11-21): 농가가 말하듯 적은(또는 말한) 한 문장에서 상품 칸을 뽑는다
//  예) "부사 사과 5키로 한 상자 3만 원, 10키로는 5만5천 원. 당도 14. 어제 땄어요. 20상자 있어요"
//  - 규칙으로 먼저 뽑는다 (AI 0회, 같은 말이면 언제나 같은 결과). 품목이나 가격을 못 찾을 때만 AI 에게 묻는다 (server/content.js productParse)
//  - 숫자(가격·무게·당도·재고·날짜)는 농가가 말한 것만 쓴다. AI 가 준 숫자도 원래 문장에 있는 숫자인지 다시 확인한다 (moneyIn · numbersIn)
//  - 칸을 채우기만 하고 저장·판매 요청은 하지 않는다. 화면이 "채운 칸 / 비어 있는 칸"을 보여 주고 농가가 확인한다
// DB·파일을 쓰지 않는 순수 함수만 → scripts/speak-test.js 에서 DB 없이 시험

const HANGUL_DIGIT = { 영: 0, 공: 0, 일: 1, 한: 1, 이: 2, 두: 2, 삼: 3, 세: 3, 사: 4, 네: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 }
const UNIT = { 십: 10, 백: 100, 천: 1000 }

// "5만5천" · "오만 오천" · "55,000" · "3.5만" · "만" → 숫자 (모르면 null)
export function koreanNumber(raw) {
  const s = String(raw ?? '').replace(/[\s,]/g, '')
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  let total = 0
  let section = 0 // 만 아래 자리
  let digit = null
  let i = 0
  while (i < s.length) {
    const num = s.slice(i).match(/^\d+(\.\d+)?/)
    if (num) { digit = Number(num[0]); i += num[0].length; continue }
    const ch = s[i]
    if (ch in HANGUL_DIGIT) { digit = HANGUL_DIGIT[ch]; i += 1; continue }
    if (ch in UNIT) { section += (digit ?? 1) * UNIT[ch]; digit = null; i += 1; continue }
    if (ch === '만') { total += (section + (digit ?? (section ? 0 : 1))) * 10000; section = 0; digit = null; i += 1; continue }
    return null
  }
  const value = total + section + (digit ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

const N = '(?:\\d[\\d,]*(?:\\.\\d+)?|[일이삼사오육칠팔구한두세네])'
// 돈: "3만 원" "5만5천원" "만오천원" "55,000원" "오만 오천 원" "3만" (뒤에 원이 없어도 만 단위면 돈으로 본다.
// 앞에 숫자 없는 "만"은 뒤에 천·원이 올 때만 — "만든" 같은 말을 돈으로 읽지 않게)
const MONEY = new RegExp(`(만\\s*${N}?\\s*천(?:\\s*${N}?\\s*백)?|만(?=\\s*원)|${N}\\s*만(?:\\s*${N}?\\s*천)?(?:\\s*${N}?\\s*백)?|${N}\\s*천(?:\\s*${N}?\\s*백)?|\\d[\\d,]{2,})\\s*(원)?`, 'g')
export function moneyIn(text) {
  const found = []
  for (const m of String(text ?? '').matchAll(MONEY)) {
    const value = koreanNumber(m[1])
    const isWon = Boolean(m[2]) || /만/.test(m[1])
    if (value && isWon && value >= 500 && value <= 10_000_000) found.push({ value, index: m.index, end: m.index + m[0].length })
  }
  return found
}
// 문장 안의 모든 숫자 (AI 가 준 숫자가 원래 말에 있었는지 확인할 때)
export function numbersIn(text) {
  const set = new Set(moneyIn(text).map((m) => m.value))
  for (const m of String(text ?? '').matchAll(/\d+(?:\.\d+)?/g)) set.add(Number(m[0]))
  return set
}

const WEIGHT = /(\d+(?:\.\d+)?)\s*(kg|키로|킬로|k\b|g|그램)/gi
const normWeight = (n, u) => (/^(g|그램)$/i.test(u) ? `${Number(n)}g` : `${Number(n)}kg`)
const BOX = /(상자|박스|box)/i

// 품목 찾기: 이름이 긴 것부터 (절임배추가 배추보다, 배즙이 배보다 먼저). 품종 이름으로도 찾는다 (부사 → 사과)
export function findItem(text, items) {
  const t = String(text ?? '')
  const byName = [...items].sort((a, b) => b.name.length - a.name.length).find((i) => t.includes(i.name))
  if (byName) return byName
  return items.find((i) => (i.brix_standards ?? []).some((s) => (s.varieties ?? []).some((v) => v !== '공통' && v.length >= 2 && t.includes(v)))) ?? null
}
function findVariety(text, item) {
  const list = (item?.brix_standards ?? []).flatMap((s) => s.varieties ?? []).filter((v) => v !== '공통' && v.length >= 2)
  return list.find((v) => String(text).includes(v)) ?? null
}

// 쉼표·마침표·그리고 단위로 나눈 구절마다 무게와 돈을 짝지어 옵션을 만든다
function priceLines(text) {
  const clauses = String(text).split(/[,，\n/]|\.(?!\d)|그리고|랑\s|하고\s|이고\s/)
  const lines = []
  for (const c of clauses) {
    const w = [...c.matchAll(WEIGHT)][0]
    const money = moneyIn(c)[0]
    if (w && money) lines.push({ name: `${normWeight(w[1], w[2])}${BOX.test(c) || BOX.test(text) ? ' 1박스' : ''}`, price: money.value })
  }
  // 같은 무게가 두 번 나오면 처음 것만
  return lines.filter((l, i) => lines.findIndex((x) => x.name === l.name) === i)
}

// 수확일: "오늘/어제/그제/지난주/3일 전/11월 15일" + 수확·땄·캤 같은 말이 있을 때만
const pad = (n) => String(n).padStart(2, '0')
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export function harvestDate(text, today) {
  const t = String(text ?? '')
  if (!/수확|땄|따서|딴|캤|캐서|캔|베었|거뒀/.test(t)) return null
  if (/오늘/.test(t)) return today
  if (/어제/.test(t)) return addDays(today, -1)
  if (/그제|그저께/.test(t)) return addDays(today, -2)
  if (/지난\s*주/.test(t)) return addDays(today, -7)
  const ago = t.match(/(\d+)\s*일\s*전/)
  if (ago && Number(ago[1]) <= 60) return addDays(today, -Number(ago[1]))
  const md = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (md) {
    const y = Number(today.slice(0, 4))
    let day = `${y}-${pad(md[1])}-${pad(md[2])}`
    if (Number.isNaN(Date.parse(day))) return null
    if (day > today) day = `${y - 1}-${pad(md[1])}-${pad(md[2])}` // 앞으로 올 날짜면 작년
    return day
  }
  return null
}

// 규칙으로 뽑기. items: [{ item_code, name, category, brix_standards }], today: 'YYYY-MM-DD' (한국 날짜)
export function parseSpoken(text, items, today) {
  const t = String(text ?? '').slice(0, 500)
  const out = {}
  const item = findItem(t, items)
  if (item) out.item_code = item.item_code
  const variety = findVariety(t, item)
  if (variety) out.variety = variety

  const lines = priceLines(t)
  if (lines.length >= 2) {
    out.options = lines.map((l) => ({ name: l.name, price: String(l.price), stock: '' }))
    out.unit = lines[0].name
  } else if (lines.length === 1) {
    out.price = String(lines[0].price)
    out.unit = lines[0].name
  } else {
    const money = moneyIn(t)
    if (money.length === 1) out.price = String(money[0].value)
    const w = [...t.matchAll(WEIGHT)][0]
    if (w) out.unit = `${normWeight(w[1], w[2])}${BOX.test(t) ? ' 1박스' : ''}`
  }

  const brix = t.match(/당도\s*(?:는|가|이|도)?\s*(\d{1,2}(?:\.\d)?)|(\d{1,2}(?:\.\d)?)\s*(?:브릭스|brix|bx)/i)
  if (brix) {
    const v = Number(brix[1] ?? brix[2])
    if (v >= 1 && v <= 40) out.brix = String(v)
  }
  const stock = t.match(/재고\s*(?:는|가)?\s*(\d{1,5})|(\d{1,5})\s*(?:상자|박스|개|팩|봉지?|kg|키로)\s*(?:정도\s*)?(?:있|준비|팔|남)/)
  if (stock && !out.options) out.stock = String(Number(stock[1] ?? stock[2]))
  const count = t.match(/(\d{1,3})\s*(?:개|과|입|알|송이)\s*(?:들이|정도|내외|짜리)?/)
  if (count && !/있|준비|팔|남/.test(t.slice(count.index, count.index + count[0].length + 4))) out.count_per_box = String(Number(count[1]))
  const harvest = harvestDate(t, today)
  if (harvest) out.harvest_date = harvest
  if (out.brix && out.harvest_date) out.brix_measured_at = out.harvest_date

  // 상품 이름: 품종 + 품목 + 무게들 (예: 부사 사과 5kg·10kg)
  if (item) {
    const weights = (out.options ?? []).map((o) => o.name.replace(' 1박스', ''))
    const single = out.unit ? out.unit.replace(' 1박스', '') : ''
    const size = weights.length ? weights.join('·') : single
    // 품목 이름 바로 앞 낱말(품종·산지: 부사 · 설향 · 해남)을 이름 앞에 붙인다. 품종 목록에 있으면 그 품종으로
    const before = t.slice(0, Math.max(0, t.indexOf(item.name))).trim().match(/([가-힣]{2,5})$/)?.[1]
    const lead = variety && !item.name.includes(variety) ? variety : before && !/^(그냥|우리|저희|올해|이번|직접|맛있는)$/.test(before) ? before : ''
    out.name = [lead, item.name, size].filter(Boolean).join(' ')
  }
  return out
}

// AI 가 준 값 확인: 품목은 목록에 있는 것만, 숫자는 원래 말에 있는 것만 (없으면 버린다)
export function checkAiFields(ai, text, items, today) {
  const nums = numbersIn(text)
  const okNum = (v) => v != null && v !== '' && nums.has(Number(v))
  const out = {}
  if (ai?.item_code && items.some((i) => i.item_code === ai.item_code)) out.item_code = ai.item_code
  if (typeof ai?.name === 'string' && ai.name.trim()) out.name = ai.name.trim().slice(0, 60)
  if (okNum(ai?.price)) out.price = String(Number(ai.price))
  if (typeof ai?.unit === 'string' && ai.unit.trim()) out.unit = ai.unit.trim().slice(0, 30)
  if (Array.isArray(ai?.options)) {
    const opts = ai.options.filter((o) => o && typeof o.name === 'string' && okNum(o.price)).slice(0, 10)
      .map((o) => ({ name: o.name.trim().slice(0, 30), price: String(Number(o.price)), stock: '' }))
    if (opts.length >= 2) out.options = opts
  }
  if (okNum(ai?.brix) && Number(ai.brix) <= 40) out.brix = String(Number(ai.brix))
  if (okNum(ai?.stock)) out.stock = String(Number(ai.stock))
  // 날짜는 AI 를 믿지 않고 규칙으로만
  const harvest = harvestDate(text, today)
  if (harvest) out.harvest_date = harvest
  return out
}
