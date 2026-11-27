# Railway로 한 달 공개 데모 올리기

8주차 과정의 "팀 과제 한 달 공개 운영"용 안내다(2026-11-12 작성). 회사 서버에 직접 설치하는 방법은 [deploy.md](deploy.md)에 있다.
Railway 화면 메뉴 이름과 요금은 바뀔 수 있으니 쓰기 직전에 다시 확인한다.

## 0. 왜 Railway인가

과정에서 배운 판정 기준(서버리스로 되는가)을 우리 코드에 대 본 결과다.

| 우리 코드의 특징 | 근거 | 서버리스(Netlify·Vercel) | 상시 서버(Railway·Render) |
|---|---|---|---|
| 정해진 시간마다 도는 일 3개 | 미결제 주문 정리 `server/orders.js` · 상담 자료(RAG) 다시 만들기 10분 `server/rag.js` · 보관 기간 지난 개인정보 지우기 6시간 `server/retention.js` | 안 됨 | 됨 |
| 올린 사진을 서버 디스크에 저장 | 당도계·상품·레시피 사진 `uploads/` (상품 38개의 당도계 사진) | 안 됨 (디스크 없음) | 볼륨을 붙이면 됨 |
| 30초를 넘을 수 있는 요청 | AI 상품 소개·품목 초안 (`server/content.js`) | 끊길 수 있음 | 됨 |
| 화면 + API를 서버 하나가 보냄 | `npm start` = `node server/index.js --serve` | 다시 짜야 함 | 그대로 |

| 후보 | 한 달 운영에 걸리는 조건 | 판단 |
|---|---|---|
| **Railway (앱 + DB 한 프로젝트)** | 무료는 체험 크레딧뿐 → Hobby(월 $5) 필요 | **선택** — 잠들지 않고, 앱·DB·볼륨을 한 화면에서 관리 |
| Render | 무료 웹 서비스는 15분 쉬면 잠들고(깨는 데 1분), 무료 Postgres는 30일 뒤 만료, 무료는 디스크도 지워짐 | 한 달 데모에 걸림 |
| Netlify | 위 표처럼 반복 작업·디스크·30초 제한에 걸림 | 구조를 크게 바꿔야 함 |
| Vercel | 무료(Hobby)는 비상업용이고, 비공개 저장소에 다른 팀원이 푸시하면 배포가 막힘 | 팀 과제에 안 맞음 |
| DB만 Supabase | 7일 쓰지 않으면 멈춤, 계정당 프로젝트 2개 | Railway 안에 DB를 두는 쪽이 단순 |

## 1. 계정과 비용

- **계정 주인**: 팀원 한 명이 Railway 계정을 만들고 팀 기록에 "누구 계정인지" 적는다. GitHub 저장소 `dibo1206/yjmarket`에 접근 권한을 준다.
- **비용**: Hobby 플랜(월 $5). 과정 운영팀이 부담하므로 [배포 테스트 보고서](deploy_test_report.md)에 이유를 적는다.
- **AI 키**: 계정 주인의 OpenRouter 키를 쓰되 OpenRouter 화면에서 **사용 한도(크레딧 상한)** 를 건다. 코드에도 하루 상한(`AI_DAILY_LIMIT`)이 있다.

## 2. 순서 (한 번)

**DB를 먼저 옮기고 앱을 켠다.** 앱이 먼저 켜지면 빈 표를 스스로 만들어서, 옮길 때 "이미 있음" 오류가 난다.

1. **프로젝트와 DB**: New Project → Deploy PostgreSQL (또는 빈 프로젝트에서 New → Database → PostgreSQL).
2. **DB 옮기기**: 아래 3장.
3. **앱 서비스**: 같은 프로젝트에서 New → GitHub Repo → `yjmarket`.
   - **반드시 DB가 있는 프로젝트 캔버스에서** 추가한다. 프로젝트가 다르면 `${{Postgres.DATABASE_URL}}`이 빈 값이 되고 내부 주소(`postgres.railway.internal`)도 못 찾는다(ENOTFOUND) — 11/14 시험에서 실제로 겪음. 캔버스에 앱과 Postgres 블록이 같이 보여야 한다.
   - Settings → Source에서 배포할 브랜치를 고른다. 시험은 `feat/railway-deploy`, 병합한 뒤에는 `main`.
   - 빌드는 Railway(Railpack)가 `package.json`을 보고 알아서 한다: Node 22(`engines`) → `npm ci` → `npm run build`(화면 빌드) → `npm start`.
4. **볼륨(사진 폴더)**: 앱 서비스에 볼륨을 붙이고 마운트 경로를 `/data`로 한다(캔버스에서 서비스 오른쪽 클릭 → Attach Volume). 코드가 Railway가 알려 주는 `RAILWAY_VOLUME_MOUNT_PATH` 아래 `uploads/`를 자동으로 쓴다(`server/uploads.js`). 사진 옮기기는 4장.
5. **변수**: 아래 표를 앱 서비스 Variables에 넣는다.
6. **공개 주소**: Settings → Networking → Generate Domain → 나온 주소를 `PUBLIC_URL`에 넣는다(변수를 바꾸면 다시 배포된다).
7. **상태 확인 주소**: Settings → Deploy → Healthcheck Path에 `/api/health` (DB까지 확인하고 200을 준다).
8. **확인**: 5장의 판정표.
9. **다른 팀원이 작은 커밋을 푸시**해서 자동으로 다시 배포되는지 본다.

