// 상품 등록·수정 화면의 [손님 화면으로 미리보기] (2026-11-22)
// 쇼핑몰 상품 상세(App.jsx)를 관리자·판매자 화면(따로 받는 파일)이 빌려 쓴다.
// 관리자 화면에서 App.jsx 를 다시 불러오면 빌드가 쇼핑몰 첫 화면 파일을 쪼개 버려서,
// App.jsx 가 켜질 때 미리보기 화면을 여기에 넣어 두고 등록 화면은 여기서 꺼내 쓴다 (관리자 화면은 늘 App.jsx 뒤에 열린다)
let preview = null

export function setProductPreview(component) {
  preview = component
}

export const getProductPreview = () => preview
