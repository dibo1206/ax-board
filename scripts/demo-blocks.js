// [예시] 상품에 데모용 상세 블록(사진 | 글 지그재그) 채우기 (2026-11-16, server/demoBlocks.js)
//   npm run demo-blocks              상세 블록이 빈 [예시] 상품만 채운다 (관리자 화면 [상품 관리 > ⋯] 버튼과 같음)
//   npm run demo-blocks -- --force   [예시] 상품의 블록을 모두 새로 만든다 (옛 블록 사진 파일은 지운다)
// 사진은 시연용 AI 이미지(대표 사진·레시피 사진)를 그 상품의 블록 사진으로 복사한다. 실제 판매 전에는 농가 실물 사진으로 바꾼다
import 'dotenv/config'
import { pool } from '../server/db.js'
import { fillDemoBlocks } from '../server/demoBlocks.js'

const force = process.argv.includes('--force')
const result = await fillDemoBlocks({ force, log: (line) => console.log(`  ${line}`) })
console.log(`채움 ${result.filled}개 · 건너뜀 ${result.skipped}개 · 사진 ${result.photos}장 · 실패 ${result.failed.length}개`)
for (const f of result.failed.slice(0, 10)) console.log(`  ✗ ${f}`)
await pool.end()
process.exit(result.failed.length ? 1 : 0)