### 앱 서비스 변수

| 이름 | 값 | 주의 |
|---|---|---|
| `NODE_ENV` | `production` | 없으면 `npm start`가 켜지지 않는다(가짜 결제·시험 로그인 방지) |
| `HOST` | `0.0.0.0` | Railway는 0.0.0.0 과 `PORT`로 받아야 한다. `PORT`는 Railway가 넣어 준다 |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | 같은 프로젝트 안 주소를 참조. 서비스 이름이 다르면 화면에서 고른다. 저장 뒤 눈 아이콘으로 값이 `<empty string>`이 아닌지 확인 |
| `DATA_KEY` | **실습서버 `.env`와 같은 값** | 다르면 옮긴 DB의 이름·전화·주소를 하나도 못 읽는다. 채팅·문서에 붙이지 말고 직접 옮긴다 |
| `SESSION_SECRET` | 새로 만든 임의 값 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OPENROUTER_API_KEY` | 계정 주인의 키 | 사용 한도를 걸어 둔다 |
| `CHAT_MODEL` | 실습서버와 같은 값 | 비우면 무료 모델을 차례로 시도 |
| `AI_DAILY_LIMIT` · `AI_DAILY_PER_USER` | 예: 200 · 10 | 공개 데모라 버튼 연타·비용 폭주 방지 |
| `PUBLIC_URL` | `https://….up.railway.app` | 6번에서 받은 주소 |
| `TOSS_CLIENT_KEY` · `TOSS_SECRET_KEY` | 토스 **테스트** 키 | 실결제 계약 전이라 테스트 키만 |
| `ALLOW_TEST_PAYMENTS` | `1` | 운영 모드에서 테스트 키로 주문을 받으려면 필요. 테스트 주문은 매출로 세지 않는다 |
| `DB_POOL_MAX` | 비움(3) 또는 5 | |
| `ADMIN_ALLOWED_IPS` | (선택) 회사·팀 IP | 비우면 관리자 로그인이 인터넷 전체에 열린다(2단계 인증은 운영에서 항상 켜짐) |
| `SMTP_*` · `MAIL_FROM` | (선택) | 비우면 메일은 보내지 않고 [알림 기록]에만 남는다 |

넣지 않는 것: `PROXY_SECRET`(배포 모드는 이 서버가 맨 앞이라 쓰지 않음), `OAUTH_MOCK`(운영에서는 켜지지 않음), `TRUST_PROXY_HOPS`(Railway 앞단 한 단 → 기본 1이 맞음), `UPLOAD_DIR`(볼륨을 붙이면 자동).

## 3. DB 옮기기 (실습서버 → Railway Postgres)

옮기기 전 확인 (2026-11-12 실습서버 개발 DB 기준):

| 확인 | 결과 | 판단 |
|---|---|---|
| 크기 | DB 15MB, 우리 표 8MB(가장 큰 표는 상담 자료 `rag_chunks` 2.2MB) | 충분히 작음 |
| 확장 | `plpgsql`(기본)만 | 그대로 옮겨짐 |
| 따로 만든 스키마 | `farm` 하나 (모든 표가 여기, 앱이 `search_path=farm`으로 접속) | `-n farm`으로 이 스키마만 옮긴다 |
| 접속 방식 | `server/db.js`에서 `DATABASE_URL` 하나 | 주소만 바꾸면 됨 |
| 버전 | 실습서버 PostgreSQL 16.15 · pg_dump 16.15 | Railway DB 버전이 16 이상인지 먼저 확인 |

**데모에 실제 개인정보를 넣지 않는다.** 개발 DB의 손님·주문은 시험용 데이터지만, 옮기기 전에 실제 사람의 정보가 섞이지 않았는지 한 번 더 본다.
상품 정보는 회사가 사용을 허락한 홈페이지 내용과 `[예시]` 데이터다.

실습서버 터미널에서 (Railway DB의 **공개 주소**는 Postgres 서비스 → Variables의 public 주소, 이름은 화면에서 확인):

