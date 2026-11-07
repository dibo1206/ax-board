// 재입고 알림 (2026-11-07): 품절 상품(또는 품절 옵션)에 이메일을 남기면, 다시 들어왔을 때 메일로 한 번 알린다.
//  - 신청: POST /api/products/:code/restock { email, optionId?, agree: true } — 품절일 때만 받는다
//  - 알림: 재고가 다시 생긴 신청을 찾아 메일을 넣고 보낸 시각을 남긴다 (관리자·농가가 상품을 바꾼 뒤, 그리고 5분마다 주문 정리 때)
//    주문 취소·결제 만료로 재고가 돌아온 경우도 5분 정리에서 잡힌다
//  - 보관: 보낸 신청은 30일, 못 보낸 신청은 180일 뒤에 지운다 (개인정보 처리방침). 회원 탈퇴 때도 지운다
import express from 'express'
import { currentCustomer } from './account.js'
import { lookupHash, openText, sealText } from './crypto.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { publicUrl, queueMail } from './mailer.js'

const isEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
const label = (name) => String(name ?? '').replace(/\[예시\]\s*/g, '')

export const restockRouter = express.Router()
const tooMany = createLimiter({ limit: 10, windowMs: 10 * 60_000 })

restockRouter.post('/products/:code/restock', async (req, res) => {
  const customer = await currentCustomer(req)
  const email = (typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '') || customer?.email || ''
  const optionId = req.body.optionId == null || req.body.optionId === '' ? null : Number(req.body.optionId)
  if (!isEmail(email)) return res.status(400).json({ error: '알림 받을 이메일을 확인해 주세요.' })
  if (optionId !== null && (!Number.isInteger(optionId) || optionId < 1 || optionId > 2_147_483_647)) return res.status(400).json({ error: '옵션을 다시 골라 주세요.' })
  if (req.body.agree !== true) return res.status(400).json({ error: '재입고 알림을 위한 이메일 수집·이용에 동의해 주세요.' })
  if (tooMany(req)) return res.status(429).json({ error: '알림 신청이 너무 많아요. 잠시 후 다시 시도해 주세요.' })

  const { rows } = await pool.query(
    `SELECT p.product_code, p.stock, o.id AS option_id, o.stock AS option_stock,
            EXISTS (SELECT 1 FROM product_options x WHERE x.product_code = p.product_code AND x.status = 'active') AS has_options
     FROM products p LEFT JOIN product_options o ON o.id = $2 AND o.product_code = p.product_code AND o.status = 'active'
     WHERE p.product_code = $1 AND p.status = 'active'`,
    [req.params.code, optionId],
  )
  const p = rows[0]
  if (!p || (optionId !== null && !p.option_id)) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  // 옵션 상품은 옵션을 골라 신청한다 (옵션 하나만 품절일 수 있어서). 살 수 있는 상품에는 신청을 받지 않는다
  if (p.has_options && optionId === null && p.stock > 0) return res.status(400).json({ error: '품절된 옵션을 골라 신청해 주세요.' })
  if ((optionId !== null ? p.option_stock : p.stock) > 0) return res.status(409).json({ error: '지금 살 수 있는 상품이에요.' })

  await pool.query(
    `INSERT INTO restock_requests (product_code, option_id, email, email_hash, customer_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_code, (COALESCE(option_id, 0)), email_hash) WHERE notified_at IS NULL DO NOTHING`,
    [p.product_code, optionId, sealText(email), lookupHash(email), customer?.id ?? null],
  )
  // 이미 신청한 이메일이어도 같은 답을 준다 (신청 여부를 알아내지 못하게)
  res.status(201).json({ message: '다시 들어오면 이 이메일로 한 번 알려 드릴게요.' })
})

// 다시 들어온 상품의 신청을 찾아 알림 메일을 넣는다. 동시에 두 번 돌아도 한 번만 보내게 줄을 잠그고 건너뛴다.
// 보낸 표시를 먼저 남기고(커밋) 그다음 메일을 넣는다 → DB 연결 하나로 도는 시험 서버에서도 막히지 않는다
let running = false
export async function sweepRestock() {
  if (running) return 0
  running = true
  let rows = []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    ;({ rows } = await client.query(
      `UPDATE restock_requests r SET notified_at = now()
       FROM products p
       WHERE r.id IN (
         SELECT r2.id FROM restock_requests r2
         JOIN products p2 ON p2.product_code = r2.product_code AND p2.status = 'active'
         LEFT JOIN product_options o2 ON o2.id = r2.option_id
         WHERE r2.notified_at IS NULL
           AND (CASE WHEN r2.option_id IS NULL THEN p2.stock > 0 ELSE o2.status = 'active' AND o2.stock > 0 END)
         ORDER BY r2.created_at LIMIT 200
         FOR UPDATE OF r2 SKIP LOCKED)
         AND p.product_code = r.product_code
       RETURNING r.email, r.product_code, p.name, (SELECT name FROM product_options WHERE id = r.option_id) AS option_name`,
    ))
    await client.query("DELETE FROM restock_requests WHERE notified_at < now() - interval '30 days' OR created_at < now() - interval '180 days'")
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    running = false
    throw error
  } finally {
    client.release()
  }
  try {
    for (const r of rows) {
      const name = `${label(r.name)}${r.option_name ? ` (${r.option_name})` : ''}`
      await queueMail({
        kind: 'restock',
        to: openText(r.email),
        subject: `[재입고] ${name}`.slice(0, 200),
        body: `신청하신 ${name} 상품이 다시 들어왔어요.\n${publicUrl()}/p/${encodeURIComponent(r.product_code)}\n\n수량이 많지 않을 수 있어요. 이 알림은 한 번만 보내요.\n`,
      })
    }
  } finally {
    running = false
  }
  if (rows.length) console.log(`[restock] 재입고 알림 ${rows.length}건`)
  return rows.length
}
