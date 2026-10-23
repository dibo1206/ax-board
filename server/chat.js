// 5단계: 상품 기반 AI 상담
// 1) 건강·환불·대량 구매는 AI를 부르지 않고 정해진 답으로 넘긴다
// 2) 질문에 나온 품목의 상품 정보를 DB에서 바로 꺼내 [자료]로 준다 → 새로 등록한 상품도 바로 답한다
// 3) AI 답에서 자료에 없는 가격·당도, 효능 표현, "먹어도 돼요", 환불 약속을 찾으면 한 번 다시 시키고, 그래도 틀리면 담당자에게 넘긴다
import { readFileSync } from 'node:fs'
import express from 'express'
import { complete, describeAiError, keyLoaded } from './ai.js'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { FORBIDDEN } from './validate.js'

const RULES_FILE = new URL('./chat_rules.md', import.meta.url)
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
const QNA_HINT = '상품 페이지 아래 Q&A에 질문을 남겨 주시면 담당자가 직접 답해 드려요.'

// ---------- 1. 정해진 답으로 넘기는 질문 ----------
const ROUTES = [
  {
    kind: 'health',
    re: /당뇨|임신|임산부|수유|(?<!이)아기|유아|이유식|혈압|혈당|복용|질환|환자|수술|아토피|신장|통풍|알레르기.{0,6}(있|반응)/,
    answer: (ctx) => {
      const allergy = ctx.items.filter((i) => i.allergens.length).map((i) => `${i.name}: ${i.allergens.join(', ')}`)
      return '건강 상태에 따라 드셔도 되는지는 제가 판단할 수 없어요. 의사·약사 같은 전문가와 꼭 상의해 주세요. '
        + (allergy.length ? `참고로 상품 정보에 적힌 알레르기 표시는 ${allergy.join(' / ')}예요. ` : '')
        + QNA_HINT
    },
    handoff: true,
    action: 'qna',
  },
  {
    kind: 'refund',
    re: /환불|교환|반품|파손|불량|배송.{0,8}(안\s?와|안\s?오|늦|누락|잘못)|(받|온|왔|도착).{0,12}(상했|썩|깨졌|터졌|곰팡이|물러)/,
    answer: () => '불편을 드려 죄송해요. 환불·교환은 제가 결정할 수 없어서 담당자에게 넘길게요. '
      + '구매하신 곳(스마트스토어·쿠팡 등)과 받은 날짜, 상품 상태를 상품 Q&A에 남겨 주시면 담당자가 확인 후 안내해 드려요. '
      + '연락처는 공개되지 않는 연락처 칸에만 적어 주세요.',
    handoff: true,
    action: 'qna',
  },
  {
    kind: 'b2b',
    re: /납품|도매|대량|견적|사업자|기업\s?구매|정기\s?(배송|구매|납품)|\d{2,}\s*(병|박스|상자)/,
    answer: (ctx) => {
      const b2b = ctx.products.filter((p) => p.b2b_available)
      if (ctx.products.length && !b2b.length) return `${ctx.products[0].name}은(는) 아직 기업 구매 문의를 받지 않는 상품이에요. ${QNA_HINT}`
      return '대량 구매·납품은 기업 구매 문의로 받고 있어요. 상품 페이지의 [기업 구매 문의]에 회사 이름, 연락처, 희망 수량을 남겨 주시면 담당자가 확인 후 견적을 안내해 드려요.'
    },
    handoff: true,
    action: 'b2b',
  },
]

// ---------- 2. DB에서 자료 꺼내기 ----------
async function loadCatalog() {
  const [products, items] = await Promise.all([
    pool.query(`SELECT p.*, (p.stock = 0) AS sold_out, s.name AS seller_name, s.region AS seller_region
                FROM products p JOIN sellers s ON s.seller_code = p.seller_code
                WHERE p.status = 'active' ORDER BY p.product_code LIMIT 300`),
    pool.query('SELECT * FROM items'),
  ])
  return { products: products.rows, items: items.rows }
}

// 질문(과 앞선 질문)에 나온 품목을 찾는다. 긴 이름부터 찾고 지워서 '배즙' 안의 '배'가 다시 잡히지 않게 한다
function findItems(text, items) {
  let rest = text.replace(/배송|배달|배합|배치|배려/g, ' ')
  const found = []
  for (const item of [...items].sort((a, b) => b.name.length - a.name.length)) {
    if (rest.includes(item.name)) {
      found.push(item)
      rest = rest.replaceAll(item.name, ' ')
    }
  }
  return found
}

