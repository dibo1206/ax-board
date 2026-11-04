// data/*.csv 를 검사하고 DB(farm 스키마)에 넣는다.
//   npm run load-data           검사 후 오류가 없으면 DB에 넣기
//   npm run load-data -- --check  검사만 (DB에 넣지 않음)
// 결과는 docs/data_report.md 에 남긴다. 오류가 하나라도 있으면 아무것도 넣지 않는다.
import 'dotenv/config'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { sealText } from '../server/crypto.js'
import { initDb, pool } from '../server/db.js'
import { syncOptionTotals } from '../server/options.js'
import { parseCsv } from './csv.js'

const DATA = new URL('../data/', import.meta.url)
const REPORT = new URL('../docs/data_report.md', import.meta.url)
const CHECK_ONLY = process.argv.includes('--check')

const OWNERS = {
  'sellers.csv': '이다현',
  'items.csv': '김가온(과일·채소), 이현서(가공품)',
  'tags.csv': '이희석',
  'products.csv': '김재훈',
  'product_options.csv': '김재훈',
  'questions.csv': '박형우',
  'chatbot_tests.csv': '박형우',
}
const COLUMNS = {
  'sellers.csv': ['seller_code', 'name', 'region', 'intro', 'story', 'is_company', 'source'],
  'items.csv': ['item_code', 'name', 'category', 'show_brix', 'storage_method', 'fresh_days_stage1',
    'fresh_days_stage2', 'stage1_uses', 'stage2_uses', 'stage3_uses', 'opened_note', 'allergens',
    'danger_signs', 'recipes', 'source', 'reviewed_by', 'stage1_state', 'stage2_state', 'keep_period', 'danger_note', 'allergen_note', 'cafe_note'],
  'tags.csv': ['tag_code', 'group', 'label'],
  'products.csv': ['product_code', 'seller_code', 'item_code', 'name', 'price', 'unit', 'stock', 'weight_g',
    'count_per_box', 'brix', 'brix_measured_at', 'harvest_date', 'summary', 'external_url', 'b2b_available',
    'tags', 'source'],
  // 판매 옵션 (예: 같은 사과를 5kg·10kg 로). 옵션이 있는 상품은 옵션을 골라야 살 수 있고, products.csv 의 가격·재고는 옵션에서 다시 계산한다
  'product_options.csv': ['product_code', 'name', 'price', 'stock', 'source'],
  'questions.csv': ['product_code', 'author', 'question', 'answer', 'source'],
  'chatbot_tests.csv': ['question_type', 'question', 'expected', 'expected_source'],
}
// 효능을 주장하는 표현은 쓰지 않는다 (식품 표시·광고 규정)
const FORBIDDEN = ['면역력', '다이어트', '치료', '예방', '해독', '항암', '혈압', '혈당']

