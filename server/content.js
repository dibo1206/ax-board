// 상품 상세 내용 AI 초안: 판매자·관리자가 기본 정보만 넣고 [AI로 채우기]를 누르면
// 한 줄 소개 · 상세 설명(고른 상세페이지 패턴 순서대로) · 자주 묻는 질문 초안을 만든다
//  - 상품당 한 번: 같은 입력 + 같은 패턴이면 저장해 둔 초안을 다시 준다 (AI 0회, 30일)
//  - 같은 원물(품목)의 보관법·레시피가 이미 있으면 그대로 쓰고, 비어 있을 때만 품목 초안도 만든다
//  - 금지어(효능 표현 등)가 든 문장, 입력에 없는 숫자(가격·당도·무게)를 쓴 문장은 빼고 무엇을 뺐는지 알려 준다
//  - 초안은 화면에 채워 주기만 한다. 판매자가 읽고 고친 뒤 저장해야 공개된다
//  - 블록형 상세페이지 초안 (2026-11-14): 패턴의 섹션마다 글 블록을 쓰고, 사이사이에 "이런 사진을 넣어 주세요" 사진 자리를 제안한다.
//    사진은 AI가 만들지 않는다 (농산물 상세 사진은 실물이어야 해서). 판매자가 자리마다 직접 찍은 사진을 고른다
import { createHash } from 'node:crypto'
import { complete, describeAiError, keyLoaded } from './ai.js'
import { findBanned } from './banned.js'
import { LIMITS, MAX_BLOCKS } from './blocks.js'
import { pool } from './db.js'
import { generateRecipePhoto, imageKeyLoaded } from './imagegen.js'
import { createLimiter } from './limit.js'
import { checkAiFields, parseSpoken } from './speakParse.js'

// 상세페이지 패턴: 많이 쓰는 상세페이지 순서를 몇 가지로 정리 (멘토 피드백: 패턴을 고르면 일관되게)
export const TEMPLATES = {
  story: { name: '이야기형', desc: '농가 이야기로 시작해 믿음을 주는 순서 (생과일·직거래에 잘 맞음)', sections: ['농가 이야기', '이렇게 길렀어요', '맛과 식감', '받으시면 이렇게', '보관 안내'] },
  info: { name: '정보형', desc: '한눈에 보고 바로 사게 하는 순서 (가정용·재구매 상품)', sections: ['한눈에 보기', '구성과 규격', '맛과 당도', '보관 안내', '배송 안내'] },
  gift: { name: '선물형', desc: '받는 사람을 떠올리게 하는 순서 (명절·선물세트)', sections: ['이런 분께 선물하세요', '구성과 포장', '맛과 품질', '보관 안내', '받는 분께'] },
  cafe: { name: '카페·업소형', desc: '메뉴와 비율 중심 순서 (농축액·대용량)', sections: ['이런 메뉴에', '만드는 비율', '대용량과 보관', '품질 관리', '대량 구매 문의'] },
}

const CACHE_DAYS = 30
const tooMany = createLimiter({ limit: 20, windowMs: 60 * 60_000, key: (req) => `content:${(req.admin ?? req.seller)?.loginId}` })
const tooManyFills = createLimiter({ limit: 20, windowMs: 60 * 60_000, key: (req) => `fill:${(req.admin ?? req.seller)?.loginId}` })
// 판매자 한 곳이 하루 AI 사진 몫을 혼자 쓰지 못하게 (품목 3개 몫)
const tooManySellerPhotos = createLimiter({ limit: 3, windowMs: 24 * 3_600_000, key: (req) => `fill-photos:${req.seller?.loginId}` })
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max))
const empty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

