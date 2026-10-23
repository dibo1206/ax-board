// 4단계: 상품 Q&A와 기업(B2B) 구매 문의
// 손님용(로그인 없음)과 관리자용(로그인 필요) API를 나눈다. 연락처는 관리자 화면에서만 보인다.
import express from 'express'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { FORBIDDEN } from './validate.js'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const isPhone = (v) => /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(v)
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// 같은 곳(IP)에서 10분에 5번까지만 글을 남길 수 있다
const tooMany = createLimiter({ limit: 5, windowMs: 10 * 60_000 })

// 공개 화면에는 이름 첫 글자만 보여 준다: 김고객 → 김**, [예시] 김고객 → [예시] 김**
export function maskName(name) {
  const [, mark = '', rest = ''] = (name ?? '').match(/^(\[예시\]\s*)?(.*)$/)
  return rest ? `${mark}${[...rest][0]}**` : '손님'
}

// ---------- 손님용 ----------
export const publicInquiryRouter = express.Router()

publicInquiryRouter.post('/products/:code/questions', async (req, res) => {
  const author = text(req.body.author)
  const question = text(req.body.question)
  const contact = text(req.body.contact)
  const errors = []
  if (!author || author.length > 20) errors.push('이름(별명)을 20자 안으로 적어 주세요.')
  if (question.length < 5 || question.length > 500) errors.push('질문은 5~500자로 적어 주세요.')
  if (contact && !isPhone(contact) && !isEmail(contact)) errors.push('연락처는 전화번호나 이메일 형식으로 적어 주세요.')
  if (contact && !req.body.privacyAgreed) errors.push('연락처를 남기려면 개인정보 수집에 동의해 주세요.')
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooMany(req)) return res.status(429).json({ error: '짧은 시간에 글을 너무 많이 남겼어요. 잠시 후 다시 시도해 주세요.' })

  const product = await pool.query("SELECT 1 FROM products WHERE product_code = $1 AND status = 'active'", [req.params.code])
  if (!product.rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  const { rows } = await pool.query(
    `INSERT INTO questions (product_code, author, question, contact)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_code, question) DO NOTHING
     RETURNING id, author, question, answer, created_at`,
    [req.params.code, author, question, contact || null],
  )
  if (!rows.length) return res.status(409).json({ error: '같은 질문이 이미 올라와 있어요.' })
  res.status(201).json({ ...rows[0], author: maskName(rows[0].author) })
})

publicInquiryRouter.post('/b2b-inquiries', async (req, res) => {
  const body = {
    company: text(req.body.company),
    contactName: text(req.body.contactName),
    contact: text(req.body.contact),
    productCode: text(req.body.productCode),
    quantity: text(String(req.body.quantity ?? '')),
    message: text(req.body.message),
  }
  const errors = []
  if (!body.company || body.company.length > 50) errors.push('회사·매장 이름을 50자 안으로 적어 주세요.')
  if (!body.contactName || body.contactName.length > 20) errors.push('담당자 이름을 적어 주세요.')
  if (!isPhone(body.contact) && !isEmail(body.contact)) errors.push('연락처를 전화번호나 이메일 형식으로 적어 주세요.')
  if (body.quantity && (!/^\d+$/.test(body.quantity) || Number(body.quantity) === 0)) errors.push('수량은 1 이상의 숫자로 적어 주세요.')
  if (body.message.length > 1000) errors.push('요청사항은 1000자 안으로 적어 주세요.')
  if (!req.body.privacyAgreed) errors.push('연락을 위한 개인정보 수집에 동의해 주세요.')
  if (body.productCode) {
    const product = await pool.query("SELECT 1 FROM products WHERE product_code = $1 AND status = 'active'", [body.productCode])
    if (!product.rowCount) errors.push('문의한 상품을 찾지 못했어요.')
  }
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooMany(req)) return res.status(429).json({ error: '짧은 시간에 문의를 너무 많이 남겼어요. 잠시 후 다시 시도해 주세요.' })

  const { rows } = await pool.query(
    `INSERT INTO b2b_inquiries (company, contact_name, contact, product_code, quantity, message, privacy_agreed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id, created_at`,
    [body.company, body.contactName, body.contact, body.productCode || null, body.quantity || null, body.message || null],
  )
  console.log(`[b2b] 새 기업 구매 문의 #${rows[0].id}`)
  res.status(201).json({ id: rows[0].id, message: '문의가 접수됐어요. 담당자가 확인 후 연락드립니다.' })
})

