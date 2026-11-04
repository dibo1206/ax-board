// 한 상품(옵션 상품은 옵션마다)을 한 주문에 담을 수 있는 수 (서버 server/orders.js 의 MAX_QTY 와 같게)
export const MAX_QTY = 20

// 쇼핑 화면 공통: API 호출, 장바구니(브라우저에 저장), 외부 스크립트 불러오기, 주문 상태 이름
import { netFetch } from '../net.js'

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

// 판매 단위에서 전체 양을 읽어 100g·100ml당 가격을 낸다 (비싸지 않다는 걸 비교해 보이게)
// 예: '5kg 1박스' → 100g당 900원, '100ml × 30포' → 100ml당 1,067원, 양을 못 읽으면 null
export function unitPrice(price, unit) {
  const found = String(unit ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)(?![a-z])/i)
  if (!found || !Number(price)) return null
  const times = Number(String(unit).match(/[×x*]\s*(\d+)/i)?.[1] ?? 1)
  const big = /^(kg|l)$/i.test(found[2])
  const amount = Number(found[1]) * (big ? 1000 : 1) * times
  if (!amount) return null
  return `${/g/i.test(found[2]) ? '100g' : '100ml'}당 ${won(Math.round((Number(price) / amount) * 100))}`
}

// 판매 옵션(5kg·10kg …): 옵션 이름이 판매 단위 역할을 한다. 목록에는 가장 낮은 가격을 "~부터"로 보여 준다
export const cheapestOption = (product) => (product.options?.length ? product.options.reduce((a, b) => (b.price < a.price ? b : a)) : null)
export const optionLabel = (name, optionName) => (optionName ? `${name} · ${optionName}` : name)

// 목록에는 서버가 만든 400px 썸네일을 쓴다 (예전 png·jpg 사진은 그대로)
export const thumbUrl = (url) => (url?.endsWith('.webp') ? url.replace(/\.webp$/, '-thumb.webp') : url)

export async function get(path) {
  const response = await netFetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `요청이 실패했어요 (${response.status})`), { status: response.status })
  return data
}

export const post = (path, body, timeoutMs) => send('POST', path, body, timeoutMs)

export async function send(method, path, body, timeoutMs) {
  const response = await netFetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }, timeoutMs)
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `요청이 실패했어요 (${response.status})`), { status: response.status, errors: data.errors, pending: data.pending === true })
  }
  return data
}

// 로그인한 회원 (없으면 null). 로그인·로그아웃하면 'account-change' 이벤트로 다시 읽는다
let accountPromise
export function getAccount() {
  accountPromise ??= get('/account/me').catch(() => null)
  return accountPromise
}
if (typeof window !== 'undefined') window.addEventListener('account-change', () => { accountPromise = null })

let policyPromise
export function getPolicy() {
  policyPromise ??= get('/policy').catch((error) => {
    policyPromise = null
    throw error
  })
  return policyPromise
}

// ---------- 장바구니: [{ productCode, optionId, quantity }]. 가격은 저장하지 않는다 (주문할 때 서버가 다시 계산) ----------
// optionId 는 옵션 상품에서 고른 옵션 (옵션 없는 상품은 null). 같은 상품이라도 옵션이 다르면 다른 줄이다
const CART_KEY = 'farm-cart'

export function readCart() {
  try {
    const items = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(items)
      ? items.filter((i) => typeof i?.productCode === 'string' && Number.isInteger(i.quantity) && i.quantity > 0)
        .map((i) => ({ ...i, optionId: Number.isInteger(i.optionId) ? i.optionId : null }))
      : []
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

export const sameLine = (a, b) => a.productCode === b.productCode && a.optionId === b.optionId

export function addToCart(productCode, quantity, optionId = null) {
  const items = readCart()
  const found = items.find((i) => sameLine(i, { productCode, optionId }))
  if (found) found.quantity = Math.min(MAX_QTY, found.quantity + quantity)
  else items.push({ productCode, optionId, quantity })
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

// 반품 신청 상태와 돌려준 돈 종류 (server/returns.js, server/orders.js)
export const RETURN_STATUS = { requested: '반품 신청됨', approved: '반품 승인', rejected: '반품 거절', refunded: '반품 환불 완료' }
export const REFUND_KIND = { cancel: '농가별 취소', return: '반품 환불', full: '주문 취소' }
// 오늘 한국 날짜 'YYYY-MM-DD' (반품 신청 마감일과 비교. 실제 기간 검사는 서버가 한다)
export const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '')
