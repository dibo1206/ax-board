// 카카오·네이버 간편 로그인 (2026-11-07, OAuth 2.0 인가 코드 방식). 손님 회원만 (판매자·관리자는 아이디·비밀번호 + 2단계 인증)
//  1) GET  /api/account/oauth/:provider/start?next=/경로[&mode=link] → 위조 방지 값(state)을 서명 쿠키에 담고 카카오·네이버 로그인 창으로
//  2) GET  /api/account/oauth/:provider/callback → state 확인 → 서버가 비밀키로 토큰을 받아 회원 번호·이메일·이름을 읽는다
//     - 연결된 계정이 있으면 로그인 · 마이페이지에서 [연결]을 눌렀으면(mode=link) 지금 계정에 연결
//     - 처음이면 /account/social 에서 약관 동의와 연락처를 받은 뒤 가입 (POST /api/account/oauth/complete)
//  같은 이메일로 이미 가입한 계정이 있어도 자동으로 합치지 않는다 (남의 이메일로 만든 간편 계정이 기존 계정을 가로채지 못하게)
//  → 이메일로 로그인한 뒤 마이페이지에서 직접 연결한다
// 키: .env 의 KAKAO_CLIENT_ID(+ 선택 KAKAO_CLIENT_SECRET), NAVER_CLIENT_ID + NAVER_CLIENT_SECRET.
//   돌아올 주소(Redirect URI)는 개발자 센터에 `${PUBLIC_URL}/api/account/oauth/<kakao|naver>/callback` 로 등록한다.
// 키가 없으면: 개발(NODE_ENV≠production)에서는 '시험 로그인'(가짜 회원, 실제 카카오·네이버에 가지 않음), 운영에서는 버튼을 숨긴다
// [가설] 실제 카카오·네이버 키로는 아직 확인하지 않았다. 공식 문서의 주소·칸 이름대로 만들었다
import { randomBytes, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { currentCustomer, startSession } from './account.js'
import { readCookie, setCookie, signToken, verifyToken } from './auth.js'
import { lookupHash, sealText } from './crypto.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { publicUrl, queueMail } from './mailer.js'
import { openCustomer } from './pii.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const PROVIDERS = {
  kakao: {
    name: '카카오',
    id: () => process.env.KAKAO_CLIENT_ID,
    secret: () => process.env.KAKAO_CLIENT_SECRET, // 카카오는 선택 (켜 두었으면 꼭 보낸다)
    needsSecret: false,
    authorize: 'https://kauth.kakao.com/oauth/authorize',
    token: 'https://kauth.kakao.com/oauth/token',
    profile: 'https://kapi.kakao.com/v2/user/me',
    read: (d) => ({ id: d.id, email: d.kakao_account?.email ?? '', emailVerified: d.kakao_account?.is_email_verified === true, name: d.kakao_account?.profile?.nickname ?? d.properties?.nickname ?? '' }),
  },
  naver: {
    name: '네이버',
    id: () => process.env.NAVER_CLIENT_ID,
    secret: () => process.env.NAVER_CLIENT_SECRET,
    needsSecret: true,
    authorize: 'https://nid.naver.com/oauth2.0/authorize',
    token: 'https://nid.naver.com/oauth2.0/token',
    profile: 'https://openapi.naver.com/v1/nid/me',
    read: (d) => ({ id: d.response?.id, email: d.response?.email ?? '', emailVerified: Boolean(d.response?.email), name: d.response?.name ?? d.response?.nickname ?? '' }),
  },
}

// 'live' 실제 연결 · 'mock' 개발용 시험 로그인 · null 쓰지 않음
// 시험 로그인은 .env 에 OAUTH_MOCK=1 을 직접 적었을 때만 (운영이 아니어도 기본은 꺼짐).
// 모든 사람이 같은 가짜 회원이 되므로, NODE_ENV 를 빠뜨린 공개 서버에서 켜지면 남의 계정에 들어가거나 연결할 수 있어서 (2026-11-07 보안 점검)
export function oauthMode(provider) {
  const p = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null
  if (!p) return null
  if (p.id() && (!p.needsSecret || p.secret())) return 'live'
  return process.env.NODE_ENV !== 'production' && process.env.OAUTH_MOCK === '1' ? 'mock' : null
}

