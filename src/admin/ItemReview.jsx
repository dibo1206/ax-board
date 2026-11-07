import { useCallback, useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 품목 검수: 판매자가 요청한 새 품목(예: 수박)의 보관·안전 정보를 관리자가 확인한다
// AI 초안([AI로 채우기])과 규칙 1차 검사(금지어·"먹어도 돼요" 단정·숫자 확인)까지는 자동, 출처 확인과 검수 완료는 사람이 한다
const lines = (arr) => (arr ?? []).join('\n')
const commas = (arr) => (arr ?? []).join(', ')
const splitLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean)
const splitCommas = (text) => text.split(',').map((s) => s.trim()).filter(Boolean)

function toForm(item) {
  return {
    show_brix: item.show_brix,
    brix_standards: (item.brix_standards ?? []).map((s) => `${s.varieties.join(', ')} : ${s.high} : ${s.top}`).join('\n'),
    brix_standard_source: item.brix_standard_source ?? '',
    brix_min: item.brix_min ?? '',
    brix_max: item.brix_max ?? '',
    storage_method: item.storage_method ?? '',
    stage1_state: item.stage1_state ?? '',
    stage1_uses: commas(item.stage1_uses),
    stage2_state: item.stage2_state ?? '',
    stage2_uses: commas(item.stage2_uses),
    keep_period: item.keep_period ?? '',
    opened_note: item.opened_note ?? '',
    allergens: commas(item.allergens),
    danger_signs: lines(item.danger_signs),
    danger_note: item.danger_note ?? '',
    allergen_note: item.allergen_note ?? '',
    cafe_note: item.cafe_note ?? '',
    recipes: (item.recipes ?? []).map((r) => `${r.title}: ${r.ingredients}: ${r.method}${r.image ? `: ${r.image}` : ''}`).join('\n'),
    source: item.source ?? '',
  }
}

function toBody(form) {
  return {
    ...form,
    stage1_uses: splitCommas(form.stage1_uses),
    stage2_uses: splitCommas(form.stage2_uses),
    stage3_uses: ['폐기'],
    brix_standards: splitLines(form.brix_standards).map((line) => {
      const [varieties, high, top] = line.split(':').map((s) => s.trim())
      return { varieties: splitCommas(varieties ?? ''), high: Number(high), top: Number(top) }
    }),
    allergens: splitCommas(form.allergens),
    danger_signs: splitLines(form.danger_signs),
    recipes: splitLines(form.recipes).map((line) => {
      const [title, ingredients, ...method] = line.split(':').map((s) => s.trim())
      // 끝 칸이 / 로 시작하면 레시피 카드 사진 주소 (예: /recipe-photos/kiwi-yogurt.webp)
      const image = method.length > 1 && method.at(-1).startsWith('/') ? method.pop() : ''
      return { title, ingredients: ingredients ?? '', method: method.join(':'), ...(image ? { image } : {}) }
    }),
  }
}

