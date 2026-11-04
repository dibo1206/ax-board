import { useEffect, useState } from 'react'
import { thumbUrl, unitPrice } from '../shop/shared.js'
import { AiDraft } from './AiDraft.jsx'
import { adminApi } from './api.js'

const EMPTY = {
  product_code: '', seller_code: '', item_code: '', name: '', price: '', unit: '', stock: '',
  weight_g: '', count_per_box: '', brix: '', variety: '', brix_measured_at: '', harvest_date: '', summary: '', description: '',
  external_url: '', b2b_available: false, tags: [], faq: [], notice: { imported: false }, options: [],
}

function toForm(product) {
  if (!product) return EMPTY
  const form = { ...EMPTY }
  for (const key of Object.keys(EMPTY)) {
    const value = product[key]
    form[key] = value === null || value === undefined ? EMPTY[key] : (typeof EMPTY[key] === 'string' ? String(value) : value)
  }
  form.notice = { imported: false, ...product.notice }
  form.options = (product.options ?? []).map((o) => ({ ...o, price: String(o.price), stock: String(o.stock) }))
  return form
}

// 판매 옵션 (예: 같은 사과를 5kg·10kg 로): 옵션마다 이름·가격·재고를 따로 적는다. 옵션이 있으면 손님은 옵션을 골라야 살 수 있다.
// 주문 기록이 있는 옵션은 지울 수 없어서 판매 중지로만 내린다 (서버도 같은 규칙)
const MAX_OPTIONS = 20 // 서버 server/validate.js 의 MAX_OPTIONS 와 같게
function OptionFields({ options, onChange }) {
  const set = (index, key) => (e) => onChange(options.map((o, i) => (i === index ? { ...o, [key]: e.target.value } : o)))
  const toggle = (index) => onChange(options.map((o, i) => (i === index ? { ...o, status: o.status === 'stopped' ? 'active' : 'stopped' } : o)))
  return (
    <fieldset className="tags faq-edit">
      <legend>판매 옵션 (선택, {MAX_OPTIONS}개까지) — 같은 상품을 5kg·10kg 처럼 나눠 팔 때. 옵션이 있으면 가격·재고는 옵션마다 적어요</legend>
      {options.map((o, i) => (
        <div key={o.id ?? `new-${i}`} className={`row${o.status === 'stopped' ? ' dim' : ''}`}>
          <label>옵션 이름*<input value={o.name} onChange={set(i, 'name')} maxLength={30} placeholder="예: 5kg 1박스" /></label>
          <label>가격(원)*<input value={o.price} onChange={set(i, 'price')} inputMode="numeric" /></label>
          <label>재고*<input value={o.stock} onChange={set(i, 'stock')} inputMode="numeric" placeholder="없으면 0" /></label>
          <span className="muted">{o.status === 'stopped' ? '판매 중지' : unitPrice(o.price, o.name) ?? ''}</span>
          {o.id && <button type="button" className="link" onClick={() => toggle(i)}>{o.status === 'stopped' ? '다시 판매' : '판매 중지'}</button>}
          {o.ordered
            ? <span className="muted">주문 기록이 있어 지울 수 없어요</span>
            : <button type="button" className="link" onClick={() => onChange(options.filter((_, j) => j !== i))}>빼기</button>}
        </div>
      ))}
      {options.length < MAX_OPTIONS && (
        <button type="button" className="link" onClick={() => onChange([...options, { id: null, name: '', price: '', stock: '', status: 'active' }])}>+ 옵션 추가</button>
      )}
      {options.length > 0 && <p className="muted">상품 가격은 판매 중 옵션의 가장 낮은 가격으로 자동으로 맞춰지고 목록에 "~부터"로 보여요. 판매 중 옵션이 모두 품절이면 품절로 보여요. 옵션 이름이 판매 단위로 보여서 100g당 가격도 옵션 이름(예: 5kg)으로 계산해요.</p>}
    </fieldset>
  )
}

