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
  // 판매 중인 품목의 제철 달 (search: 상품을 찾을 때 쓸 말, 없으면 name)
  // 목록 순서 = 제철 달력에 보여 주는 순서 (인기 많은 품목부터, 2026-11-07 피드백).
  // [가설] 손님이 많이 찾는 과일을 먼저, 일 년 내내 사는 채소는 뒤에 둔 순서다. 판매 기록이 쌓이면 실제 판매량 순서로 바꾸기
  items: [
    // 과일
    { name: '딸기', months: [12, 1, 2, 3, 4] },
    { name: '감귤', months: [11, 12, 1, 2] },
    { name: '키위', months: [11, 12, 1, 2, 3] },
    { name: '사과', months: [9, 10, 11, 12] },
    { name: '샤인머스캣', months: [8, 9, 10] },
    { name: '복숭아', months: [7, 8] },
    { name: '배', search: '신고배', months: [9, 10, 11] },
    { name: '단감', months: [10, 11] },
    { name: '곶감', months: [12, 1, 2] },
    { name: '유자', months: [11, 12] },
    { name: '매실', months: [6] },
    // 고구마·감자
    { name: '고구마', months: [9, 10, 11] },
    { name: '감자', months: [6, 7, 8] },
    // 김장·채소 (제철은 있지만 저장·다른 산지 덕에 일 년 내내 나와서 뒤로)
    { name: '절임배추', months: [11, 12] },
    { name: '배추', months: [10, 11, 12] },
    { name: '가을무', search: '가을무', months: [10, 11, 12] },
    { name: '대파', months: [11, 12, 1, 2] },
    { name: '당근', months: [11, 12, 1, 2, 3] },
    { name: '양파', months: [5, 6] },
    { name: '마늘', months: [5, 6] },
    { name: '브로콜리', months: [11, 12, 1, 2, 3] },
    { name: '표고버섯', months: [3, 4, 5, 9, 10, 11] },
    { name: '햇고춧가루', search: '고춧가루', months: [8, 9, 10] },
  ],
  note: '※ 제철 시기는 일반적인 국내 출하 시기를 참고한 [예시]예요. 지역·해마다 다를 수 있어 실제 출하 시기가 정해지면 바꿔요.',
}

