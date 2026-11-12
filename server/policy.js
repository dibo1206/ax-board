// 몰 운영 정책: 사업자 정보·배송비·약관·개인정보 처리방침·교환/환불 정책
// [대괄호] 값과 [예시] 표시는 기업 확인 후 바꾼다. 약관·처리방침은 초안이라 기업·법률 검토가 필요하다.
// 사업자 정보는 기업 홈페이지(yunjufarm.co.kr) 아래쪽에 공개된 값 (기업이 홈페이지 내용 사용을 허락함)
//
// 쇼핑몰 설정 (2026-11-08): 관리자가 [쇼핑몰 설정]에서 고친 값은 DB(shop_settings)에 두고, 서버를 켤 때와 저장할 때 applySettings 로
// 아래 SHOP·SHIPPING·RETURNS·POLICIES 를 그 자리에서 바꾼다 (다른 파일은 같은 객체를 가져다 쓰므로 바로 새 값을 본다).
// 약관 글의 {배송비} 같은 자리표시는 설정 값으로 채운다 → 배송비를 바꾸면 환불 정책 글도 함께 바뀐다

export const DEFAULT_SHOP = Object.freeze({
  name: '윤주 마켓(YOONJU MARKET)',
  company: '윤주(주)농업회사법인',
  ceo: '배윤주',
  bizNo: '235-87-03341',
  mailOrderNo: '2025-충남천안-2000',
  address: '충남 천안시 서북구 동서대로 163, 충남타워 1002호(여성기업종합지원센터)',
  phone: '041-544-2566',
  email: 'olive7083@naver.com',
  hours: '평일 09:00~18:00 (점심 13:00~14:00) · 토·일·공휴일 휴무',
  privacyOfficer: '[개인정보 보호책임자 이름·연락처]',
})

// 배송비는 주문 한 번에 한 번 (2026-11-12 회사 결정: 4,500원, 상품 합계 30,000원 이상이면 무료, 택배는 CJ대한통운).
// 여러 농가 상품을 함께 사도 손님은 한 번만 낸다. 농가마다 따로 보내므로 받은 배송비는 상품 금액 비율로 농가 배송에 나눠 적는다
// (농가별 부분 취소·반품 환불·정산이 그 몫을 쓴다: splitShippingFee)
export const DEFAULT_SHIPPING = Object.freeze({
  fee: 4500,
  freeOver: 30000,
  courier: 'CJ대한통운',
  leadTime: '결제 후 1~3일 안에 출고해요 (주말·공휴일 제외)',
})

// 반품 신청 기준 (server/returns.js 가 이 값으로 신청 기간을 검사하고 환불 한도를 계산한다. 아래 교환·환불 정책 글도 이 값으로 만든다)
// 기간은 받은 날(배송 완료로 바뀐 날, 한국 날짜) 다음 날부터 센다 [가설: 기업·법률 확인 필요]
//  - 단순 변심: 받은 날부터 changeMindDays 일 / 상품 하자·표시와 다름·오배송: 받은 날부터 defectMonths 개월
//  - "그 사실을 안 날부터 30일"은 코드가 알 수 없어서 담당자가 사유를 보고 판단한다
// 단순 변심 반품 받기 (changeMind): 회사 결정(2026-11-12)으로 기본은 받지 않는다 — 음료·식품이라 단순 변심 환불은 안 되고
// 파손·상품 문제만 반품. [가설: 법률 확인 필요] 전자상거래법은 7일 청약철회가 원칙이고 신선식품처럼 다시 팔기 어렵거나
// 뜯어서 가치가 떨어진 경우 등을 미리 알렸을 때만 막을 수 있어서, 뜯지 않은 가공품은 고객센터로 문의하도록 안내한다.
// 관리자가 [쇼핑몰 설정 > 반품]에서 켜면 아래 기간·한도대로 다시 받는다
// 환불 한도 (돈을 돌려주는 금액의 최대치. 실제 금액은 관리자가 확인해 정한다)
//  - 단순 변심: 왕복 배송비를 손님이 낸다 → 돌려보낼 상품 금액에서 돌려보내는 배송비(기본 배송비)를 빼고,
//    처음 배송(주문)이 무료였으면 보낼 때 배송비(기본 배송비)도 뺀다. 처음 낸 배송비는 돌려주지 않는다
//  - 상품 하자·오배송: 판매자가 배송비를 낸다 → 돌려보낼 상품 금액 + 그 농가 배송에 나눠 적은 배송비
//  - 어느 경우든 그 농가 배송에 낸 돈(상품 + 배송비)에서 이미 돌려준 돈을 뺀 만큼을 넘지 않는다
export const DEFAULT_RETURNS = Object.freeze({ changeMind: false, changeMindDays: 7, defectMonths: 3, defectKnownDays: 30 })
const REASONS = { change_mind: '단순 변심', defect: '상품 하자·파손·표시와 다름', wrong_item: '오배송(다른 상품이 왔어요)' }
const reasonsNow = () => Object.fromEntries(Object.entries(REASONS).filter(([key]) => key !== 'change_mind' || RETURNS.changeMind))

