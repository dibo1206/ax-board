import { useEffect, useState } from 'react'
import { PickList } from '../Recommend.jsx'
import { get, getAccount, MAX_QTY, optionLabel, preorderNote, readCart, sameLine, won, writeCart } from './shared.js'
import { useCartLines } from './useCartLines.js'

// 농가가 여럿이면 농가마다 따로 보내서 배송비도 농가마다 보여 준다
// shopMore: 무료 배송 기준을 못 채웠으면 안내 밑에 초록 [계속 쇼핑하기]를 띄운다 (2026-11-07 피드백)
export function Totals({ itemsAmount, fee, total, policy, farms = [], shopMore = false }) {
  const many = farms.length > 1
  const keepShopping = shopMore && policy && fee > 0 && (
    <dd className="full"><a className="free-more" href="/#products">계속 쇼핑하기 <span aria-hidden="true">→</span></a></dd>
  )
  const more = (f) => (policy && f.fee > 0 ? ` · ${won(policy.shipping.freeOver - f.itemsAmount)} 더 담으면 무료` : '')
  return (
    <dl className="totals">
      <dt>상품 금액</dt><dd>{won(itemsAmount)}</dd>
      <dt>배송비{many && ` (농가 ${farms.length}곳)`}</dt><dd>{fee ? won(fee) : '무료'}</dd>
      {many && farms.map((f) => (
        <dd key={f.sellerCode} className="muted full">{f.name}: {f.fee ? won(f.fee) : '무료'}{more(f)}</dd>
      ))}
      <dt className="sum">결제 예정 금액</dt><dd className="sum">{won(total)}</dd>
      {many && <dd className="muted full">농가마다 따로 보내서 배송비가 농가마다 붙어요. 상품은 따로 도착할 수 있어요.</dd>}
      {many && keepShopping}
      {!many && policy && fee > 0 && (
        <dd className="full free-ship">
          <span className="muted">{won(policy.shipping.freeOver - itemsAmount)} 더 담으면 무료 배송이에요</span>
          <span className="free-bar" role="progressbar" aria-label="무료 배송까지" aria-valuemin={0} aria-valuemax={policy.shipping.freeOver} aria-valuenow={itemsAmount}>
            <span style={{ width: `${Math.min(100, Math.round((itemsAmount / policy.shipping.freeOver) * 100))}%` }} />
          </span>
          <span className="free-scale muted"><span>0원</span><span>{won(policy.shipping.freeOver)}</span></span>
        </dd>
      )}
      {!many && keepShopping}
      {!many && policy && fee === 0 && itemsAmount > 0 && <dd className="full free-ship"><span className="free-done">무료 배송 조건을 채웠어요</span></dd>}
    </dl>
  )
}

// 담은 상품과 어울리는 상품: 담은 상품(앞 3개)마다 "함께 보면 좋은 상품"을 받아 합치고, 이미 담은 건 뺀다
function CartRelated({ lines, onOpen }) {
  const [items, setItems] = useState([])
  const key = lines.slice(0, 3).map((l) => l.productCode).join(',')
  useEffect(() => {
    let stale = false
    const codes = key ? key.split(',') : []
    Promise.all(codes.map((c) => get(`/products/${c}/related`).then((d) => d.items).catch(() => [])))
      .then((lists) => {
        if (stale) return
        const inCart = new Set(readCart().map((l) => l.productCode))
        const seen = new Set()
        const merged = lists.flat().filter((x) => !inCart.has(x.product_code) && !seen.has(x.product_code) && seen.add(x.product_code))
        setItems(merged.slice(0, 3))
      })
    return () => { stale = true }
  }, [key])
  if (!items.length) return null
  return (
    <section className="cart-related">
      <h3>함께 보면 좋은 상품</h3>
      <PickList items={items} onOpen={onOpen} withCart />
    </section>
  )
}

export function Cart() {
  const [lines, setLines] = useState(readCart)
  const [account, setAccount] = useState(undefined) // undefined: 확인 중, null: 비회원
  const cart = useCartLines(lines)

  useEffect(() => { getAccount().then(setAccount) }, [])

  useEffect(() => {
    const update = () => setLines(readCart())
    window.addEventListener('cart-change', update)
    return () => window.removeEventListener('cart-change', update)
  }, [])

  // 같은 상품이라도 옵션이 다르면 다른 줄이다
  const change = (line, quantity) => writeCart(quantity > 0
    ? lines.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))
    : lines.filter((l) => !sameLine(l, line)))

  if (cart.error) return <p className="error">{cart.error}</p>
  if (cart.loading) return <p className="muted">불러오는 중…</p>
  return (
    <section>
      <h2>장바구니</h2>
      {lines.length === 0 ? (
        <div className="cart-empty">
          {/* 반짝이는 장바구니 아이콘 (2026-11-07 피드백) */}
          <span className="cart-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M7 15h5l4.5 17h17.5l4-12H14" /><circle cx="19" cy="38" r="2.4" /><circle cx="31" cy="38" r="2.4" /><path d="M24 4v5M16 7l2.5 4M32 7l-2.5 4" /></svg>
          </span>
          <p className="cart-empty-title">장바구니에 담긴 상품이 없습니다.</p>
          <p className="muted">제철 과일과 농산물을 둘러보고 마음에 드는 상품을 담아 보세요.</p>
          <a className="cart-empty-go" href="/#products">상품 보러 가기</a>
        </div>
      ) : (
        <>
          <ul className="cart">
            {cart.rows.map((r) => (
              <li key={`${r.productCode}:${r.optionId ?? ''}`} className={`box${r.problem ? ' dim' : ''}`}>
                <div>
                  <strong>{r.product ? optionLabel(r.product.name, r.option?.name) : r.productCode}</strong>
                  {r.product && (r.option || !r.product.has_options) && <p className="muted">{won(r.price)} / {r.option?.name ?? r.product.unit}</p>}
                  {r.product?.preorder && <p className="muted"><span className="badge pending">예약</span> {preorderNote(r.product.ship_from)}</p>}
                  {r.problem && <p className="error">{r.problem} — 주문에서 빠져요</p>}
                </div>
                <div className="qty">
                  <button type="button" onClick={() => change(r, r.quantity - 1)} aria-label="하나 빼기">−</button>
                  <span>{r.quantity}</span>
                  <button type="button" onClick={() => change(r, r.quantity + 1)} aria-label="하나 더" disabled={!r.product || r.quantity >= r.stock}>+</button>
                </div>
                <strong>{won(r.subtotal)}</strong>
                <button type="button" className="link" onClick={() => change(r, 0)}>삭제</button>
              </li>
            ))}
          </ul>
          <Totals {...cart} shopMore />
          {account === null && (
            <p className="guest-note">회원가입 없이 바로 주문할 수 있어요. 비회원은 <a href="/order/lookup">주문 조회</a>에서 주문번호와 휴대폰 번호로 확인해요. <a href="/account/login?next=/cart">로그인</a>하면 주문 내역이 저장돼요.</p>
          )}
          <div className="actions">
            <a className="button ghost" href="/">계속 쇼핑하기</a>
            {cart.ok.length > 0 ? <a className="button" href="/checkout">주문하기</a> : <span className="button ghost">주문할 수 있는 상품이 없어요</span>}
          </div>
          <CartRelated lines={lines} onOpen={(code) => { window.location.href = `/p/${encodeURIComponent(code)}` }} />
        </>
      )}
    </section>
  )
}