function ItemCard({ item, onDone }) {
  const [form, setForm] = useState(() => toForm(item))
  const [issues, setIssues] = useState(item.issues)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const fresh = item.category !== '가공품'

  async function save() {
    setError('')
    try {
      const saved = await adminApi(`/items/${item.item_code}`, { method: 'PUT', body: toBody(form) })
      setIssues(saved.issues)
      setMessage('저장했어요. 아래 1차 검사 결과를 다시 확인해 주세요.')
      return true
    } catch (e) {
      setError(e.message)
      return false
    }
  }

  async function approve() {
    if (!(await save())) return
    if (!window.confirm(`${item.name} 품목 정보를 출처와 대조해 확인했나요? 검수 완료하면 손님 화면과 상담에 바로 보여요.`)) return
    try {
      await adminApi(`/items/${item.item_code}/approve`, { method: 'POST' })
      onDone(`${item.name}: 검수를 마쳐서 손님 화면에 보관·안전 정보가 보여요`)
    } catch (e) {
      setError(e.message)
      if (e.issues) setIssues(e.issues)
    }
  }

  const errors = issues.filter((i) => i.level === 'error')
  return (
    <div className="box form">
      <h3>{item.category} · {item.name} <span className="muted">요청: {item.requested_by ?? '-'}</span></h3>
      <p className="muted">
        이 품목을 쓰는 상품: {item.products.length ? item.products.map((p) => `${p.name}(${p.status === 'active' ? '판매 중' : p.status === 'pending' ? '검토 대기' : '임시 저장'})`).join(', ') : '없음'}
      </p>
      {!item.storage_method && !item.danger_signs.length && (
        <p className="muted">아직 비어 있어요. 판매자가 상품 화면에서 [AI로 채우기]를 누르면 초안이 채워져요. 관리자가 직접 적어도 돼요.</p>
      )}

      <div className="issues">
        <strong>1차 검사 (자동)</strong> {errors.length ? <span className="error">고칠 것 {errors.length}개</span> : <span className="success">막는 문제 없음</span>}
        <ul>
          {issues.map((i, n) => (
            <li key={n} className={i.level === 'error' ? 'error' : 'muted'}>
              {i.level === 'error' ? '✗' : '!'} {i.field}: {i.problem}{i.text ? ` — "${i.text}"` : ''}
            </li>
          ))}
        </ul>
      </div>

      <label>보관법<textarea rows={3} value={form.storage_method} onChange={set('storage_method')} maxLength={400} /></label>
      {fresh && (
        <>
          <div className="row">
            <label>신선한 상태<input value={form.stage1_state} onChange={set('stage1_state')} maxLength={200} placeholder="예: 껍질에 탄력이 있고 향과 색이 정상인 상태" /></label>
            <label>그때 활용 (쉼표로)<input value={form.stage1_uses} onChange={set('stage1_uses')} placeholder="생과, 샐러드" /></label>
          </div>
          <div className="row">
            <label>품질 저하 상태<input value={form.stage2_state} onChange={set('stage2_state')} maxLength={200} placeholder="예: 약간 무르지만 곰팡이·이상 냄새 같은 부패 징후가 없는 상태" /></label>
            <label>그때 활용 (쉼표로)<input value={form.stage2_uses} onChange={set('stage2_uses')} placeholder="주스, 잼" /></label>
          </div>
        </>
      )}
      <label>보관 기간 참고<input value={form.keep_period} onChange={set('keep_period')} maxLength={120} placeholder="예: 냉장 1~2주 (없으면 '정해진 보관 일수는 없어요')" /></label>
      {!fresh && <label>개봉 후<input value={form.opened_note} onChange={set('opened_note')} maxLength={200} /></label>}
      <label>먹으면 안 되는 신호 (한 줄에 하나, 6개까지)<textarea rows={4} value={form.danger_signs} onChange={set('danger_signs')} /></label>
      <label>신호 예외 안내 (선택)<input value={form.danger_note} onChange={set('danger_note')} maxLength={200} placeholder="예: 단순한 갈변은 부패와 달라요" /></label>
      <div className="row">
        <label>알레르기 표시 (쉼표로, 없으면 비우기)<input value={form.allergens} onChange={set('allergens')} /></label>
        <label className="check"><input type="checkbox" checked={form.show_brix} onChange={set('show_brix')} /> 당도 표시</label>
      </div>
      {form.show_brix && (
        <div className="row">
          <label>보통 당도 최소 (Brix)<input value={form.brix_min} onChange={set('brix_min')} inputMode="decimal" placeholder="출처 확인 후" /></label>
          <label>보통 당도 최대 (Brix)<input value={form.brix_max} onChange={set('brix_max')} inputMode="decimal" placeholder="출처 확인 후" /></label>
        </div>
      )}
      {form.show_brix && (
        <>
          <label>당도 등급 기준 (한 줄에 하나: 품종들 : 높은 당도 : 매우높은 당도. 품종 구분이 없으면 공통)<textarea rows={3} value={form.brix_standards} onChange={set('brix_standards')} placeholder="공통 : 9 : 11" /></label>
          <label>당도 기준 출처 (기준을 넣으면 필수)<input value={form.brix_standard_source} onChange={set('brix_standard_source')} maxLength={300} /></label>
          <p className="muted">비워 두면 등급 없이 측정값만 보여요. 공식 자료에 있는 값만 넣어 주세요.</p>
        </>
      )}
      {form.show_brix && <p className="muted">판매자가 이 범위 밖의 당도를 적으면 저장이 막혀요. 근거 없이 정하지 말고 출처에 나온 값으로 적어 주세요.</p>}
      <label>알레르기 안내 문장 (선택)<input value={form.allergen_note} onChange={set('allergen_note')} maxLength={300} placeholder="예: 다른 원료가 들어간 제품은 라벨을 확인해 주세요" /></label>
      <label>카페 메뉴 비율 (선택, 시험 제조 제안값이면 그렇게 적기)<input value={form.cafe_note} onChange={set('cafe_note')} maxLength={400} /></label>
      <label>레시피 (한 줄에 하나: 제목: 재료: 방법, 카드 사진은 끝에 : /recipe-photos/kiwi-yogurt.webp — 없으면 기본 그림)<textarea rows={3} value={form.recipes} onChange={set('recipes')} placeholder="수박 화채: 수박·사이다: 깍둑썰어 사이다를 붓기" /></label>
      <label>출처* (확인한 자료의 기관·제목·주소)<textarea rows={2} value={form.source} onChange={set('source')} maxLength={1000} placeholder="예: 농촌진흥청 농사로 「수박 보관법」 https://..." /></label>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="button ghost" onClick={save}>저장</button>
        {item.status === 'pending' && <button type="button" className="button" onClick={approve}>검수 완료</button>}
      </div>
    </div>
  )
}