// 관리자 알림 메일 (새 주문·반품 신청·문의·판매자 가입). 손님 화면에는 내보내지 않는다 (SHOP 은 /api/policy 로 공개된다)
// 받는 곳(to)을 비우면 .env 의 ADMIN_EMAIL 을 쓴다. 참조(cc)는 여러 곳
export const DEFAULT_NOTIFY = Object.freeze({ to: '', cc: [] })

// 정책 글 (자리표시는 fillPolicy 가 채운다. 관리자 화면에 쓸 수 있는 자리표시 목록이 나온다)
export const PLACEHOLDERS = {
  '{회사}': '회사 이름', '{쇼핑몰}': '쇼핑몰 이름', '{전화}': '대표전화', '{이메일}': '이메일', '{보호책임자}': '개인정보 보호책임자',
  '{배송비}': '기본 배송비', '{무료배송}': '무료 배송 기준 금액', '{출고}': '출고 안내', '{택배사}': '택배사',
  '{변심기간}': '단순 변심 반품 기간(일)', '{하자기간}': '하자 반품 기간(개월)', '{하자인지기간}': '하자를 안 날부터 기간(일)',
  '{변심안내}': '단순 변심 반품 안내 (받는지 여부에 따라 바뀜)', '{변심배송비}': '단순 변심 반품 배송비 안내 (받을 때만 나옴)',
}
export const DEFAULT_POLICIES = Object.freeze({
  refund: {
    title: '교환·환불 정책',
    sections: [
      ['신청 기간', '상품이 파손됐거나 하자가 있거나 표시·광고 내용과 다르거나 다른 상품이 왔으면 받은 날부터 {하자기간}개월, 그 사실을 안 날부터 {하자인지기간}일 안에 교환·환불을 신청할 수 있어요. {변심안내}'],
      ['상품 확인', '과일·채소는 시간이 지나면 상태가 바뀌어요. 받은 상품이 파손됐거나 문제가 있으면 받은 날 바로 사진과 함께 알려 주세요.'],
      ['배송비', '상품 하자·파손·오배송이면 판매자가 배송비를 부담해서 처음 낸 배송비도 함께 돌려드려요. {변심배송비}배송비는 주문 한 번에 {배송비}이고, 상품 합계가 {무료배송} 이상이면 무료예요. 여러 농가 상품을 함께 주문해도 배송비는 한 번만 내요 (상품은 농가마다 따로 도착할 수 있어요).'],
      ['결제 취소', '배송 준비 전(결제 완료 상태)이면 [주문 조회]에서 바로 취소할 수 있어요. 배송 준비가 시작된 뒤에는 고객센터로 요청해 주세요. 여러 농가 상품을 함께 주문했으면 아직 보내지 않은 농가 몫만 취소할 수 있고, 그 농가의 상품 금액과 그 농가 몫의 배송비(낸 배송비를 상품 금액 비율로 나눈 금액)를 돌려드려요. 이미 보낸 농가 상품은 받은 뒤 반품으로 신청해 주세요.'],
      ['환불 시점', '돌려받은 상품을 확인한 뒤 3영업일 안에 결제 수단으로 환불해요. 카드 결제는 카드사 사정에 따라 며칠 더 걸릴 수 있어요.'],
      ['신청 방법', '배송 완료된 상품은 [주문 조회](비회원) 또는 마이페이지 주문 내역에서 농가별로 [반품 신청]을 눌러 사유를 적어 주세요. 신청만으로 환불되지는 않고, 담당자가 확인해 승인한 뒤 환불해요. 상품 사진은 고객센터({전화}, {이메일})로 주문번호와 함께 보내 주세요.'],
    ],
  },
  terms: {
    title: '이용약관',
    sections: [
      ['목적', '이 약관은 {회사}(이하 "회사")가 운영하는 {쇼핑몰}에서 상품을 사고파는 데 필요한 회사와 이용자의 권리·의무를 정해요.'],
      ['판매자', '판매자로 가입하면 회사가 농가·사업자 정보를 확인한 뒤 승인해요. 판매자는 올린 상품 정보(당도·수확일·무게·원산지 등)의 정확성과 배송에 책임을 져요. 회사는 표시와 다른 상품을 내리거나 판매자 활동을 멈출 수 있어요.'],
      ['주문과 계약', '이용자가 주문서를 쓰고 결제를 마치면 구매 계약이 이루어져요. 회사는 재고가 없거나 주문 정보가 잘못된 경우 주문을 취소하고 결제 금액을 돌려드릴 수 있어요.'],
      ['결제', '결제는 토스페이먼츠 결제창에서 이루어지고, 카드 번호 같은 결제 정보는 회사 서버에 저장하지 않아요.'],
      ['배송', '{출고}. 배송비는 주문 한 번에 {배송비}이고 상품 합계가 {무료배송} 이상이면 무료예요. 여러 농가 상품을 함께 주문하면 농가마다 따로 보내지만 배송비는 한 번만 내요. 예약 상품은 상품 페이지에 적힌 출고 시작일부터 주문 순서대로 보내고, 같은 농가의 다른 상품도 그때 함께 보내요.'],
      ['상품 정보 표시', '당도·수확일·무게 같은 상품 정보는 판매 농가가 직접 적고 그 정확성에 책임을 져요. 회사는 당도계 사진 같은 근거를 받고, 판매 중 수정 이력을 남기며, 구매 후기에서 표시와 다르다는 의견이 많으면 표시를 내리고 판매 농가에 바로잡도록 요청해요.'],
      ['교환·환불', '교환·환불은 [교환·환불 정책]을 따르며, 전자상거래 등에서의 소비자보호에 관한 법률이 정한 범위 안에서 처리해요.'],
      ['AI 상담', 'AI 상담은 등록된 상품 정보를 바탕으로 한 안내이고, 건강 상태에 대한 판단이나 환불 결정은 하지 않아요. 정확한 내용은 담당자 답변을 따라 주세요.'],
      ['분쟁 해결', '분쟁이 생기면 회사와 이용자가 성실히 협의하고, 해결되지 않으면 관련 법령과 소비자분쟁해결기준을 따라요.'],
    ],
  },
  // 회사 홈페이지 하단의 이메일무단수집거부 (정보통신망법 제50조의2)
  noemail: {
    title: '이메일무단수집거부',
    sections: [
      ['이메일 무단 수집 거부', '이 사이트에 게시된 이메일 주소가 전자우편 수집 프로그램이나 그 밖의 기술적 장치를 이용해 무단으로 수집되는 것을 거부해요.'],
      ['위반하면', '이를 어기면 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 따라 처벌받을 수 있어요.'],
    ],
  },
  privacy: {
    title: '개인정보 처리방침',
    sections: [
      ['모으는 정보와 목적', '주문: 주문자·받는 분 이름, 휴대폰 번호, 배송 주소 (상품 배송·주문 확인). 상품 질문·기업 구매 문의: 이름, 연락처(선택 또는 필수) (답변·견적 안내). AI 상담: 질문 내용 (상담 품질 개선). 재입고 알림: 이메일 (신청 확인 메일과 다시 들어오면 한 번 알림, 확인 메일의 링크로 언제든 취소하면 바로 삭제, 보낸 뒤 30일·못 보내면 180일 뒤 삭제). 카카오·네이버 간편 로그인: 회원 번호(찾기용 암호값으로만 저장)·이메일·이름 (로그인과 회원 관리, 탈퇴 시 삭제). 결제 정보는 토스페이먼츠가 처리하며 회사는 카드 번호를 받지 않아요.'],
      ['판매자 가입 정보', '농가·상호 이름, 지역, 대표자 이름, 연락처, 사업자등록번호, 이메일 (판매자 확인·승인 안내·정산·연락). 판매자 활동이 끝나면 법으로 정한 기간이 지난 뒤 지워요.'],
      ['보관 기간', '전자상거래법에 따라 계약·청약철회 기록과 대금 결제·재화 공급 기록은 5년, 소비자 불만·분쟁 처리 기록은 3년 보관해요. 문의 연락처는 처리를 마친 뒤 [90일], AI 상담 기록은 [1년], 결제하지 않은 주문 정보는 [30일], 보낸 메일 기록은 [90일], 관리자·판매자 접속 기록은 [2년] 보관한 뒤 자동으로 지워요.'],
      ['다른 곳에 맡기거나 주는 경우', '결제: 토스페이먼츠. 배송: {택배사} (받는 분 이름·연락처·주소). 서비스 운영 서버: [호스팅 업체].'],
      ['AI 상담과 국외 처리', '규칙으로 바로 답하지 못한 상담 질문과 AI 상담 질문은 OpenRouter(미국)를 거쳐 AI 모델로 처리돼요. 보내기 전에 전화번호·이메일·주민등록번호는 자동으로 가리지만, 상담창에는 개인정보를 쓰지 말아 주세요.'],
      ['이용자의 권리', '내 개인정보를 열람·정정·삭제하거나 처리를 멈추도록 요청할 수 있어요. 고객센터로 연락해 주세요. 법으로 보관해야 하는 정보는 그 기간 동안 보관해요.'],
      ['안전하게 지키는 방법', '관리자 비밀번호는 암호화(해시)해 저장하고, 개인정보는 권한이 있는 관리자만 볼 수 있어요. 공개 화면에는 이름 첫 글자만 보여요.'],
      ['개인정보 보호책임자', '{보호책임자}'],
    ],
  },
})
export const POLICY_KINDS = Object.keys(DEFAULT_POLICIES)

