import { useEffect, useState } from 'react'
import { adminApi } from './api.js'
import { ProductForm } from './ProductForm.jsx'

// 관리자 화면: 로그인 → 상품 목록 → 등록·수정. 모든 요청은 /api/admin (로그인 쿠키 필요)
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

function Login({ onLogin }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    try {
      const me = await adminApi('/login', { method: 'POST', body: { loginId, password } })
      onLogin(me)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <form className="box form" onSubmit={submit}>
      <h2>관리자 로그인</h2>
      <label>아이디<input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" /></label>
      <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="button">로그인</button>
    </form>
  )
}

function Admin() {
  const [me, setMe] = useState(undefined)
  const [products, setProducts] = useState([])
  const [options, setOptions] = useState(null)
  const [editing, setEditing] = useState(null) // null: 목록, 'new': 새 상품, 객체: 수정
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi('/me').then(setMe).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    if (!me) return
    Promise.all([adminApi('/products'), adminApi('/options')])
      .then(([list, opts]) => { setProducts(list); setOptions(opts) })
      .catch((e) => (e.status === 401 ? setMe(null) : setError(e.message)))
  }, [me])

  async function refresh(text) {
    setProducts(await adminApi('/products'))
    setEditing(null)
    setMessage(text)
  }

  async function logout() {
    await adminApi('/logout', { method: 'POST' })
    setMe(null)
  }

  async function quickStock(product, stock) {
    try {
      await adminApi(`/products/${product.product_code}`, { method: 'PATCH', body: { stock } })
      await refresh(`${product.name}: ${stock === 0 ? '품절로 표시했어요' : `재고 ${stock}개로 바꿨어요`}`)
    } catch (e) {
      setError(e.message)
    }
  }

  if (me === undefined) return <p className="muted">확인 중…</p>
  if (!me) return <Login onLogin={setMe} />

  return (
    <section>
      <div className="admin-head">
        <h2>상품 관리</h2>
        <span className="muted">{me.loginId} 로그인 중</span>
        <button type="button" className="link" onClick={logout}>로그아웃</button>
      </div>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {editing && options ? (
        <ProductForm
          product={editing === 'new' ? null : editing}
          options={options}
          onCancel={() => setEditing(null)}
          onSaved={(saved, text) => refresh(`${saved.name}: ${text}`)}
        />
      ) : (
        <>
          <button type="button" className="button" onClick={() => { setEditing('new'); setMessage('') }}>새 상품 등록</button>
          <table className="table">
            <thead>
              <tr><th>상품</th><th>가격</th><th>재고</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_code} className={p.sold_out ? 'dim' : ''}>
                  <td><strong>{p.name}</strong><br /><span className="muted">{p.category} · {p.seller_name}</span></td>
                  <td>{won(p.price)}</td>
                  <td>{p.sold_out ? <span className="badge soldout">품절</span> : `${p.stock}개`}</td>
                  <td>{p.status === 'draft' ? '임시 저장' : '판매 중'}</td>
                  <td className="row-actions">
                    <button type="button" onClick={() => { setEditing(p); setMessage('') }}>수정</button>
                    {p.sold_out ? null : <button type="button" onClick={() => quickStock(p, 0)}>품절 처리</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

export default Admin
