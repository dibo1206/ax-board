// 상품 상세의 배송 여정 카드 ('신선 여정 띠'). 디자인만 맡고 날짜는 계산하지 않는다.
//  - 출고·도착·주문일·마감은 main 의 deliveryPlan(./delivery.js) 결과 하나만 쓴다 → 가격 밑 배송 문구·[배송·소비기한] 칸과 같은 날짜
//  - 설정(마감 시각·출고 안 하는 요일·쉬는 날·출고까지 날 수·배송 날 수·택배사)은 관리자 [쇼핑몰 설정 > 배송] 값을 읽기만 한다
//  - 화면용 변환(결제일 고르기·띠 칸·날짜 글자)은 ./journeyView.js
// 띠: 하루 한 칸, 출고 쉬는 날은 빗금. 아래 세 줄에 주문(접수)·준비 / 출고 / 도착. 띠 끝은 '받는 날 할 일'(보관·신선도 확인)로 이어진다
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPolicy } from './shared.js'
import { addDays, dayLabel } from './delivery.js'
import { storageSteps } from './detailFacts.js'
import { cellIndex, daysBetween, journeyStrip, minutesToCutoff, planFor, restName, shipDaysBetween, shortDay, todayKorea, weekName } from './journeyView.js'
import './deliveryJourney.css'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
// 품목 기준표 보관법의 첫 단계 (글은 바꾸지 않고 잘라서만 쓴다). 번호 단계로 나뉘면 main 의 storageSteps 첫 단계
const firstTip = (text) => storageSteps(text)?.[0] ?? String(text ?? '').split(/\.(?:\s+|$)/)[0]?.trim()

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// 결제일 칩 줄: 옆으로 더 있는지 (양 끝 흐림·화살표 표시용)
function useScrollEdges() {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  })
  const nudge = (dir) => ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.6), behavior: 'smooth' })
  return { ref, edges, nudge }
}

// 띠 위 막대 (칸 번호는 0부터, 접힌 '…' 칸도 한 칸)
function Bar({ k, from, to, label, cells }) {
  if (from < 0 || to < from) return null
  return (
    <span className={`dlv-bar ${k}`} data-k={k} style={{ gridColumn: `${from + 1} / ${to + 2}` }} title={label}>
      {to - from + 1 >= (cells > 9 ? 2 : 1) && <span>{label}</span>}
    </span>
  )
}