const clone = (v) => JSON.parse(JSON.stringify(v))
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

// 지금 쓰는 값 (다른 파일이 가져다 쓴다. applySettings 가 그 자리에서 바꾼다)
export const SHOP = { ...DEFAULT_SHOP }
export const SHIPPING = { ...DEFAULT_SHIPPING }
export const RETURNS = { ...DEFAULT_RETURNS, reasons: {} }
RETURNS.reasons = reasonsNow()
export const NOTIFY = { ...DEFAULT_NOTIFY, cc: [] }
export const POLICIES = {}
let policyTemplates = clone(DEFAULT_POLICIES)

// 주문 전체 상품 금액으로 배송비를 정한다 (주문 한 번에 한 번)
export function shippingFee(itemsAmount) {
  return itemsAmount >= SHIPPING.freeOver ? 0 : SHIPPING.fee
}

// 주문 배송비를 농가 배송에 상품 금액 비율로 나눈다. 원 단위로 내리고 남는 원은 상품 금액이 가장 큰 농가에 둔다 (합은 늘 fee)
// farms: [{ itemsAmount }] → 같은 순서의 몫 배열
export function splitShippingFee(farms, fee) {
  const total = farms.reduce((sum, f) => sum + f.itemsAmount, 0)
  if (!fee || !total) return farms.map(() => 0)
  const shares = farms.map((f) => Math.floor((fee * f.itemsAmount) / total))
  const biggest = farms.reduce((best, f, i) => (f.itemsAmount > farms[best].itemsAmount ? i : best), 0)
  shares[biggest] += fee - shares.reduce((sum, n) => sum + n, 0)
  return shares
}

