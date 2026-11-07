// 새 품목 요청과 검수: 판매자가 목록에 없는 품목(예: 수박)을 요청 → [AI로 채우기]로 품목 초안 → 규칙 1차 검사 → 관리자가 출처를 적고 검수 완료
// 품목 정보(보관·먹으면 안 되는 신호)는 안전 정보라 AI 가 최종 판단하지 않는다. 검수 전에는 손님 화면·상담에 내보내지 않는다
import { randomBytes } from 'node:crypto'
import { findBanned } from './banned.js'
import { BRIX_SOURCE, OFFICIAL, readStandards } from './brix.js'
import { pool } from './db.js'

const CATEGORIES = ['과일', '채소', '가공품']
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const textList = (v, maxItems, maxLength) => (Array.isArray(v) ? v.map((s) => text(s, maxLength)).filter(Boolean).slice(0, maxItems) : [])
const RECIPE_IMAGE = /^\/(?!.*\.\.)[A-Za-z0-9_\-./]+\.(webp|png|jpe?g)$/

// POST /items/request {name, category} — 관리자·판매자. 같은 이름이 있으면 그 품목을 돌려준다
export async function requestItem(req, res) {
  const name = text(req.body?.name, 21)
  const category = req.body?.category
  if (!name || name.length > 20 || !/^[가-힣A-Za-z0-9 ]+$/.test(name)) return res.status(400).json({ error: '품목 이름은 20자 안의 한글·영문·숫자로 적어 주세요. (예: 수박)' })
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: '종류(과일·채소·가공품)를 골라 주세요.' })
  if (findBanned(name).length) return res.status(400).json({ error: '품목 이름에 쓸 수 없는 표현이 있어요.' })
  const same = await pool.query('SELECT * FROM items WHERE name = $1', [name])
  if (same.rowCount) return res.json({ item: same.rows[0], existed: true })
  const who = req.seller ? req.seller.sellerCode : `admin:${req.admin.loginId}`
  const { rows } = await pool.query(
    `INSERT INTO items (item_code, name, category, show_brix, stage1_uses, stage2_uses, stage3_uses, allergens, danger_signs, recipes, status, requested_by, brix_standards, brix_standard_source)
     VALUES ($1, $2, $3, $5, '{}', '{}', '{}', '{}', '{}', '[]', 'pending', $4, $6, $7) RETURNING *`,
    // 공식 당도 규격에 있는 품목(수박 등)은 기준을 바로 붙인다. 없으면 측정값만 보여 준다
    [`item_${randomBytes(4).toString('hex')}`, name, category, who, Boolean(OFFICIAL[name]), JSON.stringify(OFFICIAL[name] ?? []), OFFICIAL[name] ? BRIX_SOURCE : null],
  )
  console.log(`[items] ${(req.seller ?? req.admin).loginId} 새 품목 요청 ${name} (${category})`)
  res.status(201).json({ item: rows[0], existed: false })
}

// 규칙 1차 검사 (AI 호출 없음). error 가 하나라도 있으면 검수 완료를 막는다
const ASSERT_SAFE = /(먹어도|드셔도|마셔도|섭취해도)\s*(돼|됩니다|괜찮)|안전(합니다|해요|하다)/
const NUMBER = /\d+(\.\d+)?\s*(~\s*\d+\s*)?(일|주|개월|달|시간|℃|도)/
export function checkItem(item) {
  const issues = []
  const fields = [
    ['보관법', item.storage_method], ['신선한 상태', item.stage1_state], ['품질 저하 상태', item.stage2_state],
    ['보관 기간 참고', item.keep_period], ['개봉 후', item.opened_note], ['신호 예외 안내', item.danger_note], ['알레르기 안내', item.allergen_note], ['카페 메뉴 비율', item.cafe_note],
    ...(item.danger_signs ?? []).map((s) => ['먹으면 안 되는 신호', s]),
    ...(item.recipes ?? []).map((r) => ['레시피', `${r.title}: ${r.ingredients} — ${r.method}`]),
  ]
  for (const [field, value] of fields) {
    if (!value) continue
    const banned = findBanned(value)
    if (banned.length) issues.push({ level: 'error', field, text: value, problem: `금지어(${banned.join(', ')})` })
    if (ASSERT_SAFE.test(value)) issues.push({ level: 'error', field, text: value, problem: '먹어도 된다·안전하다고 단정하면 안 돼요' })
    if (NUMBER.test(value)) issues.push({ level: 'warn', field, text: value, problem: '기간·온도 숫자는 출처에서 확인해 주세요' })
  }
  if (!item.storage_method) issues.push({ level: 'error', field: '보관법', problem: '비어 있어요' })
  if (!item.danger_signs?.length) issues.push({ level: 'error', field: '먹으면 안 되는 신호', problem: '비어 있어요' })
  if (!item.source) issues.push({ level: 'error', field: '출처', problem: '확인한 자료(기관·제목·주소)를 적어 주세요' })
  if (item.category !== '가공품' && !(item.stage1_state && item.stage2_state)) issues.push({ level: 'warn', field: '신선도 상태', problem: '신선·품질 저하 상태가 비어 있어요' })
  if (item.category === '가공품' && !item.opened_note) issues.push({ level: 'warn', field: '개봉 후', problem: '비어 있어요' })
  if (!item.recipes?.length) issues.push({ level: 'warn', field: '레시피', problem: '비어 있어요' })
  if (item.brix_standards?.length && !item.brix_standard_source) issues.push({ level: 'error', field: '당도 기준', problem: '기준의 출처를 적어 주세요' })
  if (item.brix_min != null && item.brix_max != null && Number(item.brix_min) > Number(item.brix_max)) issues.push({ level: 'error', field: '보통 당도 범위', problem: '최소가 최대보다 커요' })
  if (item.show_brix && item.brix_min == null && item.brix_max == null) issues.push({ level: 'warn', field: '보통 당도 범위', problem: '비어 있으면 판매자가 적은 당도를 범위로 검사하지 않아요' })
  return issues
}

