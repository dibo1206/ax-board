// 실제 사진이 들어오기 전까지 쓰는 자리 표시용 이미지
export default function ProductImage({ product, size = 'md' }) {
  return (
    <div className={`product-image product-image-${size}`} style={{ background: product.color }} aria-hidden="true">
      <span>{product.emoji}</span>
    </div>
  )
}