export function ItemReview({ onCount }) {
  const [list, setList] = useState(null)
  const [all, setAll] = useState(false) // 검수 끝난 품목도 보기 (보관법·보통 당도 범위 고치기)
  const [open, setOpen] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => adminApi(`/items/review${all ? '?all=1' : ''}`)
    .then((rows) => { setList(rows); onCount?.(rows.filter((r) => r.status === 'pending').length) })
    .catch((e) => setError(e.message)), [all, onCount])
  useEffect(() => { load() }, [load])

  if (!list) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <section>
      <p className="muted">판매자가 요청한 새 품목이에요. AI 초안과 자동 검사는 참고만 하고, 보관법·먹으면 안 되는 신호를 출처(농촌진흥청 농사로, 식품안전나라 등)와 대조한 뒤 검수 완료해 주세요.
        검수 전에는 손님 화면과 상담에 이 품목의 보관·안전 정보가 나가지 않아요.</p>
      {message && <p className="success">{message}</p>}
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setOpen(null) }} /> 검수 끝난 품목도 보기 (보관법·보통 당도 범위 고치기)</label>
      {list.filter((i) => i.status === 'pending').length === 0 && <p className="box muted">검수 기다리는 품목이 없어요.</p>}
      {list.map((item) => (item.status === 'pending' || open === item.item_code
        ? <ItemCard key={item.item_code} item={item} onDone={(text) => { setMessage(text); load() }} />
        : (
          <p key={item.item_code} className="box">
            <button type="button" className="link" onClick={() => setOpen(item.item_code)}>{item.category} · {item.name}</button>
            <span className="muted"> · 검수 {item.reviewed_by ?? '전'}{item.brix_min != null || item.brix_max != null ? ` · 보통 당도 ${item.brix_min ?? '?'}~${item.brix_max ?? '?'}Brix` : ''}</span>
          </p>
        )))}
    </section>
  )
}