// GET /items/review — 검수 기다리는 품목 + 1차 검사 결과 + 그 품목을 쓰는 상품. ?all=1 이면 검수 끝난 품목도 (고치기용)
export async function listReview(req, res) {
  const { rows } = await pool.query(`
    SELECT i.*, COALESCE(json_agg(json_build_object('code', p.product_code, 'name', p.name, 'status', p.status))
      FILTER (WHERE p.product_code IS NOT NULL), '[]') AS products
    FROM items i LEFT JOIN products p ON p.item_code = i.item_code
    WHERE i.status = 'pending' OR $1 GROUP BY i.item_code ORDER BY (i.status = 'pending') DESC, i.category, i.name`, [req.query.all === '1'])
  res.json(rows.map((item) => ({ ...item, issues: checkItem(item) })))
}

// PUT /items/:code — 관리자가 품목 정보를 고친다 (검수 전·후 모두)
export async function saveItem(req, res) {
  const b = req.body ?? {}
  const recipes = (Array.isArray(b.recipes) ? b.recipes : []).slice(0, 5)
    .map((r) => {
      // 레시피 카드 사진(선택): 이 사이트 public 안의 주소만 받는다. 없으면 화면이 요리 종류에 맞는 기본 그림을 쓴다
      const image = text(r?.image, 200)
      return { title: text(r?.title, 30), ingredients: text(r?.ingredients, 60), method: text(r?.method, 120), ...(RECIPE_IMAGE.test(image) ? { image } : {}) }
    })
    .filter((r) => r.title && r.method)
  const brixLimit = (v) => (v === '' || v == null || !/^\d{1,2}(\.\d)?$/.test(String(v)) ? null : Number(v))
  const values = {
    show_brix: b.show_brix === true,
    brix_min: brixLimit(b.brix_min), // 보통 당도 범위: 판매자가 이 범위 밖 당도를 적으면 막힌다
    brix_max: brixLimit(b.brix_max),
    brix_standards: JSON.stringify(readStandards(b.brix_standards)),
    brix_standard_source: text(b.brix_standard_source, 300) || null,
    storage_method: text(b.storage_method, 400) || null,
    stage1_state: text(b.stage1_state, 200) || null,
    stage2_state: text(b.stage2_state, 200) || null,
    stage1_uses: textList(b.stage1_uses, 5, 30),
    stage2_uses: textList(b.stage2_uses, 5, 30),
    stage3_uses: textList(b.stage3_uses, 5, 30),
    keep_period: text(b.keep_period, 120) || null,
    opened_note: text(b.opened_note, 200) || null,
    allergens: textList(b.allergens, 10, 20),
    danger_signs: textList(b.danger_signs, 6, 80),
    danger_note: text(b.danger_note, 200) || null,
    allergen_note: text(b.allergen_note, 300) || null,
    cafe_note: text(b.cafe_note, 400) || null,
    recipes: JSON.stringify(recipes),
    source: text(b.source, 1000) || null,
  }
  const columns = Object.keys(values)
  const { rows } = await pool.query(
    `UPDATE items SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE item_code = $1 RETURNING *`,
    [req.params.code, ...columns.map((c) => values[c])],
  )
  if (!rows.length) return res.status(404).json({ error: '품목을 찾지 못했어요.' })
  console.log(`[items] ${req.admin.loginId} 품목 ${req.params.code} 수정`)
  res.json({ ...rows[0], issues: checkItem(rows[0]) })
}

// POST /items/:code/approve — 1차 검사에 error 가 없을 때만 검수 완료. 누가 언제 했는지 남긴다
export async function approveItem(req, res) {
  const { rows } = await pool.query('SELECT * FROM items WHERE item_code = $1', [req.params.code])
  if (!rows.length) return res.status(404).json({ error: '품목을 찾지 못했어요.' })
  const errors = checkItem(rows[0]).filter((i) => i.level === 'error')
  if (errors.length) return res.status(400).json({ error: `먼저 고쳐 주세요: ${errors.map((e) => `${e.field} — ${e.problem}`).join(' / ')}`, issues: errors })
  const reviewed = `${req.admin.loginId} (${new Date().toISOString().slice(0, 10)})`
  const updated = await pool.query("UPDATE items SET status = 'active', reviewed_by = $2 WHERE item_code = $1 RETURNING *", [req.params.code, reviewed])
  console.log(`[items] ${req.admin.loginId} 품목 ${rows[0].name} 검수 완료`)
  res.json(updated.rows[0])
}

// 검수 전 품목은 손님 화면·상담에 이름과 종류만 내보낸다 (AI 초안의 보관·안전 정보가 확인 없이 나가지 않게)
export function publicItem(item) {
  if (!item || item.status !== 'pending') return item
  return {
    item_code: item.item_code, name: item.name, category: item.category, show_brix: false, pending: true,
    storage_method: null, stage1_state: null, stage2_state: null, keep_period: null, opened_note: null, danger_note: null, allergen_note: null, cafe_note: null,
    fresh_days_stage1: null, fresh_days_stage2: null, stage1_uses: [], stage2_uses: [], stage3_uses: [],
    allergens: [], danger_signs: [], recipes: [], source: null, reviewed_by: null,
  }
}
