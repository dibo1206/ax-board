// 블록형 상세페이지 규칙 시험 (2026-11-14): DB·AI 키 없이 돈다 → GitHub 자동 검사(CI)에서도 돌린다
//   npm run test-blocks
// 1) 블록 검사(server/blocks.js) 2) 상품 저장 검사(server/validate.js)와 금지어 3) AI 초안 정리(server/content.js parseDraft)
// 4) 자동 상세 카드에 들어갈 값 고르기(src/shop/detailFacts.js) 5) 쿠팡식 지그재그 묶기·[예시] 상품 데모 블록 설계(server/demoPlan.js)
// 6) 품목 장면 사진·POINT 설명으로 만드는 데모 블록 (data/demo_detail_photos.json, 2026-11-21)
import { blocksSummary, blocksText, readBlocks, removedBlockImages, sameBlocks } from '../server/blocks.js'
import { findBanned } from '../server/banned.js'
import { parseDraft } from '../server/content.js'
import { validateProduct } from '../server/validate.js'
import { brixGauge, headline, keyFacts, optionRows, pairBlocks, storageSteps } from '../src/shop/detailFacts.js'
import { COMPANY_CAPTION, DEMO_CAPTION, companySections, fillCopy, isDemoMade, planCompanyPairs, planDemoBlocks, sceneValues, withJosa } from '../server/demoPlan.js'
import { readFileSync, existsSync } from 'node:fs'

