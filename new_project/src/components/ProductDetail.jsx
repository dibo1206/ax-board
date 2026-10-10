import { useState } from 'react'
import { formatPrice } from '../data/products.js'
import { GUIDES } from '../data/guides.js'
import ProductImage from './ProductImage.jsx'
import InquiryForm from './InquiryForm.jsx'

export default function ProductDetail({ product, onAskProduct }) {
  const [showInquiry, setShowInquiry] = useState(false)

  return (
    <main className="page page-detail">
      <ProductImage product={product} size="lg" />

      <section className="detail-head">
        <h2 className="detail-name">
          {product.name}
          {product.soldOut && <span className="badge badge-soldout">품절</span>}
        </h2>
        <p className="detail-price">{formatPrice(product.price)}</p>
      </section>

      <dl className="spec-list">
        <div>
          <dt>판매 단위</dt>
          <dd>{product.unit}</dd>
        </div>
        <div>
          <dt>1개당 무게</dt>
          <dd>{product.weightPerItem}</dd>
        </div>
        <div>
          <dt>박스당 개수</dt>
          <dd>{product.countPerBox}</dd>
        </div>
        {product.brix && (
          <div>
            <dt>당도</dt>
            <dd>{product.brix} Brix</dd>
          </div>
        )}
      </dl>

      <section className="info-card">
        <h3>주요 특징</h3>
        <ul className="feature-list">
          {product.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <section className="info-card">
        <h3>보관 방법</h3>
        <p>{product.storage}</p>
      </section>

      <section className="info-card">
        <h3>{GUIDES.delivery.title}</h3>
        <p>{GUIDES.delivery.text}</p>
      </section>

      {product.soldOut && !showInquiry && (
        <p className="notice notice-warn">지금은 품절된 상품이에요. 주문 문의 시 입고 일정을 안내해 드려요.</p>
      )}

      {showInquiry && (
        <InquiryForm product={product} onClose={() => setShowInquiry(false)} />
      )}

      <div className="detail-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowInquiry(true)}
          disabled={showInquiry}
        >
          주문 문의
        </button>
        <button type="button" className="btn btn-outline" onClick={() => onAskProduct(product)}>
          이 상품 물어보기
        </button>
      </div>
    </main>
  )
}
