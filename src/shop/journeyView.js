// 배송 여정 카드(DeliveryJourney.jsx)의 화면용 변환. 날짜 계산은 하지 않는다.
//  - 출고·도착·주문일·마감 판단은 모두 main 의 deliveryPlan(./delivery.js) 결과를 그대로 쓴다
//  - 설정 값(마감 시각·출고 안 하는 요일·쉬는 날·출고까지 날 수·배송 날 수)은 관리자 [쇼핑몰 설정 > 배송](/api/policy 의 shipping)을 읽기만 한다
// 여기서 하는 일: 결제할 날을 고르면 그날 기준으로 deliveryPlan 을 부르기, 띠 칸(날짜·쉬는 날 표시) 만들기, 날짜 글자 모양
import { addDays, deliveryPlan, koreaNow, weekday } from './delivery.js'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
export const weekName = (day) => WEEK[weekday(day)]
// "11.25(수)"
export const shortDay = (day) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}(${weekName(day)})`
// 두 날짜 사이 날 수 (화면에 "결제일부터 ○일", "수확 ○일째"를 보여 줄 때만 쓴다)
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

// 이 날이 출고하는 날인지: 규칙을 따로 만들지 않고 main 의 deliveryPlan 에 직접 묻는다
// (그날 09시·마감 24시·출고까지 0일로 부르면 cutoffToday = '그날이 출고일인가'. 설정이 비었을 때의 기본값도 main 과 똑같이 따라간다)
const isShipDay = (day, shipping) => deliveryPlan({ ...shipping, cutoffHour: 24, leadDays: 0 }, { now: new Date(`${day}T00:00:00Z`) }).cutoffToday
// 출고 쉬는 날이면 이름, 출고하는 날이면 null
export function restName(day, shipping) {
  if (isShipDay(day, shipping)) return null
  if ((shipping?.holidays ?? []).includes(day)) return '쉬는 날'
  return weekday(day) === 0 || weekday(day) === 6 ? '주말' : '출고 쉼'
}

// 주문일 다음 날부터 출고일까지 출고하는 날 수 (deliveryPlan 이 정한 두 날짜 사이를 세기만 한다 → 설정이 비어도 main 과 같은 값)
export function shipDaysBetween(orderDay, shipDate, shipping) {
  let n = 0
  for (let d = addDays(orderDay, 1); d <= shipDate; d = addDays(d, 1)) if (!restName(d, shipping)) n += 1
  return n
}

// 결제 시점별 배송 계획: day 가 없으면 지금, 있으면 그날 오전 10시(한국 시간)에 결제한다고 보고 deliveryPlan 을 부른다
export function planFor(shipping, { day = null, shipFrom = null, now = new Date() } = {}) {
  const at = day ? new Date(`${day}T01:00:00Z`) : now // 10:00 KST
  return deliveryPlan(shipping, { now: at, shipFrom })
}

// 오늘 마감까지 남은 분 (마감 전 출고일일 때만 숫자, 아니면 null). plan.cutoffToday·cutoffHour 는 deliveryPlan 결과
export function minutesToCutoff(plan, now = new Date()) {
  if (!plan?.cutoffToday) return null
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  const left = plan.cutoffHour * 60 - (kst.getUTCHours() * 60 + kst.getUTCMinutes())
  return left > 0 ? left : null
}
export const todayKorea = (now = new Date()) => koreaNow(now).date

// 띠에 그릴 날들: 결제한 날 → 도착 예정일. 예약 상품처럼 길면 가운데 날들을 '…' 한 칸으로 접는다
export function journeyStrip(plan, shipping, from, maxCells = 11) {
  const last = plan.arriveDate
  const make = (day) => ({ day, rest: restName(day, shipping) })
  const total = daysBetween(from, last) + 1
  if (total <= maxCells) return Array.from({ length: total }, (_, i) => make(addDays(from, i)))
  // 앞: 결제한 날·주문으로 치는 날, 뒤: 출고 하루 전부터 도착까지
  const headEnd = plan.orderDay > from ? plan.orderDay : from
  const tailStart = addDays(plan.shipDate, -1)
  if (tailStart <= headEnd) return Array.from({ length: total }, (_, i) => make(addDays(from, i)))
  const head = []
  for (let d = from; d <= headEnd; d = addDays(d, 1)) head.push(make(d))
  const tail = []
  for (let d = tailStart; d <= last; d = addDays(d, 1)) tail.push(make(d))
  const skipped = daysBetween(headEnd, tailStart) - 1
  return skipped > 0 ? [...head, { gap: skipped }, ...tail] : [...head, ...tail]
}

// 날짜가 띠의 몇 번째 칸인지 (접힌 '…' 칸 안의 날이면 그 칸)
export const cellIndex = (cells, day) => cells.findIndex((c, i) => (c.gap ? cells[i - 1].day < day && day < cells[i + 1].day : c.day === day))
