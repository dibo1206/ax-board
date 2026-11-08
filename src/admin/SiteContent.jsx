import { useEffect, useState } from 'react'
import { ABOUT, DEFAULTS, FAQ, HERO, SEASON, STORY } from '../shop/home/content.js'
import { adminApi } from './api.js'
import { Help } from './ui.jsx'

// 관리자 [홈페이지 관리]: 첫 화면의 큰 배너·이야기 배너·제철 달력·자주 묻는 질문과 회사 소개(/about)를 고친다 (server/siteContent.js).
// 저장하면 손님 화면에 바로(최대 30초) 나오고, [기본값으로]를 누르면 코드에 적힌 처음 내용으로 돌아간다
const SECTIONS = [['hero', '큰 배너'], ['story', '이야기 배너'], ['season', '제철 달력'], ['faq', '자주 묻는 질문'], ['about', '회사 소개']]
const LIVE = { hero: HERO, story: STORY, season: SEASON, faq: FAQ, about: ABOUT }
const clone = (v) => JSON.parse(JSON.stringify(v))
const POSITIONS = [['center 50%', '가운데'], ['center 30%', '위쪽'], ['center 70%', '아래쪽'], ['left center', '왼쪽'], ['right center', '오른쪽']]

// 고칠 수 있는 칸만 골라 편집용 사본을 만든다
function editable(key, v) {
  const c = clone(v)
  if (key === 'hero') return { eyebrow: c.eyebrow ?? '', title: c.title ?? [''], lead: c.lead ?? '', cta: c.cta ?? '', interval: c.interval ?? 5000, slides: (c.slides ?? []).map(({ src, alt, position, cover, scrim }) => ({ src, alt, position: position ?? 'center 50%', cover: !!cover, scrim: !!scrim })) }
  if (key === 'story') return { label: c.label ?? '', interval: c.interval ?? 7000, slides: (c.slides ?? []).map((s) => ({ title: s.title ?? ['', ''], text: s.text ?? '', photo: { src: s.photo?.src ?? '', alt: s.photo?.alt ?? '', position: s.photo?.position ?? 'center 50%' }, links: s.links ?? [] })) }
  if (key === 'about') {
    const pic = (p) => ({ src: p?.src ?? '', alt: p?.alt ?? '', position: 'center 50%' })
    const pairs = (arr) => (arr ?? []).map(({ title, text }) => ({ title: title ?? '', text: text ?? '' }))
    const lf = c.localfood ?? {}
    return {
      name: c.name ?? '', eyebrow: c.eyebrow ?? '', lead: c.lead ?? '', heroImage: pic(c.heroImage), promises: pairs(c.promises),
      valuesEyebrow: c.valuesEyebrow ?? '', valuesTitle: c.valuesTitle ?? '', values: pairs(c.values),
      localfood: { title: lf.title ?? '', keywordsTitle: lf.keywordsTitle ?? '', lead: lf.lead ?? '', image: pic(lf.image), qa: (lf.qa ?? []).map(({ q, a }) => ({ q, a })), keywords: pairs(lf.keywords) },
      productsTitle: c.productsTitle ?? '', products: (c.products ?? []).map(({ title, text, image, href }) => ({ title, text, image, href })), note: c.note ?? '',
    }
  }
  if (key === 'season') return { items: (c.items ?? []).map((i) => ({ name: i.name, search: i.search ?? '', months: i.months ?? [] })), note: c.note ?? '' }
  return { lead: c.lead ?? '', items: (c.items ?? []).map(({ tag, q, a, action }) => ({ tag, q, a, action })), note: c.note ?? '' }
}

// 목록 줄 하나의 위·아래·빼기 버튼
function RowTools({ index, count, onMove, onRemove }) {
  return (
    <span className="site-row-tools">
      <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="위로">↑</button>
      <button type="button" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="아래로">↓</button>
      <button type="button" onClick={() => onRemove(index)}>빼기</button>
    </span>
  )
}

