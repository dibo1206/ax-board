// 상품 상세 내용 AI 초안: 판매자·관리자가 기본 정보만 넣고 [AI로 채우기]를 누르면
// 한 줄 소개 · 상세 설명(고른 상세페이지 패턴 순서대로) · 자주 묻는 질문 초안을 만든다
//  - 상품당 한 번: 같은 입력 + 같은 패턴이면 저장해 둔 초안을 다시 준다 (AI 0회, 30일)
//  - 같은 원물(품목)의 보관법·레시피가 이미 있으면 그대로 쓰고, 비어 있을 때만 품목 초안도 만든다
//  - 금지어(효능 표현 등)가 든 문장, 입력에 없는 숫자(가격·당도·무게)를 쓴 문장은 빼고 무엇을 뺐는지 알려 준다
//  - 초안은 화면에 채워 주기만 한다. 판매자가 읽고 고친 뒤 저장해야 공개된다
import { createHash } from 'node:crypto'
import { complete, describeAiError, keyLoaded } from './ai.js'
import { findBanned } from './banned.js'
import { pool } from './db.js'
import { generateRecipePhoto, imageKeyLoaded } from './imagegen.js'
import { createLimiter } from './limit.js'

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

function parseDraft(raw, input, flagged) {
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  const allowed = input.facts.map(([, v]) => v).join(' ').replace(/,/g, '') + ' 1 2 3 4 5'
  const draft = {
    summary: cleanText(json.summary, allowed, flagged, 200),
    description: cleanText(json.description, allowed, flagged, 3000),
    faq: (Array.isArray(json.faq) ? json.faq : []).slice(0, 4).map((f) => ({
      q: cleanText(f?.q, allowed, flagged, 100),
      a: cleanText(f?.a, allowed, flagged, 300),
    })).filter((f) => f.q && f.a),
    item: null,
  }
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

  const key = createHash('sha256').update(`content-v2\n${template}\n${JSON.stringify(input.facts)}\n${input.needItem}`).digest('hex')
  const saved = await readCache(key)
  if (saved) return res.json({ ...saved.reply, template, aiCalls: 0, model: `cache:${saved.model}` })
  if (!keyLoaded()) return res.status(503).json({ error: 'AI 키가 없어 초안을 만들 수 없어요. 직접 적어 주세요.' })
  if (tooMany(req)) return res.status(429).json({ error: 'AI 초안을 너무 많이 만들었어요. 1시간 뒤에 다시 해 주세요.' })

  const t = TEMPLATES[template]
  const prompt = [
    `[상세페이지 순서] ${t.name}: ${t.sections.map((s) => `■ ${s}`).join(' → ')}`,
    'description 은 위 순서대로 각 섹션을 "■ 섹션 제목" 한 줄 + 2문장으로 짧게 쓰고, 섹션 사이는 빈 줄 하나.',
    '[상품 정보]',
    ...input.facts.map(([k, v]) => `- ${k}: ${v}`),
    input.needItem ? '[품목 정보 필요] 이 원물의 보관 방법·개봉 후 안내·먹지 말아야 할 상태·레시피(2~3개)가 비어 있다. 일반적인 내용으로 item 에 채운다.' : '',
    '[출력 형식] {"summary": "한 줄 소개 40자 이내", "description": "■ 제목\\n문장…\\n\\n■ 제목\\n문장…", "faq": [{"q": "질문", "a": "답"}] (3개, 보관·배송·활용·구성 위주, 답은 1~2문장)'
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
      // 설명 5단락 + 자주 묻는 질문 + 품목 초안이라 답 길이 한도를 넉넉히 (생각하는 모델은 생각에도 토큰을 쓴다)
      result = await complete([{ role: 'system', content: RULES }, { role: 'user', content: prompt }], { maxTokens: 4000, timeoutMs: 90_000, lightThinking: true, skip: tried })
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