const STATE_COOKIE = 'oauth_state'
const PENDING_COOKIE = 'oauth_pending'
const redirectUri = (provider) => `${publicUrl()}/api/account/oauth/${provider}/callback`
// 돌아갈 곳: 우리 사이트 안의 경로만 (다른 사이트로 보내는 데 쓰이지 않게)
const safeNext = (v) => (typeof v === 'string' && /^\/(?![/\\])[\w\-/?=&.%]*$/.test(v) && v.length <= 200 ? v : '/account')
const back = (res, reason) => res.redirect(302, `/account/login?error=${encodeURIComponent(reason)}`)
const identityKey = (provider, id) => lookupHash(`oauth:${provider}:${id}`)

export const oauthRouter = express.Router()
const tooMany = createLimiter({ limit: 30, windowMs: 10 * 60_000 })

oauthRouter.get('/providers', (req, res) => {
  res.json(Object.keys(PROVIDERS).map((key) => ({ provider: key, name: PROVIDERS[key].name, mode: oauthMode(key) })).filter((p) => p.mode))
})

oauthRouter.get('/:provider/start', async (req, res) => {
  const { provider } = req.params
  const mode = oauthMode(provider)
  if (!mode) return back(res, '지금은 이 간편 로그인을 쓸 수 없어요.')
  if (tooMany(req)) return back(res, '시도가 너무 많아요. 잠시 후 다시 해 주세요.')
  const link = req.query.mode === 'link'
  if (link && !(await currentCustomer(req))) return back(res, '연결하려면 먼저 로그인해 주세요.')
  const state = randomBytes(24).toString('base64url')
  setCookie(res, STATE_COOKIE, signToken({ kind: 'oauth_state', provider, state, link, next: safeNext(req.query.next), exp: Date.now() + 10 * 60_000 }), 600)
  if (mode === 'mock') {
    // 시험 로그인: 카카오·네이버에 가지 않고 우리 돌아오는 주소로 바로 (가짜 회원 번호)
    return res.redirect(302, `/api/account/oauth/${provider}/callback?code=mock&state=${state}`)
  }
  const p = PROVIDERS[provider]
  const url = new URL(p.authorize)
  url.search = new URLSearchParams({ response_type: 'code', client_id: p.id(), redirect_uri: redirectUri(provider), state }).toString()
  res.redirect(302, url.href)
})

async function fetchProfile(provider, code, state) {
  if (oauthMode(provider) === 'mock') {
    return { id: `mock-${provider}-1`, email: `${provider}-test@example.com`, emailVerified: true, name: `[시험] ${PROVIDERS[provider].name} 손님` }
  }
  const p = PROVIDERS[provider]
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: p.id(), redirect_uri: redirectUri(provider), code, state })
  if (p.secret()) form.set('client_secret', p.secret())
  const tokenRes = await fetch(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form, signal: AbortSignal.timeout(10_000) })
  const token = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !token.access_token) throw new Error(`토큰 받기 실패 (${tokenRes.status})`)
  const meRes = await fetch(p.profile, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) })
  const me = await meRes.json().catch(() => ({}))
  const profile = p.read(me)
  if (!meRes.ok || !profile.id) throw new Error(`회원 정보 읽기 실패 (${meRes.status})`)
  return { ...profile, id: String(profile.id) }
}

