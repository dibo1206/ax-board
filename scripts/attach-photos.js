// 예시 상품에 사진 붙이기: data/product_photos.csv 의 상품 코드 → public/product-photos/사진이름.webp
//   npm run attach-photos              사진이 없는 상품에만 붙인다 (관리자·농가가 올린 사진은 그대로)
//   npm run attach-photos -- --force   표에 있는 상품은 모두 표의 사진으로 바꾼다
// 사진은 AI로 만든 시연용 이미지다 (Figma AI, 2026-11-07). 상품이 [예시] 데이터인 동안에만 쓰고, 실제 판매 전에 농가 실물 사진으로 바꾼다.
// 같은 종류 상품(예: 설향 딸기 1kg·2kg)은 사진 1장을 함께 쓴다. 농가 가입 시뮬레이션(npm run onboard-farms)을 다시 돌리면 이것도 다시 돌린다
import 'dotenv/config'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pool } from '../server/db.js'
import { parseCsv } from './csv.js'

const force = process.argv.includes('--force')
const [header, ...body] = parseCsv(await readFile(new URL('../data/product_photos.csv', import.meta.url), 'utf8'))
const rows = body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]))).filter((r) => r.product_code && r.photo)
const photoFile = (name, suffix = '') => new URL(`../public/product-photos/${name}${suffix}.webp`, import.meta.url)

const missingFiles = [...new Set(rows.map((r) => r.photo))].filter((name) => !existsSync(photoFile(name)) || !existsSync(photoFile(name, '-thumb')))
if (missingFiles.length) {
  console.error(`사진 파일이 없어요 (큰 사진과 -thumb 둘 다 필요): ${missingFiles.join(', ')}`)
  process.exit(1)
}

const result = { attached: [], kept: [], unknown: [] }
for (const r of rows) {
  const url = `/product-photos/${r.photo}.webp`
  const { rows: found } = await pool.query('SELECT image_url FROM products WHERE product_code = $1', [r.product_code])
  if (!found.length) {
    result.unknown.push(r.product_code)
    continue
  }
  if (found[0].image_url && !force) {
    result.kept.push(r.product_code)
    continue
  }
  await pool.query('UPDATE products SET image_url = $2, updated_at = now() WHERE product_code = $1', [r.product_code, url])
  result.attached.push(r.product_code)
}
await pool.end()

console.log(`사진 붙임 ${result.attached.length}개 · 이미 사진 있어 그대로 ${result.kept.length}개 · DB에 없는 상품 ${result.unknown.length}개${force ? ' (--force)' : ''}`)
if (result.unknown.length) console.log(`  DB에 없는 상품: ${result.unknown.join(', ')} (아직 가입·등록 전이면 npm run onboard-farms 뒤에 다시)`)
