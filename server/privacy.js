// 사람을 알아볼 수 있는 정보(주민등록번호·카드번호·이메일·전화번호)를 가린다.
// AI 상담 질문은 무료 모델로 나가고(입력을 학습에 쓸 수 있음) 상담 기록에도 남기 때문에, 둘 다 하기 전에 가린다.
const PATTERNS = [
  [/(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)/g, '(주민등록번호 가림)'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(이메일 가림)'],
  [/(?<![\d+])\+?82[-\s.]?\(?0?\)?1\d[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/g, '(전화번호 가림)'], // +82 10-1234-5678 같은 국제 표기
  [/(?<!\d)0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/g, '(전화번호 가림)'],
  [/\bFM\d{6}-[A-Z0-9]{10}\b/gi, '(주문번호 가림)'],
]

// 손님이 글 칸(문의·메모·주소)에 주민등록번호·카드번호를 써 넣으면 저장하지 않고 다시 쓰게 한다 (수집 금지·최소 수집)
function luhn(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

export function findSensitive(...texts) {
  const all = texts.filter((t) => typeof t === 'string').join(' ')
  if (/(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)/.test(all)) return '주민등록번호'
  for (const [match] of all.matchAll(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g)) {
    const digits = match.replace(/[^0-9]/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return '카드번호'
  }
  return null
}

export const SENSITIVE_MESSAGE = (kind) => `${kind}처럼 민감한 정보는 적지 말아 주세요. 필요한 정보만 남겨 주시면 담당자가 확인해요.`

// 카드번호처럼 보이는 13~19자리 숫자(검사 숫자가 맞는 것만)를 가린다. 그냥 긴 숫자(송장번호 등)는 남긴다
const CARD_LIKE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g

export function maskPersonal(text) {
  let masked = false
  let result = text.replace(CARD_LIKE, (match) => {
    const digits = match.replace(/[^0-9]/g, '')
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match
    masked = true
    return `(카드번호 가림)${/[ -]$/.test(match) ? match.slice(-1) : ''}`
  })
  for (const [re, label] of PATTERNS) {
    result = result.replace(re, () => {
      masked = true
      return label
    })
  }
  return { text: result, masked }
}