const changeMindText = () => (RETURNS.changeMind
  ? `단순 변심이면 상품을 받은 날부터 ${RETURNS.changeMindDays}일 안에 신청할 수 있어요.`
  : '음료·식품을 파는 쇼핑몰이라 단순 변심에 의한 교환·환불은 받지 않아요 (뜯지 않은 가공품은 고객센터로 문의해 주세요). 상품이 파손됐거나 상품에 문제가 있으면 반품할 수 있어요.')
const changeMindFeeText = () => (RETURNS.changeMind
  ? `단순 변심이면 왕복 배송비를 손님이 부담해요: 돌려보내는 배송비 ${won(SHIPPING.fee)}을 환불 금액에서 빼고, 처음 배송이 무료였으면 보낼 때 배송비 ${won(SHIPPING.fee)}도 빼요 (처음 낸 배송비는 돌려드리지 않아요). `
  : '')

export function fillPolicy(text) {
  const values = {
    '{회사}': SHOP.company, '{쇼핑몰}': SHOP.name, '{전화}': SHOP.phone, '{이메일}': SHOP.email, '{보호책임자}': SHOP.privacyOfficer,
    '{배송비}': won(SHIPPING.fee), '{무료배송}': won(SHIPPING.freeOver), '{출고}': SHIPPING.leadTime, '{택배사}': SHIPPING.courier,
    '{변심기간}': String(RETURNS.changeMindDays), '{하자기간}': String(RETURNS.defectMonths), '{하자인지기간}': String(RETURNS.defectKnownDays),
    '{변심안내}': changeMindText(), '{변심배송비}': changeMindFeeText(),
  }
  return String(text).replace(/\{[가-힣]+\}/g, (m) => values[m] ?? m)
}

