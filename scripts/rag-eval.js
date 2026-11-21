// 벡터 검색 평가: data/rag_eval.csv 질문을 실제 챗봇과 같은 조건으로 검색해서 글자 비교와 견준다
//   npm run rag-eval            tune 질문만 (기준 점수를 정할 때)
//   npm run rag-eval -- test    test 질문까지 (기준을 정한 뒤 결과를 낼 때. 결과를 보고 기준을 다시 고치면 더는 새 질문이 아니다)
// AI를 부르지 않는다
import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { chooseQuote, findEvidence, loadCatalog, pickContext, quoteContext } from '../server/chat.js'
import { pool } from '../server/db.js'
import { buildChunks, prepareRag, RAG_ANSWER_GAP, RAG_ANSWER_MIN, RAG_MODEL } from '../server/rag.js'
import { similarity } from '../server/similar.js'
import { parseCsv } from './csv.js'

const withTest = process.argv[2] === 'test'
const [header, ...rows] = parseCsv(await readFile(new URL('../data/rag_eval.csv', import.meta.url), 'utf8'))
const questions = rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  .filter((q) => withTest || q.split === 'tune')

await prepareRag()
const catalog = await loadCatalog()
const chunks = await buildChunks()

const results = []
for (const q of questions) {
  const ctx = pickContext(catalog, { message: q.question, history: [], productCode: null })
  const evidence = await findEvidence(q.question, catalog, ctx)
  const bigram = chunks.map((c) => ({ key: c.key, score: similarity(q.question, c.text) })).sort((a, b) => b.score - a.score)
  results.push({ q, ctx, evidence, bigram, expected: q.expect.split('|') })
}

const inTop = (list, r, k) => list.slice(0, k).some((c) => r.expected.includes(c.key))
function summarize(list, min = RAG_ANSWER_MIN, gap = RAG_ANSWER_GAP) {
  const quoted = (r) => chooseQuote(r.evidence, r.q.question, { ...quoteContext(r.ctx), min, gap })
  const hasAnswer = list.filter((r) => r.q.expect !== 'none')
  const noAnswer = list.filter((r) => r.q.expect === 'none')
  return {
    total: hasAnswer.length,
    bigram1: hasAnswer.filter((r) => inTop(r.bigram, r, 1)).length,
    bigram3: hasAnswer.filter((r) => inTop(r.bigram, r, 3)).length,
    vector1: hasAnswer.filter((r) => inTop(r.evidence, r, 1)).length,
    vector3: hasAnswer.filter((r) => inTop(r.evidence, r, 3)).length,
    vector5: hasAnswer.filter((r) => inTop(r.evidence, r, 5)).length,
    right: hasAnswer.filter((r) => quoted(r) && inTop(r.evidence, r, 1)).length,
    wrong: hasAnswer.filter((r) => quoted(r) && !inTop(r.evidence, r, 1)).length,
    falseHit: noAnswer.filter(quoted).length,
    negatives: noAnswer.length,
  }
}

const tune = results.filter((r) => r.q.split === 'tune')
console.log('기준 점수별 (tune): 찾은 글을 답으로 냄 → 맞음 / 틀림 / 답 없는 질문에 답함')
for (const min of [0.5, 0.55, 0.58, 0.6, 0.62, 0.65, 0.68]) {
  for (const gap of [0, 0.02, 0.03, 0.05, 0.07]) {
    const s = summarize(tune, min, gap)
    console.log(`  ${min.toFixed(2)} 차이 ${gap.toFixed(2)}: 맞음 ${s.right}/${s.total} · 틀림 ${s.wrong} · 답 없는 질문 ${s.falseHit}/${s.negatives}`)
  }
}

const row = (name, s) => `| ${name} | ${s.total} | ${s.bigram1} | ${s.bigram3} | ${s.vector1} | ${s.vector3} | ${s.vector5} | ${s.right} | ${s.wrong} | ${s.falseHit}/${s.negatives} |`
const HEAD = '| 질문 묶음 | 답 있는 질문 | 글자 비교 1위 | 글자 비교 3위 안 | 벡터 1위 | 벡터 3위 안 | 벡터 5위 안 | 글을 답으로 냄: 맞음 | 글을 답으로 냄: 틀림 | 답 없는 질문에 답함 |\n|---|---|---|---|---|---|---|---|---|---|'
const groups = withTest ? [
  ['tune (기준을 정한 질문)', tune],
  ['test (기준을 정한 뒤 처음 돌린 질문)', results.filter((r) => r.q.split === 'test')],
  ['test2 (11/22 추가: 새 품목·실제 상담 기록 말투)', results.filter((r) => r.q.split === 'test2')],
  ['전체', results],
] : [['tune (기준을 정한 질문)', tune]]
console.log(`\n${HEAD}\n${groups.map(([name, list]) => row(name, summarize(list))).join('\n')}`)

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|')
const detail = results.map((r) => {
  const top = r.evidence[0]
  const said = chooseQuote(r.evidence, r.q.question, quoteContext(r.ctx))
  const verdict = r.q.expect === 'none' ? (said ? '틀림' : '바르게 안 답함') : said ? (inTop(r.evidence, r, 1) ? '맞음' : '틀림') : '답 안 함'
  const rival = r.evidence[1]
  return `| ${r.q.split} | ${cell(r.q.question)} | ${cell(r.q.expect)} | ${top ? `${cell(top.key)} (${top.score.toFixed(3)}, 차이 ${rival ? (top.score - rival.score).toFixed(3) : '-'})` : '-'} | ${verdict} |`
}).join('\n')

if (withTest) {
  await writeFile(new URL('../docs/rag_eval.md', import.meta.url), `# 벡터 검색 평가

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 모델 ${RAG_MODEL} · 글을 답으로 내는 기준 점수 ${RAG_ANSWER_MIN}, 점수 차이 ${RAG_ANSWER_GAP} · 자료 조각 ${chunks.length}개 · AI 호출 0회
- 질문은 Claude가 만들었고 손님 말투를 다 대표하지 않는다. 자료도 예시 데이터라 양이 적다
- test 질문은 조건을 정하는 동안 이미 몇 번 돌렸다. 처음 보는 질문의 값이 아니다
- test2 질문(11/22)은 새로 생긴 품목과 실제 상담 기록 말투로 만들었고, 정답을 먼저 적은 뒤 돌렸다
- 자료가 늘어 예전 질문에도 맞는 답이 새로 생겨서, 그런 조각은 정답에 더했다 (rag_eval.csv 의 note 열에 표시)
- 글자 비교 열은 품목 필터 없이 같은 조각에서 찾은 값이고, 벡터 열은 실제 챗봇과 같은 필터를 쓴 값이다
- 다시 돌리기: \`npm run rag-eval -- test\`

${HEAD}
${groups.map(([name, list]) => row(name, summarize(list))).join('\n')}

## 질문별

| 묶음 | 질문 | 정답 조각 | 찾은 1위 (점수) | 판정 |
|---|---|---|---|---|
${detail}
`)
  console.log('→ docs/rag_eval.md')
} else {
  console.log(`\n질문별\n${detail}`)
}
await pool.end()
process.exit(0)
