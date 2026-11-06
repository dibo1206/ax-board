// 예약 판매: 상품의 출고 시작일(ship_from)이 오늘(한국 날짜)보다 뒤면 예약 상품이다.
// 주문할 때 그 날짜를 주문 상품·농가 배송에 남겨서, 나중에 농가가 날짜를 바꿔도 손님에게 약속한 날짜가 남는다
export const koreaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

const day = (date) => (date ? String(date).slice(0, 10) : null)

// 오늘보다 뒤인 출고 시작일만 예약으로 본다 (날짜가 지나면 보통 상품처럼 바로 보낸다)
export const isPreorder = (date, today = koreaToday()) => Boolean(day(date) && day(date) > today)

// "11월 20일" (같은 해가 아니면 "2027년 1월 5일")
export function shipDateText(date, today = koreaToday()) {
  const d = day(date)
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  return `${y === Number(today.slice(0, 4)) ? '' : `${y}년 `}${m}월 ${dd}일`
}

// 손님에게 보여 줄 출고 안내 한 줄
export const preorderNote = (date) => `예약 상품이에요. ${shipDateText(date)}부터 주문 순서대로 보내요`

// 한 농가 몫에 예약 상품이 섞이면 그 농가는 가장 늦은 날짜에 한꺼번에 보낸다 [가설: 따로 보낼지는 농가·회사가 정함]
export function farmShipFrom(lines, today = koreaToday()) {
  const dates = lines.map((l) => day(l.ship_from)).filter((d) => d && d > today).sort()
  return dates.length ? dates.at(-1) : null
}
