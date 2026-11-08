// 홈페이지 관리 (2026-11-08): 관리자가 첫 화면의 큰 배너·이야기 배너·제철 달력·자주 묻는 질문을 코드 없이 고친다.
// 저장한 값만 DB(site_content)에 두고, 없으면 코드의 기본값(src/shop/home/content.js)을 쓴다. 화면은 그리기 전에 받아 기본값을 바꾼다.
// 글은 글자 그대로 보여 준다(HTML 을 받지 않는다). 사진은 이 사이트 안의 사진 주소나 여기서 올린 사진만, 링크는 #칸 · /주소 · https 만
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import express from 'express'
import sharp from 'sharp'
import { IMAGE_TYPES, looksLike, rawImage, UPLOAD_DIR } from './admin.js'
import { currentStaff, requireAdmin } from './auth.js'
import { cached, clearCache } from './cache.js'
import { pool } from './db.js'

const PHOTO = /^(\/(home|about|product-photos|posts|recipe-photos)\/[A-Za-z0-9_.-]{1,100}\.(webp|png|jpe?g)|\/uploads\/site-[0-9a-f]{12}\.webp)$/
const HREF = /^(#[a-z-]{1,30}|\/[A-Za-z0-9_\-/?=&#.%]{0,200}|https:\/\/[^\s<>"'`]{3,300})$/
const POSITION = /^(left|center|right) (top|center|bottom|\d{1,3}%)$/

// 글 칸 하나: 앞뒤 공백을 빼고 길이를 본다
function str(errors, value, max, name, required = true) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (required && !s) errors.push(`${name}을(를) 적어 주세요.`)
  else if (s.length > max) errors.push(`${name}은(는) ${max}자 안으로 적어 주세요.`)
  return s
}
const list = (v) => (Array.isArray(v) ? v : [])
const interval = (v, fallback) => Math.min(15000, Math.max(3000, Number(v) || fallback))

function photo(errors, p, name) {
  const src = typeof p?.src === 'string' ? p.src.trim() : ''
  if (!PHOTO.test(src)) errors.push(`${name} 사진 주소가 올바르지 않아요. 사진을 올리거나 /home/… 처럼 이 사이트 안의 사진을 골라 주세요.`)
  const position = typeof p?.position === 'string' && POSITION.test(p.position.trim()) ? p.position.trim() : 'center 50%'
  return { src, alt: str(errors, p?.alt, 100, `${name} 사진 설명`), position }
}