// 제목·글 짝 목록 (회사 소개의 약속·핵심 가치·키워드, 로컬푸드 질문·답)
function PairList({ rows, onChange, max, name, keys = ['title', 'text'], labels = ['제목', '글'], limits = [40, 300] }) {
  const set = (i, v) => onChange(rows.map((x, j) => (j === i ? v : x)))
  const move = (i, dir) => { const a = [...rows]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; onChange(a) }
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="site-row">
          <p className="site-row-head"><b>{name} {i + 1}</b><RowTools index={i} count={rows.length} onMove={move} onRemove={(n) => onChange(rows.filter((_, j) => j !== n))} /></p>
          <label>{labels[0]}<input value={r[keys[0]]} maxLength={limits[0]} onChange={(e) => set(i, { ...r, [keys[0]]: e.target.value })} /></label>
          <label>{labels[1]}<textarea value={r[keys[1]]} rows={2} maxLength={limits[1]} onChange={(e) => set(i, { ...r, [keys[1]]: e.target.value })} /></label>
        </div>
      ))}
      {rows.length < max && <button type="button" className="button ghost" onClick={() => onChange([...rows, { [keys[0]]: '', [keys[1]]: '' }])}>{name} 더하기</button>}
    </>
  )
}

function PhotoField({ value, onChange, label, alt = true, position = true }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const { url } = await adminApi('/site-content/image', { method: 'POST', body: file, headers: { 'Content-Type': file.type } })
      onChange({ ...value, src: url })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="site-photo">
      {value.src ? <img src={value.src} alt="" /> : <span className="site-photo-empty">사진 없음</span>}
      <div className="site-photo-fields">
        <label>{label} 사진<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} /></label>
        {busy && <span className="muted">올리는 중…</span>}
        {error && <span className="error">{error}</span>}
        {alt && <label>사진 설명 <span className="muted">(화면 낭독기가 읽어요)</span><input value={value.alt} onChange={(e) => onChange({ ...value, alt: e.target.value })} maxLength={100} /></label>}
        {position && <label>화면이 좁을 때 남길 쪽<select value={value.position} onChange={(e) => onChange({ ...value, position: e.target.value })}>
          {POSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>}
      </div>
    </div>
  )
}

