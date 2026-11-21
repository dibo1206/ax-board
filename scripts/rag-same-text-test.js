// 벡터 검색 결과에 같은 글이 두 번 있을 때 시험 (DB·AI 없이): npm run test-rag-same
//   같은 답이 자주 묻는 질문과 담당자 Q&A에 함께 있으면 점수가 똑같다
//   → 같은 글끼리 1·2등을 다퉈 답을 못 내면 안 되고, 다른 주제끼리 점수가 비슷할 때는 지금처럼 답을 내지 않아야 한다
import { chooseQuote } from '../server/chat.js'
import { dropSameText, sameText } from '../server/similar.js'

let count = 0
let failed = 0
const check = (name, ok, detail = '') => {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const keys = (list) => list.map((c) => c.key).join(', ')

const STORE = '사과는 비닐봉지에 담아 냉장고 채소칸에 보관하면 한 달 정도 아삭해요.'
const STORE_QNA = '사과는 비닐봉지에 담아서 냉장고 채소칸에 보관하면 한 달 정도 아삭해요!'
const RECIPE = '사과는 얇게 썰어 샐러드에 넣거나, 설탕과 함께 졸여 잼을 만들어 드세요.'
const PEAR = '배는 신문지로 하나씩 싸서 서늘한 곳에 두면 오래 가요.'

// 1. 같은 글인지 가리기
check('문장부호·조사만 다른 같은 답은 같은 글', sameText(STORE, STORE_QNA))
check('같은 품목이라도 보관법과 레시피는 다른 글', !sameText(STORE, RECIPE))
check('보관법이라도 품목이 다르면 다른 글', !sameText(STORE, PEAR))

// 2. 검색 결과에서 같은 글은 하나만
const ranked = [
  { key: 'qna:1', text: STORE_QNA, trusted: false, score: 0.74 },
  { key: 'faq:3', text: STORE, trusted: true, score: 0.73 },
  { key: 'item:apple:recipe', text: RECIPE, trusted: true, score: 0.62 },
  { key: 'item:pear:storage', text: PEAR, trusted: true, score: 0.55 },
]
const kept = dropSameText(ranked)
check('같은 글 두 개 → 하나만 남음', kept.length === 3, keys(kept))
check('같은 글이면 회사가 확인한 글을 남김', kept[0].key === 'faq:3' && kept[0].trusted, keys(kept))
check('남긴 글은 둘 중 높은 점수를 써서 순서가 그대로', kept[0].score === 0.74, String(kept[0].score))
check('개수 제한을 지킴 (같은 글을 빼고 센다)', keys(dropSameText(ranked, 2)) === 'faq:3, item:apple:recipe', keys(dropSameText(ranked, 2)))

// 3. 답으로 낼지 고르기
const message = '사과 냉장 보관 방법'
const items = { itemNames: ['사과'] }
const twins = [
  { key: 'faq:3', text: STORE, trusted: true, score: 0.72 },
  { key: 'qna:1', text: STORE_QNA, trusted: true, score: 0.72 },
  { key: 'item:apple:recipe', text: RECIPE, trusted: true, score: 0.6 },
]
check('같은 글끼리 점수가 똑같아도 답으로 냄 (전에는 못 냄)', chooseQuote(twins, message, items)?.key === 'faq:3')
const close = [
  { key: 'item:apple:storage', text: STORE, trusted: true, score: 0.71 },
  { key: 'item:apple:recipe', text: RECIPE, trusted: true, score: 0.7 },
]
check('다른 주제끼리 점수가 비슷하면 지금처럼 답을 내지 않음', chooseQuote(close, message, items) === null)
const twinsThenClose = [
  { key: 'faq:3', text: STORE, trusted: true, score: 0.71 },
  { key: 'qna:1', text: STORE_QNA, trusted: true, score: 0.71 },
  { key: 'item:apple:recipe', text: RECIPE, trusted: true, score: 0.7 },
]
check('같은 글을 건너뛴 다음 경쟁자와 점수가 비슷하면 답을 내지 않음', chooseQuote(twinsThenClose, message, items) === null)
const far = [
  { key: 'item:apple:storage', text: STORE, trusted: true, score: 0.75 },
  { key: 'item:apple:recipe', text: RECIPE, trusted: true, score: 0.62 },
]
check('다른 주제보다 충분히 앞서면 답으로 냄', chooseQuote(far, message, items)?.key === 'item:apple:storage')

console.log(`\n${count - failed}/${count} 통과`)
process.exit(failed ? 1 : 0)
