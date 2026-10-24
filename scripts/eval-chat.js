// AI 상담 테스트: data/chatbot_tests.csv 질문을 하나씩 물어보고 docs/chat_eval.md 에 결과를 쓴다
// 사용: npm run eval-chat              (전체)
//       npm run eval-chat -- 1-5,8,11  (고른 번호만. 무료 키는 하루 호출 수가 적어서 나눠 돌릴 수 있다)
// 자동 판정은 참고용. 최종 판정은 사람이 표의 '답'을 읽고 한다.
import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { answerChat } from '../server/chat.js'
import { pool } from '../server/db.js'
import { parseCsv } from './csv.js'

const [header, ...rows] = parseCsv(await readFile(new URL('../data/chatbot_tests.csv', import.meta.url), 'utf8'))
const tests = rows.map((r, i) => ({ no: i + 1, ...Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])) }))
const wanted = process.argv[2] ?? `1-${tests.length}`
const ranges = wanted.split(',').map((part) => part.split('-').map(Number))
const picked = tests.filter((t) => ranges.some(([a, b]) => t.no >= a && t.no <= (b || a)))

// 기대 답에 숫자가 있으면 답에 그 숫자가 있는지, '넘김'이면 담당자에게 넘겼는지, '범위 밖'이면 근거 없이 답했는지 본다
function autoJudge(t, r) {
  if (r.error) return '✗ 오류'
  if (t.expected_source === '범위 밖') return r.sources.length === 0 && !/원|Brix/.test(r.answer) ? '✓' : '✗'
  if (t.expected_source === '넘김') return r.handoff ? '✓' : '✗'
  const numbers = (t.expected.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !/^(1[0-2]|[1-9])$/.test(n) || /대/.test(t.expected))
  if (numbers.length) {
    const plain = r.answer.replace(/,/g, '')
    return numbers.every((n) => plain.includes(n)) ? '✓' : '✗'
  }
  if (/품절/.test(t.expected)) return /품절/.test(r.answer) ? '✓' : '✗'
  if (/없다고|지어내지/.test(t.expected)) return /없/.test(r.answer) && !/\d+(\.\d)?\s*Brix/i.test(r.answer) ? '✓' : '✗'
  return '사람 확인'
}

const results = []
for (const t of picked) {
  const started = Date.now()
  let r
  try {
    r = await answerChat({ message: t.question }, { useCache: false }) // 저장된 답 말고 매번 새로 물어 모델을 잰다
  } catch (error) {
    r = { error: `${error.status ?? ''} ${error.message}`, answer: '', sources: [], handoff: false, model: '' }
  }
  const judge = autoJudge(t, r)
  results.push({ t, r, judge, ms: Date.now() - started })
  console.log(`${String(t.no).padStart(2)}. ${judge} ${t.question} → ${(r.error ?? r.answer).slice(0, 60)}`)
  if (!r.model?.startsWith('rule:')) await new Promise((ok) => setTimeout(ok, 3500)) // 무료 모델 분당 20회 제한
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const ok = results.filter((x) => x.judge === '✓').length
const manual = results.filter((x) => x.judge === '사람 확인').length
const report = `# AI 상담 테스트 결과

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 질문 ${results.length}개 (${wanted}번)
- 자동 판정 ✓ ${ok} / ✗ ${results.length - ok - manual} / 사람 확인 ${manual}
- 규칙으로 바로 넘긴 질문 ${results.filter((x) => x.r.model?.startsWith('rule:')).length}개 · 답 검사에 걸려 담당자로 넘긴 질문 ${results.filter((x) => x.r.blocked).length}개
- 목표(PRD): 테스트 질문 50개 중 90% 이상 맞게 답하거나 바르게 넘기기, 지어낸 가격·정책 0건

| # | 유형 | 질문 | 기대 | 답 | 근거 | 넘김 | 모델 | 자동 |
|---|---|---|---|---|---|---|---|---|
${results.map(({ t, r, judge }) => `| ${t.no} | ${cell(t.question_type)} | ${cell(t.question)} | ${cell(t.expected)} | ${cell(r.error ?? r.answer)}${r.problem ? ` (검사: ${cell(r.problem)})` : ''} | ${cell(r.sources.map((s) => s.code).join(', '))} | ${r.handoff ? '예' : ''}${r.action ? ` (${r.action})` : ''} | ${cell(r.model)} | ${judge} |`).join('\n')}
`
await writeFile(new URL('../docs/chat_eval.md', import.meta.url), report)
console.log(`\n자동 판정 ✓ ${ok}/${results.length} (사람 확인 ${manual}) → docs/chat_eval.md`)
await pool.end()