function pickContext(catalog, { message, history, productCode }) {
  const pastQuestions = history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content).join(' ')
  let items = findItems(message, catalog.items)
  if (!items.length) items = findItems(pastQuestions, catalog.items) // "그거 얼마예요?" 같은 이어지는 질문
  const current = catalog.products.find((p) => p.product_code === productCode)
  if (current && !items.some((i) => i.item_code === current.item_code)) {
    items.push(catalog.items.find((i) => i.item_code === current.item_code))
  }
  const itemCodes = new Set(items.map((i) => i.item_code))
  const products = catalog.products.filter((p) => itemCodes.has(p.item_code)).slice(0, 8)
  return { items, products, current }
}

const list = (arr) => (arr?.length ? arr.join(', ') : '정보 없음')

function describeProduct(p, item) {
  const lines = [
    `[상품 코드 ${p.product_code}] ${p.name}`,
    `- 품목: ${item.name} (품목 코드 ${item.item_code}) · 판매: ${p.seller_name} (${p.seller_region})`,
    `- 가격: ${won(p.price)} / ${p.unit}`,
    `- 재고: ${p.sold_out ? '품절 (지금 살 수 없음)' : `판매 중 (${p.stock}개 남음)`}`,
    `- 1개 무게: ${p.weight_g ? `${p.weight_g}g` : '정보 없음'} · 박스당 개수: ${p.count_per_box ? `${p.count_per_box}개` : '정보 없음'}`,
  ]
  if (item.show_brix) {
    lines.push(`- 당도: ${p.brix ? `${p.brix}Brix (${p.brix_measured_at ?? '측정일 정보 없음'} 측정)` : '측정한 당도 정보 없음'}`)
  }
  if (item.category !== '가공품') lines.push(`- 수확일: ${p.harvest_date ?? '정보 없음'}`)
  if (p.summary) lines.push(`- 소개: ${p.summary}`)
  lines.push(`- 구매: ${p.external_url ? '상품 페이지의 [구매하기]로 온라인 판매처에서 구매' : '온라인 판매 링크 없음 (상품 Q&A로 구매 문의)'}`)
  lines.push(`- 기업 구매 문의: ${p.b2b_available ? '받음' : '받지 않음'}`)
  return lines.join('\n')
}

function describeItem(item) {
  const lines = [
    `[품목 코드 ${item.item_code}] ${item.name} (${item.category}) 기준 정보`,
    `- 보관: ${item.storage_method || '정보 없음'}`,
  ]
  if (item.fresh_days_stage1) {
    lines.push(`- 받은 날부터 ${item.fresh_days_stage1}일까지: ${list(item.stage1_uses)} / ${item.fresh_days_stage2}일까지: ${list(item.stage2_uses)} / 그 뒤: ${list(item.stage3_uses)}`)
  }
  if (item.opened_note) lines.push(`- 개봉 후: ${item.opened_note}`)
  lines.push(`- 알레르기 표시: ${list(item.allergens)}`)
  lines.push(`- 먹으면 안 되는 신호: ${list(item.danger_signs)}`)
  lines.push(`- 레시피: ${item.recipes?.length ? item.recipes.map((r) => `${r.title}(재료 ${r.ingredients} / 방법 ${r.method})`).join('; ') : '정보 없음'}`)
  if (!item.reviewed_by) lines.push('- (식품팀 검수 전 정보)')
  return lines.join('\n')
}

async function buildMaterial(catalog, ctx) {
  const parts = []
  for (const item of ctx.items) {
    parts.push(describeItem(item))
    for (const p of ctx.products.filter((x) => x.item_code === item.item_code)) parts.push(describeProduct(p, item))
  }
  if (ctx.products.length) {
    const { rows } = await pool.query(
      `SELECT product_code, question, answer FROM questions
       WHERE product_code = ANY($1) AND answer IS NOT NULL AND NOT hidden ORDER BY answered_at DESC LIMIT 10`,
      [ctx.products.map((p) => p.product_code)],
    )
    if (rows.length) parts.push(`[담당자가 답한 Q&A]\n${rows.map((q) => `- (${q.product_code}) Q: ${q.question} / A: ${q.answer}`).join('\n')}`)
  }
  parts.push(`[전체 상품 목록]\n${catalog.products.map((p) => `- ${p.product_code}: ${p.name} · ${won(p.price)} · ${p.sold_out ? '품절' : '판매 중'}`).join('\n')}`)
  return parts.join('\n\n')
}

