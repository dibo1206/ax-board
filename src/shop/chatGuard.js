// 상담하기 버튼 피하기 (상품 상세 전용). 상담 기능(Chat.jsx)·공통 스타일은 건드리지 않고, 버튼의 자리만 상품 페이지에서 옮긴다.
// 위치 규칙은 deliveryJourney.css 의 html[data-dlv-chat…] 규칙이 맡는다. 날짜 계산과는 상관없다
import { createElement, useEffect, useState } from 'react'
import './deliveryJourney.css'

// 화면 오른쪽 아래에 떠 있는 [상담하기] 버튼(Chat.jsx)이 상품 페이지의 '보호 구역'을 가리지 않게, 겹치는 순간에만 안전한 자리로 옮긴다.
// 보호 구역 = 배송 카드(.dlv) + 구매 칸(.buy: 옵션·수량·장바구니·구매 버튼, 품절이면 재입고 알림) + 구매 옆 버튼(.buy-aside)
//            + 그 바로 아래 상품 설명 탭 줄(.detail-tabs) + 찜·공유 버튼(.detail-actions). 그 요소들의 코드는 건드리지 않고 위치만 읽는다
// 버튼은 숨기지 않고(늘 그려져 있고 누를 수 있다) 상담 기능·마우스 올리기 움직임(shop.css)도 덮어쓰지 않는다.
// <html data-dlv-chat> 와 --dlv-* 값만 바꾸고, deliveryJourney.css 가 상품 페이지에서만 그 값으로 위치를 잡는다
//  - 'gap' : 사진 | 정보 두 칸 배치(861px 이상)에서 오른쪽 정보 칸이 버튼 자리에 오면
//            → 두 칸 사이 간격(48px)에 48×48 동그란 말풍선 아이콘. 마우스를 올리면 왼쪽(사진 칸 아래 빈 곳)으로 가로로 펼쳐 '상담하기'를 보인다.
//              사진(갤러리)이 바로 위에 있으면 사과 캐릭터가 사진에 닿지 않을 만큼만 덜 올라온다(--dlv-mascot-sink).
//              여유가 너무 적으면(사진이 버튼 높이까지 내려와 있는 짧은 화면) 'dock' 으로
//  - 'dock': 한 칸 배치(모바일) 등 → 원래 글자 버튼 그대로 보호 구역 전체(탭 줄까지)의 바로 아래에 붙어 있다가 보호 구역이 지나가면 원래 자리로
//            (보호 구역이 화면을 꽉 채우는 동안은 그 아래쪽에서 기다린다)
const CHAT_GAP = 12
// 마우스가 있는 화면에서는 버튼에 올리면 사과 캐릭터가 버튼 위로 약 53px 올라온다 → 보호 구역 아래에 붙일 때 그만큼 띄워 가리지 않게
const MASCOT_GAP = 60
const MASCOT_RISE = 52.5 // shop.css: 캐릭터 70px 중 버튼 윗변 위로 보이는 높이 (70 - 17.5)
const MASCOT_MIN = 20 // 캐릭터가 이만큼(머리)은 보여야 아이콘 모드를 쓴다
const ICON = 48
const PROTECT = ['.detail-actions', '.dlv', '.buy', '.buy-aside', '.detail-tabs']
function useAvoidChatButton(node) {
  useEffect(() => {
    const root = document.documentElement
    const hoverable = window.matchMedia('(hover: hover)')
    let frame = 0
    let natural = null // 옮기기 전 버튼 크기·위치 (모양을 바꾼 뒤에는 다시 재지 않는다)
    const reset = () => {
      root.removeAttribute('data-dlv-chat')
      root.style.removeProperty('--dlv-chat-right')
      root.style.removeProperty('--dlv-chat-bottom')
      root.style.removeProperty('--dlv-mascot-sink')
    }
    const measure = (button) => {
      reset()
      root.style.removeProperty('--dlv-chat-w')
      root.style.removeProperty('--dlv-chat-h')
      // 원래 크기는 보이지 않는 복제본으로 잰다: 진짜 버튼은 전환 애니메이션 중이면 여백·너비가 중간 값이라서
      const probe = button.cloneNode(true)
      probe.setAttribute('aria-hidden', 'true')
      probe.tabIndex = -1
      probe.style.cssText = 'visibility:hidden;pointer-events:none;transition:none;animation:none'
      button.after(probe)
      const style = getComputedStyle(probe)
      natural = { w: probe.offsetWidth, h: probe.offsetHeight, right: parseFloat(style.right) || 16, bottom: parseFloat(style.bottom) || 16 }
      probe.remove()
      // 원래 크기를 숫자로 적어 둔다: auto 너비는 애니메이션이 안 돼서, 아이콘 ↔ 글자 버튼 전환이 부드럽게 이어지도록
      root.style.setProperty('--dlv-chat-w', `${natural.w}px`)
      root.style.setProperty('--dlv-chat-h', `${natural.h}px`)
      // 아이콘에서 펼칠 너비: 글자(원래 너비 - 좌우 여백 48) + 왼쪽 여백 18 + 오른쪽 아이콘 자리 44
      root.style.setProperty('--dlv-chat-full', `${natural.w - 48 + 18 + 44}px`)
    }
    root.setAttribute('data-dlv-chat-on', '') // 상품 페이지에 있는 동안만 전환 애니메이션 규칙을 켠다
    const hits = (r, zone) => r.left < zone.right && r.right > zone.left && r.top < zone.bottom && r.bottom > zone.top
    const zoneFor = (vw, vh, gap) => ({ left: vw - natural.right - natural.w - 8, right: vw - natural.right, top: vh - natural.bottom - natural.h - gap, bottom: vh - natural.bottom })
    const check = () => {
      frame = 0
      const detail = node?.closest('.detail')
      const button = document.querySelector('.shop .chat-open')
      if (!detail || !button) { natural = null; return reset() }
      if (!natural) measure(button)
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      // 보호 구역: 화면에 그려진 것들을 하나로 묶은 사각형 (세로로 이어져 있다)
      const rects = PROTECT.map((sel) => detail.querySelector(sel)?.getBoundingClientRect()).filter((r) => r && r.width && r.height)
      const protectedRects = rects
      if (!rects.length) return reset()
      const block = { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) }
      const info = detail.querySelector('.detail-info')
      const gallery = info?.parentElement?.querySelector(':scope > .gallery')
      const ir = info?.getBoundingClientRect()
      const gr = gallery?.getBoundingClientRect()
      // 두 칸 배치: 사진 칸이 정보 칸 왼쪽에 나란히 있고, 그 사이 간격에 아이콘이 들어간다
      if (ir && gr && gr.right <= ir.left && ir.left - gr.right >= ICON && gr.top < ir.bottom) {
        // 정보 칸이 버튼 자리에 없으면: 아래 'dock' 검사로 (상품 설명 탭 줄처럼 화면 전체 폭인 보호 구역이 지나갈 때)
        if (!hits(ir, zoneFor(vw, vh, CHAT_GAP))) return dock(vw, vh, block)
        const iconTop = vh - natural.bottom - ICON - 2 // 마우스를 올리면 2px 떠오른다
        // 펼친 말풍선·캐릭터가 차지하는 가로 범위와 겹치는 사진·썸네일만 장애물로 센다 (썸네일 줄은 왼쪽에만 있다)
        const pillRight = ir.left - (ir.left - gr.right - ICON) / 2
        const pillLeft = pillRight - (natural.w - 48 + 18 + 44) - 6
        const obstacles = [...gallery.querySelectorAll('img.hero, .gallery-thumbs button')].map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.right > pillLeft && r.left < pillRight)
        const room = iconTop - Math.max(-Infinity, ...obstacles.map((r) => r.bottom)) // 사진 아래 끝과 아이콘 윗변 사이
        // 아이콘 자리(펼친 말풍선 포함)에 화면 전체 폭 보호 구역(상품 설명 탭 줄 등)이 걸리면 아이콘을 쓰지 않는다
        const iconBox = { left: pillLeft, right: pillRight, top: iconTop, bottom: vh - natural.bottom }
        const blocked = protectedRects.some((r) => hits(r, iconBox))
        if (room >= MASCOT_MIN && !blocked) {
          root.setAttribute('data-dlv-chat', 'gap')
          root.style.setProperty('--dlv-chat-right', `${Math.round(vw - ir.left + (ir.left - gr.right - ICON) / 2)}px`)
          root.style.setProperty('--dlv-mascot-sink', `${Math.max(0, Math.ceil(MASCOT_RISE + 2 - room))}px`)
          return undefined
        }
        // 사진이 아이콘 높이까지 내려와 있거나 아이콘 자리에 보호 구역이 걸리면 → 아래 'dock' 으로
      }
      return dock(vw, vh, block)
    }
    // 'dock': 보호 구역 전체의 바로 아래에 붙인다 (구역이 버튼 자리에 없으면 원래 자리)
    const dock = (vw, vh, block) => {
      const gap = hoverable.matches ? MASCOT_GAP : CHAT_GAP
      if (!hits(block, zoneFor(vw, vh, gap))) return reset()
      const bottom = Math.round(vh - (block.bottom + gap + natural.h))
      if (bottom >= natural.bottom) return reset() // 원래 자리가 이미 보호 구역보다 아래
      root.setAttribute('data-dlv-chat', 'dock')
      root.style.setProperty('--dlv-chat-bottom', `${bottom}px`)
      return undefined
    }
    const schedule = () => { frame ||= requestAnimationFrame(check) }
    const onResize = () => { natural = null; schedule() }
    check()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize)
    // 상담창을 열고 닫거나, 옵션을 골라 구매 칸 높이가 바뀌면 다시 잰다
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.shop .chat-open')) natural = null
      schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    // 글꼴(Pretendard)이 늦게 받아지면 버튼 글자 너비가 달라진다 → 다 받은 뒤 다시 잰다 (펼친 말풍선에 글자가 꼭 맞게)
    let alive = true
    document.fonts?.ready.then(() => { if (alive) onResize() })
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      reset()
      root.removeAttribute('data-dlv-chat-on')
      root.style.removeProperty('--dlv-chat-w')
      root.style.removeProperty('--dlv-chat-h')
      root.style.removeProperty('--dlv-chat-full')
    }
  }, [node])
}

// 상품 상세에 늘 붙여 두는 자리표 (품절이라 배송 카드가 없을 때도 구매 칸을 지킨다). 화면에는 아무것도 그리지 않는다
export function ChatButtonGuard() {
  const [node, setNode] = useState(null) // 이 자리표 요소 (상품 상세 안에 있는지 찾는 데만 쓴다)
  useAvoidChatButton(node)
  return createElement('span', { ref: setNode, hidden: true })
}
