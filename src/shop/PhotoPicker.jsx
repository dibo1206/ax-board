import { useEffect, useMemo } from 'react'

// 손님 사진 고르기 (후기·반품): 고른 사진을 미리 보여 준다. 올리기는 photoUpload.js 의 uploadPhotos
export function PhotoPicker({ files, onChange, max, label = '사진', hint = '' }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  function add(event) {
    const picked = [...event.target.files].filter((f) => /^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    event.target.value = ''
    onChange([...files, ...picked].slice(0, max))
  }
  return (
    <div className="photo-pick">
      <p className="photo-pick-title">{label} <span className="muted">(선택 · {max}장까지{hint ? ` · ${hint}` : ''})</span></p>
      {files.length > 0 && (
        <ul className="photo-pick-list">
          {previews.map((url, n) => (
            <li key={url}>
              <img src={url} alt={`고른 사진 ${n + 1}`} />
              <button type="button" className="photo-pick-x" aria-label={`사진 ${n + 1} 빼기`} onClick={() => onChange(files.filter((_, i) => i !== n))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <label className="button ghost photo-pick-add">
          + 사진 고르기
          <input type="file" accept="image/*" multiple hidden onChange={add} />
        </label>
      )}
    </div>
  )
}
