// 백엔드가 없으므로 주문 문의는 브라우저 localStorage에만 저장한다.
const INQUIRIES_KEY = 'farm-site:inquiries'

export function loadInquiries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INQUIRIES_KEY))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveInquiry(inquiry) {
  const next = [...loadInquiries(), { id: `q-${Date.now()}`, createdAt: new Date().toISOString(), ...inquiry }]
  localStorage.setItem(INQUIRIES_KEY, JSON.stringify(next))
  return next
}