// ---------- 2-1. 가격·재고·개수·당도처럼 값 하나만 묻는 질문은 AI 없이 DB 값으로 바로 답한다 ----------
const FACTS = [
  {
    re: /얼마|가격|값/,
    explicit: /가격|값/,
    say: (p) => `${p.label} 가격은 ${won(p.price)}이에요 (판매 단위: ${p.unit}).${p.sold_out ? ' 다만 지금은 품절이라 살 수 없어요.' : ''}`,
  },
  {
    re: /살 수 있|구매.{0,4}(가능|돼|되나)|재고|품절|남았|있어요\?|있나요/,
    explicit: /살 수 있|재고|품절|남았/,
    say: (p) => (p.sold_out
      ? `${p.label} 상품은 지금 품절이라 살 수 없어요. 다시 들어오는 날짜는 아직 안내된 정보가 없어요.`
      : `${p.label} 상품은 지금 살 수 있어요. ${p.external_url ? '상품 페이지의 [구매하기]를 눌러 주세요.' : '온라인 판매 링크가 없어서 상품 Q&A로 구매 방법을 안내해 드려요.'}`),
  },
  {
    re: /몇\s*개|개수|몇\s*알/,
    specific: true,
    say: (p) => (p.count_per_box
      ? `${p.label} 한 박스에는 ${p.count_per_box}개가 들어 있어요.${p.weight_g ? ` 1개 무게는 ${p.weight_g}g 정도예요.` : ''}`
      : `${p.label} 상품의 박스당 개수 정보는 아직 없어요.`),
  },
  {
    re: /달아|달달|단가요|당도|브릭스|brix/i,
    needsBrix: true,
    specific: true,
    say: (p) => (p.brix
      ? `${p.label} 당도는 ${p.brix}Brix예요${p.brix_measured_at ? ` (${p.brix_measured_at} 측정)` : ''}.`
      : `${p.label} 상품은 아직 측정한 당도 정보가 없어요.`),
  },
]
// 설명이 필요한 말이 섞이면 AI에게 넘긴다
const NEEDS_EXPLAIN = /보관|레시피|만들|개봉|먹어도|드셔도|마셔도|냉장|상온|싹|활용|비율|어떻게|왜|추천|비교|차이/

function answerFact(message, catalog, ctx) {
  if (NEEDS_EXPLAIN.test(message)) return null
  let facts = FACTS.filter((f) => f.re.test(message))
  if (!facts.length) return null
  // "당도는 얼마예요?", "몇 개 들어 있어요?"처럼 겹치면 구체적인 쪽(당도·개수)만 답한다
  if (facts.some((f) => f.specific)) facts = facts.filter((f) => f.specific || f.explicit?.test(message))
  const mentioned = findItems(message, catalog.items).map((i) => i.item_code)
  let products = mentioned.length
    ? catalog.products.filter((p) => mentioned.includes(p.item_code))
    : (ctx.current ? [ctx.current] : [])
  if (!products.length) return null
  // 같은 품목 상품이 여럿이면 질문에 나온 이름 조각(선물세트, 가정용, 3kg …)으로 좁힌다
  const words = (p) => p.name.replace(/\[예시\]/g, '').split(/\s+/).filter((w) => w.length >= 2 && !catalog.items.some((i) => i.name === w))
  const narrowed = products.filter((p) => words(p).some((w) => message.includes(w)))
  if (narrowed.length) products = narrowed
  if (products.length > 3) return null
  const sentences = []
  for (const p of products) {
    const item = catalog.items.find((i) => i.item_code === p.item_code)
    const labeled = { ...p, label: p.name.replace(/\[예시\]\s*/g, '') }
    for (const f of facts) {
      if (f.needsBrix && !item.show_brix) return null
      sentences.push(f.say(labeled))
    }
  }
  return {
    answer: sentences.join(' '),
    sources: products.map((p) => ({ code: p.product_code, name: p.name })),
    productCode: products[0].product_code,
  }
}

// ---------- 3. AI 답 검사 ----------
function parseReply(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const data = JSON.parse(text.slice(start, end + 1))
    if (typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 800) return null
    return {
      answer: data.answer.trim(),
      sources: Array.isArray(data.sources) ? data.sources.filter((s) => typeof s === 'string') : [],
      handoff: data.handoff === true,
      action: ['b2b', 'qna'].includes(data.action) ? data.action : null,
    }
  } catch {
    return null
  }
}

