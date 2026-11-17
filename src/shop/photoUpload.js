import { netFetch } from '../net.js'

// 손님 사진 고르기 (후기·반품, 2026-11-17): 고른 사진을 미리 보여 주고, 올리기 전에 휴대폰 사진(3~10MB)을
// 긴 변 1600px JPEG 로 줄인다 (서버는 2MB 까지 받는다). 실제 올리기는 후기·반품을 저장한 뒤 uploadPhotos 로
const MAX_SIDE = 1600
async function shrink(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file // 줄이지 못하면 원래 파일 (2MB 넘으면 서버가 안내)
  }
}

// 저장한 뒤 받은 표(token)로 한 장씩 올린다. 실패한 장 수를 돌려준다
export async function uploadPhotos(path, files, token) {
  let failed = 0
  for (const file of files) {
    try {
      const body = await shrink(file)
      const response = await netFetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': body.type || 'image/jpeg', 'X-Upload-Token': token }, body }, 45_000)
      if (!response.ok) failed += 1
    } catch {
      failed += 1
    }
  }
  return failed
}