oauthRouter.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params
  if (!oauthMode(provider)) return back(res, '지금은 이 간편 로그인을 쓸 수 없어요.')
  let saved = null
  try {
    saved = verifyToken(readCookie(req, STATE_COOKIE))
  } catch {
    saved = null
  }
  setCookie(res, STATE_COOKIE, '', 0) // 한 번만 쓴다
  const got = Buffer.from(String(req.query.state ?? ''))
  const want = Buffer.from(saved?.state ?? '')
  // 위조 방지: 우리가 보낸 state 와 같아야 한다 (다른 사람의 로그인 결과를 내 브라우저에 끼워 넣는 공격 막기)
  if (saved?.kind !== 'oauth_state' || saved.provider !== provider || !want.length || got.length !== want.length || !timingSafeEqual(got, want)) {
    return back(res, '로그인 시간이 지났거나 올바르지 않은 요청이에요. 다시 시도해 주세요.')
  }
  if (req.query.error || typeof req.query.code !== 'string') return back(res, `${PROVIDERS[provider].name} 로그인을 취소했어요.`)

  let profile
  try {
    profile = await fetchProfile(provider, req.query.code, String(req.query.state))
  } catch (error) {
    console.warn(`[oauth] ${provider} ${error.message}`)
    return back(res, `${PROVIDERS[provider].name}에서 정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.`)
  }
  const key = identityKey(provider, profile.id)
  const { rows: found } = await pool.query(
    `SELECT c.* FROM customer_identities i JOIN customers c ON c.id = i.customer_id
     WHERE i.provider = $1 AND i.provider_user_hash = $2 AND c.deleted_at IS NULL`,
    [provider, key],
  )

  if (saved.link) {
    const me = await currentCustomer(req)
    if (!me) return back(res, '연결하려면 먼저 로그인해 주세요.')
    if (found.length && found[0].id !== me.id) return res.redirect(302, `/account?social=${encodeURIComponent('이미 다른 계정에 연결된 계정이에요.')}`)
    await pool.query(
      `INSERT INTO customer_identities (customer_id, provider, provider_user_hash) VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_user_hash) DO NOTHING`,
      [me.id, provider, key],
    )
    console.log(`[oauth] 회원 #${me.id} ${provider} 연결`)
    return res.redirect(302, `/account?social=${encodeURIComponent(`${PROVIDERS[provider].name} 계정을 연결했어요.`)}`)
  }

  if (found.length) {
    await pool.query('UPDATE customers SET last_login_at = now() WHERE id = $1', [found[0].id])
    startSession(res, found[0])
    return res.redirect(302, saved.next)
  }
  // 처음 온 손님: 약관 동의·연락처를 받는 화면으로 (받은 정보는 15분짜리 서명 쿠키에만)
  // verified: 카카오·네이버가 확인해 준 이메일이면 가입 때 그 이메일만 쓴다 (다른 이메일로 바꿔 남의 계정을 먼저 만들지 못하게)
  setCookie(res, PENDING_COOKIE, signToken({
    kind: 'oauth_pending', provider, key, email: profile.email.slice(0, 254), verified: Boolean(profile.emailVerified && profile.email),
    name: profile.name.slice(0, 20), next: saved.next, exp: Date.now() + 15 * 60_000,
  }), 900)
  res.redirect(302, `/account/social?provider=${provider}`)
})

function readPending(req) {
  try {
    const p = verifyToken(readCookie(req, PENDING_COOKIE))
    return p?.kind === 'oauth_pending' ? p : null
  } catch {
    return null
  }
}

// 가입 화면이 미리 채울 값 (회원 번호는 보내지 않는다)
oauthRouter.get('/pending', (req, res) => {
  const p = readPending(req)
  if (!p) return res.status(404).json({ error: '간편 가입 시간이 지났어요. 다시 시도해 주세요.' })
  res.json({ provider: p.provider, providerName: PROVIDERS[p.provider]?.name, email: p.email, emailLocked: p.verified === true, name: p.name, mock: oauthMode(p.provider) === 'mock' })
})

const isEmail = (v) => v.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
const isMobile = (v) => /^01[016789]\d{7,8}$/.test(v)
const tooManySignups = createLimiter({ limit: 5, windowMs: 60 * 60_000 })

