import { useMemo, useState } from 'react'
import { formatPrice } from '../data/products.js'
import { QUESTIONS, optionLabel, recommend } from '../utils/recommend.js'
import ProductImage from './ProductImage.jsx'

export default function RecommendResult({ answers, onOpenProduct, onChangeConditions, onRestart }) {
  const result = useMemo(() => recommend(answers), [answers])
  const [checked, setChecked] = useState([])
  const [showCompare, setShowCompare] = useState(false)

  const compareItems = result.items.filter((item) => checked.includes(item.product.id))

  function toggle(id) {
    setShowCompare(false)
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <main className="page">
      <h2>추천 결과</h2>
      <p className="answer-summary">
        {QUESTIONS.map((q) => optionLabel(q.key, answers[q.key])).join(' · ')}
      </p>

      {!result.exact && (
        <div className="notice notice-warn">
          <p>조건에 딱 맞는 상품이 없어요. 조건을 하나 바꿔 보세요.</p>
          <button type="button" className="btn btn-small btn-outline" onClick={onChangeConditions}>
            조건 변경하기
          </button>
          <p className="notice-sub">아래는 가장 가까운 상품이에요.</p>
        </div>
      )}

      <ul className="result-list">
        {result.items.map(({ product, reason, mismatches }) => (
          <li key={product.id} className="result-card">
            <div className="result-top">
              <ProductImage product={product} size="sm" />
              <div>
                <p className="product-name">{product.name}</p>
                <p className="product-price">{formatPrice(product.price)}</p>
                <p className="product-meta">{product.features.slice(0, 2).join(' · ')}</p>
              </div>
            </div>
            <p className="reason">
              <strong>추천 이유</strong> {reason}
            </p>
            {mismatches.length > 0 && (
              <p className="mismatch">
                맞지 않는 조건: {mismatches.map((key) => QUESTIONS.find((q) => q.key === key).title.replace(/\?$/, '')).join(', ')}
              </p>
            )}
            <div className="result-actions">
              <label className="check">
                <input
                  type="checkbox"
                  checked={checked.includes(product.id)}
                  onChange={() => toggle(product.id)}
                />
                비교하기
              </label>
              <button type="button" className="btn btn-small btn-outline" onClick={() => onOpenProduct(product.id)}>
                상세 보기
              </button>
            </div>
          </li>
        ))}
      </ul>

      {result.items.length >= 2 && (
        <button
          type="button"
          className="btn btn-outline btn-block"
          disabled={compareItems.length < 2}
          onClick={() => setShowCompare(true)}
        >
          선택 상품 비교하기 ({compareItems.length}개 선택)
        </button>
      )}

      {showCompare && compareItems.length >= 2 && <CompareTable items={compareItems.map((i) => i.product)} />}

      <button type="button" className="btn btn-primary btn-block restart" onClick={onRestart}>
        다시 추천받기
      </button>
    </main>
  )
}

const COMPARE_ROWS = [
  ['가격', (p) => formatPrice(p.price)],
  ['판매 단위', (p) => p.unit],
  ['무게', (p) => p.weightPerItem],
  ['주요 특징', (p) => p.features.join(', ')],
  ['보관 방법', (p) => p.storage],
]

function CompareTable({ items }) {
  return (
    <section className="compare">
      <h3>상품 비교</h3>
      <div className="compare-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">항목</th>
              {items.map((p) => (
                <th key={p.id} scope="col">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(([label, get]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {items.map((p) => (
                  <td key={p.id}>{get(p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
