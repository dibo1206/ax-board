// OpenRouter 호출. 키는 .env 의 OPENROUTER_API_KEY 에서만 읽고, 코드·로그·응답에 키 값을 쓰지 않는다.
import OpenAI from 'openai'
import { pool } from './db.js'

// 무료 등급 키라서 무료 모델만 쓴다. 무료 모델은 자주 붐비니(429) 앞에서부터 차례로 시도한다.
// JSON 모드를 지원하는 모델만 고른다 (2026-10-23 확인). 바꾸려면 .env 에 CHAT_MODEL=모델ID,모델ID
export const MODELS = (process.env.CHAT_MODEL
  || 'dots-studio/dots-3-note-preview:free,google/gemma-4-26b-a4b-it:free,recursive/flint-v1.0:free,nvidia/nemotron-3.5-super-vl:free')
  .split(',').map((m) => m.trim()).filter(Boolean)

let client
function getClient() {
  client ??= new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 30_000,
    maxRetries: 0, // 같은 모델을 다시 부르지 않고 다음 모델로 넘어간다
  })
  return client
}

export function keyLoaded() {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

// 하루 전체 AI 호출 상한 (모든 손님 합계). 무료 키는 하루 약 50회라 테스트할 몫을 남겨 둔다
export const dailyLimit = () => Number(process.env.AI_DAILY_LIMIT || 40)
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"

export async function usageToday() {
  const { rows } = await pool.query(`SELECT calls FROM ai_usage WHERE day = ${TODAY}`)
  return rows[0]?.calls ?? 0
}

// 한 번 부를 때마다 센다 (OpenRouter는 실패한 요청도 횟수에 넣는다). 상한에 닿았으면 false
// 상한 0(AI 끄기)이면 그날 첫 호출도 막는다
async function takeCall() {
  const { rows } = await pool.query(
    `INSERT INTO ai_usage (day, calls) SELECT ${TODAY}, 1 WHERE $1::int > 0
     ON CONFLICT (day) DO UPDATE SET calls = ai_usage.calls + 1 WHERE ai_usage.calls < $1
     RETURNING calls`,
    [dailyLimit()],
  )
  return rows.length > 0
}

// skip: 방금 답이 규칙에 걸린 모델은 다시 쓰지 않고 다음 모델로 (같은 실수를 되풀이하는 경우가 많다)
// maxTries: 이번에 시도할 모델 수. 질문 하나가 호출을 많이 쓰지 않게 부르는 쪽에서 정한다
// maxTokens: 답 길이 한도. 상담은 짧게(1200), 상품 상세 초안처럼 긴 글은 부르는 쪽에서 늘린다
// timeoutMs: 한 모델을 기다리는 시간 (긴 글은 늘린다), lightThinking: 생각하는 모델에게 짧게 생각하라고(토큰 아끼기)
export async function complete(messages, { skip = [], maxTries = MODELS.length, maxTokens = 1200, timeoutMs = 30_000, lightThinking = false } = {}) {
  let lastError
  const models = MODELS.filter((m) => !skip.some((s) => s.startsWith(m)))
  for (const model of (models.length ? models : MODELS).slice(0, maxTries)) {
    if (!(await takeCall())) {
      throw Object.assign(new Error(`오늘 AI 호출 상한(${dailyLimit()}회)에 닿았어요`), { code: 'DAILY_LIMIT' })
    }
    try {
      const completion = await getClient().chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens, // 일부 모델은 답 전에 생각하는 데 토큰을 써서 넉넉히 둔다
        temperature: 0.2,
        response_format: { type: 'json_object' },
        ...(lightThinking ? { reasoning: { effort: 'low' } } : {}), // OpenRouter: 지원 안 하는 모델은 무시
      }, { timeout: timeoutMs })
      const text = completion.choices?.[0]?.message?.content
      if (!text) throw Object.assign(new Error('빈 답'), { status: 502 })
      const usage = completion.usage ?? {}
      console.log(`[ai] model ${completion.model ?? model} · in ${usage.prompt_tokens ?? '?'} · out ${usage.completion_tokens ?? '?'}`)
      return { model: completion.model ?? model, text }
    } catch (error) {
      if (error.status === 401 || error.status === 402) throw error // 키·결제 문제는 다른 모델로도 안 된다
      console.log(`[ai] ${model} 실패 ${error.status ?? error.name} → 다음 모델`)
      lastError = error
    }
  }
  throw lastError
}

// OpenRouter 오류를 사람이 읽을 메시지로 바꾼다. 상태코드와 메시지만 로그에 남긴다.
export function describeAiError(error) {
  const status = error.status ?? 500
  console.error(`[ai] 실패 ${status} · ${error.message}`)
  if (status === 401) return { status: 503, message: 'AI 상담 설정에 문제가 있어요. 관리자에게 알려 주세요.' }
  if (status === 402 || status === 429) return { status: 503, message: '오늘 AI 상담 사용량이 많아요. 잠시 후 다시 시도하거나 상품 Q&A에 질문을 남겨 주세요.' }
  if (error.name === 'APIConnectionTimeoutError') return { status: 504, message: 'AI 응답이 늦어지고 있어요. 다시 시도해 주세요.' }
  return { status: 503, message: 'AI 상담을 잠시 쓸 수 없어요. 상품 Q&A에 질문을 남겨 주세요.' }
}
