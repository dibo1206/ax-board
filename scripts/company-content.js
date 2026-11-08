// 회사 홈페이지(yunjufarm.co.kr)의 실제 제품·공지·언론보도를 DB에 넣는다: npm run company-content
// 데이터: data/company_content.json (사진은 public/product-photos/yj_*, public/posts/*). 여러 번 해도 같다
// - 회사 판매자(company) 이름·소개를 회사 홈페이지 글로
// - 품목 '과일 농축액 베이스'는 처음 넣을 때만 검수 전(pending)으로. 이미 있으면 상태는 그대로 (관리자가 검수한 것을 되돌리지 않게)
// - 상품은 처음에만 가격·재고·옵션을 넣고, 다시 할 때는 글·사진·고시만 바꾼다 (관리자가 고친 가격·재고를 덮지 않게)
// - 공지·언론보도는 seed_key 로 한 번만 넣는다
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { pool } from '../server/db.js'

const data = JSON.parse(readFileSync(new URL('../data/company_content.json', import.meta.url), 'utf8'))
const client = await pool.connect()
const done = { products: 0, newProducts: 0, options: 0, posts: 0 }
try {
  await client.query('BEGIN')
  const s = data.seller
  await client.query('UPDATE sellers SET name = $2, region = $3, intro = $4, story = $5 WHERE seller_code = $1 AND is_company', [s.seller_code, s.name, s.region, s.intro, s.story])

  const it = data.item
  await client.query(
    `INSERT INTO items (item_code, name, category, show_brix, storage_method, stage1_uses, stage2_uses, stage3_uses, opened_note,
       allergens, danger_signs, recipes, source, allergen_note, cafe_note, status, requested_by)
     VALUES ($1, $2, $3, false, $4, '{}', '{}', '{}', $5, '{}', $6, $7, $8, $9, $10, 'pending', 'admin:company-content')
     ON CONFLICT (item_code) DO UPDATE SET name = $2, category = $3, storage_method = $4, opened_note = $5, danger_signs = $6,
       recipes = $7, source = $8, allergen_note = $9, cafe_note = $10`,
    [it.item_code, it.name, it.category, it.storage_method, it.opened_note, it.danger_signs, JSON.stringify(it.recipes), it.source, it.allergen_note, it.cafe_note],
  )

  for (const p of data.products) {
    const { rows } = await client.query(
      `INSERT INTO products (product_code, seller_code, item_code, name, price, unit, stock, summary, description, b2b_available, tags, source,
         image_url, images, detail_images, notice, status, admin_approved_at, updated_at)
       VALUES ($1, 'company', $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, 'active', now(), now())
       ON CONFLICT (product_code) DO UPDATE SET item_code = $2, name = $3, summary = $7, description = $8, tags = $9, source = $10,
         image_url = $11, images = $12, detail_images = $13, notice = $14, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [p.product_code, p.item_code, p.name, p.price, p.unit, p.stock, p.summary, p.description, p.tags, data.note, p.image_url, p.images, p.detail_images, JSON.stringify(p.notice)],
    )
    done.products += 1
    if (!rows[0].inserted) continue
    done.newProducts += 1
    for (const [i, o] of p.options.entries()) {
      await client.query(
        `INSERT INTO product_options (product_code, name, price, stock, sort_order) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_code, name) DO NOTHING`,
        [p.product_code, o.name, o.price, o.stock, i],
      )
      done.options += 1
    }
    // 옵션 상품의 가격·재고는 판매 중 옵션의 최저가·재고 합 (server/options.js 와 같은 규칙)
    if (p.options.length) {
      await client.query(
        `UPDATE products SET price = o.min_price, stock = o.total FROM
           (SELECT min(price) AS min_price, sum(stock)::int AS total
            FROM product_options WHERE product_code = $1 AND status = 'active') o
         WHERE product_code = $1`,
        [p.product_code],
      )
    }
  }

  for (const post of data.posts) {
    const { rowCount } = await client.query(
      `INSERT INTO posts (seed_key, kind, title, body, link_url, image_url, pinned, created_at, author)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'company-content') ON CONFLICT (seed_key) DO NOTHING`,
      [post.seed_key, post.kind, post.title, post.body, post.link_url ?? null, post.image_url ?? null, post.pinned === true, post.created_at],
    )
    done.posts += rowCount
  }
  await client.query('COMMIT')
  console.log(`회사 상품 ${done.products}개 (새로 ${done.newProducts}개, 옵션 ${done.options}개), 공지·언론보도 새로 ${done.posts}개`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
