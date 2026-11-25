import { useEffect, useRef, useState } from 'react'

// 상품 상세의 '이렇게 즐겨 보세요': 레시피마다 그림이 큰 카드 (PC 3열, 모바일은 옆으로 넘기기)
// 카드를 누르면 뒤집히면서 뒷면에 분량·재료·단계별 만드는 법·팁이 나온다 (자세한 내용은 data/recipe_steps.json)
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

function RecipeCard({ recipe, number }) {
  const [src, setSrc] = useState(recipe.image || recipeArt(recipe.title))
  const [flipped, setFlipped] = useState(false)
  // 뒷면 레시피가 앞면보다 길면 뒤집을 때 카드 높이를 레시피 길이만큼 늘린다 (속에서 스크롤하지 않게)
  const [height, setHeight] = useState(null)
  const frontRef = useRef(null)
  const backRef = useRef(null)
  const frontFace = useRef(null)
  const backFace = useRef(null)
  const firstRender = useRef(true)
  const open = () => {
    const front = frontFace.current.offsetHeight
    setHeight(front)
    requestAnimationFrame(() => {
      setHeight(Math.max(front, backFace.current.offsetHeight))
      setFlipped(true)
    })
  }
  const close = () => {
    setHeight(frontFace.current.offsetHeight)
    setFlipped(false)
    setTimeout(() => setHeight(null), 700)
  }
  // 뒤집은 뒤에는 보이는 면의 버튼으로 초점을 옮긴다 (처음 그릴 때는 옮기지 않는다)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const target = flipped ? backRef.current : frontRef.current
    target?.focus({ preventScroll: true })
  }, [flipped])
  const steps = recipe.steps?.length ? recipe.steps : [recipe.method]
  const ingredients = recipe.ingredient_list?.length
    ? recipe.ingredient_list
    : String(recipe.ingredients ?? '').split('·').map((x) => x.trim()).filter(Boolean)
  const titleId = `recipe-${number}-title`
  return (
    <li className={`recipe-card${flipped ? ' is-flipped' : ''}`}>
      <div className="recipe-flip" style={height ? { height } : undefined}>
        <div className="recipe-face recipe-front" ref={frontFace} aria-hidden={flipped}>
          <button
            type="button"
            ref={frontRef}
            className="recipe-open"
            tabIndex={flipped ? -1 : 0}
            onClick={open}
            aria-label={`${number}. ${recipe.title} 레시피 보기`}
          >
            <span className="recipe-photo">
              {/* 제목이 바로 아래에 있어 그림은 꾸밈으로 둔다 */}
              <img src={src} alt="" loading="lazy" decoding="async" onError={() => src !== FALLBACK && setSrc(FALLBACK)} />
              <span className="recipe-hint">레시피 보기</span>
            </span>
            <strong>{number}. {recipe.title}</strong>
            <span className="recipe-line">{recipe.method}</span>
          </button>
        </div>
        <div className="recipe-face recipe-back" ref={backFace} aria-hidden={!flipped} role="group" aria-labelledby={titleId}>
          <div className="recipe-back-head">
            <span className="recipe-no">RECIPE {String(number).padStart(2, '0')}</span>
            <h4 id={titleId}>{recipe.title}</h4>
            {(recipe.time || recipe.serving) && (
              <p className="recipe-meta">
                {recipe.time && <span>⏱ {recipe.time}</span>}
                {recipe.serving && <span>🍽 {recipe.serving}</span>}
              </p>
            )}
          </div>
          <div className="recipe-back-body">
            {ingredients.length > 0 && (
              <>
                <p className="recipe-label">재료</p>
                <ul className="recipe-ing">
                  {ingredients.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </>
            )}
            <p className="recipe-label">만드는 법</p>
            <ol className="recipe-steps">
              {steps.map((x, i) => <li key={i}>{x}</li>)}
            </ol>
            {recipe.tip && <p className="recipe-tip"><b>TIP</b>{recipe.tip}</p>}
          </div>
          <button
            type="button"
            ref={backRef}
            className="recipe-back-btn"
            tabIndex={flipped ? 0 : -1}
            onClick={close}
          >
            ↺ 사진으로 돌아가기
          </button>
        </div>
      </div>
    </li>
  )
}

export function RecipeCards({ recipes }) {
  if (!recipes?.length) return null
  return (
    <section className="box recipe-section">
      <h3>이렇게 즐겨 보세요</h3>
      <p className="recipe-sub">카드를 누르면 뒤집혀서 자세한 레시피가 나와요</p>
      <ol className="recipe-cards">
        {recipes.map((r, index) => <RecipeCard key={`${r.title}|${r.image ?? ''}`} recipe={r} number={index + 1} />)}
      </ol>
    </section>
  )
}
