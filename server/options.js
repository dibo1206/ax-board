// 판매 옵션 (예: 같은 사과를 5kg·10kg 로). 옵션마다 이름·가격·재고가 따로 있다.
// 옵션이 하나라도 있는 상품은 옵션을 골라야 살 수 있다. 옵션이 없는 상품은 지금처럼 상품 가격·재고로 판다.
// 옵션 상품의 products.price·stock 은 판매 중 옵션의 최저가·재고 합으로 맞춰 둔다
//  → 목록의 "~부터" 가격, 가격순 정렬, 추천 예산, 품절(재고 0) 계산은 상품 칸을 그대로 읽으면 된다
// 잠그는 순서: 상품 줄을 먼저, 옵션은 그다음 (주문·재고 복구·옵션 저장이 모두 같은 순서라 서로 기다리다 멈추지 않는다)
import { pool } from './db.js'

// 손님 화면용: 판매 중 옵션만, 이름·가격·재고만 (판매 중지 옵션·내부 칸은 보내지 않는다)
export const ACTIVE_OPTIONS_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'stock', o.stock) ORDER BY o.sort_order, o.id)
    FROM product_options o WHERE o.product_code = p.product_code AND o.status = 'active'), '[]') AS options,
  EXISTS (SELECT 1 FROM product_options o WHERE o.product_code = p.product_code) AS has_options`

// 관리자·판매자 화면용: 판매 중지 옵션까지, 주문 기록이 있는지(빼면 지우지 않고 판매 중지로 바뀐다) 함께
export const ALL_OPTIONS_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'stock', o.stock, 'status', o.status,
    'ordered', EXISTS (SELECT 1 FROM order_items oi WHERE oi.option_id = o.id)) ORDER BY o.sort_order, o.id)
    FROM product_options o WHERE o.product_code = p.product_code), '[]') AS options`

// 상품 줄을 상품 코드 순서로 잠근다
export async function lockProducts(client, codes) {
  if (!codes.length) return
  await client.query('SELECT 1 FROM products WHERE product_code = ANY($1) ORDER BY product_code FOR UPDATE', [codes])
}

// 옵션이 있는 상품의 가격·재고를 옵션에 맞춘다 (옵션이 없는 상품은 건드리지 않는다).
// 같은 상품의 다른 옵션을 동시에 사도 합이 어긋나지 않게, 상품 줄을 잠근 뒤 새 문장에서 다시 센다.
// 판매 중 옵션이 하나도 없으면 재고 0(품절)으로 두고 가격은 그대로 둔다
export async function syncOptionTotals(client, codes) {
  if (!codes.length) return
  await lockProducts(client, codes)
  await client.query(
    `UPDATE products p SET stock = COALESCE(s.stock, 0), price = COALESCE(s.min_price, p.price), updated_at = now()
     FROM (SELECT product_code, sum(stock) FILTER (WHERE status = 'active')::int AS stock, min(price) FILTER (WHERE status = 'active') AS min_price
           FROM product_options WHERE product_code = ANY($1) GROUP BY product_code) s
     WHERE p.product_code = s.product_code`,
    [codes],
  )
}

// 저장 전 옵션 (판매 중 옵션의 가격 변경을 수정 이력에 남길 때 비교용)
export async function currentOptions(code) {
  const { rows } = await pool.query('SELECT id, name, price, status FROM product_options WHERE product_code = $1', [code])
  return rows
}

// 판매 중이던 옵션의 가격이 바뀐 것만 [{ label, old, new }]
export function optionPriceChanges(before, after) {
  const changes = []
  for (const o of after) {
    const old = before.find((b) => b.id === o.id)
    if (old && old.status === 'active' && Number(old.price) !== Number(o.price)) changes.push({ label: `가격 (${o.name})`, old: old.price, new: o.price })
  }
  return changes
}

// 상품을 저장한 뒤 부른다. options(검사를 통과한 목록)가 null 이면 옵션은 그대로 두고 상품 가격·재고만 옵션에 다시 맞춘다.
// 목록에서 빠진 옵션은 주문 기록이 없으면 지우고, 있으면 지우지 않고 판매 중지로 내린다.
// 돌려주는 값: { product: 저장된 상품 줄, stopped: 판매 중지로 바꾼 옵션 이름들 }
export async function saveOptions(code, options) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockProducts(client, [code])
    const stopped = []
    if (options) {
      const { rows: existing } = await client.query(
        `SELECT o.*, EXISTS (SELECT 1 FROM order_items oi WHERE oi.option_id = o.id) AS ordered
         FROM product_options o WHERE o.product_code = $1 FOR UPDATE`,
        [code],
      )
      const byId = new Map(existing.map((o) => [o.id, o]))
      if (options.some((o) => o.id && !byId.has(o.id))) throw Object.assign(new Error('이 상품에 없는 옵션이 들어 있어요. 화면을 새로 고친 뒤 다시 저장해 주세요.'), { status: 400 })
      // 빼고 같은 이름으로 다시 넣은 옵션은 원래 옵션을 고친 것으로 본다 (주문 기록이 남은 옵션과 이름이 겹치지 않게)
      const kept = new Set(options.filter((o) => o.id).map((o) => o.id))
      const rows = options.map((o) => ({ ...o, id: o.id ?? existing.find((x) => !kept.has(x.id) && x.name === o.name)?.id ?? null }))
      const keep = new Set(rows.filter((o) => o.id).map((o) => o.id))
      for (const o of existing.filter((x) => !keep.has(x.id))) {
        if (o.ordered) {
          await client.query("UPDATE product_options SET status = 'stopped', updated_at = now() WHERE id = $1", [o.id])
          stopped.push(o.name)
        } else {
          await client.query('DELETE FROM product_options WHERE id = $1', [o.id])
        }
      }
      // 이름을 서로 바꾸는 경우에도 겹치지 않게, 고칠 옵션의 이름을 잠시 비켜 둔 뒤 새 이름을 넣는다
      const updating = rows.filter((o) => o.id)
      if (updating.length) await client.query("UPDATE product_options SET name = '#' || id WHERE id = ANY($1)", [updating.map((o) => o.id)])
      for (const [index, o] of rows.entries()) {
        if (o.id) {
          await client.query(
            'UPDATE product_options SET name = $2, price = $3, stock = $4, status = $5, sort_order = $6, updated_at = now() WHERE id = $1',
            [o.id, o.name, o.price, o.stock, o.status, index],
          )
        } else {
          await client.query(
            'INSERT INTO product_options (product_code, name, price, stock, status, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
            [code, o.name, o.price, o.stock, o.status, index],
          )
        }
      }
      // 옵션 가격을 바꾸거나 새 옵션을 넣으면 가격 기준일도 오늘로
      if (rows.some((o) => !o.id || Number(byId.get(o.id).price) !== o.price)) {
        await client.query('UPDATE products SET price_updated_at = now() WHERE product_code = $1', [code])
      }
    }
    await syncOptionTotals(client, [code])
    const { rows } = await client.query(`SELECT p.*, ${ALL_OPTIONS_SQL} FROM products p WHERE p.product_code = $1`, [code])
    await client.query('COMMIT')
    return { product: rows[0], stopped }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
