import { useEffect, useRef, useState } from 'react'

// 말로 상품 등록하기 (2026-11-21): 새 상품 등록 맨 위. 말하거나 적으면 품목·이름·가격·무게·당도·수확일·재고 칸을 채운다
//  - 무엇을 말할지 6가지를 순서대로 보여 주고, 채운 뒤에는 무엇이 빠졌는지 표시한다
//  - 마이크 (2026-11-28 바꿈): 마이크 허용을 먼저 받고, 녹음과 브라우저 음성 인식을 함께 돌린다
//    · 브라우저가 글로 바꿔 주면(휴대폰 크롬·삼성 인터넷 등) 그 글로 바로 칸을 채운다 (추가 비용 없음)
//    · 못 바꾸면(노트북 엣지·웨일, 학교 와이파이 등) [■ 다 말했어요] 때 녹음을 서버가 받아 적는다 (1분 약 0.5원)
//    · 듣는 동안 사용 중인 마이크 이름과 소리 막대를 보여 줘서 "듣고 있는지 모르겠다"를 막는다
//  - 채우기만 하고 저장하지 않는다. 이미 적힌 칸은 바꾸지 않는다. 가격은 꼭 다시 확인하게 한다
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
const EXAMPLE = '부사 사과 5키로 한 상자 3만 원이에요. 10키로는 5만5천 원. 당도는 14, 어제 땄어요. 20상자 있어요'
// 말해 주실 것: [이름, 예시, 서버가 채웠다고 알려 주는 칸 이름들]
const GUIDE = [
  ['무엇을 파세요?', '“부사 사과”', ['품목']],
  ['얼마나 들었나요?', '“5키로 한 상자”', ['판매 단위', '판매 옵션']],
  ['얼마예요?', '“3만 원” · 크기가 여러 개면 “10키로는 5만5천 원”', ['가격', '판매 옵션']],
  ['당도는요? (알면)', '“당도는 14”', ['당도']],
  ['언제 땄어요?', '“어제 땄어요” · “11월 18일 수확”', ['수확일']],
  ['몇 개 있어요?', '“20상자 있어요”', ['재고']],
]
const MAX_SECONDS = 60
const WINDOWS_MIC = '노트북이면 Windows [시작 → 설정 → 개인 정보 및 보안 → 마이크]에서 "마이크 액세스"와 "데스크톱 앱이 마이크에 액세스하도록 허용"을 켜 주세요.'
const NO_SOUND = '소리가 들리지 않았어요. 입 가까이에서 다시 눌러 말해 주세요. 말할 때 초록 막대가 안 움직이면 Windows [설정 → 시스템 → 소리 → 입력]에서 다른 마이크를 골라 주세요.'
// 마이크 허용을 받을 때 생기는 오류 (getUserMedia)
const MEDIA_ERRORS = {
  NotAllowedError: `마이크 허용이 꺼져 있어요. 주소창 왼쪽 자물쇠(또는 ⓘ)를 눌러 마이크를 "허용"으로 바꾼 뒤 다시 눌러 주세요. 허용인데도 이 글이 나오면: ${WINDOWS_MIC}`,
  SecurityError: '이 화면에서는 마이크를 쓸 수 없어요. 주소가 https:// 로 시작하는지 확인해 주세요.',
  NotFoundError: `이 컴퓨터에서 마이크를 찾지 못했어요. 이어폰 마이크나 USB 마이크를 꽂아 주세요. ${WINDOWS_MIC}`,
  NotReadableError: `마이크를 다른 프로그램(줌·카카오톡 통화·녹음기 등)이 쓰고 있거나 Windows에서 막혀 있어요. 그 프로그램을 끄고 다시 눌러 주세요. ${WINDOWS_MIC}`,
  AbortError: `마이크를 켜다가 멈췄어요. 다른 프로그램을 끄고 다시 눌러 주세요. ${WINDOWS_MIC}`,
}

/** 마이크 허용을 먼저 받는다. 허용 창이 떠 있는 동안은 기다린다 (시간 제한 없음) */
async function askMic() {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) }
  } catch (e) {
    return { error: MEDIA_ERRORS[e?.name] ?? `마이크를 켜지 못했어요. ${WINDOWS_MIC}` }
  }
}