// 당도 등급: 품종과 측정값으로 자동으로 정해진다 (판매자가 고를 수 없다). 기준이 없으면 측정값만 보인다
function BrixGradeFields({ item, brix, variety, hasPhoto, onChange }) {
  const standards = item.brix_standards ?? []
  const common = standards.some((s) => s.varieties.includes('공통'))
  const std = standards.find((s) => s.varieties.includes(common ? '공통' : variety))
  const value = Number(brix)
  const grade = !std || !brix ? null : value >= std.top ? '매우높은 당도' : value >= std.high ? '높은 당도' : '보통 당도'
  return (
    <div className="preview">
      {standards.length > 0 && !common && (
        <label>품종{brix ? '*' : ''}
          <select value={variety} onChange={onChange}>
            <option value="">골라 주세요</option>
            {standards.flatMap((s) => s.varieties).map((v) => <option key={v} value={v}>{v}</option>)}
            <option value="기타">기타 (목록에 없는 품종)</option>
          </select>
        </label>
      )}
      {std && <p className="muted">공식 기준{common ? '' : ` (${variety})`}: 높은 당도 {std.high} 이상 · 매우높은 당도 {std.top} 이상</p>}
      {grade && <p><strong>{grade}</strong>로 표시돼요{hasPhoto ? '' : ' (당도계 사진을 올려야 등급이 보여요)'}</p>}
      {brix && !std && <p className="muted">공식 기준이 없어서 등급 없이 측정값만 보여요.</p>}
    </div>
  )
}