let failed = 0
let count = 0
function check(name, ok, detail = '') {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const CODE = 'p_test01'
const photo = (hex = 'a1b2c3d4e5f6') => `/uploads/${CODE}-${hex}.webp`

// ---------- 1. 블록 검사 ----------
const good = [
  { type: 'text', title: '이렇게 길렀어요', body: '해발 400m 비탈 과수원에서 길렀어요.' },
  { type: 'image', url: photo(), alt: '과수원 모습', caption: '' },
]
const ok = readBlocks(good, CODE)
check('글·사진 블록이 통과한다', ok.blocks?.length === 2, JSON.stringify(ok))
check('보내지 않으면 빈 목록', readBlocks(undefined, CODE).blocks?.length === 0)
check('배열이 아니면 거절', Boolean(readBlocks('x', CODE).errors))
check('바깥 주소 사진은 거절', Boolean(readBlocks([{ type: 'image', url: 'https://evil.example/a.webp' }], CODE).errors))
check('다른 상품의 사진은 거절', Boolean(readBlocks([{ type: 'image', url: '/uploads/p_other-a1b2c3d4e5f6.webp' }], CODE).errors))
check('이름이 겹치는 다른 상품(p_test01_x)의 사진도 거절', Boolean(readBlocks([{ type: 'image', url: `/uploads/${CODE}_x-a1b2c3d4e5f6.webp` }], CODE).errors))
check('경로를 거슬러 올라가는 주소는 거절', Boolean(readBlocks([{ type: 'image', url: `/uploads/${CODE}-a1b2c3d4e5f6.webp/../../.env` }], CODE).errors))
check('같은 사진 두 번은 거절', Boolean(readBlocks([good[1], good[1]], CODE).errors))
check('본문 없는 글 블록은 거절', Boolean(readBlocks([{ type: 'text', title: '제목만' }], CODE).errors))
check('본문 1000자 넘으면 거절', Boolean(readBlocks([{ type: 'text', body: '가'.repeat(1001) }], CODE).errors))
check('블록 21개는 거절', Boolean(readBlocks(Array.from({ length: 21 }, () => ({ type: 'text', body: '글' })), CODE).errors))
check('사진 13장은 거절', Boolean(readBlocks(Array.from({ length: 13 }, (_, i) => ({ type: 'image', url: photo(String(i).padStart(12, '0')) })), CODE).errors))
check('모르는 종류는 글 블록으로 바꿔 검사 (본문 없으면 거절)', Boolean(readBlocks([{ type: 'script', src: 'x' }], CODE).errors))
check('제어 문자는 지운다', readBlocks([{ type: 'text', body: `안녕\u0000하세요\u0007` }], CODE).blocks?.[0].body === '안녕하세요')
check('필요 없는 칸(onclick 등)은 저장하지 않는다', !('onclick' in (readBlocks([{ type: 'text', body: '글', onclick: 'alert(1)' }], CODE).blocks?.[0] ?? {})))

check('글 모으기: 사진 설명까지', blocksText(good).includes('비탈') && blocksText(good).includes('과수원 모습'))
check('키 순서가 달라도 같은 블록', sameBlocks([{ body: '가', title: '나', type: 'text' }], [{ type: 'text', title: '나', body: '가' }]))
check('글자 하나만 바뀌어도 다른 블록', !sameBlocks(good, [{ ...good[0], body: `${good[0].body}!` }, good[1]]))
check('수정 이력 요약은 글자만 바꿔도 달라진다', blocksSummary(good) !== blocksSummary([{ ...good[0], body: '다른 글' }, good[1]]))
check('빈 블록은 요약 없음', blocksSummary([]) === null)
check('빠진 사진만 지울 목록에 든다', JSON.stringify(removedBlockImages(good, [good[0]])) === JSON.stringify([photo()]))
check('그대로 둔 사진은 지우지 않는다', removedBlockImages(good, good).length === 0)

// ---------- 2. 상품 저장 검사 ----------
// 서버와 같은 금지어 검사(띄어 써도 잡는 banned.js)를 넘긴다. DB 없이 돌리면 기본 효능 표현 목록을 쓴다
const sets = { itemCodes: new Set(['apple']), sellerCodes: new Set(['farm_a']), tagCodes: new Set(), isNew: false, findBanned }
const base = { product_code: CODE, seller_code: 'farm_a', item_code: 'apple', name: '사과 5kg', price: '30000', unit: '5kg 1박스', stock: '10', notice: {} }
const saved = validateProduct({ ...base, detail_blocks: good }, sets)
check('상품 저장 검사가 블록을 받는다', saved.product?.detail_blocks?.length === 2, JSON.stringify(saved.errors))
check('블록을 안 보내도 저장된다', validateProduct(base, sets).product?.detail_blocks?.length === 0)
const banned = validateProduct({ ...base, detail_blocks: [{ type: 'text', body: '면역력에 좋아요' }] }, sets)
check('글 블록의 효능 표현은 막는다', banned.errors?.some((e) => e.includes('면역력')), JSON.stringify(banned))
const spaced = validateProduct({ ...base, detail_blocks: [{ type: 'image', url: photo(), alt: '다 이 어 트 사과' }] }, sets)
check('사진 설명의 띄어 쓴 효능 표현도 막는다 (금지어 사전 규칙)', Boolean(spaced.errors), JSON.stringify(spaced))
check('다른 상품 사진이 든 블록은 저장 거절', Boolean(validateProduct({ ...base, detail_blocks: [{ type: 'image', url: '/uploads/p_other-a1b2c3d4e5f6.webp' }] }, sets).errors))

// ---------- 3. AI 초안 정리 ----------
const input = { facts: [['상품 이름', '거창 사과'], ['가격', '30,000원'], ['판매 단위', '5kg 1박스']], needItem: false, item: {} }
const raw = JSON.stringify({
  summary: '아삭한 거창 사과예요',
  description: '거창 비탈밭에서 키운 사과예요. 5kg 1박스로 보내요.',
  blocks: [
    { type: 'text', title: '농가 이야기', body: '비탈밭에서 키웠어요. 아삭하고 향이 좋아요.' },
    { type: 'photo', hint: '과수원에 사과가 달린 모습' },
    { type: 'photo', hint: '연달아 온 사진 자리' },
    { type: 'text', title: '맛과 식감', body: '면역력에 좋아요. 단맛이 진해요.' },
    { type: 'text', title: '구성', body: '한 박스에 사과 20개가 들어 있어요. 하나씩 골라 담았어요.' },
    { type: 'photo', hint: '상자를 연 구성' },
    { type: 'photo', hint: '' },
  ],
  faq: [{ q: '보관은요?', a: '냉장 보관해 주세요.' }],
})
const flagged = []
const draft = parseDraft(raw, input, flagged)
const texts = draft.blocks.filter((b) => b.type === 'text')
const photos = draft.blocks.filter((b) => b.type === 'photo')
check('AI 초안에 글 블록이 생긴다', texts.length === 3, JSON.stringify(draft.blocks))
check('사진 자리는 연달아 두지 않는다 (2개만 남음)', photos.length === 2, JSON.stringify(photos))
check('빈 사진 자리는 버린다', photos.every((b) => b.hint))
check('효능 표현 문장은 빼고 나머지는 남긴다', texts[1].body === '단맛이 진해요.', texts[1].body)
check('입력에 없는 숫자(20개) 문장은 뺀다', texts[2]?.body === '하나씩 골라 담았어요.', texts[2]?.body)
check('뺀 문장을 알려 준다', flagged.length >= 2, JSON.stringify(flagged))
const dupe = parseDraft(JSON.stringify({ summary: '사과', description: '사과예요.', blocks: [
  { type: 'text', title: '보관 안내', body: '냉장 보관해 주세요.' },
  { type: 'text', title: '배송 안내', body: '바로 보내요.' },
  { type: 'text', title: '구성과 포장', body: '한 박스 30,000원이에요. 하나씩 감싸 담았어요.' },
], faq: [] }), input, [])
check('보관·배송 섹션은 블록으로 쓰지 않음 (아래 칸과 겹쳐서)', dupe.blocks.length === 1 && dupe.blocks[0].title === '구성과 포장', JSON.stringify(dupe.blocks))
check('블록 글의 가격 문장은 뺌 (입력에 있는 가격이어도)', dupe.blocks[0]?.body === '하나씩 감싸 담았어요.', dupe.blocks[0]?.body)
const onlyBad = parseDraft(JSON.stringify({ summary: '사과', description: '사과예요.', blocks: [{ type: 'text', title: '구성', body: '사과 20개예요.' }], faq: [] }), input, [])
check('문장이 모두 빠진 글 블록은 통째로 버린다', onlyBad.blocks.length === 0, JSON.stringify(onlyBad.blocks))
const old = parseDraft(JSON.stringify({ summary: '사과', description: '■ 농가 이야기\n비탈밭에서 키웠어요.\n\n■ 보관 안내\n냉장 보관해요.', faq: [] }), input, [])
check('blocks 를 빼먹은 모델이면 ■ 섹션을 글 블록으로 나눈다', old.blocks.length === 2 && old.blocks[0].title === '농가 이야기', JSON.stringify(old.blocks))

// ---------- 4. 자동 상세 카드 ----------
const apple = {
  name: '[예시] 사과 5kg·10kg', summary: '아삭한 부사 사과', unit: '1박스', variety: '후지', brix: '16.0', brix_measured_at: '2026-10-14',
  harvest_date: '2026-10-12', harvest_days: 33, brix_high: '12', brix_top: '14', brix_grade: '매우높은 당도', brix_rank: 3,
  notice: { origin: '국내산 (경북 안동)', composition: '사과 5kg 또는 10kg' },
  item: { category: '과일', show_brix: true, brix_min: 11, brix_max: 16 },
  seller: { name: '[예시] 햇살농원', region: '경상북도 안동시' },
  options: [{ id: 1, name: '5kg 1박스', price: 31000, stock: 5 }, { id: 2, name: '10kg 1박스', price: 58000, stock: 3 }],
}
const facts = keyFacts(apple)
const fact = (label) => facts.find((f) => f.label === label)
check('한눈에 보기: 원산지·품종·당도·수확일·구성·보내는 곳', ['원산지', '품종', '당도', '수확일', '구성', '보내는 곳'].every(fact), JSON.stringify(facts))
check('당도는 측정일과 함께', fact('당도')?.value === '16Brix' && fact('당도')?.note === '10월 14일 판매 농가 측정', JSON.stringify(fact('당도')))
check("'표시와 달랐어요'로 당도를 내린 상품은 당도 칸 없음", !keyFacts({ ...apple, info_disputed: true }).some((f) => f.label === '당도'))
check('당도를 보여 주지 않는 품목은 당도 칸 없음', !keyFacts({ ...apple, item: { ...apple.item, show_brix: false } }).some((f) => f.label === '당도'))
check("품종 '공통'은 칸 없음", !keyFacts({ ...apple, variety: '공통' }).some((f) => f.label === '품종'))
check('가공품은 수확일 칸 없음', !keyFacts({ ...apple, item: { ...apple.item, category: '가공품' } }).some((f) => f.label === '수확일'))
check('빈 값은 칸을 만들지 않음 (원산지 없음)', !keyFacts({ ...apple, notice: {} }).some((f) => f.label === '원산지'))
check('머리글: [예시] 뗀 농가 이름 · 지역, 소개 글', headline(apple).kicker === '햇살농원 · 경상북도 안동시' && headline(apple).title === '아삭한 부사 사과', JSON.stringify(headline(apple)))
check('소개가 없으면 상품 이름으로', headline({ ...apple, summary: '' }).title === '사과 5kg·10kg')
const g = brixGauge(apple)
check('당도 눈금 안에 값과 기준선', g && g.at > 0 && g.at < 100 && g.standards.length === 2 && g.standards.every((x) => x.at > 0 && x.at < 100), JSON.stringify(g))
check('당도를 내린 상품은 눈금 없음', brixGauge({ ...apple, info_disputed: true }) === null)
const opts = optionRows({ ...apple, options: [{ id: 1, name: '5kg 1상자', price: 45000, stock: 1 }, { id: 2, name: '7.5kg 1상자', price: 63000, stock: 1 }, { id: 3, name: '15kg 1상자', price: 115000, stock: 1 }] })
check('구성 비교: 100g당 가격이 가장 낮은 옵션 표시 (15kg)', opts?.find((r) => r.best)?.name === '15kg 1상자', JSON.stringify(opts))
check("100g당 가격의 '100' 을 값으로 읽지 않음 (5kg 900원)", opts?.[0].per100 === '100g당 900원', opts?.[0].per100)
check('옵션이 하나면 구성 비교 없음', optionRows({ ...apple, options: [apple.options[0]] }) === null)
const soldOut = optionRows({ ...apple, options: [{ id: 1, name: '5kg', price: 30000, stock: 0 }, { id: 2, name: '10kg', price: 50000, stock: 2 }] })
check('품절 옵션은 품절로, 가장 낮은 가격 표시에서 빠짐', soldOut?.[0].soldOut && !soldOut.some((r) => r.best), JSON.stringify(soldOut))
check('보관법을 번호 단계로 나눔', storageSteps('약 0℃로 냉장 보관. 비닐봉지에 넣기. 다른 과일과 따로 보관')?.length === 3)
check('한 문장 보관법은 나누지 않음', storageSteps('서늘한 곳에 보관해 주세요.') === null)

// ---------- 5. 쿠팡식 지그재그·[예시] 데모 블록 ----------
const T = (title = '제목') => ({ type: 'text', title, body: '본문' })
const I = (hex) => ({ type: 'image', url: photo(hex), alt: '', caption: '' })
const zig = pairBlocks([I('a00000000001'), T('1'), I('a00000000002'), T('2')])
check('사진·글이 붙어 있으면 한 줄로 묶고 둘째 줄은 사진 쪽을 바꿈', zig.length === 2 && !zig[0].flip && zig[1].flip && zig[1].text.title === '2', JSON.stringify(zig))
const textFirst = pairBlocks([T('글 먼저'), I('a00000000003')])
check('글 → 사진 순서여도 한 줄 (사진은 image 칸)', textFirst.length === 1 && textFirst[0].image?.url === photo('a00000000003'))
const lone = pairBlocks([I('a00000000004'), I('a00000000005'), T('끝')])
check('사진 두 장이 이어지면 앞 사진은 혼자 한 칸', lone.length === 2 && lone[0].single?.type === 'image' && lone[1].text?.title === '끝', JSON.stringify(lone))
check('글만 있으면 혼자 한 칸', pairBlocks([T()]).every((r) => r.single))

const demoProduct = {
  product_code: CODE, name: '[예시] 거창 부사 가정용 5kg', summary: '고랭지에서 일교차를 맞고 자란 거창 부사', variety: '후지', unit: '사과 5kg 1박스',
  harvest_date: '2026-10-28', brix: '15.3', brix_measured_at: '2026-10-28', price: 32000, image_url: '/product-photos/apple_home_3kg.webp', notice: { origin: '국내산 (경상남도 거창군)' },
}
const demoItem = { status: 'active', category: '과일', recipes: [
  { title: '사과 샐러드', ingredients: '사과·채소', method: '썰어서 채소와 함께 곁들이기', image: '/recipe-photos/apple-1.webp' },
  { title: '사과 조림', ingredients: '사과·설탕', method: '졸이기', image: '/recipe-photos/apple-2.webp' },
  { title: '사과 주스', ingredients: '사과', method: '갈기', image: '/recipe-photos/apple-3.webp' },
] }
const demoSeller = { name: '[예시] 거창 사과재', region: '경상남도 거창군 고제면', story: '해발 600m 고랭지 과수원이에요. 3대째 사과를 길러요. 세 번째 문장은 빼요.' }
const plan = planDemoBlocks(demoProduct, demoItem, demoSeller)
check('예시 블록: 대표 사진 + 레시피 2개 = 사진·글 3쌍', plan.pairs.length === 3 && plan.pairs[0].photo === demoProduct.image_url && plan.pairs[1].photo === '/recipe-photos/apple-1.webp', JSON.stringify(plan.pairs.map((x) => x.photo)))
const allText = plan.pairs.map((x) => `${x.title} ${x.body}`).join(' ') 
check('예시 블록 글에 [예시]·가격이 없음', !allText.includes('[예시]') && !/\d[\d,]*\s*원/.test(allText), allText)
check("받침에 맞춘 '이에요/예요' (5kg이에요 · 후지예요 · 1박스예요)", allText.includes('거창 부사 가정용 5kg이에요') && allText.includes('품종은 후지예요') && allText.includes('사과 5kg 1박스예요'), allText)
check('저장된 사실만: 수확일·당도 측정일', allText.includes('10월 28일에 수확했어요') && allText.includes('10월 28일에 잰 당도는 15.3Brix예요'), allText)
check('농가 이야기는 블록으로 쓰지 않음 (아래 칸에 이미 나옴), 농가 이름의 [예시] 는 뗌', !('tail' in plan) && allText.includes('거창 사과재에서 보내는') && !allText.includes('[예시]'), allText)
check('검수 전 품목은 레시피를 쓰지 않음 (손님 화면에서 숨김)', planDemoBlocks(demoProduct, { ...demoItem, status: 'pending' }, demoSeller).pairs.length === 1)
check('가공품은 수확일 문장 없음', !planDemoBlocks(demoProduct, { ...demoItem, category: '가공품' }, demoSeller).pairs[0].body.includes('수확했어요'))
check('대표 사진이 없으면 소개 쌍 없음', planDemoBlocks({ ...demoProduct, image_url: null }, demoItem, demoSeller).pairs.every((x) => x.photo.startsWith('/recipe-photos/')))
// 사진을 복사한 뒤 모양: 사진 → 글 순서, [예시] 참고 사진 표시 → 블록 검사 통과 + 지그재그 3줄
const built = plan.pairs.flatMap((x, i) => [{ type: 'image', url: photo(`b0000000000${i}`), alt: x.alt, caption: DEMO_CAPTION }, { type: 'text', title: x.title, body: x.body }])
const builtCheck = readBlocks(built, CODE)
check('예시 블록이 블록 검사·금지어를 통과', builtCheck.blocks?.length === 6 && findBanned(blocksText(built)).length === 0, JSON.stringify(builtCheck.errors))
check('예시 블록은 지그재그 3줄 (가운데 줄만 사진이 오른쪽)', (() => { const r = pairBlocks(builtCheck.blocks); return r.length === 3 && !r[0].flip && r[1].flip && !r[2].flip })())

// ---------- 6. 품목 장면 사진 + POINT 설명 ----------
const SCENES = JSON.parse(readFileSync(new URL('../data/demo_detail_photos.json', import.meta.url), 'utf8'))
const sceneOf = (code) => SCENES.items.find((it) => it.item_code === code)
check('조사: 받침 있으면 이에요, 없으면 예요 (괄호 뒤라도 마지막 한글로)', withJosa('국내산 (경북 안동)', '이에요') === '국내산 (경북 안동)이에요' && withJosa('국내산 (충청남도 논산시)', '이에요') === '국내산 (충청남도 논산시)예요')
check('조사: ㄹ 받침 뒤는 으로가 아니라 로', withJosa('서울', '으로') === '서울로' && withJosa('귤밭', '으로') === '귤밭으로' && withJosa('상자', '으로') === '상자로')
check('빈칸 채우기: 값이 없는 문장만 뺀다', fillCopy('{품종} 품종이에요. 당도는 {당도}예요. 맛있어요.', { 품종: '설향', 당도: null }) === '설향 품종이에요. 맛있어요.')
const kings = { name: '[예시] 킹스베리 2kg', variety: '킹스베리', brix: '9.8', brix_measured_at: '2026-11-04', harvest_date: '2026-11-03', unit: '1kg 2상자', notice: { origin: '국내산 (충청남도 논산시)', composition: '딸기 1kg 2상자 (옵션에서 고름)' } }
const farm = { name: '[예시] 논산 새벽딸기', region: '충청남도 논산시 광석면' }
const v = sceneValues(kings, { status: 'active', category: '과일', show_brix: true }, farm)
check('상품 값: 당도·측정일·수확일·농가([예시] 뗌)·구성(옵션 안내 뗌)', v.당도 === '9.8Brix' && v.당도측정일 === '11월 4일' && v.수확일 === '11월 3일' && v.농가 === '논산 새벽딸기' && v.구성 === '딸기 1kg 2상자', JSON.stringify(v))
check('검수 전 품목은 당도를 쓰지 않는다 (상품 화면과 같은 규칙)', sceneValues(kings, { status: 'pending', category: '과일' }, farm).당도 === null)
check("'표시와 달랐어요'로 내린 상품은 당도를 쓰지 않는다", sceneValues({ ...kings, info_disputed: true }, { status: 'active', category: '과일' }, farm).당도 === null)
check('가공품은 수확일을 쓰지 않는다', sceneValues(kings, { status: 'active', category: '가공품' }, farm).수확일 === null)
const scenePlan = planDemoBlocks(kings, { status: 'active', category: '과일', show_brix: true }, farm, sceneOf('strawberry'))
check('장면이 있으면 POINT 4쌍 (사진은 품목 장면 사진)', scenePlan.pairs.length === 4 && scenePlan.pairs.every((p, i) => p.title.startsWith(`POINT ${i + 1} · `) && p.photo === `/product-photos/detail/strawberry-${i + 1}.webp`), JSON.stringify(scenePlan.pairs.map((p) => p.title)))
check('설명에 상품 값이 들어간다 (품종·당도·농가)', scenePlan.pairs[0].body.includes('킹스베리 품종') && scenePlan.pairs[0].body.includes('9.8Brix') && scenePlan.pairs[1].body.includes('논산 새벽딸기에서'), scenePlan.pairs[0].body)
check('채우지 못한 빈칸이 글에 남지 않는다', scenePlan.pairs.every((p) => !/[{}]/.test(p.body)))
check('장면이 없는 품목은 예전 방식 (대표 사진·레시피)', planDemoBlocks({ ...kings, image_url: '/product-photos/x.webp', summary: '소개' }, { status: 'active', category: '과일' }, farm, null).pairs[0]?.photo === '/product-photos/x.webp')
const missing = SCENES.items.flatMap((it) => it.shots.map((_, i) => `public/product-photos/detail/${it.item_code}-${i + 1}.webp`)).filter((f) => !existsSync(new URL(`../${f}`, import.meta.url)))
check('장면 사진 파일: 회사 직영만인 배즙·매실청 말고는 모두 있다', missing.every((f) => /\/(pear_juice|plum_syrup)-/.test(f)), missing.join(', '))
const allCopy = SCENES.items.flatMap((it) => it.shots.filter((s) => s[4]).map((s) => `${s[3]} ${s[4]}`)).join(' ')
check('장면 설명 글에 금지어(효능 표현)가 없다', findBanned(allCopy).length === 0, findBanned(allCopy).join(', '))
check('예시 블록 알아보기: 사진이 모두 [예시] 참고 사진이면 이 기능이 채운 것', isDemoMade([{ type: 'image', url: 'a', caption: DEMO_CAPTION }, { type: 'text', body: '글' }]) && !isDemoMade([{ type: 'image', url: 'a', caption: '농가 사진' }]) && !isDemoMade([{ type: 'text', body: '글만' }]) && !isDemoMade([]))

// 회사 직영 상품 (2026-11-21): 회사 홈페이지 설명만 쓰고, 주문·배송·표시 정보는 빼고, 회사 사진 먼저
const companyDesc = '■ 제품 소개\n사과 소개 글이에요. (회사 소개 글)\n\n■ 주문·배송 (회사 안내)\n평일 오후 2시까지 결제하면 그날 보내요.\n\n※ 가격·재고는 [예시]예요.'
const secs = companySections(companyDesc)
check('회사 설명: 주문·배송은 빼고 제품 소개만, (회사 소개 글) 표시와 ※ 줄은 뗀다', secs.length === 1 && secs[0].title === '제품 소개' && secs[0].body === '사과 소개 글이에요.', JSON.stringify(secs))
const companyScenes = new Map([['apple', { item_code: 'apple', kind: 'fresh', shots: [[0, 0, '가까이'], [0, 0, '사과밭'], [0, 0, '상자'], [0, 0, '손']] }]])
const cp = planCompanyPairs({ product_code: 'yj_apple_set', item_code: 'apple', name: '명품 사과세트', description: companyDesc }, companyScenes, ['3kg', '5kg'])
check('회사 상품: POINT 1 은 회사 사진, 설명이 하나면 저장된 구성으로 POINT 2', cp.length === 2 && cp[0].title === 'POINT 1 · 제품 소개' && cp[0].photo === '/product-photos/yj_apple_set-1.webp' && cp[0].caption === COMPANY_CAPTION && cp[1].title === 'POINT 2 · 구성' && cp[1].body === '고를 수 있는 구성은 3kg, 5kg이에요.', JSON.stringify(cp))
check('회사 상품: 모자란 사진은 장면 사진([예시] 참고 사진), 자라는 곳(2번)은 쓰지 않음', cp[1].photo === '/product-photos/detail/apple-1.webp' && cp[1].caption === DEMO_CAPTION && !cp.some((x) => x.photo?.endsWith('apple-2.webp')))
check('회사 상품: 글에 주문·배송 약속이 없음', !cp.some((x) => /그날 보내|오후 2시/.test(x.body)))
check('회사 사진 블록도 이 기능이 채운 것으로 알아본다 (새로 만들기 대상)', isDemoMade([{ type: 'image', url: 'a', caption: COMPANY_CAPTION }, { type: 'image', url: 'b', caption: DEMO_CAPTION }]))

console.log(`\n${count - failed}/${count} 통과`)
process.exit(failed ? 1 : 0)