/** 16kHz 모노 16비트 WAV 로 묶는다 (서버 받아쓰기용, 1분에 약 1.9MB) */
function toWav(chunks, length) {
  const view = new DataView(new ArrayBuffer(44 + length * 2))
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, length * 2, true)
  let at = 44
  for (const chunk of chunks) {
    for (const v of chunk) {
      const x = Math.max(-1, Math.min(1, v))
      view.setInt16(at, x < 0 ? x * 0x8000 : x * 0x7fff, true)
      at += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** 마이크 소리를 16kHz 로 모으면서 소리 크기(0~1)를 알려 준다. stop() → { wav, peak } */
function startCapture(stream, onLevel) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return { stop: () => ({ wav: null, peak: 0 }) }
  const ctx = new Ctx()
  ctx.resume?.().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0 // 스피커로 다시 내보내지 않는다 (울림 방지)
  const ratio = ctx.sampleRate / 16000
  const chunks = []
  let length = 0
  let peak = 0
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    let sum = 0
    for (const v of input) sum += v * v
    const level = Math.min(1, Math.sqrt(sum / input.length) * 4)
    peak = Math.max(peak, level)
    onLevel(level)
    if (length >= 16000 * (MAX_SECONDS + 5)) return
    // 16kHz 로 줄인다 (구간 평균 = 간단한 저역 필터)
    const out = new Float32Array(Math.floor(input.length / ratio))
    for (let i = 0; i < out.length; i += 1) {
      const from = Math.floor(i * ratio)
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio))
      let s = 0
      for (let j = from; j < to; j += 1) s += input[j] ?? 0
      out[i] = s / (to - from)
    }
    chunks.push(out)
    length += out.length
  }
  source.connect(node)
  node.connect(mute)
  mute.connect(ctx.destination)
  return {
    stop() {
      node.onaudioprocess = null
      source.disconnect()
      node.disconnect()
      ctx.close().catch(() => {})
      return { wav: length > 16000 * 0.5 ? toWav(chunks, length) : null, peak }
    },
  }
}