const RULES = `너는 농산물 자사몰의 상세페이지 작성 도우미다. 판매자가 준 [상품 정보]만 근거로 한국어로 쓴다.
규칙
1. 효능·건강 효과 표현을 쓰지 않는다 (면역력, 다이어트, 치료, 예방, 해독, 항암, 혈압, 혈당, 기관지, 피로 회복 등). 맛·식감·향·크기·재배·포장·보관만 쓴다.
2. [상품 정보]에 없는 숫자(가격, 당도, 무게, 개수, 날짜, 인증, 수상)를 지어내지 않는다. 모르면 그 내용은 쓰지 않는다.
3. 근거 없는 과장(최고, 1등, 100%, 무조건)을 쓰지 않는다. 할인·덤·환불을 약속하지 않는다.
4. 먹어도 된다·안전하다고 판단하지 않는다.
5. 친근한 존댓말, 문장은 짧게. 한국어만 쓴다.
6. 설명 없이 JSON 하나만 출력한다.`

// 품목·농가 정보를 DB에서 붙여 AI에게 줄 [상품 정보]를 만든다 (판매자는 자기 농가로 고정)
async function buildInput(body, sellerCode) {
  const itemCode = text(body.item_code, 64)
  const [items, sellers] = await Promise.all([
    pool.query('SELECT * FROM items WHERE item_code = $1', [itemCode]),
    pool.query('SELECT name, region, story FROM sellers WHERE seller_code = $1', [sellerCode]),
  ])
  const item = items.rows[0]
  if (!item) return { error: '품목을 먼저 골라 주세요.' }
  const name = text(body.name, 60)
  if (!name) return { error: '상품 이름을 먼저 적어 주세요.' }
  const seller = sellers.rows[0]
  const facts = [
    ['상품 이름', name.replace(/\[예시\]\s*/g, '')],
    ['품목', `${item.name} (${item.category})`],
    ['판매 단위', text(body.unit, 30)],
    ['가격', /^\d+$/.test(text(body.price, 10)) ? `${Number(body.price).toLocaleString('ko-KR')}원` : ''],
    ['1개 무게', /^\d+$/.test(text(body.weight_g, 6)) ? `${body.weight_g}g` : ''],
    ['박스당 개수', /^\d+$/.test(text(body.count_per_box, 4)) ? `${body.count_per_box}개` : ''],
    ['당도', /^\d+(\.\d)?$/.test(text(body.brix, 5)) ? `${body.brix}Brix${text(body.brix_measured_at, 10) ? ` (${body.brix_measured_at} 측정)` : ''}` : ''],
    ['수확일', text(body.harvest_date, 10)],
    ['한 줄 소개', text(body.summary, 200)],
    ['판매자가 강조하고 싶은 점', text(body.memo, 300)],
    ['판매 농가', seller ? `${seller.name.replace(/\[예시\]\s*/g, '')} (${seller.region})` : ''],
    ['농가 이야기', seller?.story ? text(seller.story, 300) : ''],
    ['보관 방법', item.storage_method ?? ''],
    ['개봉 후', item.opened_note ?? ''],
    ['카페 메뉴 비율 (시험 제조 제안값)', item.cafe_note ?? ''],
  ].filter(([, v]) => v)
  const needItem = empty(item.storage_method) || empty(item.recipes)
  return { item, facts, needItem }
}

