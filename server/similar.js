// 비슷한 질문 찾기 (AI·토큰 없이 우리 서버에서 계산)
// 1) 말끝(되나요·가능해요·있어요…)과 조사(은·는·을·를·로…), 군말(혹시·좀·이거…)을 떼고 내용 낱말만 남긴다
//    "선물 포장 가능해요?" → "선물포장", "선물 포장 되나요?" → "선물포장"
// 2) 남은 글자를 두 개씩 묶어 두 질문이 얼마나 겹치는지 0~1로 잰다
// 한 글자 조사(이·가·과·와·도)는 '사과'→'사'처럼 낱말을 망가뜨려서 떼지 않는다
const ENDINGS = [
  '가능한가요', '가능할까요', '가능해요', '가능한지', '되나요', '될까요', '됩니까', '돼요', '되요', '인가요', '일까요', '있나요', '있어요', '있을까요',
  '없나요', '없어요', '할까요', '하나요', '해요', '나요', '어요', '아요', '이에요', '예요', '에요', '까요', '죠', '요',
  '에서', '에도', '에는', '으로', '이랑', '하고', '째로', '째', '랑', '은', '는', '을', '를', '로', '에', '만',
]
const FILLER = new Set(['가능', '되', '돼', '있', '없', '하', '해', '할', '수', '좀', '혹시', '이거', '그거', '저거', '알려', '주세요', '어떻게', '뭐', '무엇', '궁금'])

function core(text) {
  const words = String(text).toLowerCase().replace(/[^가-힣a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const kept = words.map((w) => {
    if (ENDINGS.includes(w)) return ''
    let word = w
    for (let n = 0; n < 2; n += 1) {
      const ending = ENDINGS.find((e) => word.length > e.length && word.endsWith(e))
      if (ending) word = word.slice(0, -ending.length)
    }
    return FILLER.has(word) ? '' : word
  }).join('')
  return kept || words.join('')
}

function grams(text) {
  const s = core(text)
  const set = new Set()
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2))
  return set
}

export function similarity(a, b) {
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  let same = 0
  for (const g of A) if (B.has(g)) same += 1
  return (2 * same) / (A.size + B.size)
}

// 질문의 내용 낱말이 글에 얼마나 나오는지 0~1 (글이 길어도 점수가 깎이지 않는다)
export function coverage(question, text) {
  const A = grams(question)
  if (!A.size) return 0
  const body = String(text).toLowerCase().replace(/\s+/g, '')
  let same = 0
  for (const g of A) if (body.includes(g)) same += 1
  return same / A.size
}

// 후보 중 가장 비슷한 것 (기준 미만이면 null)
export function mostSimilar(question, candidates, min = 0.6) {
  let best = null
  for (const c of candidates) {
    const score = similarity(question, c.question)
    if (score >= min && (!best || score > best.score)) best = { ...c, score }
  }
  return best
}
