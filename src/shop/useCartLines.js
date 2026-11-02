import { useEffect, useState } from 'react'
import { get, getPolicy } from './shared.js'

// 장바구니: 브라우저에 저장된 상품을 지금 가격·재고로 다시 보여 준다 (주문 금액은 서버가 최종 계산)
export function useCartLines(lines) {
  const [products, setProducts] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([get('/products'), getPolicy()])
      .then(([list, pol]) => { setProducts(Object.fromEntries(list.map((p) => [p.product_code, p]))); setPolicy(pol) })
      .catch((e) => setError(e.message))
  }, [])

  const rows = products
    ? lines.map((l) => {
      const p = products[l.productCode]
      const problem = !p ? '판매하지 않는 상품' : p.sold_out ? '품절' : l.quantity > p.stock ? `재고 ${p.stock}개` : ''
      return { ...l, product: p, problem, subtotal: p ? p.price * l.quantity : 0 }
    })
    : []
  const ok = rows.filter((r) => !r.problem)
  const itemsAmount = ok.reduce((sum, r) => sum + r.subtotal, 0)
  // 농가마다 따로 보내서 배송비도 농가마다 (그 농가 상품이 무료 배송 기준 이상이면 그 농가는 무료). 서버 계산과 같은 규칙
  const farms = []
  for (const r of ok) {
    const farm = farms.find((f) => f.sellerCode === r.product.seller_code)
    if (farm) farm.itemsAmount += r.subtotal
    else farms.push({ sellerCode: r.product.seller_code, name: r.product.seller_name.replace(/\[예시\]\s*/g, ''), itemsAmount: r.subtotal })
  }
  for (const f of farms) f.fee = policy ? (f.itemsAmount >= policy.shipping.freeOver ? 0 : policy.shipping.fee) : 0
  const fee = farms.reduce((sum, f) => sum + f.fee, 0)
  return { loading: !products && !error, error, rows, ok, itemsAmount, fee, farms, total: itemsAmount + fee, policy }
}
