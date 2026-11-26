// 상품 하나를 콕 집어 묻는 말에 AI 없이 답한다 (2026-11-26, 새 질문 100개에서 [AI에게 물어보기]가 41번 뜬 것을 줄이려고)
// 1) 품목 이름(포도·표고버섯)이 아니라 상품 이름(샤인머스캣·레몬베이스·화고·홍로)으로 물어도 그 상품을 찾는다
// 2) 소비기한·원재료·영양 성분·"이게 뭐예요?"·몇 포인지는 상품에 적힌 칸(notice·summary·옵션) 그대로 답한다
// 3) 그래도 규칙이 없으면 상품 설명 글에서 질문 낱말이 든 문장을 찾아 그대로 보여 준다 ("대파 흙 묻어서 와요?" → "흙째 보내는 겨울 대파")
// 4) 품목 없이 값만 말한 질문("제일 싼 거", "만원 이하 과일")은 판매 중 상품을 싼 순으로 보여 준다
// 모두 DB에 적힌 글을 그대로 옮기고 지어내지 않는다. 값이 비었거나 '[예시]·회사 확인 필요'면 정보가 없다고 말한다
import { blocksText } from './blocks.js'
import { COMPANY_CAPTION, DEMO_CAPTION } from './demoPlan.js'
import { SHOP } from './policy.js'

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
const label = (p) => p.name.replace(/\[예시\]\s*/g, '').trim()
const hasBatchim = (word) => {
  const code = String(word).trim().slice(-1).charCodeAt(0)
  return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : /[013678lmn]$/i.test(String(word).trim())
}
const josa = (word, withBatchim, without) => `${word}${hasBatchim(word) ? withBatchim : without}`
const reply = (model, answer, products, extra = {}) => ({
  answer,
  sources: products.map((p) => ({ code: p.product_code, name: p.name })),
  productCode: products[0]?.product_code ?? null,
  handoff: false,
  action: null,
  model,
  blocked: false,
  ...extra,
})

// ---------- 1. 상품 이름으로 찾기 ----------
// 상품 이름에서 무게·괄호·[예시] 같은 것을 빼고 낱말로 나눈다. "[윤주톡톡] 레몬베이스 1.9kg" → 레몬베이스
const SPELLING = [[/머스켓/g, '머스캣'], [/패션\s?(프루트|후루츠|푸르트)/g, '패션후르츠'], [/화고버섯/g, '화고'], [/표고\s버섯/g, '표고버섯'], [/샤인\s(머스캣)/g, '샤인$1'],
  // "농축액 팔아?"가 '안 팔아요'로 가던 것 (2026-11-26): 품목 이름(과일 농축액 베이스)을 다 말하지 않아도 그 품목으로
  [/(과일\s?)?농축액(\s?베이스)?|(음료|에이드|과일|카페)\s?베이스(?!\S)/g, '과일 농축액 베이스']]
export const spell = (text) => SPELLING.reduce((s, [re, to]) => s.replace(re, to), String(text ?? ''))
// 이름에 흔히 붙는 말: 이것만 맞아서는 상품을 찾았다고 보지 않는다 (점수에는 조금 보탠다)
const COMMON = new Set(['선물', '세트', '선물세트', '가정용', '업소용', '소포장', '맛보기', '예약', '김장', '김장용', '상과', '특과', '대과', '중과', '소과',
  '흠과', '송이', '국산', '과일', '채소', '야채', '냉동', '베이스', '세트', '햇', '프리미엄', '명품', '미니', '특선', '대용량', '파지', '못난이', '혼합', '국물용', '장아찌용', '양념용', '작년', '한입', '꼬마', '알포도'])
const nameWords = (p) => label(p).replace(/\[[^\]]*\]/g, ' ').replace(/\(([^)]*)\)/g, ' $1 ')
  .replace(/\d+(?:\.\d+)?\s*(kg|g|l|ml|포|병|개|포기|송이|단|봉|상자|박스)?/gi, ' ')
  .split(/[\s·,~]+/).map((w) => w.trim()).filter((w) => w.length >= 2)
