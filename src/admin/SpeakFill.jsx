import { useEffect, useRef, useState } from 'react'

// 말로 상품 등록하기 (2026-11-21): 새 상품 등록 맨 위. 말하거나 적으면 품목·이름·가격·무게·당도·수확일·재고 칸을 채운다
//  - 무엇을 말할지 6가지를 순서대로 보여 주고, 채운 뒤에는 무엇이 빠졌는지 표시한다
//  - 마이크: 브라우저 음성 입력(크롬·삼성 인터넷·사파리, 추가 비용 없음). 듣는 동안 빨간 표시와 들은 말을 바로 보여 주고,
//    [■ 다 말했어요]를 누르거나 말을 멈추면 알아들은 말로 바로 칸을 채운다. 안 되는 브라우저면 글로 적게 안내한다
//  - 채우기만 하고 저장하지 않는다. 이미 적힌 칸은 바꾸지 않는다. 가격은 꼭 다시 확인하게 한다
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
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
const WINDOWS_MIC = '노트북이면 Windows [시작 → 설정 → 개인 정보 및 보안 → 마이크]에서 "마이크 액세스"와 "데스크톱 앱이 마이크에 액세스하도록 허용"을 켜 주세요.'
const ERRORS = {
  'not-allowed': '마이크를 쓸 수 없게 막혀 있어요. 주소창 왼쪽 자물쇠(또는 ⓘ)를 눌러 마이크를 "허용"으로 바꾼 뒤 다시 눌러 주세요.',
  'service-not-allowed': '이 화면에서는 마이크를 쓸 수 없어요. 크롬이나 삼성 인터넷으로 열어 주세요.',
  'no-speech': '소리가 들리지 않았어요. 입 가까이에서 다시 눌러 말해 주세요. 노트북이면 말할 때 초록 막대가 움직이는지 보세요. 안 움직이면 Windows [설정 → 시스템 → 소리 → 입력]에서 다른 마이크를 골라 주세요.',
  'audio-capture': `마이크를 찾지 못했어요. 이어폰·마이크가 연결돼 있는지 확인해 주세요. ${WINDOWS_MIC}`,
  network: '말로 하기는 인터넷이 연결돼 있어야 해요. 학교·회사 와이파이는 음성 인식이 막혀 있을 수 있어요. 휴대폰 데이터로 연결하거나 글로 적어 주세요.',
}
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
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }) }
  } catch (e) {
    return { error: MEDIA_ERRORS[e?.name] ?? `마이크를 켜지 못했어요. ${WINDOWS_MIC}` }
  }
}

/** 소리 크기(0~1)를 0.1초마다 알려 준다. 노트북에서 마이크에 소리가 들어오는지 눈으로 보게 */
function watchLevel(stream, onLevel) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx || !stream) return () => {}
  const ctx = new Ctx()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
  }, 100)
  return () => { clearInterval(timer); ctx.close().catch(() => {}) }
}

