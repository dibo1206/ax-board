// 상세 블록 편집 화면에서 쓰는 값·변환 함수 (src/admin/DetailBlocks.jsx). 서버 규칙(server/blocks.js)과 같은 숫자를 쓴다
export const MAX_BLOCKS = 20
export const MAX_BLOCK_IMAGES = 12
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

let seq = 0
export const key = () => `b${(seq += 1)}`

// 서버에서 받은 블록 → 화면용 (key 는 순서를 바꿔도 칸이 섞이지 않게)
export function toEditorBlocks(list) {
  return (Array.isArray(list) ? list : []).map((b) => (b.type === 'image'
    ? { key: key(), type: 'image', url: b.url, alt: b.alt ?? '', caption: b.caption ?? '', file: null, preview: null, hint: '' }
    : { key: key(), type: 'text', title: b.title ?? '', body: b.body ?? '' }))
}

// AI 초안 블록 → 화면용. 사진 자리는 "이런 사진을 넣어 주세요" 안내만 있고 사진은 판매자가 고른다
export function fromDraftBlocks(list) {
  return (Array.isArray(list) ? list : []).map((b) => (b.type === 'photo'
    ? { key: key(), type: 'image', url: null, alt: b.hint ?? '', caption: '', file: null, preview: null, hint: b.hint ?? '' }
    : { key: key(), type: 'text', title: b.title ?? '', body: b.body ?? '' }))
}

// 서버에 보낼 블록: 올린 사진(주소 있음)과 글만. 아직 안 올린 사진·고르지 않은 사진 자리는 빠진다
export function storedBlocks(blocks) {
  return blocks
    .filter((b) => b.type === 'text' || b.url)
    .map((b) => (b.type === 'image' ? { type: 'image', url: b.url, alt: b.alt.trim(), caption: b.caption.trim() } : { type: 'text', title: b.title.trim(), body: b.body.trim() }))
}

export const hasPendingPhotos = (blocks) => blocks.some((b) => b.type === 'image' && b.file && !b.url)
export const emptySlots = (blocks) => blocks.filter((b) => b.type === 'image' && !b.file && !b.url).length

export function photoProblem(file) {
  if (!PHOTO_TYPES.includes(file.type)) return '사진은 jpg, png, webp 파일만 올릴 수 있어요.'
  if (file.size > MAX_PHOTO_BYTES) return '사진 한 장은 2MB 이하로 올려 주세요. 세로로 아주 긴 사진은 몇 장으로 나눠 주세요.'
  return ''
}
