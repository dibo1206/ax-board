// 택배사 목록과 배송 조회 링크. 택배사마다 조회 주소가 자주 바뀌어서, 네이버 검색의 배송 조회 결과로 연결한다
export const COURIERS = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', '경동택배']

export function trackingUrl(courier, trackingNo) {
  if (!courier || !trackingNo) return null
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(`${courier} ${trackingNo}`)}`
}
