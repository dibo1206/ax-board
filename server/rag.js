// 벡터 검색(RAG): 규칙이 못 잡은 질문의 근거를 찾는다
//  - 품목·상품·Q&A·농가·정책 글을 조각으로 나눠 벡터로 바꿔 rag_chunks 에 둔다
//  - 벡터 계산은 OpenRouter로 보낸다. 서버에 모델을 올리면 메모리를 1.2GB 넘게 써서 실습 계정 한도(5GB)에 걸렸다
//  - 가격·재고는 조각에 넣지 않는다. 바뀌는 값은 답할 때마다 DB에서 읽는다
//  - 호출이 실패하면 빈 결과를 돌려준다. 그러면 챗봇은 벡터 검색 없이 전처럼 답한다
import { createHash } from 'node:crypto'
import { blocksText } from './blocks.js'
import { embed, keyLoaded } from './ai.js'
import { cached, clearCache } from './cache.js'
import { pool } from './db.js'
import { dropSameText } from './similar.js'
import { POLICIES, SHIPPING, SHOP } from './policy.js'

export const RAG_MODEL = process.env.RAG_MODEL || 'baai/bge-m3'
const enabled = () => process.env.RAG_ENABLED !== '0' && keyLoaded()
const MAX_LENGTH = 300 // 조각 하나의 글자 수 (긴 글을 통째로 넣으면 검색이 흐려진다)

// 기준 점수: data/rag_eval.csv 의 tune 질문으로 정한다 (docs/rag_eval.md)
export const RAG_ANSWER_MIN = Number(process.env.RAG_ANSWER_MIN) || 0.6 // 이 위면 찾은 글을 그대로 보여 준다
export const RAG_ANSWER_GAP = Number(process.env.RAG_ANSWER_GAP) || 0.03 // 다른 주제의 자료와 이만큼 벌어져야 답으로 낸다
export const RAG_OVERLAP_MIN = Number(process.env.RAG_OVERLAP_MIN) || 0.15 // 질문의 낱말이 글에 이만큼은 나와야 답으로 낸다
export const RAG_ASK_MIN = Number(process.env.RAG_ASK_MIN) || 0.5 // 품목을 말하지 않은 질문도 이 위면 AI 버튼을 보여 준다
export const RAG_MATERIAL_MIN = Number(process.env.RAG_MATERIAL_MIN) || 0.45 // 이 위면 AI 자료에 넣는다

const clean = (text) => String(text ?? '').replace(/\[예시( 문구[^\]]*)?\]\s*/g, '').replace(/\s+/g, ' ').trim()
const join = (list) => (Array.isArray(list) ? list.filter(Boolean).join(', ') : '')

// 긴 글은 문장 경계에서 나눈다
export function splitText(text, max = MAX_LENGTH) {
  const sentences = clean(text).split(/(?<=[.!?。])\s+|(?<=요\.)\s*/).filter(Boolean)
  const pieces = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > max) {
      pieces.push(current)
      current = ''
    }
    current = current ? `${current} ${sentence}` : sentence
  }
  if (current) pieces.push(current)
  return pieces
}

function itemChunks(item) {
  const base = { item_code: item.item_code, product_code: null, trusted: true }
  const note = item.reviewed_by ? '' : ' (식품팀 검수 전 정보)'
  const make = (part, text) => (text ? [{ ...base, key: `item:${item.item_code}:${part}`, text: `${clean(text)}${note}` }] : [])
  const uses = (state, list) => (state ? `${state}${list?.length ? ` → ${join(list)}` : ''}` : '')
  const danger = [join(item.danger_signs), item.danger_note].filter(Boolean).join(' ')
  const allergy = [join(item.allergens), item.allergen_note].filter(Boolean).join(' ')
  return [
    ...make('storage', item.storage_method && `${item.name} 보관법: ${item.storage_method}.${item.keep_period ? ` 보관 기간 참고: ${item.keep_period}` : ''}`),
    ...make('opened', item.opened_note && `${item.name} 개봉 후 보관: ${item.opened_note}`),
    ...make('state', item.stage1_state && `${item.name} 상태별 활용: 신선한 상태(${uses(item.stage1_state, item.stage1_uses)}), 품질이 떨어진 상태(${uses(item.stage2_state, item.stage2_uses)})`),
    ...make('safety', danger && `${item.name}에서 이런 신호가 보이면 먹지 마세요: ${danger}`),
    ...make('allergy', allergy && `${item.name} 알레르기 표시: ${allergy}`),
    ...make('recipe', item.recipes?.length && `${item.name} 레시피: ${item.recipes.map((r) => `${r.title}(재료 ${r.ingredients}, 방법: ${r.method})`).join(' / ')}`),
    ...make('cafe', item.cafe_note && `${item.name} 카페 메뉴 비율: ${item.cafe_note}`),
  ]
}

