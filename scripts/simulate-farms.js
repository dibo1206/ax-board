// 예시 농가 10곳과 상품 100개를 시뮬레이션으로 만든다.
//   npm run simulate-farms        가입 계획 data/sample_farms.json 과 docs/farm_simulation.md 를 쓴다 (그다음 npm run onboard-farms)
//   npm run simulate-farms -- --check   파일을 바꾸지 않고 검사 결과만 본다
// 같은 씨앗(SEED)이면 매번 같은 결과가 나온다. 농가는 CSV로 넣지 않고 onboard-farms 가 가입 API로 들어온다.
// 가격은 KAMIS 소매가격(data/market_prices.csv)에서 kg당 값을 잡고 등급·포장·무게 할인을 곱한다.
// 재고는 출하량에서 판매 시작일부터 오늘까지 팔린 양(포아송)을 뺀다. 당도는 품종별 평균·편차로 뽑는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCsv } from './csv.js'

const DATA = new URL('../data/', import.meta.url)
const REPORT = new URL('../docs/farm_simulation.md', import.meta.url)
const PLAN = new URL('../data/sample_farms.json', import.meta.url)
const CHECK_ONLY = process.argv.includes('--check')
const TODAY = '2026-11-06'
const SEED = 'yoonju-farms-2026-11'
const SIM = '[예시 값] 농가 시뮬레이션 v1'

