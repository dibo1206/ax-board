# 범용 서버로 옮기기 (실습서버 → 실제 운영 서버)

실습서버는 여러 팀이 같이 쓰는 개발용이라 그대로 손님을 받을 수 없다.
(배정 포트 하나, 계정당 DB 연결 5개, 같은 서버의 다른 사용자가 포트에 접속 가능, SSH 터널로만 접속)
운영 서버에서는 **서버 하나가 화면과 API를 함께** 보내고(`npm start`), 앞에 nginx가 HTTPS를 맡는다.

```
손님 브라우저 ──HTTPS──▶ nginx (443, 인증서) ──▶ node server/index.js --serve (127.0.0.1:3000) ──▶ PostgreSQL
                                                     └ uploads/ (상품 사진, 서버 디스크)
```

## 1. 어떤 서버를 빌리나

| 방법 | 예 | 월 비용(대략) | 이 프로젝트에 맞나 |
|---|---|---|---|
| **가상 서버(VPS) 1대 — 추천** | AWS Lightsail 서울, 네이버 클라우드, 가비아·카페24 클라우드 | 1~2만 원 (메모리 2GB) | 맞음. 사진이 서버 디스크(`uploads/`)에 저장되므로 디스크가 유지되는 서버가 편하다 |
| PaaS | Render, Railway, Fly.io | 무료~수만 원 | 무료 등급은 잠들거나 디스크가 지워져 사진이 사라짐. 유료 디스크 + 유료 DB가 필요 |

- 운영체제: Ubuntu 24.04, Node.js 22, PostgreSQL 16 (실습서버와 같은 버전)
- 도메인: 기업 도메인의 하위 주소를 추천 (예: `shop.yunjufarm.co.kr`). 도메인 관리 화면(홈페이지 제작사·등록 업체)에서 A 레코드를 서버 IP로 연결
- 토스페이먼츠 실결제 계약 심사 때 사이트 주소·사업자 정보·약관이 필요하다 → 도메인과 HTTPS를 먼저 준비

## 2. 서버 준비 (한 번)

```bash
# 패키지
sudo apt update && sudo apt install -y nginx postgresql git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# 앱 전용 계정과 폴더
sudo useradd --system --create-home --shell /bin/bash farm
sudo mkdir -p /srv/farm-mall && sudo chown farm:farm /srv/farm-mall

# DB와 DB 계정 (비밀번호는 직접 정해서)
sudo -u postgres createuser --pwprompt farm
sudo -u postgres createdb --owner farm farm_mall
```

## 3. 코드 받기와 설정

```bash
sudo -iu farm
git clone <비공개 저장소 주소> /srv/farm-mall && cd /srv/farm-mall
npm ci
mkdir -p uploads                         # 상품 사진 폴더 (서비스 파일이 이 폴더에만 쓰기를 허락함)
cp .env.sample .env && chmod 600 .env   # 아래 표대로 채우기
npm run build
npm run load-data                        # 실제 상품 CSV를 data/ 에 넣은 뒤
npm run create-admin -- <관리자 아이디>
npm run admin-2fa -- <관리자 아이디>
```

`.env` 에서 실습서버와 달라지는 값

