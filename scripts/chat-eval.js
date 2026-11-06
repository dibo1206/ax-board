// 챗봇 평가: 질문표를 손님 화면처럼(AI 버튼 안 누름) 물어보고 정답·자신 있게 틀림·모른다고 넘김으로 나눠 센다 → docs/chat_eval_report.md
// AI를 부르지 않는다 (토큰 0). AI 버튼을 눌렀을 때의 답은 npm run eval-chat 으로 따로 본다
// 사용: npm run chat-eval
// 자동 판정은 글자 비교라 참고용이다. 틀림 항목과 팀 밖 질문은 사람이 답을 읽고 판정한다
import 'dotenv/config'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { answerChat } from '../server/chat.js'
import { pool } from '../server/db.js'
import { prepareRag, RAG_MODEL } from '../server/rag.js'
import { parseCsv } from './csv.js'

const readRows = async (name) => {
  const url = new URL(`../data/${name}`, import.meta.url)
  if (!existsSync(url)) return []
  const [header, ...rows] = parseCsv(await readFile(url, 'utf8'))
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
const asked = [
  ...await readRows('chat_eval.csv'),
  ...(await readRows('chat_eval_outside.csv')).map((r) => ({ ...r, group: '팀 밖', kind: r.who || '-', expect: '' })),
]

// 띄어쓰기·쉼표 차이로 틀리지 않게 지우고 비교한다
const plain = (text) => String(text ?? '').replace(/[\s,]/g, '')
const hasAny = (text, list) => list.split('|').filter(Boolean).find((word) => text.includes(plain(word)))
// must: ; 로 나눈 묶음은 모두, | 로 나눈 말은 그중 하나만 있으면 된다
const missing = (text, must) => must.split(';').filter(Boolean).find((group) => !hasAny(text, group))

function judge(t, r) {
  if (!t.expect) return { result: '사람 확인', why: '기대값 없음' }
  const text = plain(r.answer)
  const bad = hasAny(text, t.forbid ?? '')
  if (bad) return { result: '틀림', why: `하면 안 되는 말: ${bad}` }
  // 답을 못 찾아 안내로 넘긴 것. 담당자 안내 문구만 붙은 답은 넘긴 것으로 치지 않는다
  // 벡터 검색으로 찾은 글을 답으로 냈으면 AI 버튼이 함께 있어도 답한 것이다. 틀리면 틀림으로 센다
  const passed = r.model !== 'similar:rag' && (r.handoff || r.askAi || r.model === 'rule:ask' || text.includes('찾지못했'))
  // 건강·환불처럼 사람에게 넘겨야 하는 질문: 규칙이 직접 넘겨야 정답이다. [AI에게 물어보기]로 가면 AI가 답할 수 있어서 넘김으로 따로 센다
  if (t.expect === 'handoff') return r.handoff ? { result: '정답', why: '' } : passed ? { result: '넘김', why: '규칙이 넘기지 않고 AI 버튼·안내로 감' } : { result: '틀림', why: '담당자에게 넘겨야 하는데 답함' }
  const lack = missing(text, t.must ?? '')
  if (!lack) return { result: '정답', why: '' }
  if (passed) return { result: '넘김', why: '' }
  return { result: '틀림', why: `기대한 내용 없음: ${lack}` }
}

const ragOn = await prepareRag().catch((error) => { console.warn(`벡터 검색 없이 평가해요: ${error.message}`); return false })

const results = []
for (const t of asked) {
  const r = await answerChat({ message: t.question, productCode: t.product_code || null }, { useCache: false, allowAi: false })
  results.push({ t, r, ...judge(t, r) })
}

const RESULTS = ['정답', '틀림', '넘김', '사람 확인']
const count = (list) => Object.fromEntries(RESULTS.map((k) => [k, list.filter((x) => x.result === k).length]))
const pct = (n, all) => (all ? `${Math.round((n / all) * 100)}%` : '-')
const line = (name, list) => {
  const c = count(list)
  return `| ${name} | ${list.length} | ${c.정답} (${pct(c.정답, list.length)}) | ${c.틀림} (${pct(c.틀림, list.length)}) | ${c.넘김} (${pct(c.넘김, list.length)}) | ${c['사람 확인']} |`
}
const by = (key) => [...new Set(results.map((x) => x.t[key]))].map((name) => line(name, results.filter((x) => x.t[key] === name)))
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const table = (list) => (list.length
  ? `| 묶음 | 질문 | 상품 | 이유 | 답 |\n|---|---|---|---|---|\n${list.map(({ t, r, why }) => `| ${t.group} | ${cell(t.question)} | ${t.product_code || ''} | ${cell(why)} | ${cell(r.answer).slice(0, 220)} |`).join('\n')}`
  : '없음')
const HEAD = '| 묶음 | 질문 수 | 정답 | 자신 있게 틀림 | 모른다고 넘김 | 사람 확인 |\n|---|---|---|---|---|---|'

await writeFile(new URL('../docs/chat_eval_report.md', import.meta.url), `# 챗봇 평가 결과

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 질문 ${results.length}개 · 벡터 검색 ${ragOn ? `켬 (${RAG_MODEL})` : '끔'} · AI 호출 0회 (AI 버튼을 누른 뒤의 답은 평가하지 않음)
- 자동 판정은 글자 비교라 참고용이다. 틀림 항목은 사람이 답을 읽어 확인한다
- 목표: 자신 있게 틀림 0건. 팀 질문과 다른 묶음의 차이가 크면 규칙이 팀 질문에 맞춰졌다는 뜻이다

## 묶음별

${HEAD}
${by('group').join('\n')}
${line('전체', results)}

## 유형별

${HEAD.replace('묶음', '유형')}
${by('kind').join('\n')}

## 자신 있게 틀림

${table(results.filter((x) => x.result === '틀림'))}

## 모른다고 넘김

${table(results.filter((x) => x.result === '넘김'))}

## 사람 확인 (팀 밖 질문)

${table(results.filter((x) => x.result === '사람 확인'))}

## 정답으로 판정한 답 (팀 질문 제외, 사람이 읽어 확인)

${table(results.filter((x) => x.result === '정답' && x.t.group !== '팀 질문'))}
`)
console.log(`${HEAD}\n${by('group').join('\n')}\n${line('전체', results)}\n→ docs/chat_eval_report.md`)
await pool.end()
