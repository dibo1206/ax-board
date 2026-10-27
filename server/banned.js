// 금지어 사전: 관리자 화면 [금지어]에서 고친다. 식품 표시·광고법이 바뀌면 여기만 고치면 된다
//  - 효능: 건강 효과 표현 (상품 글·AI 글·답변·후기에 쓰면 안 됨)
//  - 욕설·광고: 손님 글(후기·상품 문의)에서 거른다
// 요청마다 DB를 읽지 않게 메모리에 두고, 관리자가 고치면 바로 다시 읽는다 (AI를 부르지 않는 검사라 비용 0)
import express from 'express'
import { requireAdmin } from './auth.js'
import { clearCache } from './cache.js'
import { pool } from './db.js'
import { FORBIDDEN } from './validate.js'

export const KINDS = ['효능', '욕설', '광고', '기타']
let words = FORBIDDEN.map((word) => ({ word, kind: '효능' })) // DB를 읽기 전 기본값

export async function loadBanned() {
  const { rows } = await pool.query('SELECT word, kind FROM banned_words ORDER BY word')
  words = rows
}

// 띄어쓰기를 지우고 찾는다 ("면 역 력"처럼 띄워 써서 빠져나가지 못하게). kinds 를 주면 그 종류만
const squash = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, '')
export function findBanned(text, kinds = null) {
  const target = squash(text)
  return words.filter((w) => (!kinds || kinds.includes(w.kind)) && target.includes(squash(w.word))).map((w) => w.word)
}

// 걸린 단어를 종류별 안내 문장으로
export function bannedMessage(found) {
  if (!found.length) return null
  const effect = found.filter((w) => words.some((x) => x.word === w && x.kind === '효능'))
  const other = found.filter((w) => !effect.includes(w))
  return [
    effect.length ? `효능 표현은 쓰지 않아요: ${effect.join(', ')}` : '',
    other.length ? `쓸 수 없는 표현이 있어요: ${other.join(', ')}` : '',
  ].filter(Boolean).join(' ')
}

export const bannedRouter = express.Router()
bannedRouter.use(requireAdmin)

bannedRouter.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT word, kind, note, created_at FROM banned_words ORDER BY kind, word')
  res.json({ kinds: KINDS, words: rows })
})

bannedRouter.post('/', async (req, res) => {
  const word = typeof req.body.word === 'string' ? req.body.word.trim() : ''
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : null
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 100) : ''
  if (word.length < 2 || word.length > 30) return res.status(400).json({ error: '금지어는 2~30자로 적어 주세요.' })
  if (!kind) return res.status(400).json({ error: '종류를 골라 주세요.' })
  const { rowCount } = await pool.query(
    'INSERT INTO banned_words (word, kind, note) VALUES ($1, $2, $3) ON CONFLICT (word) DO NOTHING',
    [word, kind, note || null],
  )
  if (!rowCount) return res.status(409).json({ error: '이미 있는 금지어예요.' })
  await loadBanned()
  clearCache()
  console.log(`[banned] ${req.admin.loginId} 추가: ${word} (${kind})`)
  res.status(201).json({ word, kind, note: note || null })
})

bannedRouter.delete('/:word', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM banned_words WHERE word = $1', [req.params.word])
  if (!rowCount) return res.status(404).json({ error: '없는 금지어예요.' })
  await loadBanned()
  clearCache()
  console.log(`[banned] ${req.admin.loginId} 삭제: ${req.params.word}`)
  res.status(204).end()
})
