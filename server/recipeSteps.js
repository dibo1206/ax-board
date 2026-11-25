// 상품 상세 '이렇게 즐겨 보세요' 카드 뒷면에 쓰는 자세한 레시피 (data/recipe_steps.json)
// items.recipes 에는 한 줄 설명만 있어서, 레시피 사진 주소를 열쇠로 분량·재료·단계·팁을 붙인다
import { readFileSync } from 'node:fs'

const STEPS = JSON.parse(readFileSync(new URL('../data/recipe_steps.json', import.meta.url), 'utf8'))

export function withRecipeSteps(item) {
  if (!item?.recipes?.length) return item
  return {
    ...item,
    recipes: item.recipes.map((r) => {
      const more = r?.image && STEPS[r.image]
      return more ? { ...r, time: more.time, serving: more.serving, ingredient_list: more.ingredients, steps: more.steps, tip: more.tip } : r
    }),
  }
}