function rebuildPolicies() {
  for (const kind of POLICY_KINDS) {
    const t = policyTemplates[kind] ?? DEFAULT_POLICIES[kind]
    POLICIES[kind] = { title: t.title, sections: t.sections.map(([title, text]) => [title, fillPolicy(text)]) }
  }
}
rebuildPolicies()

// DB 에 저장된 설정 { shop, shipping, returns, policies } 를 기본값 위에 덮어 지금 값으로 만든다
export function applySettings(saved = {}) {
  Object.assign(SHOP, DEFAULT_SHOP, saved.shop ?? {})
  Object.assign(SHIPPING, DEFAULT_SHIPPING, saved.shipping ?? {})
  Object.assign(RETURNS, DEFAULT_RETURNS, saved.returns ?? {})
  RETURNS.reasons = reasonsNow()
  Object.assign(NOTIFY, DEFAULT_NOTIFY, saved.notify ?? {})
  NOTIFY.cc = [...(NOTIFY.cc ?? [])]
  policyTemplates = { ...clone(DEFAULT_POLICIES), ...(saved.policies ?? {}) }
  rebuildPolicies()
}
const returnsValues = (r) => ({ changeMind: r.changeMind, changeMindDays: r.changeMindDays, defectMonths: r.defectMonths, defectKnownDays: r.defectKnownDays })
// 관리자 화면에만 보낸다 (notify 는 공개하지 않는 값)
export const currentSettings = () => ({ shop: { ...SHOP }, shipping: { ...SHIPPING }, returns: returnsValues(RETURNS), notify: { to: NOTIFY.to, cc: [...NOTIFY.cc] }, policies: clone(policyTemplates) })
export const defaultSettings = () => ({ shop: { ...DEFAULT_SHOP }, shipping: { ...DEFAULT_SHIPPING }, returns: returnsValues(DEFAULT_RETURNS), notify: { to: '', cc: [] }, policies: clone(DEFAULT_POLICIES) })

