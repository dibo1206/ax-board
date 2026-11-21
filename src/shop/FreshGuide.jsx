// 보관·섭취 안내 디자인 (상품 설명 탭). main 의 보관·섭취 안내 칸이 보여 주던 내용을 모두 그대로 보여 주고, 배치만 나눈다:
//   받으면 이렇게 보관해요(보관법 번호 단계·보관 기간·개봉 후) → 상태로 판단해요(신선·품질 저하·섭취 부적합) → 받은 날 확인할 신호 → 알레르기·카페 비율·출처
//  - 보관법 번호 단계는 main 의 storageSteps(./detailFacts.js)와 .storage-steps 스타일(shop.css)을 그대로 쓴다 (한 문장이면 글 그대로)
//  - 신선도는 날짜가 아니라 지금 상태로 판단한다 (팀 식품 기준표). "먹어도 된다"고 판단하지 않는다
//  - id="fresh-guide": 배송 여정 카드의 [신선도 확인법 보기]가 이 칸으로 내려온다
import { storageSteps } from './detailFacts.js'
import './deliveryJourney.css'

export function FreshGuide({ item, fresh }) {
  const steps = item.storage_method ? storageSteps(item.storage_method) : null
  const stages = fresh && item.stage1_state
    ? [
        { k: 's1', name: '신선', state: item.stage1_state, uses: item.stage1_uses },
        { k: 's2', name: '품질 저하', state: item.stage2_state, uses: item.stage2_uses },
        { k: 's3', name: '섭취 부적합', state: '아래 신호가 보이면', uses: ['조리하지 말고 폐기'] },
      ]
    : null
  // 옛 데이터(며칠)도 그대로 보여 준다
  const dayStages = fresh && !item.stage1_state && item.fresh_days_stage1
    ? [
        { k: 's1', name: `받은 날부터 ${item.fresh_days_stage1}일까지`, uses: item.stage1_uses },
        { k: 's2', name: `${item.fresh_days_stage2}일까지`, uses: item.stage2_uses },
        { k: 's3', name: '그 뒤', uses: item.stage3_uses },
      ]
    : null
  return (
    <section className="box fg" id="fresh-guide">
      <h3>보관·섭취 안내</h3>
      {item.pending && <p className="muted">새로 들어온 품목이라 담당자가 보관·섭취 정보를 확인하고 있어요. 궁금한 점은 아래 상품 Q&A로 물어봐 주세요.</p>}

      {(item.storage_method || item.keep_period || item.opened_note) && (
        <div className="fg-keep">
          <p className="fg-label">받으면 이렇게 보관해요</p>
          {/* 보관법은 "A. B. C" 처럼 쓰여 있어서 번호 단계로 나눠 보여 준다 (한 문장이면 그대로) — main 과 같은 방식 */}
          {item.storage_method && (steps
            ? <ol className="storage-steps">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
            : <p>{item.storage_method}</p>)}
          {(item.keep_period || item.opened_note) && (
            <div className="fg-chips">
              {item.keep_period && <span><b>보관 기간 참고</b> {item.keep_period}</span>}
              {/* 글이 이미 "개봉 후…"로 시작하면 이름표를 붙이지 않는다 (같은 말이 두 번 나오지 않게) */}
              {item.opened_note && <span>{!/^\s*개봉/.test(item.opened_note) && <b>개봉 후</b>} {item.opened_note}</span>}
            </div>
          )}
        </div>
      )}

      {(stages || dayStages) && (
        <div className="fg-scale-wrap">
          <p className="fg-label">{stages ? '상태로 판단해요 — 날짜보다 지금 상태가 기준이에요' : '받은 날부터 이렇게 써요'}</p>
          <ol className="fg-scale">
            {(stages ?? dayStages).map((s) => (
              <li key={s.k} className={s.k}>
                <strong>{s.name}</strong>
                {s.state && <p>{s.state}</p>}
                {s.uses?.length > 0 && <p className="fg-uses">{s.uses.map((u) => <span key={u}>{u}</span>)}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(item.danger_signs.length > 0 || item.danger_note) && (
        <div className="fg-check">
          {item.danger_signs.length > 0 && (
            <>
              <p className="fg-label">받은 날 확인할 신호 — 이런 상태면 드시지 마세요</p>
              <ul>{item.danger_signs.map((d) => <li key={d}>{d}</li>)}</ul>
            </>
          )}
          {item.danger_note && <p className="fg-note"><b>헷갈리기 쉬워요</b> {item.danger_note}</p>}
        </div>
      )}

      {item.allergens.length > 0 && <p className="warn">알레르기: {item.allergens.join(', ')}</p>}
      {item.allergen_note && <p className="muted">{item.allergen_note}</p>}
      {item.cafe_note && <p className="muted">카페·업소 메뉴 비율: {item.cafe_note}</p>}
      {item.reviewed_by && item.source && <p className="note">출처: {item.source}</p>}
    </section>
  )
}
