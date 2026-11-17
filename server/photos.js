// 손님이 올리는 사진 (2026-11-17): 후기 사진(공개)과 반품 사진(비공개)
// - 후기·반품을 먼저 저장하면 서버가 15분짜리 사진 올리기 표(photoToken)를 준다. 화면은 그 표를 X-Upload-Token 머리글에 넣어 사진을 한 장씩 올린다
//   (비회원도 주문번호·휴대폰을 다시 보내지 않고, 그 후기·반품에만 올릴 수 있다)
// - 후기 사진: 손님 화면에 보이니 공개 폴더(uploads/)에 상품 사진과 같은 방식으로 저장 (server/admin.js saveOptimized)
// - 반품 사진: 송장·주소가 찍힐 수 있어 공개 폴더가 아닌 private-photos/ 에 두고, 관리자·그 농가 판매자만 로그인해서 본다
// 어느 쪽이든 받은 사진은 방향을 바로잡고 줄여 WebP로 바꾸며, 촬영 위치(GPS) 같은 사진 속 정보는 지워진다
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { IMAGE_TYPES, looksLike } from './admin.js'
import { signToken, verifyToken } from './auth.js'
import { UPLOAD_DIR } from './uploads.js'

// 배포에서는 볼륨(/data/uploads/)의 옆 폴더 /data/private-photos/, 실습서버·개발은 프로젝트의 private-photos/
export const PRIVATE_DIR = new URL('../private-photos/', UPLOAD_DIR)
const PRIVATE_NAME = /^(return)-\d{1,9}-[0-9a-f]{12}\.webp$/

// 올린 파일이 진짜 jpg·png·webp 인지 (이름표만 믿지 않고 파일 앞부분으로)
export function imageProblem(req) {
  const type = req.headers['content-type']
  if (!IMAGE_TYPES[type] || !Buffer.isBuffer(req.body) || req.body.length === 0 || !looksLike(type, req.body)) {
    return '사진은 jpg, png, webp 파일만 올릴 수 있어요. (2MB 이하)'
  }
  return null
}

const TOKEN_MINUTES = 15
export const photoToken = (kind, id) => signToken({ kind: `${kind}_photo`, id: Number(id), exp: Date.now() + TOKEN_MINUTES * 60_000 })
export function tokenFits(req, kind, id) {
  const t = verifyToken(String(req.headers['x-upload-token'] ?? ''))
  return t?.kind === `${kind}_photo` && t.id === Number(id)
}
export const TOKEN_EXPIRED = `사진을 올릴 수 있는 시간(${TOKEN_MINUTES}분)이 지났어요. 사진은 고객센터로 보내 주세요.`

// 비공개 사진 저장: 긴 변 1600px WebP. 파일 이름만 돌려준다 (주소가 아니라 이름이라 공개 폴더로는 열리지 않는다)
export async function savePrivate(prefix, buffer) {
  const name = `${prefix}-${randomBytes(6).toString('hex')}.webp`
  const image = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  await mkdir(PRIVATE_DIR, { recursive: true })
  await writeFile(new URL(name, PRIVATE_DIR), image)
  return name
}

export async function deletePrivate(name) {
  if (PRIVATE_NAME.test(name ?? '')) await unlink(new URL(name, PRIVATE_DIR)).catch(() => {})
}

// 로그인 확인을 마친 뒤 부른다 (관리자·그 농가 판매자)
export async function sendPrivate(res, name) {
  if (!PRIVATE_NAME.test(name ?? '')) return res.status(404).json({ error: '사진을 찾지 못했어요.' })
  try {
    const file = await readFile(new URL(name, PRIVATE_DIR))
    res.set('Cache-Control', 'private, no-store').type('image/webp').send(file)
  } catch {
    res.status(404).json({ error: '사진을 찾지 못했어요.' })
  }
}
