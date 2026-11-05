// 임베딩 모델 비교: data/rag_eval.csv 의 tune 질문으로 모델을 고른다
//   npm run rag-bakeoff -- 모델1 모델2 ...
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { embed } from '../server/ai.js'
import { pool } from '../server/db.js'
import { buildChunks, dot } from '../server/rag.js'
import { similarity } from '../server/similar.js'
import { parseCsv } from './csv.js'

const [header, ...rows] = parseCsv(await readFile(new URL('../data/rag_eval.csv', import.meta.url), 'utf8'))
const all = rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
const tune = all.filter((q) => q.split === 'tune')
const positives = tune.filter((q) => q.expect !== 'none')
const negatives = tune.filter((q) => q.expect === 'none')
const chunks = await buildChunks()
console.log(`조각 ${chunks.length}개, 질문 ${tune.length}개 (답 있음 ${positives.length}, 없음 ${negatives.length})`)

const hit = (ranked, q, k) => ranked.slice(0, k).some((r) => q.expect.split('|').includes(r.key))
function report(name, rank) {
  const scored = positives.map((q) => ({ q, ranked: rank(q) }))
  const stat = (list) => (list.length ? `${Math.min(...list).toFixed(3)}~${Math.max(...list).toFixed(3)}` : '-')
  const right = scored.filter((x) => hit(x.ranked, x.q, 1)).map((x) => x.ranked[0].score)
  console.log(`=== ${name}`)
  console.log(`  1위 ${right.length}/${positives.length} · 3위 안 ${scored.filter((x) => hit(x.ranked, x.q, 3)).length}/${positives.length}`)
  console.log(`  맞힌 1위 점수 ${stat(right)} · 답 없는 질문의 1위 점수 ${stat(negatives.map((q) => rank(q)[0].score))}`)
}
report('글자 비교', (q) => chunks.map((c) => ({ key: c.key, score: similarity(q.question, c.text) })).sort((a, b) => b.score - a.score))

const unit = (v) => {
  const size = Math.hypot(...v) || 1
  return v.map((x) => x / size)
}
for (const model of process.argv.slice(2)) {
  try {
    const prefix = (kind, text) => (/e5/i.test(model) ? `${kind}: ${text}` : text)
    const vectors = []
    for (let i = 0; i < chunks.length; i += 32) vectors.push(...await embed(model, chunks.slice(i, i + 32).map((c) => prefix('passage', c.text))))
    const started = Date.now()
    const queries = (await embed(model, tune.map((q) => prefix('query', q.question)))).map(unit)
    const units = vectors.map(unit)
    const byQuestion = new Map(tune.map((q, i) => [q.question, queries[i]]))
    report(`${model} (질문 ${tune.length}개 ${Date.now() - started}ms)`, (q) => chunks.map((c, i) => ({ key: c.key, score: dot(byQuestion.get(q.question), units[i]) })).sort((a, b) => b.score - a.score))
  } catch (error) {
    console.log(`=== ${model}: 쓸 수 없음 · ${error.message.slice(0, 100)}`)
  }
}
await pool.end()
