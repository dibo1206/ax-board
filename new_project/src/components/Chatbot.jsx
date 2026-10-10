import { useEffect, useRef, useState } from 'react'
import { FARM } from '../data/guides.js'
import { answerQuestion } from '../utils/chatbot.js'

function greeting(product) {
  return {
    from: 'bot',
    text: product
      ? `${product.name}에 대해 무엇이든 물어보세요. 가격, 보관 방법, 배송을 안내해 드려요.`
      : '안녕하세요! 상품 특징, 가격, 보관 방법, 배송·구매 방법을 물어보세요.',
    sources: [],
    showShortcuts: true,
  }
}

export default function Chatbot({ product, onClose, onStartRecommend }) {
  const [messages, setMessages] = useState(() => [greeting(product)])
  const [input, setInput] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  function send(text) {
    const question = text.trim()
    if (!question) return
    const answer = answerQuestion(question, product)
    setMessages((prev) => [...prev, { from: 'user', text: question }, { from: 'bot', ...answer }])
    setInput('')
  }

  function handleShortcut(kind) {
    if (kind === 'recommend' || kind === 'compare') {
      onStartRecommend()
      return
    }
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: '상품 문의' },
      { from: 'bot', text: '궁금한 상품 이름과 내용을 적어 주세요. (예: 사과즙 보관 방법, 배송비 얼마예요?)', sources: [] },
    ])
  }

  return (
    <div className="chat" role="dialog" aria-label="상품 상담">
      <div className="chat-head">
        <h2>상품 상담</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="chat-body">
        {messages.map((m, i) => (
          <div key={i} className={`bubble-row bubble-row-${m.from}`}>
            <div className={`bubble bubble-${m.from}`}>
              <p>{m.text}</p>
              {m.sources?.length > 0 && <p className="source">근거: {m.sources.join(' / ')}</p>}
              {m.answered === false && (
                <div className="contact">
                  <a className="btn btn-small btn-outline" href={`tel:${FARM.phone}`}>
                    전화 문의
                  </a>
                  <a className="btn btn-small btn-kakao" href={FARM.kakaoUrl} target="_blank" rel="noreferrer">
                    카카오톡 문의
                  </a>
                </div>
              )}
              {m.showShortcuts && (
                <div className="shortcuts">
                  <button type="button" className="chip" onClick={() => handleShortcut('recommend')}>
                    상품 추천
                  </button>
                  <button type="button" className="chip" onClick={() => handleShortcut('compare')}>
                    상품 비교
                  </button>
                  <button type="button" className="chip" onClick={() => handleShortcut('inquiry')}>
                    상품 문의
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="질문을 입력하세요"
          aria-label="질문 입력"
        />
        <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
          보내기
        </button>
      </form>
    </div>
  )
}
