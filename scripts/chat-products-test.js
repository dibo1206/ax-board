// 상품을 콕 집은 질문의 규칙 답 시험 (DB·AI 없이): npm run test-chat-products
//   새 질문 100개(2026-11-26)에서 [AI에게 물어보기]로 가던 질문들: 상품 이름으로 찾기, 상품 칸 그대로 답하기,
//   상품 설명 글에서 문장 찾기, 값만 말한 질문. 지어내지 않고 비었으면 '없다'고 하는지도 본다
import { answerBudget, answerCompareProducts, answerFromProductText, answerProductInfo, findNamedProducts } from '../server/chatProducts.js'

let count = 0
let failed = 0
const check = (name, ok, detail = '') => {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

const product = (over) => ({ sold_out: false, options: [], notice: {}, summary: '', description: null, detail_blocks: [], seller_region: '', brix: null, unit: '1박스', price: 10000, ...over })
const catalog = {
  items: [
    { item_code: 'base', name: '과일 농축액 베이스', category: '가공품' },
    { item_code: 'grape', name: '포도', category: '과일' },
    { item_code: 'onion', name: '대파', category: '채소' },
    { item_code: 'chili', name: '고춧가루', category: '가공품' },
    { item_code: 'mandarin', name: '감귤', category: '과일' },
  ],
  products: [
    product({ product_code: 'lemon', item_code: 'base', name: '[윤주톡톡] 레몬베이스 1.9kg', price: 18000, notice: { expiry: '제조일로부터 18개월', ingredients: '백설탕, 레몬농축액, 식용색소황색제4호' } }),
    product({ product_code: 'strawberry', item_code: 'base', name: '딸기 베이스 1.9kg', price: 18000, notice: { expiry: '[예시] 회사 확인 필요', ingredients: '[예시] 회사 확인 필요' } }),
    product({ product_code: 'shine', item_code: 'grape', name: '[예시] 샤인머스캣 2kg (2~3송이)', price: 22900, seller_region: '충청북도 영동군 양강면', summary: '알이 굵은 샤인머스캣', options: [{ name: '2kg 1박스', price: 22900, stock: 3 }, { name: '4kg 1박스', price: 43900, stock: 0 }] }),
    product({ product_code: 'leek', item_code: 'onion', name: '[예시] 해남 흙대파 1kg', price: 2900, seller_region: '전라남도 해남군 산이면', summary: '흙째 보내는 겨울 대파. 세워 두면 오래가요' }),
    product({ product_code: 'chili_hot', item_code: 'chili', name: '[예시] 의성 햇고춧가루 1kg (매운맛)', price: 31900, summary: '매운 고추를 섞어 빻은 햇고춧가루' }),
    product({ product_code: 'chili_mild', item_code: 'chili', name: '[예시] 의성 햇고춧가루 1kg (보통맛)', price: 31200, summary: '김장용 굵은 햇고춧가루' }),
    product({ product_code: 'royal', item_code: 'mandarin', name: '[예시] 로얄과 감귤 선물세트 3kg', price: 13000, summary: '크기와 색이 고른 귤만 한 알씩 담은 선물용 감귤', notice: { composition: '감귤 3kg 1상자' } }),
    product({ product_code: 'mandarin_s', item_code: 'mandarin', name: '[예시] 노지감귤 맛보기 2.5kg', price: 9900 }),
  ],
}
const named = (message) => findNamedProducts(message, catalog).map((p) => p.product_code)
const ctxFor = (message, items = []) => ({ items: items.map((code) => catalog.items.find((i) => i.item_code === code)), named: findNamedProducts(message, catalog), current: null })

// 1. 상품 이름으로 찾기
check('품목 이름 없이 상품 이름으로 찾는다 (레몬베이스)', named('레몬베이스 유통기한').join() === 'lemon', named('레몬베이스 유통기한').join())
check('긴 이름이 더 콕 집은 것 (딸기 베이스는 레몬베이스가 아님)', named('딸기 베이스에 색소 들어가요?').join() === 'strawberry', named('딸기 베이스에 색소 들어가요?').join())
check('맞춤법이 조금 달라도 찾는다 (샤인머스켓)', named('샤인머스켓 한송이 몇알').join() === 'shine')
check('지역 이름만으로는 상품으로 보지 않는다 (제주도 배송)', named('제주도도 배송되나요').length === 0)
check('흔한 말(과일·선물)만으로는 상품으로 보지 않는다', named('만원 이하 과일 있나요').length === 0 && named('선물 추천해 주세요').length === 0)

// 2. 상품 칸 그대로
const expiry = answerProductInfo('레몬베이스 유통기한 몇개월이에요', catalog, ctxFor('레몬베이스 유통기한 몇개월이에요'))
check('소비기한은 notice 값 그대로', expiry?.answer.includes('제조일로부터 18개월'), expiry?.answer)
const color = answerProductInfo('레몬베이스에 색소 들어가요?', catalog, ctxFor('레몬베이스에 색소 들어가요?'))
check('원재료에 손님이 물은 글자가 있으면 그대로 알려 준다', color?.answer.includes("'색소'가 적혀") && color.answer.includes('식용색소황색제4호'), color?.answer)
const empty = answerProductInfo('딸기 베이스에 색소 들어가요?', catalog, ctxFor('딸기 베이스에 색소 들어가요?'))
check("'[예시] 회사 확인 필요'는 정보가 없다고 말한다", empty?.answer.includes('정보는 아직 없어요') && !empty.answer.includes('회사 확인'), empty?.answer)
const what = answerProductInfo('로얄과 감귤이 뭐에요', catalog, ctxFor('로얄과 감귤이 뭐에요', ['mandarin']))
check('"이게 뭐예요?"는 상품 소개 글과 구성·가격으로', what?.answer.includes('크기와 색이 고른') && what.answer.includes('13,000원'), what?.answer)
check('하루 몇 포 먹는지는 구성 답으로 넘겨짚지 않는다', answerProductInfo('레몬베이스 하루 몇포 마셔요', catalog, ctxFor('레몬베이스 하루 몇포 마셔요')) === null)

// 3. 상품 설명 글에서 문장 찾기
const soil = answerFromProductText('대파 흙 묻어서 오는거요?', catalog, ctxFor('대파 흙 묻어서 오는거요?', ['onion']))
check('설명 글에 질문 낱말이 있으면 그 문장을 보여 준다', soil?.answer.includes('흙째 보내는 겨울 대파'), soil?.answer)
const hot = answerFromProductText('고춧가루 매운거 있소?', catalog, ctxFor('고춧가루 매운거 있소?', ['chili']))
check('"매운거" → (매운맛) 상품으로 좁힌다', hot?.sources.map((s) => s.code).join() === 'chili_hot', hot?.answer)
check('설명 글에 질문 낱말이 없으면 답하지 않는다 (AI 버튼으로)', answerFromProductText('샤인머스캣 송이 크기가 작아요?', catalog, ctxFor('샤인머스캣 송이 크기가 작아요?', ['grape'])) === null)

// 3-2. 두 상품 차이
const diff = answerCompareProducts('고춧가루 매운맛이랑 보통맛 차이가 뭐에요', catalog, ctxFor('고춧가루 매운맛이랑 보통맛 차이가 뭐에요', ['chili']))
check('두 상품 차이는 소개 글을 나란히, 판단하지 않는다', diff?.answer.includes('매운 고추를') && diff.answer.includes('김장용 굵은') && diff.answer.includes('판단하지 않아요'), diff?.answer)

// 4. 값만 말한 질문
const cheap = answerBudget('제일 싼거 뭐에요', catalog, ctxFor('제일 싼거 뭐에요'))
check('제일 싼 상품', cheap?.answer.includes('해남 흙대파 1kg 2,900원'), cheap?.answer)
const fruit = answerBudget('만원 이하 과일 있나요', catalog, ctxFor('만원 이하 과일 있나요'))
check('만원 이하 과일만 (채소·가공품 빼고)', fruit?.answer.includes('노지감귤 맛보기 2.5kg 9,900원') && !fruit.answer.includes('대파'), fruit?.answer)
check('품목을 말했으면 값 규칙은 끼어들지 않는다', answerBudget('감귤 제일 싼거', catalog, ctxFor('감귤 제일 싼거', ['mandarin'])) === null)

console.log(`\n${count - failed}/${count} 통과`)
if (failed) process.exit(1)