oauthRouter.post('/complete', async (req, res) => {
  const p = readPending(req)
  if (!p) return res.status(400).json({ error: '간편 가입 시간이 지났어요. 다시 시도해 주세요.' })
  // 제공자가 확인한 이메일이 있으면 그것만 (화면에서 바꿔 보내도 무시). 없을 때만 손님이 적은 이메일
  const email = p.verified ? p.email.trim().toLowerCase() : (typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '')
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const phone = (typeof req.body.phone === 'string' ? req.body.phone : '').replace(/[^0-9]/g, '')
  const errors = []
  if (!isEmail(email)) errors.push('이메일을 확인해 주세요.')
  if (!name || name.length > 20) errors.push('이름을 20자 안으로 적어 주세요.')
  if (!isMobile(phone)) errors.push('휴대폰 번호를 확인해 주세요. (주문 조회에 써요)')
  const sensitive = findSensitive(name)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (req.body.agreeTerms !== true || req.body.agreePrivacy !== true) errors.push('이용약관과 개인정보 수집·이용에 동의해 주세요.')
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooManySignups(req)) return res.status(429).json({ error: '가입 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' })

  const client = await pool.connect()
  let customer
  try {
    await client.query('BEGIN')
    const linked = await client.query('SELECT 1 FROM customer_identities WHERE provider = $1 AND provider_user_hash = $2', [p.provider, p.key])
    if (linked.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: '이미 가입한 간편 로그인 계정이에요. 로그인 화면에서 다시 시도해 주세요.' })
    }
    // 비밀번호 없이 쓰는 계정: 비밀번호 칸에는 어떤 비밀번호와도 맞지 않는 값을 넣는다 (비밀번호 찾기로 나중에 정할 수 있다)
    const { rows } = await client.query(
      `INSERT INTO customers (email, email_hash, password_hash, name, phone, agreed_at, last_login_at) VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (email_hash) DO NOTHING RETURNING *`,
      [sealText(email), lookupHash(email), `oauth:${randomBytes(16).toString('hex')}`, sealText(name), sealText(phone)],
    )
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: '이 이메일로 가입한 계정이 이미 있어요. 이메일로 로그인한 뒤 마이페이지 [간편 로그인]에서 연결해 주세요.', existing: true })
    }
    customer = rows[0]
    await client.query('INSERT INTO customer_identities (customer_id, provider, provider_user_hash) VALUES ($1, $2, $3)', [customer.id, p.provider, p.key])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
  setCookie(res, PENDING_COOKIE, '', 0)
  startSession(res, customer)
  console.log(`[oauth] 회원 가입 #${customer.id} (${p.provider})`)
  // 가입 알림: 남이 내 이메일로 간편 가입했다면 주인이 알아챌 수 있게 (일반 가입과 같은 환영 메일 + 안내)
  queueMail({
    kind: 'welcome', to: email, subject: '가입을 환영해요',
    body: `${name}님, ${PROVIDERS[p.provider].name} 간편 로그인으로 가입해 주셔서 고마워요.\n\n마이페이지에서 주문 내역과 배송지를 관리할 수 있어요.\n${publicUrl()}/account\n\n직접 가입하지 않았다면 [비밀번호 찾기]로 비밀번호를 정해 주세요. 그러면 연결된 간편 로그인이 모두 끊겨요.\n`,
  })
  res.status(201).json({ next: p.next, me: { email, name: openCustomer(customer).name } })
})

// 마이페이지: 연결된 간편 로그인 목록과 끊기 (비밀번호가 없는 계정은 마지막 연결을 끊을 수 없다)
oauthRouter.get('/linked', async (req, res) => {
  const me = await currentCustomer(req)
  if (!me) return res.status(401).json({ error: '로그인이 필요해요.' })
  const { rows } = await pool.query('SELECT provider, created_at FROM customer_identities WHERE customer_id = $1 ORDER BY created_at', [me.id])
  res.json({ linked: rows, hasPassword: !String(me.password_hash).startsWith('oauth:') })
})

oauthRouter.delete('/:provider', async (req, res) => {
  const me = await currentCustomer(req)
  if (!me) return res.status(401).json({ error: '로그인이 필요해요.' })
  const { rows } = await pool.query('SELECT provider FROM customer_identities WHERE customer_id = $1', [me.id])
  if (String(me.password_hash).startsWith('oauth:') && rows.length <= 1) {
    return res.status(409).json({ error: '비밀번호가 없는 계정이라 마지막 간편 로그인은 끊을 수 없어요. [비밀번호 찾기]로 비밀번호를 먼저 정해 주세요.' })
  }
  await pool.query('DELETE FROM customer_identities WHERE customer_id = $1 AND provider = $2', [me.id, req.params.provider])
  res.status(204).end()
})