const CHECK = {
  hero(v, errors) {
    const title = list(v.title).map((t, i) => str(errors, t, 20, `큰 제목 ${i + 1}줄`, false)).filter(Boolean)
    if (!title.length || title.length > 3) errors.push('큰 제목은 1~3줄로 적어 주세요.')
    const slides = list(v.slides).slice(0, 8).map((s, i) => ({ ...photo(errors, s, `배너 ${i + 1}`), cover: s?.cover === true, scrim: s?.scrim === true }))
    if (!slides.length) errors.push('배너 사진을 1장 이상 넣어 주세요.')
    return {
      eyebrow: str(errors, v.eyebrow, 60, '작은 제목', false), title, lead: str(errors, v.lead, 200, '소개 글'),
      cta: str(errors, v.cta, 30, '버튼 글'), interval: interval(v.interval, 5000), slides,
    }
  },
  story(v, errors) {
    const slides = list(v.slides).slice(0, 5).map((s, i) => {
      const n = `이야기 ${i + 1}`
      const title = list(s?.title).map((t) => str(errors, t, 20, `${n} 제목`, false)).filter(Boolean).slice(0, 2)
      if (!title.length) errors.push(`${n} 제목을 적어 주세요.`)
      const links = list(s?.links).slice(0, 2).map((l, j) => {
        const href = typeof l?.href === 'string' ? l.href.trim() : ''
        if (!HREF.test(href)) errors.push(`${n} 버튼 ${j + 1} 주소는 #칸이름, /주소, https://… 중 하나로 적어 주세요.`)
        return { label: str(errors, l?.label, 20, `${n} 버튼 ${j + 1} 글`), href }
      })
      return { title, text: str(errors, s?.text, 300, `${n} 글`), photo: photo(errors, s?.photo, n), links }
    })
    if (!slides.length) errors.push('이야기를 1개 이상 넣어 주세요.')
    return { label: str(errors, v.label, 20, '이야기 칸 이름'), interval: interval(v.interval, 7000), slides }
  },
  season(v, errors) {
    const items = list(v.items).slice(0, 40).map((it, i) => {
      const months = [...new Set(list(it?.months).map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b)
      if (!months.length) errors.push(`제철 품목 ${i + 1}의 제철 달을 1개 이상 골라 주세요.`)
      const search = str(errors, it?.search, 20, `제철 품목 ${i + 1} 찾을 말`, false)
      return { name: str(errors, it?.name, 12, `제철 품목 ${i + 1} 이름`), ...(search ? { search } : {}), months }
    })
    if (!items.length) errors.push('제철 품목을 1개 이상 넣어 주세요.')
    return { items, note: str(errors, v.note, 200, '아래 안내', false) }
  },
  faq(v, errors) {
    const items = list(v.items).slice(0, 20).map((it, i) => ({
      ...(typeof it?.tag === 'string' && /^[a-z]{1,12}$/.test(it.tag) ? { tag: it.tag } : {}),
      q: str(errors, it?.q, 100, `질문 ${i + 1}`), a: str(errors, it?.a, 600, `답 ${i + 1}`),
      ...(it?.action === 'recommend' ? { action: 'recommend' } : {}),
    }))
    if (!items.length) errors.push('질문을 1개 이상 넣어 주세요.')
    return { lead: str(errors, v.lead, 200, '위쪽 안내', false), items, note: str(errors, v.note, 200, '아래 안내', false) }
  },
}
export const SITE_KEYS = Object.keys(CHECK)

// 한 칸 검사: 고친 값(서버가 다듬은 것)과 오류 목록 (시험에서도 쓴다)
export function validateSiteContent(key, body) {
  const errors = []
  const value = Object.hasOwn(CHECK, key) ? CHECK[key](body ?? {}, errors) : null
  return { value, errors }
}

// ---------- 손님 화면 ----------
export const publicSiteRouter = express.Router()

publicSiteRouter.get('/site-content', async (req, res) => {
  res.json(await cached('site-content', 30_000, async () => {
    const { rows } = await pool.query('SELECT key, value FROM site_content')
    return Object.fromEntries(rows.filter((r) => SITE_KEYS.includes(r.key)).map((r) => [r.key, r.value]))
  }))
})

// 손님 화면 맨 위 관리자 막대: 관리자·판매자로 로그인했으면 누구인지만 (관리자 접속 기록에는 남기지 않는다)
publicSiteRouter.get('/staff', async (req, res) => {
  res.set('Cache-Control', 'private, no-store')
  const staff = await currentStaff(req)
  res.json(staff ? { loginId: staff.loginId, role: staff.role ?? 'admin' } : null)
})

// ---------- 관리자 ----------
export const adminSiteRouter = express.Router()
adminSiteRouter.use(requireAdmin)

adminSiteRouter.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT key, value, updated_at, updated_by FROM site_content')
  res.json(Object.fromEntries(rows.map((r) => [r.key, r])))
})

// 배너·이야기 사진 올리기: jpg·png·webp 2MB 이하 → 긴 변 2400px 이하 WebP, 사진 속 정보(GPS 등)는 지운다
adminSiteRouter.post('/image', rawImage, async (req, res) => {
  const type = req.headers['content-type']
  if (!IMAGE_TYPES[type] || !Buffer.isBuffer(req.body) || !req.body.length || !looksLike(type, req.body)) {
    return res.status(400).json({ error: '사진은 jpg, png, webp 파일만 올릴 수 있어요. (2MB 이하)' })
  }
  let buffer
  try {
    buffer = await sharp(req.body, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  } catch {
    return res.status(400).json({ error: '사진을 읽지 못했어요. 다른 사진으로 올려 주세요.' })
  }
  const name = `site-${randomBytes(6).toString('hex')}.webp`
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(new URL(name, UPLOAD_DIR), buffer)
  console.log(`[site] ${req.admin.loginId} 홈페이지 사진 올림 ${name}`)
  res.status(201).json({ url: `/uploads/${name}` })
})

adminSiteRouter.put('/:key', async (req, res) => {
  if (!Object.hasOwn(CHECK, req.params.key)) return res.status(404).json({ error: '고칠 수 없는 칸이에요.' })
  const { value, errors } = validateSiteContent(req.params.key, req.body)
  if (errors.length) return res.status(400).json({ error: errors.slice(0, 5).join(' '), errors })
  const { rows } = await pool.query(
    `INSERT INTO site_content (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3 RETURNING key, value, updated_at, updated_by`,
    [req.params.key, JSON.stringify(value), req.admin.loginId],
  )
  clearCache()
  console.log(`[site] ${req.admin.loginId} 홈페이지 ${req.params.key} 저장`)
  res.json(rows[0])
})

// 기본값으로 되돌리기 (저장한 값을 지운다)
adminSiteRouter.delete('/:key', async (req, res) => {
  if (!Object.hasOwn(CHECK, req.params.key)) return res.status(404).json({ error: '고칠 수 없는 칸이에요.' })
  await pool.query('DELETE FROM site_content WHERE key = $1', [req.params.key])
  clearCache()
  console.log(`[site] ${req.admin.loginId} 홈페이지 ${req.params.key} 기본값으로`)
  res.status(204).end()
})
