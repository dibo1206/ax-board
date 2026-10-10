import { PRODUCTS, formatPrice } from '../data/products.js'
import { GUIDES } from '../data/guides.js'

// 질문 속 단어로 주제를 찾는다. 위에서부터 먼저 맞는 주제를 쓴다.
const TOPICS = [
  { key: 'refund', words: ['교환', '환불', '반품'] },
  { key: 'delivery', words: ['배송', '택배', '도착', '발송', '배달'] },
  { key: 'order', words: ['주문', '구매', '결제', '입금', '사는', '살 수'] },
  { key: 'storage', words: ['보관', '냉장', '냉동', '유통기한', '오래'] },
  { key: 'soldOut', words: ['품절', '재고', '있나요', '살 수 있'] },
  { key: 'brix', words: ['당도', 'brix', '브릭스', '달아', '단가요', '달아요', '달까'] },
  { key: 'weight', words: ['무게', '크기', '몇 개', '개수', '몇개', '용량'] },
  { key: 'price', words: ['가격', '얼마', '원이', '비싸', '싸요'] },
  { key: 'features', words: ['특징', '맛', '어때', '좋은'] },
]

const ALIASES = {
  'shine-muscat': ['샤인머스캣', '샤인', '머스캣', '포도'],
  'fuji-apple': ['부사'],
  'home-apple': ['못난이', '가정용 사과'],
  strawberry: ['딸기', '설향'],
  blueberry: ['블루베리'],
  'apple-juice': ['사과즙', '주스'],
  'dried-persimmon': ['감말랭이', '곶감'],
  'plum-syrup': ['매실', '매실청'],
}

function findMentionedProduct(text) {
  let best = null
  for (const product of PRODUCTS) {
    for (const word of ALIASES[product.id] ?? []) {
      if (text.includes(word) && (!best || word.length > best.length)) {
        best = { product, length: word.length }
      }
    }
  }
  return best?.product ?? null
}

function findTopic(text) {
  const lower = text.toLowerCase()
  return TOPICS.find((t) => t.words.some((w) => lower.includes(w)))?.key ?? null
}

const SOURCE_PRODUCT = '상품 정보'

function answerAboutProduct(product, topic) {
  switch (topic) {
    case 'price':
      return { text: `${product.name}은(는) ${product.unit}에 ${formatPrice(product.price)}입니다.`, sources: [SOURCE_PRODUCT] }
    case 'storage':
      return { text: `${product.name} 보관 방법: ${product.storage}`, sources: [SOURCE_PRODUCT, '보관 안내'] }
    case 'brix':
      return product.brix
        ? { text: `${product.name}의 당도는 ${product.brix}Brix입니다.`, sources: [SOURCE_PRODUCT] }
        : null
    case 'weight':
      return {
        text: `${product.name}은(는) ${product.unit} 기준 ${product.countPerBox}, ${product.weightPerItem}입니다.`,
        sources: [SOURCE_PRODUCT],
      }
    case 'soldOut':
      return {
        text: product.soldOut
          ? `${product.name}은(는) 현재 품절입니다. 입고 일정은 농가에 직접 문의해 주세요.`
          : `${product.name}은(는) 지금 주문 문의가 가능합니다.`,
        sources: [SOURCE_PRODUCT],
      }
    case 'features':
    case null:
      return {
        text: `${product.name}의 주요 특징: ${product.features.join(', ')}. 가격은 ${product.unit}에 ${formatPrice(product.price)}입니다.`,
        sources: [SOURCE_PRODUCT],
      }
    default:
      return null
  }
}

// 등록된 상품 정보와 안내 자료에서만 답한다. 근거가 없으면 answered: false.
export function answerQuestion(text, contextProduct) {
  const topic = findTopic(text)

  if (topic === 'delivery' || topic === 'order' || topic === 'refund') {
    const guide = GUIDES[topic]
    return { answered: true, text: guide.text, sources: [guide.title] }
  }

  const product = findMentionedProduct(text) ?? contextProduct
  if (product) {
    const answer = answerAboutProduct(product, topic)
    if (answer) return { answered: true, ...answer }
  } else if (topic === 'price') {
    const list = PRODUCTS.map((p) => `${p.name} ${formatPrice(p.price)}`).join(', ')
    return { answered: true, text: `상품별 가격입니다: ${list}`, sources: [SOURCE_PRODUCT] }
  } else if (topic) {
    return {
      answered: true,
      text: '어떤 상품이 궁금하신가요? 상품 이름을 함께 적어 주세요. (예: 샤인머스캣 보관 방법)',
      sources: [],
    }
  }

  return {
    answered: false,
    text: '죄송해요, 등록된 정보에서 확인할 수 없는 내용이에요. 정확한 안내를 위해 농가에 직접 문의해 주세요.',
    sources: [],
  }
}
