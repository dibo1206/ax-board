import { useEffect, useState } from 'react'

// 상품 입력 화면의 [AI로 채우기]: 기본 정보만 넣고 누르면 소개·상세 설명·상세 블록·자주 묻는 질문 초안을 채운다
// 상세 블록은 패턴의 섹션마다 글 블록 + "이런 사진을 넣어 주세요" 사진 자리 (사진은 판매자가 직접 고른다)
// 상세페이지 패턴(이야기형·정보형·선물형·카페·업소형)을 고르면 그 순서로 쓴다. 초안은 읽고 고친 뒤 저장해야 공개된다
export function AiDraft({ form, api, onDraft }) {
  const [templates, setTemplates] = useState([])
  const [template, setTemplate] = useState('story')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/ai/templates').then(setTemplates).catch(() => setTemplates([]))
  }, [api])

  async function run() {
    setBusy(true)
    setError('')
    try {
      // 무료 모델이 붐비면 여러 모델을 차례로 시도해서 1~2분 걸릴 수 있다 → 3분까지 기다린다
      const draft = await api('/ai/product-draft', { method: 'POST', body: { ...form, template, memo }, timeoutMs: 180_000 })
      setResult(draft)
      onDraft(draft)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const picked = templates.find((t) => t.key === template)
  return (
    <div className="preview ai-draft">
      <strong>AI로 상세 내용 채우기</strong>
      <p className="muted">품목·상품 이름·판매 단위·가격만 넣고 누르면 한 줄 소개, 상세 설명, <b>상세 블록(글 + 사진 자리)</b>, 자주 묻는 질문 초안을 채워요. 사진 자리에는 어떤 사진을 찍으면 좋을지 적어 줘요. 상품당 한 번만 AI를 부르고, 같은 내용으로 다시 누르면 저장된 초안을 써요.</p>
      <div className="row">
        <label>상세페이지 패턴
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <label>강조하고 싶은 점 (선택)<input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder="예: 황토밭에서 키워 단맛이 진해요" /></label>
      </div>
      {picked && <p className="muted">{picked.desc} — 순서: {picked.sections.join(' → ')}</p>}
      <button type="button" className="button" onClick={run} disabled={busy || !form.item_code || !form.name}>
        {busy ? 'AI가 쓰는 중… (최대 1~2분)' : 'AI로 채우기'}
      </button>
      {!form.item_code || !form.name ? <span className="muted"> 품목과 상품 이름을 먼저 넣어 주세요</span> : null}
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="success">
          초안을 채웠어요{result.aiCalls === 0 ? ' (저장된 초안 · AI 0회)' : ' (AI 1회)'}. 아래 내용을 읽고 고친 뒤 저장해 주세요.
          {result.blocks?.length > 0 && <> 상세 블록: 글 {result.blocks.filter((b) => b.type === 'text').length}개 · 사진 자리 {result.blocks.filter((b) => b.type === 'photo').length}개 (사진 자리마다 사진을 골라 주세요).</>}
          {result.flagged?.length > 0 && <span className="warn"> 금지어·자료에 없는 숫자가 있어 뺀 문장 {result.flagged.length}개</span>}
        </p>
      )}
    </div>
  )
}
