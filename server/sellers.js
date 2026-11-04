// 판매자 스스로 가입 → 관리자 승인 → 활동. 관리자 계정은 가입으로 만들 수 없다 (서버 명령어로만)
// 상품 자동 승인: 관리자가 한 명이라 전부 승인하면 판매가 늦어진다 → 믿을 만한 농가의 문제없는 상품은 바로 판매, 위험한 것만 관리자가 본다
import { randomBytes } from 'node:crypto'
import express from 'express'
import { checkPassword } from './account.js'
import { hashPassword, requireAdmin } from './auth.js'
import { findBanned } from './banned.js'
import { lookupHash, sealText } from './crypto.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { adminEmail, publicUrl, queueMail } from './mailer.js'
import { openSeller } from './pii.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const digits = (v) => text(v).replace(/[^0-9]/g, '')
const tooManySignups = createLimiter({ limit: 5, windowMs: 60 * 60_000 })

// ---------- 판매자 가입 ----------
export const sellerSignupRouter = express.Router()

sellerSignupRouter.post('/', async (req, res) => {
  const b = req.body ?? {}
  const loginId = text(b.loginId).toLowerCase()
  const farmName = text(b.farmName)
  const region = text(b.region)
  const ownerName = text(b.ownerName)
  const phone = digits(b.phone)
  const businessNo = digits(b.businessNo)
  const email = text(b.email).toLowerCase()
  const errors = []
  // 아이디에 @ 를 못 쓰게 해서 하나뿐인 로그인 칸에서 손님(이메일)과 판매자(아이디)를 구분한다
  if (!/^[a-z0-9_]{4,20}$/.test(loginId)) errors.push('아이디는 영문 소문자·숫자·밑줄 4~20자로 적어 주세요.')
  else if (/^(admin|root|manager|fourteam)/.test(loginId)) errors.push('쓸 수 없는 아이디예요. 다른 아이디를 적어 주세요.')
  const weak = checkPassword(b.password, loginId)
  if (weak) errors.push(weak)
  if (!farmName || farmName.length > 30) errors.push('농가·상호 이름을 30자 안으로 적어 주세요.')
  if (!region || region.length > 30) errors.push('지역을 30자 안으로 적어 주세요. (예: 충남 천안)')
  if (!ownerName || ownerName.length > 20) errors.push('대표자 이름을 20자 안으로 적어 주세요.')
  if (!/^0\d{8,10}$/.test(phone)) errors.push('연락처를 확인해 주세요.')
  if (businessNo.length !== 10) errors.push('사업자등록번호 10자리를 적어 주세요.')
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) errors.push('승인 결과를 받을 이메일을 확인해 주세요.')
  const bad = findBanned(farmName)
  if (bad.length) errors.push('농가·상호 이름에 쓸 수 없는 표현이 있어요.')
  const sensitive = findSensitive(farmName, region, ownerName)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (b.agreeTerms !== true || b.agreePrivacy !== true) errors.push('이용약관과 개인정보 수집·이용에 동의해 주세요.')
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooManySignups(req)) return res.status(429).json({ error: '가입 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' })

  const passwordHash = await hashPassword(b.password)
  const sellerCode = `f_${randomBytes(5).toString('hex')}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const same = await client.query('SELECT 1 FROM sellers WHERE business_no_hash = $1', [lookupHash(businessNo)])
    if (same.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: '이미 가입한 사업자등록번호예요. 회사로 문의해 주세요.' })
    }
    await client.query(
      `INSERT INTO sellers (seller_code, name, region, is_company, source, status, owner_name, phone, business_no, business_no_hash, email, applied_at)
       VALUES ($1, $2, $3, false, '판매자 가입', 'pending', $4, $5, $6, $7, $8, now())`,
      [sellerCode, farmName, region, sealText(ownerName), sealText(phone), sealText(businessNo), lookupHash(businessNo), sealText(email)],
    )
    const account = await client.query(
      "INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, 'seller', $3) ON CONFLICT (login_id) DO NOTHING RETURNING id",
      [loginId, passwordHash, sellerCode],
    )
    if (!account.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: '이미 쓰고 있는 아이디예요. 다른 아이디를 적어 주세요.' })
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  console.log(`[seller] 판매자 가입 신청 ${sellerCode}`)
  queueMail({ kind: 'admin_new_seller', to: adminEmail(), subject: `[판매자 가입 신청] ${farmName}`, body: `${farmName}(${region})에서 판매자 가입을 신청했어요.\n관리자 화면 [판매자 승인]에서 확인해 주세요: ${publicUrl()}/admin\n` })
  res.status(201).json({ loginId, status: 'pending' })
})

// ---------- 관리자: 판매자 승인 ----------
export const adminSellerRouter = express.Router()
adminSellerRouter.use(requireAdmin)

adminSellerRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.seller_code, s.name, s.region, s.is_company, s.status, s.owner_name, s.phone, s.business_no, s.email, s.reject_note, s.applied_at, s.approved_at,
           (SELECT string_agg(a.login_id, ', ') FROM admins a WHERE a.seller_code = s.seller_code) AS login_ids,
           (SELECT count(*) FROM products p WHERE p.seller_code = s.seller_code)::int AS products
    FROM sellers s ORDER BY (s.status = 'pending') DESC, s.applied_at DESC NULLS LAST, s.name`)
  res.json(rows.map(openSeller))
})