export function SpeakFill({ api, onFill }) {
  const [said, setSaid] = useState('')
  const [live, setLive] = useState('') // 아직 확정되지 않은 들리는 말 (회색)
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false) // 녹음을 서버가 받아 적는 중
  const [mic, setMic] = useState('off') // off | asking(허용 기다림) | on | hearing(소리가 들어옴)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [micName, setMicName] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rec = useRef(null)
  const heard = useRef('')
  const session = useRef(null) // { stream, capture, before, stopping, done }
  useEffect(() => () => {
    rec.current?.abort()
    const s = session.current
    if (s) { s.done = true; s.capture.stop(); s.stream.getTracks().forEach((t) => t.stop()) }
  }, [])
  useEffect(() => {
    if (mic === 'off' || mic === 'asking') return undefined
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [mic])

  async function fill(text = said) {
    if (text.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      const reply = await api('/ai/product-parse', { method: 'POST', body: { text }, timeoutMs: 45_000 })
      setResult(reply)
      onFill(reply.fields)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function startMic() {
    if (mic === 'asking' || !canRecord) return
    if (mic !== 'off') { finish(); return } // [■ 다 말했어요]
    setError('')
    setResult(null)
    // 1) 마이크 허용부터 받는다. 허용을 늦게 눌러도 그때부터 듣는다
    setMic('asking')
    const { stream, error: micError } = await askMic()
    if (micError) { setMic('off'); setError(micError); return }
    setMicName(stream.getAudioTracks()[0]?.label ?? '')

    // 2) 녹음을 시작한다 (브라우저가 글로 못 바꾸면 이 녹음을 서버가 받아 적는다)
    const before = said.trim() ? `${said.trim()} ` : ''
    heard.current = before
    const capture = startCapture(stream, (v) => {
      setLevel(v)
      if (v > 0.08) setMic((m) => (m === 'on' ? 'hearing' : m))
    })
    const s = { stream, capture, before, stopping: false, done: false }
    session.current = s
    setSeconds(0)
    setMic('on')
    setTimeout(() => { if (session.current === s) finish() }, MAX_SECONDS * 1000) // 1분이면 저절로 멈춘다

    // 3) 브라우저 음성 인식도 함께 돌린다. 되면 들은 말이 바로 보이고, 말을 멈추면 저절로 칸을 채운다
    if (!Recognition) return
    try {
      const r = new Recognition()
      r.lang = 'ko-KR'
      r.interimResults = true
      r.continuous = true
      r.onresult = (e) => {
        let done = ''
        let pending = ''
        for (const x of e.results) {
          if (x.isFinal) done += x[0].transcript
          else pending += x[0].transcript
        }
        heard.current = (before + done).trim()
        setSaid(heard.current)
        setLive(pending)
      }
      r.onerror = () => {} // 화면에 띄우지 않는다: 녹음을 서버가 받아 적으면 된다
      r.onend = () => {
        if (rec.current === r) rec.current = null
        const s = session.current
        if (!s || s.done) return
        // [다 말했어요]를 눌렀거나, 말을 멈춰 브라우저가 글을 다 줬으면 끝낸다. 글 없이 끝났으면(인식 실패) 녹음은 계속한다
        if (s.stopping || heard.current.trim() !== before.trim()) { s.stopping = true; complete() }
      }
      rec.current = r
      r.start()
    } catch {
      rec.current = null // 녹음으로 받아 적는다
    }
  }

  // [■ 다 말했어요]: 브라우저 인식이 남은 말을 마저 주도록 잠깐 기다린 뒤 끝낸다
  function finish() {
    const s = session.current
    if (!s || s.stopping) return
    s.stopping = true
    const r = rec.current
    if (r) { r.stop(); setTimeout(complete, 1500) } else complete()
  }

  async function complete() {
    const s = session.current
    if (!s || s.done) return
    s.done = true
    session.current = null
    rec.current?.abort()
    rec.current = null
    const { wav, peak } = s.capture.stop()
    s.stream.getTracks().forEach((t) => t.stop())
    setLevel(0)
    setLive('')
    setMic('off')
    const text = heard.current.trim()
    if (text && text !== s.before.trim()) { fill(text); return }
    if (!wav || peak < 0.05) { setError(NO_SOUND); return }
    // 브라우저가 글로 못 바꿨다 → 녹음을 서버가 받아 적고, 그 글로 칸을 채운다
    setBusy(true)
    setWriting(true)
    try {
      const reply = await api('/ai/product-transcribe', { method: 'POST', body: wav, timeoutMs: 45_000 })
      const all = `${s.before}${reply.text ?? ''}`.trim()
      setWriting(false)
      if (all.length < 2 || all === s.before.trim()) { setBusy(false); setError(NO_SOUND); return }
      setSaid(all)
      heard.current = all
      await fill(all)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    } finally {
      setWriting(false)
    }
  }

  const filled = new Set(result?.filled ?? [])
  const listening = mic === 'on' || mic === 'hearing'
  return (
    <div className="preview speak-fill">
      <strong>말로 상품 등록하기</strong>
      <p className="speak-lead">아래 순서대로 <b>한 번에 말해 주세요</b>. 다 말하면 칸이 저절로 채워져요. 채운 뒤 꼭 확인해 주세요 (저장은 직접 눌러요).</p>
      <ol className="speak-guide">
        {GUIDE.map(([q, ex, keys]) => {
          // 크기가 여러 개면 재고는 크기마다 나눠 적어야 해서 칸을 채우지 않는다 (말은 들었다고 알려 준다)
          const stockSplit = q === '몇 개 있어요?' && result?.fields.options && /\d+\s*(상자|박스|개|팩|봉)\s*(정도\s*)?(있|준비|남)/.test(said)
          const ok = result && (keys.some((k) => filled.has(k)) || stockSplit)
          return (
            <li key={q} className={result ? (ok ? 'ok' : 'miss') : ''}>
              <span className="q">{q}</span> <span className="ex">{ex}</span>
              {result && <span className="mark">{stockSplit ? '✓ 들었어요 (크기마다 나눠 적어 주세요)' : ok ? '✓ 들었어요' : '말 안 함'}</span>}
            </li>
          )
        })}
      </ol>
      <p className="speak-example">예: “{EXAMPLE}” <button type="button" className="link" onClick={() => { setSaid(EXAMPLE); setResult(null) }} disabled={mic !== 'off' || busy}>이 예시로 넣어 보기</button></p>

      {canRecord ? (
        <button type="button" className={`button mic-big${listening ? ' on' : ''}`} onClick={startMic} disabled={busy || mic === 'asking'} aria-pressed={listening}>
          {writing ? '녹음을 글로 바꾸는 중…' : mic === 'asking' ? '허용을 기다리는 중…' : listening ? '■ 다 말했어요' : '🎤 눌러서 말하기'}
        </button>
      ) : (
        <p className="warn">이 브라우저는 마이크를 쓸 수 없어요. 크롬·엣지·삼성 인터넷으로 열거나, 아래 칸에 글로 적어 주세요.</p>
      )}
      {mic === 'asking' && (
        <p className="warn" role="status">화면 위(주소창 근처)에 뜬 <b>“마이크 사용 허용”</b> 창에서 <b>허용</b>을 눌러 주세요. 누르면 바로 듣기 시작해요.</p>
      )}
      {listening && (
        <div className="listening" role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{mic === 'on' ? '듣고 있어요. 지금 말씀하세요' : '잘 들려요. 계속 말씀하세요'} · {seconds}초</span>
        </div>
      )}
      {listening && (
        <div className="mic-level">
          <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></span>
          <small>{micName ? `사용 중인 마이크: ${micName}` : '말하면 초록 막대가 움직여요'}{mic === 'on' && seconds >= 4 ? ' · 막대가 안 움직이면 다른 마이크를 골라 주세요 (Windows 설정 → 소리 → 입력)' : ''}</small>
        </div>
      )}
      {listening && (said || live
        ? <p className="heard">알아들은 말: {said} <span className="pending">{live}</span></p>
        : seconds >= 3 && <p className="heard">다 말했으면 <b>[■ 다 말했어요]</b>를 눌러 주세요. 그때 글로 바꿔서 칸을 채워 드려요.</p>)}

      <label className="speak-text">말로 하기가 어려우면 글로 적어도 돼요
        <textarea rows={3} value={said} onChange={(e) => setSaid(e.target.value)} maxLength={500} placeholder={`예: ${EXAMPLE}`} disabled={mic !== 'off' || writing} />
      </label>
      <div className="actions">
        <button type="button" className="button" onClick={() => fill()} disabled={busy || mic !== 'off' || said.trim().length < 2}>{busy && !writing ? '칸 채우는 중…' : '칸 채우기'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="speak-result">
          {result.filled.length > 0
            ? <p className="success">채운 칸: {result.filled.join(' · ')}</p>
            : <p className="warn">채울 내용을 찾지 못했어요. 위 순서대로 “무엇을 · 얼마나 · 얼마에” 파는지 다시 말해 주세요.</p>}
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
