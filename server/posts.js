// 공지사항·언론보도·자주 묻는 질문 게시판 (회사 홈페이지의 고객센터 메뉴를 옮김, 2026-11-08 / 자주 묻는 질문 2026-11-12)
// 관리자가 쓰고, 손님은 목록·상세로 본다. 공지는 첫 화면 팝업으로 띄울 수 있다 (끝나는 날까지).
// 자주 묻는 질문은 제목이 질문, 내용이 답이다. 목록에서 바로 펼쳐 읽게 답 전체를 함께 보내고, 상담 자료(RAG)에도 들어간다
// 본문은 글자 그대로 보여 준다 (HTML 을 받지 않아서 글에 스크립트를 넣을 수 없다). 링크는 https 주소만
import express from 'express'
import { requireAdmin } from './auth.js'
import { cached, clearCache } from './cache.js'
import { pool } from './db.js'
import { scheduleRagSync } from './rag.js'

export const POST_KINDS = { notice: '공지사항', faq: '자주 묻는 질문', press: '언론보도' }
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
const PAGE_SIZE = 10
const pageSizeOf = (kind) => (kind === 'faq' ? 30 : PAGE_SIZE)
// 글을 저장·삭제하면 상담 자료도 다시 만든다 (자주 묻는 질문 글이 바뀌었을 수 있어서. 바뀐 조각만 다시 계산한다)
const afterChange = () => { clearCache(); scheduleRagSync() }
const LINK = /^https:\/\/[^\s<>"'`]{3,300}$/
const IMAGE = /^\/posts\/[A-Za-z0-9_-]{1,80}\.(webp|png|jpe?g)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const excerpt = (body) => body.replace(/\s+/g, ' ').trim().slice(0, 90)
const FIELDS = 'id, kind, title, body, link_url, image_url, pinned, created_at'

// ---------- 손님 ----------
export const publicPostRouter = express.Router()

publicPostRouter.get('/posts', async (req, res) => {
  const kind = Object.hasOwn(POST_KINDS, req.query.kind) ? req.query.kind : 'notice'
  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1))
  res.json(await cached(`posts:${kind}:${page}`, 30_000, async () => {
    const { rows } = await pool.query(
      `SELECT ${FIELDS}, count(*) OVER () AS total FROM posts
       WHERE kind = $1 AND NOT hidden ORDER BY pinned DESC, created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [kind, pageSizeOf(kind), (page - 1) * pageSizeOf(kind)],
    )
    const total = Number(rows[0]?.total ?? 0)
    return {
      kind, title: POST_KINDS[kind], total, page, pages: Math.max(1, Math.ceil(total / pageSizeOf(kind))),
      items: rows.map(({ total: _t, body, ...p }) => ({ ...p, excerpt: excerpt(body), ...(kind === 'faq' ? { body } : {}) })),
    }
  }))
})

// 첫 화면 팝업으로 띄울 공지 (가장 최근 1개). 끝나는 날이 지났으면 띄우지 않는다
publicPostRouter.get('/posts/popup', async (req, res) => {
  res.json(await cached('posts:popup', 30_000, async () => {
    const { rows } = await pool.query(
      `SELECT ${FIELDS} FROM posts WHERE kind = 'notice' AND popup AND NOT hidden
         AND (popup_until IS NULL OR popup_until >= ${TODAY})
       ORDER BY created_at DESC LIMIT 1`,
    )
    return rows[0] ?? null
  }))
})

publicPostRouter.get('/posts/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  const post = await cached(`post:${req.params.id}`, 30_000, async () => {
    const { rows } = await pool.query(`SELECT ${FIELDS} FROM posts WHERE id = $1 AND NOT hidden`, [req.params.id])
    if (!rows.length) return null
    const p = rows[0]
    // 같은 게시판의 이전·다음 글 (목록 순서: 고정 글 먼저, 최신 순)
    const near = await pool.query(
      `(SELECT id, title, 'newer' AS dir FROM posts WHERE kind = $1 AND NOT hidden AND (created_at, id) > ($2, $3) ORDER BY created_at, id LIMIT 1)
       UNION ALL
       (SELECT id, title, 'older' FROM posts WHERE kind = $1 AND NOT hidden AND (created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC LIMIT 1)`,
      [p.kind, p.created_at, p.id],
    )
    return { ...p, newer: near.rows.find((r) => r.dir === 'newer') ?? null, older: near.rows.find((r) => r.dir === 'older') ?? null }
  })
  if (!post) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  res.json(post)
})

// ---------- 관리자 ----------
export const adminPostRouter = express.Router()
adminPostRouter.use(requireAdmin)

adminPostRouter.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM posts ORDER BY kind, pinned DESC, created_at DESC, id DESC LIMIT 500')
  res.json(rows)
})

// 관리자 화면에서 보낸 글 하나를 검사한다. 빠진 값은 기본값 (부분 수정이 아니라 폼 전체를 보낸다)
function readPost(b = {}) {
  const post = {
    kind: Object.hasOwn(POST_KINDS, b.kind) ? b.kind : null,
    title: text(b.title),
    body: text(b.body),
    link_url: text(b.link_url) || null,
    image_url: text(b.image_url) || null,
    pinned: b.pinned === true,
    popup: b.popup === true,
    popup_until: text(b.popup_until) || null,
    hidden: b.hidden === true,
  }
  const errors = []
  if (!post.kind) errors.push('게시판(공지사항·자주 묻는 질문·언론보도)을 골라 주세요.')
  if (post.title.length < 2 || post.title.length > 100) errors.push('제목을 2~100자로 적어 주세요.')
  if (post.body.length > 5000) errors.push('내용은 5000자 안으로 적어 주세요.')
  if (post.link_url && !LINK.test(post.link_url)) errors.push('링크는 https:// 로 시작하는 주소만 넣을 수 있어요.')
  if (post.image_url && !IMAGE.test(post.image_url)) errors.push('사진은 /posts/파일이름.webp 처럼 이 사이트의 posts 폴더 주소만 넣을 수 있어요.')
  if (post.popup && post.kind !== 'notice') errors.push('팝업은 공지사항만 띄울 수 있어요.')
  if (post.popup_until && !DATE.test(post.popup_until)) errors.push('팝업 끝나는 날을 확인해 주세요.')
  if (!post.popup) post.popup_until = null
  return { post, errors }
}

adminPostRouter.post('/', async (req, res) => {
  const { post, errors } = readPost(req.body)
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  const { rows } = await pool.query(
    `INSERT INTO posts (kind, title, body, link_url, image_url, pinned, popup, popup_until, hidden, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [post.kind, post.title, post.body, post.link_url, post.image_url, post.pinned, post.popup, post.popup_until, post.hidden, req.admin.loginId],
  )
  afterChange()
  console.log(`[posts] ${req.admin.loginId} ${POST_KINDS[post.kind]} #${rows[0].id} 등록`)
  res.status(201).json(rows[0])
})

adminPostRouter.patch('/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  const { post, errors } = readPost(req.body)
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  const { rows } = await pool.query(
    `UPDATE posts SET kind = $2, title = $3, body = $4, link_url = $5, image_url = $6, pinned = $7, popup = $8, popup_until = $9, hidden = $10, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, post.kind, post.title, post.body, post.link_url, post.image_url, post.pinned, post.popup, post.popup_until, post.hidden],
  )
  if (!rows.length) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  afterChange()
  console.log(`[posts] ${req.admin.loginId} 글 #${rows[0].id} 수정`)
  res.json(rows[0])
})

adminPostRouter.delete('/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  const { rowCount } = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id])
  if (!rowCount) return res.status(404).json({ error: '글을 찾지 못했어요.' })
  afterChange()
  console.log(`[posts] ${req.admin.loginId} 글 #${req.params.id} 삭제`)
  res.status(204).end()
})
