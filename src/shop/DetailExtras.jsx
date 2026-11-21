// 상품 상세에 붙는 배송 달력·소비기한·판매자 정보 (2026-11-20)
//  - DeliveryLine: 가격 밑 한 줄 "지금 주문하면 ○일 출고 · ○일 도착 예정"
//  - ExpiryNote: 상품 설명 탭의 소비기한 (참고) 줄 (배송 여정 카드 아래)
//  - SellerBox: 판매자 정보 + 통신판매중개자 고지 [회사·법률 확인 필요]
// 날짜 계산은 src/shop/delivery.js (설정은 관리자 [쇼핑몰 설정 > 배송])
import { useEffect, useState } from 'react'
import { dayLabel, deliveryPlan, expiryDate, expiryDays } from './delivery.js'
import { getPolicy } from './shared.js'

// 사업자등록번호 10자리는 000-00-00000 모양으로
const bizNo = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v }

function usePolicy() {
  const [policy, setPolicy] = useState(null)
  useEffect(() => { getPolicy().then(setPolicy).catch(() => {}) }, [])
  return policy
}
// 1분마다 다시 계산 (마감 시각을 넘기면 날짜가 바뀐다)
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const TRUCK = 'M3 6h11v10H3zM14 9h4l3 3.5V16h-7zM7 19a1.8 1.8 0 1 0 0 .01M17 19a1.8 1.8 0 1 0 0 .01'

export function DeliveryLine({ product }) {
  const policy = usePolicy()
  const now = useNow()
  if (!policy?.shipping || product.sold_out) return null
  const plan = deliveryPlan(policy.shipping, { now, shipFrom: product.ship_from })
  return (
    <p className="delivery-line">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={TRUCK} /></svg>
      <span>
        {plan.preorder ? '예약 상품이라 ' : plan.cutoffToday ? `오늘 ${plan.cutoffHour}시 전 주문하면 ` : '지금 주문하면 '}
        <b>{dayLabel(plan.shipDate)} 출고</b> · <b>{dayLabel(plan.arriveDate)} 도착 예정</b>
      </span>
    </p>
  )
}

// 소비기한 (참고) 한 줄 (2026-11-21): 상품 설명 탭의 배송 여정 카드(DeliveryJourney) 바로 아래.
// 예전 [배송·소비기한] 칸의 출고·도착·마감·택배 줄은 배송 여정 카드가 보여 주므로 소비기한만 남겼다
export function ExpiryNote({ product }) {
  const policy = usePolicy()
  const now = useNow()
  if (!policy?.shipping) return null
  const plan = deliveryPlan(policy.shipping, { now, shipFrom: product.ship_from })
  const expiryText = product.notice?.expiry ?? ""
  const until = expiryDate(plan.arriveDate, expiryText)
  return (
    <section className="box expiry-note">
      <table className="notice-table"><tbody>
        <tr><th scope="row">소비기한 (참고)</th><td>
          {until && !product.sold_out
            ? <><b>{dayLabel(until)}</b>까지 <span className="muted">(도착 예정일부터 {expiryDays(expiryText)}일 기준 · {expiryText})</span></>
            : expiryText
              ? <>{expiryText}{!until && <span className="muted"> · {product.category === "가공품" ? "받은 상품 라벨에 적힌 날짜를 확인해 주세요" : "신선 농산물은 날짜보다 받은 뒤 상태(색·향·무름)로 판단해 주세요"}</span>}</>
              : <span className="muted">판매자가 아직 적지 않았어요. 아래 보관·섭취 안내를 참고해 주세요</span>}
        </td></tr>
      </tbody></table>
      <p className="note">소비기한은 보관법을 지켰을 때 기준이고, 제품 라벨에 적힌 날짜가 있으면 라벨이 우선이에요.</p>
    </section>
  )
}

// 판매자 정보: 회사 직영은 회사 사업자 정보, 사업자 농가는 상호·대표자·사업자등록번호, 개인 농가는 상호·지역
// 통신판매중개자 고지는 판매 방식이 '중개'이고 농가 상품일 때만
export function SellerBox({ product }) {
  const policy = usePolicy()
  if (!policy?.shop) return null
  const shop = policy.shop
  const info = product.seller_info
  const fill = (text) => String(text ?? '').replaceAll('{회사}', shop.company).replaceAll('{쇼핑몰}', shop.name)
  const rows = info === null || info === undefined
    ? [['판매자', shop.company], ['대표자', shop.ceo], ['사업자등록번호', shop.bizNo], ['통신판매업 신고번호', shop.mailOrderNo], ['사업장 주소', shop.address], ['고객센터', `${shop.phone} · ${shop.email}`]]
    : info.kind === 'business'
      ? [['판매자(상호)', info.name], ['대표자', info.owner || '고객센터로 문의해 주세요'], ['사업자등록번호', bizNo(info.business_no)], ['지역', info.region || '-'], ['판매자 문의', `상품 문의 탭 또는 ${shop.name} 고객센터 ${shop.phone}`]]
      : [['판매자', `${info.name} (개인 농가)`], ['지역', info.region || '-'], ['판매자 문의', `상품 문의 탭 또는 ${shop.name} 고객센터 ${shop.phone}`]]
  return (
    <section className="box seller-box">
      <h3>판매자 정보</h3>
      <table className="notice-table"><tbody>
        {rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
      </tbody></table>
      {info?.kind === 'individual' && <p className="note">개인 농가의 이름·연락처는 공개하지 않아요. 분쟁 해결 등에 필요하면 고객센터가 확인해 알려 드려요.</p>}
      {info && shop.saleMode === 'broker' && shop.brokerNotice && <p className="broker-notice">{fill(shop.brokerNotice)}</p>}
    </section>
  )
}