// 농가가 있는 지역 이름(거창·청송·제주…)은 여러 상품에 붙어 있고 "제주도 배송돼요?"처럼 상품과 상관없이도 나온다
const regionWords = (catalog) => new Set(catalog.products.flatMap((p) => String(p.seller_region ?? '').split(/\s+/))
  .map((w) => w.replace(/(특별자치도|광역시|특별시|시|군|구|면|읍|리|도)$/, '')).filter((w) => w.length >= 2).concat(['제주']))

export function findNamedProducts(message, catalog) {
  const said = spell(message).replace(/\s+/g, '')
  if (!said) return []
  const regions = regionWords(catalog)
  const itemNames = new Set(catalog.items.map((i) => i.name))
  const scored = []
  for (const p of catalog.products) {
    let score = 0
    let special = false
    let matched = 0
    const words = new Set(nameWords(p))
    for (const w of words) {
      if (!said.includes(w)) continue
      const weak = COMMON.has(w) || regions.has(w) || itemNames.has(w)
      matched += 1
      score += weak ? 1 : w.length + 1
      if (!weak) special = true
    }
    // 무게까지 말했으면 그 무게 상품에 1점 ("샤인머스캣 2kg")
    const amount = said.match(/(\d+(?:\.\d+)?)(kg|키로|킬로|g)/i)
    if (amount && new RegExp(`(?<![\\d.])${amount[1].replace('.', '\\.')}\\s*${/g$/i.test(amount[2]) && !/kg/i.test(amount[2]) ? 'g' : 'kg'}`, 'i').test(p.name)) score += 1
    // 흔한 말뿐이어도 이름 낱말을 모두 말했으면 그 상품이다 ("딸기 베이스")
    if (!special && matched >= 2 && matched === words.size) special = true
    if (special) scored.push({ p, score })
  }
  if (!scored.length) return []
  const best = Math.max(...scored.map((x) => x.score))
  return scored.filter((x) => x.score === best).map((x) => x.p).sort((a, b) => Number(a.sold_out) - Number(b.sold_out)).slice(0, 8)
}

// ---------- 2. 상품 칸 그대로 답하기 ----------
// 판매자가 아직 안 채운 칸: 샘플 문구·'회사 확인 필요'·'라벨에 표시'는 정보가 없는 것으로 본다
const UNKNOWN = /\[예시\]|확인\s?필요|라벨에\s?표시|포장에\s?표시|용기에\s?따로\s?표시/
const known = (v) => (typeof v === 'string' && v.trim() && !UNKNOWN.test(v) ? v.trim() : '')
const ASK_INFO = [
  { id: 'expiry', re: /유통\s?기한|소비\s?기한|유효\s?기간|기한이?\s?(얼마|언제|몇)|몇\s?(개월|달)\s?(가|까지|보관|두)/, field: 'expiry', word: '소비기한' },
  { id: 'ingredients', re: /원재료|원료|성분(?!표)|뭐[가이]?\s?들어|무엇이\s?들어|들어가(요|나|는|있)|색소|첨가물|방부제|보존료|감미료/, field: 'ingredients', word: '원재료' },
  { id: 'nutrition', re: /칼로리|열량|kcal|영양\s?(성분|정보)|성분표|당류|나트륨/i, field: 'nutrition', word: '영양 성분' },
  { id: 'pack', re: /몇\s?(그램|미리|ml|리터)|용량이?\s?(얼마|어떻게|몇)|몇\s?(포(?!기)|병|봉|팩|개입|봉지)\s?(예요|에요|이에요|인가요|들어|짜리|이요|요)?/, word: '구성' },
  { id: 'what', re: /(이|가|은|는|란|이란)?\s?(뭐(에요|예요|야|임|지|죠|에여|예여|인가요)|무엇인가요|뭔가요|뭔데|어떤\s?(상품|거|건|것)(이에요|예요|인가요)?\??$)/, word: '소개' },
]
// 원재료 질문에서 손님이 콕 집은 말 (원재료 목록에 그 글자가 있는지만 본다. 뜻을 넘겨짚지 않는다)
const LITERAL = ['색소', '설탕', '감미료', '물엿', '과당', '향료']

