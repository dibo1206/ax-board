import { useState } from 'react'
import { thumbUrl, unitPrice } from '../shop/shared.js'
import { AiDraft } from './AiDraft.jsx'
import { adminApi } from './api.js'

const EMPTY = {
  product_code: '', seller_code: '', item_code: '', name: '', price: '', unit: '', stock: '',
  weight_g: '', count_per_box: '', brix: '', brix_measured_at: '', harvest_date: '', summary: '', description: '',
  external_url: '', b2b_available: false, tags: [], faq: [],
}

function toForm(product) {
  if (!product) return EMPTY
  const form = { ...EMPTY }
  for (const key of Object.keys(EMPTY)) {
    const value = product[key]
    form[key] = value === null || value === undefined ? EMPTY[key] : (typeof EMPTY[key] === 'string' ? String(value) : value)
  }
  return form
}

// 품목을 고르면 품목 기준표(보관·신선도·레시피)가 자동으로 붙는다는 걸 미리 보여 준다
function ItemPreview({ item }) {
  if (!item) return null
  return (
    <div className="preview">
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
  const [gallery, setGallery] = useState([]) // 새로 올릴 상세 사진들
  const [photos, setPhotos] = useState(() => ({ main: product?.image_url ?? null, list: product?.images ?? [] }))
  const [saving, setSaving] = useState(false)
  const [itemDraft, setItemDraft] = useState(null) // AI가 만든 품목(원물) 초안 — 품목 정보가 비어 있을 때만
  const [fillItem, setFillItem] = useState(true)

  const item = options.items.find((i) => i.item_code === form.item_code)
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
      const saved = isNew
        ? await api('/products', { method: 'POST', body })
        : await api(`/products/${product.product_code}`, { method: 'PATCH', body })
      if (image) {
        await api(`/products/${saved.product_code}/image`, {
          method: 'POST',
          headers: { 'Content-Type': image.type },
          body: image,
        })
      }
      for (const file of gallery) {
        await api(`/products/${saved.product_code}/image?role=gallery`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      }
      if (itemDraft && fillItem) {
        // 같은 원물 상품들이 함께 쓰는 품목 정보는 비어 있는 칸만 채운다 (이미 있는 내용은 덮어쓰지 않음)
        await api(`/items/${form.item_code}/fill`, { method: 'POST', body: itemDraft })
      }
      onSaved(saved, SAVED[saved.status] ?? '저장했어요')
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSaving(false)
    }
  }

  const groups = [...new Set(options.tags.map((t) => t.tag_group))]

  return (
    <div className="box form">
      <h3>{isNew ? '새 상품 등록' : `상품 수정 · ${product.product_code}`}</h3>
      {product?.status === 'pending' && <p className="warn">검토 대기 중인 상품이에요. {seller ? '회사 관리자가 승인하면 판매돼요.' : '확인 후 [저장하고 판매]를 누르면 승인돼요.'}</p>}
      {product?.review_note && <p className="warn">반려 사유: {product.review_note}</p>}

      <label>품목*
        <select value={form.item_code} onChange={set('item_code')}>
          <option value="">골라 주세요</option>
          {options.items.map((i) => <option key={i.item_code} value={i.item_code}>{i.category} · {i.name}</option>)}
        </select>
      </label>
      <ItemPreview item={item} />

      {!seller && (
        <label>판매 농가*
          <select value={form.seller_code} onChange={set('seller_code')}>
            <option value="">골라 주세요</option>
            {options.sellers.map((s) => <option key={s.seller_code} value={s.seller_code}>{s.name} · {s.region}</option>)}
          </select>
        </label>
      )}

      {isNew && (
        <label>상품 코드* <span className="muted">(영문 소문자·숫자·밑줄, 한 번 정하면 바꾸지 않아요)</span>
          <input value={form.product_code} onChange={set('product_code')} placeholder="예: apple_gift_5kg" />
        </label>
      )}
      <label>상품 이름*<input value={form.name} onChange={set('name')} placeholder="예: [예시] 사과 선물세트 5kg" /></label>
      <div className="row">
        <label>가격(원)*<input value={form.price} onChange={set('price')} inputMode="numeric" /></label>
        <label>판매 단위*<input value={form.unit} onChange={set('unit')} placeholder="예: 5kg 1박스" /></label>
        <label>재고*<input value={form.stock} onChange={set('stock')} inputMode="numeric" placeholder="없으면 0" /></label>
      </div>
      {unitPrice(form.price, form.unit) && <p className="muted">손님 화면에 {unitPrice(form.price, form.unit)} 로 함께 보여요 (가격을 바꾸면 가격 기준일도 오늘로)</p>}
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
      {item && item.category !== '가공품' && (
        <label>수확일<input type="date" value={form.harvest_date} onChange={set('harvest_date')} /></label>
      )}
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
            {saving ? '저장 중…' : product?.status === 'active' ? '저장 (바로 반영)' : '검토 요청'}
          </button>
        ) : (
          <button type="button" className="button" onClick={() => save('active')} disabled={saving}>{saving ? '저장 중…' : product?.status === 'pending' ? '승인하고 판매' : '저장하고 판매'}</button>
        )}
      </div>
    </div>
  )
}
