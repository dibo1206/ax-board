// 배송 달력과 소비기한 날짜 계산 (2026-11-20). 화면 없이 날짜만 계산한다 (scripts/extras-test.js 가 그대로 불러 시험한다)
// 설정 값은 관리자 [쇼핑몰 설정 > 배송]: cutoffHour·leadDays·transitDays·noShipDays·holidays (server/policy.js 의 DEFAULT_SHIPPING)
// 날짜는 모두 한국 시간 기준 'YYYY-MM-DD' 글자로 다룬다 (손님 컴퓨터 시간대와 상관없이 같은 답)

const DAY = 86_400_000
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

// 지금 한국 날짜와 시(0~23)
export function koreaNow(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  return { date: kst.toISOString().slice(0, 10), hour: kst.getUTCHours() }
}
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay()
// 11월 22일 (토)
export const dayLabel = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAY[weekday(date)]})`

const settingsOf = (s = {}) => ({
  cutoffHour: Number.isInteger(s.cutoffHour) ? s.cutoffHour : 14,
  leadDays: Number.isInteger(s.leadDays) ? s.leadDays : 1,
  transitDays: Number.isInteger(s.transitDays) ? Math.max(1, s.transitDays) : 1,
  noShipDays: Array.isArray(s.noShipDays) && s.noShipDays.length < 7 ? s.noShipDays : [0, 6],
  holidays: new Set(Array.isArray(s.holidays) ? s.holidays : []),
})

// 이 날짜 당일 또는 그 뒤 첫 날 중 ok 인 날 (1년 안에서만 찾는다)
function firstFrom(date, ok) {
  let d = date
  for (let i = 0; i < 366 && !ok(d); i += 1) d = addDays(d, 1)
  return d
}
// date 다음부터 ok 인 날을 n 번 센 날
function countAfter(date, n, ok) {
  let d = date
  for (let left = n; left > 0;) {
    d = addDays(d, 1)
    if (ok(d)) left -= 1
  }
  return d
}

// 지금 주문하면 언제 출고·도착하는지
//  - 마감(cutoffHour 시) 전이고 오늘이 출고일이면 오늘 주문으로, 아니면 다음 출고일 주문으로 친다
//  - 그 날부터 출고일(noShipDays·holidays 제외)을 leadDays 번 센 날 출고 (0 이면 그날)
//  - 예약 상품은 출고 시작일(shipFrom) 전에 보내지 않는다 → 둘 중 늦은 출고일
//  - 도착은 출고 뒤 transitDays 번째 배송일 (택배는 일요일·쉬는 날 배송하지 않는다고 본다)
// 반환: { orderDay, cutoffToday, shipDate, arriveDate, preorder }
export function deliveryPlan(shipping, { now = new Date(), shipFrom = null } = {}) {
  const s = settingsOf(shipping)
  const shipOk = (d) => !s.noShipDays.includes(weekday(d)) && !s.holidays.has(d)
  const deliverOk = (d) => weekday(d) !== 0 && !s.holidays.has(d)
  const { date: today, hour } = koreaNow(now)
  const cutoffToday = shipOk(today) && hour < s.cutoffHour
  const orderDay = cutoffToday ? today : countAfter(today, 1, shipOk)
  let shipDate = s.leadDays > 0 ? countAfter(orderDay, s.leadDays, shipOk) : orderDay
  const preorder = Boolean(shipFrom && /^\d{4}-\d{2}-\d{2}/.test(shipFrom) && String(shipFrom).slice(0, 10) > shipDate)
  if (preorder) shipDate = firstFrom(String(shipFrom).slice(0, 10), shipOk)
  const arriveDate = countAfter(shipDate, s.transitDays, deliverOk)
  return { today, orderDay, cutoffToday, cutoffHour: s.cutoffHour, shipDate, arriveDate, preorder }
}

// 소비기한 안내 글에서 "받은 날부터 며칠"을 읽는다. 확실할 때만 숫자를 내고, 아니면 null (글 그대로 보여 준다)
//  - 받은 날(수령·받은·도착·냉장 보관) 기준 글만 읽는다. 제조일 기준·익은 뒤 기준·[예시] 글은 읽지 않는다
//  - 범위(2~3주)는 짧은 쪽(2주)으로 잡는다. 일·주·개월(30일)
export function expiryDays(text) {
  const t = String(text ?? '')
  if (!t || /\[예시\]|제조|익은 ?뒤|익으면|후숙|개봉/.test(t)) return null
  if (!/수령|받은|받으|받고|도착|냉장/.test(t)) return null
  const m = t.match(/(\d+)\s*(?:[~-]\s*\d+\s*)?(일|주|개월|달)/)
  if (!m) return null
  const n = Number(m[1])
  const days = m[2] === '일' ? n : m[2] === '주' ? n * 7 : n * 30
  return days > 0 && days <= 730 ? days : null
}

// 도착일 기준 소비기한 날짜 (읽을 수 없으면 null). 받은 날을 1일째로 센다 → 3일이면 도착일 + 2일
export function expiryDate(arriveDate, text) {
  const days = expiryDays(text)
  return days ? addDays(arriveDate, days - 1) : null
}
