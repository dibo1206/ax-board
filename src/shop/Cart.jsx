import { useEffect, useState } from 'react'
import { MAX_QTY, readCart, won, writeCart } from './shared.js'
import { useCartLines } from './useCartLines.js'

export function Totals({ itemsAmount, fee, total, policy }) {
  return (
    <dl className="totals">
      <dt>상품 금액</dt><dd>{won(itemsAmount)}</dd>
      <dt>배송비</dt><dd>{fee ? won(fee) : '무료'}</dd>
      <dt className="sum">결제 예정 금액</dt><dd className="sum">{won(total)}</dd>
      {policy && fee > 0 && <dd className="muted full">{won(policy.shipping.freeOver - itemsAmount)} 더 담으면 무료 배송이에요</dd>}
    </dl>
  )
}

export function Cart() {
  const [lines, setLines] = useState(readCart)
  const cart = useCartLines(lines)

  useEffect(() => {
    const update = () => setLines(readCart())
    window.addEventListener('cart-change', update)
    return () => window.removeEventListener('cart-change', update)
  }, [])

  const change = (code, quantity) => writeCart(quantity > 0
    ? lines.map((l) => (l.productCode === code ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))
    : lines.filter((l) => l.productCode !== code))

  if (cart.error) return <p className="error">{cart.error}</p>
  if (cart.loading) return <p className="muted">불러오는 중…</p>
  return (
    <section>
      <h2>장바구니</h2>
      {lines.length === 0 ? (
        <div className="box"><p>장바구니가 비어 있어요.</p><a className="button" href="/">상품 보러 가기</a></div>
      ) : (
        <>
          <ul className="cart">
            {cart.rows.map((r) => (
              <li key={r.productCode} className={`box${r.problem ? ' dim' : ''}`}>
                <div>
                  <strong>{r.product?.name ?? r.productCode}</strong>
                  {r.product && <p className="muted">{won(r.product.price)} / {r.product.unit}</p>}
                  {r.problem && <p className="error">{r.problem} — 주문에서 빠져요</p>}
                </div>
                <div className="qty">
                  <button type="button" onClick={() => change(r.productCode, r.quantity - 1)} aria-label="하나 빼기">−</button>
                  <span>{r.quantity}</span>
                  <button type="button" onClick={() => change(r.productCode, r.quantity + 1)} aria-label="하나 더" disabled={!r.product || r.quantity >= r.product.stock}>+</button>
                </div>
                <strong>{won(r.subtotal)}</strong>
                <button type="button" className="link" onClick={() => change(r.productCode, 0)}>삭제</button>
              </li>
            ))}
          </ul>
          <Totals {...cart} />
          <div className="actions">
            <a className="button ghost" href="/">계속 쇼핑하기</a>
            {cart.ok.length > 0 ? <a className="button" href="/checkout">주문하기</a> : <span className="button ghost">주문할 수 있는 상품이 없어요</span>}
          </div>
        </>
      )}
    </section>
  )
}
