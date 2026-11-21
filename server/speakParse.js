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

// 고유어 숫자: "서른 상자" "스무 개" "열다섯 봉지" "세 포기" (어르신이 상자·포기를 셀 때 자주 쓴다)
const TENS = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 }
const ONES = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 }
const NATIVE = `(?:${Object.keys(TENS).join('|')})(?:${Object.keys(ONES).join('|')})?|${Object.keys(ONES).join('|')}`
export function nativeNumber(raw) {
  const m = String(raw ?? '').replace(/\s/g, '').match(new RegExp(`^(${Object.keys(TENS).join('|')})?(${Object.keys(ONES).join('|')})?$`))
  if (!m || (!m[1] && !m[2])) return null
  return (TENS[m[1]] ?? 0) + (ONES[m[2]] ?? 0)
}
// 아라비아 숫자 · 한자어 숫자(오, 십, 오백) · 고유어 숫자(서른, 스무) 모두
const COUNT = `\\d+|${NATIVE}|[일이삼사오육칠팔구십백]+`
const anyNumber = (raw) => (/^\d/.test(raw) ? Number(raw) : nativeNumber(raw) ?? koreanNumber(raw))

// 무게: "5키로" "오키로" "십 키로" "오백 그람" "3kg" "7.5키로"
const WEIGHT = /(\d+(?:\.\d+)?|[일이삼사오육칠팔구십백]+)\s*(kg|키로|킬로|k(?![a-z])|g(?![a-z])|그램|그람)/gi
const normWeight = (n, u) => {
  const v = anyNumber(n)
  return v ? (/^(g|그램|그람)$/i.test(u) ? `${v}g` : `${v}kg`) : null
}
const weightsIn = (text) => [...String(text).matchAll(WEIGHT)].map((m) => ({ name: normWeight(m[1], m[2]), index: m.index, end: m.index + m[0].length })).filter((w) => w.name)
const BOX = /(상자|박스|box)/i
// 망 · 포기 · 단처럼 무게 없이 파는 단위: "세 포기 한 망" → "1망 (3포기)"
const PACK = new RegExp(`(${COUNT})\\s*(망|단|봉지|봉|팩|박스|상자)`, 'g')
const PIECE = new RegExp(`(${COUNT})\\s*(포기|개|송이|과|알|통)`, 'g')
// 품목 이름에 붙일 흔한 품종 (품목 기준표에 없더라도 이름에는 쓴다)
const VARIETY_WORDS = ['부사', '후지', '홍로', '아오리', '감홍', '시나노골드', '신고', '원황', '화산', '설향', '금실', '매향', '킹스베리', '샤인머스캣', '캠벨', '거봉', '대봉', '부유', '한라봉', '천혜향', '레드향', '황금향', '백도', '황도', '천중도', '호박고구마', '꿀고구마', '밤고구마', '홍감자', '수미']
// 이름 앞에 붙이면 안 되는 군말
const FILLER = /^(그냥|우리|저희|올해|이번|직접|맛있는|좋은|싱싱한|뭐냐|그거|이거|저거|저기|있잖아|그러니까|그게|에|음|어|아)$/

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

// 무게마다 그 뒤(다음 무게 전까지)에 나오는 첫 가격을 짝지어 옵션을 만든다
//  "3키로는 2만원 5키로는 3만원" 처럼 쉼표 없이 이어 말해도 두 옵션이 된다. 가격 없이 지나간 무게("한 3, 5키로에다가")는 건너뛴다
function priceLines(text) {
  const weights = weightsIn(text)
  const money = moneyIn(text)
  const box = BOX.test(text) ? ' 1박스' : ''
  const lines = []
  weights.forEach((w, i) => {
    const until = weights[i + 1]?.index ?? Infinity
    const inRange = money.filter((x) => x.index >= w.end && x.index < until)
    // 말을 고친 경우 ("3만 원, 아니 3만 5천 원") 고친 뒤 가격을 쓴다
    const fixed = inRange.length > 1 && /아니|말고|아이고/.test(String(text).slice(inRange[0].end, inRange.at(-1).index))
    const m = fixed ? inRange.at(-1) : inRange[0]
    if (m) lines.push({ name: `${w.name}${box}`, price: m.value })
  })
  // 무게가 하나뿐이고 가격이 그 앞에 나오면 ("삼만원짜리 5키로") 그 가격을 쓴다
  if (!lines.length && weights.length === 1 && money.length === 1) lines.push({ name: `${weights[0].name}${box}`, price: money[0].value })
  // 같은 무게가 두 번 나오면 처음 것만
  return lines.filter((l, i) => lines.findIndex((x) => x.name === l.name) === i)
}
// 무게 없이 파는 단위 ("세 포기 한 망" → "1망 (3포기)")
function packUnit(text) {
  const pack = [...String(text).matchAll(PACK)][0]
  const piece = [...String(text).matchAll(PIECE)].find((m) => !/있|준비|남|돼|나와/.test(String(text).slice(m.index + m[0].length, m.index + m[0].length + 4)))
  const n = (m) => anyNumber(m[1])
  if (pack && n(pack)) return `${n(pack)}${pack[2] === '상자' ? '박스' : pack[2]}${piece && n(piece) ? ` (${n(piece)}${piece[2]})` : ''}`
  if (piece && n(piece)) return `${n(piece)}${piece[2]}`
  return null
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
    const w = weightsIn(t)[0]
    if (w) out.unit = `${w.name}${BOX.test(t) ? ' 1박스' : ''}`
    else {
      const unit = packUnit(t)
      if (unit) out.unit = unit
    }
  }

  const brix = t.match(/당도\s*(?:는|가|이|도)?\s*(?:한|약|대략|거의|보통|평균)?\s*(\d{1,2}(?:\.\d)?)|(\d{1,2}(?:\.\d)?)\s*(?:브릭스|brix|bx)/i)
  if (brix) {
    const v = Number(brix[1] ?? brix[2])
    if (v >= 1 && v <= 40) out.brix = String(v)
  }
  // 재고: "20상자 있어요" "서른 상자 있어" "한 스무 상자 돼" "재고 50"
  const stock = t.match(new RegExp(`재고\\s*(?:는|가)?\\s*(\\d{1,5})|(${COUNT})\\s*(?:상자|박스|개|팩|봉지?|망|단|kg|키로)\\s*(?:정도\\s*|쯤\\s*)?(?:있|준비|팔|남|돼|되|나와|나옵|가능)`))
  if (stock && !out.options) {
    const v = stock[1] ? Number(stock[1]) : anyNumber(stock[2])
    if (v && v <= 99999) out.stock = String(v)
  }
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
    // 품종이 어디에 있든 (사과가 부사인데) 흔한 품종 이름이면 이름 앞에
    const word = VARIETY_WORDS.find((v) => t.includes(v) && !item.name.includes(v))
    const before = t.slice(0, Math.max(0, t.indexOf(item.name))).trim().match(/([가-힣]{2,5})$/)?.[1]
    const lead = variety && !item.name.includes(variety) ? variety : word ?? (before && !FILLER.test(before) && !/[요고]$/.test(before) ? before : '')
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