function infoSentence(p, ask, message) {
  const name = label(p)
  if (ask.id === 'pack') {
    if (p.options?.length) return `${josa(name, '은', '는')} ${p.options.map((o) => `${o.name} ${won(o.price)}${o.stock > 0 ? '' : '(품절)'}`).join(', ')} 중에서 고를 수 있어요.`
    const composition = known(p.notice?.composition) || p.unit
    return composition ? `${name} 구성은 ${josa(composition, '이에요', '예요')}.` : ''
  }
  if (ask.id === 'what') {
    const summary = known(p.summary)
    if (!summary) return ''
    const composition = known(p.notice?.composition) || p.unit
    return `${name}: ${summary.replace(/[.\s]+$/, '')}. ${composition ? `구성은 ${composition}이고 ` : ''}${p.options?.length ? `옵션별로 ${p.options.map((o) => `${o.name} ${won(o.price)}`).join(', ')}` : `${won(p.price)}`}${p.sold_out ? '인데 지금은 품절이에요.' : '이에요.'}`
  }
  const value = known(p.notice?.[ask.field])
  if (!value) return `${name}의 ${ask.word} 정보는 아직 없어요. 받으신 제품 라벨을 확인하시거나 상품 페이지 아래 Q&A에 물어봐 주세요.`
  // 생과일은 날짜 대신 "받은 뒤 상태를 보며 되도록 빨리 드세요" 같은 안내가 적혀 있다. 그 문장 그대로
  if (ask.id === 'expiry') return /(세요|어요|아요|요)\)?\.?$/.test(value.replace(/\s*\([^)]*\)\s*$/, '')) ? `${name}은(는) 정해진 소비기한 대신 이렇게 안내하고 있어요: ${value.replace(/[.\s]+$/, '')}.` : `${name}의 소비기한은 ${value.replace(/[.\s]+$/, '')}이에요.`
  // 긴 목록 뒤에 조사를 붙이면 어색해서("…황색제4호이에요") '이름 칸: 값' 꼴로 적는다
  if (ask.id === 'nutrition') return `${name} 영양 성분: ${value.replace(/[.\s]+$/, '')}.`
  const asked = LITERAL.filter((w) => message.includes(w))
  const literal = asked.map((w) => (value.includes(w) ? `원재료에 '${w}'${hasBatchim(w) ? '이' : '가'} 적혀 있어요.` : `원재료 목록에 '${w}'라는 말은 없어요.`)).join(' ')
  return `${literal ? `${literal} ` : ''}${name} 원재료: ${value.replace(/[.\s]+$/, '')}.`
}

// 콕 집은 상품(이름으로 찾았거나 지금 보는 상품)의 칸을 묻는 말. 상품을 못 찾았거나 너무 많으면 답하지 않는다
export function answerProductInfo(message, catalog, ctx) {
  // 하루에 몇 포 먹는지·1개 무게는 구성이 아니다 (앞은 정보 없음, 뒤는 무게 규칙)
  const asks = ASK_INFO.filter((a) => a.re.test(message) && !(a.id === 'pack' && /하루|한\s?번에|마셔|먹어|드셔|무게|중량|1\s?개|한\s?개|하나/.test(message)))
  if (!asks.length) return null
  // 칼로리는 품목 이름만 말해도("감말랭이 칼로리") 원래 규칙(정보 없음)으로. 상품을 콕 집었을 때만 칸을 본다
  const targets = ctx.named?.length ? ctx.named : ctx.current ? [ctx.current] : focusProducts(catalog, ctx, message)
  if (!targets.length || targets.length > 3) return null
  // "이게 뭐예요?"·몇 포는 다른 칸과 함께 물으면 다른 칸만
  const picked = asks.some((a) => !['what', 'pack'].includes(a.id)) ? asks.filter((a) => !['what', 'pack'].includes(a.id)) : asks.slice(0, 1)
  const lines = []
  for (const p of targets) for (const a of picked) {
    const s = infoSentence(p, a, message)
    if (s && !lines.includes(s)) lines.push(s)
  }
  if (!lines.length) return null
  return reply(`rule:product_${picked[0].id}`, lines.join(' '), targets)
}