```bash
# 주소는 화면에 찍히지 않게 변수로만 넣는다
read -rs NEW_DB_URL && export NEW_DB_URL     # Railway 공개 주소 붙여 넣고 Enter
cd ~/farm-mall && export OLD_DB_URL="$(node --env-file=.env -p 'process.env.DATABASE_URL')"

# 0. 버전
psql "$OLD_DB_URL" -Atc "select version();"
psql "$NEW_DB_URL" -Atc "select version();"

# 1. 내보내기 (farm 스키마만, 소유자·권한 정보 빼고). 개인정보가 든 파일이라 내 계정만 읽게
umask 077 && mkdir -p /tmp/cc_$USER && pg_dump "$OLD_DB_URL" -n farm --no-owner --no-privileges -f /tmp/cc_$USER/farm_backup.sql

# 2. 넣기 (오류가 나면 바로 멈춤)
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/cc_$USER/farm_backup.sql
psql "$NEW_DB_URL" -c "VACUUM ANALYZE;"

# 3. 표별 행 수를 양쪽에서 세어 비교 (Claude Code에 "두 DB의 farm 스키마 표별 행 수를 표로 비교해줘")

# 4. 확인이 끝나면 백업 파일 지우기 (git 에 올리지 않는다)
rm /tmp/cc_$USER/farm_backup.sql
```

- 앱이 먼저 켜져 빈 표가 이미 생겼다면, **새 DB에서만** `psql "$NEW_DB_URL" -c "DROP SCHEMA farm CASCADE;"` 한 뒤 2번부터 한다. 주소를 바꿔 실습서버 DB에 하지 않게 두 번 확인한다.
- 상담 자료(`rag_chunks`)의 벡터도 함께 옮겨지므로 다시 계산하지 않는다(AI 비용 없음).
- 관리자·판매자 계정도 함께 옮겨진다. 운영 모드에서는 2단계 인증이 필수라 등록하지 않은 계정은 로그인할 수 없다 → 필요하면 `npm run create-admin`(3일 안에 등록).

## 4. 사진 옮기기 (uploads → 볼륨)

`public/product-photos` 같은 기본 사진은 저장소에 있어 그대로 배포된다. 관리자·판매자가 **올린** 사진(`uploads/`, 2026-11-12 기준 212개 1.3MB)만 옮긴다.

1. 실습서버의 `~/farm-mall/uploads` 폴더를 계정 주인 PC로 받는다 (VS Code 탐색기에서 폴더 오른쪽 클릭 → Download).
2. 계정 주인 PC에 Railway CLI를 설치하고 `railway login` → 프로젝트 폴더에서 `railway link`(프로젝트·앱 서비스 고르기).
3. 볼륨 안 `uploads/`로 올린다 (볼륨 마운트 경로가 `/data`면 서버에서는 `/data/uploads`가 된다):

```bash
railway volume files upload ./uploads /uploads
railway volume files list /uploads
```

4. 상품 상세에서 당도계 사진이 보이는지 확인한다.

## 5. 배포 성공 판정

"배포 완료"라고 말하기 전에 모두 확인한다.

| # | 확인 | 방법 |
|---|---|---|
| 1 | 주소창 자물쇠(https) | 공개 주소로 열기 |
| 2 | 다른 기기에서 열림 | 스마트폰(와이파이 끄고 LTE로) |
| 3 | 상품 목록·상세, 당도계 사진 | 상세 3개 열어 보기 |
| 4 | 새로고침해도 데이터가 남음 | 장바구니 담기 → 새로고침 |
| 5 | 주문 → 토스 테스트 결제 → 주문 조회 | 테스트 카드로 1건 |
| 6 | 상담 AI가 실제 답을 줌 | "배송비 얼마예요?"(규칙 답) + [AI에게 물어보기] 1번 |
| 7 | 관리자 로그인 + 2단계 인증 | 관리자 화면 열기 |
| 8 | F12 Console에 빨간 오류 없음 | 첫 화면·상품 상세 |
| 9 | 다른 팀원 푸시 → 자동 재배포 | Deployments 목록 |

실패하면 앱 서비스의 Deployments → 해당 배포의 **Build Logs**(빌드 실패) 또는 **Deploy Logs**(켜진 뒤 오류)를 보고, 로그 전체를 Claude Code에 붙여 넣는다.
흔한 원인: `NODE_ENV`·`DATA_KEY`·`DATABASE_URL` 누락, `HOST` 없음(앱은 켜졌는데 "Application failed to respond").

## 6. 한 달 운영

- **잠들지 않음**: 상시 서버라 매일 깨우기 설정은 필요 없다. 대신 Railway 사용량·청구 화면과 OpenRouter 사용량을 주 1회 본다.
- **기업이 들어올 때**: README 맨 위와 발표 자료에 같은 데모 주소. 체험용 계정이 필요하면 2단계 인증 방식과 함께 따로 안내한다(관리자 계정 비밀번호를 문서에 적지 않는다).
- **백업**: 주 1회 3장의 1번(pg_dump)으로 내려받아 팀 공유 드라이브가 아닌 계정 주인 PC에 보관한다(개인정보가 든 파일). Railway의 자체 백업 기능은 플랜에서 확인한다.
- **문제가 생기면**: 먼저 Deployments에서 잘 되던 배포를 **Rollback**해 서비스를 살리고, 코드는 `git revert`로 고쳐 푸시한다(`reset` 금지).
- **한 달 뒤**: 운영 종료 일정 공지 → OpenRouter·토스 키 재발급(또는 폐기) → Railway 프로젝트 정리. 회사에 넘길 것은 코드와 문서.
