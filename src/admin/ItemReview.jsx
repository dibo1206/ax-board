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
    tax_type: item.tax_type ?? (item.category === '가공품' && !['곶감', '고춧가루'].includes(item.name) ? 'taxable' : 'free'),
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
    recipes: (item.recipes ?? []).map((r) => ({ title: r.title ?? '', ingredients: r.ingredients ?? '', method: r.method ?? '', image: r.image ?? '' })),
    source: item.source ?? '',
  }
}

const MAX_RECIPES = 5
const emptyRecipe = () => ({ title: '', ingredients: '', method: '', image: '' })

// 레시피 한 줄: 제목·재료·방법 + 카드 사진 (올리기 · AI로 만들기 · 빼기). 사진이 없으면 손님 화면은 요리 종류별 기본 그림
function RecipeRow({ recipe, number, itemCode, photoAi, busy, onChange, onRemove, onBusy }) {
  const [error, setError] = useState('')
  const set = (key) => (e) => onChange({ ...recipe, [key]: e.target.value })

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (file.size > 2 * 1024 * 1024) return setError('사진은 2MB 이하로 올려 주세요.')
    onBusy(true)
    try {
      const { url } = await adminApi('/recipe-photo', { method: 'POST', body: file, headers: { 'Content-Type': file.type } })
      onChange({ ...recipe, image: url })
    } catch (err) {
      setError(err.message)
    } finally {
      onBusy(false)
    }
  }

  async function make() {
    if (!recipe.title || !recipe.method) return setError('제목과 방법을 먼저 적어 주세요.')
    setError('')
    onBusy(true)
    try {
      const { url } = await adminApi('/recipe-photo/generate', { method: 'POST', body: { item_code: itemCode, ...recipe }, timeoutMs: 90_000 })
      onChange({ ...recipe, image: url })
    } catch (err) {
      setError(err.message)
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="recipe-row">
      <div className="recipe-photo">
        {recipe.image ? <img src={recipe.image} alt={`${recipe.title || `레시피 ${number}`} 사진`} /> : <span className="muted">사진 없음<br />(기본 그림)</span>}
      </div>
      <div className="recipe-fields">
        <div className="row">
          <label>{number}. 제목<input value={recipe.title} onChange={set('title')} maxLength={30} placeholder="수박 화채" /></label>
          <label>재료 (·로 나눠)<input value={recipe.ingredients} onChange={set('ingredients')} maxLength={60} placeholder="수박·사이다" /></label>
        </div>
        <label>만드는 방법 (한 문장)<input value={recipe.method} onChange={set('method')} maxLength={120} placeholder="깍둑썰어 사이다를 붓기" /></label>
        <div className="actions">
          <label className="button ghost small file-button">사진 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} /></label>
          {photoAi.enabled && <button type="button" className="button ghost small" onClick={make} disabled={busy}>AI로 사진 만들기</button>}
          {recipe.image && <button type="button" className="link" onClick={() => onChange({ ...recipe, image: '' })} disabled={busy}>사진 빼기</button>}
          <button type="button" className="link danger" onClick={onRemove} disabled={busy}>레시피 지우기</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
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
    recipes: form.recipes
      .map((r) => ({ title: r.title.trim(), ingredients: r.ingredients.trim(), method: r.method.trim(), ...(r.image ? { image: r.image } : {}) }))
      .filter((r) => r.title && r.method),
  }
}

