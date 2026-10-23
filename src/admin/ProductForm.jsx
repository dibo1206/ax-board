import { useState } from 'react'
import { adminApi } from './api.js'

const EMPTY = {
  product_code: '', seller_code: '', item_code: '', name: '', price: '', unit: '', stock: '',
  weight_g: '', count_per_box: '', brix: '', brix_measured_at: '', harvest_date: '', summary: '',
  external_url: '', b2b_available: false, tags: [],
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
      {item.fresh_days_stage1 && <p>신선도: {item.fresh_days_stage1}일까지 {item.stage1_uses.join('·')} → {item.fresh_days_stage2}일까지 {item.stage2_uses.join('·')}</p>}
      {item.opened_note && <p>개봉 후: {item.opened_note}</p>}
      <p>레시피 {item.recipes.length}개{item.allergens.length > 0 && ` · 알레르기: ${item.allergens.join(', ')}`}</p>
      {!item.reviewed_by && <p className="warn">식품팀 검수 전 정보예요</p>}
    </div>
  )
}

export function ProductForm({ product, options, onCancel, onSaved }) {
  const isNew = !product
  const [form, setForm] = useState(() => toForm(product))
  const [errors, setErrors] = useState([])
  const [image, setImage] = useState(null)
  const [saving, setSaving] = useState(false)

  const item = options.items.find((i) => i.item_code === form.item_code)
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const toggleTag = (code) => setForm((prev) => ({
    ...prev,
    tags: prev.tags.includes(code) ? prev.tags.filter((t) => t !== code) : [...prev.tags, code],
  }))

  async function save(status) {
    setSaving(true)
    setErrors([])
    try {
      const body = { ...form, status }
      const saved = isNew
        ? await adminApi('/products', { method: 'POST', body })
        : await adminApi(`/products/${product.product_code}`, { method: 'PATCH', body })
      if (image) {
        await adminApi(`/products/${saved.product_code}/image`, {
          method: 'POST',
          headers: { 'Content-Type': image.type },
          body: image,
        })
      }
      onSaved(saved, status === 'draft' ? '임시 저장했어요 (소비자 화면에는 안 보여요)' : '저장했어요')
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

      <label>품목*
        <select value={form.item_code} onChange={set('item_code')}>
          <option value="">골라 주세요</option>
          {options.items.map((i) => <option key={i.item_code} value={i.item_code}>{i.category} · {i.name}</option>)}
        </select>
      </label>
      <ItemPreview item={item} />

      <label>판매 농가*
        <select value={form.seller_code} onChange={set('seller_code')}>
          <option value="">골라 주세요</option>
          {options.sellers.map((s) => <option key={s.seller_code} value={s.seller_code}>{s.name} · {s.region}</option>)}
        </select>
      </label>

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
      <label>한 줄 소개<input value={form.summary} onChange={set('summary')} /></label>
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

      <label>상품 사진 (jpg·png·webp, 2MB 이하)
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
      </label>
      {!image && product?.image_url && <img className="thumb" src={product.image_url} alt="현재 사진" />}

      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      <div className="actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>취소</button>
        <button type="button" className="button ghost" onClick={() => save('draft')} disabled={saving}>임시 저장</button>
        <button type="button" className="button" onClick={() => save('active')} disabled={saving}>{saving ? '저장 중…' : '저장하고 판매'}</button>
      </div>
    </div>
  )
}
