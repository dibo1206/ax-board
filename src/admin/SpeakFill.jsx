import { useEffect, useRef, useState } from 'react'

// 말로 상품 등록하기 (2026-11-21): 새 상품 등록 맨 위. 말하듯 적거나 마이크로 말하면 품목·이름·가격·무게·당도·수확일 칸을 채운다
//  - 마이크는 브라우저 음성 입력(크롬·사파리·삼성 인터넷)이라 추가 비용이 없다. 안 되는 브라우저면 버튼을 숨기고 글로 적는다
//  - 채우기만 하고 저장하지 않는다. 이미 적힌 칸은 바꾸지 않는다. 가격은 꼭 다시 확인하게 한다
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export function SpeakFill({ api, onFill }) {
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rec = useRef(null)
  useEffect(() => () => rec.current?.abort(), [])

  function listen() {
    if (!Recognition) return
    if (listening) { rec.current?.stop(); return }
    const r = new Recognition()
    r.lang = 'ko-KR'
    r.interimResults = true
    r.continuous = false
    const before = said ? `${said} ` : ''
    r.onresult = (e) => setSaid(before + [...e.results].map((x) => x[0].transcript).join(''))
    r.onerror = (e) => setError(e.error === 'not-allowed' ? '마이크 사용을 허락해 주세요. (주소창 왼쪽 자물쇠 → 마이크 허용)' : '잘 못 들었어요. 다시 말하거나 글로 적어 주세요.')
    r.onend = () => setListening(false)
    rec.current = r
    setError('')
    setListening(true)
    r.start()
  }

  async function fill() {
    setBusy(true)
    setError('')
    try {
      const reply = await api('/ai/product-parse', { method: 'POST', body: { text: said }, timeoutMs: 45_000 })
      setResult(reply)
      onFill(reply.fields)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="preview speak-fill">
      <strong>말로 상품 등록하기</strong>
      <p className="muted">파실 상품을 말하듯 적거나 🎤를 눌러 말해 주세요. 품목 · 상품 이름 · 가격 · 무게 · 당도 · 수확일 칸을 채워 드려요. 채운 뒤 꼭 확인해 주세요 (저장은 직접 눌러야 해요).</p>
      <textarea rows={3} value={said} onChange={(e) => setSaid(e.target.value)} maxLength={500}
        placeholder="예: 부사 사과 5키로 한 상자 3만 원, 10키로는 5만5천 원이에요. 당도 14, 어제 땄어요. 20상자 있어요" />
      <div className="actions">
        {Recognition && (
          <button type="button" className={`button ghost mic${listening ? ' on' : ''}`} onClick={listen} disabled={busy} aria-pressed={listening}>
            {listening ? '■ 그만 듣기' : '🎤 말로 하기'}
          </button>
        )}
        <button type="button" className="button" onClick={fill} disabled={busy || said.trim().length < 2}>{busy ? '칸 채우는 중…' : '칸 채우기'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="speak-result">
          {result.filled.length > 0
            ? <p className="success">채운 칸: {result.filled.join(' · ')}{result.aiCalls ? ' (AI 1회)' : ' (AI 없이)'}</p>
            : <p className="warn">채울 내용을 찾지 못했어요. 품목 이름과 가격을 넣어 다시 말해 주세요.</p>}
          {result.missing.length > 0 && <p className="warn">직접 적어 주세요: {result.missing.join(' · ')}</p>}
          {(result.fields.price || result.fields.options) && (
            <p className="warn">가격이 맞는지 꼭 확인해 주세요: {result.fields.options
              ? result.fields.options.map((o) => `${o.name} ${Number(o.price).toLocaleString('ko-KR')}원`).join(' / ')
              : `${Number(result.fields.price).toLocaleString('ko-KR')}원`}</p>
          )}
        </div>
      )}
    </div>
  )
}
