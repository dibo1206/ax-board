// 첫 화면 글·사진 (디자인 시안 그대로). 기획팀·디자인팀은 이 파일만 고치면 된다
// 사진: public/home/ 에 파일을 넣고 src 를 적는다. src 가 null 이면 빗금 자리표시('사진 필요')가 나온다
// hero 는 시안 캡처에서 잘라 낸 임시본(원본으로 바꾸기), 나머지는 기업 홈페이지(yunjufarm.co.kr) 사진 — 기업이 사용을 허락함

export const BRAND = { strong: 'YOONJU', light: 'MARKET', company: '윤주(주)농업회사법인', region: '충남 천안시 서북구', siteUrl: 'https://yunjufarm.co.kr/' }

export const HERO = {
  eyebrow: '윤주팜 로컬 마켓 · 매달 바뀌는 제철',
  title: ['이번 달,', '식탁에 올릴', '과일'],
  lead: '천안 농가에서 보내는 제철 과일세트와 농축액. 취향을 알려 주시면 맞는 상품을 골라 드립니다.',
  cta: '취향에 맞는 상품 추천받기',
  photo: { src: '/home/hero.webp', alt: '나무 접시 위의 배와 사과, 반으로 자른 배', need: 'home/hero.webp' },
  // 자동으로 넘어가는 배너 사진 (2400×720, 왼쪽 40%는 글씨 자리). position 은 화면이 낮을 때 어느 쪽을 남길지
  slides: [
    { src: '/home/hero-1.webp', alt: '물방울이 맺힌 배와 사과, 반으로 자른 배', position: 'center 40%', cover: true }, // cover: 배너를 꽉 채우고 위아래를 잘라 보여 준다(클로즈업)
    { src: '/home/hero-2.webp', alt: '자몽 에이드와 과일 농축액 병, 자몽', position: 'center 30%' },
    { src: '/home/hero-3.webp', alt: '배즙 파우치와 선물 상자, 반으로 자른 배', position: 'center 50%' },
    { src: '/home/hero-4.webp', alt: '배와 사과를 담은 선물세트 상자', position: 'center 40%', cover: true },
    { src: '/home/hero-5.webp', alt: '아침 안개 낀 사과 과수원과 수확한 사과 상자', position: 'center 50%', scrim: true, cover: true }, // 왼쪽이 복잡한 사진: 글씨가 읽히게 왼쪽만 옅게 덮는다
    { src: '/home/hero-6.webp', alt: '과일을 담아 보내는 배송 상자와 에코백', position: 'center 50%' },
  ],
  interval: 5000, // 자동으로 넘어가는 간격(ms)
}

// 카테고리 사진 (카테고리 이름·설명·상품 수는 서버 server/shopGroups.js)
export const GROUP_PHOTOS = {
  fresh: { src: '/home/cat-fresh.webp', alt: '사과와 배를 담은 혼합 선물세트', need: 'home/cat-fresh.webp (과일세트)' },
  base: { src: '/home/cat-base.webp', alt: '자몽 에이드와 윤주톡톡 자몽베이스', need: 'home/cat-base.webp (농축액 음료)' },
  processed: { src: '/home/cat-processed.webp', alt: '잔에 따른 배즙과 성환 배', need: 'home/cat-processed.webp (과일 가공품)' },
  veg: { src: '/home/cat-veg.webp', alt: '당근, 감자, 고구마', need: 'home/cat-veg.webp (채소)' },
}

// 제철 달력: 품목마다 가장 맛있는 달 (예시 — 실제 출하 시기 확정 후 바꾸기)
export const SEASON = {
  photo: { src: '/home/season.webp', alt: '나무 접시에 담은 성환 배', need: 'home/season.webp (세로형 정물 사진)' },
  items: [
    { name: '사과', months: [9, 10, 11, 12] },
    { name: '배', months: [9, 10, 11] },
    { name: '감귤', months: [11, 12] },
    { name: '딸기', months: [12] },
  ],
  note: '※ 제철 시기는 예시 데이터입니다. 실제 출하 시기 확정 후 교체합니다.',
}

export const STORY = {
  title: ['가까운 농가의 맛을', '그대로 전합니다'],
  points: [
    { title: '가까운 곳에서', text: '충남에서 자란 농산물을 가공·유통·판매해 소비자에게 정직하게 전하는 천안의 로컬푸드 기업입니다.' },
    { title: '안전한 먹거리', text: '농가와 계약재배로 생산부터 유통까지 모든 과정을 관리합니다. 과일 농축액 베이스는 HACCP 인증 시설에서 만듭니다.' },
    { title: '함께 사는 방식', text: '단순히 파는 것보다 지역 농가와의 상생을 먼저 생각하며, 지속가능한 농업 생태계를 함께 만듭니다.' },
  ],
  photos: [
    { src: '/home/story-1.webp', alt: '흙을 두 손에 담은 모습', need: 'home/story-1.webp (산지·과수원 풍경 또는 작업 손)' },
    { src: '/home/story-2.webp', alt: '하나씩 감싸 선별·포장한 사과', need: 'home/story-2.webp (선별·포장 디테일)' },
  ],
}

// 자주 묻는 질문. answer 안의 {배송비}·{무료배송}·{출고} 는 서버의 배송 정책 값으로 바뀐다
export const FAQ = {
  lead: '답을 못 찾으셨다면 화면 오른쪽 아래 "상담하기"로 물어보세요.',
  items: [
    { tag: 'order', q: '주문은 어떻게 하나요?', a: '상품을 장바구니에 담거나 [바로 구매]를 누르면 주문서로 이어져요. 회원이 아니어도 주문할 수 있고, 주문번호와 휴대폰 번호로 [주문 조회]에서 확인해요.' },
    { tag: 'delivery', q: '배송은 얼마나 걸리나요?', a: '{출고}. 배송비는 농가마다 {배송비}이고, 그 농가 상품을 {무료배송} 이상 사면 그 농가는 무료예요.' },
    { tag: 'keep', q: '보관은 어떻게 하나요?', a: '품목마다 달라요. 상품 상세의 [보관·섭취 안내]에 받은 날부터 언제까지 어떻게 먹으면 좋은지 적어 두었어요. 상담하기에 "사과 보관법"처럼 물어봐도 바로 알려 드려요.' },
    { tag: 'pick', q: '어떤 과일을 골라야 할지 모르겠어요.', a: '[추천받기]에서 용도·맛·예산을 고르면 맞는 상품을 골라 드려요.', action: 'recommend' },
    { tag: 'bulk', q: '카페·행사용 대량 구매도 되나요?', a: '네. 카페·행사용 과일 농축액 베이스(1.9kg)와 명절 선물세트 대량 주문은 상품 페이지의 [기업 구매 문의]나 대표전화 041-544-2566(평일 09:00~18:00)으로 연락 주세요.' },
  ],
  note: '※ 안내 문구는 확정 전 예시입니다.',
}
