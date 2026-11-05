# 벡터 검색 평가

- 실행: 2026. 11. 5. PM 4:54:38 · 모델 baai/bge-m3 · 글을 답으로 내는 기준 점수 0.6, 점수 차이 0.03 · 자료 조각 71개 · AI 호출 0회
- 질문은 Claude가 만들었고 손님 말투를 다 대표하지 않는다. 자료도 예시 데이터라 양이 적다
- test 질문은 조건을 정하는 동안 이미 몇 번 돌렸다. 처음 보는 질문의 값이 아니다
- 글자 비교 열은 품목 필터 없이 같은 조각에서 찾은 값이고, 벡터 열은 실제 챗봇과 같은 필터를 쓴 값이다
- 다시 돌리기: `npm run rag-eval -- test`

| 질문 묶음 | 답 있는 질문 | 글자 비교 1위 | 글자 비교 3위 안 | 벡터 1위 | 벡터 3위 안 | 벡터 5위 안 | 글을 답으로 냄: 맞음 | 글을 답으로 냄: 틀림 | 답 없는 질문에 답함 |
|---|---|---|---|---|---|---|---|---|---|
| tune (기준을 정한 질문) | 24 | 13 | 17 | 21 | 22 | 23 | 8 | 0 | 0/17 |
| test (기준을 정한 뒤 처음 돌린 질문) | 28 | 15 | 23 | 25 | 28 | 28 | 6 | 0 | 0/8 |

## 질문별

