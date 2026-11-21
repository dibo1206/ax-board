// 상품 Q&A를 검색 답으로 쓸 때 시험 (DB·AI 없이): npm run test-rag-qna
//   1) 사이트 의견·불만에 단 답("수정하겠습니다", "맞습니다")은 상품 정보가 아니라 쓰지 않는다
//   2) 특정 상품에 단 답("딸기는 금요일에 안 보내요")은 그 품목을 물을 때만 답으로 낸다
import { chooseQuote } from '../server/chat.js'
import { notAnAnswer } from '../server/rag.js'

let count = 0
let failed = 0
const check = (name, ok, detail = '') => {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

// 1. 상품 정보가 아닌 답 (실습 DB에 실제로 있던 글)
for (const [q, a] of [
  ['딸기 보관 얼마나 할 수 있는지 궁금한데 Q&A물어보라고 하네요;;', '맞습니다'],
  ['익명으로 질문한건데 왜 다 공개되는건가요? 신고하겠습니다', '비공개 기능 추가하겠습니다'],
  ['왜 검색창에 띄어쓰기는 다 지켜야 되나요?', '띄어쓰기 안해도 검색 되도록 수정하겠습니다'],
  ['왜 챗봇은 계속 초기화 되는건가요?', '챗봇을 했을 시 기억 해주는 기능과 내용이 사라지지 않도록 수정하겠습니다'],
  ['상단 상품 검색 눌렀는데 왜 자꾸 이달의 상품에 검색하라고 하는건가여', '죄송합니다..'],
  ['정작 검색하면 아무것도 안나오나요? 장사가 장난인가요', '수정 할게요..'],
  ['마이페이지를 왜 로그인을 해야 대시보드에 보이는건가요?', '그렇게 만들겠습니다.'],
]) check(`빼는 답: "${a}"`, notAnAnswer(q, a))

// 상품 정보인 답은 그대로 쓴다 (짧거나 "~드릴게요"로 끝나도)
for (const [q, a] of [
  ['잼에 포도 말고 다른 과일도 들어가나요?', '포도와 설탕만 넣었어요.'],
  ['선물로 보낼 때 가격표 빼고 보내 주실 수 있나요?', '네, 선물세트에는 가격표를 넣지 않아요.'],
  ['카페에서 매주 정기적으로 받을 수 있나요?', '기업 구매 문의로 수량과 요일을 남겨 주시면 연락드릴게요.'],
  ['김장을 11월 28일에 하는데 그날 맞춰 받을 수 있나요?', '11월 20일부터 주문 순서대로 보내요. 날짜에 맞춰 보내 드릴게요.'],
  ['신고배는 언제 와요?', '9월 말부터 보내 드려요.'],
]) check(`쓰는 답: "${a}"`, !notAnAnswer(q, a))

// 2. 특정 상품에 단 답
const strawberryQna = {
  key: 'qna:442', item_code: 'strawberry', product_code: 'nonsan_seolhyang_1kg', trusted: true, score: 0.7,
  text: '설향 딸기 1kg 상품 문의 — 질문: 토요일에 받을 수 있게 보내 주실 수 있나요? 답: 딸기는 금요일에는 보내지 않아요. 목요일까지 출고분은 보통 다음 날 도착해요.',
}
check('품목을 말하지 않은 질문에는 딸기 Q&A를 답으로 내지 않음', chooseQuote([strawberryQna], '토요일에 받을 수 있게 보내 주나요') === null)
check('다른 품목을 물을 때도 내지 않음', chooseQuote([strawberryQna], '사과 토요일에 받을 수 있게 보내 주나요', { itemNames: ['사과'], itemCodes: ['apple'] }) === null)
check('딸기를 물으면 답으로 냄', chooseQuote([strawberryQna], '딸기 토요일에 받을 수 있게 보내 주나요', { itemNames: ['딸기'], itemCodes: ['strawberry'] })?.key === 'qna:442')
check('그 상품 페이지에서 물으면 답으로 냄', chooseQuote([strawberryQna], '토요일에 받을 수 있게 보내 주나요', { productCode: 'nonsan_seolhyang_1kg' })?.key === 'qna:442')
const policy = { key: 'policy:shipping', item_code: null, product_code: null, trusted: true, score: 0.7, text: '평일 오후 2시까지 결제하면 그날 출고해요 (주말·공휴일 제외).' }
check('품목과 상관없는 정책 글은 그대로 답으로 냄', chooseQuote([policy], '오후 몇 시까지 결제하면 그날 출고해요')?.key === 'policy:shipping')

console.log(`\n${count - failed}/${count} 통과`)
process.exit(failed ? 1 : 0)