// ---------- 3. 상품 설명 글에서 문장 찾기 ----------
export const productAbout = (p) => [p.summary, p.description, blocksText(p.detail_blocks)].filter(Boolean).join('\n')
  .replaceAll(DEMO_CAPTION, ' ').replaceAll(COMPANY_CAPTION, ' ').replace(/\[예시( 문구[^\]]*)?\]\s*/g, '')

// 질문 낱말에서 끝(조사·어미)을 떼고 앞 두 글자를 본다. "묻어서" 같은 동사는 거의 안 맞고, "흙·송이·씨앗" 같은 이름말이 맞는다
const ENDING = /(이에요|예요|에요|인가요|나요|어요|아요|해요|돼요|되요|되나요|할까요|일까요|인지|는지|은지|이요|요|은|는|이|가|을|를|도|만|에|에서|으로|로|랑|하고|이랑|까지|부터|이나|나|거|건|게|임|음|야|니|냐)$/
const ONE_SYLLABLE = new Set(['흙', '씨', '향', '털', '즙', '심'])
const STOP = new Set(['이렇', '그렇', '저렇', '어떻', '이러', '그러', '비싸', '싸요', '상품', '정도', '얼마', '어떻', '언제', '지금', '혹시', '그냥', '진짜', '이거', '그거', '저거', '무슨', '어떤', '뭐가', '있어', '없어', '되나',
  '먹어', '먹으', '먹을', '먹는', '하나', '사람', '우리', '제가', '저는', '혼자', '많이', '조금', '너무', '원래', '보통', '처음', '요즘', '오늘', '내일', '하루',
  '받으', '받을', '받아', '주문', '보내', '어디', '여기', '거기', '이게', '저게', '그게', '이건', '알려', '궁금', '해주', '주세', '주실', '할수', '수있', '있나',
  '있는', '같은', '같아', '맞아', '맞나', '아니', '그럼', '근데', '그리', '그런', '이런', '저런', '되는', '하는', '해서', '했는', '좋아', '좋은', '좋을', '괜찮'])
function stems(message, skip) {
  const out = new Set()
  for (const raw of spell(message).split(/\s+/)) {
    let w = raw.replace(/[^가-힣a-zA-Z0-9]/g, '')
    for (let i = 0; i < 3 && w.length > 1; i += 1) {
      const cut = w.replace(ENDING, '')
      if (cut === w || !cut) break
      w = cut
    }
    if (!w || /^\d/.test(w)) continue
    if (w.length === 1 && !ONE_SYLLABLE.has(w)) continue
    const stem = w.slice(0, 2)
    if (STOP.has(stem) || skip.some((s) => s === w || w.includes(s))) continue
    out.add(stem)
  }
  return [...out]
}

// 지금 대화에서 콕 집을 수 있는 상품 (이름으로 찾은 상품 → 보는 상품 → 품목 상품이 2개 이하일 때)
function focusProducts(catalog, ctx, message) {
  if (ctx.named?.length) return ctx.named.length <= 3 ? ctx.named : []
  if (ctx.current) return [ctx.current]
  if (ctx.items.length !== 1) return []
  const ofItem = catalog.products.filter((p) => p.item_code === ctx.items[0].item_code)
  const plain = spell(message).replace(/\s+/g, '')
  // "매운거" → (매운맛) 처럼 앞 두 글자만 맞아도 그 상품으로 본다 (세 글자 이상 이름말만)
  const byName = ofItem.filter((p) => nameWords(p).some((w) => !COMMON.has(w) && (plain.includes(w) || (w.length >= 3 && plain.includes(w.slice(0, 2))))))
  let list = byName.length ? byName : ofItem
  // "배즙 50포"처럼 양을 말했으면 그 양이 이름·옵션에 있는 상품만. 그런 상품이 없으면 콕 집지 못한 것이다
  const amount = plain.match(/(\d+(?:\.\d+)?)(kg|g|포|병|개입|l)(?![a-z])/i)
  if (amount) {
    const has = (t) => new RegExp(`(?<![\\d.])${amount[1].replace('.', '\\.')}\\s*${amount[2]}`, 'i').test(t)
    list = list.filter((p) => has(p.name) || (p.options ?? []).some((o) => has(String(o.name))))
  }
  return list.length <= 2 ? list : []
}