async function readSheet(file, issues) {
  const text = await readFile(new URL(file, DATA), 'utf8')
  const [header, ...body] = parseCsv(text)
  const missing = COLUMNS[file].filter((c) => !header.includes(c))
  if (missing.length) issues.error(file, 0, `칸 이름이 없어요: ${missing.join(', ')}`)
  return body.map((cells, index) => {
    if (cells.length !== header.length) issues.error(file, index + 2, `칸 수가 ${cells.length}개예요 (첫 줄은 ${header.length}개)`)
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
}

// ---------- 검사 ----------
function makeIssues() {
  const list = []
  return {
    list,
    error: (file, line, message) => list.push({ level: '오류', file, line, message }),
    warn: (file, line, message) => list.push({ level: '확인', file, line, message }),
  }
}

const isCode = (v) => /^[a-z0-9_]+$/.test(v)
const isInt = (v) => /^\d+$/.test(v)
const isNum = (v) => /^\d+(\.\d+)?$/.test(v)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const isYesNo = (v) => v === '예' || v === '아니오'
const list = (v) => (v ? v.split('|').map((s) => s.trim()).filter(Boolean) : [])

function checkCommon(file, rows, codeKey, issues, needsExampleMark = false) {
  const seen = new Set()
  rows.forEach((r, i) => {
    const line = i + 2
    if (codeKey) {
      if (!isCode(r[codeKey])) issues.error(file, line, `${codeKey} "${r[codeKey]}"는 영문 소문자·숫자·밑줄만 쓸 수 있어요`)
      if (seen.has(r[codeKey])) issues.error(file, line, `${codeKey} "${r[codeKey]}"가 두 번 나와요`)
      seen.add(r[codeKey])
    }
    const text = Object.values(r).join(' ')
    FORBIDDEN.filter((w) => text.includes(w)).forEach((w) => issues.error(file, line, `효능 표현 "${w}"는 쓰지 않아요`))
    if (needsExampleMark && /예시/.test(r.source ?? '') && !r.name.includes('[예시]')) {
      issues.warn(file, line, '출처가 예시인데 이름에 [예시]가 없어요')
    }
  })
  return seen
}

function validate(sheets, issues) {
  const { 'sellers.csv': sellers, 'items.csv': items, 'tags.csv': tags, 'products.csv': products,
    'product_options.csv': options, 'questions.csv': questions, 'chatbot_tests.csv': tests } = sheets

  const sellerCodes = checkCommon('sellers.csv', sellers, 'seller_code', issues, true)
  sellers.forEach((r, i) => { if (!isYesNo(r.is_company)) issues.error('sellers.csv', i + 2, 'is_company는 예/아니오') })

  const itemCodes = checkCommon('items.csv', items, 'item_code', issues)
  const itemByCode = Object.fromEntries(items.map((r) => [r.item_code, r]))
  items.forEach((r, i) => {
    const line = i + 2
    if (!['과일', '채소', '가공품'].includes(r.category)) issues.error('items.csv', line, 'category는 과일/채소/가공품')
    if (!isYesNo(r.show_brix)) issues.error('items.csv', line, 'show_brix는 예/아니오')
    for (const k of ['fresh_days_stage1', 'fresh_days_stage2']) {
      if (r[k] && !isInt(r[k])) issues.error('items.csv', line, `${k}는 숫자(일)만`)
    }
    // 신선도는 상태(stage1_state·stage2_state)로 적는다. 옛 방식(며칠)만 있어도 받는다
    if (r.category !== '가공품' && !(r.stage1_state && r.stage2_state) && !(r.fresh_days_stage1 && r.fresh_days_stage2)) {
      issues.warn('items.csv', line, '신선 농산물인데 신선도 단계(신선·품질 저하 상태)가 비어 있어요')
    }
    if (r.category === '가공품' && !r.opened_note) issues.warn('items.csv', line, '가공품인데 개봉 후 안내가 비어 있어요')
    if (!r.danger_signs) issues.warn('items.csv', line, '먹으면 안 되는 신호가 비어 있어요')
    list(r.recipes).forEach((recipe) => {
      if (recipe.split(':').length !== 3) issues.error('items.csv', line, `레시피 "${recipe}"는 제목:재료:방법 형식으로`)
    })
    if (!r.reviewed_by) issues.warn('items.csv', line, '식품팀 검수 전 (reviewed_by 비어 있음)')
  })

  const tagCodes = checkCommon('tags.csv', tags, 'tag_code', issues)

  const productCodes = checkCommon('products.csv', products, 'product_code', issues, true)
  products.forEach((r, i) => {
    const line = i + 2
    if (!sellerCodes.has(r.seller_code)) issues.error('products.csv', line, `농가 코드 "${r.seller_code}"가 sellers.csv에 없어요`)
    if (!itemCodes.has(r.item_code)) issues.error('products.csv', line, `품목 코드 "${r.item_code}"가 items.csv에 없어요`)
    if (!isInt(r.price) || Number(r.price) === 0) issues.error('products.csv', line, `가격 "${r.price}"는 0보다 큰 숫자(원)만`)
    if (!isInt(r.stock)) issues.error('products.csv', line, `재고 "${r.stock}"는 숫자만`)
    for (const k of ['weight_g', 'count_per_box']) if (r[k] && !isInt(r[k])) issues.error('products.csv', line, `${k}는 숫자만`)
    if (r.brix) {
      if (!isNum(r.brix)) issues.error('products.csv', line, `당도 "${r.brix}"는 숫자만`)
      else if (Number(r.brix) === 0) issues.warn('products.csv', line, '당도가 0이에요. 모르면 비워 두세요')
      if (itemByCode[r.item_code]?.show_brix === '아니오') issues.warn('products.csv', line, '이 품목은 당도를 보여 주지 않는데 당도가 적혀 있어요')
      if (!r.brix_measured_at) issues.warn('products.csv', line, '당도를 잰 날짜가 비어 있어요')
    }
    for (const k of ['brix_measured_at', 'harvest_date']) if (r[k] && !isDate(r[k])) issues.error('products.csv', line, `${k} "${r[k]}"는 2026-10-17 형식으로`)
    if (!isYesNo(r.b2b_available)) issues.error('products.csv', line, 'b2b_available는 예/아니오')
    // image_url 은 선택 칸: 없거나 비워 두면 사진 없이 넣는다. 적으려면 /product-photos/상품코드.webp 처럼 이 저장소 안의 주소만
    if (r.image_url) {
      if (!/^\/[A-Za-z0-9_\-./]+\.webp$/.test(r.image_url)) issues.error('products.csv', line, `image_url "${r.image_url}"는 /product-photos/상품코드.webp 처럼 / 로 시작하는 .webp 주소만`)
      else if (!existsSync(new URL(`../public${r.image_url}`, import.meta.url))) issues.warn('products.csv', line, `image_url 파일이 public${r.image_url} 에 없어요`)
    }
    if (r.notice) {
      try { JSON.parse(r.notice) } catch { issues.error('products.csv', line, 'notice 는 JSON 형식으로') }
    }
    if (r.external_url && !/^https?:\/\//.test(r.external_url)) issues.error('products.csv', line, '판매 링크는 http로 시작해야 해요')
    const productTags = list(r.tags)
    productTags.filter((t) => !tagCodes.has(t)).forEach((t) => issues.error('products.csv', line, `태그 "${t}"가 tags.csv에 없어요`))
    if (productTags.length < 3 || productTags.length > 5) issues.warn('products.csv', line, `태그가 ${productTags.length}개예요 (3~5개 권장)`)
  })

  const optionNames = new Set()
  options.forEach((r, i) => {
    const line = i + 2
    if (!productCodes.has(r.product_code)) issues.error('product_options.csv', line, `상품 코드 "${r.product_code}"가 products.csv에 없어요`)
    if (!r.name || r.name.length > 30) issues.error('product_options.csv', line, '옵션 이름을 30자 안으로 적어 주세요 (예: 5kg 1박스)')
    if (optionNames.has(`${r.product_code}:${r.name}`)) issues.error('product_options.csv', line, `옵션 "${r.name}"가 같은 상품에 두 번 나와요`)
    optionNames.add(`${r.product_code}:${r.name}`)
    if (!isInt(r.price) || Number(r.price) === 0) issues.error('product_options.csv', line, `가격 "${r.price}"는 0보다 큰 숫자(원)만`)
    if (!isInt(r.stock)) issues.error('product_options.csv', line, `재고 "${r.stock}"는 숫자만`)
  })
  checkCommon('product_options.csv', options, null, issues)

  questions.forEach((r, i) => {
    if (!productCodes.has(r.product_code)) issues.error('questions.csv', i + 2, `상품 코드 "${r.product_code}"가 products.csv에 없어요`)
  })
  checkCommon('questions.csv', questions, null, issues)
  checkCommon('chatbot_tests.csv', tests, null, issues)

  // 사이트 시험용 상품이 들어 있는지
  if (!products.some((r) => r.stock === '0')) issues.warn('products.csv', 0, '재고 0인 시험용 상품이 없어요')
  if (!products.some((r) => itemByCode[r.item_code]?.category === '과일' && !r.brix)) issues.warn('products.csv', 0, '당도 빈칸인 과일 시험용 상품이 없어요')
  if (!products.some((r) => !r.external_url)) issues.warn('products.csv', 0, '판매 링크 없는 시험용 상품이 없어요')
}

// ---------- DB에 넣기 (한 번에, 실패하면 전부 취소) ----------
const nullable = (v) => (v === '' ? null : v)
const yes = (v) => v === '예'
const recipesJson = (v) => JSON.stringify(list(v).map((r) => {
  const [title, ingredients, method] = r.split(':')
  return { title, ingredients, method }
}))

async function load(sheets) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const r of sheets['sellers.csv']) {
      await client.query(
        `INSERT INTO sellers (seller_code, name, region, intro, story, is_company, source, owner_name, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (seller_code) DO UPDATE SET name=$2, region=$3, intro=$4, story=$5, is_company=$6, source=$7, owner_name=$8, phone=$9`,
        [r.seller_code, r.name, nullable(r.region), nullable(r.intro), nullable(r.story), yes(r.is_company), nullable(r.source), sealText(nullable(r.owner_name ?? '')), sealText(nullable(r.phone ?? ''))],
      )
    }
    for (const r of sheets['items.csv']) {
      await client.query(
        `INSERT INTO items (item_code, name, category, show_brix, storage_method, fresh_days_stage1, fresh_days_stage2,
           stage1_uses, stage2_uses, stage3_uses, opened_note, allergens, danger_signs, recipes, source, reviewed_by,
           stage1_state, stage2_state, keep_period, danger_note, allergen_note, cafe_note, brix_standards, brix_standard_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,COALESCE($23::jsonb, '[]'::jsonb),$24)
         ON CONFLICT (item_code) DO UPDATE SET name=$2, category=$3, show_brix=$4, storage_method=$5,
           fresh_days_stage1=$6, fresh_days_stage2=$7, stage1_uses=$8, stage2_uses=$9, stage3_uses=$10,
           opened_note=$11, allergens=$12, danger_signs=$13, recipes=$14, source=$15, reviewed_by=$16,
           stage1_state=$17, stage2_state=$18, keep_period=$19, danger_note=$20, allergen_note=$21, cafe_note=$22,
           brix_standards=COALESCE($23::jsonb, items.brix_standards), brix_standard_source=COALESCE($24, items.brix_standard_source)`,
        [r.item_code, r.name, r.category, yes(r.show_brix), nullable(r.storage_method), nullable(r.fresh_days_stage1),
          nullable(r.fresh_days_stage2), list(r.stage1_uses), list(r.stage2_uses), list(r.stage3_uses),
          nullable(r.opened_note), list(r.allergens), list(r.danger_signs), recipesJson(r.recipes),
          nullable(r.source), nullable(r.reviewed_by),
          nullable(r.stage1_state), nullable(r.stage2_state), nullable(r.keep_period), nullable(r.danger_note), nullable(r.allergen_note), nullable(r.cafe_note), nullable(r.brix_standards ?? ''), nullable(r.brix_standard_source ?? '')],
      )
    }
    for (const r of sheets['tags.csv']) {
      await client.query(
        `INSERT INTO tags (tag_code, tag_group, label) VALUES ($1,$2,$3)
         ON CONFLICT (tag_code) DO UPDATE SET tag_group=$2, label=$3`,
        [r.tag_code, r.group, r.label],
      )
    }
    for (const r of sheets['products.csv']) {
      await client.query(
        `INSERT INTO products (product_code, seller_code, item_code, name, price, unit, stock, weight_g, count_per_box,
           brix, brix_measured_at, harvest_date, summary, external_url, b2b_available, tags, source, image_url, notice, variety, brix_photo_url, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::jsonb, '{}'::jsonb),$20,$21, now())
         ON CONFLICT (product_code) DO UPDATE SET seller_code=$2, item_code=$3, name=$4, price=$5, unit=$6, stock=$7,
           weight_g=$8, count_per_box=$9, brix=$10, brix_measured_at=$11, harvest_date=$12, summary=$13,
           external_url=$14, b2b_available=$15, tags=$16, source=$17, image_url=COALESCE($18, products.image_url), notice=COALESCE($19::jsonb, products.notice), variety=COALESCE($20, products.variety), brix_photo_url=COALESCE($21, products.brix_photo_url), updated_at=now()`,
        [r.product_code, r.seller_code, r.item_code, r.name, Number(r.price), r.unit, Number(r.stock),
          nullable(r.weight_g), nullable(r.count_per_box), nullable(r.brix), nullable(r.brix_measured_at),
          nullable(r.harvest_date), nullable(r.summary), nullable(r.external_url), yes(r.b2b_available),
          list(r.tags), nullable(r.source), nullable(r.image_url ?? ''), nullable(r.notice ?? ''), nullable(r.variety ?? ''), nullable(r.brix_photo_url ?? '')],
      )
    }
    // 판매 옵션: 표의 순서대로. 표에 있는 상품의 옵션 중 표에서 빠진 것은 주문 기록이 없으면 지우고, 있으면 판매 중지
    const optionRows = sheets['product_options.csv']
    for (const [index, r] of optionRows.entries()) {
      await client.query(
        `INSERT INTO product_options (product_code, name, price, stock, status, sort_order)
         VALUES ($1,$2,$3,$4,'active',$5)
         ON CONFLICT (product_code, name) DO UPDATE SET price=$3, stock=$4, status='active', sort_order=$5, updated_at=now()`,
        [r.product_code, r.name, Number(r.price), Number(r.stock), index],
      )
    }
    const csvCodes = sheets['products.csv'].map((r) => r.product_code)
    const keptOptions = optionRows.map((r) => `${r.product_code}:${r.name}`)
    const leftOver = "o.product_code = ANY($1) AND NOT (o.product_code || ':' || o.name = ANY($2))"
    const ordered = 'EXISTS (SELECT 1 FROM order_items oi WHERE oi.option_id = o.id)'
    await client.query(`DELETE FROM product_options o WHERE ${leftOver} AND NOT ${ordered}`, [csvCodes, keptOptions])
    await client.query(`UPDATE product_options o SET status = 'stopped', updated_at = now() WHERE ${leftOver} AND ${ordered}`, [csvCodes, keptOptions])
    await syncOptionTotals(client, csvCodes) // 옵션 상품의 가격·재고를 판매 중 옵션의 최저가·재고 합으로
    for (const r of sheets['questions.csv']) {
      await client.query(
        `INSERT INTO questions (product_code, author, question, answer, answered_at)
         VALUES ($1,$2,$3,$4, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (product_code, question) DO UPDATE SET author=$2, answer=$4`,
        [r.product_code, r.author, r.question, nullable(r.answer)],
      )
    }
    // 표에서 빠진 예시 상품은 손님 화면에서 내린다. 주문 기록이 있을 수 있어 지우지 않고, 직접 등록한 상품은 건드리지 않는다
    const kept = sheets['products.csv'].map((r) => r.product_code)
    const dropped = await client.query(
      "UPDATE products SET status = 'draft', updated_at = now() WHERE source LIKE '[예시%' AND status <> 'draft' AND NOT (product_code = ANY($1)) RETURNING product_code",
      [kept],
    )
    await client.query('UPDATE questions SET hidden = true WHERE product_code = ANY($1)', [dropped.rows.map((r) => r.product_code)])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// ---------- 실행 ----------
const issues = makeIssues()
const sheets = {}
for (const file of Object.keys(COLUMNS)) sheets[file] = await readSheet(file, issues)
validate(sheets, issues)

const errors = issues.list.filter((x) => x.level === '오류')
const counts = Object.entries(sheets).map(([f, rows]) => `| ${f} | ${OWNERS[f]} | ${rows.length} |`).join('\n')
let loaded = '검사만 했어요 (--check)'
if (!CHECK_ONLY && errors.length === 0) {
  await initDb()
  await load(sheets)
  const { rows } = await pool.query(`SELECT
    (SELECT count(*) FROM sellers) AS sellers, (SELECT count(*) FROM items) AS items,
    (SELECT count(*) FROM tags) AS tags, (SELECT count(*) FROM products) AS products,
    (SELECT count(*) FROM product_options) AS options, (SELECT count(*) FROM questions) AS questions`)
  loaded = `DB에 넣었어요 → 농가 ${rows[0].sellers}, 품목 ${rows[0].items}, 태그 ${rows[0].tags}, 상품 ${rows[0].products}, 옵션 ${rows[0].options}, Q&A ${rows[0].questions}`
} else if (errors.length > 0) {
  loaded = `오류 ${errors.length}건이 있어 DB에 넣지 않았어요`
}

const byOwner = issues.list.length === 0
  ? '문제 없음'
  : issues.list.map((x) => `| ${x.level} | ${OWNERS[x.file]} | ${x.file} | ${x.line || '-'} | ${x.message} |`).join('\n')
const report = `# 데이터 검사 결과

- 실행 시각: ${new Date().toISOString()}
- 결과: ${loaded}
- 오류 ${errors.length}건, 확인 ${issues.list.length - errors.length}건

## 파일별 행 수

| 파일 | 담당 | 행 수 |
|---|---|---|
${counts}

## 고칠 것 (담당자별)

${issues.list.length === 0 ? byOwner : `| 구분 | 담당 | 파일 | 줄 | 내용 |\n|---|---|---|---|---|\n${byOwner}`}

- 오류: 고치기 전에는 DB에 넣지 않음
- 확인: 넣기는 하지만 담당자가 한 번 봐야 할 것
`
await writeFile(REPORT, report)
console.log(loaded)
console.log(`오류 ${errors.length}건, 확인 ${issues.list.length - errors.length}건 → docs/data_report.md`)
await pool.end()
process.exit(errors.length > 0 ? 1 : 0)