// 문장 단위로 나눠 금지어·지어낸 숫자가 든 문장을 뺀다
// checkNumbers: 상품 설명은 가격·당도·무게·개수를 입력에 있는 숫자로만 (레시피 비율 같은 일반 숫자는 검사하지 않음)
function cleanText(value, allowedText, flagged, max, checkNumbers = true) {
  const lines = String(value ?? '').split('\n').map((line) => {
    if (/^■\s/.test(line.trim())) return line.trim() // 섹션 제목
    const sentences = line.split(/(?<=[.!?])\s+/)
    return sentences.filter((s) => {
      const banned = findBanned(s, ['효능', '욕설', '광고', '기타'])
      if (banned.length) { flagged.push(`금지어(${banned.join(', ')}): ${s.slice(0, 40)}`); return false }
      for (const [, n] of checkNumbers ? s.matchAll(/(\d[\d,.]*)\s*(원|Brix|브릭스|kg|g|개)/gi) : []) {
        if (!allowedText.includes(n.replace(/,/g, '')) && !allowedText.includes(n)) { flagged.push(`자료에 없는 숫자(${n}): ${s.slice(0, 40)}`); return false }
      }
      return true
    }).join(' ')
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

// 레시피 초안 하나. photo 는 사진 만들기에 쓸 영어 설명 (저장하지 않고 사진을 만들 때만 쓴다)
const PHOTO_HINT = /^[\x20-\x7E]{20,400}$/
function draftRecipe(r, allowed, flagged) {
  const photo = typeof r?.photo === 'string' ? r.photo.replace(/[\r\n<>{}[\]`]/g, ' ').trim().slice(0, 400) : ''
  return {
    title: cleanText(r?.title, allowed, flagged, 30, false),
    ingredients: cleanText(r?.ingredients, allowed, flagged, 60, false),
    method: cleanText(r?.method, allowed, flagged, 120, false),
    ...(PHOTO_HINT.test(photo) ? { photo } : {}),
  }
}
const RECIPE_FORMAT = '{"title": "", "ingredients": "재료·재료", "method": "한 문장", "photo": "완성된 요리가 식탁에 놓인 모습을 영어 한 문장으로 (그릇, 색, 곁들임)"}'

// 블록 초안: 글 블록 { type: 'text', title, body } 과 사진 자리 { type: 'photo', hint }
// 글은 상품 설명과 같은 검사(금지어·자료에 없는 숫자)를 거치고, 사진 자리 안내는 금지어만 본다
const MAX_PHOTO_SLOTS = 4
// 상세 화면 아래 칸(보관·섭취 안내, 판매 농가 이야기)과 자동 카드(구성 비교·배송)에 이미 나오는 섹션은 블록으로 쓰지 않는다 (같은 말이 두 번 보이지 않게)
const SHOWN_ELSEWHERE = /보관|배송|대량 구매 문의/
// 블록에는 가격을 쓰지 않는다: 가격을 바꿔도 블록 글은 그대로라 옛 값이 남고, 블록 글은 상담 자료에도 들어간다
const PRICE = /\d[\d,]*\s*원/
function withoutPrices(text, flagged) {
  return text.split('\n').map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => {
    if (!PRICE.test(sentence)) return true
    flagged.push(`블록에 가격(구매 칸에서 보여요): ${sentence.slice(0, 40)}`)
    return false
  }).join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
function draftBlocks(list, allowed, flagged) {
  let photos = 0
  const blocks = []
  for (const b of Array.isArray(list) ? list.slice(0, MAX_BLOCKS) : []) {
    if (b?.type === 'photo') {
      const hint = cleanText(b.hint, allowed, flagged, 60, false)
      if (hint && photos < MAX_PHOTO_SLOTS && blocks.at(-1)?.type !== 'photo') {
        photos += 1
        blocks.push({ type: 'photo', hint })
      }
    } else {
      const title = cleanText(b?.title, allowed, flagged, LIMITS.title, false)
      if (SHOWN_ELSEWHERE.test(title)) continue
      const body = withoutPrices(cleanText(b?.body, allowed, flagged, LIMITS.body), flagged)
      if (body) blocks.push({ type: 'text', title, body })
    }
  }
  return blocks
}

// 모델이 blocks 를 빼먹으면 "■ 제목" 섹션으로 쓴 설명을 글 블록으로 나눈다 (사진 자리 없이)
function blocksFromSections(description) {
  return description.split(/\n{2,}/).map((para) => {
    const [first, ...rest] = para.split('\n')
    return /^■\s/.test(first) && rest.join(' ').trim()
      ? { type: 'text', title: first.replace(/^■\s*/, '').slice(0, LIMITS.title), body: rest.join('\n').trim() }
      : null
  }).filter(Boolean)
}

// 시험(scripts/blocks-test.js)에서도 부른다
export function parseDraft(raw, input, flagged) {
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  const allowed = input.facts.map(([, v]) => v).join(' ').replace(/,/g, '') + ' 1 2 3 4 5'
  const draft = {
    summary: cleanText(json.summary, allowed, flagged, 200),
    description: cleanText(json.description, allowed, flagged, 3000),
    faq: (Array.isArray(json.faq) ? json.faq : []).slice(0, 4).map((f) => ({
      q: cleanText(f?.q, allowed, flagged, 100),
      a: cleanText(f?.a, allowed, flagged, 300),
    })).filter((f) => f.q && f.a),
    blocks: draftBlocks(json.blocks, allowed, flagged),
    item: null,
  }
  if (!draft.blocks.length) draft.blocks = blocksFromSections(draft.description)
  if (input.needItem && json.item && typeof json.item === 'object') {
    const it = json.item
    draft.item = {
      storage_method: empty(input.item.storage_method) ? cleanText(it.storage_method, allowed, flagged, 200, false) : null,
      opened_note: empty(input.item.opened_note) ? cleanText(it.opened_note, allowed, flagged, 200, false) : null,
      danger_signs: empty(input.item.danger_signs) && Array.isArray(it.danger_signs) ? it.danger_signs.slice(0, 5).map((s) => cleanText(s, allowed, flagged, 30, false)).filter(Boolean) : null,
      recipes: empty(input.item.recipes) && Array.isArray(it.recipes)
        ? it.recipes.slice(0, 3).map((r) => draftRecipe(r, allowed, flagged)).filter((r) => r.title && r.method)
        : null,
    }
  }
  if (!draft.description) throw new Error('빈 초안')
  return draft
}

async function readCache(key) {
  const { rows } = await pool.query(
    'UPDATE chat_cache SET hits = hits + 1 WHERE key = $1 AND created_at > now() - make_interval(days => $2) RETURNING reply, model',
    [key, CACHE_DAYS],
  )
  return rows[0] ?? null
}

// POST /ai/product-draft (관리자·판매자 공통). 판매자는 seller_code 를 자기 농가로 고정
export async function productDraft(req, res) {
  const sellerCode = req.seller ? req.seller.sellerCode : text(req.body.seller_code, 64)
  const template = Object.hasOwn(TEMPLATES, req.body.template ?? '') ? req.body.template : 'story'
  const input = await buildInput(req.body, sellerCode)
  if (input.error) return res.status(400).json({ error: input.error })

  const key = createHash('sha256').update(`content-v4\n${template}\n${JSON.stringify(input.facts)}\n${input.needItem}`).digest('hex')
  const saved = await readCache(key)
  if (saved) return res.json({ ...saved.reply, template, aiCalls: 0, model: `cache:${saved.model}` })
  if (!keyLoaded()) return res.status(503).json({ error: 'AI 키가 없어 초안을 만들 수 없어요. 직접 적어 주세요.' })
  if (tooMany(req)) return res.status(429).json({ error: 'AI 초안을 너무 많이 만들었어요. 1시간 뒤에 다시 해 주세요.' })

  const t = TEMPLATES[template]
  const prompt = [
    `[상세페이지 순서] ${t.name}: ${t.sections.map((s) => `■ ${s}`).join(' → ')}`,
    'description 은 상품 전체를 3~4문장으로 짧게 소개한다 (섹션 제목 없이).',
    'blocks 는 상세페이지 본문이다. 위 순서대로 섹션마다 글 블록 {"type": "text", "title": "섹션 제목", "body": "2~3문장"} 을 하나씩 쓴다. 보관·배송·대량 구매 섹션은 상세 화면의 다른 칸에 이미 나오므로 blocks 에서는 뺀다. blocks 에는 가격을 쓰지 않는다. 농가 이야기는 [농가 이야기]를 그대로 옮기지 말고 이 상품을 어떻게 길렀는지 중심으로 쓴다.',
    `글 블록 사이에 사진이 있으면 좋은 곳 2~${MAX_PHOTO_SLOTS}군데에 사진 자리 {"type": "photo", "hint": "판매자가 직접 찍을 실물 사진, 한국어 30자 이내"} 를 넣는다. 예: 과수원에 열매가 달린 모습, 상자를 연 구성, 단면을 자른 모습. 사진 자리는 두 개를 연달아 두지 않는다.`,
    '[상품 정보]',
    ...input.facts.map(([k, v]) => `- ${k}: ${v}`),
    input.needItem ? '[품목 정보 필요] 이 원물의 보관 방법·개봉 후 안내·먹지 말아야 할 상태·레시피(2~3개)가 비어 있다. 일반적인 내용으로 item 에 채운다.' : '',
    '[출력 형식] {"summary": "한 줄 소개 40자 이내", "description": "3~4문장 소개", "blocks": [{"type": "text", "title": "", "body": ""}, {"type": "photo", "hint": ""}, …], "faq": [{"q": "질문", "a": "답"}] (3개, 보관·배송·활용·구성 위주, 답은 1~2문장)'
      + (input.needItem ? `, "item": {"storage_method": "", "opened_note": "", "danger_signs": [""], "recipes": [${RECIPE_FORMAT}]}` : '') + '}',
  ].filter(Boolean).join('\n')

  // 상품당 한 번이라 상담과 달리 무료 모델을 모두 차례로 시도한다 (한 모델이 붐벼도 초안은 나오게)
  // 답이 잘리거나 형식이 깨지면(긴 글이라 생각하는 모델이 한도를 다 쓰는 경우) 그 모델을 빼고 한 번 더
  let result
  let draft
  const flagged = []
  const tried = []
  for (let attempt = 1; attempt <= 2 && !draft; attempt += 1) {
    try {
      // 소개 + 상세 블록 5~9개 + 자주 묻는 질문 + 품목 초안이라 답 길이 한도를 넉넉히 (생각하는 모델은 생각에도 토큰을 쓴다)
      result = await complete([{ role: 'system', content: RULES }, { role: 'user', content: prompt }], { maxTokens: 5000, timeoutMs: 90_000, lightThinking: true, skip: tried })
    } catch (error) {
      if (error.code === 'DAILY_LIMIT') return res.status(429).json({ error: '오늘 AI 사용 한도에 닿았어요. 내일 다시 하거나 직접 적어 주세요.' })
      describeAiError(error) // 기록만 남기고, 안내는 초안에 맞게
      return res.status(503).json({ error: '지금은 AI 모델이 모두 붐벼서 초안을 못 만들었어요. 잠시 뒤 다시 눌러 주거나 직접 적어 주세요.' })
    }
    try {
      flagged.length = 0
      draft = parseDraft(result.text, input, flagged)
    } catch {
      console.log(`[content] ${result.model} 초안 형식이 깨짐 (잘린 답) → 다른 모델로`)
      tried.push(result.model)
    }
  }
  if (!draft) return res.status(502).json({ error: 'AI 초안 형식이 맞지 않았어요. 한 번 더 눌러 주세요.' })
  const reply = { ...draft, flagged }
  await pool.query(
    `INSERT INTO chat_cache (key, reply, model) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET reply = $2, model = $3, hits = 0, created_at = now()`,
    [key, reply, result.model],
  )
  console.log(`[content] ${(req.admin ?? req.seller).loginId} AI 초안 (${t.name}) · 뺀 문장 ${flagged.length}`)
  res.json({ ...reply, template, aiCalls: 1, model: result.model })
}

// POST /items/:code/fill — 품목(원물)의 비어 있는 칸만 채운다 (이미 있는 내용은 절대 덮어쓰지 않음)
export async function fillItem(req, res) {
  const { rows } = await pool.query('SELECT * FROM items WHERE item_code = $1', [req.params.code])
  const item = rows[0]
  if (!item) return res.status(404).json({ error: '품목을 찾지 못했어요.' })
  // 품목 정보는 여러 농가가 함께 쓰고 손님 화면·상담에 그대로 나간다. 판매자는 자기가 요청한 검수 전 품목만 채운다 (검수 때 관리자가 본다)
  if (req.seller && !(item.status === 'pending' && item.requested_by === req.seller.sellerCode)) return res.json({ filled: 0, item })
  if (tooManyFills(req)) return res.status(429).json({ error: '너무 많이 요청했어요. 1시간 뒤에 다시 해 주세요.' })
  const b = req.body ?? {}
  const sets = []
  const params = [item.item_code]
  const add = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`) }
  if (empty(item.storage_method) && text(b.storage_method, 200)) add('storage_method', text(b.storage_method, 200))
  if (empty(item.opened_note) && text(b.opened_note, 200)) add('opened_note', text(b.opened_note, 200))
  if (empty(item.danger_signs) && Array.isArray(b.danger_signs)) add('danger_signs', b.danger_signs.slice(0, 5).map((s) => text(s, 30)).filter(Boolean))
  let newRecipes = []
  if (empty(item.recipes) && Array.isArray(b.recipes)) {
    newRecipes = b.recipes.slice(0, 3).map((r) => ({ title: text(r?.title, 30), ingredients: text(r?.ingredients, 60), method: text(r?.method, 120), photo: PHOTO_HINT.test(text(r?.photo, 400)) ? text(r?.photo, 400) : '' })).filter((r) => r.title && r.method)
    add('recipes', JSON.stringify(newRecipes.map(({ photo: _photo, ...r }) => r)))
  }
  const banned = findBanned(JSON.stringify(params.slice(1)))
  if (banned.length) return res.status(400).json({ error: `효능 표현은 쓰지 않아요: ${banned.join(', ')}` })
  if (!sets.length) return res.json({ filled: 0, item })
  const updated = await pool.query(`UPDATE items SET ${sets.join(', ')} WHERE item_code = $1 RETURNING *`, params)
  console.log(`[content] ${(req.admin ?? req.seller).loginId} 품목 ${item.item_code} 빈 칸 ${sets.length}개 채움`)
  // 레시피가 새로 생기면 사진도 만든다 (한 장에 몇 초라 응답은 기다리지 않고 뒤에서. 키가 없으면 기본 그림 그대로)
  const makePhotos = newRecipes.length > 0 && imageKeyLoaded() && !(req.seller && tooManySellerPhotos(req))
  if (makePhotos) photosInBackground(item.item_code, item.name, newRecipes)
  res.json({ filled: sets.length, item: updated.rows[0], photos: makePhotos ? 'making' : 'off' })
}

// 사진이 없는 레시피마다 사진을 만들어 붙인다. 그 사이 관리자가 레시피를 고쳤으면(제목이 다르면) 그 칸은 건드리지 않는다
export async function photosInBackground(itemCode, itemName, recipes) {
  for (const [n, recipe] of recipes.entries()) {
    if (recipe.image) continue
    let url
    try {
      url = await generateRecipePhoto(recipe, itemName)
    } catch (error) {
      console.warn(`[imagegen] ${itemCode} 레시피 ${n + 1} 사진 못 만듦: ${error.message}`)
      if (error.code === 'DAILY_LIMIT' || error.code === 'NO_KEY') return
      continue
    }
    await pool.query(
      `UPDATE items SET recipes = jsonb_set(recipes, $3::text[], to_jsonb($4::text))
       WHERE item_code = $1 AND recipes -> $2::int ->> 'title' = $5 AND NOT (recipes -> $2::int ? 'image')`,
      [itemCode, n, `{${n},image}`, url, recipe.title],
    ).catch((e) => console.warn(`[imagegen] ${itemCode} 사진 저장 실패 ${e.message}`))
    console.log(`[imagegen] ${itemCode} 레시피 ${n + 1} 사진 ${url}`)
  }
}

// POST /items/:code/draft (관리자) — 품목 검수 화면의 [AI로 빈 칸 채우기]. 비어 있는 보관·안전·레시피 칸의 초안만 돌려준다 (저장은 관리자가)
export async function itemDraft(req, res) {
  const { rows } = await pool.query('SELECT * FROM items WHERE item_code = $1', [req.params.code])
  const item = rows[0]
  if (!item) return res.status(404).json({ error: '품목을 찾지 못했어요.' })
  if (!keyLoaded()) return res.status(503).json({ error: 'AI 키가 없어 초안을 만들 수 없어요. 직접 적어 주세요.' })
  if (tooMany(req)) return res.status(429).json({ error: 'AI 초안을 너무 많이 만들었어요. 1시간 뒤에 다시 해 주세요.' })
  const fresh = item.category !== '가공품'
  const prompt = [
    `[품목] ${item.name} (${item.category})`,
    '이 원물의 일반적인 보관 방법, 먹으면 안 되는 상태(신호), 레시피 3개를 쓴다. 숫자(기간·온도)는 꼭 필요할 때만, 일반적인 값으로.',
    `[출력 형식] {"storage_method": "", ${fresh ? '"stage1_state": "신선한 상태", "stage2_state": "품질이 떨어졌지만 부패 징후는 없는 상태", ' : '"opened_note": "개봉 후", '}"danger_signs": ["", ""], "recipes": [${RECIPE_FORMAT}]}`,
  ].join('\n')
  let result
  try {
    result = await complete([{ role: 'system', content: RULES }, { role: 'user', content: prompt }], { maxTokens: 2000, timeoutMs: 60_000, lightThinking: true })
  } catch (error) {
    if (error.code === 'DAILY_LIMIT') return res.status(429).json({ error: '오늘 AI 사용 한도에 닿았어요. 내일 다시 하거나 직접 적어 주세요.' })
    describeAiError(error)
    return res.status(503).json({ error: '지금은 AI 모델이 모두 붐벼요. 잠시 뒤 다시 눌러 주세요.' })
  }
  const flagged = []
  let json
  try {
    json = JSON.parse(result.text.slice(result.text.indexOf('{'), result.text.lastIndexOf('}') + 1))
  } catch {
    return res.status(502).json({ error: 'AI 초안 형식이 맞지 않았어요. 한 번 더 눌러 주세요.' })
  }
  const allowed = ''
  const one = (v, max) => cleanText(v, allowed, flagged, max, false)
  const draft = {
    storage_method: empty(item.storage_method) ? one(json.storage_method, 400) : null,
    stage1_state: fresh && empty(item.stage1_state) ? one(json.stage1_state, 200) : null,
    stage2_state: fresh && empty(item.stage2_state) ? one(json.stage2_state, 200) : null,
    opened_note: !fresh && empty(item.opened_note) ? one(json.opened_note, 200) : null,
    danger_signs: empty(item.danger_signs) && Array.isArray(json.danger_signs) ? json.danger_signs.slice(0, 6).map((s) => one(s, 80)).filter(Boolean) : null,
    recipes: empty(item.recipes) && Array.isArray(json.recipes) ? json.recipes.slice(0, 3).map((r) => draftRecipe(r, allowed, flagged)).filter((r) => r.title && r.method) : null,
  }
  console.log(`[content] ${req.admin.loginId} 품목 ${item.name} AI 초안 · 뺀 문장 ${flagged.length}`)
  res.json({ draft, flagged, model: result.model, photos: imageKeyLoaded() })
}

export const listTemplates = (req, res) => res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t })))