export function answerFromProductText(message, catalog, ctx) {
  const targets = focusProducts(catalog, ctx, message)
  if (!targets.length) return null
  const skip = [...new Set([...targets.flatMap(nameWords), ...catalog.items.map((i) => i.name)])]
  const wanted = stems(message, skip)
  if (!wanted.length) return null
  const found = []
  for (const p of targets) {
    const sentences = productAbout(p).split(/\n+|(?<=[.!?])\s+|■/).map((s) => s.trim()).filter((s) => s.length >= 6 && !s.includes(SHOP.phone) && !/사진\.?$/.test(s)) // 사진 설명 글("… 사진")은 답이 아니다
    // 상품 이름 안의 글자("흙대파"의 흙)로 맞은 문장은 세지 않는다 ("…에서 보내는 해남 흙대파 1kg이에요" 같은 문장이 끼지 않게)
    const names = [label(p), ...nameWords(p)].sort((a, b) => b.length - a.length)
    for (const s of sentences) {
      const bare = names.reduce((t, n) => t.replaceAll(n, ' '), s)
      const hits = wanted.filter((w) => bare.includes(w)).length
      if (hits) found.push({ p, s, hits })
    }
  }
  if (!found.length) return null
  found.sort((a, b) => b.hits - a.hits || a.s.length - b.s.length)
  const shown = []
  // 같은 글이 소개 글과 상세 블록에 두 번 있는 경우가 많아서, 한쪽이 다른 쪽을 품으면 하나만
  for (const f of found) if (shown.length < 2 && !shown.some((x) => x.s.includes(f.s) || f.s.includes(x.s))) shown.push(f)
  const products = [...new Set(shown.map((x) => x.p))]
  const quote = shown.map((x) => `${products.length > 1 ? `${label(x.p)}: ` : ''}${x.s.replace(/[.\s]+$/, '')}.`).join(' ')
  return reply('rule:product_text', `${products.length === 1 ? `${label(products[0])} 상품 설명에 이렇게 적혀 있어요.` : '상품 설명에 이렇게 적혀 있어요.'} ${quote} 더 궁금한 점은 상품 페이지 아래 Q&A에 남겨 주시면 담당자가 답해 드려요.`, products, { action: 'qna' })
}

// ---------- 3-2. 두 상품 차이: 판단하지 않고 상품 소개 글을 나란히 ----------
const ASKS_DIFF = /차이|달라|다른\s?점|비교|더\s?(달|맛있|좋|나아|낫)|뭐가\s?(나아|낫|좋)|같은\s?(거|건|것|상품|제품)/
export function answerCompareProducts(message, catalog, ctx) {
  if (!ASKS_DIFF.test(message)) return null
  let list = ctx.named ?? []
  if (list.length < 2 && ctx.items.length === 1) {
    const plain = spell(message).replace(/\s+/g, '')
    const ofItem = catalog.products.filter((p) => p.item_code === ctx.items[0].item_code)
    list = ofItem.filter((p) => nameWords(p).some((w) => !COMMON.has(w) && w !== ctx.items[0].name && (plain.includes(w) || (w.length >= 3 && plain.includes(w.slice(0, 2))))))
  }
  if (list.length < 2 || list.length > 3) return null
  const lines = list.map((p) => {
    const summary = known(p.summary)
    const brix = p.brix && !p.info_disputed ? ` · 당도 ${p.brix}Brix` : ''
    return `- ${label(p)} (${p.options?.length ? `${won(Math.min(...p.options.map((o) => o.price)))}부터` : won(p.price)}${brix}${p.sold_out ? ' · 품절' : ''}): ${summary ? summary.replace(/[.\s]+$/, '') : '소개 글 없음'}`
  })
  const tasteAsked = /더\s?달|달아|달어|달콤|맛있|맛이\s?(더|좋|나)/.test(message)
  const noBrix = tasteAsked && list.every((p) => !p.brix)
  return reply('rule:product_compare', `상품 소개를 나란히 보여 드릴게요.\n${lines.join('\n')}\n${noBrix ? '두 상품 모두 측정한 당도 정보가 없어서 어느 쪽이 더 단지는 말씀드리기 어려워요. ' : ''}어느 쪽이 낫다고는 제가 판단하지 않아요. 더 궁금한 점은 상품 페이지 아래 Q&A에 남겨 주세요.`, list)
}

