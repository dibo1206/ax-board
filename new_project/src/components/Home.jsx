import { PRODUCTS, formatPrice } from '../data/products.js'
import ProductImage from './ProductImage.jsx'

export default function Home({ onOpenProduct, onStartRecommend }) {
  return (
    <main className="page">
      <section className="hero">
        <p className="hero-text">내 취향에 맞는 농산물을 찾아보세요</p>
        <button type="button" className="btn btn-primary btn-block" onClick={onStartRecommend}>
          입맛에 맞는 상품 추천받기
        </button>
      </section>

      <h2 className="section-title">
        전체 상품 <span className="count">{PRODUCTS.length}개</span>
      </h2>
      <ul className="product-list">
        {PRODUCTS.map((product) => (
          <li key={product.id}>
            <button type="button" className="product-card" onClick={() => onOpenProduct(product.id)}>
              <ProductImage product={product} />
              <div className="product-card-body">
                <p className="product-name">
                  {product.name}
                  {product.soldOut && <span className="badge badge-soldout">품절</span>}
                </p>
                <p className="product-price">{formatPrice(product.price)}</p>
                <p className="product-meta">
                  {product.unit} · {product.weightPerItem}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
