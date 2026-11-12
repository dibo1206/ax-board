// 레시피 카드 사진 만들기 (2026-11-08): Cloudflare Workers AI 의 FLUX.1 [schnell] 로 음식 사진을 만들어 uploads/ 에 WebP 로 둔다.
// .env 에 CLOUDFLARE_ACCOUNT_ID · CLOUDFLARE_AI_TOKEN 이 없으면 만들지 않고, 화면은 [사진 올리기]와 요리 종류별 기본 그림으로 동작한다.
// 비용: 무료 사용량(하루 1만 뉴런) 안에서 쓰도록 하루 장 수 상한(IMAGE_DAILY_LIMIT, 기본 30)을 둔다 [가설: 장당 뉴런 수는 Cloudflare 대시보드에서 확인]
// 사진 설명은 영어가 잘 맞아서, 레시피 초안을 만들 때 AI 가 영어 설명(photo)을 함께 쓴다. 없으면 글 AI 로 한 번 옮기고, 그것도 안 되면 틀 문장을 쓴다
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { complete, keyLoaded } from './ai.js'
import { UPLOAD_DIR } from './uploads.js'

const MODEL = '@cf/black-forest-labs/flux-1-schnell'
const dailyLimit = () => Math.max(0, Number(process.env.IMAGE_DAILY_LIMIT || 30))
let used = { day: '', count: 0 }

export const imageKeyLoaded = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN)

// 오늘(한국 날짜) 몇 장 만들었는지. 서버를 다시 켜면 0부터 센다 (메모리)
function takeOne() {
  const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  if (used.day !== day) used = { day, count: 0 }
  if (used.count >= dailyLimit()) return false
  used.count += 1
  return true
}
export const imagesLeftToday = () => {
  const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  return Math.max(0, dailyLimit() - (used.day === day ? used.count : 0))
}

const STYLE = 'Food photography for a Korean farm shop recipe card, appetizing, natural window light, shallow depth of field, photorealistic, vertical composition. No text, no letters, no labels, no logos, no watermark, no hands, no people.'
const clean = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[<>{}[\]`]/g, '').trim().slice(0, max)

// 레시피 → 사진 설명(영어). photo 가 있으면 그대로, 없으면 글 AI 로 짧게 옮긴다
async function describe(recipe, itemName) {
  const given = clean(recipe.photo, 400)
  if (/^[\x20-\x7E]{20,}$/.test(given)) return given
  const korean = `${clean(itemName, 20)} 레시피 "${clean(recipe.title, 30)}" (재료: ${clean(recipe.ingredients, 60)} / 방법: ${clean(recipe.method, 120)})`
  if (keyLoaded()) {
    try {
      const r = await complete([
        { role: 'system', content: 'Translate the Korean recipe into ONE short English sentence describing what the finished dish looks like on a table (dish, colors, bowl or plate, garnish). Output only the sentence.' },
        { role: 'user', content: korean },
      ], { maxTokens: 120, timeoutMs: 20_000, maxTries: 2 })
      const sentence = clean(r.text, 400)
      if (/^[\x20-\x7E]{20,}$/.test(sentence)) return sentence
    } catch {
      // 글 AI 가 붐비거나 하루 한도면 아래 틀 문장으로
    }
  }
  return `A homemade Korean dish called "${clean(recipe.title, 30)}" made with ${clean(itemName, 20)}, served in a ceramic bowl on a wooden table`
}

// 사진 한 장 만들기 → '/uploads/recipe-xxxxxxxxxxxx.webp'. 실패하면 Error(code: NO_KEY | DAILY_LIMIT | FAILED)
export async function generateRecipePhoto(recipe, itemName) {
  if (!imageKeyLoaded()) throw Object.assign(new Error('사진 만들기 키가 없어요.'), { code: 'NO_KEY' })
  if (!takeOne()) throw Object.assign(new Error(`오늘 사진 만들기 한도(${dailyLimit()}장)를 다 썼어요. 내일 다시 해 주세요.`), { code: 'DAILY_LIMIT' })
  const prompt = `${STYLE} ${await describe(recipe, itemName)}`.slice(0, 2000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let json
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 6 }),
      signal: controller.signal,
    })
    json = await res.json().catch(() => null)
    if (!res.ok || !json) {
      // 토큰 값은 남기지 않는다. 상태 코드와 Cloudflare 오류 코드만
      console.warn(`[imagegen] 실패 ${res.status} ${JSON.stringify(json?.errors ?? []).slice(0, 200)}`)
      throw Object.assign(new Error('사진을 만들지 못했어요. 잠시 뒤 다시 해 주세요.'), { code: 'FAILED' })
    }
  } catch (error) {
    if (error.code) throw error
    console.warn(`[imagegen] 요청 실패 ${error.name}`)
    throw Object.assign(new Error('사진을 만들지 못했어요. 잠시 뒤 다시 해 주세요.'), { code: 'FAILED' })
  } finally {
    clearTimeout(timer)
  }
  const base64 = json.result?.image ?? json.image
  if (typeof base64 !== 'string' || !base64) throw Object.assign(new Error('사진을 만들지 못했어요.'), { code: 'FAILED' })
  return saveRecipePhoto(Buffer.from(base64, 'base64'))
}

// 만든 사진·올린 사진 모두 같은 크기(720×900, 4:5)의 WebP 로 저장한다 (사진 속 위치 정보 등은 지워진다)
export async function saveRecipePhoto(buffer) {
  const webp = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize(720, 900, { fit: 'cover' }).webp({ quality: 78 }).toBuffer()
  const name = `recipe-${randomBytes(6).toString('hex')}.webp`
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(new URL(name, UPLOAD_DIR), webp)
  return `/uploads/${name}`
}