// 이야기 배너 3장. 회사 소개(가공·유통·판매, 계약재배, HACCP, 상생)와 이 쇼핑몰이 실제로 하는 일(당도계 사진, 농가가 직접 올림)만 쓴다
// links: href 가 # 로 시작하면 같은 화면의 그 칸으로, http 로 시작하면 새 창
export const STORY = {
  label: '윤주 이야기',
  interval: 7000,
  slides: [
    {
      title: ['충남에서 자란 것을', '천안에서 보냅니다'],
      text: '윤주(주)농업회사법인은 천안의 로컬푸드 회사예요. 충남 농가에서 받은 농산물을 가공하고, 포장하고, 파는 일까지 저희가 직접 합니다.',
      photo: { src: '/home/hero-5.webp', alt: '아침 안개가 낀 사과 과수원과 수확한 사과 상자', position: 'center 55%' },
      links: [{ label: '제철 상품 보기', href: '#products' }, { label: '회사 홈페이지', href: 'https://yunjufarm.co.kr/' }],
    },
    {
      title: ['키우는 과정부터', '확인하고 팝니다'],
      text: '농가와 계약재배를 해서 생산부터 유통까지 함께 관리해요. 과일 농축액 베이스는 HACCP 인증 시설에서 만들고, 당도를 적은 상품에는 농가가 잰 당도계 사진을 같이 올립니다.',
      photo: { src: '/home/story-2.webp', alt: '하나씩 감싸 선별·포장한 사과', position: 'center 50%' },
      links: [{ label: '상품 둘러보기', href: '#products' }, { label: '자주 묻는 질문', href: '#faq' }],
    },
    {
      title: ['농가가 내년에도', '농사지을 수 있게'],
      text: '많이 파는 것보다 지역 농가와 오래 거래하는 걸 먼저 생각해요. 농가가 상품을 직접 올리고, 상품 페이지마다 그 농가의 이야기를 함께 싣습니다.',
      photo: { src: '/home/story-1.webp', alt: '흙을 두 손에 담은 모습', position: 'center 45%' },
      links: [{ label: '농가로 입점 신청', href: '/account/signup?type=seller' }, { label: '상품 둘러보기', href: '#products' }],
    },
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

// 회사 소개 (/about, src/shop/About.jsx): 회사 홈페이지(yunjufarm.co.kr) 2026-11-08 내용. 그림 속 글은 화면 글로 옮겼다
export const ABOUT = {
  name: '윤주(주)농업회사법인',
  eyebrow: '충남 천안의 로컬푸드 전문기업',
  lead: '충남지역에서 재배되는 친환경 농산물을 가공, 유통, 판매하여 소비자에게 정직하게 전달하는 로컬푸드 전문기업입니다.',
  heroImage: { src: '/about/farmers.webp', alt: '수확한 채소와 과일을 든 농부들 그림' },
  promises: [
    { title: '지속가능한 농업, 함께하는 성장', text: '윤주(주)농업회사법인은 단순히 농산물을 판매하는 것이 목적이 아닌 지역농가와의 상생이 가장 중요한 가치이자 이념입니다. 매 계절 최고의 농산물을 공급하기 위해 농가와의 계약재배를 통해 안정적이고 지속가능한 농업 생태계를 함께 만들어 가고 있습니다.' },
    { title: '자연을 담은 건강한 약속', text: '농가와의 계약재배를 통해 생산부터 유통까지 모든 과정을 관리하고 있기에 누구나 안심하고 먹을 수 있는 건강한 먹거리 문화를 만들기 위해 노력하고 있으며, 소비자의 삶 속에 작지만 확실한 변화를 전하고자 합니다.' },
  ],
  values: [
    { title: '프리미엄 품질관리', text: '엄격한 품질 기준과 전문적인 관리 시스템을 통해 생산부터 유통까지 전 과정에서 높은 수준의 농산물을 제공합니다.' },
    { title: '사회적 가치창출', text: '지역 농가와의 협력을 강화하여 사회에 긍정적인 영향을 만들어 갑니다.' },
    { title: '지속 가능한 로컬푸드', text: '지역에서 생산된 신선하고 안전한 먹거리를 소비자에게 직접 전달하여, 건강한 먹거리 문화 확산에 기여합니다.' },
    { title: '올인원 고객 서비스', text: '생산, 가공, 포장, 배송까지 모든 과정을 원스톱으로 제공해 고객이 더욱 편리하게 이용할 수 있는 환경을 만듭니다.' },
    { title: '소량 맞춤형 생산', text: '다양한 소비자 요구에 맞춘 유연한 생산체계를 갖추어, 필요에 따라 빠르고 효율적인 공급이 가능합니다.' },
    { title: '지역 상생 네트워크', text: '농가, 소비자, 기업이 함께 성장할 수 있는 협력 구조를 형성하여 지역 경제 활성화를 도모합니다.' },
    { title: '콜드 체인 시스템', text: '첨단 저온 유통 설비를 통해 수확부터 배송까지 신선도를 유지하여 최고의 품질을 보장합니다.' },
  ],
  localfood: {
    title: '내가 사는 지역에서 자란 농산물',
    lead: '매 계절 최고의 농산물을 공급하기 위해 농가와의 계약재배를 통해 안정적이고 지속가능한 농업생태계를 함께 만들어가고 있습니다.',
    image: { src: '/about/soil.webp', alt: '흙을 두 손에 담은 모습' },
    qa: [
      { q: '윤주(주)의 로컬푸드는?', a: '윤주(주)는 단순히 먹거리를 유통하는 것이 아닌, 지역 농민과 소비자를 연결하는 신뢰의 플랫폼이 되고자 합니다. 우리 지역에서 정성껏 키운 농산물을 통해 더 신선하고, 더 건강한 식탁을 만들어갑니다. 생산자의 얼굴이 보이는 투명한 먹거리 문화를 추구하며 로컬푸드의 가치를 실천합니다.' },
      { q: '로컬푸드란 무엇일까요?', a: "로컬푸드는 '내가 사는 지역에서 자란 농산물'을 '같은 지역에서 소비하자'는 시작된 운동입니다. 멀리서 수입해온 농산물이 아닌, 내 이웃이 정성껏 키운 먹거리를 바로 내 식탁에 올리는 방식입니다." },
      { q: '왜 로컬푸드가 중요한가요?', a: "마트에 진열되어 있는 과일들은 반들반들하지만 정작 그 과일이 어떤 길을 걸어왔는지 아는 사람이 많지 않습니다. 따라서 로컬푸드는 단순한 먹거리를 넘어서 '생산자와 소비자를 연결하는 신뢰의 다리'가 되는 중요한 역할을 합니다." },
    ],
    keywords: [
      { title: '안전한 먹거리 공급', text: '소비자들의 더 건강하고 안전한 농산물에 대한 요구가 생산자에게 직접 전달되어, 농약 사용을 줄이거나 친환경 재배 방식을 도입하는 등 더 안전하고 지속가능한 생산으로 이어집니다.' },
      { title: '친환경', text: '생산자와 소비자 사이 거리가 줄어 온실가스 배출량을 줄이고 지구 온난화 방지에 기여합니다.' },
      { title: '지역 경제 활성화', text: '지역 안에서 생산과 유통이 이루어지기 때문에 소비자가 지출한 돈이 외부로 빠져나가지 않고 지역 안에서 순환되어 경제 활성화에 이바지합니다.' },
      { title: '신뢰 관계 형성', text: '대량 유통 구조 속에서 서로 몰랐던 소비자와 생산자의 거리가 가까워집니다.' },
      { title: '농민 소득 안정', text: '농가와의 계약재배를 통해 농민들에게 안정적인 수익을 가져다줌으로써 품질적으로 개선을 이루어내고 있습니다.' },
    ],
  },
  products: [
    { title: '프리미엄 과일 농축액 베이스', text: '복숭아·자몽·유자·레몬·패션후르츠·청포도·딸기 1.9kg. 카페·행사용 대용량', image: '/about/base-lineup.webp', href: '/?cat=base#products' },
    { title: '로컬 과일세트', text: '천안 성환 배 세트, 명품 사과세트, 과일 혼합 세트, 도라지 배즙 세트', image: '/product-photos/yj_pear_set.webp', href: '/?cat=fresh#products' },
  ],
  location: {
    ceo: '배윤주',
    address: '충남 천안시 서북구 동서대로 163, 충남타워 1002호 (여성기업종합지원센터)',
    phone: '041-544-2566',
    email: 'olive7083@naver.com',
    hours: '평일 09:00~18:00 (점심 13:00~14:00) · 토·일·공휴일 휴무',
  },
  note: '※ 글과 그림은 회사 홈페이지(yunjufarm.co.kr)에서 옮겼어요 (2026-11-08). 회사 홈페이지의 경영공시는 시험 글뿐이고 함께하는 사람들은 준비 중이라 옮기지 않았어요.',
}

// 홈페이지 관리 (관리자 [홈페이지 관리], server/siteContent.js): 저장한 칸은 위 기본값을 덮어쓴다.
// main.jsx 가 화면을 그리기 전에 applySiteContent 를 부른다. DEFAULTS 는 [기본값으로]를 위한 처음 내용
export const DEFAULTS = JSON.parse(JSON.stringify({ hero: HERO, story: STORY, season: SEASON, faq: FAQ }))
const LIVE_CONTENT = { hero: HERO, story: STORY, season: SEASON, faq: FAQ }
export function applySiteContent(saved) {
  for (const [key, value] of Object.entries(saved ?? {})) {
    if (Object.hasOwn(LIVE_CONTENT, key) && value && typeof value === 'object') Object.assign(LIVE_CONTENT[key], value)
  }
}