const toNumber = (s) => Number(s.replace(/,/g, ''))

// 답에 상품·품목 코드(peach_4kg)가 그대로 나오면 이름으로 바꾼다. "(상품 코드 peach_4kg)"처럼 괄호째면 지운다
function nameCodes(answer, catalog) {
  let text = answer
  const named = [
    ...catalog.products.map((p) => [p.product_code, p.name.replace(/\[예시\]\s*/g, '')]),
    ...catalog.items.map((i) => [i.item_code, i.name]),
  ].sort((a, b) => b[0].length - a[0].length)
  for (const [code, name] of named) {
    text = text.replace(new RegExp(`\\s*\\((상품 |품목 )?(코드 )?${code}\\)`, 'g'), '')
    if (code.includes('_')) text = text.replaceAll(code, name)
  }
  return text
}

function findProblem(answer, catalog) {
  // 무료 모델이 한국어 사이에 영어 조각을 섞는 경우가 있다 (배lds, 포도 jam). 단위·Q&A는 빼고 본다
  const latin = answer.replace(/Brix|Q&A|AI|\d+(\.\d+)?\s*(kg|g|ml|mL|L)\b/g, '').match(/[A-Za-z]{2,}/)
  if (latin) return `영어 조각("${latin[0]}")이 섞였어요. 한국어로만 써 주세요`
  const foreign = answer.match(/[぀-ヿ㐀-鿿]+/) // 한자·일본 글자 (통通风되는)
  if (foreign) return `한자·외국 글자("${foreign[0]}")가 섞였어요. 한국어로만 써 주세요`
  const bad = FORBIDDEN.filter((w) => answer.includes(w))
  if (bad.length) return `효능 표현(${bad.join(', ')})은 쓰면 안 돼요`
  if (/(먹어도|드셔도|마셔도|섭취해도)\s*(돼|되요|됩니다|괜찮아요|괜찮습니다)/.test(answer)) return '먹어도 된다고 판단하면 안 돼요'
  // "먹지 않는 것이 안전해요"는 괜찮고, "주스로 쓰는 것이 안전해요"처럼 안전하다고 판단하는 말은 막는다
  if (/안전(합니다|해요|하다)/.test(answer.replace(/(않는|말고|않으시는|버리는)\s*(것이|게)\s*안전/g, ''))) return '안전하다고 판단하면 안 돼요. 확인할 신호만 알려 주세요'
  if (/(환불|교환|반품)(을|해)?\s*(해\s*)?드릴|(환불|교환|반품)\s*가능/.test(answer)) return '환불·교환을 약속하면 안 돼요'
  if (/\d\s*만\s*\d*\s*천?\s*원|\d\s*천\s*원/.test(answer)) return '가격은 자료처럼 숫자로 써야 해요 (예: 32,000원)'
  const prices = new Set(catalog.products.map((p) => Number(p.price)))
  for (const [, n] of answer.matchAll(/(\d[\d,]*)\s*원/g)) {
    if (!prices.has(toNumber(n))) return `${n}원은 자료에 없는 가격이에요`
  }
  const brix = new Set(catalog.products.filter((p) => p.brix).map((p) => Number(p.brix)))
  for (const [, n] of answer.matchAll(/(\d+(?:\.\d+)?)\s*(?:Brix|브릭스)/gi)) {
    if (!brix.has(Number(n))) return `당도 ${n}은 자료에 없는 값이에요`
  }
  return null
}

// 근거 코드를 손님 화면에 보여 줄 상품 칩으로 바꾼다 (품목 코드면 그 품목의 첫 상품)
function toSourceChips(codes, catalog, ctx) {
  const chips = []
  for (const code of codes) {
    const product = catalog.products.find((p) => p.product_code === code)
      ?? ctx.products.find((p) => p.item_code === code)
    if (product && !chips.some((c) => c.code === product.product_code)) chips.push({ code: product.product_code, name: product.name })
  }
  return chips
}

const FALLBACK = { answer: `정확한 답을 드리기 어려워요. ${QNA_HINT}`, sources: [], handoff: true, action: 'qna' }

