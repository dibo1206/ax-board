// OpenRouter 호출. 키는 .env 의 OPENROUTER_API_KEY 에서만 읽고, 코드·로그·응답에 키 값을 쓰지 않는다.
import OpenAI from 'openai'

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

// skip: 방금 답이 규칙에 걸린 모델은 다시 쓰지 않고 다음 모델로 (같은 실수를 되풀이하는 경우가 많다)
export async function complete(messages, { skip = [] } = {}) {
  let lastError
  const models = MODELS.filter((m) => !skip.some((s) => s.startsWith(m)))
  for (const model of models.length ? models : MODELS) {
    try {
      const completion = await getClient().chat.completions.create({
        model,
        messages,
        max_tokens: 1200, // 일부 모델은 답 전에 생각하는 데 토큰을 써서 넉넉히 둔다
        temperature: 0.2,
        response_format: { type: 'json_object' },
      })
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