export function SiteContent() {
  const [section, setSection] = useState(() => {
    const k = new URLSearchParams(window.location.search).get('part')
    return SECTIONS.some(([key]) => key === k) ? k : 'hero'
  })
  const [info, setInfo] = useState({})
  const [draft, setDraft] = useState(() => editable(section, LIVE[section]))
  const [errors, setErrors] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { adminApi('/site-content').then(setInfo).catch((e) => setErrors([e.message])) }, [])

  const open = (key) => { setSection(key); setDraft(editable(key, LIVE[key])); setErrors([]); setMessage('') }
  const put = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const listOps = (field) => ({
    set: (i, v) => setDraft((d) => ({ ...d, [field]: d[field].map((x, j) => (j === i ? v : x)) })),
    move: (i, dir) => setDraft((d) => { const a = [...d[field]]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; return { ...d, [field]: a } }),
    remove: (i) => setDraft((d) => ({ ...d, [field]: d[field].filter((_, j) => j !== i) })),
    add: (v) => setDraft((d) => ({ ...d, [field]: [...d[field], v] })),
  })

  async function save() {
    setBusy(true)
    setErrors([])
    setMessage('')
    try {
      const row = await adminApi(`/site-content/${section}`, { method: 'PUT', body: draft })
      Object.assign(LIVE[section], row.value)
      setInfo((i) => ({ ...i, [section]: row }))
      setDraft(editable(section, row.value))
      setMessage('저장했어요. 손님 화면에는 30초 안에 바뀌어요.')
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('이 칸을 처음(코드에 적힌) 내용으로 되돌릴까요? 저장한 내용은 지워져요.')) return
    try {
      await adminApi(`/site-content/${section}`, { method: 'DELETE' })
      Object.assign(LIVE[section], clone(DEFAULTS[section]))
      setInfo((i) => { const n = { ...i }; delete n[section]; return n })
      setDraft(editable(section, DEFAULTS[section]))
      setMessage('처음 내용으로 되돌렸어요.')
    } catch (e) {
      setErrors([e.message])
    }
  }

  const saved = info[section]
  const slides = listOps('slides')
  const items = listOps('items')
  return (
    <section className="site-editor">
      {/* 제목은 위쪽 큰 메뉴 머리(홈페이지 › 홈페이지 관리)가 보여 주니 여기서는 빼고, 설명은 [?] 안에 */}
      <div className="site-top">
        <p className="muted">첫 화면과 회사 소개의 글·사진 <Help label="홈페이지 관리 도움말">첫 화면과 회사 소개(/about)의 글과 사진을 고쳐요. 공지·언론보도는 [공지·언론], 상품은 [상품 관리], 품목 레시피는 [품목 검수]에서 고쳐요.</Help></p>
        <a className="button ghost" href="/" target="_blank" rel="noreferrer">홈페이지 보기 ↗</a>
      </div>
      <nav className="tabs">
        {SECTIONS.map(([key, label]) => (
          <button key={key} type="button" className={key === section ? 'on' : ''} onClick={() => open(key)}>{label}{info[key] && ' · 고침'}</button>
        ))}
      </nav>
      <p className="muted">{saved ? `마지막 저장: ${new Date(saved.updated_at).toLocaleString('ko-KR')} · ${saved.updated_by}` : '지금은 처음(코드에 적힌) 내용이에요.'}</p>

      <div className="box form">
        {section === 'hero' && (
          <>
            <label>작은 제목<input value={draft.eyebrow} onChange={(e) => put({ eyebrow: e.target.value })} maxLength={60} /></label>
            {[0, 1, 2].map((i) => (
              <label key={i}>큰 제목 {i + 1}줄{i === 0 && <em className="req">*</em>}<input value={draft.title[i] ?? ''} maxLength={20}
                onChange={(e) => { const t = [...draft.title]; t[i] = e.target.value; put({ title: t }) }} /></label>
            ))}
            <label>소개 글<em className="req">*</em><textarea value={draft.lead} onChange={(e) => put({ lead: e.target.value })} rows={2} maxLength={200} /></label>
            <label>버튼 글<em className="req">*</em><input value={draft.cta} onChange={(e) => put({ cta: e.target.value })} maxLength={30} /></label>
            <label>사진 넘어가는 간격(초)<input type="number" min={3} max={15} value={Math.round(draft.interval / 1000)} onChange={(e) => put({ interval: Number(e.target.value) * 1000 })} /></label>
            <h3>배너 사진 <span className="muted">가로로 긴 사진(2400×720 정도), 왼쪽 40%는 글씨 자리</span></h3>
            {draft.slides.map((s, i) => (
              <div key={i} className="site-row">
                <p className="site-row-head"><b>사진 {i + 1}</b><RowTools index={i} count={draft.slides.length} onMove={slides.move} onRemove={slides.remove} /></p>
                <PhotoField label={`배너 ${i + 1}`} value={s} onChange={(v) => slides.set(i, { ...s, ...v })} />
                <label className="check"><input type="checkbox" checked={s.cover} onChange={(e) => slides.set(i, { ...s, cover: e.target.checked })} />배너를 꽉 채우기 (위아래를 잘라 크게)</label>
                <label className="check"><input type="checkbox" checked={s.scrim} onChange={(e) => slides.set(i, { ...s, scrim: e.target.checked })} />글씨가 잘 보이게 왼쪽을 옅게 덮기</label>
              </div>
            ))}
            {draft.slides.length < 8 && <button type="button" className="button ghost" onClick={() => slides.add({ src: '', alt: '', position: 'center 50%', cover: false, scrim: false })}>사진 더하기</button>}
          </>
        )}

        {section === 'story' && (
          <>
            <label>칸 이름<input value={draft.label} onChange={(e) => put({ label: e.target.value })} maxLength={20} /></label>
            <label>넘어가는 간격(초)<input type="number" min={3} max={15} value={Math.round(draft.interval / 1000)} onChange={(e) => put({ interval: Number(e.target.value) * 1000 })} /></label>
            {draft.slides.map((s, i) => (
              <div key={i} className="site-row">
                <p className="site-row-head"><b>이야기 {i + 1}</b><RowTools index={i} count={draft.slides.length} onMove={slides.move} onRemove={slides.remove} /></p>
                {[0, 1].map((j) => (
                  <label key={j}>제목 {j + 1}줄<input value={s.title[j] ?? ''} maxLength={20} onChange={(e) => { const t = [...s.title]; t[j] = e.target.value; slides.set(i, { ...s, title: t }) }} /></label>
                ))}
                <label>글<textarea value={s.text} rows={3} maxLength={300} onChange={(e) => slides.set(i, { ...s, text: e.target.value })} /></label>
                <PhotoField label={`이야기 ${i + 1}`} value={s.photo} onChange={(v) => slides.set(i, { ...s, photo: v })} />
                {[0, 1].map((j) => (
                  <div key={j} className="row">
                    <label>버튼 {j + 1} 글<input value={s.links[j]?.label ?? ''} maxLength={20} onChange={(e) => { const l = [...s.links]; l[j] = { href: l[j]?.href ?? '', label: e.target.value }; slides.set(i, { ...s, links: l.filter((x) => x && (x.label || x.href)) }) }} /></label>
                    <label>주소 <span className="muted">#products · /about · https://…</span><input value={s.links[j]?.href ?? ''} onChange={(e) => { const l = [...s.links]; l[j] = { label: l[j]?.label ?? '', href: e.target.value }; slides.set(i, { ...s, links: l.filter((x) => x && (x.label || x.href)) }) }} /></label>
                  </div>
                ))}
              </div>
            ))}
            {draft.slides.length < 5 && <button type="button" className="button ghost" onClick={() => slides.add({ title: ['', ''], text: '', photo: { src: '', alt: '', position: 'center 50%' }, links: [] })}>이야기 더하기</button>}
          </>
        )}

        {section === 'season' && (
          <>
            <p className="muted">달을 누르면 그 달에 제철인 품목이 카드로 나와요. 사진·가격은 그 이름으로 찾은 판매 중 상품에서 가져와요.</p>
            {draft.items.map((it, i) => (
              <div key={i} className="site-row">
                <p className="site-row-head"><b>{it.name || `품목 ${i + 1}`}</b><RowTools index={i} count={draft.items.length} onMove={items.move} onRemove={items.remove} /></p>
                <div className="row">
                  <label>이름<input value={it.name} maxLength={12} onChange={(e) => items.set(i, { ...it, name: e.target.value })} /></label>
                  <label>찾을 말 <span className="muted">(이름과 다를 때만)</span><input value={it.search} maxLength={20} onChange={(e) => items.set(i, { ...it, search: e.target.value })} /></label>
                </div>
                <div className="site-months" role="group" aria-label="제철 달">
                  {Array.from({ length: 12 }, (_, m) => m + 1).map((m) => (
                    <label key={m} className={it.months.includes(m) ? 'on' : ''}>
                      <input type="checkbox" checked={it.months.includes(m)} onChange={(e) => items.set(i, { ...it, months: e.target.checked ? [...it.months, m].sort((a, b) => a - b) : it.months.filter((x) => x !== m) })} />{m}월
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="button ghost" onClick={() => items.add({ name: '', search: '', months: [] })}>품목 더하기</button>
            <label>아래 안내<input value={draft.note} onChange={(e) => put({ note: e.target.value })} maxLength={200} /></label>
          </>
        )}

        {section === 'faq' && (
          <>
            <label>위쪽 안내<input value={draft.lead} onChange={(e) => put({ lead: e.target.value })} maxLength={200} /></label>
            <p className="muted">질문과 답을 고쳐요 <Help label="자동으로 바뀌는 말">답에 {'{출고}'} · {'{배송비}'} · {'{무료배송}'} · {'{전화}'} · {'{업무시간}'}을 적으면 [쇼핑몰 설정] 값으로 바뀌어요.</Help></p>
            {draft.items.map((it, i) => (
              <div key={i} className="site-row">
                <p className="site-row-head"><b>질문 {i + 1}</b><RowTools index={i} count={draft.items.length} onMove={items.move} onRemove={items.remove} /></p>
                <label>질문<input value={it.q} maxLength={100} onChange={(e) => items.set(i, { ...it, q: e.target.value })} /></label>
                <label>답<textarea value={it.a} rows={3} maxLength={600} onChange={(e) => items.set(i, { ...it, a: e.target.value })} /></label>
              </div>
            ))}
            {draft.items.length < 20 && <button type="button" className="button ghost" onClick={() => items.add({ q: '', a: '' })}>질문 더하기</button>}
            <label>아래 안내<input value={draft.note} onChange={(e) => put({ note: e.target.value })} maxLength={200} /></label>
          </>
        )}

        {section === 'about' && (
          <>
            <p className="muted">회사 소개 화면(<a href="/about" target="_blank" rel="noreferrer">/about ↗</a>)의 글과 사진이에요 <Help label="회사 소개 도움말">오시는 길(주소·전화·이메일)은 사업자 정보와 같은 값이라 [쇼핑몰 설정]에서 고쳐요. 제목에 {'{개수}'}를 쓰면 목록 개수로 바뀌어요.</Help></p>
            <h3>맨 위</h3>
            <label>작은 제목<input value={draft.eyebrow} onChange={(e) => put({ eyebrow: e.target.value })} maxLength={60} /></label>
            <label>회사 이름<em className="req">*</em><input value={draft.name} onChange={(e) => put({ name: e.target.value })} maxLength={40} /></label>
            <label>소개 글<em className="req">*</em><textarea value={draft.lead} onChange={(e) => put({ lead: e.target.value })} rows={2} maxLength={400} /></label>
            <PhotoField label="맨 위" value={draft.heroImage} onChange={(v) => put({ heroImage: v })} position={false} />
            <h3>회사소개 (약속)</h3>
            <PairList rows={draft.promises} onChange={(v) => put({ promises: v })} max={4} name="약속" limits={[40, 500]} />
            <h3>핵심 가치</h3>
            <div className="row">
              <label>작은 제목<input value={draft.valuesEyebrow} onChange={(e) => put({ valuesEyebrow: e.target.value })} maxLength={40} /></label>
              <label>제목<em className="req">*</em><input value={draft.valuesTitle} onChange={(e) => put({ valuesTitle: e.target.value })} maxLength={60} /></label>
            </div>
            <PairList rows={draft.values} onChange={(v) => put({ values: v })} max={12} name="가치" limits={[30, 300]} />
            <h3>로컬푸드</h3>
            <label>제목<em className="req">*</em><input value={draft.localfood.title} onChange={(e) => put({ localfood: { ...draft.localfood, title: e.target.value } })} maxLength={60} /></label>
            <label>소개 글<textarea value={draft.localfood.lead} rows={2} maxLength={300} onChange={(e) => put({ localfood: { ...draft.localfood, lead: e.target.value } })} /></label>
            <PhotoField label="로컬푸드" value={draft.localfood.image} onChange={(v) => put({ localfood: { ...draft.localfood, image: v } })} position={false} />
            <PairList rows={draft.localfood.qa} onChange={(v) => put({ localfood: { ...draft.localfood, qa: v } })} max={6} name="질문" keys={['q', 'a']} labels={['질문', '답']} limits={[60, 600]} />
            <label>키워드 제목<em className="req">*</em><input value={draft.localfood.keywordsTitle} onChange={(e) => put({ localfood: { ...draft.localfood, keywordsTitle: e.target.value } })} maxLength={60} /></label>
            <PairList rows={draft.localfood.keywords} onChange={(v) => put({ localfood: { ...draft.localfood, keywords: v } })} max={8} name="키워드" limits={[30, 300]} />
            <h3>만드는 것</h3>
            <label>제목<em className="req">*</em><input value={draft.productsTitle} onChange={(e) => put({ productsTitle: e.target.value })} maxLength={40} /></label>
            {draft.products.map((p, i) => {
              const setP = (v) => put({ products: draft.products.map((x, j) => (j === i ? v : x)) })
              const move = (n, dir) => { const a = [...draft.products]; [a[n], a[n + dir]] = [a[n + dir], a[n]]; put({ products: a }) }
              return (
                <div key={i} className="site-row">
                  <p className="site-row-head"><b>{p.title || `만드는 것 ${i + 1}`}</b><RowTools index={i} count={draft.products.length} onMove={move} onRemove={(n) => put({ products: draft.products.filter((_, j) => j !== n) })} /></p>
                  <div className="row">
                    <label>이름<input value={p.title} maxLength={40} onChange={(e) => setP({ ...p, title: e.target.value })} /></label>
                    <label>누르면 갈 주소 <span className="muted">/products?cat=base</span><input value={p.href} onChange={(e) => setP({ ...p, href: e.target.value })} /></label>
                  </div>
                  <label>설명<input value={p.text} maxLength={120} onChange={(e) => setP({ ...p, text: e.target.value })} /></label>
                  <PhotoField label={`만드는 것 ${i + 1}`} value={{ src: p.image, alt: '', position: '' }} onChange={(v) => setP({ ...p, image: v.src })} alt={false} position={false} />
                </div>
              )
            })}
            {draft.products.length < 6 && <button type="button" className="button ghost" onClick={() => put({ products: [...draft.products, { title: '', text: '', image: '', href: '/products' }] })}>만드는 것 더하기</button>}
            <label>아래 안내<input value={draft.note} onChange={(e) => put({ note: e.target.value })} maxLength={300} /></label>
          </>
        )}

        {/* 저장 막대는 화면 아래에 늘 떠 있다 (긴 칸을 다 내리지 않아도 저장) */}
        <div className="form-savebar">
          {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {message && <p className="success">{message}</p>}
          <div className="actions">
            {saved && <button type="button" className="button ghost" onClick={reset}>기본값으로</button>}
            <button type="button" className="button" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      </div>
    </section>
  )
}