// 상품정보 제공 고시: 판매자가 직접 적는 칸. 품목·용량·생산자·보관법·상담 전화는 자동으로 채워진다. AI 가 채우지 않는다
function NoticeFields({ item, notice, hasHarvest, onChange }) {
  const set = (key) => (e) => onChange({ ...notice, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const text = (key, label, placeholder) => <label>{label}<input value={notice[key] ?? ''} onChange={set(key)} maxLength={300} placeholder={placeholder} /></label>
  const processed = item.category === '가공품'
  return (
    <fieldset className="preview notice-fields">
      <legend><strong>상품정보 제공 고시</strong> <span className="muted">법으로 보여 줘야 하는 정보예요. 직접 확인해서 적어 주세요 (AI 가 채우지 않아요)</span></legend>
      {processed ? (
        <>
          {text('food_type', '식품의 유형*', '라벨 그대로. 예: 과·채주스')}
          {text('address', '생산자 소재지*', '예: 충남 천안시 ○○로 1')}
          {text('packed', '제조연월일*', '예: 제품 라벨에 표시 (별도 표기)')}
          {text('expiry', '소비기한 또는 품질유지기한*', '예: 제조일부터 12개월')}
          {text('ingredients', '원재료명·원산지·함량*', '예: 배(국내산) 100%')}
          {text('nutrition', '영양성분*', '표시 대상이 아니면 "표시 대상 아님"')}
          {text('gmo', '유전자변형식품 표시', '비우면 해당 없음')}
        </>
      ) : (
        <>
          {text('origin', '원산지*', '예: 국내산 (충남 천안)')}
          {!hasHarvest && text('packed', '포장일 또는 생산연도* (수확일을 적으면 비워도 돼요)', '예: 2026년산')}
          {text('expiry', '소비기한 또는 품질유지기한*', '예: 수령 후 냉장 보관, 2~3주 안에 드세요')}
          {text('composition', '상품 구성*', '예: 사과 16개 내외')}
          {text('gmo', '유전자변형농산물 표시', '비우면 해당 없음')}
          {text('geo', '지리적 표시', '비우면 해당 없음')}
        </>
      )}
      <label className="check"><input type="checkbox" checked={notice.imported === true} onChange={set('imported')} /> 수입 상품이에요</label>
      {notice.imported && text('importer', '수입자*', '수입 회사 이름')}
    </fieldset>
  )
}

// 품목을 고르면 품목 기준표(보관·신선도·레시피)가 자동으로 붙는다는 걸 미리 보여 준다
function ItemPreview({ item }) {
  if (!item) return null
  return (
    <div className="preview">
      {item.status === 'pending' && (
        <p className="warn">새로 요청한 품목이라 관리자 검수 전이에요. 상품은 승인되면 팔 수 있지만, 보관·안전 정보는 검수가 끝나야 손님에게 보여요.
          [AI로 채우기]를 누르면 품목 정보 초안도 같이 만들어 검수를 도와요.</p>
      )}
      <strong>{item.name} 품목 기준 정보가 자동으로 붙어요</strong>
      <p>보관: {item.storage_method}</p>
      {item.stage1_state
        ? <p>신선도: 신선 {item.stage1_uses.join('·')} → 품질 저하 {item.stage2_uses.join('·')} (상태로 판단{item.keep_period ? ` · 보관 기간 참고 ${item.keep_period}` : ''})</p>
        : item.fresh_days_stage1 && <p>신선도: {item.fresh_days_stage1}일까지 {item.stage1_uses.join('·')} → {item.fresh_days_stage2}일까지 {item.stage2_uses.join('·')}</p>}
      {item.opened_note && <p>개봉 후: {item.opened_note}</p>}
      <p>레시피 {item.recipes.length}개{item.allergens.length > 0 && ` · 알레르기: ${item.allergens.join(', ')}`}</p>
      {!item.reviewed_by && <p className="warn">식품팀 검수 전 정보예요</p>}
    </div>
  )
}

// mode: 'admin'(회사 관리자) 또는 'seller'(농가 판매자). 판매자는 농가를 고르지 않고, 새 상품은 검토 요청으로 올린다
const SAVED = { draft: '임시 저장했어요 (소비자 화면에는 안 보여요)', pending: '검토를 요청했어요. 회사 관리자가 승인하면 판매돼요', active: '저장했어요' }

export function ProductForm({ product, options, onCancel, onSaved, api = adminApi, mode = 'admin' }) {
  const isNew = !product
  const seller = mode === 'seller'
  const [form, setForm] = useState(() => toForm(product))
  const [errors, setErrors] = useState([])
  const [image, setImage] = useState(null)
  const [brixPhoto, setBrixPhoto] = useState(null) // 당도계 사진 (새로 올릴 것)
  // 당도를 바꾸면 서버가 옛 사진을 내리므로, 지금 적힌 당도가 저장된 값과 같을 때만 옛 사진을 보여 준다
  const brixPhotoUrl = product?.brix_photo_url && Number(product.brix) === Number(form.brix) ? product.brix_photo_url : null
  const [changes, setChanges] = useState([]) // 판매 중 가격·당도·수확일 수정 이력 (관리자만)
  useEffect(() => {
    if (!product || mode !== 'admin') return
    api(`/products/${product.product_code}/changes`).then(setChanges).catch(() => {})
  }, [product, mode, api])
  const [gallery, setGallery] = useState([]) // 새로 올릴 상세 사진들
  const [photos, setPhotos] = useState(() => ({ main: product?.image_url ?? null, list: product?.images ?? [] }))
  const [saving, setSaving] = useState(false)
  const [itemDraft, setItemDraft] = useState(null) // AI가 만든 품목(원물) 초안 — 품목 정보가 비어 있을 때만
  const [fillItem, setFillItem] = useState(true)
  // 목록에 없는 품목 요청 (관리자 검수 후 정보가 손님에게 보인다)
  const [extraItems, setExtraItems] = useState([])
  const [request, setRequest] = useState(null) // null: 닫힘, { name, category, error }
  const items = [...options.items, ...extraItems.filter((x) => !options.items.some((i) => i.item_code === x.item_code))]

  const item = items.find((i) => i.item_code === form.item_code)
  const hasOptions = form.options.length > 0
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const toggleTag = (code) => setForm((prev) => ({
    ...prev,
    tags: prev.tags.includes(code) ? prev.tags.filter((t) => t !== code) : [...prev.tags, code],
  }))

  // AI 초안을 받으면: 소개는 비어 있을 때만, 설명은 물어보고 바꾸고, 자주 묻는 질문은 채운다
  function applyDraft(draft) {
    const replace = !form.description || window.confirm('지금 적힌 상품 설명을 AI 초안으로 바꿀까요?')
    setForm((prev) => ({
      ...prev,
      summary: prev.summary || draft.summary,
      description: replace ? draft.description : prev.description,
      faq: draft.faq?.length ? draft.faq : prev.faq,
    }))
    const it = draft.item
    setItemDraft(it && (it.storage_method || it.opened_note || it.danger_signs?.length || it.recipes?.length) ? it : null)
  }
  const setFaq = (index, key) => (e) => setForm((prev) => ({ ...prev, faq: prev.faq.map((f, i) => (i === index ? { ...f, [key]: e.target.value } : f)) }))

  async function save(status) {
    setSaving(true)
    setErrors([])
    try {
      const body = { ...form, status }
      let saved = isNew
        ? await api('/products', { method: 'POST', body })
        : await api(`/products/${product.product_code}`, { method: 'PATCH', body })
      if (image) {
        await api(`/products/${saved.product_code}/image`, {
          method: 'POST',
          headers: { 'Content-Type': image.type },
          body: image,
        })
      }
      if (brixPhoto && saved.brix) {
        await api(`/products/${saved.product_code}/image?role=brix`, { method: 'POST', headers: { 'Content-Type': brixPhoto.type }, body: brixPhoto })
      }
      for (const file of gallery) {
        await api(`/products/${saved.product_code}/image?role=gallery`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      }
      if (itemDraft && fillItem) {
        // 같은 원물 상품들이 함께 쓰는 품목 정보는 비어 있는 칸만 채운다 (이미 있는 내용은 덮어쓰지 않음)
        await api(`/items/${form.item_code}/fill`, { method: 'POST', body: itemDraft })
      }
      // 판매자 판매 요청: 사진까지 올린 뒤 검사 → 믿을 만한 농가의 문제없는 상품은 바로 판매, 아니면 회사 확인 대기
      if (seller && status === 'pending') {
        saved = await api(`/products/${saved.product_code}/submit`, { method: 'POST' })
        if (saved.status === 'active') return onSaved(saved, '검사를 통과해서 바로 판매를 시작했어요')
        return onSaved(saved, `회사 확인 뒤 판매돼요 (${saved.reasons.join(' / ')})`)
      }
      onSaved(saved, `${SAVED[saved.status] ?? '저장했어요'}${saved.saved_note ?? ''}`)
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSaving(false)
    }
  }

  async function sendRequest() {
    try {
      const { item: created } = await api('/items/request', { method: 'POST', body: { name: request.name, category: request.category } })
      setExtraItems((prev) => [...prev, created])
      setForm((prev) => ({ ...prev, item_code: created.item_code }))
      setRequest(null)
    } catch (e) {
      setRequest((prev) => ({ ...prev, error: e.message }))
    }
  }

  const groups = [...new Set(options.tags.map((t) => t.tag_group))]

  return (
    <div className="box form">
      <h3>{isNew ? '새 상품 등록' : `상품 수정 · ${seller ? product.name : product.product_code}`}</h3>
      {product?.status === 'pending' && <p className="warn">검토 대기 중인 상품이에요. {seller ? '회사 관리자가 승인하면 판매돼요.' : '확인 후 [저장하고 판매]를 누르면 승인돼요.'}</p>}
      {product?.review_note && <p className="warn">반려 사유: {product.review_note}</p>}
      {changes.length > 0 && (
        <details className="preview">
          <summary>판매 중 수정 이력 {changes.length}건 (가격·당도·수확일)</summary>
          <ul>{changes.map((c, i) => <li key={i}>{c.changed_at.slice(0, 16).replace('T', ' ')} · {c.changed_by} · {c.field}: {c.old_value ?? '없음'} → {c.new_value ?? '없음'}</li>)}</ul>
        </details>
      )}

      <label>품목*
        <select value={form.item_code} onChange={set('item_code')}>
          <option value="">골라 주세요</option>
          {items.map((i) => <option key={i.item_code} value={i.item_code}>{i.category} · {i.name}{i.status === 'pending' ? ' (검수 전)' : ''}</option>)}
        </select>
      </label>
      {request ? (
        <div className="preview">
          <strong>새 품목 요청</strong>
          <p className="muted">목록에 없는 원물이면 이름과 종류만 적어 주세요. 회사 관리자가 보관법·먹으면 안 되는 신호를 출처와 함께 확인한 뒤 손님에게 보여요.</p>
          <div className="row">
            <label>품목 이름<input value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value, error: '' })} maxLength={20} placeholder="예: 수박" /></label>
            <label>종류
              <select value={request.category} onChange={(e) => setRequest({ ...request, category: e.target.value })}>
                {['과일', '채소', '가공품'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          {request.error && <p className="error">{request.error}</p>}
          <div className="actions">
            <button type="button" className="button" disabled={!request.name.trim()} onClick={sendRequest}>요청하고 이 품목 고르기</button>
            <button type="button" className="button ghost" onClick={() => setRequest(null)}>취소</button>
          </div>
        </div>
      ) : (
        <button type="button" className="link" onClick={() => setRequest({ name: '', category: '과일', error: '' })}>찾는 품목이 목록에 없어요 (새 품목 요청)</button>
      )}
      <ItemPreview item={item} />

      {!seller && (
        <label>판매 농가*
          <select value={form.seller_code} onChange={set('seller_code')}>
            <option value="">골라 주세요</option>
            {options.sellers.map((s) => <option key={s.seller_code} value={s.seller_code}>{s.name} · {s.region}</option>)}
          </select>
        </label>
      )}

      {/* 상품 코드는 서버가 자동으로 만든다. 판매자에게는 보이지 않고, 관리자만 원하면 직접 정할 수 있다 */}
      {isNew && !seller && (
        <label>상품 코드 <span className="muted">(비워 두면 자동으로 만들어요. 직접 정하면 영문 소문자·숫자·밑줄)</span>
          <input value={form.product_code} onChange={set('product_code')} placeholder="예: apple_gift_5kg" />
        </label>
      )}
      <label>상품 이름*<input value={form.name} onChange={set('name')} placeholder="예: [예시] 사과 선물세트 5kg" /></label>
      {/* 옵션이 있으면 상품 가격·재고는 옵션에서 정해진다 (판매 중 옵션의 최저가·재고 합) */}
      <div className="row">
        {!hasOptions && <label>가격(원)*<input value={form.price} onChange={set('price')} inputMode="numeric" /></label>}
        <label>판매 단위*<input value={form.unit} onChange={set('unit')} placeholder={hasOptions ? '예: 1박스 (옵션 이름에 양을 적어요)' : '예: 5kg 1박스'} /></label>
        {!hasOptions && <label>재고*<input value={form.stock} onChange={set('stock')} inputMode="numeric" placeholder="없으면 0" /></label>}
      </div>
      {!hasOptions && unitPrice(form.price, form.unit) && <p className="muted">손님 화면에 {unitPrice(form.price, form.unit)} 로 함께 보여요 (가격을 바꾸면 가격 기준일도 오늘로)</p>}
      <OptionFields options={form.options} onChange={(options) => setForm((prev) => ({ ...prev, options }))} />
      <div className="row">
        <label>1개 무게(g)<input value={form.weight_g} onChange={set('weight_g')} inputMode="numeric" /></label>
        <label>박스당 개수<input value={form.count_per_box} onChange={set('count_per_box')} inputMode="numeric" /></label>
      </div>
      {item?.show_brix && (
        <div className="row">
          <label>당도(Brix) <span className="muted">모르면 비워 두기</span><input value={form.brix} onChange={set('brix')} inputMode="decimal" /></label>
          <label>당도 잰 날<input type="date" value={form.brix_measured_at} onChange={set('brix_measured_at')} /></label>
        </div>
      )}
      {item?.show_brix && <BrixGradeFields item={item} brix={form.brix} variety={form.variety} hasPhoto={Boolean(brixPhoto || brixPhotoUrl)} onChange={set('variety')} />}
      {/* 거짓 표시 막기: 당도계 화면 사진. 판매자가 당도를 적으면 사진이 있어야 승인되고, 손님 화면에 [측정 사진]으로 보인다 */}
      {item?.show_brix && form.brix && (
        <label>당도계 사진 {seller && <span className="muted">(당도를 적으면 꼭 올려 주세요 · 당도를 바꾸면 다시 올려야 해요)</span>}
          {brixPhotoUrl && !brixPhoto && <span className="muted"> · <a href={brixPhotoUrl} target="_blank" rel="noreferrer">올린 사진 보기</a></span>}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setBrixPhoto(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {item?.brix_min != null && item?.brix_max != null && <p className="muted">{item.name} 보통 당도: {item.brix_min}~{item.brix_max}Brix</p>}
      {item && item.category !== '가공품' && (
        <label>수확일<input type="date" value={form.harvest_date} onChange={set('harvest_date')} /></label>
      )}
      {item && <NoticeFields item={item} notice={form.notice} hasHarvest={Boolean(form.harvest_date)} onChange={(notice) => setForm((prev) => ({ ...prev, notice }))} />}
      <AiDraft form={form} api={api} onDraft={applyDraft} />
      <label>한 줄 소개<input value={form.summary} onChange={set('summary')} maxLength={200} /></label>
      <label>상품 설명 <span className="muted">(선택) 빈 줄로 문단을 나눠요. 효능 표현은 쓰지 않아요</span>
        <textarea value={form.description} onChange={set('description')} rows={6} maxLength={3000} placeholder="재배 방법, 맛, 크기, 포장 방법 등" />
      </label>
      <fieldset className="tags faq-edit">
        <legend>자주 묻는 질문 (선택, 6개까지) — 상품 페이지에 보이고 상담 챗봇도 AI 없이 이 답을 써요</legend>
        {form.faq.map((f, i) => (
          <div key={i} className="row">
            <label>질문<input value={f.q} onChange={setFaq(i, 'q')} maxLength={100} /></label>
            <label>답<input value={f.a} onChange={setFaq(i, 'a')} maxLength={300} /></label>
            <button type="button" className="link" onClick={() => setForm((prev) => ({ ...prev, faq: prev.faq.filter((_, j) => j !== i) }))}>빼기</button>
          </div>
        ))}
        {form.faq.length < 6 && <button type="button" className="link" onClick={() => setForm((prev) => ({ ...prev, faq: [...prev.faq, { q: '', a: '' }] }))}>+ 질문 추가</button>}
      </fieldset>
      {itemDraft && (
        <div className="preview">
          <label className="check"><input type="checkbox" checked={fillItem} onChange={(e) => setFillItem(e.target.checked)} />
            <strong>{item?.name} 품목 정보가 비어 있어서 AI 초안으로 같이 채우기</strong></label>
          {itemDraft.storage_method && <p>보관: {itemDraft.storage_method}</p>}
          {itemDraft.opened_note && <p>개봉 후: {itemDraft.opened_note}</p>}
          {itemDraft.danger_signs?.length > 0 && <p>먹지 말아야 할 상태: {itemDraft.danger_signs.join(', ')}</p>}
          {itemDraft.recipes?.length > 0 && <p>레시피: {itemDraft.recipes.map((r) => r.title).join(', ')}</p>}
          <p className="muted">같은 원물의 다른 상품도 이 정보를 같이 써요. 비어 있는 칸만 채우고 이미 있는 내용은 바꾸지 않아요.</p>
        </div>
      )}
      <label>판매 링크 (스마트스토어·쿠팡, 없으면 비우기)<input value={form.external_url} onChange={set('external_url')} placeholder="https://" /></label>
      <label className="check"><input type="checkbox" checked={form.b2b_available} onChange={set('b2b_available')} />기업(B2B) 구매 문의 받기</label>

      <fieldset className="tags">
        <legend>태그 (3~5개 권장, 지금 {form.tags.length}개)</legend>
        {groups.map((g) => (
          <div key={g} className="tag-group">
            <span className="muted">{g}</span>
            {options.tags.filter((t) => t.tag_group === g).map((t) => (
              <label key={t.tag_code} className="check">
                <input type="checkbox" checked={form.tags.includes(t.tag_code)} onChange={() => toggleTag(t.tag_code)} />{t.label}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      <label>대표 사진 (jpg·png·webp, 2MB 이하 · 자동으로 줄이고 위치 정보를 지워요)
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
      </label>
      <label>상세 사진 추가 (여러 장, 모두 합쳐 8장까지)
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setGallery([...(e.target.files ?? [])].slice(0, 8))} />
      </label>
      {!isNew && (photos.main || photos.list.length > 0) && (
        <div className="photo-manage">
          {[photos.main, ...photos.list].filter(Boolean).map((url) => (
            <figure key={url}>
              <img src={thumbUrl(url)} alt="" width="80" height="80" />
              <figcaption>{url === photos.main ? '대표' : '상세'} <button type="button" className="link" onClick={async () => {
                try {
                  const updated = await api(`/products/${product.product_code}/image`, { method: 'DELETE', body: { url } })
                  setPhotos({ main: updated.image_url, list: updated.images })
                } catch (e) {
                  setErrors([e.message])
                }
              }}>지우기</button></figcaption>
            </figure>
          ))}
        </div>
      )}

      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      <div className="actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>취소</button>
        <button type="button" className="button ghost" onClick={() => save('draft')} disabled={saving}>임시 저장</button>
        {seller ? (
          <button type="button" className="button" onClick={() => save(product?.status === 'active' ? 'active' : 'pending')} disabled={saving}>
            {saving ? '저장 중…' : product?.status === 'active' ? '저장 (바로 반영)' : '판매 요청'}
          </button>
        ) : (
          <button type="button" className="button" onClick={() => save('active')} disabled={saving}>{saving ? '저장 중…' : product?.status === 'pending' ? '승인하고 판매' : '저장하고 판매'}</button>
        )}
      </div>
    </div>
  )
}
