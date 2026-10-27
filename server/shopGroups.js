// 손님 화면의 카테고리 (디자인 시안: 생과일·선물세트 / 과일 농축액 / 가공식품)
// DB 품목 분류(과일·채소·가공품)를 손님에게 보여 줄 묶음으로 바꾼다. 가공품 중 이름에 청·농축·베이스·시럽이 있으면 농축액
// 상품이 하나도 없는 묶음 중 hideEmpty 는 감춘다 (예시 데이터의 채소는 실제 데이터에 없으면 사라진다)
import express from 'express'
import { cached } from './cache.js'
import { pool } from './db.js'

const BASE = "i.name ~ '청|농축|베이스|시럽'"
export const GROUPS = [
  { key: 'fresh', name: '생과일 · 선물세트', desc: '산지에서 골라 담는 로컬 과일세트', where: "i.category = '과일'" },
  { key: 'base', name: '과일 농축액', desc: '물, 탄산수, 우유에 섞는 음료 베이스', where: `(i.category = '가공품' AND ${BASE})` },
  { key: 'processed', name: '가공식품', desc: '오래 두고 먹는 과일 가공품', where: `(i.category = '가공품' AND NOT ${BASE})` },
  { key: 'veg', name: '채소', desc: '밭에서 바로 캔 제철 채소', where: "i.category = '채소'", hideEmpty: true },
]
export const groupWhere = (key) => GROUPS.find((g) => g.key === key)?.where ?? null

export const shopGroupRouter = express.Router()

shopGroupRouter.get('/shop-groups', async (req, res) => {
  res.json(await cached('shop-groups', 15_000, async () => {
    const { rows } = await pool.query(
      `SELECT ${GROUPS.map((g, n) => `count(*) FILTER (WHERE ${g.where})::int AS g${n}`).join(', ')}
       FROM products p JOIN items i ON i.item_code = p.item_code WHERE p.status = 'active'`,
    )
    return GROUPS
      .map(({ key, name, desc, hideEmpty }, n) => ({ key, name, desc, count: rows[0][`g${n}`], hideEmpty: Boolean(hideEmpty) }))
      .filter((g) => !(g.hideEmpty && g.count === 0))
  }))
})