| 이름 | 운영 값 | 왜 |
|---|---|---|
| `DATABASE_URL` | `postgres://farm:<비밀번호>@127.0.0.1:5432/farm_mall` | 우리 전용 DB |
| `DB_POOL_MAX` | `10` | 공용 DB 제한(5개)이 없어짐 |
| `PUBLIC_URL` | `https://shop.yunjufarm.co.kr` | 메일 링크·sitemap·공유 미리보기 |
| `TRUST_PROXY_HOPS` | `1` | nginx 한 단 (손님 실제 IP로 횟수 제한) |
| `SESSION_SECRET`, `DATA_KEY` | 새로 만들기 (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | 실습서버 값을 그대로 쓰지 않기 |
| `PROXY_SECRET` | 비워도 됨 | `npm start`(배포 모드)는 이 서버가 맨 앞이라 검사하지 않음 |
| `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` | 계약 전: 테스트 키(`test_…`) / 계약 후: 라이브 키 | 운영(`NODE_ENV=production`)에서는 키 없이 결제할 수 없음 |
| `REQUIRE_2FA` | `1` | 관리자 2단계 인증 필수 |
| `ADMIN_ALLOWED_IPS` | 회사 사무실 IP | 관리자 화면은 사무실에서만 |
| `SMTP_*`, `MAIL_FROM`, `ADMIN_EMAIL` | 회사 메일 계정 | 주문·문의 알림 |
| `AI_DAILY_LIMIT` | 상황에 맞게 (0이면 AI 끄기) | 상담은 대부분 AI 없이 답함 |

`NODE_ENV=production` 과 `PORT=3000` 은 아래 서비스 파일에 들어 있다. (로그인 쿠키에 Secure가 붙어 **HTTPS에서만** 로그인된다)

## 4. 자동으로 켜 두기 (systemd)

```bash
sudo cp deploy/farm-mall.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now farm-mall
systemctl status farm-mall          # 상태
journalctl -u farm-mall -f          # 기록 보기
```

- 서버가 죽거나 재부팅해도 3초 뒤 다시 켜진다. 끌 때는 처리 중인 결제를 마치고 꺼진다(20초 안)
- 확인: `curl http://127.0.0.1:3000/api/health` → `{"ok":true,"db":true}`

## 5. HTTPS (nginx + 무료 인증서)

```bash
sudo cp deploy/nginx-farm-mall.conf /etc/nginx/sites-available/farm-mall   # server_name 을 실제 도메인으로
sudo ln -s /etc/nginx/sites-available/farm-mall /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d shop.yunjufarm.co.kr       # 인증서 발급 + 443 설정 + 자동 갱신
```

방화벽은 22(SSH)·80·443만 연다. 3000번과 5432번(DB)은 밖에서 열지 않는다.

## 6. 백업

```bash
sudo cp deploy/backup.sh /srv/farm-mall/deploy/backup.sh && sudo chmod 750 /srv/farm-mall/deploy/backup.sh
sudo -u farm crontab -e     # 매일 새벽 3시:  0 3 * * * /srv/farm-mall/deploy/backup.sh
```

DB(`pg_dump`)와 상품 사진(`uploads/`)을 날짜별로 14일 보관한다. **서버 밖(회사 PC·클라우드 저장소)으로도 정기적으로 복사**한다. 접속 기록(`access_logs`)은 1년 이상 보관.

## 7. 새 버전 올리기

```bash
sudo -iu farm && cd /srv/farm-mall
git pull && npm ci && npm run build
sudo systemctl restart farm-mall      # DB 구조 변경(schema.sql)은 켤 때 자동으로 반영
```

## 8. 열기 전 점검

- [ ] `https://도메인` 접속, 자물쇠 표시, `http://` 는 https로 넘어감
- [ ] 테스트 키로 주문 → 결제 → 관리자 [주문]에 보임 → 취소까지
- [ ] 결제창(토스)이 콘텐츠 보안 정책(CSP)에 막히지 않는지: 브라우저 개발자 도구 콘솔에 `Content-Security-Policy` 오류가 없는지 (막히면 `server/web.js` 의 CSP 에 그 주소 추가)
- [ ] 관리자 로그인이 사무실 IP + 2단계 인증에서만 됨
- [ ] 주문 알림 메일이 손님·관리자에게 감
- [ ] `/robots.txt`, `/sitemap.xml` 이 실제 도메인으로 나옴, 상품 주소를 카톡에 붙이면 사진·가격 미리보기
- [ ] 약관·개인정보 처리방침 기업 검토 끝, 개인정보 보호책임자 기재 (`server/policy.js`)
- [ ] 토스 라이브 키로 바꾸고 소액 실결제 → 환불 확인
- [ ] 백업 파일이 생기고, 다른 서버에서 복원해 봄 (`pg_restore -d farm_mall db-날짜.dump`)