// ---------- 검사 (관리자가 저장할 때) ----------
const str = (errors, value, max, name, required = true) => {
  const s = typeof value === 'string' ? value.trim() : ''
  if (required && !s) errors.push(`${name}을(를) 적어 주세요.`)
  else if (s.length > max) errors.push(`${name}은(는) ${max}자 안으로 적어 주세요.`)
  return s
}
const int = (errors, value, min, max, name) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) errors.push(`${name}은(는) ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 사이 정수로 적어 주세요.`)
  return n
}
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,190}\.[A-Za-z]{2,}$/
export const SETTING_KEYS = ['shop', 'shipping', 'returns', 'notify', 'policies']
export function validateSettings(key, v = {}) {
  const errors = []
  let value = null
  if (key === 'shop') {
    value = {
      name: str(errors, v.name, 40, '쇼핑몰 이름'), company: str(errors, v.company, 40, '회사 이름'), ceo: str(errors, v.ceo, 20, '대표자'),
      bizNo: str(errors, v.bizNo, 12, '사업자등록번호'), mailOrderNo: str(errors, v.mailOrderNo, 40, '통신판매업 신고번호'),
      address: str(errors, v.address, 120, '주소'), phone: str(errors, v.phone, 20, '대표전화'), email: str(errors, v.email, 100, '이메일'),
      hours: str(errors, v.hours, 80, '업무 시간'), privacyOfficer: str(errors, v.privacyOfficer, 80, '개인정보 보호책임자'),
    }
    if (value.bizNo && !/^\d{3}-\d{2}-\d{5}$/.test(value.bizNo)) errors.push('사업자등록번호는 000-00-00000 모양으로 적어 주세요.')
    if (value.phone && !/^[0-9][0-9-]{7,18}$/.test(value.phone)) errors.push('대표전화는 숫자와 -만 적어 주세요. (예: 041-544-2566)')
    if (value.email && !/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(value.email)) errors.push('이메일 모양이 아니에요.')
  } else if (key === 'shipping') {
    value = {
      fee: int(errors, v.fee, 0, 100_000, '기본 배송비'), freeOver: int(errors, v.freeOver, 0, 10_000_000, '무료 배송 기준'),
      courier: str(errors, v.courier, 30, '택배사'), leadTime: str(errors, v.leadTime, 80, '출고 안내'),
    }
  } else if (key === 'returns') {
    // 전자상거래법: 청약철회 7일, 표시·광고와 다르면 받은 날부터 3개월·안 날부터 30일 — 이보다 짧게는 못 정한다
    value = {
      changeMind: v.changeMind === true,
      changeMindDays: int(errors, v.changeMindDays, 7, 60, '단순 변심 반품 기간(일, 법정 최소 7일)'),
      defectMonths: int(errors, v.defectMonths, 3, 12, '하자 반품 기간(개월, 법정 최소 3개월)'),
      defectKnownDays: int(errors, v.defectKnownDays, 30, 90, '하자를 안 날부터 기간(일, 법정 최소 30일)'),
    }
  } else if (key === 'notify') {
    // 받는 곳 1개 + 참조 여러 개. 참조는 배열이나 쉼표·줄바꿈으로 나눈 글 모두 받는다
    const to = typeof v.to === 'string' ? v.to.trim() : ''
    const raw = Array.isArray(v.cc) ? v.cc : typeof v.cc === 'string' ? v.cc.split(/[\s,;]+/) : []
    const cc = [...new Set(raw.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))].filter((s) => s.toLowerCase() !== to.toLowerCase())
    if (to && (to.length > 254 || !EMAIL.test(to))) errors.push('알림 받을 메일 모양이 아니에요.')
    if (!to && cc.length) errors.push('참조를 넣으려면 알림 받을 메일도 적어 주세요.')
    if (cc.length > 5) errors.push('참조는 5곳까지 넣을 수 있어요.')
    const bad = cc.filter((s) => s.length > 254 || !EMAIL.test(s))
    if (bad.length) errors.push(`참조 메일 모양을 확인해 주세요: ${bad.slice(0, 3).join(', ').slice(0, 120)}`)
    value = { to, cc: cc.slice(0, 5) }
  } else if (key === 'policies') {
    value = {}
    for (const kind of POLICY_KINDS) {
      const p = v?.[kind]
      if (!p) continue
      const name = DEFAULT_POLICIES[kind].title
      const sections = (Array.isArray(p.sections) ? p.sections : []).slice(0, 30)
        .map((s, i) => [str(errors, s?.[0], 40, `${name} ${i + 1}번 제목`), str(errors, s?.[1], 3000, `${name} ${i + 1}번 글`)])
      if (!sections.length) errors.push(`${name}에 항목을 1개 이상 넣어 주세요.`)
      value[kind] = { title: str(errors, p.title, 40, `${name} 제목`), sections }
    }
    if (!Object.keys(value).length) errors.push('고칠 정책 글이 없어요.')
  } else {
    errors.push('고칠 수 없는 설정이에요.')
  }
  return { value, errors }
}
