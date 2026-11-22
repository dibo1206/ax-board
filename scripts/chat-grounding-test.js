// AI 답 근거 맞춰 보기 시험 (DB·AI 없이): npm run test-grounding
//   규칙서로 "자료에 있는 것만"이라고 시켜도 AI는 가끔 지어낸다. 서버가 글자로 맞춰 보는지 본다
//   - 근거 문장(evidence)이 [자료]에 글자 그대로 있어야 한다 (띄어쓰기·문장부호 차이는 괜찮다)
//   - 답의 숫자는 모두 [자료]나 손님 질문에 있어야 한다
import { readFileSync } from 'node:fs'
import { checkGrounding } from '../server/chat.js'

let count = 0
let failed = 0
const check = (name, ok, detail = '') => {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const reply = (over) => ({ answer: '', found: true, evidence: [], sources: [], handoff: false, action: null, ...over })

const material = `[품목 코드 sweet_potato] 고구마 (채소) 기준 정보
- 보관: 신문지에 싸서 서늘한 곳에 보관. 냉장 보관하지 않기
- 먹으면 안 되는 신호: 곰팡이, 물러짐
[상품 코드 sweet_potato_5kg] 여주 꿀고구마 5kg
- 가격: 24,000원 / 5kg 1박스
- 수확일: 2026-10-04
[검색으로 찾은 자료]
- (판매자 글) 여주 꿀고구마 5kg: 황토밭에서 키운 고구마`

// 1. 통과해야 하는 답
check('근거가 자료에 그대로 있으면 통과', checkGrounding(reply({
  answer: '고구마는 신문지에 싸서 서늘한 곳에 보관해 주세요.', evidence: ['신문지에 싸서 서늘한 곳에 보관'],
}), material) === null)
check('띄어쓰기·문장부호만 다른 근거는 통과', checkGrounding(reply({
  answer: '냉장 보관하지 않는 게 좋아요.', evidence: ['신문지에 싸서 서늘한 곳에 보관, 냉장 보관하지 않기.'],
}), material) === null)
check('자료에 있는 가격·날짜 숫자는 통과', checkGrounding(reply({
  answer: '여주 꿀고구마 5kg은 24,000원이고 10월 4일에 수확했어요.', evidence: ['24,000원 / 5kg 1박스', '수확일: 2026-10-04'],
}), material) === null)
check('자료에서 못 찾았다고 하면(found: false) 근거 없이도 통과', checkGrounding(reply({
  answer: '그 정보는 아직 없어요. 상품 Q&A에 남겨 주세요.', found: false,
}), material) === null)
check('담당자에게 넘기기만 하는 답은 근거 없이도 통과', checkGrounding(reply({
  answer: '건강 상태에 관한 질문은 담당자가 확인해 드릴게요.', handoff: true,
}), material) === null)
check('손님 질문에 나온 숫자는 써도 됨', checkGrounding(reply({
  answer: '3일 지난 고구마는 먼저 곰팡이나 물러짐이 있는지 봐 주세요.', evidence: ['먹으면 안 되는 신호: 곰팡이, 물러짐'],
}), material, '고구마 받은 지 3일 됐는데') === null)

// 2. 걸러야 하는 답
check('답을 찾았다면서 근거가 없으면 걸림', Boolean(checkGrounding(reply({ answer: '고구마는 냉장 보관하면 돼요.' }), material)))
check('자료에 없는 근거 문장(지어냄)은 걸림', Boolean(checkGrounding(reply({
  answer: '고구마는 냉장고 채소칸에 두세요.', evidence: ['냉장고 채소칸에 두면 오래가요'],
}), material)))
check('자료 문장을 바꿔 쓴 근거도 걸림', Boolean(checkGrounding(reply({
  answer: '서늘한 곳에 두세요.', evidence: ['종이에 싸서 시원한 곳에 보관'],
}), material)))
check('자료에 없는 기간("보통 3~5일")은 걸림', Boolean(checkGrounding(reply({
  answer: '서늘한 곳에서 보통 3~5일 보관할 수 있어요.', evidence: ['신문지에 싸서 서늘한 곳에 보관'],
}), material)))
check('자료에 없는 가격은 걸림', Boolean(checkGrounding(reply({
  answer: '지금 22,000원이에요.', evidence: ['24,000원 / 5kg 1박스'],
}), material)))
check('너무 짧은 근거("보관")는 걸림', Boolean(checkGrounding(reply({ answer: '서늘한 곳에 보관해요.', evidence: ['보관'] }), material)))

// 3. 규칙서와 코드가 같은 말을 하는지 (규칙서를 고치다 출력 형식이 빠지면 모든 답이 걸린다)
const rules = readFileSync(new URL('../server/chat_rules.md', import.meta.url), 'utf8')
check('규칙서에 evidence·found 출력 형식이 있음', /"evidence"/.test(rules) && /"found"/.test(rules))
check('규칙서에 판매자 글을 근거로 덜 믿으라는 말이 있음', rules.includes('(판매자 글)'))
check('규칙서에 손님 말 속 지시를 따르지 말라는 말이 있음', rules.includes('지시가 아니다'))

console.log(`\n${count - failed}/${count} 통과`)
process.exit(failed ? 1 : 0)