function productChunks(p) {
  const base = { item_code: p.item_code, product_code: p.product_code, trusted: false } // 판매자가 쓴 글이라 AI 자료로만 쓴다
  // 상세 블록의 글·사진 설명도 같은 상품 소개로 넣는다 (사진 속 글자는 못 읽으니 화면 글만)
  const about = [clean(p.summary), clean(p.description), clean(blocksText(p.detail_blocks))].filter(Boolean).join(' ')
  return [
    ...splitText(about).map((text, i) => ({ ...base, key: `product:${p.product_code}:about:${i}`, text: `${clean(p.name)}: ${text}` })),
    ...(p.faq ?? []).map((f, i) => ({ ...base, key: `product:${p.product_code}:faq:${i}`, text: `${clean(p.name)} 자주 묻는 질문: ${clean(f.q)} 답: ${clean(f.a)}` })),
  ]
}

// 고정 안내 글. 값은 policy.js 에서 읽어서 정책을 고치면 함께 바뀐다
function policyChunks() {
  const won = (n) => `${n.toLocaleString('ko-KR')}원`
  const base = { item_code: null, product_code: null, trusted: true }
  const notes = [
    ['policy:shipping', `배송비는 주문 한 번에 ${won(SHIPPING.fee)}이고, 상품 합계가 ${won(SHIPPING.freeOver)} 이상이면 무료예요. 여러 농가 상품을 함께 사도 배송비는 한 번만 내요. 택배는 ${SHIPPING.courier}로 보내요. ${SHIPPING.leadTime}.`],
    ['policy:preorder', '예약 상품은 상품 페이지에 적힌 출고 시작일부터 주문 순서대로 보내요. 결제는 주문할 때 하고, 같은 농가의 다른 상품도 그날 함께 보내요. 보내기 전에는 [주문 조회]에서 취소할 수 있어요.'],
    ['policy:order', '상품을 장바구니에 담거나 [바로 구매]를 누르면 주문서로 이어져요. 회원이 아니어도 주문할 수 있고, 주문번호와 휴대폰 번호로 [주문 조회]에서 확인해요.'],
    ['policy:contact', `고객센터 전화는 ${SHOP.phone}이고, 운영 시간은 ${SHOP.hours}이에요. 회사 주소는 ${SHOP.address}예요. 메일은 ${SHOP.email}로 보낼 수 있어요.`],
    ['policy:bulk', '카페·행사용 대량 구매나 납품은 상품 페이지의 [기업 구매 문의]에 회사 이름, 연락처, 희망 수량을 남겨 주세요.'],
  ]
  const refund = POLICIES.refund.sections.map(([title, text], i) => [`policy:refund:${i}`, `교환·환불 정책 중 ${title}: ${text}`])
  return [...notes, ...refund].map(([key, text]) => ({ ...base, key, text: clean(text) }))
}

// 지금 손님에게 보여도 되는 자료만 조각으로 만든다: 판매 중 상품, 검수된 품목, 답이 달리고 숨기지 않은 Q&A,
// 숨기지 않은 자주 묻는 질문 게시판 글 (관리자가 쓴 글이라 그대로 답으로 써도 되는 자료, 2026-11-12)
export async function buildChunks(db = pool) {
  const [items, products, questions, sellers, faqs] = await Promise.all([
    db.query("SELECT * FROM items WHERE status <> 'pending'"),
    db.query("SELECT product_code, item_code, name, summary, description, faq, detail_blocks FROM products WHERE status = 'active'"),
    db.query(`SELECT q.id, q.product_code, q.question, q.answer, p.item_code FROM questions q JOIN products p ON p.product_code = q.product_code
              WHERE q.answer IS NOT NULL AND q.answer <> '' AND NOT q.hidden AND NOT q.is_private AND p.status = 'active'`),
    db.query(`SELECT seller_code, name, region, story FROM sellers WHERE status = 'active'
              AND seller_code IN (SELECT seller_code FROM products WHERE status = 'active')`),
    db.query("SELECT id, title, body FROM posts WHERE kind = 'faq' AND NOT hidden AND body <> ''"),
  ])
  return [
    ...items.rows.flatMap(itemChunks),
    ...products.rows.flatMap(productChunks),
    ...questions.rows.map((q) => ({ key: `qna:${q.id}`, item_code: q.item_code, product_code: q.product_code, trusted: true, text: `질문: ${clean(q.question)} 답: ${clean(q.answer)}` })),
    ...sellers.rows.map((s) => ({ key: `seller:${s.seller_code}`, item_code: null, product_code: null, trusted: false, text: `농가 ${clean(s.name)} (${clean(s.region)}): ${clean(s.story)}` })),
    ...faqs.rows.flatMap((f) => splitText(clean(f.body)).map((text, i) => ({ key: `faq:${f.id}:${i}`, item_code: null, product_code: null, trusted: true, text: `자주 묻는 질문: ${clean(f.title)} 답: ${text}` }))),
    ...policyChunks(),
  ]
}

// ---------- 벡터 ----------
const normalize = (vector) => {
  const size = Math.hypot(...vector) || 1
  return vector.map((v) => v / size)
}

