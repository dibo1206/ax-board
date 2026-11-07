// 관리자·판매자 화면이 같이 쓰는 작은 조각: 상태 칩, 숫자 카드, 개수 배지, 걸러 보기 칩, 배송 단계
// 색은 뜻으로만 쓴다: 초록 = 판매·완료, 노랑 = 기다림·확인 필요, 빨강 = 품절·반려·문제, 회색 = 임시·끝난 것
import { thumbUrl } from '../shop/shared.js'

export function Chip({ tone = 'gray', children, title }) {
  return <span className={`chip chip-${tone}`} title={title}>{children}</span>
}

// 상품 상태: 판매 중 / 검토 대기 / 반려 / 임시 저장 (+ 품절은 따로)
export function ProductStatus({ product }) {
  if (product.status === 'pending') return <Chip tone="amber">검토 대기</Chip>
  if (product.status === 'draft') return product.review_note ? <Chip tone="red" title={product.review_note}>반려됨</Chip> : <Chip>임시 저장</Chip>
  return <Chip tone="green">판매 중</Chip>
}

// 재고: 품절(빨강) · 5개 이하(노랑) · 나머지는 개수만
export function StockChip({ product }) {
  if (product.sold_out) return <Chip tone="red">품절</Chip>
  if (product.stock <= 5) return <Chip tone="amber">재고 {product.stock}개</Chip>
  return <span className="stock-plain">재고 {product.stock}개</span>
}

// 숫자 카드: 할 일이 있으면(값 > 0) 강조하고 누르면 그 화면으로
export function StatTile({ label, value, hint, tone = 'green', onClick }) {
  const active = Number(value) > 0
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`stat-tile${active ? ` on tone-${tone}` : ''}`} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </Tag>
  )
}

export const CountBadge = ({ n }) => (n > 0 ? <span className="count-badge">{n}</span> : null)

// 걸러 보기: [{ key, label, count }] 중 하나를 고른다
export function FilterChips({ items, value, onChange }) {
  return (
    <div className="filter-chips" role="tablist">
      {items.map((f) => (
        <button key={f.key} type="button" role="tab" aria-selected={value === f.key} className={value === f.key ? 'on' : ''} onClick={() => onChange(f.key)}>
          {f.label}{f.count != null && <span className="filter-count">{f.count}</span>}
        </button>
      ))}
    </div>
  )
}

// 농가 배송 단계: 결제 완료 → 배송 준비 → 배송 중 → 배송 완료 (취소는 따로)
const STEPS = [['paid', '결제 완료'], ['preparing', '배송 준비'], ['shipping', '배송 중'], ['delivered', '배송 완료']]
export function ShipSteps({ status }) {
  if (status === 'cancelled') return <Chip tone="gray">취소됨</Chip>
  const at = STEPS.findIndex(([key]) => key === status)
  return (
    <ol className="ship-steps" aria-label={`배송 단계: ${STEPS.at(Math.max(0, at))?.[1] ?? status}`}>
      {STEPS.map(([key, label], i) => <li key={key} className={i < at ? 'done' : i === at ? 'now' : ''}>{label}</li>)}
    </ol>
  )
}

// 상품 사진 작게 (없으면 회색 칸)
export function Thumb({ url, size = 72 }) {
  return url
    ? <img className="thumb-sm" src={thumbUrl(url)} alt="" width={size} height={size} loading="lazy" />
    : <span className="thumb-sm thumb-none" style={{ width: size, height: size }}>사진 없음</span>
}