// ---------- 말로 상품 등록하기 (2026-11-21) ----------
// POST /ai/product-parse { text } → 상품 칸 (채우기만, 저장하지 않음)
//  1) 규칙으로 뽑는다 (AI 0회). 2) 품목이나 가격을 못 찾았을 때만 AI 에게 묻고, AI 가 준 숫자는 원래 말에 있는 것만 쓴다
const tooManyParses = createLimiter({ limit: 40, windowMs: 60 * 60_000, key: (req) => `parse:${(req.admin ?? req.seller)?.loginId}` })
const koreaToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
export async function productParse(req, res) {
  const said = text(req.body?.text, 500)
  if (said.length < 2) return res.status(400).json({ error: '파실 상품을 말하듯 적어 주세요. 예: 부사 사과 5키로 3만 원, 당도 14' })
  if (tooManyParses(req)) return res.status(429).json({ error: '너무 많이 눌렀어요. 잠시 뒤에 다시 해 주세요.' })
  const items = (await pool.query("SELECT item_code, name, category, brix_standards FROM items ORDER BY name")).rows
  const today = koreaToday()
  const fields = parseSpoken(said, items, today)
  let aiCalls = 0
  const needAi = !fields.item_code || (!fields.price && !fields.options)
  if (needAi && keyLoaded()) {
    const list = items.map((i) => `${i.item_code}=${i.name}`).join(', ')
    const prompt = [
      '농가가 파는 상품을 말한 문장이다. 아래 형식의 JSON 하나만 출력한다. 문장에 없는 값은 null 로 둔다. 숫자를 지어내지 않는다.',
      `[품목 목록] ${list}`,
      `[문장] ${said}`,
      '[형식] {"item_code": "목록의 코드 또는 null", "name": "상품 이름 (품종 품목 무게)", "price": 숫자 또는 null, "unit": "판매 단위 예: 5kg 1박스", "options": [{"name": "5kg 1박스", "price": 숫자}] 또는 [], "brix": 숫자 또는 null, "stock": 숫자 또는 null}',
    ].join('\n')
    try {
      const result = await complete([{ role: 'system', content: RULES }, { role: 'user', content: prompt }], { maxTokens: 600, timeoutMs: 30_000, lightThinking: true })
      aiCalls = 1
      const json = JSON.parse(String(result.text).replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
      const checked = checkAiFields(json, said, items, today)
      for (const [k, v] of Object.entries(checked)) if (fields[k] === undefined) fields[k] = v // 규칙으로 찾은 값이 먼저
    } catch (error) {
      if (error.code !== 'DAILY_LIMIT') describeAiError(error)
      // AI 가 안 되면 규칙으로 찾은 만큼만 채운다
    }
  }
  // 숫자 칸 모양 다시 확인 (서버가 저장할 때도 한 번 더 검사한다)
  for (const k of ['price', 'stock', 'brix', 'count_per_box']) if (fields[k] !== undefined && !/^\d+(\.\d)?$/.test(String(fields[k]))) delete fields[k]
  const LABELS = { item_code: '품목', variety: '품종', name: '상품 이름', price: '가격', unit: '판매 단위', options: '판매 옵션', brix: '당도', stock: '재고', count_per_box: '박스당 개수', harvest_date: '수확일' }
  const filled = Object.keys(LABELS).filter((k) => fields[k] !== undefined)
  const missing = ['item_code', 'name', 'price', 'unit', 'stock'].filter((k) => fields[k] === undefined && !(k === 'price' && fields.options) && !(k === 'stock' && fields.options))
  console.log(`[content] ${(req.admin ?? req.seller).loginId} 말로 등록 · 채운 칸 ${filled.length} · AI ${aiCalls}회`)
  res.json({ fields, filled: filled.map((k) => LABELS[k]), missing: missing.map((k) => LABELS[k]), aiCalls })
}
