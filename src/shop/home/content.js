// 첫 화면 글·사진 (디자인 시안 그대로). 기획팀·디자인팀은 이 파일만 고치면 된다
// 사진: public/home/ 에 파일을 넣고 src 를 적는다. src 가 null 이면 빗금 자리표시('사진 필요')가 나온다
// 지금 사진(hero, cat-*)은 시안 캡처에서 잘라 낸 임시본 → 원본 파일로 바꾸기

export const BRAND = { strong: 'YOONJU', light: 'MARKET', company: '윤주팜', region: '충남 천안시 서북구', siteUrl: null } // siteUrl: 기업 소개 사이트 주소

export const HERO = {
  eyebrow: '윤주팜 로컬 마켓 · 매달 바뀌는 제철',
  title: ['이번 달에', '식탁에 올릴', '과일'],
  lead: '천안 농가에서 보내는 제철 과일세트와 농축액. 취향을 알려 주시면 맞는 상품을 골라 드립니다.',
  cta: '취향에 맞는 상품 추천받기',
  photo: { src: '/home/hero.webp', alt: '나무 접시 위의 배와 사과, 반으로 자른 배', need: 'home/hero.webp' },
}

// 카테고리 사진 (카테고리 이름·설명·상품 수는 서버 server/shopGroups.js)
export const GROUP_PHOTOS = {
  fresh: { src: '/home/cat-fresh.webp', need: 'home/cat-fresh.webp (과일세트)' },
  base: { src: '/home/cat-base.webp', need: 'home/cat-base.webp (농축액 음료)' },
  processed: { src: '/home/cat-processed.webp', need: 'home/cat-processed.webp (과일 가공품)' },
  veg: { src: null, need: 'home/cat-veg.webp (채소)' },
}

// 제철 달력: 품목마다 가장 맛있는 달 (예시 — 실제 출하 시기 확정 후 바꾸기)
export const SEASON = {
  photo: { src: null, need: 'home/season.jpg (세로형 정물 사진)' },
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
    { title: '가까운 곳에서', text: '충남 천안, 지역 농가와 직접 이어진 로컬푸드입니다.' },
    { title: '안전한 먹거리', text: '무엇을 어떻게 길렀는지, 상품 상세에 숨기지 않고 적습니다.' },
    { title: '함께 사는 방식', text: '농가와 소비자가 오래 거래하는 지역상생 네트워크를 만듭니다.' },
  ],
  photos: [
    { src: null, need: 'home/story-1.jpg (산지·과수원 풍경 또는 작업 손)' },
    { src: null, need: 'home/story-2.jpg (선별·포장 디테일)' },
  ],
}

// 자주 묻는 질문. answer 안의 {배송비}·{무료배송}·{출고} 는 서버의 배송 정책 값으로 바뀐다
export const FAQ = {
  lead: '답을 못 찾으셨다면 화면 오른쪽 아래 "상담하기"로 물어보세요.',
  items: [
    { q: '주문은 어떻게 하나요?', a: '상품을 장바구니에 담거나 [바로 구매]를 누르면 주문서로 이어져요. 회원이 아니어도 주문할 수 있고, 주문번호와 휴대폰 번호로 [주문 조회]에서 확인해요.' },
    { q: '배송은 얼마나 걸리나요?', a: '{출고}. 배송비는 {배송비}이고, {무료배송} 이상 사면 무료예요.' },
    { q: '보관은 어떻게 하나요?', a: '품목마다 달라요. 상품 상세의 [보관·섭취 안내]에 받은 날부터 언제까지 어떻게 먹으면 좋은지 적어 두었어요. 상담하기에 "사과 보관법"처럼 물어봐도 바로 알려 드려요.' },
    { q: '어떤 과일을 골라야 할지 모르겠어요.', a: '[추천받기]에서 용도·맛·예산을 고르면 맞는 상품을 골라 드려요.', action: 'recommend' },
  ],
  note: '※ 안내 문구는 확정 전 예시입니다.',
}
