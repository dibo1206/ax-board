// 관리자·판매자 접속 기록: 누가(계정·역할) 언제 어디서(IP) 무엇을(로그인·요청 주소·결과) 했는지 남긴다.
// 요청 본문(주소·연락처 등)은 남기지 않고, 주소 경로에 들어 있는 주문번호 같은 대상만 남는다.
import express from 'express'
import { currentAdmin, requireAdmin } from './auth.js'
import { pool } from './db.js'

export async function writeAccessLog({ loginId = null, role = null, action, method = null, path = null, status = null, ip }) {
  await pool.query(
    'INSERT INTO access_logs (login_id, role, action, method, path, status, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [loginId?.slice(0, 40) ?? null, role, action, method, path?.slice(0, 200) ?? null, status, ip],
  ).catch((e) => console.error(`[access] 기록 실패 · ${e.message}`))
}

// /api/admin/*, /api/seller/* 요청을 응답이 끝난 뒤 기록한다 (로그인·로그아웃은 auth.js에서 따로)
export function accessLogger(req, res, next) {
  const path = req.originalUrl.split('?')[0]
  const skip = path === '/api/admin/login' || path === '/api/admin/logout' || path === '/api/admin/me'
  if (!skip) {
    res.on('finish', () => {
      const account = currentAdmin(req)
      writeAccessLog({
        loginId: account?.loginId, role: account?.role ?? (account ? 'admin' : null),
        action: 'request', method: req.method, path, status: res.statusCode, ip: req.ip,
      })
    })
  }
  next()
}

export const adminAccessLogRouter = express.Router()
adminAccessLogRouter.use(requireAdmin)

adminAccessLogRouter.get('/', async (req, res) => {
  const params = []
  let where = ''
  const loginId = typeof req.query.loginId === 'string' ? req.query.loginId.trim() : ''
  if (loginId) {
    params.push(loginId)
    where = 'WHERE login_id = $1'
  }
  const { rows } = await pool.query(`SELECT * FROM access_logs ${where} ORDER BY created_at DESC LIMIT 300`, params)
  const summary = await pool.query(`SELECT
    count(*) FILTER (WHERE action LIKE '%fail%' AND created_at > now() - interval '1 day')::int AS fails_today,
    count(*) FILTER (WHERE action = 'login_ok' AND created_at > now() - interval '1 day')::int AS logins_today
    FROM access_logs`)
  res.json({ summary: summary.rows[0], logs: rows })
})