export const dot = (a, b) => {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

const hashOf = (c) => createHash('sha256').update(JSON.stringify([RAG_MODEL, c.text, c.item_code, c.product_code, c.trusted])).digest('hex')

// ---------- 자동 반영: 조각을 다시 만들어 글이 바뀐 것만 다시 계산한다 ----------
let syncing = null
async function runSync() {
  const chunks = await buildChunks()
  const saved = new Map((await pool.query('SELECT key, hash FROM rag_chunks')).rows.map((r) => [r.key, r.hash]))
  const changed = chunks.filter((c) => saved.get(c.key) !== hashOf(c))
  const keep = new Set(chunks.map((c) => c.key))
  const gone = [...saved.keys()].filter((key) => !keep.has(key))
  if (gone.length) await pool.query('DELETE FROM rag_chunks WHERE key = ANY($1)', [gone])
  if (changed.length) {
    for (let i = 0; i < changed.length; i += 32) {
      const batch = changed.slice(i, i + 32)
      const vectors = (await embed(RAG_MODEL, batch.map((c) => c.text))).map(normalize)
      for (const [n, c] of batch.entries()) {
        await pool.query(
          `INSERT INTO rag_chunks (key, hash, model, text, item_code, product_code, trusted, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (key) DO UPDATE SET hash = $2, model = $3, text = $4, item_code = $5, product_code = $6, trusted = $7, embedding = $8, updated_at = now()`,
          [c.key, hashOf(c), RAG_MODEL, c.text, c.item_code, c.product_code, c.trusted, vectors[n]],
        )
      }
    }
  }
  if (changed.length || gone.length) {
    clearCache()
    console.log(`[rag] 자료 반영: 새로 계산 ${changed.length}개, 뺀 것 ${gone.length}개, 전체 ${chunks.length}개`)
  }
  return { total: chunks.length, changed: changed.length, gone: gone.length }
}

// 동시에 하나만 돌리고, 도는 중에 또 바뀌면 끝난 뒤 한 번 더 돈다
export function syncRag() {
  if (!enabled()) return Promise.resolve(null)
  if (syncing) {
    syncing.again = true
    return syncing.done
  }
  const state = { again: false }
  state.done = (async () => {
    try {
      let result = await runSync()
      while (state.again) {
        state.again = false
        result = await runSync()
      }
      return result
    } finally {
      syncing = null
    }
  })()
  syncing = state
  return state.done
}

// 상품 승인·수정, 품목 검수, Q&A 답변 뒤에 부른다. 실패해도 그 요청은 이미 끝났고, 다음 동기화 때 다시 한다
let timer = null
export function scheduleRagSync(delayMs = 3000) {
  if (!enabled() || timer) return
  timer = setTimeout(() => {
    timer = null
    syncRag().catch((error) => console.warn(`[rag] 자료 반영 실패: ${error.message}`))
  }, delayMs)
  timer.unref?.()
}

// 서버를 켤 때 자료를 맞춘다. 스크립트로 DB를 고친 경우를 위해 10분마다 다시 맞춘다
export function startRag() {
  if (!enabled()) return
  scheduleRagSync(0)
  setInterval(() => scheduleRagSync(0), 10 * 60_000).unref()
}

// 평가 스크립트용: 자료가 맞춰질 때까지 기다린다
export async function prepareRag() {
  if (!enabled()) return false
  await syncRag()
  return true
}

// ---------- 검색 ----------
function loadIndex() {
  return cached('rag:index', 60_000, async () => {
    const { rows } = await pool.query('SELECT key, text, item_code, product_code, trusted, embedding FROM rag_chunks WHERE model = $1', [RAG_MODEL])
    return rows
  })
}

// 호출이 느리거나 오류가 나면 빈 결과. 손님을 4초 넘게 기다리게 하지 않는다. 같은 질문은 1시간 기억한다
export async function searchChunks(query, { allow = () => true, limit = 5 } = {}) {
  if (!enabled()) return []
  try {
    const index = await loadIndex()
    if (!index.length) return []
    const vector = await cached(`rag:query:${query}`, 3_600_000, async () => normalize((await embed(RAG_MODEL, [query], 4000))[0]))
    // 같은 글이 두 번 들어 있으면(자주 묻는 질문 + 담당자 Q&A 등) 하나만 남긴다
    //  → 같은 글끼리 1·2등을 다퉈 답을 못 내거나, AI 자료에 같은 글이 두 번 들어가 토큰을 낭비하지 않게
    const ranked = index.filter(allow)
      .map((c) => ({ key: c.key, text: c.text, item_code: c.item_code, product_code: c.product_code, trusted: c.trusted, score: dot(vector, c.embedding) }))
      .sort((a, b) => b.score - a.score || Number(b.trusted) - Number(a.trusted))
    return dropSameText(ranked, limit)
  } catch (error) {
    console.warn(`[rag] 검색 실패: ${error.message}`)
    return []
  }
}
