import { useEffect, useRef, useState } from 'react'
import { clearChat, loadChat, saveChat } from './chatStore.js'
import { netFetch } from './net.js'
import { getAccount } from './shop/shared.js'

// 5단계: 화면 오른쪽 아래 상담 창. 보고 있는 상품 코드를 함께 보내서 "이거 얼마예요?"에도 답한다
// 자주 묻는 질문은 버튼으로 (서버가 DB로 바로 답해서 AI를 부르지 않는다). AI는 [AI에게 물어보기]를 누를 때만
const PRODUCT_MENU = [['가격·재고', '이 상품 가격 알려 주세요'], ['보관법', '이 상품 보관법 알려 주세요'], ['레시피', '이 상품 레시피 알려 주세요'], ['산지', '이 상품 어디서 키웠어요?'], ['배송비', '배송비 얼마예요?'], ['교환·환불', '교환·환불은 어떻게 해요?']]
const SHOP_MENU = [['배송비', '배송비 얼마예요?'], ['주문 조회', '주문 조회는 어디서 해요?'], ['교환·환불', '교환·환불은 어떻게 해요?'], ['상품 추천', '선물용 추천해 주세요'], ['보관법', '보관법 알려 주세요']]
const HELLO = { role: 'assistant', content: '안녕하세요! 아래 버튼을 누르거나 가격·당도·보관법·레시피를 물어보세요. 상품 정보에 있는 내용으로 답해 드려요.' }

export function Chat({ productCode, onOpenProduct }) {
  const [start] = useState(() => loadChat(HELLO))
  const [open, setOpen] = useState(start.open)
  const [messages, setMessages] = useState(start.messages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [member, setMember] = useState(null) // 로그인했는지 (확인 전 null)
  const endRef = useRef(null)

  // 저장된 대화가 다른 로그인 상태에서 나눈 것이면 버린다.
  // account-change 신호는 새 답변 숫자를 고칠 때도 오므로, 계정이 실제로 바뀌었을 때(로그인·로그아웃·다른 계정)만 비운다
  const who = useRef(undefined) // 지금 계정 (이메일, 비회원은 '', 확인 전 undefined). 화면 안에서만 쓰고 저장하지 않는다
  useEffect(() => {
    let alive = true
    const check = () => getAccount().then((account) => {
      if (!alive) return
      const now = account?.email ?? ''
      const changed = who.current === undefined ? start.member !== null && start.member !== Boolean(now) : who.current !== now
      if (changed) {
        clearChat()
        setMessages([HELLO])
      }
      who.current = now
      setMember(Boolean(now))
    })
    check()
    const onChange = () => check()
    window.addEventListener('account-change', onChange)
    return () => {
      alive = false
      window.removeEventListener('account-change', onChange)
    }
  }, [start.member])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, open])

  // 첫 인사말은 빼고, 실패한 답과 [AI에게 물어보기] 버튼 상태는 남기지 않는다
  // 로그인 상태를 확인한 뒤에만 저장한다 (확인 전에 저장하면 앞사람 대화가 새 상태로 덮여 남는다)
  useEffect(() => { if (member !== null) saveChat(messages.slice(1), open, member) }, [messages, open, member])

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
        {messages.length > 1 && <button type="button" className="link" onClick={() => { setMessages([HELLO]); clearChat() }}>대화 지우기</button>}
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