function ItemCard({ item, photoAi, onPhotoUsed, onDone }) {
  const [form, setForm] = useState(() => toForm(item))
  const [issues, setIssues] = useState(item.issues)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const fresh = item.category !== '가공품'
  const setRecipe = (n) => (next) => setForm((prev) => ({ ...prev, recipes: prev.recipes.map((r, i) => (i === n ? next : r)) }))
  const busyFor = (on) => { setBusy(on); if (!on) onPhotoUsed() }

  // [AI로 빈 칸 채우기]: 비어 있는 칸만 초안으로 채우고, 새 레시피는 사진까지 만든다. 저장은 관리자가 읽고 고친 뒤에
  async function draft() {
    setError('')
    setMessage('AI가 초안을 쓰는 중이에요… (30초쯤)')
    setBusy(true)
    try {
      const { draft: d, flagged, photos } = await adminApi(`/items/${item.item_code}/draft`, { method: 'POST', timeoutMs: 90_000 })
      const recipes = d.recipes?.length && form.recipes.length === 0 ? d.recipes.map((r) => ({ ...emptyRecipe(), ...r })) : null
      setForm((prev) => ({
        ...prev,
        storage_method: prev.storage_method || d.storage_method || '',
        stage1_state: prev.stage1_state || d.stage1_state || '',
        stage2_state: prev.stage2_state || d.stage2_state || '',
        opened_note: prev.opened_note || d.opened_note || '',
        danger_signs: prev.danger_signs || (d.danger_signs ?? []).join('\n'),
        recipes: recipes ?? prev.recipes,
      }))
      const note = flagged.length ? ` (금지어·근거 없는 문장 ${flagged.length}개는 뺐어요)` : ''
      if (recipes && photos) {
        const made = []
        for (const [n, r] of recipes.entries()) {
          setMessage(`초안을 채웠어요${note}. 레시피 사진 만드는 중 ${n + 1}/${recipes.length}…`)
          try {
            const { url } = await adminApi('/recipe-photo/generate', { method: 'POST', body: { item_code: item.item_code, ...r }, timeoutMs: 90_000 })
            made.push(n)
            setForm((prev) => ({ ...prev, recipes: prev.recipes.map((x, i) => (i === n && x.title === r.title ? { ...x, image: url } : x)) }))
          } catch (err) {
            setError(`레시피 ${n + 1} 사진: ${err.message}`)
            if (err.status === 429) break
          }
        }
        setMessage(`초안과 레시피 사진 ${made.length}장을 채웠어요${note}. 출처와 대조해 고친 뒤 [저장]을 눌러 주세요.`)
      } else {
        setMessage(`초안을 채웠어요${note}. 출처와 대조해 고친 뒤 [저장]을 눌러 주세요.`)
      }
    } catch (e) {
      setMessage('')
      setError(e.message)
    } finally {
      busyFor(false)
    }
  }

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
      <div className="actions">
        <button type="button" className="button ghost" onClick={draft} disabled={busy}>AI로 빈 칸 채우기{photoAi.enabled ? ' (레시피 사진 포함)' : ''}</button>
        <span className="muted">비어 있는 칸만 채워요. 이미 적힌 내용은 바꾸지 않아요.</span>
      </div>

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
      <label>부가세
        <select value={form.tax_type} onChange={set('tax_type')}>
          <option value="free">면세 — 가공하지 않은 농산물 (씻기·자르기·말리기·빻기 같은 단순 손질 포함)</option>
          <option value="taxable">과세 10% — 청·잼·즙처럼 가공한 제품</option>
          <option value="check">확인 필요 — 세무사 확인 전까지 과세로 처리</option>
        </select>
      </label>
      {form.tax_type === 'check' && <p className="warn">확인 필요 품목은 결제할 때 과세로 잡혀요. 세무사에게 확인한 뒤 면세·과세로 바꿔 주세요. 바꾼 뒤 들어오는 주문부터 적용돼요.</p>}
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
      <fieldset className="recipe-editor">
        <legend>레시피 ({form.recipes.length}/{MAX_RECIPES}) <span className="muted">
          {photoAi.enabled ? `· AI 사진은 오늘 ${photoAi.left}장 더 만들 수 있어요` : '· AI 사진 만들기는 꺼져 있어요 (.env 에 Cloudflare 키가 없음). 사진을 직접 올리거나 기본 그림을 써요'}
        </span></legend>
        {form.recipes.map((r, n) => (
          <RecipeRow
            key={n} recipe={r} number={n + 1} itemCode={item.item_code} photoAi={photoAi} busy={busy}
            onChange={setRecipe(n)} onBusy={busyFor}
            onRemove={() => setForm((prev) => ({ ...prev, recipes: prev.recipes.filter((_, i) => i !== n) }))}
          />
        ))}
        {form.recipes.length < MAX_RECIPES && (
          <button type="button" className="button ghost small" onClick={() => setForm((prev) => ({ ...prev, recipes: [...prev.recipes, emptyRecipe()] }))}>+ 레시피 더하기</button>
        )}
      </fieldset>
      <label>출처* (확인한 자료의 기관·제목·주소)<textarea rows={2} value={form.source} onChange={set('source')} maxLength={1000} placeholder="예: 농촌진흥청 농사로 「수박 보관법」 https://..." /></label>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="button ghost" onClick={save} disabled={busy}>저장</button>
        {item.status === 'pending' && <button type="button" className="button" onClick={approve} disabled={busy}>검수 완료</button>}
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
  const [photoAi, setPhotoAi] = useState({ enabled: false, left: 0 })

  const load = useCallback(() => adminApi(`/items/review${all ? '?all=1' : ''}`)
    .then((rows) => { setList(rows); onCount?.(rows.filter((r) => r.status === 'pending').length) })
    .catch((e) => setError(e.message)), [all, onCount])
  const loadPhotoAi = useCallback(() => adminApi('/recipe-photo/status').then(setPhotoAi).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadPhotoAi() }, [loadPhotoAi])

  if (!list) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <section>
      <p className="muted">판매자가 요청한 새 품목이에요. AI 초안과 자동 검사는 참고만 하고, 보관법·먹으면 안 되는 신호를 출처(농촌진흥청 농사로, 식품안전나라 등)와 대조한 뒤 검수 완료해 주세요.
        검수 전에는 손님 화면과 상담에 이 품목의 보관·안전 정보가 나가지 않아요.</p>
      {message && <p className="success">{message}</p>}
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setOpen(null) }} /> 검수 끝난 품목도 보기 (보관법·보통 당도 범위 고치기)</label>
      {list.filter((i) => i.status === 'pending').length === 0 && <p className="box muted">검수 기다리는 품목이 없어요.</p>}
      {list.map((item) => (item.status === 'pending' || open === item.item_code
        ? <ItemCard key={item.item_code} item={item} photoAi={photoAi} onPhotoUsed={loadPhotoAi} onDone={(text) => { setMessage(text); load() }} />
        : (
          <p key={item.item_code} className="box">
            <button type="button" className="link" onClick={() => setOpen(item.item_code)}>{item.category} · {item.name}</button>
            <span className="muted"> · 검수 {item.reviewed_by ?? '전'}{item.brix_min != null || item.brix_max != null ? ` · 보통 당도 ${item.brix_min ?? '?'}~${item.brix_max ?? '?'}Brix` : ''}</span>
          </p>
        )))}
    </section>
  )
}
