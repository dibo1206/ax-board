// 블록형 상세페이지 (2026-11-14): 상품 설명 아래에 글 블록과 사진 블록을 원하는 순서로 쌓는다
//  - 글 블록  { type: 'text', title, body }   제목은 선택, 본문은 필수
//  - 사진 블록 { type: 'image', url, alt, caption } url 은 이 상품에 올린 사진 파일만 (다른 상품·바깥 주소 금지)
// 글은 글자로 저장한다 (사진 속 글자는 금지어 검사·상담 챗봇·검색엔진·화면 낭독기가 못 읽어서)
// DB 를 쓰지 않는 순수 함수만 둔다 → 데이터 불러오기 스크립트·시험에서도 같은 규칙
import { createHash } from 'node:crypto'

export const MAX_BLOCKS = 20 // 상품 하나의 블록 수
export const MAX_BLOCK_IMAGES = 12 // 그중 사진 블록 수
export const LIMITS = { title: 40, body: 1000, alt: 100, caption: 100 }

// 눈에 안 보이는 제어 문자는 빼고 줄바꿈·탭만 남긴다
const clean = (v) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, (c) => ('\n\r\t'.includes(c) ? c : '')).replace(/\r\n?/g, '\n').trim() : '')

// 이 상품에 올린 사진 파일 주소 (server/admin.js 의 saveOptimized 가 만드는 이름과 같은 모양)
export const blockImagePattern = (code) => new RegExp(`^/uploads/${code}-[0-9a-f]{12}\\.webp$`)

// 저장된 값·화면에서 온 값을 같은 모양으로 맞춘다 (키 순서까지 같게 → 바뀌었는지 비교할 때 쓴다)
export function normalizeBlocks(list) {
  return (Array.isArray(list) ? list : []).map((b) => (b?.type === 'image'
    ? { type: 'image', url: clean(b.url), alt: clean(b.alt), caption: clean(b.caption) }
    : { type: 'text', title: clean(b?.title), body: clean(b?.body) }))
}

// 검사: 통과하면 { blocks }, 아니면 { errors }. 보내지 않았으면(undefined) 빈 목록
export function readBlocks(input, productCode) {
  if (input == null) return { blocks: [] }
  if (!Array.isArray(input)) return { errors: ['상세 블록 형식이 맞지 않아요. 화면을 새로 고친 뒤 다시 저장해 주세요.'] }
  const errors = []
  const blocks = normalizeBlocks(input.slice(0, MAX_BLOCKS + 1))
  if (blocks.length > MAX_BLOCKS) errors.push(`상세 블록은 ${MAX_BLOCKS}개까지 만들 수 있어요.`)
  const images = blocks.filter((b) => b.type === 'image')
  if (images.length > MAX_BLOCK_IMAGES) errors.push(`상세 블록 사진은 ${MAX_BLOCK_IMAGES}장까지 넣을 수 있어요.`)
  const ours = blockImagePattern(productCode)
  if (images.some((b) => !ours.test(b.url))) errors.push('상세 블록 사진은 이 상품 화면에서 올린 사진만 넣을 수 있어요.')
  if (new Set(images.map((b) => b.url)).size !== images.length) errors.push('같은 사진을 두 번 넣었어요.')
  if (blocks.some((b) => b.type === 'text' && !b.body)) errors.push('글 블록의 본문을 적어 주세요. (필요 없으면 블록을 빼 주세요)')
  for (const [key, label] of [['title', '글 블록 제목'], ['body', '글 블록 본문'], ['alt', '사진 설명'], ['caption', '사진 아래 글']]) {
    if (blocks.some((b) => (b[key] ?? '').length > LIMITS[key])) errors.push(`${label}은(는) ${LIMITS[key]}자 안으로 적어 주세요.`)
  }
  return errors.length ? { errors } : { blocks }
}

// 금지어 검사·상담 자료에 넣을 글 (사진은 설명·아래 글만)
export function blocksText(list) {
  return normalizeBlocks(list).map((b) => (b.type === 'image' ? [b.alt, b.caption] : [b.title, b.body]).filter(Boolean).join(' ')).filter(Boolean).join('\n')
}

export const sameBlocks = (a, b) => JSON.stringify(normalizeBlocks(a)) === JSON.stringify(normalizeBlocks(b))

// 수정 이력에 남길 짧은 요약 (글·사진 수 + 내용 지문: 글자만 바꿔도 다르게 나온다)
export function blocksSummary(list) {
  const blocks = normalizeBlocks(list)
  if (!blocks.length) return null
  const texts = blocks.filter((b) => b.type === 'text').length
  const mark = createHash('sha256').update(JSON.stringify(blocks)).digest('hex').slice(0, 6)
  return `글 ${texts} · 사진 ${blocks.length - texts} (#${mark})`
}

// 저장하면서 빠진 사진 주소 (파일을 지울 때 쓴다)
export function removedBlockImages(before, after) {
  const kept = new Set(normalizeBlocks(after).filter((b) => b.type === 'image').map((b) => b.url))
  return normalizeBlocks(before).filter((b) => b.type === 'image' && !kept.has(b.url)).map((b) => b.url)
}
