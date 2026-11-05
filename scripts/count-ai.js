// AI 없이 몇 개나 답하는지 세기 (AI는 부르지 않는다 → 토큰 0, 무료 키 한도도 안 씀)
// data/chatbot_tests.csv 질문 + 말투를 바꾼 질문들을 손님 화면처럼(AI 버튼 안 누름) 물어보고,
// [AI에게 물어보기]가 필요했던 질문만 따로 보여 준다
// 사용: npm run count-ai
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { answerChat } from '../server/chat.js'
import { pool } from '../server/db.js'
import { parseCsv } from './csv.js'

const [header, ...rows] = parseCsv(await readFile(new URL('../data/chatbot_tests.csv', import.meta.url), 'utf8'))
const tests = rows.map((r) => r[header.indexOf('question')])
// 같은 뜻을 다르게 묻는 질문 (손님마다 말투가 달라서)
const variations = [
  '사과는 어떻게 보관하나요?', '배 냉동해도 되나요?', '복숭아 언제까지 먹을 수 있어요?', '고구마로 해 먹을 요리 있어요?',
  '포도잼 뜯은 뒤에 어디 둬요?', '감자 싹 난 거 먹어도 돼요?', '사과 선물세트랑 가정용 차이가 뭐예요?', '당근 어디서 키웠어요?',
  '배즙 알레르기 성분 있어요?', '배 언제 수확했어요?', '보관 어떻게 해요?', '매실청 유통기한 얼마나 돼요?', '복숭아 상온에 둬도 돼요?',
  '사과 맛있어요?', '배즙 맛이 어때요?', '복숭아 알레르기 있는데 먹어도 돼요?', '선물세트 포장 어떻게 와요?', '오늘 기분 어때요?',
]

// 답함: DB·규칙으로 답 / 안내: 상품과 상관없거나 자료가 없어 질문 버튼·Q&A로 안내 / AI 버튼: 손님이 누르면 AI
const count = { answered: 0, guided: 0, ask: 0 }
const asked = []
for (const [group, list] of [['테스트 질문', tests], ['말투 바꾼 질문', variations]]) {
  console.log(`\n=== ${group} ${list.length}개`)
  for (const message of list) {
    const r = await answerChat({ message }, { useCache: false, allowAi: false })
    const kind = r.model === 'similar:rag' ? 'answered' : r.askAi === true ? 'ask' : r.model === 'rule:ask' ? 'guided' : 'answered'
    count[kind] += 1
    if (kind === 'ask') asked.push(message)
    console.log(`  ${{ answered: '답함   ', guided: '안내   ', ask: 'AI 버튼' }[kind]} ${r.model.padEnd(15)} ${message} → ${r.answer.slice(0, 90)}`)
  }
}
const total = count.answered + count.guided + count.ask
console.log(`\n질문 ${total}개 · AI 호출 0회`)
console.log(`  DB·규칙으로 답함 ${count.answered}개 · 질문 버튼·Q&A로 안내 ${count.guided}개 · [AI에게 물어보기] 버튼 ${count.ask}개${asked.length ? ` (${asked.join(' / ')})` : ''}`)
console.log('※ 손님이 [AI에게 물어보기]를 누르지 않으면 이 질문들도 AI를 부르지 않는다 (고를 수 있는 질문 + 상품 Q&A 안내)')
await pool.end()
