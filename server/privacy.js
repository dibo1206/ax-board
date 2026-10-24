// 사람을 알아볼 수 있는 정보(주민등록번호·이메일·전화번호)를 가린다.
// AI 상담 질문은 무료 모델로 나가고(입력을 학습에 쓸 수 있음) 상담 기록에도 남기 때문에, 둘 다 하기 전에 가린다.
const PATTERNS = [
  [/(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)/g, '(주민등록번호 가림)'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(이메일 가림)'],
  [/(?<!\d)0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/g, '(전화번호 가림)'],
]

export function maskPersonal(text) {
  let masked = false
  let result = text
  for (const [re, label] of PATTERNS) {
    result = result.replace(re, () => {
      masked = true
      return label
    })
  }
  return { text: result, masked }
}
