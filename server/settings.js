// 쇼핑몰 설정 (2026-11-08): 사업자 정보 · 배송비 · 반품 기간 · 약관·처리방침·환불 정책 글을 관리자가 [쇼핑몰 설정]에서 고친다.
// 저장한 칸만 DB(shop_settings)에 두고, 서버를 켤 때 읽어 server/policy.js 의 값을 바꾼다. 주문 금액 계산·반품 기간 검사·상담 답·
// 손님 화면(푸터·정책 글·상품 고시)이 모두 같은 값을 보므로 저장하면 바로 함께 바뀐다
import express from 'express'
import { requireAdmin } from './auth.js'
import { clearCache } from './cache.js'
import { pool } from './db.js'
import { applySettings, currentSettings, defaultSettings, PLACEHOLDERS, SETTING_KEYS, validateSettings } from './policy.js'
import { scheduleRagSync } from './rag.js'

async function readSaved() {
  const { rows } = await pool.query('SELECT key, value, updated_at, updated_by FROM shop_settings')
  return rows.filter((r) => SETTING_KEYS.includes(r.key))
}

// 서버를 켤 때 한 번 (index.js)
export async function loadSettings() {
  const rows = await readSaved()
  applySettings(Object.fromEntries(rows.map((r) => [r.key, r.value])))
  if (rows.length) console.log(`[settings] 저장된 쇼핑몰 설정 ${rows.map((r) => r.key).join(', ')} 적용`)
}

async function reload() {
  await loadSettings()
  clearCache() // 상품 목록·상세의 고시 표(상담 전화)도 다시 만든다
  scheduleRagSync(0) // 상담 자료의 배송비·연락처·환불 정책 글도 새 값으로
}

export const adminSettingsRouter = express.Router()
adminSettingsRouter.use(requireAdmin)

adminSettingsRouter.get('/', async (req, res) => {
  const rows = await readSaved()
  res.json({ current: currentSettings(), defaults: defaultSettings(), placeholders: PLACEHOLDERS, saved: Object.fromEntries(rows.map((r) => [r.key, { updated_at: r.updated_at, updated_by: r.updated_by }])) })
})

adminSettingsRouter.put('/:key', async (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(404).json({ error: '고칠 수 없는 설정이에요.' })
  const { value, errors } = validateSettings(req.params.key, req.body)
  if (errors.length) return res.status(400).json({ error: errors.slice(0, 5).join(' '), errors })
  await pool.query(
    `INSERT INTO shop_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
    [req.params.key, JSON.stringify(value), req.admin.loginId],
  )
  await reload()
  console.log(`[settings] ${req.admin.loginId} 쇼핑몰 설정 ${req.params.key} 저장`)
  res.json({ current: currentSettings() })
})

// 기본값으로 되돌리기 (저장한 값을 지운다)
adminSettingsRouter.delete('/:key', async (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(404).json({ error: '고칠 수 없는 설정이에요.' })
  await pool.query('DELETE FROM shop_settings WHERE key = $1', [req.params.key])
  await reload()
  console.log(`[settings] ${req.admin.loginId} 쇼핑몰 설정 ${req.params.key} 기본값으로`)
  res.json({ current: currentSettings() })
})