export function SpeakFill({ api, onFill }) {
  const [said, setSaid] = useState('')
  const [live, setLive] = useState('') // 아직 확정되지 않은 들리는 말 (회색)
  const [busy, setBusy] = useState(false)
  const [mic, setMic] = useState('off') // off | asking(허용 기다림) | starting | on | hearing
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [micName, setMicName] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rec = useRef(null)
  const heard = useRef('')
  const started = useRef(false)
  const release = useRef(() => {}) // 마이크 스트림·소리 막대 정리
  useEffect(() => () => { rec.current?.abort(); release.current() }, [])
  useEffect(() => {
    if (mic === 'off' || mic === 'asking') return undefined
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [mic])
  useEffect(() => { if (seconds >= 60) rec.current?.stop() }, [seconds]) // 1분이면 저절로 멈춘다

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
    if (!Recognition) return
    if (mic === 'asking') return
    if (mic !== 'off') { rec.current?.stop(); return } // [■ 다 말했어요]
    setError('')
    setResult(null)
    // 1) 마이크 허용부터 받는다. 예전에는 듣기를 먼저 시작해서, 허용 창을 5초 넘게 두면 허용을 눌러도 이미 멈춰 있었다 (노트북)
    setMic('asking')
    const { stream, error: micError } = await askMic()
    if (micError) { setMic('off'); setError(micError); return }
    setMicName(stream?.getAudioTracks()[0]?.label ?? '')
    const stopLevel = watchLevel(stream, setLevel)
    release.current = () => { stopLevel(); stream?.getTracks().forEach((t) => t.stop()); setLevel(0); release.current = () => {} }

    // 2) 허용을 받은 뒤 듣기 시작
    const r = new Recognition()
    r.lang = 'ko-KR'
    r.interimResults = true
    r.continuous = true // 잠깐 쉬어도 끊지 않고 [다 말했어요]를 누를 때까지 듣는다
    const before = said.trim() ? `${said.trim()} ` : ''
    heard.current = before
    r.onstart = () => { started.current = true; setMic('on') }
    r.onspeechstart = () => setMic('hearing')
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
    r.onerror = (e) => { if (e.error !== 'aborted') setError(ERRORS[e.error] ?? '잘 못 들었어요. 다시 눌러 말하거나 글로 적어 주세요.') }
    r.onend = () => {
      release.current()
      setMic('off')
      setLive('')
      // 들은 말이 있으면 바로 칸을 채운다 (한 번 더 누를 필요 없게)
      if (heard.current.trim() && heard.current.trim() !== before.trim()) fill(heard.current)
    }
    rec.current = r
    setSeconds(0)
    setMic('starting')
    started.current = false
    try {
      r.start()
      // 허용은 이미 받았으니 8초 안에 음성 인식이 안 켜지면 브라우저·네트워크 문제다. 멈추고 이유를 알려 준다
      setTimeout(() => {
        if (started.current || rec.current !== r) return
        r.abort()
        release.current()
        setMic('off')
        setError('음성 인식이 켜지지 않았어요. 크롬이나 엣지 최신 버전에서 다시 눌러 주세요. 학교·회사 와이파이라면 휴대폰 데이터로 바꿔 보거나 아래 칸에 글로 적어 주세요.')
      }, 8000)
    } catch {
      release.current()
      setMic('off')
      setError('마이크를 켜지 못했어요. 잠시 뒤 다시 눌러 주세요.')
    }
  }

  const filled = new Set(result?.filled ?? [])
  const listening = mic !== 'off'
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
      <p className="speak-example">예: “{EXAMPLE}” <button type="button" className="link" onClick={() => { setSaid(EXAMPLE); setResult(null) }} disabled={listening || busy}>이 예시로 넣어 보기</button></p>

      {Recognition ? (
        <button type="button" className={`button mic-big${listening ? ' on' : ''}`} onClick={startMic} disabled={busy || mic === 'asking'} aria-pressed={listening}>
          {mic === 'asking' ? '허용을 기다리는 중…' : listening ? '■ 다 말했어요' : '🎤 눌러서 말하기'}
        </button>
      ) : (
        <p className="warn">이 브라우저는 말로 하기를 지원하지 않아요. 크롬이나 엣지(노트북), 크롬이나 삼성 인터넷(휴대폰)으로 열거나, 아래 칸에 글로 적어 주세요.</p>
      )}
      {mic === 'asking' && (
        <p className="warn" role="status">화면 위(주소창 근처)에 뜬 <b>“마이크 사용 허용”</b> 창에서 <b>허용</b>을 눌러 주세요. 누르면 바로 듣기 시작해요.</p>
      )}
      {listening && mic !== 'asking' && (
        <div className="listening" role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{mic === 'starting' ? '마이크를 켜는 중…' : mic === 'on' ? '듣고 있어요. 지금 말씀하세요' : '잘 들려요. 계속 말씀하세요'} · {seconds}초</span>
        </div>
      )}
      {listening && mic !== 'asking' && (
        <div className="mic-level">
          <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></span>
          <small>{micName ? `사용 중인 마이크: ${micName}` : '말하면 초록 막대가 움직여요'}{level < 0.03 && seconds >= 4 ? ' · 막대가 안 움직이면 다른 마이크를 골라 주세요 (Windows 설정 → 소리 → 입력)' : ''}</small>
        </div>
      )}
      {listening && (said || live) && <p className="heard">알아들은 말: {said} <span className="pending">{live}</span></p>}

      <label className="speak-text">말로 하기가 어려우면 글로 적어도 돼요
        <textarea rows={3} value={said} onChange={(e) => setSaid(e.target.value)} maxLength={500} placeholder={`예: ${EXAMPLE}`} disabled={listening} />
      </label>
      <div className="actions">
        <button type="button" className="button" onClick={() => fill()} disabled={busy || listening || said.trim().length < 2}>{busy ? '칸 채우는 중…' : '칸 채우기'}</button>
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
