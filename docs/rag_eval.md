# 벡터 검색 평가

- 실행: 2026. 11. 22. AM 2:27:50 · 모델 baai/bge-m3 · 글을 답으로 내는 기준 점수 0.6, 점수 차이 0.03 · 자료 조각 363개 · AI 호출 0회
- 질문은 Claude가 만들었고 손님 말투를 다 대표하지 않는다. 자료도 예시 데이터라 양이 적다
- test 질문은 조건을 정하는 동안 이미 몇 번 돌렸다. 처음 보는 질문의 값이 아니다
- test2 질문(11/22)은 새로 생긴 품목과 실제 상담 기록 말투로 만들었고, 정답을 먼저 적은 뒤 돌렸다
- 자료가 늘어 예전 질문에도 맞는 답이 새로 생겨서, 그런 조각은 정답에 더했다 (rag_eval.csv 의 note 열에 표시)
- 글자 비교 열은 품목 필터 없이 같은 조각에서 찾은 값이고, 벡터 열은 실제 챗봇과 같은 필터를 쓴 값이다
- 다시 돌리기: `npm run rag-eval -- test`

| 질문 묶음 | 답 있는 질문 | 글자 비교 1위 | 글자 비교 3위 안 | 벡터 1위 | 벡터 3위 안 | 벡터 5위 안 | 글을 답으로 냄: 맞음 | 글을 답으로 냄: 틀림 | 답 없는 질문에 답함 |
|---|---|---|---|---|---|---|---|---|---|
| tune (기준을 정한 질문) | 24 | 11 | 13 | 16 | 22 | 23 | 6 | 0 | 0/17 |
| test (기준을 정한 뒤 처음 돌린 질문) | 28 | 11 | 16 | 22 | 24 | 26 | 3 | 0 | 0/8 |
| test2 (11/22 추가: 새 품목·실제 상담 기록 말투) | 44 | 24 | 33 | 38 | 41 | 41 | 17 | 0 | 0/8 |
| 전체 | 96 | 46 | 62 | 76 | 87 | 90 | 26 | 0 | 0/33 |

## 질문별

