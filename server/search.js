// 상품 검색어 → SQL 조건 (/api/catalog 를 첫 화면 목록과 헤더 검색이 함께 쓴다)
// 1) 띄어쓰기를 무시한다: '거창부사'도 '거창 부사'도 [예시] 거창 부사 가정용 5kg 을 찾는다
// 2) 손님이 흔히 쓰는 다른 말도 같은 뜻으로 본다: 쥬스 → 즙, 샤인머스켓 → 샤인머스캣, 귤 → 감귤, 키위 ↔ 참다래 …
// 3) '농축액·원액·베이스' 같은 말은 손님 화면 카테고리(과일 농축액)로 찾는다. 이름에 '농축액'이 없어도 유자청·매실청이 나온다
// 손님이 보낸 글자는 SQL 값($n)으로만 넘기고, SQL 글에는 정해 둔 조건만 넣는다
import { groupWhere } from './shopGroups.js'

// 다른 말 → 가게에서 쓰는 말. 검색어 단어에 왼쪽이 들어 있으면 바꾼 말로도 함께 찾는다
const SAME = [
  [/샤인머스[켓캣]|샤인|머스[켓캣]/g, '샤인머스캣'],
  [/쥬스|주스/g, '즙'],
  [/고추가루|고추까루|고춧까루/g, '고춧가루'],
  [/밀감/g, '감귤'],
  [/^귤|(?<=[^감])귤/g, '감귤'],
  [/메실/g, '매실'],
  [/키위/g, '참다래'],
  [/참다래/g, '키위'],
  [/쨈/g, '잼'],
  [/절인배추/g, '절임배추'],
  [/말린감|건시/g, '곶감'],
  [/유자차/g, '유자청'],
  [/매실액|매실원액/g, '매실청'],
  [/선물세트|선물용|선물상자/g, '선물'],
  [/대용량|식당용|카페용|업소/g, '업소용'],
  [/흠과|파지|b급|비품/g, '못난이'],
  [/못난이/g, '흠과'],
  [/못난이/g, '파지'],
  [/키로|킬로/g, 'kg'],
  [/그람|그램/g, 'g'],
]
// 카테고리로 찾을 말 (단어 전체가 이 말일 때). 두 글자 이하면 카테고리로만 찾는다 ('청'이 청송을 찾지 않게)
const GROUP_WORDS = [
  [/^(농축액?|원액|음료베이스|베이스|시럽|과일청|청)$/, 'base'],
  [/^(가공품|가공식품|가공)$/, 'processed'],
  [/^(채소|야채)$/, 'veg'],
  [/^(과일|생과일|과일세트)$/, 'fresh'],
]
// 찾는 데 도움이 안 되는 말은 뺀다 (모두 빠지면 원래 단어로 찾는다)
const FILLER = /^(추천|추천해줘|추천해주세요|주세요|있어요|있나요|파는|사고|살래|싶어요|싼|저렴한|맛있는|좋은|상품|제품|것|거|좀|요)$/
// 단어 끝 조사는 뺀 말로도 찾는다 ('말랭이·못난이'처럼 '이'로 끝나는 이름이 있어 이·가는 빼지 않는다)
const JOSA = /(을|를|은|는|도|요|으로|로|랑|하고|이랑)$/

// 한 단어 길이와 찾을 말 개수에 상한을 둔다: 다른 말 규칙은 맞을 때마다 찾을 말을 2배로 늘려서,
// 긴 단어 하나에 규칙어를 여러 개 이어 붙이면 수십만 개로 불어나 서버가 멈춘다 (2026-11-07 보안 점검)
const MAX_WORD = 20
const MAX_ALTS = 32

export function searchWords(q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').slice(0, MAX_WORD)).filter(Boolean).slice(0, 5)
  const useful = words.filter((w) => !FILLER.test(w))
  return useful.length ? useful : words
}

// 단어 하나 → 찾을 말 목록과 카테고리
export function expandWord(word) {
  const alts = new Set([word])
  if (word.length >= 3 && JOSA.test(word)) alts.add(word.replace(JOSA, ''))
  for (const [pattern, to] of SAME) {
    for (const w of [...alts]) {
      if (alts.size >= MAX_ALTS) break
      if (w.search(pattern) >= 0) alts.add(w.replace(pattern, to))
    }
  }
  const groups = GROUP_WORDS.filter(([pattern]) => [...alts].some((w) => pattern.test(w))).map(([, key]) => key)
  return { alts: [...alts].filter(Boolean), groups }
}

// 상품 이름·품목·소개·품종·농가·태그를 띄어쓰기 없이 이어 붙인 글
const HAY = `regexp_replace(lower(concat_ws('|', p.name, i.name, p.summary, p.variety, s.name,
  (SELECT string_agg(t.label, '|') FROM tags t WHERE t.tag_code = ANY(p.tags)))), '\\s', '', 'g')`
const like = (w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// mode 'all': 단어가 모두 맞아야 / 'any': 하나라도 맞으면 (모두 맞는 상품이 없을 때 비슷한 상품 보여 주기)
export function searchWhere(words, params, mode = 'all') {
  if (!words.length) return ''
  const parts = words.map((word) => {
    const { alts, groups } = expandWord(word)
    const conds = groups.map((g) => groupWhere(g)).filter(Boolean)
    if (!(conds.length && word.length <= 2)) {
      params.push(alts.map(like))
      conds.push(`${HAY} LIKE ANY($${params.length}::text[])`)
    }
    return `(${conds.join(' OR ')})`
  })
  return ` AND (${parts.join(mode === 'any' ? ' OR ' : ' AND ')})`
}
