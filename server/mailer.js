// 이메일 알림. 보낼 메일은 먼저 email_outbox에 저장하고 보낸다 → 메일 서버가 잠깐 끊겨도 다음 정리 때 다시 보낸다.
// 메일 서버 설정(.env 의 SMTP_*)이 없으면 보내지 않고 'skipped'로 남긴다 (관리자 [알림 기록]에서 내용 확인).
import nodemailer from 'nodemailer'
import { pool } from './db.js'

const MAX_ATTEMPTS = 5
let transport

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM)
}

function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1', // 465 포트면 1
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return transport
}

// 비밀번호 찾기 링크 같은 비밀값은 보낸 뒤 저장본에서 지운다 (관리자가 알림 기록을 봐도 남의 계정을 못 쓰게)
const redact = (body) => body.replace(/token=[A-Za-z0-9_-]+/g, 'token=[보낸 뒤 지움]')

async function deliver(row) {
  if (!mailConfigured()) {
    await pool.query("UPDATE email_outbox SET status = 'skipped', body = $2 WHERE id = $1", [row.id, redact(row.body)])
    if (row.kind === 'password_reset' && process.env.NODE_ENV !== 'production') console.log(`[mail] 메일 설정이 없어 보내지 않았어요 (개발용 링크): ${row.body.match(/https?:\/\/\S+/)?.[0] ?? ''}`)
    return
  }
  try {
    await getTransport().sendMail({ from: process.env.MAIL_FROM, to: row.to_email, subject: row.subject, text: row.body })
    await pool.query("UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, body = $2 WHERE id = $1", [row.id, redact(row.body)])
  } catch (error) {
    const giveUp = row.attempts + 1 >= MAX_ATTEMPTS
    await pool.query(
      `UPDATE email_outbox SET status = $2, attempts = attempts + 1, last_error = $3 ${giveUp ? ', body = $4' : ''} WHERE id = $1`,
      giveUp ? [row.id, 'failed', error.message.slice(0, 200), redact(row.body)] : [row.id, 'queued', error.message.slice(0, 200)],
    )
    console.warn(`[mail] 보내기 실패 #${row.id} (${row.attempts + 1}/${MAX_ATTEMPTS}) · ${error.message}`)
  }
}

// 메일 넣기. 실패해도 주문·가입 같은 본래 일을 막지 않는다
export async function queueMail({ kind, to, subject, body }) {
  if (!to) return
  try {
    const { rows } = await pool.query(
      'INSERT INTO email_outbox (kind, to_email, subject, body) VALUES ($1, $2, $3, $4) RETURNING *',
      [kind, to, subject.slice(0, 200), body],
    )
    deliver(rows[0]).catch((e) => console.error(`[mail] ${e.message}`))
  } catch (error) {
    console.error(`[mail] 메일을 넣지 못했어요 · ${error.message}`)
  }
}

export const adminEmail = () => process.env.ADMIN_EMAIL || null
export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3066}`).replace(/\/$/, '')

// 정리할 때: 못 보낸 메일을 다시 보낸다
export async function retryMails() {
  const { rows } = await pool.query(
    "SELECT * FROM email_outbox WHERE status = 'queued' AND created_at < now() - interval '1 minute' AND attempts < $1 ORDER BY id LIMIT 20",
    [MAX_ATTEMPTS],
  )
  for (const row of rows) await deliver(row)
}

// ---------- 관리자: 알림 기록 ----------
export async function listMails() {
  const { rows } = await pool.query(
    'SELECT id, kind, to_email, subject, body, status, attempts, last_error, created_at, sent_at FROM email_outbox ORDER BY id DESC LIMIT 200',
  )
  return { configured: mailConfigured(), mails: rows }
}