export async function answerChat({ message, history = [], productCode = null }) {
  const catalog = await loadCatalog()
  const ctx = pickContext(catalog, { message, history, productCode })
  const fallbackProduct = ctx.current?.product_code ?? (ctx.products.length === 1 ? ctx.products[0].product_code : null)

  const route = ROUTES.find((r) => r.re.test(message))
  if (route) {
    const b2bProduct = ctx.products.find((p) => p.b2b_available)
    return {
      answer: route.answer(ctx),
      sources: route.kind === 'health' ? toSourceChips(ctx.items.filter((i) => i.allergens.length).map((i) => i.item_code), catalog, ctx) : [],
      handoff: route.handoff,
      action: route.action,
      productCode: route.kind === 'b2b' ? (b2bProduct?.product_code ?? fallbackProduct) : fallbackProduct,
      model: `rule:${route.kind}`,
      blocked: false,
    }
  }
  const fact = answerFact(message, catalog, ctx)
  if (fact) return { ...fact, handoff: false, action: null, model: 'rule:fact', blocked: false }

  if (!keyLoaded()) {
    const error = new Error('OPENROUTER_API_KEY 없음')
    error.code = 'NO_KEY'
    throw error
  }

  const material = await buildMaterial(catalog, ctx)
  const messages = [
    { role: 'system', content: readFileSync(RULES_FILE, 'utf8') },
    ...history.slice(-6),
    { role: 'user', content: `[자료]\n${material}\n\n[손님 질문]\n${message}` },
  ]
  let model = ''
  let problem = ''
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result
    try {
      result = await complete(messages, { skip: problem ? [model] : [] })
    } catch (error) {
      if (attempt === 1) throw error
      break // 다시 묻는 중에 모델이 모두 막히면 오류 대신 담당자에게 넘긴다
    }
    model = result.model
    const reply = parseReply(result.text)
    if (reply) reply.answer = nameCodes(reply.answer, catalog)
    problem = reply ? findProblem(reply.answer, catalog) : '형식이 맞지 않아요. 설명 없이 JSON 하나만 출력해 주세요'
    if (!problem) {
      const sources = toSourceChips(reply.sources, catalog, ctx)
      return {
        ...reply,
        sources,
        productCode: sources[0]?.code ?? fallbackProduct,
        model,
        blocked: false,
      }
    }
    console.log(`[chat] 답 검사 걸림 (${attempt}번째): ${problem} · 받은 답 앞부분: ${JSON.stringify(result.text.slice(0, 150))}`)
    messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: `방금 답에 문제가 있어요: ${problem}. 규칙을 지켜 JSON으로 다시 답해 주세요.` })
  }
  return { ...FALLBACK, productCode: fallbackProduct, model, blocked: true, problem }
}

// ---------- API ----------
const tooMany = createLimiter({ limit: 15, windowMs: 10 * 60_000 })

function cleanHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((h) => ['user', 'assistant'].includes(h?.role) && typeof h.content === 'string')
    .slice(-6)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 500) }))
}

export const chatRouter = express.Router()

chatRouter.post('/chat', async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : ''
  if (message.length < 2 || message.length > 300) return res.status(400).json({ error: '질문은 2~300자로 적어 주세요.' })
  if (tooMany(req)) return res.status(429).json({ error: '질문이 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  const productCode = typeof req.body.productCode === 'string' ? req.body.productCode : null

  let result
  try {
    result = await answerChat({ message, history: cleanHistory(req.body.history), productCode })
  } catch (error) {
    const { status, message: text } = error.code === 'NO_KEY'
      ? { status: 503, message: `AI 상담 준비 중이에요. ${QNA_HINT}` }
      : describeAiError(error)
    return res.status(status).json({ error: text })
  }
  const { rows } = await pool.query(
    `INSERT INTO chat_logs (question, answer, sources, handed_off, blocked, model)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [message, result.answer, result.sources.map((s) => s.code), result.handoff, result.blocked, result.model],
  )
  res.json({
    id: rows[0].id,
    answer: result.answer,
    sources: result.sources,
    handoff: result.handoff,
    action: result.action,
    productCode: result.productCode,
  })
})

export const adminChatRouter = express.Router()
adminChatRouter.use(requireAdmin)

adminChatRouter.get('/', async (req, res) => {
  const [logs, summary] = await Promise.all([
    pool.query('SELECT * FROM chat_logs ORDER BY created_at DESC LIMIT 200'),
    pool.query(`SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE handed_off)::int AS handed_off,
                       count(*) FILTER (WHERE blocked)::int AS blocked
                FROM chat_logs`),
  ])
  res.json({ summary: summary.rows[0], logs: logs.rows })
})