async function decide(req, res, status, note) {
  const { rows: updated } = await pool.query(
    `UPDATE sellers SET status = $2, reject_note = $3, approved_at = CASE WHEN $2 = 'active' THEN now() ELSE approved_at END
     WHERE seller_code = $1 AND NOT is_company RETURNING seller_code, name, status, email, reject_note`,
    [req.params.code, status, note],
  )
  if (!updated.length) return res.status(404).json({ error: '판매자를 찾지 못했어요.' })
  const rows = updated.map(openSeller)
  // 활동을 멈추면 그 농가 상품도 손님 화면에서 내린다 (다시 승인돼도 상품은 다시 요청해야 판매)
  if (status === 'rejected') {
    await pool.query(
      `UPDATE products SET status = 'draft', review_note = $2, rejected_at = now(), updated_at = now() WHERE seller_code = $1 AND status <> 'draft'`,
      [req.params.code, `판매자 활동 중지: ${note}`.slice(0, 300)],
    )
  }
  console.log(`[seller] ${req.admin.loginId} 판매자 ${rows[0].seller_code} → ${status}`)
  const [subject, body] = status === 'active'
    ? ['판매자 가입이 승인됐어요', `${rows[0].name}의 판매자 가입이 승인됐어요. 로그인해서 상품을 올려 주세요: ${publicUrl()}/account/login\n`]
    : ['판매자 가입을 승인하지 못했어요', `${rows[0].name}의 판매자 가입을 승인하지 못했어요.\n사유: ${note}\n`]
  queueMail({ kind: `seller_${status}`, to: rows[0].email, subject, body })
  res.json(rows[0])
}

adminSellerRouter.post('/:code/approve', (req, res) => decide(req, res, 'active', null))

adminSellerRouter.post('/:code/reject', (req, res) => {
  const note = text(req.body?.note)
  if (note.length < 2 || note.length > 300) return res.status(400).json({ error: '반려 사유를 2~300자로 적어 주세요. (판매자에게 보여요)' })
  return decide(req, res, 'rejected', note)
})

// ---------- 상품 자동 승인 ----------
export const TRUST_AFTER = 3 // 관리자가 이만큼 승인한 농가부터 바로 판매
const DISPUTE_LIMIT = 3 // 내 농가 상품 후기의 '표시와 달랐어요'가 이만큼 쌓이면 관리자가 확인

// 관리자가 봐야 하는 이유들. 비어 있으면 바로 판매한다
export async function reviewReasons(product) {
  const reasons = []
  const { rows: [s] } = await pool.query(
    `SELECT (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.admin_approved_at IS NOT NULL)::int AS approved,
            (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.rejected_at IS NOT NULL)::int AS rejected,
            (SELECT count(*) FROM reviews r JOIN products p ON p.product_code = r.product_code
             WHERE p.seller_code = $1 AND r.info_match = 'no' AND NOT r.hidden)::int AS disputes,
            (SELECT status FROM items WHERE item_code = $2) AS item_status,
            (SELECT show_brix FROM items WHERE item_code = $2) AS show_brix`,
    [product.seller_code, product.item_code],
  )
  if (s.approved < TRUST_AFTER) reasons.push(`처음 상품 ${TRUST_AFTER}개는 회사가 확인해요 (지금까지 ${s.approved}개 승인)`)
  if (s.item_status === 'pending') reasons.push('새 품목이라 검수가 필요해요')
  if (s.show_brix && product.brix && !product.brix_photo_url) reasons.push('당도계 사진이 없어요')
  if (s.rejected > 0) reasons.push('반려되거나 내려진 상품이 있어요')
  if (s.disputes >= DISPUTE_LIMIT) reasons.push(`'표시와 달랐어요' 후기가 ${s.disputes}개 있어요`)
  return reasons
}

// 사진까지 올린 뒤 부른다: 문제없으면 바로 판매, 아니면 검토 대기로 두고 이유를 남긴다
export async function submitProduct(product) {
  if (product.status !== 'pending') return { product, reasons: [] }
  const reasons = await reviewReasons(product)
  const { rows } = reasons.length
    ? await pool.query('UPDATE products SET review_reason = $2, updated_at = now() WHERE product_code = $1 RETURNING *', [product.product_code, reasons.join(' / ')])
    : await pool.query("UPDATE products SET status = 'active', review_reason = NULL, auto_approved_at = now(), auto_checked_at = NULL, updated_at = now() WHERE product_code = $1 RETURNING *", [product.product_code])
  return { product: rows[0], reasons }
}
