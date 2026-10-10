import { useEffect, useState } from 'react'
import { FARM } from './data/guides.js'
import { findProduct } from './data/products.js'
import Home from './components/Home.jsx'
import ProductDetail from './components/ProductDetail.jsx'
import Recommend from './components/Recommend.jsx'
import Chatbot from './components/Chatbot.jsx'

// 라우터 없이 화면 상태 하나로 전환한다: home | detail | recommend
export default function App() {
  const [view, setView] = useState({ name: 'home' })
  const [chat, setChat] = useState(null) // null이면 닫힘, { product }면 열림

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  const product = view.name === 'detail' ? findProduct(view.productId) : null

  function openProduct(productId) {
    setView({ name: 'detail', productId })
    setChat(null)
  }

  function startRecommend() {
    setView({ name: 'recommend' })
    setChat(null)
  }

  function goHome() {
    setView({ name: 'home' })
  }

  return (
    <div className="app">
      <header className="header">
        {view.name === 'detail' ? (
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={goHome} aria-label="뒤로 가기">
              ← 뒤로
            </button>
            <h1 className="header-title">{product?.name}</h1>
          </>
        ) : (
          <>
            <h1 className="header-title">
              <button type="button" className="logo" onClick={goHome}>
                🌾 {FARM.name}
              </button>
            </h1>
            <nav className="nav">
              <button type="button" className={view.name === 'home' ? 'active' : ''} onClick={goHome}>
                홈
              </button>
              <button
                type="button"
                className={view.name === 'recommend' ? 'active' : ''}
                onClick={startRecommend}
              >
                상품 추천받기
              </button>
            </nav>
          </>
        )}
      </header>

      {view.name === 'home' && <Home onOpenProduct={openProduct} onStartRecommend={startRecommend} />}
      {view.name === 'detail' && product && (
        <ProductDetail product={product} onAskProduct={(p) => setChat({ product: p })} />
      )}
      {view.name === 'recommend' && <Recommend onClose={goHome} onOpenProduct={openProduct} />}

      {view.name !== 'recommend' &&
        (chat ? (
          <Chatbot
            key={chat.product?.id ?? 'general'}
            product={chat.product}
            onClose={() => setChat(null)}
            onStartRecommend={startRecommend}
          />
        ) : (
          <button type="button" className="fab" onClick={() => setChat({ product })}>
            💬 상담하기
          </button>
        ))}
    </div>
  )
}
