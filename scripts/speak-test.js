// 말로 상품 등록하기 시험 (DB 없이): npm run test-speak
//   농가가 실제로 할 법한 말에서 품목 · 가격 · 옵션 · 당도 · 수확일 · 재고를 바르게 뽑는지,
//   없는 숫자를 만들지 않는지, AI 가 준 숫자도 원래 말에 있을 때만 쓰는지 본다
import { checkAiFields, findItem, harvestDate, koreanNumber, moneyIn, parseSpoken } from '../server/speakParse.js'

let count = 0
let failed = 0
const check = (name, ok, detail = '') => {
  count += 1
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TODAY = '2026-11-21'
const items = [
  { item_code: 'apple', name: '사과', category: '과일', brix_standards: [{ varieties: ['부사', '홍로'], high: 14, top: 15 }] },
  { item_code: 'pear', name: '배', category: '과일', brix_standards: [{ varieties: ['신고'], high: 11, top: 12 }] },
  { item_code: 'pear_juice', name: '배즙', category: '가공품', brix_standards: [] },
  { item_code: 'napa_cabbage', name: '배추', category: '채소', brix_standards: [] },
  { item_code: 'salted_cabbage', name: '절임배추', category: '가공품', brix_standards: [] },
  { item_code: 'strawberry', name: '딸기', category: '과일', brix_standards: [{ varieties: ['설향', '킹스베리'], high: 10, top: 12 }] },
  { item_code: 'potato', name: '감자', category: '채소', brix_standards: [] },
]

// 숫자 읽기
for (const [raw, want] of [['5만5천', 55000], ['오만 오천', 55000], ['3만', 30000], ['55,000', 55000], ['3.5만', 35000], ['만', 10000], ['이만 삼천', 23000], ['12만', 120000]]) {
  check(`숫자 읽기: ${raw} → ${want}`, koreanNumber(raw) === want, String(koreanNumber(raw)))
}
check('돈 찾기: 원이 붙거나 만 단위만 돈으로', same(moneyIn('5키로 3만 원, 당도 14, 20상자').map((m) => m.value), [30000]), JSON.stringify(moneyIn('5키로 3만 원, 당도 14, 20상자')))

// 품목
check('품목: 긴 이름 먼저 (절임배추 > 배추)', findItem('해남 절임배추 20kg', items)?.item_code === 'salted_cabbage')
check('품목: 배즙이 배보다 먼저', findItem('도라지 배즙 30포', items)?.item_code === 'pear_juice')
check('품목: 품종 이름으로도 (부사 → 사과)', findItem('부사 5키로 3만원', items)?.item_code === 'apple')

// 대표 문장
const a = parseSpoken('부사 사과 5키로 한 상자 3만 원, 10키로는 5만5천 원이에요. 당도 14, 어제 땄어요', items, TODAY)
check('옵션 두 개 (5kg 3만 / 10kg 5만5천)', same(a.options, [{ name: '5kg 1박스', price: '30000', stock: '' }, { name: '10kg 1박스', price: '55000', stock: '' }]), JSON.stringify(a.options))
check('품목 · 품종 · 이름', a.item_code === 'apple' && a.variety === '부사' && a.name === '부사 사과 5kg·10kg', `${a.item_code} ${a.variety} ${a.name}`)
check('당도 14 · 수확일 어제 · 측정일도 수확일로', a.brix === '14' && a.harvest_date === '2026-11-20' && a.brix_measured_at === '2026-11-20', `${a.brix} ${a.harvest_date}`)
check('옵션이 있으면 가격 · 재고 한 칸은 비워 둠', a.price === undefined && a.stock === undefined)

const b = parseSpoken('성환 신고배 7.5키로 6만원 30상자 있어요', items, TODAY)
check('한 가지 가격: 7.5kg 6만원 · 재고 30 · 품종 신고', b.item_code === 'pear' && b.price === '60000' && b.unit === '7.5kg 1박스' && b.stock === '30' && b.variety === '신고', JSON.stringify(b))

const c = parseSpoken('설향 딸기 500그램 만오천원, 11월 18일 수확', items, TODAY)
check('그램 · 만오천원 · 날짜', c.item_code === 'strawberry' && c.price === '15000' && c.unit === '500g' && c.harvest_date === '2026-11-18', JSON.stringify(c))

const f = parseSpoken('해남 절임배추 20키로 4만2천원', items, TODAY)
check('품목 앞 낱말(산지)을 이름에: 해남 절임배추 20kg', f.name === '해남 절임배추 20kg', f.name)
const g = parseSpoken('그냥 감자 3키로 만원', items, TODAY)
check('"그냥" 같은 말은 이름에 붙이지 않음', g.name === '감자 3kg', g.name)
const d = parseSpoken('감자 팔아요', items, TODAY)
check('숫자가 없으면 숫자 칸은 비워 둠 (지어내지 않음)', d.item_code === 'potato' && d.price === undefined && d.stock === undefined && d.brix === undefined, JSON.stringify(d))

const e = parseSpoken('사과 5키로 3만원 오늘 수확', items, TODAY)
check('오늘 수확 → 오늘 날짜', e.harvest_date === TODAY)
check('수확이라는 말 없이 날짜만 있으면 수확일로 보지 않음', harvestDate('11월 18일에 보낼게요', TODAY) === null)
check('앞으로 올 날짜면 작년 수확으로', harvestDate('12월 3일 수확', TODAY) === '2025-12-03')
check('"만든"을 만 원으로 읽지 않음', same(moneyIn('직접 만든 잼 8천원').map((m) => m.value), [8000]), JSON.stringify(moneyIn('직접 만든 잼 8천원')))
check('온도(도)는 당도로 보지 않음', parseSpoken('사과 5키로 3만원 0도 저장', items, TODAY).brix === undefined)

// AI 가 준 값 확인
const ai = checkAiFields({ item_code: 'apple', name: '사과 5kg', price: 33000, brix: 15, stock: 20, options: [] }, '사과 5키로 3만원 20상자', items, TODAY)
check('AI 가 지어낸 가격(33,000)·당도(15)는 버리고, 말에 있는 재고(20)만', ai.price === undefined && ai.brix === undefined && ai.stock === '20' && ai.item_code === 'apple', JSON.stringify(ai))
check('AI 가 목록에 없는 품목 코드를 주면 버림', checkAiFields({ item_code: 'durian' }, '두리안 3만원', items, TODAY).item_code === undefined)

console.log(`\n${count - failed}/${count} 통과`)
process.exit(failed ? 1 : 0)
