import { useEffect, useRef, useState } from 'react'
import { netFetch } from './net.js'

// 5단계: 화면 오른쪽 아래 상담 창. 보고 있는 상품 코드를 함께 보내서 "이거 얼마예요?"에도 답한다
// 자주 묻는 질문은 버튼으로 (서버가 DB로 바로 답해서 AI를 부르지 않는다). AI는 [AI에게 물어보기]를 누를 때만
const PRODUCT_MENU = [['가격·재고', '이 상품 가격 알려 주세요'], ['보관법', '이 상품 보관법 알려 주세요'], ['레시피', '이 상품 레시피 알려 주세요'], ['산지', '이 상품 어디서 키웠어요?'], ['배송비', '배송비 얼마예요?'], ['교환·환불', '교환·환불은 어떻게 해요?']]
const SHOP_MENU = [['배송비', '배송비 얼마예요?'], ['주문 조회', '주문 조회는 어디서 해요?'], ['교환·환불', '교환·환불은 어떻게 해요?'], ['상품 추천', '선물용 추천해 주세요'], ['보관법', '보관법 알려 주세요']]
const HELLO = { role: 'assistant', content: '안녕하세요! 아래 버튼을 누르거나 가격·당도·보관법·레시피를 물어보세요. 상품 정보에 있는 내용으로 답해 드려요.' }

export function Chat({ productCode, onOpenProduct }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([HELLO])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, open])

  async function send(text, { ai = false } = {}) {
    const question = text.trim()
    if (!question || sending) return
    const history = messages.slice(1).filter((m) => !m.failed).map(({ role, content }) => ({ role, content }))
    setMessages((prev) => [...prev.map((m) => ({ ...m, askAi: false })), { role: 'user', content: ai ? `AI에게: ${question}` : question }])
    setInput('')
    setSending(true)
    try {
      const response = await netFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history, productCode, ai }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '답을 받지 못했어요. 잠시 후 다시 시도해 주세요.')
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, ...data, question }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: e.message, failed: true }])
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return <button type="button" className="chat-open" onClick={() => setOpen(true)}>상담하기</button>
  }

  return (
    <section className="chat" aria-label="상담하기">
      <header>
        <strong>상담하기</strong>
        <button type="button" className="link" onClick={() => setOpen(false)} aria-label="상담 창 닫기">닫기</button>
      </header>
      <ol className="chat-log">
        {messages.map((m, i) => (
          <li key={i} className={`bubble ${m.role}${m.failed ? ' failed' : ''}`}>
            <p>{m.content}</p>
            {m.masked && <p className="muted chat-masked">연락처는 가리고 처리했어요. 답변 알림이 필요하면 상품 Q&A의 연락처 칸을 써 주세요.</p>}
            {m.sources?.length > 0 && (
              <div className="chips">
                <span className="muted">근거</span>
                {m.sources.map((s) => (
                  <button key={s.code} type="button" onClick={() => onOpenProduct(s.code)}>{s.name}</button>
                ))}
              </div>
            )}
            {i === messages.length - 1 && m.suggestions?.length > 0 && (
              <div className="chips">
                {m.suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {i === messages.length - 1 && m.askAi && (
              <button type="button" className="button ghost" onClick={() => send(m.question, { ai: true })}>AI에게 물어보기</button>
            )}
            {m.action === 'lookup' && <a className="button ghost" href="/order/lookup">주문 조회 열기</a>}
            {m.action && m.action !== 'lookup' && m.productCode && (
              <button type="button" className="button ghost" onClick={() => onOpenProduct(m.productCode, m.action)}>
                {m.action === 'b2b' ? '기업 구매 문의 열기' : '상품 Q&A에 질문 남기기'}
              </button>
            )}
          </li>
        ))}
        {sending && <li className="bubble assistant muted">답을 찾는 중…</li>}
        <li ref={endRef} />
      </ol>
      {messages.length === 1 && (
        <div className="chips starters">
          {(productCode ? PRODUCT_MENU : SHOP_MENU).map(([name, text]) => <button key={name} type="button" onClick={() => send(text)}>{name}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} placeholder="궁금한 점을 적어 주세요" aria-label="질문" />
        <button type="submit" className="button" disabled={sending || input.trim().length < 2}>보내기</button>
      </form>
      <p className="chat-note muted">답변은 등록된 상품 정보 기준이에요. 건강·환불 문제는 담당자가 답해요. 연락처 같은 개인정보는 적지 말아 주세요.</p>
    </section>
  )
}