| 묶음 | 질문 | 정답 조각 | 찾은 1위 (점수) | 판정 |
|---|---|---|---|---|
| tune | 복숭아 바로 안 먹을 건데 어디다 둬요 | item:peach:storage | item:peach:storage (0.686, 차이 0.073) | 답 안 함 |
| tune | 사과를 오래 두고 먹으려면 | item:apple:storage | item:apple:storage (0.734, 차이 0.107) | 답 안 함 |
| tune | 딱딱한 과일 어떻게 익혀요 | item:peach:storage\|qna:3\|qna:455\|item:kiwi:storage | item:fruit_base:recipe (0.571, 차이 0.027) | 답 안 함 |
| tune | 냉장고에 넣으면 안 되는 채소 있어요 | item:sweet_potato:storage\|qna:83 | qna:83 (0.546, 차이 0.024) | 답 안 함 |
| tune | 초록색으로 변한 감자 | item:potato:storage\|item:potato:safety\|item:potato:state | item:potato:safety (0.663, 차이 0.080) | 맞음 |
| tune | 탄산수랑 섞어 마시는 법 | item:plum_syrup:recipe\|item:pear_juice:recipe\|item:plum_syrup:cafe\|item:pear_juice:cafe\|item:fruit_base:recipe\|item:citron_tea:recipe\|item:grape:recipe | product:plum_syrup_1200:about:1 (0.516, 차이 0.001) | 답 안 함 |
| tune | 빵에 발라 먹는 거 | item:grape_jam:recipe | item:grape_jam:recipe (0.484, 차이 0.001) | 답 안 함 |
| tune | 부침개 만들 때 쓰는 채소 | item:potato:recipe\|item:green_onion:recipe\|item:napa_cabbage:recipe | item:shiitake:recipe (0.518, 차이 0.013) | 답 안 함 |
| tune | 고기 양념에 넣는 과일 | item:pear:recipe | item:fruit_base:allergy (0.525, 차이 0.000) | 답 안 함 |
| tune | 에어프라이어에 구워 먹을 수 있는 거 | item:sweet_potato:recipe\|product:haenam_sweetpotato_mini_3kg:about:1 | product:sweet_potato_5kg:about:1 (0.566, 차이 0.013) | 답 안 함 |
| tune | 몇 시까지 전화 받아요 | policy:contact | policy:contact (0.631, 차이 0.084) | 맞음 |
| tune | 회사 사무실이 어디에 있어요 | policy:contact | policy:contact (0.567, 차이 0.096) | 답 안 함 |
| tune | 돌려보낼 때 택배비는 누가 내요 | policy:refund:2 | policy:shipping (0.656, 차이 0.017) | 답 안 함 |
| tune | 돈은 언제 돌려받아요 | policy:refund:4 | policy:refund:4 (0.690, 차이 0.095) | 맞음 |
| tune | 로그인 안 하고 살 수 있어요 | policy:order | policy:order (0.476, 차이 0.068) | 답 안 함 |
| tune | 오만원 넘게 사면 배송비는요 | policy:shipping | policy:refund:2 (0.693, 차이 0.012) | 답 안 함 |
| tune | 주말에도 보내 주나요 | policy:shipping | qna:442 (0.657, 차이 0.087) | 답 안 함 |
| tune | 제주에서 키운 채소 있어요 | seller:farm_green\|product:carrot_3kg:about:0 | seller:farm_green (0.606, 차이 0.037) | 답 안 함 |
| tune | 안동에서 농사짓는 곳 | seller:farm_sunny | seller:farm_sunny (0.584, 차이 0.066) | 답 안 함 |
| tune | 개봉한 배즙 얼마나 둬요 | item:pear_juice:opened\|qna:210 | qna:210 (0.762, 차이 0.050) | 맞음 |
| tune | 물에 탄 매실청은 며칠 가요 | item:plum_syrup:opened | item:plum_syrup:opened (0.662, 차이 0.075) | 답 안 함 |
| tune | 당근 흙 씻어서 넣어요? | qna:84\|item:carrot:storage | qna:84 (0.710, 차이 0.049) | 맞음 |
| tune | 잼에 곰팡이가 피었어요 | item:grape_jam:safety | item:grape_jam:safety (0.736, 차이 0.168) | 맞음 |
| tune | 카페에서 쓰는 비율 알려 주세요 | item:plum_syrup:cafe\|item:pear_juice:cafe | item:plum_syrup:cafe (0.658, 차이 0.005) | 답 안 함 |
| tune | 선물용 쇼핑백 주나요 | none | qna:436 (0.599, 차이 0.061) | 바르게 안 답함 |
| tune | 오늘 날씨 어때요 | none | seller:f_fd6284418c (0.454, 차이 0.007) | 바르게 안 답함 |
| tune | 비트코인 시세 알려줘 | none | product:yj_apple_set:about:1 (0.477, 차이 0.019) | 바르게 안 답함 |
| tune | 파이썬 코드 짜줘 | none | product:geochang_fuji_gift_10kg:about:1 (0.406, 차이 0.005) | 바르게 안 답함 |
| tune | 강아지 사료 추천 | none | product:yeongdong_shine_gift_2kg:about:1 (0.514, 차이 0.015) | 바르게 안 답함 |
| tune | 근처 맛집 알려 주세요 | none | product:namwon_carrot_10kg:about:0 (0.474, 차이 0.003) | 바르게 안 답함 |
| tune | 컴퓨터가 고장 났어요 | none | product:yj_mixed_set:about:1 (0.485, 차이 0.022) | 바르게 안 답함 |
| tune | 수박 고르는 법 | none | item:broccoli:recipe (0.484, 차이 0.007) | 바르게 안 답함 |
| tune | 사과 맛잇는거로 보내줘 | none | product:yj_apple_set:about:0 (0.634, 차이 0.015) | 바르게 안 답함 |
| tune | 사과가 너무 퍽퍽해요 원래 이런거에요? | none | item:apple:safety (0.639, 차이 0.095) | 바르게 안 답함 |
| tune | 배즙에 설탕 들어갔어요? | none | item:pear_juice:recipe (0.657, 차이 0.034) | 바르게 안 답함 |
| tune | 사과즙이랑 배즙 섞어서 한박스 주문 가능해여? | none | item:pear_juice:recipe (0.677, 차이 0.049) | 바르게 안 답함 |
| tune | 사과 ㄹㅇ 꿀사과임?ㅋㅋ | none | qna:456 (0.682, 차이 0.071) | 바르게 안 답함 |
| tune | 배즙 파우치 전자레인지 돌려도 돼요? | none | item:pear_juice:recipe (0.567, 차이 0.005) | 바르게 안 답함 |
| tune | 사과 왁스칠 했어요? 반짝반짝하던데 | none | item:apple:safety (0.581, 차이 0.068) | 바르게 안 답함 |
| tune | 도시락 싸갈건데 사과 갈변 안되게 하는법 알려주세요 | none | item:apple:safety (0.612, 차이 0.025) | 바르게 안 답함 |
| tune | 사과에 멍이 들어 있어요 | none | item:apple:safety (0.608, 차이 0.044) | 바르게 안 답함 |
| test | 복숭아 냉장고에 계속 둬도 되나 | item:peach:storage | item:peach:storage (0.735, 차이 0.068) | 답 안 함 |
| test | 배를 신문지에 싸야 하나요 | item:pear:storage | item:pear:storage (0.561, 차이 0.050) | 답 안 함 |
| test | 사과랑 다른 과일 같이 보관해요? | item:apple:storage | item:apple:storage (0.699, 차이 0.109) | 맞음 |
| test | 감자랑 양파 같이 둬요? | item:potato:storage | item:potato:storage (0.662, 차이 0.016) | 답 안 함 |
| test | 고구마 씻어서 보관해도 되나 | item:sweet_potato:storage | item:sweet_potato:storage (0.730, 차이 0.062) | 답 안 함 |
| test | 물러진 과일로 뭐 만들어요 | item:peach:recipe\|item:peach:state\|item:apple:state\|item:pear:state\|item:kiwi:state\|item:strawberry:state\|item:persimmon:state\|item:grape:state\|item:mandarin:state | item:fruit_base:recipe (0.544, 차이 0.015) | 답 안 함 |
| test | 스무디 재료로 좋은 거 | product:peach_4kg:about:0\|item:peach:recipe\|item:peach:state\|item:strawberry:recipe\|item:kiwi:recipe\|item:apple_juice:recipe\|product:sangju_apple_juice_30:about:1\|item:fruit_base:recipe | item:peach:recipe (0.574, 차이 0.004) | 답 안 함 |
| test | 채 썰어서 볶아 먹는 채소 | item:carrot:recipe | item:radish:recipe (0.543, 차이 0.028) | 답 안 함 |
| test | 홍차에 타 먹는 거 | item:plum_syrup:recipe\|item:pear_juice:recipe\|item:apple_juice:recipe\|product:sangju_apple_juice_30:about:1\|item:pear_juice:cafe | item:pear_juice:cafe (0.503, 차이 0.008) | 답 안 함 |
| test | 요거트에 올려 먹을 만한 것 | item:grape_jam:recipe\|item:strawberry:recipe\|item:kiwi:recipe\|item:persimmon:recipe\|item:dried_persimmon:recipe\|product:nonsan_cafe_4kg:about:1 | product:nonsan_ugly_2kg:about:1 (0.583, 차이 0.002) | 답 안 함 |
| test | 따뜻하게 끓여 먹는 배 요리 | item:pear:recipe | item:pear:recipe (0.704, 차이 0.047) | 답 안 함 |
| test | 점심시간에도 전화돼요 | policy:contact | policy:contact (0.582, 차이 0.044) | 답 안 함 |
| test | 토요일에 상담 돼요 | policy:contact | qna:442 (0.584, 차이 0.044) | 답 안 함 |
| test | 메일 주소 뭐예요 | policy:contact | policy:contact (0.538, 차이 0.040) | 답 안 함 |
| test | 취소는 어디서 해요 | policy:refund:3 | policy:refund:3 (0.669, 차이 0.074) | 맞음 |
| test | 카드로 샀으면 돈 언제 들어와요 | policy:refund:4 | policy:refund:4 (0.673, 차이 0.086) | 답 안 함 |
| test | 마음이 바뀌었으면 며칠 안에 말해야 해요 | policy:refund:0 | policy:refund:0 (0.541, 차이 0.011) | 답 안 함 |
| test | 신선식품은 그냥 안 산다고 못 해요? | policy:refund:1 | policy:refund:0 (0.508, 차이 0.005) | 답 안 함 |
| test | 가입 없이 주문한 건 어떻게 찾아요 | policy:order | policy:order (0.662, 차이 0.119) | 답 안 함 |
| test | 농가 두 곳에서 사면 배송비 두 번 내요 | policy:shipping | policy:shipping (0.660, 차이 0.015) | 답 안 함 |
| test | 결제하고 언제 출발해요 | policy:shipping | policy:preorder (0.619, 차이 0.026) | 답 안 함 |
| test | 나주에서 온 과일 | seller:farm_pear\|product:pear_5kg:about:0 | seller:farm_pear (0.519, 차이 0.010) | 답 안 함 |
| test | 황토에서 키운 거 있어요 | seller:farm_sweet_potato | seller:farm_sweet_potato (0.565, 차이 0.012) | 답 안 함 |
| test | 철원 농장 정보 | seller:farm_potato | seller:farm_potato (0.584, 차이 0.089) | 답 안 함 |
| test | 매실청 곰팡이 보이면 | item:plum_syrup:safety | item:plum_syrup:safety (0.751, 차이 0.167) | 맞음 |
| test | 감자에 싹이 났어요 | item:potato:storage\|item:potato:safety\|item:potato:state | item:potato:safety (0.600, 차이 0.013) | 답 안 함 |
| test | 복숭아 딱딱한데 언제 먹어요 | qna:3\|item:peach:storage | qna:3 (0.717, 차이 0.005) | 답 안 함 |
| test | 납품 상담은 어디로 해요 | policy:bulk | policy:bulk (0.574, 차이 0.027) | 답 안 함 |
| test | 오늘 환율 얼마예요 | none | policy:refund:2 (0.437, 차이 0.001) | 바르게 안 답함 |
| test | 내일 비 와요 | none | policy:refund:1 (0.465, 차이 0.002) | 바르게 안 답함 |
| test | 영어 번역해 주세요 | none | policy:refund:5 (0.448, 차이 0.000) | 바르게 안 답함 |
| test | 치킨 주문하고 싶어요 | none | policy:order (0.518, 차이 0.009) | 바르게 안 답함 |
| test | 비행기표 예약 | none | policy:preorder (0.500, 차이 0.067) | 바르게 안 답함 |
| test | 고양이 키우는 법 | none | product:yeongdong_shine_2kg:about:1 (0.532, 차이 0.049) | 바르게 안 답함 |
| test | 파인애플 자르는 법 | none | item:green_onion:recipe (0.473, 차이 0.003) | 바르게 안 답함 |
| test | 노트북 추천해 줘 | none | product:yj_mixed_set:about:1 (0.455, 차이 0.001) | 바르게 안 답함 |
| test2 | 딸기 씻어서 넣어 둬도 돼요 | item:strawberry:storage | item:strawberry:storage (0.750, 차이 0.123) | 답 안 함 |
| test2 | 귤 상자째 두면 안 돼요 | item:mandarin:storage | item:mandarin:storage (0.648, 차이 0.092) | 맞음 |
| test2 | 단감 말랑해지는 거 싫은데 어떻게 둬요 | item:persimmon:storage | item:persimmon:storage (0.745, 차이 0.129) | 맞음 |
| test2 | 무 잎 달린 채로 보관해요 | item:radish:storage | item:radish:storage (0.729, 차이 0.121) | 맞음 |
| test2 | 생표고 씻어서 냉장해도 되나요 | item:shiitake:storage | item:shiitake:storage (0.681, 차이 0.074) | 맞음 |
| test2 | 깐마늘 오래 두는 법 | item:garlic:storage | item:garlic:storage (0.720, 차이 0.097) | 맞음 |
| test2 | 양파랑 감자 같이 둬도 돼요 | item:onion:storage\|item:potato:storage | item:potato:storage (0.656, 차이 0.006) | 답 안 함 |
| test2 | 대파 남은 거 어떻게 보관 | item:green_onion:storage | item:green_onion:storage (0.756, 차이 0.141) | 맞음 |
| test2 | 곶감은 냉장이에요 냉동이에요 | item:dried_persimmon:storage | item:dried_persimmon:storage (0.716, 차이 0.010) | 답 안 함 |
| test2 | 고춧가루 실온에 둬도 되나 | item:chili_powder:storage | item:chili_powder:storage (0.731, 차이 0.065) | 답 안 함 |
| test2 | 브로콜리 오래 두려면 | item:broccoli:storage | item:broccoli:storage (0.757, 차이 0.121) | 맞음 |
| test2 | 절임배추 받고 바로 못 담그면 | item:salted_cabbage:storage\|item:salted_cabbage:opened | item:salted_cabbage:storage (0.705, 차이 0.058) | 맞음 |
| test2 | 키위가 너무 딱딱해요 | item:kiwi:storage\|item:kiwi:safety\|qna:455 | qna:455 (0.726, 차이 0.167) | 맞음 |
| test2 | 곶감 겉에 하얀 가루 곰팡이예요 | item:dried_persimmon:safety | item:dried_persimmon:safety (0.781, 차이 0.238) | 맞음 |
| test2 | 포도 껍질에 흰 가루 | item:grape:safety | item:grape:safety (0.626, 차이 0.105) | 답 안 함 |
| test2 | 브로콜리가 노랗게 변했어요 | item:broccoli:safety\|item:broccoli:state | item:broccoli:safety (0.668, 차이 0.046) | 답 안 함 |
| test2 | 무 속에 바람 들었는데 먹어도 돼요 | item:radish:safety\|item:radish:state | item:radish:safety (0.639, 차이 0.054) | 답 안 함 |
| test2 | 유자청에 거품이 생겨요 | item:citron_tea:safety | item:citron_tea:safety (0.751, 차이 0.136) | 맞음 |
| test2 | 귤 하나에 곰팡이 폈는데 옆에 것도 버려요 | item:mandarin:safety | item:mandarin:safety (0.673, 차이 0.080) | 맞음 |
| test2 | 귤 껍질째 청 담그는 법 | item:mandarin:recipe | item:mandarin:recipe (0.633, 차이 0.026) | 답 안 함 |
| test2 | 곶감으로 만드는 간식 | item:dried_persimmon:recipe | item:dried_persimmon:recipe (0.668, 차이 0.011) | 답 안 함 |
| test2 | 김장 양념에 들어가는 거 | item:chili_powder:recipe\|item:salted_cabbage:recipe | product:uiseong_chili_kimjang_3kg:about:0 (0.630, 차이 0.009) | 답 안 함 |
| test2 | 파전 재료 | item:green_onion:recipe | item:green_onion:recipe (0.605, 차이 0.097) | 맞음 |
| test2 | 뜨거운 물에 타 먹는 차 | item:citron_tea:recipe\|item:fruit_base:recipe | product:goheung_yuja_1kg:about:1 (0.562, 차이 0.042) | 답 안 함 |
| test2 | 얼려 먹는 과일 | item:grape:recipe\|item:mandarin:recipe | item:pear_juice:opened (0.587, 차이 0.004) | 답 안 함 |
| test2 | 된장국에 넣는 버섯 | item:shiitake:recipe | item:shiitake:recipe (0.549, 차이 0.075) | 답 안 함 |
| test2 | 사과즙 젤리 만드는 법 | item:apple_juice:recipe | item:apple_juice:recipe (0.746, 차이 0.148) | 맞음 |
| test2 | 소과 크기가 얼마나 돼요 | qna:434 | qna:434 (0.710, 차이 0.139) | 답 안 함 |
| test2 | 못난이 귤 맛없는 거 아니에요 | qna:435 | qna:435 (0.738, 차이 0.059) | 답 안 함 |
| test2 | 배추 20kg 몇 포기 | qna:448 | product:haenam_cabbage_3:about:0 (0.514, 차이 0.005) | 답 안 함 |
| test2 | 김장 날짜 맞춰서 받을 수 있어요 | qna:447 | qna:447 (0.758, 차이 0.174) | 답 안 함 |
| test2 | 화고가 뭐예요 | qna:453 | qna:453 (0.608, 차이 0.090) | 답 안 함 |
| test2 | 시나노골드 맛이 어때요 | qna:458 | qna:458 (0.711, 차이 0.019) | 답 안 함 |
| test2 | 사과즙에 물 탔어요 | qna:441 | qna:441 (0.634, 차이 0.031) | 답 안 함 |
| test2 | 원목 표고는 뭐가 달라요 | qna:452 | qna:452 (0.714, 차이 0.137) | 답 안 함 |
| test2 | 선물하는건데 가격표 빼고 보내주실수있나요 | qna:436 | qna:436 (0.750, 차이 0.220) | 답 안 함 |
| test2 | 몇 시까지 결제해야 오늘 보내요 | policy:shipping | policy:shipping (0.620, 차이 0.025) | 답 안 함 |
| test2 | 택배사 어디예요 | policy:shipping | policy:shipping (0.543, 차이 0.035) | 답 안 함 |
| test2 | 배송 준비 중인데 취소하고 싶어요 | policy:refund:3 | policy:refund:3 (0.755, 차이 0.071) | 맞음 |
| test2 | 반품 신청 버튼 어디 있어요 | policy:refund:5 | policy:refund:5 (0.688, 차이 0.095) | 맞음 |
| test2 | 제주 귤 농장 | seller:f_fd6284418c | product:namwon_mandarin_m_5kg:about:0 (0.574, 차이 0.001) | 답 안 함 |
| test2 | 김해 단감 농가 | seller:f_090e09030a | seller:f_090e09030a (0.658, 차이 0.023) | 답 안 함 |
| test2 | 원목에서 키운 버섯 농가 | seller:f_c6d1780ef4 | product:jangheung_shiitake_1kg:about:0 (0.510, 차이 0.008) | 답 안 함 |
| test2 | 해외배송 되나요 일본 친구한테 보낼려고 | none | policy:shipping (0.527, 차이 0.014) | 바르게 안 답함 |
| test2 | 기숙사라 택배 받기 애매한데 편의점 택배 되나요 | none | qna:442 (0.478, 차이 0.001) | 바르게 안 답함 |
| test2 | 박스에 보자기 포장도 해주시나요 | none | qna:436 (0.541, 차이 0.004) | 바르게 안 답함 |
| test2 | 배즙 파우치 전자레인지 돌려도 돼요 | none | item:pear_juice:recipe (0.581, 차이 0.006) | 바르게 안 답함 |
| test2 | 판매 상품 등록하는 법을 알랴줘 | none | policy:preorder (0.558, 차이 0.015) | 바르게 안 답함 |
| test2 | 적립금 있어요 | none | product:yj_apple_set:about:1 (0.520, 차이 0.016) | 바르게 안 답함 |
| test2 | 포인트로 결제 돼요 | none | policy:preorder (0.538, 차이 0.001) | 바르게 안 답함 |
| test2 | 강아지가 포도 먹어도 돼요 | none | product:yeongdong_shine_2kg:about:1 (0.603, 차이 0.049) | 바르게 안 답함 |
| test2 | 딸기 보관 며칠 가능해요 | item:strawberry:storage | item:strawberry:storage (0.759, 차이 0.089) | 맞음 |
