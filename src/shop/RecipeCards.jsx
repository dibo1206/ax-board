import { useEffect, useState } from 'react'

// 상품 상세의 '이렇게 즐겨 보세요': 레시피마다 그림이 큰 카드 (PC 3열, 모바일은 옆으로 넘기기)
// 카드를 누르면 레시피 창이 열려 재료와 만드는 법을 보여 준다
// 그림: 레시피에 image(예: /recipe-photos/kiwi-yogurt.webp)가 있으면 그 사진, 없으면 요리 종류에 맞는 기본 그림
// 기본 그림은 public/recipe-art 의 직접 그린 SVG라 사용권 걱정이 없다. 사진을 못 불러오면 접시 그림으로 바꾼다
const ART = '/recipe-art'
const FALLBACK = `${ART}/plate.svg`

// 레시피 제목에 들어간 말로 요리 종류를 고른다 (위에서부터 먼저 맞는 것)
const KINDS = [
  [/요거트|요구르트/, 'yogurt'],
  [/토스트|샌드위치/, 'toast'],
  [/스무디|에이드|스파클링|아이스티|주스|라떼/, 'cold-drink'],
  [/차$|배숙|수정과/, 'hot-drink'],
  [/수프|죽|국$|탕$|찌개/, 'soup'],
  [/잼|청$|장아찌|양념|기름|드레싱|피클|시럽/, 'jar'],
  [/샐러드|라페|생채|무침|겉절이|김치/, 'salad'],
  [/구이|군고구마|볶음|전$|조림|데침|찜|매시드/, 'pan'],
  [/말랭이|냉동|말이|칩|셔벗|젤리/, 'snack'],
]

const recipeArt = (title = '') => `${ART}/${KINDS.find(([pattern]) => pattern.test(title))?.[1] ?? 'plate'}.svg`

function RecipeCard({ recipe, number, onOpen }) {
  const [src, setSrc] = useState(recipe.image || recipeArt(recipe.title))
  return (
    <li className="recipe-card">
      <button type="button" className="recipe-card-btn" aria-haspopup="dialog" onClick={() => onOpen({ recipe, number })}>
        {/* 제목이 바로 아래에 있어 그림은 꾸밈으로 둔다 (화면 낭독기가 같은 말을 두 번 읽지 않게) */}
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => src !== FALLBACK && setSrc(FALLBACK)} />
        <strong>{number}. {recipe.title}</strong>
        <p>{recipe.method}</p>
      </button>
    </li>
  )
}

function RecipeDialog({ recipe, number, onClose }) {
  const [src, setSrc] = useState(recipe.image || recipeArt(recipe.title))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="recipe-layer" onClick={onClose}>
      <div className="recipe-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-dialog-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="recipe-close" onClick={onClose} aria-label="레시피 닫기">×</button>
        <img src={src} alt="" onError={() => src !== FALLBACK && setSrc(FALLBACK)} />
        <h4 id="recipe-dialog-title">{number}. {recipe.title}</h4>
        {recipe.ingredients && <p><b>재료</b> {recipe.ingredients}</p>}
        <p><b>만드는 법</b> {recipe.method}</p>
      </div>
    </div>
  )
}

export function RecipeCards({ recipes }) {
  const [open, setOpen] = useState(null)
  if (!recipes?.length) return null
  return (
    <section className="box recipe-section">
      <h3>이렇게 즐겨 보세요</h3>
      <ol className="recipe-cards">
        {recipes.map((r, index) => <RecipeCard key={`${r.title}|${r.image ?? ''}`} recipe={r} number={index + 1} onOpen={setOpen} />)}
      </ol>
      {open && <RecipeDialog recipe={open.recipe} number={open.number} onClose={() => setOpen(null)} />}
    </section>
  )
}
