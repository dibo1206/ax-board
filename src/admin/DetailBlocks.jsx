// 블록형 상세페이지 편집 (관리자·판매자 상품 화면 공통, 2026-11-14)
// 글 블록과 사진 블록을 원하는 순서로 쌓는다. 사진은 고르기만 하고, 상품을 저장할 때 올린다 (새 상품은 코드가 저장 뒤에 생겨서)
// 서버 규칙은 server/blocks.js 와 같게: 블록 20개 · 사진 12장 · 제목 40자 · 본문 1000자 · 사진 설명 100자
import { useRef } from 'react'
import { thumbUrl } from '../shop/shared.js'
import { MAX_BLOCK_IMAGES, MAX_BLOCKS, PHOTO_TYPES, emptySlots, key, photoProblem } from './detailBlockUtils.js'

export function DetailBlocksEditor({ blocks, onChange }) {
  const addPhotos = useRef(null)
  const images = blocks.filter((b) => b.type === 'image').length
  const full = blocks.length >= MAX_BLOCKS

  const update = (k, patch) => onChange(blocks.map((b) => (b.key === k ? { ...b, ...patch } : b)))
  const move = (index, by) => {
    const next = [...blocks]
    const [picked] = next.splice(index, 1)
    next.splice(index + by, 0, picked)
    onChange(next)
  }
  const remove = (b) => {
    if (b.preview) URL.revokeObjectURL(b.preview)
    onChange(blocks.filter((x) => x.key !== b.key))
  }
  const pickFile = (b, file) => {
    if (!file) return
    const problem = photoProblem(file)
    if (problem) return update(b.key, { error: problem })
    if (b.preview) URL.revokeObjectURL(b.preview)
    update(b.key, { file, url: null, preview: URL.createObjectURL(file), error: '' })
  }
  const addText = () => onChange([...blocks, { key: key(), type: 'text', title: '', body: '' }])
  // 사진 여러 장을 한 번에 고르면 장마다 사진 블록이 하나씩 생긴다
  const addFiles = (files) => {
    const room = Math.min(MAX_BLOCKS - blocks.length, MAX_BLOCK_IMAGES - images)
    const added = [...files].slice(0, room).map((file) => {
      const problem = photoProblem(file)
      return { key: key(), type: 'image', url: null, alt: '', caption: '', hint: '', file: problem ? null : file, preview: problem ? null : URL.createObjectURL(file), error: problem }
    })
    onChange([...blocks, ...added])
  }

  return (
    <fieldset className="tags detail-blocks-edit">
      <legend>상세 블록 (선택, {MAX_BLOCKS}개 · 사진 {MAX_BLOCK_IMAGES}장까지) — 상품 설명 아래에 글과 사진을 원하는 순서로 쌓아요</legend>
      <p className="muted">
        사진 속에 글자를 넣기보다 <b>글 블록</b>으로 적어 주세요. 글 블록은 금지어 검사를 거치고, 상담 챗봇도 이 내용으로 답해요.
        사진은 가로 1000px 로 맞춰 줄이고(세로로 긴 사진도 글씨가 보이게) 위치 정보를 지워요.
      </p>
      {blocks.length === 0 && <p className="muted">아직 블록이 없어요. 아래 버튼으로 글이나 사진을 더하거나, 위의 [AI로 채우기]로 초안을 받아 보세요.</p>}
      <ol className="block-list">
        {blocks.map((b, i) => (
          <li key={b.key} className={`block-card ${b.type}`}>
            <div className="block-head">
              <strong>{i + 1}. {b.type === 'image' ? '사진' : '글'}</strong>
              <span className="block-tools">
                <button type="button" className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${i + 1}번 블록 위로`}>↑ 위로</button>
                <button type="button" className="link" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label={`${i + 1}번 블록 아래로`}>↓ 아래로</button>
                <button type="button" className="link" onClick={() => remove(b)}>빼기</button>
              </span>
            </div>
            {b.type === 'text' ? (
              <>
                <label>제목 <span className="muted">(선택)</span><input value={b.title} onChange={(e) => update(b.key, { title: e.target.value })} maxLength={40} placeholder="예: 이렇게 길렀어요" /></label>
                <label>본문<em className="req" title="필수">*</em>
                  <textarea value={b.body} onChange={(e) => update(b.key, { body: e.target.value })} rows={4} maxLength={1000} placeholder="효능 표현(면역력·다이어트 등)은 쓰지 않아요" />
                </label>
              </>
            ) : (
              <div className="block-photo">
                {b.preview || b.url
                  ? <img src={b.preview ?? thumbUrl(b.url)} alt="" width="96" height="96" />
                  : <div className="block-slot" aria-hidden="true">📷</div>}
                <div>
                  {b.hint && !b.file && !b.url && <p className="warn">AI가 제안한 사진 자리: <b>{b.hint}</b></p>}
                  <label>{b.file || b.url ? '사진 바꾸기' : '사진 고르기'} <span className="muted">(jpg·png·webp, 2MB 이하)</span>
                    <input type="file" accept={PHOTO_TYPES.join(',')} onChange={(e) => pickFile(b, e.target.files?.[0])} />
                  </label>
                  {b.file && <span className="muted">고른 사진: {b.file.name} (저장할 때 올려요)</span>}
                  {b.error && <p className="error">{b.error}</p>}
                  <label>사진 설명 <span className="muted">(사진이 안 보일 때·화면 낭독기가 읽어요)</span><input value={b.alt} onChange={(e) => update(b.key, { alt: e.target.value })} maxLength={100} placeholder="예: 비탈 과수원에 사과가 열린 모습" /></label>
                  <label>사진 아래 글 <span className="muted">(선택)</span><input value={b.caption} onChange={(e) => update(b.key, { caption: e.target.value })} maxLength={100} /></label>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {emptySlots(blocks) > 0 && <p className="warn">사진을 고르지 않은 사진 자리 {emptySlots(blocks)}개는 저장되지 않아요.</p>}
      <div className="actions">
        <button type="button" className="button ghost" disabled={full} onClick={addText}>+ 글 블록</button>
        <button type="button" className="button ghost" disabled={full || images >= MAX_BLOCK_IMAGES} onClick={() => addPhotos.current?.click()}>+ 사진 블록 (여러 장 가능)</button>
        <input ref={addPhotos} type="file" multiple hidden accept={PHOTO_TYPES.join(',')} onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = '' }} />
        <span className="muted">블록 {blocks.length}/{MAX_BLOCKS} · 사진 {images}/{MAX_BLOCK_IMAGES}</span>
      </div>
    </fieldset>
  )
}
