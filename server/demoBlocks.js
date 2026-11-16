// [예시] 상품의 상세 블록 채우기 (2026-11-16): 쿠팡식 상세페이지(사진 | 글 지그재그)를 데모에서 보여 주려고
//  - 대상: 이름이 [예시] 로 시작하고 상세 블록이 비어 있는 상품만 (농가·관리자가 채운 블록은 절대 덮어쓰지 않음)
//  - 글: DB 에 이미 있는 값만 쓴다 (한 줄 소개·품종·당도·수확일·산지·레시피). 농가 이야기·보관법은 아래 칸에 이미 있어 쓰지 않는다. 지어내지 않고, 가격은 쓰지 않는다 (server/content.js 와 같은 규칙)
//  - 사진: 상품 대표 사진과 품목 레시피 사진(둘 다 시연용 AI 이미지)을 그 상품의 블록 사진으로 복사한다
//    → "블록 사진은 그 상품에 올린 파일만" 규칙(server/blocks.js)을 그대로 지킨다. 사진 아래에 [예시] 참고 사진이라고 적는다
//  - 관리자 화면 [상품 관리 > ⋯ > 예시 상품 상세 블록 채우기] 와 npm run demo-blocks 가 같은 함수를 쓴다
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { deleteBlockImages, saveOptimized } from './admin.js'
import { findBanned } from './banned.js'
import { clearCache } from './cache.js'
import { readBlocks } from './blocks.js'
import { pool } from './db.js'
import { scheduleRagSync } from './rag.js'
import { UPLOAD_DIR } from './uploads.js'
import { DEMO_CAPTION, planDemoBlocks } from './demoPlan.js'

// 원본 사진 파일 찾기: 화면 정적 파일(public, 배포 빌드는 dist)과 올린 사진 폴더
async function readSource(url) {
  if (typeof url !== 'string' || !/^\/[\w./-]+\.(webp|jpe?g|png)$/i.test(url) || url.includes('..')) return null
  const candidates = url.startsWith('/uploads/')
    ? [new URL(url.slice('/uploads/'.length), UPLOAD_DIR)]
    : [new URL(`../public${url}`, import.meta.url), new URL(`../dist${url}`, import.meta.url)]
  for (const file of candidates) if (existsSync(file)) return readFile(file)
  return null
}

let running = false

// 채우기. force: [예시] 상품의 기존 블록도 새로 만든다 (관리자 화면에서는 쓰지 않음, 스크립트 --force 만)
export async function fillDemoBlocks({ force = false, log = () => {} } = {}) {
  if (running) return { busy: true }
  running = true
  const result = { filled: 0, skipped: 0, photos: 0, failed: [] }
  try {
    const { rows } = await pool.query(
      `SELECT p.*, s.name AS seller_name, s.region AS seller_region
         FROM products p LEFT JOIN sellers s ON s.seller_code = p.seller_code
        WHERE p.name LIKE '[예시]%' ${force ? '' : "AND p.detail_blocks = '[]'::jsonb"}
        ORDER BY p.product_code`,
    )
    const items = new Map((await pool.query('SELECT item_code, status, category, recipes FROM items')).rows.map((r) => [r.item_code, r]))
    for (const p of rows) {
      try {
        const seller = p.seller_name ? { name: p.seller_name, region: p.seller_region } : null
        const plan = planDemoBlocks(p, items.get(p.item_code), seller)
        const blocks = []
        for (const pair of plan.pairs) {
          const buffer = await readSource(pair.photo)
          if (!buffer) continue // 사진이 없으면 그 칸은 빼고 다음으로
          const url = await saveOptimized(p.product_code, buffer, { wide: true })
          result.photos += 1
          // 사진 → 글 순서로 넣으면 화면이 둘을 한 줄로 묶어 지그재그로 보여 준다 (src/App.jsx DetailBlocks)
          blocks.push({ type: 'image', url, alt: pair.alt, caption: DEMO_CAPTION }, { type: 'text', title: pair.title, body: pair.body })
        }
        const checked = readBlocks(blocks, p.product_code)
        const banned = findBanned(blocks.map((b) => `${b.title ?? ''} ${b.body ?? ''}`).join(' '))
        if (!blocks.length || checked.errors || banned.length) {
          result.skipped += 1
          if (checked.errors || banned.length) result.failed.push(`${p.product_code}: ${(checked.errors ?? [`금지어 ${banned.join(', ')}`]).join(' ')}`)
          continue
        }
        // 그 사이 누가 블록을 채웠으면 덮어쓰지 않는다 (force 가 아니면 빈 상품만)
        const updated = await pool.query(
          `UPDATE products SET detail_blocks = $2::jsonb WHERE product_code = $1 ${force ? '' : "AND detail_blocks = '[]'::jsonb"}`,
          [p.product_code, JSON.stringify(checked.blocks)],
        )
        if (updated.rowCount) {
          await deleteBlockImages(p, checked.blocks) // --force 로 다시 만들 때 옛 블록 사진 파일 정리 (대표 사진 등은 남김)
          result.filled += 1
          log(`${p.product_code} 블록 ${checked.blocks.length}개`)
        } else result.skipped += 1
      } catch (error) {
        result.failed.push(`${p.product_code}: ${error.message}`)
      }
    }
    if (result.filled) {
      clearCache()
      scheduleRagSync() // 블록 글도 상담 자료에 들어간다 (server/rag.js)
    }
    return result
  } finally {
    running = false
  }
}