export function DeliveryJourney({ product, onFreshGuide }) {
  const [policy, setPolicy] = useState(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState('now') // 'now' 또는 결제할 날 'YYYY-MM-DD'
  const now = useNow()
  const chips = useScrollEdges()
  useEffect(() => {
    getPolicy().then(setPolicy).catch(() => setFailed(true))
  }, [])

  const s = policy?.shipping
  const day = picked === 'now' ? null : picked
  const plan = useMemo(
    () => (s ? planFor(s, { day, shipFrom: product.ship_from, now }) : null),
    // 지금(now)은 30초마다 바뀌므로 '지금'을 볼 때만 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, day, product.ship_from, day ? 0 : now],
  )
  const cells = useMemo(() => (plan ? journeyStrip(plan, s, plan.today) : []), [plan, s])

  // 설정을 못 읽으면 그리지 않는다 (main 의 가격 밑 배송 문구·[배송·소비기한] 칸과 같은 조건)
  if (failed || (policy && !s)) return null
  if (!plan) return <div className="dlv dlv-loading" aria-hidden="true" />

  const today = todayKorea(now)
  const from = plan.today // 결제한 날 ('지금'이면 오늘, 고른 날이면 그날)
  const iOrder = cellIndex(cells, plan.orderDay)
  const iShip = cellIndex(cells, plan.shipDate)
  const iArrive = cellIndex(cells, plan.arriveDate)
  const left = picked === 'now' ? minutesToCutoff(plan, now) : null
  const choices = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1))
  const harvest = product.harvest_date?.slice(0, 10)
  const harvestDays = harvest ? daysBetween(harvest, plan.arriveDate) : null
  const { item } = product
  const tip = firstTip(item.storage_method || (item.category === '가공품' ? item.opened_note : ''))
  const noShip = [...(s.noShipDays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY[d]).join('·') // main 의 [배송·소비기한] 칸과 같은 순서
  const orderNote = plan.orderDay === from
    ? `${plan.cutoffHour}시 전 주문은 그날 주문`
    : restName(from, s) ? '출고 쉬는 날 주문 → 다음 출고일' : `${plan.cutoffHour}시 뒤 주문 → 다음 출고일`
  const stages = [
    { k: 'receive', name: '주문 접수', when: shortDay(plan.orderDay), note: orderNote },
    { k: 'prep', name: '준비·검수', when: plan.preorder ? `${shortDay(plan.shipDate)} 전까지` : '출고 전까지', note: '농가에서 고르고 포장' },
    { k: 'ship', name: '출고·배송', when: shortDay(plan.shipDate), note: plan.preorder ? '예약 상품 출고 시작일' : plan.shipDate === plan.orderDay ? '주문한 날 출고' : `주문일부터 출고일 ${shipDaysBetween(plan.orderDay, plan.shipDate, s)}일 뒤` },
    { k: 'arrive', name: '도착 예정', when: shortDay(plan.arriveDate), note: `출고 뒤 보통 ${s.transitDays ?? 1}일 · ${s.courier}` },
  ]

  return (
    <section className="dlv" aria-labelledby="dlv-title">
      <div className="dlv-head">
        <div>
          <p className="dlv-eyebrow"><span className="dlv-arrive-tag">도착 예정</span>{picked === 'now' ? '지금 주문하면' : `${shortDay(picked)} 오전에 주문하면`}</p>
          <h3 id="dlv-title" className="dlv-arrive" aria-live="polite">{dayLabel(plan.arriveDate)}</h3>
          <p className="dlv-sub">
            {plan.preorder
              ? <>예약 판매 · <strong>{shortDay(plan.shipDate)}</strong> 출고 시작일부터 보내요</>
              : <>출고 <strong>{shortDay(plan.shipDate)}</strong> · 결제일부터 {daysBetween(from, plan.arriveDate)}일</>}
          </p>
        </div>
        {left != null ? (
          <p className="dlv-clock" role="status">
            <small>오늘 {plan.cutoffHour}시 주문 마감</small>
            <strong>{Math.floor(left / 60) > 0 && `${Math.floor(left / 60)}시간 `}{left % 60}분 남음</strong>
          </p>
        ) : picked === 'now' && plan.orderDay !== from && (
          <p className="dlv-clock off" role="status">
            <small>{restName(from, s) ? '오늘은 출고하지 않는 날이에요' : `오늘 ${plan.cutoffHour}시 주문 마감이 지났어요`}</small>
            <strong>{shortDay(plan.orderDay)} 주문으로 쳐요</strong>
          </p>
        )}
      </div>

      <div className={`dlv-when-wrap${chips.edges.left ? ' more-left' : ''}${chips.edges.right ? ' more-right' : ''}`}>
        <span className="dlv-when-label" id="dlv-when-label">결제일 바꿔 보기</span>
        <div className="dlv-when-scroll">
          <div className="dlv-when" role="group" aria-labelledby="dlv-when-label" ref={chips.ref}>
            <button type="button" aria-pressed={picked === 'now'} onClick={() => setPicked('now')}>지금</button>
            {choices.map((d) => (
              <button key={d} type="button" aria-pressed={picked === d} className={restName(d, s) ? 'rest' : ''} onClick={() => setPicked(d)} title={restName(d, s) ? `${restName(d, s)} — 출고 쉬는 날` : '출고하는 날'}>
                <span>{weekName(d)}</span>{Number(d.slice(8))}
              </button>
            ))}
          </div>
          {/* 옆으로 더 있으면 양 끝을 흐리게 하고 화살표를 보인다 (손가락으로 밀어도 된다) */}
          <button type="button" className="dlv-when-nudge prev" tabIndex={-1} aria-hidden="true" onClick={() => chips.nudge(-1)}>‹</button>
          <button type="button" className="dlv-when-nudge next" tabIndex={-1} aria-hidden="true" onClick={() => chips.nudge(1)}>›</button>
        </div>
      </div>

      {/* 하루 한 칸 띠: 위는 날짜(출고 쉬는 날은 빗금), 아래 세 줄은 주문·준비 / 출고 / 도착 */}
      <div className="dlv-strip" key={`${from}-${plan.orderDay}`} style={{ '--cells': cells.length }} role="img"
        aria-label={`${dayLabel(plan.orderDay)} 주문 접수, ${dayLabel(plan.shipDate)} 출고, ${dayLabel(plan.arriveDate)} 도착 예정. 빗금 칸은 출고 쉬는 날`}>
        <div className="dlv-days">
          {cells.map((c, i) => c.gap ? (
            <span key="gap" className="dlv-day gap" title={`${c.gap}일 건너뜀`}><b>⋯</b><small>{c.gap}일</small></span>
          ) : (
            <span key={c.day} className={`dlv-day${c.rest ? ' rest' : ''}${c.day === today ? ' today' : ''}${i === iArrive ? ' arrive' : ''}`} title={`${dayLabel(c.day)}${c.rest ? ` · ${c.rest} (출고하지 않음)` : ''}`}>
              <small>{weekName(c.day)}</small><b>{Number(c.day.slice(8))}</b>
              {c.rest === '쉬는 날' && <em>쉬는 날</em>}
            </span>
          ))}
        </div>
        <div className="dlv-lanes">
          {/* 주문 접수일은 결제일과 다를 수 있다 (주말·오후 2시 이후 결제 → 다음 출고일). 알약은 실제 주문 접수일 칸에 */}
          {iOrder >= 0 && <span className="dlv-pill" style={{ gridColumn: iOrder + 1, gridRow: 1 }} title={`주문 접수 ${dayLabel(plan.orderDay)}`}>주문 접수</span>}
          {iShip - iOrder > 1 && <Bar k="prep" from={iOrder + 1} to={iShip - 1} label="준비·검수" cells={cells.length} />}
          <Bar k="ship" from={iShip} to={iShip} label="출고" cells={cells.length} />
          <Bar k="arrive" from={iArrive} to={iArrive} label="도착" cells={cells.length} />
        </div>
      </div>

      <ol className="dlv-stages">
        {stages.map((st, i) => (
          <li key={st.k} data-k={st.k}>
            <span className="dlv-step">{i + 1}</span>
            <span className="dlv-stage-name">{st.name}</span>
            <strong>{st.when}</strong>
            <small>{st.note}</small>
          </li>
        ))}
      </ol>

      {/* 배송 일정 → 신선도: 받는 날 할 일 */}
      <div className="dlv-bridge">
        <p>
          <strong>받는 날</strong> 상자를 바로 열어 상태를 확인해 주세요.
          {tip && <> {tip}.</>}
          {harvestDays != null && harvestDays >= 0 && <span className="dlv-harvest"> 수확 {harvestDays}일째 무렵 받아요 (수확일 {harvest} 기준 예상)</span>}
        </p>
        {onFreshGuide && <button type="button" className="dlv-bridge-link" onClick={onFreshGuide}>신선도 확인법 보기 <span aria-hidden="true">↓</span></button>}
      </div>

      <p className="dlv-foot">
        날짜는 예상이에요. 택배사 사정·날씨·주문이 몰릴 때는 하루 이틀 늦어질 수 있어요.
        기준: 쇼핑몰 배송 설정 (출고일 {plan.cutoffHour}시 마감{noShip && ` · ${noShip}요일·쉬는 날 출고 안 함`} · {s.courier}).
      </p>
    </section>
  )
}