// ---------- 관리자용 ----------
export const adminInquiryRouter = express.Router()
adminInquiryRouter.use(requireAdmin)
// 글 번호는 숫자만 받는다 (그 외는 없는 글로 처리)
adminInquiryRouter.param('id', (req, res, next, id) => {
  if (!/^\d{1,9}$/.test(id)) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  next()
})

adminInquiryRouter.get('/summary', async (req, res) => {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*) FROM questions WHERE answer IS NULL AND NOT hidden)::int AS unanswered,
    (SELECT count(*) FROM b2b_inquiries WHERE status = '접수')::int AS new_b2b`)
  res.json(rows[0])
})

adminInquiryRouter.get('/questions', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.*, p.name AS product_name FROM questions q JOIN products p ON p.product_code = q.product_code
    ORDER BY (q.answer IS NULL) DESC, q.created_at DESC`)
  res.json(rows)
})

// 답변 쓰기·고치기({ answer }) 또는 숨기기·다시 보이기({ hidden }). 보낸 것만 바꾼다
adminInquiryRouter.patch('/questions/:id', async (req, res) => {
  const hasAnswer = req.body.answer !== undefined
  const answer = text(req.body.answer)
  if (hasAnswer) {
    if (answer.length < 2 || answer.length > 1000) return res.status(400).json({ error: '답변을 2~1000자로 적어 주세요.' })
    const bad = FORBIDDEN.filter((w) => answer.includes(w))
    if (bad.length) return res.status(400).json({ error: `효능 표현은 쓰지 않아요: ${bad.join(', ')}` })
  }
  const hidden = typeof req.body.hidden === 'boolean' ? req.body.hidden : null
  if (!hasAnswer && hidden === null) return res.status(400).json({ error: '바꿀 내용이 없어요.' })
  const { rows } = await pool.query(
    `UPDATE questions SET
       answer = CASE WHEN $1 THEN $2 ELSE answer END,
       answered_at = CASE WHEN $1 THEN now() ELSE answered_at END,
       hidden = COALESCE($3, hidden)
     WHERE id = $4 RETURNING *`,
    [hasAnswer, answer, hidden, req.params.id],
  )
  if (!rows.length) return res.status(404).json({ error: '질문을 찾지 못했어요.' })
  console.log(`[qna] ${req.admin.loginId} 질문 #${rows[0].id} ${hasAnswer ? '답변' : hidden ? '숨김' : '다시 보임'}`)
  res.json(rows[0])
})

adminInquiryRouter.get('/b2b-inquiries', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, p.name AS product_name FROM b2b_inquiries b LEFT JOIN products p ON p.product_code = b.product_code
    ORDER BY CASE b.status WHEN '접수' THEN 0 WHEN '확인' THEN 1 ELSE 2 END, b.created_at DESC`)
  res.json(rows)
})

adminInquiryRouter.patch('/b2b-inquiries/:id', async (req, res) => {
  const status = text(req.body.status)
  if (!['접수', '확인', '완료'].includes(status)) return res.status(400).json({ error: '처리 상태는 접수·확인·완료 중 하나예요.' })
  const { rows } = await pool.query('UPDATE b2b_inquiries SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id])
  if (!rows.length) return res.status(404).json({ error: '문의를 찾지 못했어요.' })
  console.log(`[b2b] ${req.admin.loginId} 문의 #${rows[0].id} → ${status}`)
  res.json(rows[0])
})