| 묶음 | 질문 | 정답 조각 | 찾은 1위 (점수) | 판정 |
|---|---|---|---|---|
| tune | 복숭아 바로 안 먹을 건데 어디다 둬요 | item:peach:storage | item:peach:storage (0.686, 차이 0.058) | 답 안 함 |
| tune | 사과를 오래 두고 먹으려면 | item:apple:storage | item:apple:storage (0.734, 차이 0.107) | 답 안 함 |
| tune | 딱딱한 과일 어떻게 익혀요 | item:peach:storage\|qna:3 | qna:3 (0.546, 차이 0.030) | 답 안 함 |
| tune | 냉장고에 넣으면 안 되는 채소 있어요 | item:sweet_potato:storage\|qna:83 | policy:refund:1 (0.550, 차이 0.011) | 답 안 함 |
| tune | 초록색으로 변한 감자 | item:potato:storage\|item:potato:safety\|item:potato:state | item:potato:safety (0.663, 차이 0.080) | 맞음 |
| tune | 탄산수랑 섞어 마시는 법 | item:plum_syrup:recipe\|item:pear_juice:recipe\|item:plum_syrup:cafe\|item:pear_juice:cafe | item:pear_juice:recipe (0.533, 차이 0.038) | 답 안 함 |
| tune | 빵에 발라 먹는 거 | item:grape_jam:recipe | item:grape_jam:recipe (0.507, 차이 0.024) | 답 안 함 |
| tune | 부침개 만들 때 쓰는 채소 | item:potato:recipe | item:carrot:recipe (0.499, 차이 0.009) | 답 안 함 |
| tune | 고기 양념에 넣는 과일 | item:pear:recipe | item:apple:recipe (0.519, 차이 0.019) | 답 안 함 |
| tune | 에어프라이어에 구워 먹을 수 있는 거 | item:sweet_potato:recipe | item:sweet_potato:recipe (0.553, 차이 0.065) | 답 안 함 |
| tune | 몇 시까지 전화 받아요 | policy:contact | policy:contact (0.631, 차이 0.100) | 맞음 |
| tune | 회사 사무실이 어디에 있어요 | policy:contact | policy:contact (0.567, 차이 0.096) | 답 안 함 |
| tune | 돌려보낼 때 택배비는 누가 내요 | policy:refund:2 | policy:refund:2 (0.674, 차이 0.078) | 맞음 |
| tune | 돈은 언제 돌려받아요 | policy:refund:4 | policy:refund:4 (0.690, 차이 0.105) | 맞음 |
| tune | 로그인 안 하고 살 수 있어요 | policy:order | policy:order (0.476, 차이 0.076) | 답 안 함 |
| tune | 오만원 넘게 사면 배송비는요 | policy:shipping | policy:shipping (0.688, 차이 0.034) | 맞음 |
| tune | 주말에도 보내 주나요 | policy:shipping | policy:shipping (0.568, 차이 0.047) | 답 안 함 |
| tune | 제주에서 키운 채소 있어요 | seller:farm_green\|product:carrot_3kg:about:0 | seller:farm_green (0.606, 차이 0.059) | 답 안 함 |
| tune | 안동에서 농사짓는 곳 | seller:farm_sunny | seller:farm_sunny (0.584, 차이 0.074) | 답 안 함 |
| tune | 개봉한 배즙 얼마나 둬요 | item:pear_juice:opened\|qna:210 | qna:210 (0.753, 차이 0.041) | 맞음 |
| tune | 물에 탄 매실청은 며칠 가요 | item:plum_syrup:opened | item:plum_syrup:opened (0.662, 차이 0.075) | 답 안 함 |
| tune | 당근 흙 씻어서 넣어요? | qna:84\|item:carrot:storage | qna:84 (0.696, 차이 0.140) | 맞음 |
| tune | 잼에 곰팡이가 피었어요 | item:grape_jam:safety | item:grape_jam:safety (0.736, 차이 0.180) | 맞음 |
| tune | 카페에서 쓰는 비율 알려 주세요 | item:plum_syrup:cafe\|item:pear_juice:cafe | item:plum_syrup:cafe (0.658, 차이 0.005) | 답 안 함 |
| tune | 선물용 쇼핑백 주나요 | none | policy:order (0.493, 차이 0.018) | 바르게 안 답함 |
| tune | 오늘 날씨 어때요 | none | item:potato:storage (0.441, 차이 0.008) | 바르게 안 답함 |
| tune | 비트코인 시세 알려줘 | none | policy:contact (0.402, 차이 0.006) | 바르게 안 답함 |
| tune | 파이썬 코드 짜줘 | none | policy:bulk (0.395, 차이 0.003) | 바르게 안 답함 |
| tune | 강아지 사료 추천 | none | product:pear_5kg:about:0 (0.455, 차이 0.009) | 바르게 안 답함 |
| tune | 근처 맛집 알려 주세요 | none | policy:contact (0.471, 차이 0.011) | 바르게 안 답함 |
| tune | 컴퓨터가 고장 났어요 | none | item:sweet_potato:state (0.447, 차이 0.014) | 바르게 안 답함 |
| tune | 수박 고르는 법 | none | item:potato:recipe (0.444, 차이 0.001) | 바르게 안 답함 |
| tune | 사과 맛잇는거로 보내줘 | none | item:apple:storage (0.610, 차이 0.008) | 바르게 안 답함 |
| tune | 사과가 너무 퍽퍽해요 원래 이런거에요? | none | item:apple:safety (0.639, 차이 0.093) | 바르게 안 답함 |
| tune | 배즙에 설탕 들어갔어요? | none | item:pear_juice:recipe (0.654, 차이 0.030) | 바르게 안 답함 |
| tune | 사과즙이랑 배즙 섞어서 한박스 주문 가능해여? | none | item:pear_juice:recipe (0.677, 차이 0.051) | 바르게 안 답함 |
| tune | 사과 ㄹㅇ 꿀사과임?ㅋㅋ | none | product:apple_10kg:about:0 (0.566, 차이 0.010) | 바르게 안 답함 |
| tune | 배즙 파우치 전자레인지 돌려도 돼요? | none | item:pear_juice:storage (0.562, 차이 0.000) | 바르게 안 답함 |
| tune | 사과 왁스칠 했어요? 반짝반짝하던데 | none | item:apple:safety (0.581, 차이 0.068) | 바르게 안 답함 |
| tune | 도시락 싸갈건데 사과 갈변 안되게 하는법 알려주세요 | none | item:apple:safety (0.612, 차이 0.025) | 바르게 안 답함 |
| tune | 사과에 멍이 들어 있어요 | none | item:apple:safety (0.608, 차이 0.054) | 바르게 안 답함 |
| test | 복숭아 냉장고에 계속 둬도 되나 | item:peach:storage | item:peach:storage (0.735, 차이 0.060) | 답 안 함 |
| test | 배를 신문지에 싸야 하나요 | item:pear:storage | item:pear:storage (0.561, 차이 0.079) | 답 안 함 |
| test | 사과랑 다른 과일 같이 보관해요? | item:apple:storage | item:apple:storage (0.699, 차이 0.109) | 맞음 |
| test | 감자랑 양파 같이 둬요? | item:potato:storage | item:potato:storage (0.662, 차이 0.074) | 맞음 |
| test | 고구마 씻어서 보관해도 되나 | item:sweet_potato:storage | item:sweet_potato:storage (0.730, 차이 0.067) | 답 안 함 |
| test | 물러진 과일로 뭐 만들어요 | item:peach:recipe\|item:peach:state\|item:apple:state\|item:pear:state | item:apple:recipe (0.512, 차이 0.039) | 답 안 함 |
| test | 스무디 재료로 좋은 거 | product:peach_4kg:about:0\|item:peach:recipe\|item:peach:state | item:peach:recipe (0.574, 차이 0.048) | 답 안 함 |
| test | 채 썰어서 볶아 먹는 채소 | item:carrot:recipe | item:apple:recipe (0.515, 차이 0.007) | 답 안 함 |
| test | 홍차에 타 먹는 거 | item:plum_syrup:recipe\|item:pear_juice:recipe | item:pear_juice:recipe (0.505, 차이 0.001) | 답 안 함 |
| test | 요거트에 올려 먹을 만한 것 | item:grape_jam:recipe | item:grape_jam:recipe (0.573, 차이 0.083) | 답 안 함 |
| test | 따뜻하게 끓여 먹는 배 요리 | item:pear:recipe | item:pear:recipe (0.704, 차이 0.074) | 답 안 함 |
| test | 점심시간에도 전화돼요 | policy:contact | policy:contact (0.582, 차이 0.048) | 답 안 함 |
| test | 토요일에 상담 돼요 | policy:contact | policy:contact (0.540, 차이 0.063) | 답 안 함 |
| test | 메일 주소 뭐예요 | policy:contact | policy:contact (0.538, 차이 0.070) | 답 안 함 |
| test | 취소는 어디서 해요 | policy:refund:3 | policy:refund:3 (0.678, 차이 0.083) | 맞음 |
| test | 카드로 샀으면 돈 언제 들어와요 | policy:refund:4 | policy:refund:4 (0.673, 차이 0.068) | 답 안 함 |
| test | 마음이 바뀌었으면 며칠 안에 말해야 해요 | policy:refund:0 | policy:refund:0 (0.562, 차이 0.035) | 답 안 함 |
| test | 신선식품은 그냥 안 산다고 못 해요? | policy:refund:1 | policy:refund:1 (0.664, 차이 0.179) | 맞음 |
| test | 가입 없이 주문한 건 어떻게 찾아요 | policy:order | policy:order (0.662, 차이 0.119) | 답 안 함 |
| test | 농가 두 곳에서 사면 배송비 두 번 내요 | policy:shipping | policy:shipping (0.665, 차이 0.050) | 맞음 |
| test | 결제하고 언제 출발해요 | policy:shipping | policy:refund:4 (0.594, 차이 0.040) | 답 안 함 |
| test | 나주에서 온 과일 | seller:farm_pear\|product:pear_5kg:about:0 | seller:farm_pear (0.519, 차이 0.035) | 답 안 함 |
| test | 황토에서 키운 거 있어요 | seller:farm_sweet_potato | seller:farm_sweet_potato (0.565, 차이 0.027) | 답 안 함 |
| test | 철원 농장 정보 | seller:farm_potato | seller:farm_potato (0.584, 차이 0.089) | 답 안 함 |
| test | 매실청 곰팡이 보이면 | item:plum_syrup:safety | item:plum_syrup:safety (0.751, 차이 0.167) | 맞음 |
| test | 감자에 싹이 났어요 | item:potato:storage\|item:potato:safety\|item:potato:state | item:potato:safety (0.600, 차이 0.007) | 답 안 함 |
| test | 복숭아 딱딱한데 언제 먹어요 | qna:3\|item:peach:storage | qna:3 (0.729, 차이 0.017) | 답 안 함 |
| test | 납품 상담은 어디로 해요 | policy:bulk | policy:bulk (0.574, 차이 0.023) | 답 안 함 |
| test | 오늘 환율 얼마예요 | none | policy:refund:1 (0.437, 차이 0.001) | 바르게 안 답함 |
| test | 내일 비 와요 | none | policy:bulk (0.436, 차이 0.008) | 바르게 안 답함 |
| test | 영어 번역해 주세요 | none | policy:refund:5 (0.448, 차이 0.009) | 바르게 안 답함 |
| test | 치킨 주문하고 싶어요 | none | policy:order (0.518, 차이 0.009) | 바르게 안 답함 |
| test | 비행기표 예약 | none | policy:refund:5 (0.433, 차이 0.013) | 바르게 안 답함 |
| test | 고양이 키우는 법 | none | item:peach:storage (0.376, 차이 0.006) | 바르게 안 답함 |
| test | 파인애플 자르는 법 | none | item:potato:recipe (0.440, 차이 0.024) | 바르게 안 답함 |
| test | 노트북 추천해 줘 | none | product:pear_5kg:about:0 (0.452, 차이 0.006) | 바르게 안 답함 |
