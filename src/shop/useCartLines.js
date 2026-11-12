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

  // 옵션 상품은 고른 옵션의 가격·재고로 본다. 옵션을 안 골랐거나 판매를 멈춘 옵션이면 주문에서 뺀다
  const rows = products
    ? lines.map((l) => {
      const p = products[l.productCode]
      const option = p && l.optionId ? p.options.find((o) => o.id === l.optionId) ?? null : null
      const { price, stock } = option ?? p ?? {}
      const problem = !p ? '판매하지 않는 상품'
        : p.has_options && !option ? (l.optionId ? '판매하지 않는 옵션' : '옵션을 골라 주세요')
          : !p.has_options && l.optionId ? '판매하지 않는 옵션'
            : stock === 0 ? '품절' : l.quantity > stock ? `재고 ${stock}개` : ''
      const known = p && (p.has_options ? Boolean(option) : !l.optionId)
      return { ...l, product: p, option, price, stock, problem, subtotal: known ? price * l.quantity : 0 }
    })
    : []
  const ok = rows.filter((r) => !r.problem)
  const itemsAmount = ok.reduce((sum, r) => sum + r.subtotal, 0)
  // 농가마다 따로 보내지만 배송비는 주문 한 번에 한 번 (상품 합계가 무료 배송 기준 이상이면 무료). 서버 계산과 같은 규칙 (2026-11-12)
  const farms = []
  for (const r of ok) {
    const farm = farms.find((f) => f.sellerCode === r.product.seller_code)
    if (farm) farm.itemsAmount += r.subtotal
    else farms.push({ sellerCode: r.product.seller_code, name: r.product.seller_name.replace(/\[예시\]\s*/g, ''), itemsAmount: r.subtotal })
  }
  const fee = policy && itemsAmount > 0 && itemsAmount < policy.shipping.freeOver ? policy.shipping.fee : 0
  return { loading: !products && !error, error, rows, ok, itemsAmount, fee, farms, total: itemsAmount + fee, policy }
}
