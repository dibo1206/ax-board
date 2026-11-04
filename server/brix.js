// 당도 등급: 농산물 표준규격의 등급별 당도 규격(표준규격품의 표시방법)을 그대로 쓴다. 판매자가 등급을 직접 고를 수 없다
// 특 이상 "매우높은 당도", 상 이상 "높은 당도", 그 아래 "보통 당도". 공식 기준이 없는 품목·품종은 등급 없이 측정값만 보여 준다
// 금감은 규격이 "미달 비율" 방식이라 자동 판정에서 뺐다. 관리자가 [품목 검수]에서 출처를 적고 기준을 넣을 수 있다
export const BRIX_SOURCE = '농산물 표준규격 등급별 당도 규격 (표준규격품의 표시방법 별표 4)'
export const COMMON = '공통' // 품종 구분이 없는 품목
export const OTHER = '기타' // 표에 없는 품종 → 등급 없음

export const OFFICIAL = {
  사과: [{ varieties: ['후지', '화홍', '감홍', '홍로'], high: 12, top: 14 }, { varieties: ['홍월', '서광', '홍옥', '쓰가루(착색계)'], high: 10, top: 12 }, { varieties: ['쓰가루(비착색계)'], high: 8, top: 10 }],
  배: [{ varieties: ['황금', '추황', '신화', '화산', '원황'], high: 10, top: 12 }, { varieties: ['신고'], high: 10, top: 11 }, { varieties: ['장십랑'], high: 9, top: 11 }, { varieties: ['만삼길'], high: 8, top: 10 }],
  복숭아: [{ varieties: ['서미골드', '진미'], high: 10, top: 13 }, { varieties: ['찌요마루', '유명', '장호원황도', '천홍', '천중백도'], high: 10, top: 12 }, { varieties: ['백도', '선광', '수봉', '미백'], high: 9, top: 11 }, { varieties: ['포목', '창방', '대구보', '선프레', '암킹'], high: 8, top: 10 }],
  포도: [{ varieties: ['델라웨어', '새단', 'MBA', '샤인머스켓'], high: 16, top: 18 }, { varieties: ['거봉'], high: 15, top: 17 }, { varieties: ['캠벨얼리'], high: 12, top: 14 }],
  감귤: [{ varieties: ['한라봉', '천혜향', '진지향'], high: 12, top: 13 }, { varieties: ['온주밀감(시설)', '청견', '황금향'], high: 11, top: 12 }, { varieties: ['온주밀감(노지)'], high: 10, top: 11 }],
  단감: [{ varieties: ['서촌조생', '차량', '태추', '로망'], high: 12, top: 14 }, { varieties: ['부유'], high: 11, top: 13 }, { varieties: ['대안단감'], high: 11, top: 12 }],
  자두: [{ varieties: ['포모사'], high: 9, top: 11 }, { varieties: ['대석조생'], high: 9, top: 10 }],
  참외: [{ varieties: [COMMON], high: 9, top: 11 }],
  딸기: [{ varieties: [COMMON], high: 9, top: 11 }],
  수박: [{ varieties: [COMMON], high: 9, top: 11 }],
  조롱수박: [{ varieties: [COMMON], high: 10, top: 12 }],
  멜론: [{ varieties: [COMMON], high: 11, top: 13 }],
}

export const GRADE_LABEL = { 3: '매우높은 당도', 2: '높은 당도', 1: '보통 당도' }

// 관리자가 넣은 기준을 다듬는다 (품종들·높은 당도·매우높은 당도가 모두 있는 줄만)
export function readStandards(input) {
  return (Array.isArray(input) ? input : []).slice(0, 12).map((s) => ({
    varieties: (Array.isArray(s?.varieties) ? s.varieties : []).map((v) => String(v).trim().slice(0, 30)).filter(Boolean).slice(0, 12),
    high: Number(s?.high),
    top: Number(s?.top),
  })).filter((s) => s.varieties.length && s.high > 0 && s.top >= s.high && s.top <= 40)
}
