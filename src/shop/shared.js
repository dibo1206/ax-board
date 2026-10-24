// 쇼핑 화면 공통: API 호출, 장바구니(브라우저에 저장), 외부 스크립트 불러오기, 주문 상태 이름
export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

export async function get(path) {
  const response = await fetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `요청이 실패했어요 (${response.status})`), { status: response.status })
  return data
}

export async function post(path, body) {
  const response = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `요청이 실패했어요 (${response.status})`), { status: response.status, errors: data.errors })
  return data
}

let policyPromise
export function getPolicy() {
  policyPromise ??= get('/policy').catch((error) => {
    policyPromise = null
    throw error
  })
  return policyPromise
}

// ---------- 장바구니: [{ productCode, quantity }]. 가격은 저장하지 않는다 (주문할 때 서버가 다시 계산) ----------
const CART_KEY = 'farm-cart'

export function readCart() {
  try {
    const items = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(items) ? items.filter((i) => typeof i?.productCode === 'string' && Number.isInteger(i.quantity) && i.quantity > 0) : []
  } catch {
    return []
  }
}

export function writeCart(items) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등): 장바구니만 안 남는다
  }
  window.dispatchEvent(new Event('cart-change'))
}

export function addToCart(productCode, quantity) {
  const items = readCart()
  const found = items.find((i) => i.productCode === productCode)
  if (found) found.quantity = Math.min(99, found.quantity + quantity)
  else items.push({ productCode, quantity })
  writeCart(items)
}

export const cartCount = () => readCart().reduce((sum, i) => sum + i.quantity, 0)

// 결제 중인 주문 (결제창에서 돌아왔을 때 어떤 주문인지 알기 위해)
export function savePending(pending) {
  try {
    sessionStorage.setItem('farm-pending', JSON.stringify(pending))
  } catch {
    // 저장이 막혀도 결제는 진행된다
  }
}

export function takePending() {
  try {
    const value = JSON.parse(sessionStorage.getItem('farm-pending') ?? 'null')
    sessionStorage.removeItem('farm-pending')
    return value
  } catch {
    return null
  }
}

const loading = new Map()
export function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = () => {
        loading.delete(src)
        reject(new Error('스크립트를 불러오지 못했어요.'))
      }
      document.head.append(script)
    }))
  }
  return loading.get(src)
}

export const ORDER_STATUS = {
  pending: '결제 전',
  paid: '결제 완료',
  preparing: '배송 준비 중',
  shipping: '배송 중',
  delivered: '배송 완료',
  cancelled: '취소됨',
  failed: '결제 실패',
  expired: '시간 초과',
}

export const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '')
