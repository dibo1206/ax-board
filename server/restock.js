// 재입고 알림 (2026-11-07): 품절 상품(또는 품절 옵션)에 이메일을 남기면, 다시 들어왔을 때 메일로 한 번 알린다.
//  - 신청: POST /api/products/:code/restock { email, optionId?, agree: true } — 품절일 때만 받는다
//  - 알림: 재고가 다시 생긴 신청을 찾아 메일을 넣고 보낸 시각을 남긴다 (관리자·농가가 상품을 바꾼 뒤, 그리고 5분마다 주문 정리 때)
//    주문 취소·결제 만료로 재고가 돌아온 경우도 5분 정리에서 잡힌다
//  - 보관: 보낸 신청은 30일, 못 보낸 신청은 180일 뒤에 지운다 (개인정보 처리방침). 회원 탈퇴 때도 지운다
//  - 신청 확인 메일과 취소 (2026-11-07, kigm0520 님 재입고 메일 데모 feat/restock-mail 참고):
//    새로 신청하면 확인 메일을 한 번 보내고, 그 안의 링크(/restock/cancel?token=…)에서 [취소하기]를 누르면 신청을 바로 지운다.
//    링크를 열기만 해서는 취소되지 않는다 (메일 보안 프로그램이 링크를 미리 열어 봐도 저절로 취소되지 않게). 토큰은 해시만 저장
//  - 재시도: 알림 메일을 메일함에 넣지 못하면 보낸 표시를 되돌려 다음 정리 때 다시 보낸다 (실제 발송 실패는 메일함이 다시 보낸다)
import { createHash, randomBytes } from 'node:crypto'
import express from 'express'
import { currentCustomer } from './account.js'
import { lookupHash, openText, sealText } from './crypto.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { publicUrl, queueMail } from './mailer.js'

const isEmail = (v) => v.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')
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
    `SELECT p.product_code, p.name, p.stock, o.id AS option_id, o.name AS option_name, o.stock AS option_stock,
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

  const token = randomBytes(24).toString('base64url')
  const inserted = await pool.query(
    `INSERT INTO restock_requests (product_code, option_id, email, email_hash, customer_id, cancel_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_code, (COALESCE(option_id, 0)), email_hash) WHERE notified_at IS NULL DO NOTHING RETURNING id`,
    [p.product_code, optionId, sealText(email), lookupHash(email), customer?.id ?? null, tokenHash(token)],
  )
  // 새로 들어간 신청에만 확인 메일 (같은 신청을 다시 해도 메일을 또 보내지 않는다)
  if (inserted.rowCount) {
    const name = `${label(p.name)}${p.option_name ? ` (${p.option_name})` : ''}`
    await queueMail({
      kind: 'restock_confirm',
      to: email,
      subject: `[재입고 알림 신청] ${name}`.slice(0, 200),
      body: `${name} 상품이 다시 들어오면 이 이메일로 한 번 알려 드릴게요.\n\n알림 신청을 취소하려면 아래 주소에서 [취소하기]를 눌러 주세요. 취소하면 남겨 주신 이메일을 바로 지워요.\n${publicUrl()}/restock/cancel?token=${token}\n\n직접 신청하지 않았다면 위 주소에서 취소하거나 이 메일을 무시해 주세요.\n`,
    })
  }
  // 이미 신청한 이메일이어도 같은 답을 준다 (신청 여부를 알아내지 못하게)
  res.status(201).json({ message: '다시 들어오면 이 이메일로 한 번 알려 드릴게요.' })
})

// 취소: 확인 메일 링크의 화면에서 [취소하기]를 누르면 부른다 (POST 라서 링크를 열기만 해서는 취소되지 않는다)
const tooManyCancels = createLimiter({ limit: 20, windowMs: 10 * 60_000 })
restockRouter.post('/restock/cancel', async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : ''
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(400).json({ error: '취소 주소가 올바르지 않아요. 메일의 주소를 그대로 열어 주세요.' })
  if (tooManyCancels(req)) return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  const { rowCount } = await pool.query('DELETE FROM restock_requests WHERE cancel_token_hash = $1', [tokenHash(token)])
  res.json({ cancelled: rowCount > 0, message: rowCount > 0 ? '재입고 알림 신청을 취소하고 이메일을 지웠어요.' : '이미 취소했거나, 알림을 보내서 끝난 신청이에요.' })
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
       RETURNING r.id, r.email, r.product_code, p.name, (SELECT name FROM product_options WHERE id = r.option_id) AS option_name`,
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
  const failed = []
  try {
    for (const r of rows) {
      const name = `${label(r.name)}${r.option_name ? ` (${r.option_name})` : ''}`
      const queued = await queueMail({
        kind: 'restock',
        to: openText(r.email),
        subject: `[재입고] ${name}`.slice(0, 200),
        body: `신청하신 ${name} 상품이 다시 들어왔어요.\n${publicUrl()}/p/${encodeURIComponent(r.product_code)}\n\n수량이 많지 않을 수 있어요. 이 알림은 한 번만 보내요.\n`,
      })
      if (!queued) failed.push(r.id)
    }
    // 메일함에 넣지 못한 신청은 보낸 표시를 되돌려 다음 정리 때 다시 보낸다
    if (failed.length) await pool.query('UPDATE restock_requests SET notified_at = NULL WHERE id = ANY($1::int[])', [failed]).catch((e) => console.error(`[restock] 되돌리기 실패 · ${e.message}`))
  } finally {
    running = false
  }
  const sent = rows.length - failed.length
  if (rows.length) console.log(`[restock] 재입고 알림 ${sent}건${failed.length ? ` · 메일함에 못 넣어 다음에 다시 ${failed.length}건` : ''}`)
  return sent
}