// ---------- 4. 값만 말한 질문 ----------
const KOREAN_MAN = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 }
// "15000원", "1만5천원", "만오천 원", "3만원" → 원. 읽을 수 없는 꼴이면 null (값을 잘못 읽어 엉뚱한 목록을 내지 않게)
function budgetOf(message) {
  const said = message.replace(/,/g, '')
  const digits = said.match(/(?<![\d.])(\d{4,})\s?원/)
  if (digits) return Number(digits[1])
  const m = said.match(/(?:(\d+|[일이삼사오육칠팔구]|십)?\s?만)?\s?(?:(\d|[일이삼사오육칠팔구])?\s?천)?\s?원/)
  if (!m || !/(만|천)\s?원|만\s?\S{1,3}천\s?원/.test(said)) return null
  const num = (v, missing) => (v == null ? missing : KOREAN_MAN[v] ?? Number(v))
  const hasMan = /만/.test(m[0])
  const hasCheon = /천/.test(m[0])
  const total = (hasMan ? num(m[1], 1) * 10_000 : 0) + (hasCheon ? num(m[2], 1) * 1_000 : 0)
  return total > 0 ? total : null
}
const CHEAPEST = /(제일|가장|젤|젤로|최고로)\s?(싼|저렴|싸)/
const UNDER = /(이하|미만|안쪽|아래|밑|이내|안으로|짜리)/
export function answerBudget(message, catalog, ctx) {
  if (ctx.items.length || ctx.named?.length) return null // 품목을 말했으면 원래 규칙(더 싼 상품·가격)으로
  const cheapest = CHEAPEST.test(message)
  const budget = UNDER.test(message) ? budgetOf(message) : null
  if (!cheapest && !budget) return null
  const kind = /과일/.test(message) ? '과일' : /채소|야채/.test(message) ? '채소' : null
  const items = new Map(catalog.items.map((i) => [i.item_code, i]))
  const live = catalog.products.filter((p) => !p.sold_out && (!kind || items.get(p.item_code)?.category === kind))
    .filter((p) => !budget || Number(p.price) <= budget).sort((a, b) => a.price - b.price)
  const what = kind ? `${kind} 상품` : '상품'
  const money = budget ? won(budget).replace(/0,000원$/, '만 원').replace(/^1만 원$/, '만 원') : ''
  if (!live.length) return reply('rule:budget', `${budget ? `${money} 이하로 살 수 있는 ` : '지금 살 수 있는 '}${what}은 없어요. 품목 이름을 넣어 물어보시면 가격을 알려 드려요.`, [])
  const shown = live.slice(0, budget ? 5 : 3)
  const listed = shown.map((p) => `${label(p)} ${won(p.price)}${p.options?.length ? '부터' : ''}`).join(', ')
  const answer = budget
    ? `${money} 이하로 지금 살 수 있는 ${what}은 ${live.length}개예요. 싼 순으로 ${listed}${live.length > shown.length ? ' 등' : ''}이 있어요.`
    : `지금 파는 ${what} 중에 가장 싼 건 ${label(shown[0])} ${won(shown[0].price)}이에요.${shown.length > 1 ? ` 그다음은 ${shown.slice(1).map((p) => `${label(p)} ${won(p.price)}`).join(', ')}이에요.` : ''}`
  return reply('rule:budget', `${answer} 무게·개수가 서로 달라서 판매 단위도 같이 확인해 주세요.`, shown)
}