// ---------- 씨앗이 있는 난수 ----------
function rngFrom(text) {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rngFrom(SEED)
const between = (lo, hi) => lo + (hi - lo) * rand()
const normal = (mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
function poisson(lambda) {
  // 큰 값은 정규 근사
  if (lambda > 30) return Math.max(0, Math.round(normal(lambda, Math.sqrt(lambda))))
  let k = 0
  let p = 1
  const l = Math.exp(-lambda)
  do { k += 1; p *= rand() } while (p > l)
  return k - 1
}
const day = (iso, plus = 0) => new Date(Date.parse(`${iso}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const pickDate = ([from, to]) => day(from, Math.floor(rand() * (daysBetween(from, to) + 1)))

// ---------- 시세 ----------
// data/market_prices.csv: ref_code, 이름, 1kg(또는 1개)당 원, 근거. KAMIS 값이 없는 품목은 가정값이라고 적어 둔다
function readSheet(file) {
  const [header, ...rows] = parseCsv(readFileSync(new URL(file, DATA), 'utf8'))
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
const MARKET = Object.fromEntries(readSheet('market_prices.csv').map((r) => [r.ref_code, { ...r, per_unit: Number(r.per_unit) }]))

// ---------- 농가 ----------
// scale: 온라인으로 내놓는 양의 크기 (1 = 보통), story 는 농가 소개 화면에 나간다
const FARMS = [
  { code: 'farm_namwon', login: 'namwon_gyul', name: '남원 귤빛농원', region: '제주특별자치도 서귀포시 남원읍', short: '서귀포', tel: '0640000011', owner: '고귤순', scale: 1.4,
    intro: '서귀포 남원에서 노지 감귤과 겨울 브로콜리, 흙당근을 키우는 농원입니다.', story: '바닷바람이 드는 남향 밭에서 3대째 감귤을 키웁니다. 귤은 나무에서 충분히 익힌 뒤 따고, 크기별로 나눠 보냅니다.' },
  { code: 'farm_jinyeong', login: 'jinyeong_dangam', name: '진영 단감마을', region: '경상남도 김해시 진영읍', short: '김해 진영', tel: '0550000012', owner: '배단호', scale: 1.1,
    intro: '김해 진영에서 부유 단감을 키우는 농가입니다.', story: '단감 시배지로 알려진 진영에서 부유 단감을 키우고, 모양이 덜 예쁜 감은 감말랭이로 만듭니다.' },
  { code: 'farm_sangju', login: 'sangju_gotgam', name: '상주 곶감골', region: '경상북도 상주시 외남면', short: '상주', tel: '0540000013', owner: '서곶임', scale: 0.9,
    intro: '상주에서 곶감과 사과를 만드는 농가입니다.', story: '가을에 딴 둥시감을 깎아 바람에 말려 곶감을 만듭니다. 곶감이 마르는 동안에는 사과와 사과즙을 냅니다.' },
  { code: 'farm_nonsan', login: 'nonsan_berry', name: '논산 새벽딸기', region: '충청남도 논산시 광석면', short: '논산', tel: '0410000014', owner: '윤설향', scale: 0.7,
    intro: '논산에서 하우스 딸기를 키우는 농가입니다.', story: '새벽에 딴 딸기를 그날 바로 포장해 보냅니다. 11월은 첫물이라 양이 적고, 12월부터 늘어납니다.' },
  { code: 'farm_yeongdong', login: 'yeongdong_grape', name: '영동 포도언덕', region: '충청북도 영동군 양강면', short: '영동', tel: '0430000015', owner: '남포도', scale: 0.8,
    intro: '영동에서 샤인머스캣을 키우고 포도잼을 만드는 농가입니다.', story: '9~10월에 딴 샤인머스캣을 저온 창고에 두고 나눠 보냅니다. 알이 떨어진 포도는 잼으로 만듭니다.' },
  { code: 'farm_haenam', login: 'haenam_deulnyeok', name: '해남 땅끝들녘', region: '전라남도 해남군 산이면', short: '해남', tel: '0610000016', owner: '박해남', scale: 1.5,
    intro: '해남에서 배추·무·고구마·대파를 키우고 김장철에 절임배추를 내는 농가입니다.', story: '황토밭에서 가을배추와 무, 고구마를 키웁니다. 김장철에는 배추를 직접 절여 날짜에 맞춰 보냅니다.' },
  { code: 'farm_uiseong', login: 'uiseong_garlic', name: '의성 마늘고추밭', region: '경상북도 의성군 단밀면', short: '의성', tel: '0540000017', owner: '권의성', scale: 1.0,
    intro: '의성에서 한지형 마늘과 고추, 양파를 키우는 농가입니다.', story: '6월에 캔 마늘을 그늘에 매달아 말리고, 여름에 딴 고추는 햇볕과 건조기로 말려 고춧가루로 빻습니다.' },
  { code: 'farm_jangheung', login: 'jangheung_pyogo', name: '장흥 숲속표고', region: '전라남도 장흥군 유치면', short: '장흥', tel: '0610000018', owner: '임표고', scale: 0.8,
    intro: '장흥 산자락에서 참나무 원목으로 표고버섯을 키우는 농가입니다.', story: '참나무 원목에 종균을 넣어 키운 표고를 따서 생표고로 보내고, 일부는 햇볕과 건조기로 말립니다.' },
  { code: 'farm_goheung', login: 'goheung_yuja', name: '고흥 유자마을', region: '전라남도 고흥군 풍양면', short: '고흥', tel: '0610000019', owner: '조유자', scale: 0.9,
    intro: '고흥에서 유자와 참다래를 키우는 농가입니다.', story: '11월에 딴 유자를 씻어 씨를 빼고 설탕에 재워 유자청을 만듭니다. 같은 때 참다래도 땁니다.' },
  { code: 'farm_geochang', login: 'geochang_apple', name: '거창 사과재', region: '경상남도 거창군 고제면', short: '거창', tel: '0550000020', owner: '신사과', scale: 1.2,
    intro: '거창 고지대에서 사과를 키우고 사과즙을 짜는 농가입니다.', story: '해발이 높은 고제면 밭에서 일교차를 맞고 자란 사과를 키웁니다. 흠이 있는 사과는 즙으로 짭니다.' },
]

// ---------- 품종 (당도 평균·편차, 수확 철) ----------
const VARIETY = {
  후지: { brix: [14.8, 0.9], harvest: ['2026-10-25', '2026-11-04'] },
  시나노골드: { brix: [14.6, 0.8], harvest: ['2026-10-12', '2026-10-25'] },
  홍로: { brix: [13.6, 0.7], harvest: ['2026-09-01', '2026-09-20'] },
  '노지 온주밀감': { brix: [11.2, 0.8], harvest: ['2026-10-25', '2026-11-05'] },
  '극조생 온주밀감': { brix: [10.0, 0.6], harvest: ['2026-10-01', '2026-10-15'] },
  부유: { brix: [16.0, 1.1], harvest: ['2026-10-20', '2026-11-03'] },
  차랑: { brix: [15.0, 0.9], harvest: ['2026-10-01', '2026-10-15'] },
  설향: { brix: [10.8, 0.9], harvest: ['2026-11-01', '2026-11-05'] },
  킹스베리: { brix: [10.2, 0.8], harvest: ['2026-11-01', '2026-11-05'] },
  금실: { brix: [12.0, 0.9], harvest: ['2026-11-01', '2026-11-05'] },
  샤인머스캣: { brix: [18.2, 1.0], harvest: ['2026-09-15', '2026-10-10'] },
  골드키위: { brix: [15.5, 1.0], harvest: ['2026-10-25', '2026-11-04'] },
  헤이워드: { brix: [13.0, 0.9], harvest: ['2026-10-28', '2026-11-05'] },
}

// ---------- 포장·등급 계수 ----------
// demand: 하루 평균 판매량의 기준 (같은 값이면 비싼 상품이 덜 팔린다)
const PACK = {
  보통: { price: 1.0, demand: 2.0 },
  선물: { price: 1.2, demand: 1.4 },
  가정용: { price: 0.9, demand: 2.6 },
  흠과: { price: 0.7, demand: 2.2 },
  소포장: { price: 1.1, demand: 2.4 },
  업소용: { price: 0.8, demand: 0.6 },
}
const GRADE = { 소과: 0.92, 중과: 1.0, 대과: 1.1, 특과: 1.15, 상과: 1.0, '': 1.0 }

// ---------- 상품 100개 ----------
// [농가, 코드 끝, 품목, 시세 코드, 이름, 수량(kg·포·개), 단위 글, 포장, 등급, 품종, 판매 방식, 태그, 소개]
// 판매 방식: now(지금 판매) · ended(철이 끝나 다 팔림) · preorder(예약 — 수확 전) · stored(저장품)
// opts: 같은 상품의 다른 무게 [옵션 이름, 수량]
const P = []
const add = (farm, code, item, ref, name, qty, unit, pack, grade, variety, mode, tags, summary, extra = {}) =>
  P.push({ farm, code, item, ref, name, qty, unit, pack, grade, variety, mode, tags, summary, ...extra })

// 1. 남원 귤빛농원 (서귀포)
add('farm_namwon', 'mandarin_s_5kg', 'mandarin', 'mandarin', '노지감귤 소과 5kg', 5, '5kg 1박스', '보통', '소과', '노지 온주밀감', 'now', 'home|raw|sweet|season|kids', '껍질이 얇고 한입에 먹기 좋은 작은 귤만 골라 담은 노지감귤', { opts: [['5kg 1박스', 5], ['10kg 1박스', 10]] })
add('farm_namwon', 'mandarin_m_5kg', 'mandarin', 'mandarin', '노지감귤 중과 5kg', 5, '5kg 1박스', '보통', '중과', '노지 온주밀감', 'now', 'home|raw|sweet|season', '새콤달콤한 맛이 고른 중간 크기 노지감귤', { opts: [['5kg 1박스', 5], ['10kg 1박스', 10]] })
add('farm_namwon', 'mandarin_l_5kg', 'mandarin', 'mandarin', '노지감귤 대과 5kg', 5, '5kg 1박스', '보통', '대과', '노지 온주밀감', 'now', 'home|raw|sweet|season', '껍질이 잘 벗겨지고 과즙이 많은 큰 귤 노지감귤')
add('farm_namwon', 'mandarin_ugly_10kg', 'mandarin', 'mandarin', '못난이 감귤 10kg (가정용)', 10, '10kg 1박스', '흠과', '', '노지 온주밀감', 'now', 'home|raw|sweet|drink', '껍질에 바람 자국이나 흠이 있지만 맛은 같은 가정용 귤. 주스나 귤청용으로도 좋아요')
add('farm_namwon', 'mandarin_gift_3kg', 'mandarin', 'mandarin', '로얄과 감귤 선물세트 3kg', 3, '3kg 1상자', '선물', '특과', '노지 온주밀감', 'now', 'gift|raw|sweet|season', '크기와 색이 고른 귤만 한 알씩 담은 선물용 감귤')
add('farm_namwon', 'mandarin_early_5kg', 'mandarin', 'mandarin', '극조생 감귤 5kg', 5, '5kg 1박스', '보통', '중과', '극조생 온주밀감', 'ended', 'home|raw|sour', '10월에 먼저 나오는 극조생 귤. 새콤한 맛이 살아 있어요')
add('farm_namwon', 'broccoli_1kg', 'broccoli', 'broccoli', '제주 브로콜리 1kg', 1, '1kg 1봉', '소포장', '', '', 'now', 'home|cook|mild|season', '송이가 단단하고 진한 초록색인 겨울 제주 브로콜리')
add('farm_namwon', 'broccoli_3kg', 'broccoli', 'broccoli', '제주 브로콜리 3kg', 3, '3kg 1박스', '보통', '', '', 'now', 'home|cook|mild|season', '데침·볶음·수프용으로 넉넉하게 쓰는 제주 브로콜리')
add('farm_namwon', 'carrot_3kg', 'carrot', 'carrot', '제주 흙당근 3kg', 3, '3kg 1박스', '보통', '', '', 'now', 'home|raw|cook|mild', '흙을 털지 않고 보내는 제주 흙당근. 씻지 않아 더 오래 둘 수 있어요')
add('farm_namwon', 'carrot_10kg', 'carrot', 'carrot', '제주 흙당근 10kg (업소용)', 10, '10kg 1박스', '업소용', '', '', 'now', 'cafe|cook|mild|keep_long', '식당·주스 가게에서 쓰기 좋은 대용량 흙당근')

// 2. 진영 단감마을 (김해 진영)
add('farm_jinyeong', 'persimmon_top_5kg', 'persimmon', 'persimmon', '진영 단감 특과 5kg', 5, '5kg 1박스', '보통', '특과', '부유', 'now', 'gift|raw|sweet|season', '아삭하고 단맛이 진한 부유 단감 중 큰 것만 고른 특과', { opts: [['5kg 1박스', 5], ['10kg 1박스', 10]] })
add('farm_jinyeong', 'persimmon_5kg', 'persimmon', 'persimmon', '진영 단감 상과 5kg', 5, '5kg 1박스', '보통', '상과', '부유', 'now', 'home|raw|sweet|season', '집에서 깎아 먹기 좋은 보통 크기 부유 단감')
add('farm_jinyeong', 'persimmon_home_10kg', 'persimmon', 'persimmon', '단감 가정용 10kg', 10, '10kg 1박스', '가정용', '', '부유', 'now', 'home|raw|sweet|season', '크기를 섞어 담은 가정용 단감. 식구가 많은 집에 알맞아요')
add('farm_jinyeong', 'persimmon_ugly_5kg', 'persimmon', 'persimmon', '못난이 단감 5kg', 5, '5kg 1박스', '흠과', '', '부유', 'now', 'home|raw|sweet|cook', '껍질에 작은 흠이 있지만 맛은 같은 단감. 샐러드나 감말랭이용으로 좋아요')
add('farm_jinyeong', 'persimmon_gift_3kg', 'persimmon', 'persimmon', '단감 선물세트 3kg', 3, '3kg 1상자', '선물', '특과', '부유', 'now', 'gift|raw|sweet|season', '한 알씩 받침에 담은 선물용 부유 단감')
add('farm_jinyeong', 'persimmon_small_2kg', 'persimmon', 'persimmon', '단감 소포장 2kg', 2, '2kg 1박스', '소포장', '상과', '부유', 'now', 'home|raw|sweet', '혼자 사는 분이나 맛보기로 사기 좋은 작은 상자 단감')
add('farm_jinyeong', 'persimmon_charang_5kg', 'persimmon', 'persimmon', '조생 단감 차랑 5kg', 5, '5kg 1박스', '보통', '상과', '차랑', 'ended', 'home|raw|sweet', '부유보다 먼저 나오는 조생 단감 차랑')
add('farm_jinyeong', 'persimmon_bulk_15kg', 'persimmon', 'persimmon', '단감 업소용 15kg', 15, '15kg 1박스', '업소용', '', '부유', 'now', 'cafe|raw|sweet|cook', '카페 디저트·급식에 쓰기 좋은 대용량 단감')
add('farm_jinyeong', 'dried_slice_500g', 'dried_persimmon', 'persimmon_chips', '진영 단감 감말랭이 500g', 0.5, '500g 1봉', '보통', '', '', 'now', 'home|kids|sweet|keep_long', '단감을 얇게 썰어 말린 쫀득한 감말랭이')
add('farm_jinyeong', 'dried_slice_1kg', 'dried_persimmon', 'persimmon_chips', '진영 단감 감말랭이 1kg', 1, '500g 2봉', '가정용', '', '', 'now', 'home|kids|sweet|keep_long', '간식으로 두고 먹기 좋은 감말랭이 두 봉')

// 3. 상주 곶감골
add('farm_sangju', 'semi_dried_gift', 'dried_persimmon', 'semi_dried', '상주 반건시 선물세트 1.2kg', 1.2, '1.2kg 1상자', '선물', '', '', 'preorder', 'gift|sweet|keep_long|season', '말랑한 반건시를 한 알씩 담은 선물세트. 12월 초부터 순서대로 보내요')
add('farm_sangju', 'gotgam_gift', 'dried_persimmon', 'gotgam', '상주 곶감 선물세트 1.5kg', 1.5, '1.5kg 1상자', '선물', '', '', 'preorder', 'gift|sweet|keep_long|season', '둥시감을 깎아 바람에 말린 상주 곶감 선물세트. 12월 중순부터 보내요')
add('farm_sangju', 'gotgam_frozen_1kg', 'dried_persimmon', 'gotgam', '작년 곶감 냉동 1kg', 1, '1kg 1상자', '가정용', '', '', 'stored', 'home|sweet|keep_long', '작년 겨울에 만들어 냉동 보관한 곶감. 남은 수량만 팔아요')
add('farm_sangju', 'dried_slice_300g', 'dried_persimmon', 'persimmon_chips', '상주 감말랭이 300g', 0.3, '300g 1봉', '소포장', '', '', 'now', 'home|kids|sweet|keep_long', '둥시감으로 만든 쫀득한 감말랭이 작은 봉')
add('farm_sangju', 'dried_slice_1kg', 'dried_persimmon', 'persimmon_chips', '상주 감말랭이 1kg', 1, '1kg 1봉', '가정용', '', '', 'now', 'home|kids|sweet|keep_long', '넉넉히 두고 먹는 대용량 감말랭이')
add('farm_sangju', 'apple_fuji_5kg', 'apple', 'apple_fuji', '상주 부사 사과 5kg', 5, '5kg 1박스', '보통', '상과', '후지', 'now', 'home|raw|sweet|season', '상주 들녘에서 키운 아삭한 부사 사과')
add('farm_sangju', 'apple_home_10kg', 'apple', 'apple_fuji', '상주 사과 가정용 10kg', 10, '10kg 1박스', '가정용', '', '후지', 'now', 'home|raw|cook|sweet', '크기를 섞어 담은 가정용 부사 사과')
add('farm_sangju', 'apple_juice_50', 'apple_juice', 'apple_juice', '상주 사과즙 50포', 50, '50포 1박스', '보통', '', '', 'now', 'gift|home|drink|keep_long', '사과만 짜서 담은 사과즙. 한 포씩 들고 다니기 좋아요')
add('farm_sangju', 'apple_juice_30', 'apple_juice', 'apple_juice', '상주 사과즙 30포', 30, '30포 1박스', '소포장', '', '', 'now', 'home|drink|keep_long', '처음 맛보는 분께 알맞은 사과즙 30포')
add('farm_sangju', 'gotgam_premium', 'dried_persimmon', 'gotgam', '상주 곶감 특선 2kg', 2, '2kg 1상자', '선물', '', '', 'preorder', 'gift|sweet|keep_long', '크기가 큰 곶감만 고른 특선 상자. 12월 중순부터 보내요')

// 4. 논산 새벽딸기
add('farm_nonsan', 'seolhyang_1kg', 'strawberry', 'strawberry', '설향 딸기 1kg', 1, '500g 2팩', '보통', '중과', '설향', 'now', 'home|raw|sweet|eat_soon', '새벽에 따서 그날 보내는 첫물 설향 딸기')
add('farm_nonsan', 'seolhyang_2kg', 'strawberry', 'strawberry', '설향 딸기 2kg', 2, '500g 4팩', '보통', '중과', '설향', 'now', 'home|raw|sweet|eat_soon', '식구가 많은 집에 알맞은 설향 딸기 네 팩')
add('farm_nonsan', 'kingsberry_gift', 'strawberry', 'strawberry', '킹스베리 딸기 선물 1kg', 1, '1kg 1상자', '선물', '대과', '킹스베리', 'now', 'gift|raw|sweet|eat_soon', '알이 아주 큰 킹스베리를 한 알씩 담은 선물 상자')
add('farm_nonsan', 'geumsil_1kg', 'strawberry', 'strawberry', '금실 딸기 1kg', 1, '500g 2팩', '보통', '중과', '금실', 'now', 'home|raw|sweet|eat_soon', '단단하고 단맛이 진한 금실 딸기')
add('farm_nonsan', 'ugly_2kg', 'strawberry', 'strawberry', '못난이 딸기 2kg (잼용)', 2, '2kg 1박스', '흠과', '', '설향', 'now', 'home|spread|sweet|eat_soon', '모양이 고르지 않은 딸기. 잼이나 스무디로 쓰기 좋아요')
add('farm_nonsan', 'cafe_4kg', 'strawberry', 'strawberry', '설향 딸기 업소용 4kg', 4, '4kg 1박스', '업소용', '', '설향', 'now', 'cafe|raw|sweet|eat_soon', '카페 디저트·음료용 설향 딸기 대용량')
add('farm_nonsan', 'frozen_1kg', 'strawberry', 'strawberry_frozen', '냉동 딸기 1kg', 1, '1kg 1봉', '보통', '', '설향', 'stored', 'home|drink|sweet|keep_long', '지난봄 딸기를 꼭지 따서 얼린 냉동 딸기. 스무디용')
add('farm_nonsan', 'frozen_3kg', 'strawberry', 'strawberry_frozen', '냉동 딸기 3kg (업소용)', 3, '1kg 3봉', '업소용', '', '설향', 'stored', 'cafe|drink|sweet|keep_long', '카페 음료용 냉동 딸기 세 봉')
add('farm_nonsan', 'seolhyang_500g', 'strawberry', 'strawberry', '설향 딸기 맛보기 500g', 0.5, '500g 1팩', '소포장', '중과', '설향', 'now', 'home|raw|sweet|eat_soon', '한 팩만 맛보고 싶은 분을 위한 작은 상자')
add('farm_nonsan', 'kingsberry_2kg', 'strawberry', 'strawberry', '킹스베리 딸기 2kg', 2, '1kg 2상자', '보통', '대과', '킹스베리', 'now', 'gift|raw|sweet|eat_soon', '큰 딸기를 넉넉히 받는 킹스베리 두 상자')

// 5. 영동 포도언덕
add('farm_yeongdong', 'shine_2kg', 'grape', 'shine', '샤인머스캣 2kg (2~3송이)', 2, '2kg 1박스', '보통', '상과', '샤인머스캣', 'stored', 'home|raw|sweet', '저온 창고에서 꺼내 바로 보내는 샤인머스캣', { opts: [['2kg 1박스', 2], ['4kg 1박스', 4]] })
add('farm_yeongdong', 'shine_gift_4kg', 'grape', 'shine', '샤인머스캣 선물 4kg', 4, '4kg 1상자', '선물', '특과', '샤인머스캣', 'stored', 'gift|raw|sweet', '송이 모양이 고른 샤인머스캣만 담은 선물 상자')
add('farm_yeongdong', 'shine_home_2kg', 'grape', 'shine', '샤인머스캣 가정용 2kg', 2, '2kg 1박스', '가정용', '', '샤인머스캣', 'stored', 'home|raw|sweet', '송이가 작거나 모양이 덜 고른 가정용 샤인머스캣')
add('farm_yeongdong', 'shine_1kg', 'grape', 'shine', '샤인머스캣 한 송이 1kg', 1, '1kg 1팩', '소포장', '상과', '샤인머스캣', 'stored', 'home|raw|sweet', '한두 사람이 먹기 좋은 한 송이 포장')
add('farm_yeongdong', 'shine_bulk_6kg', 'grape', 'shine', '샤인머스캣 업소용 6kg', 6, '6kg 1박스', '업소용', '', '샤인머스캣', 'stored', 'cafe|raw|sweet', '디저트 가게에서 쓰기 좋은 샤인머스캣 대용량')
add('farm_yeongdong', 'grape_jam_500g', 'grape_jam', 'grape_jam', '영동 포도잼 500g', 0.5, '500g 1병', '보통', '', '', 'now', 'home|spread|sweet|keep_long', '알이 떨어진 포도를 졸여 만든 포도잼')
add('farm_yeongdong', 'grape_jam_set', 'grape_jam', 'grape_jam', '영동 포도잼 2병 세트', 1, '500g 2병', '선물', '', '', 'now', 'gift|spread|sweet|keep_long', '선물하기 좋은 포도잼 두 병 세트')
add('farm_yeongdong', 'gotgam_gift', 'dried_persimmon', 'gotgam', '영동 곶감 선물세트 1.5kg', 1.5, '1.5kg 1상자', '선물', '', '', 'preorder', 'gift|sweet|keep_long|season', '영동 감으로 만든 곶감 선물세트. 12월 중순부터 보내요')
add('farm_yeongdong', 'dried_slice_500g', 'dried_persimmon', 'persimmon_chips', '영동 감말랭이 500g', 0.5, '500g 1봉', '보통', '', '', 'now', 'home|kids|sweet|keep_long', '영동 감을 썰어 말린 감말랭이')
add('farm_yeongdong', 'shine_small_2kg', 'grape', 'shine', '샤인머스캣 알포도 2kg', 2, '1kg 2팩', '흠과', '', '샤인머스캣', 'stored', 'home|raw|sweet|cafe', '송이에서 떨어진 알만 모은 샤인머스캣. 맛은 같아요')

// 6. 해남 땅끝들녘
add('farm_haenam', 'salted_20kg', 'salted_cabbage', 'salted_cabbage', '해남 절임배추 20kg (김장 예약)', 20, '20kg 1박스', '보통', '', '', 'preorder', 'home|cook|eat_soon|season', '해남 가을배추를 천일염으로 절여 씻어 물기를 뺀 절임배추. 11월 20일부터 순서대로 보내요', { opts: [['20kg 1박스', 20], ['10kg 1박스', 10]] })
add('farm_haenam', 'salted_10kg', 'salted_cabbage', 'salted_cabbage', '해남 절임배추 10kg (김장 예약)', 10, '10kg 1박스', '소포장', '', '', 'preorder', 'home|cook|eat_soon|season', '두세 식구 김장에 알맞은 절임배추 10kg. 11월 20일부터 보내요')
add('farm_haenam', 'cabbage_3', 'napa_cabbage', 'napa_cabbage', '해남 가을배추 3포기', 8, '3포기 1망 (약 8kg)', '보통', '', '', 'now', 'home|cook|season', '속이 꽉 찬 해남 가을배추 세 포기')
add('farm_haenam', 'cabbage_small_2', 'napa_cabbage', 'napa_cabbage', '알배기 배추 2포기', 2.4, '2포기 (약 2.4kg)', '소포장', '', '', 'now', 'home|raw|cook|mild', '쌈·겉절이로 먹기 좋은 작은 알배기 배추')
add('farm_haenam', 'radish_3', 'radish', 'radish', '해남 가을무 3개', 4.5, '3개 (약 4.5kg)', '보통', '', '', 'now', 'home|cook|mild|season', '단단하고 묵직한 가을무. 깍두기·뭇국용')
add('farm_haenam', 'radish_10kg', 'radish', 'radish', '가을무 10kg (업소용)', 10, '10kg 1박스', '업소용', '', '', 'now', 'cafe|cook|mild|keep_long', '식당 반찬·김장용 가을무 대용량')
add('farm_haenam', 'sweetpotato_bam_5kg', 'sweet_potato', 'sweet_potato', '해남 밤고구마 5kg', 5, '5kg 1박스', '보통', '중과', '밤고구마', 'stored', 'home|cook|sweet|keep_long', '포슬포슬한 해남 황토 밤고구마')
add('farm_haenam', 'sweetpotato_hobak_5kg', 'sweet_potato', 'sweet_potato', '해남 호박고구마 5kg', 5, '5kg 1박스', '보통', '중과', '호박고구마', 'stored', 'home|cook|sweet|keep_long', '촉촉하고 달콤한 해남 호박고구마')
add('farm_haenam', 'sweetpotato_mini_3kg', 'sweet_potato', 'sweet_potato', '한입 꼬마 고구마 3kg', 3, '3kg 1박스', '흠과', '소과', '밤고구마', 'stored', 'home|kids|sweet|cook', '아이 간식으로 굽기 좋은 작은 고구마')
add('farm_haenam', 'green_onion_1kg', 'green_onion', 'green_onion', '해남 흙대파 1kg', 1, '1kg 1단', '소포장', '', '', 'now', 'home|cook|season', '흙째 보내는 겨울 대파. 세워 두면 오래가요')

// 7. 의성 마늘고추밭
add('farm_uiseong', 'garlic_bulb_1kg', 'garlic', 'garlic_bulb', '의성 통마늘 1kg', 1, '1kg 1망', '보통', '', '한지형', 'stored', 'home|cook|keep_long', '6월에 캐서 그늘에 말린 의성 한지형 통마늘')
add('farm_uiseong', 'garlic_peeled_1kg', 'garlic', 'garlic_peeled', '의성 깐마늘 1kg', 1, '1kg 1봉', '보통', '', '한지형', 'stored', 'home|cook|keep_long', '하나하나 깐 의성 깐마늘. 바로 다져 쓰기 좋아요')
add('farm_uiseong', 'garlic_peeled_500g', 'garlic', 'garlic_peeled', '의성 깐마늘 500g', 0.5, '500g 1봉', '소포장', '', '한지형', 'stored', 'home|cook|keep_long', '혼자 쓰기 알맞은 작은 봉 깐마늘')
add('farm_uiseong', 'garlic_peeled_5kg', 'garlic', 'garlic_peeled', '깐마늘 업소용 5kg', 5, '5kg 1박스', '업소용', '', '한지형', 'stored', 'cafe|cook|keep_long', '식당·반찬가게용 대용량 깐마늘')
add('farm_uiseong', 'garlic_pickle_1kg', 'garlic', 'garlic_bulb', '장아찌용 쪽마늘 1kg', 1, '1kg 1봉', '흠과', '소과', '한지형', 'stored', 'home|cook|keep_long', '알이 작아 장아찌 담기 좋은 쪽마늘')
add('farm_uiseong', 'chili_1kg', 'chili_powder', 'chili_powder', '의성 햇고춧가루 1kg (보통맛)', 1, '1kg 1봉', '보통', '', '', 'stored', 'home|cook|keep_long|season', '올여름 딴 고추로 빻은 햇고춧가루. 김장용 굵은 가루')
add('farm_uiseong', 'chili_hot_1kg', 'chili_powder', 'chili_powder', '의성 햇고춧가루 1kg (매운맛)', 1, '1kg 1봉', '보통', '', '', 'stored', 'home|cook|keep_long', '매운 고추를 섞어 빻은 햇고춧가루')
add('farm_uiseong', 'chili_fine_500g', 'chili_powder', 'chili_powder', '고운 고춧가루 500g (양념용)', 0.5, '500g 1봉', '소포장', '', '', 'stored', 'home|cook|keep_long', '고추장·무침 양념에 쓰기 좋은 고운 고춧가루')
add('farm_uiseong', 'onion_5kg', 'onion', 'onion', '의성 양파 5kg', 5, '5kg 1망', '보통', '', '', 'stored', 'home|cook|keep_long', '6월에 캐서 바람에 말려 둔 저장 양파')
add('farm_uiseong', 'onion_15kg', 'onion', 'onion', '양파 업소용 15kg', 15, '15kg 1망', '업소용', '', '', 'stored', 'cafe|cook|keep_long', '식당용 대용량 저장 양파')

// 8. 장흥 숲속표고
add('farm_jangheung', 'shiitake_500g', 'shiitake', 'shiitake_fresh', '원목 생표고 500g', 0.5, '500g 1상자', '보통', '', '', 'now', 'home|cook|eat_soon', '참나무 원목에서 딴 갓이 두툼한 생표고')
add('farm_jangheung', 'shiitake_1kg', 'shiitake', 'shiitake_fresh', '원목 생표고 1kg', 1, '1kg 1상자', '보통', '', '', 'now', 'home|cook|eat_soon', '구이·전골용으로 넉넉한 원목 생표고')
add('farm_jangheung', 'shiitake_ugly_1kg', 'shiitake', 'shiitake_fresh', '생표고 파지 1kg (가정용)', 1, '1kg 1봉', '흠과', '', '', 'now', 'home|cook|eat_soon', '갓이 찢어지거나 모양이 고르지 않은 생표고. 볶음·국물용')
add('farm_jangheung', 'shiitake_300g', 'shiitake', 'shiitake_fresh', '원목 생표고 300g 맛보기', 0.3, '300g 1팩', '소포장', '', '', 'now', 'home|cook|eat_soon', '처음 맛보는 분을 위한 작은 팩 생표고')
add('farm_jangheung', 'shiitake_bulk_2kg', 'shiitake', 'shiitake_fresh', '생표고 업소용 2kg', 2, '2kg 1박스', '업소용', '', '', 'now', 'cafe|cook|eat_soon', '식당·반찬가게용 생표고 대용량')
add('farm_jangheung', 'dried_slice_200g', 'shiitake', 'shiitake_dried', '건표고 슬라이스 200g', 0.2, '200g 1봉', '보통', '', '', 'stored', 'home|cook|keep_long', '썰어서 말린 표고. 불려서 국물·볶음에 써요')
add('farm_jangheung', 'dried_whole_300g', 'shiitake', 'shiitake_dried', '건표고 통 300g', 0.3, '300g 1봉', '보통', '', '', 'stored', 'home|cook|keep_long', '통째로 말린 표고. 육수 내기 좋아요')
add('farm_jangheung', 'fresh_gift_1kg', 'shiitake', 'shiitake_fresh', '원목 생표고 선물 1kg', 1, '1kg 1상자', '선물', '특과', '', 'now', 'gift|cook|eat_soon', '갓이 둥글고 두툼한 생표고만 골라 담은 선물 상자')
add('farm_jangheung', 'powder_100g', 'shiitake', 'shiitake_dried', '표고 가루 100g', 0.1, '100g 1병', '소포장', '', '', 'stored', 'home|cook|keep_long', '말린 표고를 곱게 갈아 국물·볶음 양념에 쓰는 가루')
add('farm_jangheung', 'hwago_gift', 'shiitake', 'shiitake_dried', '화고 선물세트 400g', 0.4, '400g 1상자', '선물', '특과', '', 'stored', 'gift|cook|keep_long', '갓에 꽃무늬가 핀 화고만 고른 건표고 선물세트')

// 9. 고흥 유자마을
add('farm_goheung', 'yuja_1kg', 'citron_tea', 'citron_tea', '고흥 햇유자청 1kg', 1, '1kg 1병', '보통', '', '', 'preorder', 'home|drink|sour|keep_long|season', '11월에 딴 유자를 썰어 설탕에 재운 햇유자청. 11월 20일부터 보내요')
add('farm_goheung', 'yuja_2kg', 'citron_tea', 'citron_tea', '고흥 햇유자청 2kg', 2, '2kg 1병', '가정용', '', '', 'preorder', 'home|drink|sour|keep_long|season', '겨울 내내 차로 마시기 좋은 대용량 햇유자청')
add('farm_goheung', 'yuja_gift', 'citron_tea', 'citron_tea', '유자청 선물세트 (500g 2병)', 1, '500g 2병', '선물', '', '', 'stored', 'gift|drink|sour|keep_long', '작년 유자로 만든 유자청 두 병 선물세트')
add('farm_goheung', 'yuja_cafe_5kg', 'citron_tea', 'citron_tea', '유자청 업소용 5kg', 5, '5kg 1통', '업소용', '', '', 'stored', 'cafe|drink|sour|keep_long', '카페 유자차·에이드용 대용량 유자청')
add('farm_goheung', 'yuja_3kg', 'citron_tea', 'citron_tea', '유자청 3kg', 3, '3kg 1통', '가정용', '', '', 'stored', 'home|drink|sour|keep_long', '작년 유자로 만든 유자청 넉넉한 통')
add('farm_goheung', 'kiwi_gold_2kg', 'kiwi', 'kiwi_gold', '고흥 골드키위 2kg', 2, '2kg 1박스', '보통', '중과', '골드키위', 'now', 'home|raw|sweet|season', '갓 딴 골드키위. 실온에서 며칠 후숙한 뒤 드세요')
add('farm_goheung', 'kiwi_green_3kg', 'kiwi', 'kiwi_green', '고흥 그린키위 3kg', 3, '3kg 1박스', '보통', '중과', '헤이워드', 'now', 'home|raw|sour|season', '새콤달콤한 헤이워드 그린키위. 후숙해서 드세요')
add('farm_goheung', 'kiwi_home_5kg', 'kiwi', 'kiwi_green', '그린키위 가정용 5kg', 5, '5kg 1박스', '가정용', '', '헤이워드', 'now', 'home|raw|sour', '크기를 섞어 담은 가정용 그린키위')
add('farm_goheung', 'kiwi_gift_1_5kg', 'kiwi', 'kiwi_gold', '골드키위 선물 1.5kg', 1.5, '1.5kg 1상자', '선물', '대과', '골드키위', 'now', 'gift|raw|sweet|season', '큰 골드키위만 담은 선물 상자')
add('farm_goheung', 'kiwi_ugly_3kg', 'kiwi', 'kiwi_gold', '못난이 골드키위 3kg', 3, '3kg 1박스', '흠과', '', '골드키위', 'now', 'home|raw|sweet|drink', '모양이 고르지 않은 골드키위. 스무디용으로도 좋아요')

// 10. 거창 사과재
add('farm_geochang', 'fuji_home_5kg', 'apple', 'apple_fuji', '거창 부사 가정용 5kg', 5, '5kg 1박스', '가정용', '', '후지', 'now', 'home|raw|sweet|season', '고랭지에서 일교차를 맞고 자란 거창 부사 가정용', { opts: [['5kg 1박스', 5], ['10kg 1박스', 10]] })
add('farm_geochang', 'fuji_gift_5kg', 'apple', 'apple_fuji', '거창 부사 선물 5kg (특대과)', 5, '5kg 1상자', '선물', '특과', '후지', 'now', 'gift|raw|sweet|season', '큰 사과만 한 알씩 받침에 담은 선물용 부사')
add('farm_geochang', 'shinano_3kg', 'apple', 'apple_shinano', '시나노골드 3kg', 3, '3kg 1박스', '보통', '상과', '시나노골드', 'now', 'home|raw|sweet|sour', '노란 껍질에 새콤달콤한 맛이 나는 시나노골드')
add('farm_geochang', 'shinano_5kg', 'apple', 'apple_shinano', '시나노골드 5kg', 5, '5kg 1박스', '보통', '상과', '시나노골드', 'now', 'home|raw|sweet|sour', '시나노골드를 넉넉히 담은 5kg 상자')
add('farm_geochang', 'fuji_ugly_10kg', 'apple', 'apple_fuji', '못난이 부사 10kg (흠과)', 10, '10kg 1박스', '흠과', '', '후지', 'now', 'home|raw|cook|drink', '우박 자국이나 작은 흠이 있는 부사. 잼·주스용으로도 좋아요')
add('farm_geochang', 'hongro_5kg', 'apple', 'apple_hongro', '홍로 5kg', 5, '5kg 1박스', '보통', '상과', '홍로', 'ended', 'home|raw|sweet', '9월에 나오는 추석 사과 홍로')
add('farm_geochang', 'fuji_small_3kg', 'apple', 'apple_fuji', '거창 부사 소포장 3kg', 3, '3kg 1박스', '소포장', '상과', '후지', 'now', 'home|raw|sweet', '혼자 사는 분께 알맞은 작은 상자 부사')
add('farm_geochang', 'juice_30', 'apple_juice', 'apple_juice', '거창 사과즙 30포', 30, '30포 1박스', '보통', '', '', 'now', 'home|drink|keep_long', '흠과 사과를 짜서 담은 사과즙')
add('farm_geochang', 'juice_100', 'apple_juice', 'apple_juice', '거창 사과즙 100포 (업소용)', 100, '100포 1박스', '업소용', '', '', 'now', 'cafe|drink|keep_long', '카페·사무실에 두기 좋은 사과즙 대용량')
add('farm_geochang', 'fuji_honey_3kg', 'apple', 'apple_fuji', '꿀 든 부사 선물 3kg', 3, '3kg 1상자', '선물', '특과', '후지', 'now', 'gift|raw|sweet|season', '잘랐을 때 속에 꿀(밀병)이 든 사과를 골라 담은 선물 상자')

// ---------- 시뮬레이션 ----------
const roundPrice = (v) => {
  const hundred = Math.round(v / 100) * 100
  return rand() < 0.35 ? Math.max(100, Math.round(v / 1000) * 1000 - 100) : hundred
}
const farmBy = Object.fromEntries(FARMS.map((f) => [f.code, f]))

function priceOf(p, qty) {
  const m = MARKET[p.ref]
  if (!m) throw new Error(`시세 코드 ${p.ref}가 data/market_prices.csv에 없어요`)
  const discount = Math.pow(Math.max(qty, 1), -0.06) // 많이 살수록 kg당 조금 싸게
  return roundPrice(m.per_unit * qty * PACK[p.pack].price * GRADE[p.grade] * discount * between(0.96, 1.04))
}

function harvestOf(p) {
  if (p.mode === 'preorder') return ''
  if (p.ref === 'strawberry_frozen') return pickDate(['2026-03-10', '2026-04-20'])
  if (VARIETY[p.variety]) return pickDate(VARIETY[p.variety].harvest)
  const windows = {
    broccoli: ['2026-10-28', '2026-11-04'], carrot: ['2026-10-20', '2026-11-03'], napa_cabbage: ['2026-10-30', '2026-11-04'],
    radish: ['2026-10-25', '2026-11-04'], green_onion: ['2026-10-28', '2026-11-04'], shiitake: ['2026-11-01', '2026-11-05'],
    sweet_potato: ['2026-09-20', '2026-10-15'], garlic: ['2026-06-05', '2026-06-25'], onion: ['2026-06-01', '2026-06-20'],
    chili_powder: ['2026-08-10', '2026-09-10'], persimmon_chips: ['2026-10-25', '2026-11-02'],
  }
  if (p.ref === 'strawberry_frozen') return pickDate(['2026-03-10', '2026-04-20'])
  if (p.ref === 'gotgam') return pickDate(['2025-10-20', '2025-11-05']) // 작년 곶감 (냉동 보관)
  if (p.ref === 'shiitake_dried') return pickDate(['2026-09-01', '2026-10-20'])
  if (p.ref === 'citron_tea') return pickDate(['2025-11-10', '2025-11-30']) // 작년 유자
  if (p.ref === 'grape_jam') return pickDate(['2026-09-20', '2026-10-15'])
  if (p.ref === 'apple_juice') return pickDate(['2026-10-25', '2026-11-03'])
  const w = windows[p.item] ?? windows[p.ref]
  return w ? pickDate(w) : ''
}

// 출하량(상자): 농가 크기 × 포장 × 무게 (무거운 상자일수록 적게 내놓음)
const allocOf = (p) => Math.round(farmBy[p.farm].scale * { 선물: 60, 보통: 140, 가정용: 110, 흠과: 80, 소포장: 120, 업소용: 30 }[p.pack] * between(0.7, 1.3) / Math.sqrt(Math.max(p.qty, 1) / 3))

function simulate(p) {
  const harvest = harvestOf(p)
  const price = priceOf(p, p.qty)
  const m = MARKET[p.ref]
  const perUnit = price / p.qty
  const fair = m.per_unit * PACK[p.pack].price * GRADE[p.grade]
  const alloc = allocOf(p)
  // 판매 시작: 수확 다음 날 (저장품은 이번 달 1일부터 다시 내놓음), 예약은 판매 전
  const start = p.mode === 'stored' ? '2026-11-01' : harvest ? day(harvest, 1) : TODAY
  const days = Math.max(0, daysBetween(start, TODAY))
  const lambda = PACK[p.pack].demand * Math.pow(fair / perUnit, 1.5) * (p.tags.includes('season') ? 1.3 : 1)
  const sold = p.mode === 'preorder' ? Math.round(alloc * between(0.2, 0.5)) : p.mode === 'ended' ? alloc : Math.min(alloc, poisson(lambda * days))
  const stock = Math.max(0, alloc - sold)
  const v = VARIETY[p.variety]
  const brix = v && p.mode !== 'ended' && p.ref !== 'strawberry_frozen' && rand() > 0.15 ? Math.min(v.brix[0] + 2.5, Math.max(v.brix[0] - 2.5, normal(...v.brix))).toFixed(1) : ''
  const measured = brix ? (p.mode === 'stored' ? day(TODAY, -Math.ceil(between(1, 6))) : day(harvest, Math.floor(between(0, Math.min(3, daysBetween(harvest, TODAY)) + 1)))) : ''
  return { harvest, price, perUnit, fair, alloc, sold, stock, days, lambda, brix, measured }
}

const results = P.map((p) => ({ p, s: simulate(p) }))

// ---------- 검사 ----------
const problems = []
const itemRows = readSheet('items.csv')
const itemBy = Object.fromEntries(itemRows.map((r) => [r.item_code, r]))
const tagCodes = new Set(readSheet('tags.csv').map((r) => r.tag_code))
const codes = new Set()
for (const { p, s } of results) {
  const code = `${p.farm.replace('farm_', '')}_${p.code}`
  if (codes.has(code)) problems.push(`${code}: 상품 코드가 두 번 나와요`)
  codes.add(code)
  if (!itemBy[p.item]) problems.push(`${code}: 품목 ${p.item}이 items.csv에 없어요`)
  const ratio = s.perUnit / MARKET[p.ref].per_unit
  if (ratio < 0.55 || ratio > 1.6) problems.push(`${code}: 단위 가격이 시세의 ${ratio.toFixed(2)}배예요`)
  const tags = p.tags.split('|')
  if (tags.length < 3 || tags.length > 5) problems.push(`${code}: 태그가 ${tags.length}개`)
  tags.filter((t) => !tagCodes.has(t)).forEach((t) => problems.push(`${code}: 없는 태그 ${t}`))
  if (s.harvest && s.harvest > TODAY) problems.push(`${code}: 수확일이 오늘보다 뒤예요`)
  if (s.measured && (s.measured > TODAY || (s.harvest && s.measured < s.harvest))) problems.push(`${code}: 당도 잰 날짜가 이상해요`)
  if (s.brix && itemBy[p.item]?.show_brix !== '예') problems.push(`${code}: 당도를 보여 주지 않는 품목인데 당도가 있어요`)
  if (p.mode === 'preorder' && s.harvest) problems.push(`${code}: 예약 상품인데 수확일이 있어요`)
  if (p.tags.includes('season') && ['stored', 'ended'].includes(p.mode) && !['chili_powder'].includes(p.item)) problems.push(`${code}: 철이 아닌데 제철 태그`)
}
if (results.length !== 100) problems.push(`상품이 ${results.length}개예요 (100개 목표)`)

function noticeOf(p, farm) {
  const item = itemBy[p.item]
  const where = farm.short
  if (item?.category === '가공품') {
    const food = { dried_persimmon: '[예시] 과채가공품', apple_juice: '[예시] 과·채주스', citron_tea: '[예시] 당절임', chili_powder: '[예시] 고춧가루', salted_cabbage: '[예시] 절임식품', grape_jam: '[예시] 잼류' }[p.item]
    const ingredients = { dried_persimmon: `[예시] 감(국내산 ${where}) 100%`, apple_juice: `[예시] 사과(국내산 ${where}) 100%`, citron_tea: `[예시] 유자(국내산 ${where}) 50%, 설탕 50%`, chili_powder: `[예시] 고추(국내산 ${where}) 100%`, salted_cabbage: `[예시] 배추(국내산 ${where}), 천일염(국내산)`, grape_jam: `[예시] 포도(국내산 ${where}), 설탕` }[p.item]
    return { food_type: food, address: `[예시] ${farm.region}`, packed: '[예시] 제품 라벨에 표시', expiry: '[예시] 제품 라벨에 표시', ingredients, nutrition: '[예시] 제품 라벨에 표시', imported: false }
  }
  return { origin: `국내산 (${farm.region.split(' ').slice(0, 2).join(' ')})`, expiry: '받은 뒤 상태를 보며 되도록 빨리 드세요 (보관법은 상품 정보 참고)', composition: `${itemBy[p.item]?.name ?? p.item} ${p.unit}`, imported: false }
}

// 예약 상품의 출고 시작일 (상품 소개 글의 날짜와 같게)
const SHIP_FROM = { salted_cabbage: '2026-11-20', citron_tea: '2026-11-20', semi_dried: '2026-12-05', gotgam: '2026-12-15' }

// ---------- 가입 계획 (npm run onboard-farms 가 이대로 가입·등록한다) ----------
// 농가는 판매자 가입 화면과 같은 API로 가입하고, 관리자가 승인한 뒤, 농가가 직접 로그인해서 상품을 올린다.
// 그래서 여기서는 CSV에 줄을 쓰지 않고 계획(JSON)만 만든다. 농가 코드는 가입할 때 서버가 만든다
const products = []
for (const { p, s } of results) {
  const farm = farmBy[p.farm]
  const code = `${p.farm.replace('farm_', '')}_${p.code}`
  // 옵션: 무게마다 값을 따로 계산하고, 재고는 출하량을 나눠 갖는다 (상품 가격·재고는 서버가 옵션에서 다시 계산)
  const options = p.opts?.map(([name, qty], i) => ({ name, price: priceOf(p, qty), stock: Math.round(s.stock * (i === 0 ? 0.6 : 0.4)) })) ?? []
  const shipFrom = p.mode === 'preorder' ? SHIP_FROM[p.ref] ?? '' : ''
  if (p.mode === 'preorder' && !shipFrom) problems.push(`${code}: 예약 상품인데 출고 시작일이 없어요`)
  products.push({
    login: farm.login, product_code: code, item_code: p.item, name: `[예시] ${p.name}`,
    price: options.length ? Math.min(...options.map((o) => o.price)) : s.price, unit: p.unit,
    stock: options.length ? options.reduce((n, o) => n + o.stock, 0) : s.stock, options,
    // weight_g 는 '1개 무게'라서 상자 무게를 넣지 않는다 (모르면 빈칸). 사과즙은 한 상자 포 수만 안다
    weight_g: '', count_per_box: p.item === 'apple_juice' ? String(p.qty) : '',
    brix: s.brix, brix_measured_at: s.measured, harvest_date: s.harvest, ship_from: shipFrom,
    summary: p.summary, external_url: rand() < 0.5 ? `https://example.com/product/${code.replace(/_/g, '-')}` : '',
    b2b_available: p.pack === '업소용' || p.pack === '선물' || rand() < 0.4,
    tags: p.tags.split('|'), notice: noticeOf(p, farm), variety: p.variety,
  })
}

// 가입 신청서: 모두 예시 값. 사업자등록번호는 일부러 999로 시작하는 가짜 번호, 이메일은 example.com
const farms = FARMS.map((f, i) => ({
  login: f.login, farmName: `[예시] ${f.name}`, region: f.region, ownerName: `[예시] ${f.owner}`, phone: f.tel,
  businessNo: `99900${String(i + 11).padStart(5, '0')}`, email: `${f.login}@example.com`,
  intro: f.intro, story: `${f.story} [예시 문구]`,
}))

// 상품 문의: 손님이 실제로 많이 묻는 배송·포장·수량 질문만 (보관·안전은 품목 검수 전이라 넣지 않는다). 답이 빈 것은 답변 대기
const QUESTIONS = [
  ['haenam_salted_20kg', '김장을 11월 28일에 하는데 그날 맞춰 받을 수 있나요?', '11월 20일부터 주문 순서대로 보내요. 받을 날짜가 정해져 있으면 이 문의에 남겨 주세요. 날짜에 맞춰 보내 드릴게요.'],
  ['haenam_salted_20kg', '20kg이면 배추 몇 포기 정도예요?', '보통 8~10포기 정도 들어가요. 배추 크기에 따라 조금씩 달라요.'],
  ['haenam_salted_10kg', '아파트 경비실에 맡겨 주셔도 되나요?', ''],
  ['namwon_mandarin_s_5kg', '소과는 한 알 크기가 어느 정도예요?', '탁구공보다 조금 큰 크기예요. 아이들이 한입에 먹기 좋아요.'],
  ['namwon_mandarin_ugly_10kg', '못난이 귤은 맛도 덜한가요?', '껍질의 바람 자국이나 흠 때문에 모양만 덜 예쁘고, 같은 밭에서 같은 날 딴 귤이에요.'],
  ['namwon_mandarin_gift_3kg', '선물로 보낼 때 가격표 빼고 보내 주실 수 있나요?', '네, 선물세트에는 가격표를 넣지 않아요.'],
  ['jinyeong_persimmon_top_5kg', '5kg이면 몇 개 정도 들어 있나요?', '특과는 보통 16~20개 정도 들어가요.'],
  ['jinyeong_persimmon_ugly_5kg', '흠과는 어느 정도 흠이에요?', '껍질에 긁힌 자국이나 점이 있는 정도예요. 깎으면 과육은 같아요.'],
  ['sangju_semi_dried_gift', '설 선물로 보내려면 언제까지 주문해야 하나요?', '반건시는 12월 5일부터 보내요. 설 연휴 2주 전까지 주문해 주시면 날짜에 맞춰 보내 드려요.'],
  ['sangju_gotgam_gift', '지금 주문하면 언제 받아요?', '올해 곶감은 12월 15일부터 주문 순서대로 보내 드려요.'],
  ['sangju_apple_juice_50', '사과즙에 설탕이나 물을 넣나요?', '사과만 짜서 담았어요. 원재료는 상품 정보에 적어 두었어요.'],
  ['nonsan_seolhyang_1kg', '토요일에 받을 수 있게 보내 주실 수 있나요?', '딸기는 금요일에는 보내지 않아요. 목요일까지 출고분은 보통 다음 날 도착해요.'],
  ['nonsan_kingsberry_gift', '한 상자에 몇 알 들어가요?', ''],
  ['nonsan_cafe_4kg', '카페에서 매주 정기적으로 받을 수 있나요?', '기업 구매 문의로 수량과 요일을 남겨 주시면 연락드릴게요.'],
  ['yeongdong_shine_2kg', '2kg이면 몇 송이예요?', '송이 크기에 따라 2~3송이 들어가요.'],
  ['yeongdong_grape_jam_500g', '잼에 포도 말고 다른 과일도 들어가나요?', '포도와 설탕만 넣었어요.'],
  ['uiseong_garlic_peeled_1kg', '깐마늘을 바로 다져서 보내 주실 수도 있나요?', '지금은 깐마늘로만 보내 드리고 있어요.'],
  ['uiseong_chili_1kg', '김장 20포기면 고춧가루 몇 kg 사야 할까요?', ''],
  ['jangheung_shiitake_500g', '원목 표고와 배지 표고는 뭐가 달라요?', '저희 표고는 참나무 원목에 종균을 넣어 키워요. 갓이 두툼하고 천천히 자라요.'],
  ['jangheung_hwago_gift', '화고는 일반 건표고와 뭐가 달라요?', '갓에 하얀 꽃무늬처럼 갈라진 표고를 화고라고 해요. 수확량이 적어 따로 골라 담았어요.'],
  ['goheung_yuja_1kg', '햇유자청은 언제 받을 수 있나요?', '11월 20일부터 담근 순서대로 보내 드려요.'],
  ['goheung_kiwi_gold_2kg', '받았는데 너무 딱딱해요.', '갓 딴 키위라 단단한 게 정상이에요. 실온에 며칠 두시면 말랑해져요.'],
  ['geochang_fuji_honey_3kg', '꿀이 꼭 들어 있나요?', '잘라 보고 꿀이 든 사과가 많은 나무에서 골랐지만, 모든 사과에 꿀이 들어 있지는 않아요.'],
  ['geochang_fuji_ugly_10kg', '흠과는 몇 개쯤 들어가요?', ''],
  ['geochang_shinano_3kg', '시나노골드는 부사보다 신가요?', '부사보다 새콤한 맛이 조금 더 나고 향이 진해요.'],
]
const questions = QUESTIONS.map(([code, question, answer], i) => {
  if (!codes.has(code)) problems.push(`문의의 상품 코드 ${code}가 없어요`)
  return { product_code: code, author: `[예시] ${'김이박최정강조윤장임'[i % 10]}고객`, question, answer }
})
const optionRows = products.flatMap((x) => x.options)
const questionRows = questions

// 예전 방식(CSV에 바로 넣던 시뮬레이션 줄)은 지운다. 농가는 이제 가입으로 들어온다
function dropCsvRows(file) {
  const url = new URL(file, DATA)
  const before = readFileSync(url, 'utf8').split('\n').filter(Boolean)
  const kept = before.filter((l) => !l.includes(SIM))
  if (kept.length !== before.length) writeFileSync(url, `${kept.join('\n')}\n`)
  return before.length - kept.length
}

const byFarm = FARMS.map((f) => {
  const mine = results.filter((r) => r.p.farm === f.code)
  const prices = mine.map((r) => r.s.price)
  return `| ${f.name} | ${f.short} | ${mine.length} | ${[...new Set(mine.map((r) => itemBy[r.p.item]?.name ?? r.p.item))].join(', ')} | ${Math.min(...prices).toLocaleString('ko-KR')}~${Math.max(...prices).toLocaleString('ko-KR')}원 | ${mine.filter((r) => r.s.stock === 0 && !r.p.opts).length} |`
})
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`
const report = `# 예시 농가 시뮬레이션

\`npm run simulate-farms\`가 만든 예시 농가 ${FARMS.length}곳, 상품 ${results.length}개의 근거와 검사 결과다. 기준일 ${TODAY}, 씨앗 \`${SEED}\`.
모든 값은 예시다. 실제 농가·가격이 아니며, 이름과 출처 칸에 [예시]를 붙였다.

## 만드는 방법

1. **가격:** 품목별 kg당 시세(\`data/market_prices.csv\`) × 수량 × 포장 계수 × 등급 계수 × 무게 할인(수량^-0.06) × 흔들림(±4%)을 100원 단위로 맞춘다. 일부는 ○○,900원으로 끝낸다
2. **수확일:** 품종·품목의 실제 수확 철 안에서 고른다. 저장품(마늘·양파·고춧가루·샤인머스캣·고구마)은 수확한 달을, 예약 상품(절임배추·햇유자청·올해 곶감)은 비워 둔다
3. **재고:** 출하량(농가 크기 × 포장 × 무게) − 판매 시작일부터 오늘까지 팔린 양. 하루 판매량은 포장별 기준 × (시세 대비 값)^-1.5 × (제철이면 1.3)인 포아송 분포다. 철이 끝난 상품(극조생 감귤, 차랑 단감, 홍로)은 재고 0
4. **당도:** 품종별 평균·편차인 정규분포에서 뽑고 평균 ±2.5 안으로 자른다. 15%는 일부러 비워 둔다 (당도를 재지 않은 상품 시험용)
5. **검사:** 단위 가격이 시세의 0.55~1.6배인지, 태그 3~5개, 수확일·당도 잰 날이 오늘 이전인지, 예약 상품에 수확일이 없는지, 철 지난 상품에 제철 태그가 없는지

### 포장·등급 계수

| 포장 | 가격 | 하루 판매 기준 |
|---|---|---|
${Object.entries(PACK).map(([k, v]) => `| ${k} | ×${v.price} | ${v.demand}개 |`).join('\n')}

등급: ${Object.entries(GRADE).filter(([k]) => k).map(([k, v]) => `${k} ×${v}`).join(', ')}

### 시세 (\`data/market_prices.csv\`)

| 코드 | 품목 | 단위당 | 근거 |
|---|---|---|---|
${Object.values(MARKET).map((m) => `| ${m.ref_code} | ${m.name} | ${won(m.per_unit)}/${m.unit} | ${m.basis} |`).join('\n')}

## 결과

| 농가 | 지역 | 상품 | 품목 | 가격 | 품절 |
|---|---|---|---|---|---|
${byFarm.join('\n')}

- 판매 방식: 지금 판매 ${results.filter((r) => r.p.mode === 'now').length}개, 저장품 ${results.filter((r) => r.p.mode === 'stored').length}개, 예약 ${results.filter((r) => r.p.mode === 'preorder').length}개, 철 끝남 ${results.filter((r) => r.p.mode === 'ended').length}개
- 품절(재고 0): ${results.filter((r) => r.s.stock === 0).map((r) => r.p.name).join(', ') || '없음'}
- 옵션이 있는 상품: ${results.filter((r) => r.p.opts).length}개 (옵션 ${optionRows.length}줄)
- 당도가 있는 상품: ${results.filter((r) => r.s.brix).length}개, 상품 문의 ${questionRows.length}개 (답변 대기 ${QUESTIONS.filter((q) => !q[2]).length}개)

## 검사

${problems.length ? problems.map((x) => `- ${x}`).join('\n') : '- 문제 없음'}

## 상품별 계산

| 상품 | 수량 | 시세 대비 | 가격 | 출하 | 판매 | 재고 | 당도 |
|---|---|---|---|---|---|---|---|
${results.map(({ p, s }) => `| ${p.name} | ${p.unit} | ${(s.perUnit / MARKET[p.ref].per_unit).toFixed(2)} | ${won(s.price)} | ${s.alloc} | ${s.sold} | ${s.stock} | ${s.brix || '-'} |`).join('\n')}

## 한계

- KAMIS 값은 서울 소매가 하루치(2026-11-05)다. 감귤·딸기·샤인머스캣·표고·가공품은 그날 KAMIS 값이 없어 가정값이다 (표의 근거 칸)
- 판매량 모형은 가격만 본다. 광고, 후기, 요일, 날씨는 넣지 않았다
- 새 품목 17개의 보관·안전 정보는 Claude 초안이고, 품목은 검수 전(pending)으로 들어간다. 관리자 [품목 검수]에서 출처를 확인하고 검수해야 손님 화면과 상담에 나온다
- 상품 사진이 없다
`

console.log(`농가 ${FARMS.length}곳 · 상품 ${results.length}개 · 옵션 ${optionRows.length}줄 · 문의 ${questionRows.length}개 · 검사 문제 ${problems.length}건`)
problems.forEach((x) => console.log(`  - ${x}`))
if (!CHECK_ONLY) {
  if (problems.length) {
    console.log('검사 문제가 있어서 파일을 바꾸지 않았어요')
    process.exit(1)
  }
  writeFileSync(PLAN, `${JSON.stringify({ seed: SEED, today: TODAY, source: SIM, farms, products, questions }, null, 2)}\n`)
  const dropped = ['sellers.csv', 'products.csv', 'product_options.csv', 'questions.csv'].map((f) => `${f} ${dropCsvRows(f)}줄`).join(', ')
  writeFileSync(REPORT, report)
  console.log(`→ data/sample_farms.json, docs/farm_simulation.md (예전 CSV 줄 지움: ${dropped})`)
  console.log('다음: npm run onboard-farms (농가 가입 → 관리자 승인 → 상품 등록)')
}
