-- 농가 판매 자사몰 DB 구조. 실습서버 PostgreSQL의 farm 스키마에 만든다 (수업 실습 ideas 테이블과 분리).
CREATE SCHEMA IF NOT EXISTS farm;
SET search_path TO farm;

-- 판매 농가 (지금은 회사가 대신 등록, 나중에 샵인샵으로 커질 때를 대비해 분리)
CREATE TABLE IF NOT EXISTS sellers (
  seller_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  intro TEXT,
  story TEXT,
  is_company BOOLEAN NOT NULL DEFAULT false,
  source TEXT
);

-- 품목 기준표 (식품팀 작성). 상품을 등록할 때 품목만 고르면 이 정보가 붙는다
CREATE TABLE IF NOT EXISTS items (
  item_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('과일', '채소', '가공품')),
  show_brix BOOLEAN NOT NULL DEFAULT false,
  storage_method TEXT,
  fresh_days_stage1 INTEGER,
  fresh_days_stage2 INTEGER,
  stage1_uses TEXT[],
  stage2_uses TEXT[],
  stage3_uses TEXT[],
  opened_note TEXT,
  allergens TEXT[],
  danger_signs TEXT[],
  recipes JSONB NOT NULL DEFAULT '[]',
  source TEXT,
  reviewed_by TEXT
);
-- 팀 식품 기준표(2026-10-31): 신선도는 날짜가 아니라 상태로 나눈다 (신선 → 품질 저하 → 섭취 부적합)
-- 보관 기간은 품질 유지 참고값일 뿐이라 따로 적고, 먹으면 안 되는 신호의 예외(단순 갈변 등)도 함께 적는다
ALTER TABLE items ADD COLUMN IF NOT EXISTS stage1_state TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS stage2_state TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS keep_period TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS danger_note TEXT;
-- 가공식품 기준표(2026-11-02): 알레르기 안내 문장과 카페 메뉴 비율 (B2B, 공식 표준이 아닌 시험 제조 제안값)
ALTER TABLE items ADD COLUMN IF NOT EXISTS allergen_note TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS cafe_note TEXT;
-- 새 품목 요청(server/items.js): 판매자가 목록에 없는 품목을 요청하면 'pending'. 관리자가 출처를 적고 검수해야 'active'
-- 검수 전 품목의 보관·안전 정보는 손님 화면·상담에 내보내지 않는다
ALTER TABLE items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE items ADD CONSTRAINT items_status_check CHECK (status IN ('active', 'pending'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS requested_by TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 추천·검색용 태그 목록
CREATE TABLE IF NOT EXISTS tags (
  tag_code TEXT PRIMARY KEY,
  tag_group TEXT NOT NULL,
  label TEXT NOT NULL
);

-- 상품. 품절은 따로 저장하지 않고 stock = 0 이면 품절로 계산한다
CREATE TABLE IF NOT EXISTS products (
  product_code TEXT PRIMARY KEY,
  seller_code TEXT NOT NULL REFERENCES sellers(seller_code),
  item_code TEXT NOT NULL REFERENCES items(item_code),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  unit TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  weight_g INTEGER,
  count_per_box INTEGER,
  brix NUMERIC(4, 1),
  brix_measured_at DATE,
  harvest_date DATE,
  summary TEXT,
  external_url TEXT,
  b2b_available BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active')),
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2단계: 상품 사진 경로
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 상품 Q&A
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  product_code TEXT NOT NULL REFERENCES products(product_code),
  author TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  UNIQUE (product_code, question)
);

-- 기업(B2B) 대량 구매 문의
CREATE TABLE IF NOT EXISTS b2b_inquiries (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  product_code TEXT REFERENCES products(product_code),
  quantity INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT '접수' CHECK (status IN ('접수', '확인', '완료')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4단계: 질문 연락처(관리자만 봄)·숨김, 기업 문의 개인정보 동의 시각
ALTER TABLE questions ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE b2b_inquiries ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMPTZ;

-- AI 상담 기록 (못 답한 질문을 모아 FAQ를 보강하는 데 쓴다)
CREATE TABLE IF NOT EXISTS chat_logs (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT,
  sources TEXT[],
  handed_off BOOLEAN NOT NULL DEFAULT false,
  blocked BOOLEAN NOT NULL DEFAULT false,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 관리자 (비밀번호는 해시로만 저장)
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  login_id TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 판매자 화면: 계정은 관리자(admin)와 농가 판매자(seller) 두 종류. 판매자는 자기 농가(seller_code) 것만 다룬다
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS seller_code TEXT REFERENCES sellers(seller_code);
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
  CHECK ((role = 'admin' AND seller_code IS NULL) OR (role = 'seller' AND seller_code IS NOT NULL));
-- 판매자가 올린 새 상품은 '검토 대기(pending)' → 관리자 승인 시 판매(active). 반려하면 사유를 남긴다
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('draft', 'pending', 'active'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_note TEXT;

-- API 아끼기: 하루 전체 AI 호출 수(상한 확인용)와 같은 질문의 답 저장
CREATE TABLE IF NOT EXISTS ai_usage (
  day DATE PRIMARY KEY,
  calls INT NOT NULL DEFAULT 0
);
-- key = 질문 + AI에게 준 자료의 해시. 상품 정보가 바뀌면 자료가 달라져 key도 달라진다
CREATE TABLE IF NOT EXISTS chat_cache (
  key TEXT PRIMARY KEY,
  reply JSONB NOT NULL,
  model TEXT,
  hits INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 벡터 검색 자료 (server/rag.js 가 상품·품목·Q&A·정책에서 만든다. 지워도 다시 만들어진다)
CREATE TABLE IF NOT EXISTS rag_chunks (
  key TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  item_code TEXT,
  product_code TEXT,
  trusted BOOLEAN NOT NULL DEFAULT false,
  embedding REAL[] NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7단계: 자체 주문·결제 (토스페이먼츠). 금액은 서버가 DB 가격으로 계산하고, 결제 승인 때 다시 확인한다
-- 상태: pending(결제 전, 재고 잡아 둠) → paid → preparing → shipping → delivered
--       pending → failed / expired(15분 지나면 재고 돌려놓음), paid·preparing → cancelled(결제 취소·재고 복구)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'preparing', 'shipping', 'delivered', 'cancelled', 'failed', 'expired')),
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  zipcode TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT,
  memo TEXT,
  items_amount INT NOT NULL CHECK (items_amount > 0),
  shipping_fee INT NOT NULL CHECK (shipping_fee >= 0),
  total_amount INT NOT NULL CHECK (total_amount > 0),
  payment_key TEXT,
  payment_method TEXT,
  paid_at TIMESTAMPTZ,
  courier TEXT,
  tracking_no TEXT,
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  fail_reason TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  agreed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at);

-- 주문 당시의 상품 이름·가격을 그대로 남긴다 (나중에 상품 가격이 바뀌어도 주문 내역은 그대로)
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL REFERENCES products(product_code),
  seller_code TEXT NOT NULL REFERENCES sellers(seller_code),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price INT NOT NULL CHECK (price > 0),
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  subtotal INT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_seller_idx ON order_items (seller_code);

-- 관리자 페이지 보호: 2단계 인증 비밀값(암호화해서 저장), 같은 코드를 두 번 못 쓰게 마지막으로 쓴 시간칸
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT NOT NULL DEFAULT 0;
-- 비밀번호·2단계 인증을 바꾸면 1 올린다 → 그 전에 받은 로그인 쿠키는 모두 끊긴다
ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;

-- 관리자·판매자 접속 기록 (개인정보 안전성 확보조치: 계정·일시·IP·한 일을 1년 이상 보관). 요청 내용(본문)은 남기지 않는다
CREATE TABLE IF NOT EXISTS access_logs (
  id BIGSERIAL PRIMARY KEY,
  login_id TEXT,
  role TEXT,
  action TEXT NOT NULL,
  method TEXT,
  path TEXT,
  status INT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_logs_created_idx ON access_logs (created_at DESC);

-- 손님 회원 (비회원 주문도 그대로 받는다). 비밀번호는 해시로만, 탈퇴하면 개인정보를 지우고 주문 기록은 법정 기간 보관
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  zipcode TEXT,
  address1 TEXT,
  address2 TEXT,
  session_version INT NOT NULL DEFAULT 1, -- 비밀번호를 바꾸거나 탈퇴하면 올려서 예전 로그인을 모두 끊는다
  agreed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_email TEXT;
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);

-- 비밀번호 찾기: 메일로 보낸 링크의 토큰은 해시만 저장, 30분 유효, 한 번만 사용
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- 보낼 메일 목록: 먼저 여기에 저장하고 보낸다. 실패하면 정리 때 다시 보낸다 (메일 서버가 잠깐 끊겨도 알림이 사라지지 않게)
CREATE TABLE IF NOT EXISTS email_outbox (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox (status, created_at);

-- 구매 후기: 배송 완료된 주문의 상품만, 주문·상품마다 한 번. 공개 화면에는 이름 첫 글자만
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL REFERENCES products(product_code),
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  author TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  reply TEXT,
  replied_at TIMESTAMPTZ,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_code)
);
CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (product_code, created_at DESC);

-- 신상품순 정렬용 등록 시각, 상품 찾기·주문 집계용 색인
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS products_status_item_idx ON products (status, item_code);
CREATE INDEX IF NOT EXISTS products_seller_idx ON products (seller_code);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_code);
CREATE INDEX IF NOT EXISTS questions_product_idx ON questions (product_code, created_at DESC);

-- 상품 상세: 긴 설명(글만, HTML 아님)과 사진 여러 장(최대 8장). 대표 사진은 image_url
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';

-- 상품 상세: 자주 묻는 질문(AI 초안 → 판매자 검토 후 저장), 가격 기준일(가격을 바꾼 날)
ALTER TABLE products ADD COLUMN IF NOT EXISTS faq JSONB NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ;
UPDATE products SET price_updated_at = COALESCE(updated_at, created_at, now()) WHERE price_updated_at IS NULL;
ALTER TABLE products ALTER COLUMN price_updated_at SET DEFAULT now();

-- 구매 확정: 배송 완료 7일 뒤 자동 (손님이 먼저 눌러도 됨). 판매자 정산 기준
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_confirm_idx ON orders (status, confirmed_at);

-- 농가별 배송: 한 주문에 여러 농가 상품이 있으면 농가마다 따로 택배를 보낸다 → 배송비·송장·배송 상태가 농가마다
-- 주문 전체 상태(orders.status)는 농가별 상태를 모아 정한다 (모두 배송 완료면 배송 완료, 하나라도 보냈으면 배송 중)
CREATE TABLE IF NOT EXISTS order_shipments (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seller_code TEXT NOT NULL REFERENCES sellers(seller_code),
  items_amount INT NOT NULL DEFAULT 0,
  shipping_fee INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'preparing', 'shipping', 'delivered', 'cancelled')),
  courier TEXT,
  tracking_no TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seller_code)
);
CREATE INDEX IF NOT EXISTS order_shipments_seller_idx ON order_shipments (seller_code, status);

-- 판매자 가입: 스스로 신청 → 관리자 승인 후 활동 (기존 농가는 active). 관리자 계정은 가입으로 만들 수 없다
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check;
ALTER TABLE sellers ADD CONSTRAINT sellers_status_check CHECK (status IN ('active', 'pending', 'rejected'));
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_no TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS reject_note TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- 개인정보 저장 암호화 (server/pii.js): 암호문으로는 찾을 수 없어서 찾기용 HMAC 을 따로 둔다. 비교와 중복 검사는 이 칸으로 한다
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_no_hash TEXT;
DROP INDEX IF EXISTS sellers_business_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS sellers_business_no_hash_key ON sellers (business_no_hash);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_hash TEXT; -- 탈퇴하면 비운다
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_hash_key ON customers (email_hash);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_phone_hash TEXT;
CREATE INDEX IF NOT EXISTS orders_buyer_phone_hash_idx ON orders (buyer_phone_hash, created_at);
-- 상품 자동 승인: 관리자가 승인한 개수로 믿을 만한 농가를 가리고, 바로 판매한 상품은 관리자가 나중에 확인한다
ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_approved_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_checked_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- 거짓 표시 막기 (당도·수확일은 판매자가 적는 값이라 몰이 직접 잴 수 없다 → 쓰기 어렵게, 이상하면 거르고, 거짓이면 드러나게)
-- 1) 당도계 사진: 당도를 적은 판매자 상품은 사진이 있어야 승인. 판매 중에 당도를 바꾸면 옛 사진은 내린다
ALTER TABLE products ADD COLUMN IF NOT EXISTS brix_photo_url TEXT;
-- 상품정보 제공 고시: 판매자가 적는 칸 (원산지·소비기한 등, server/notice.js)
ALTER TABLE products ADD COLUMN IF NOT EXISTS notice JSONB NOT NULL DEFAULT '{}';
-- 2) 품목별 보통 당도 범위 (식품 담당이 출처를 보고 채운다. 비어 있으면 검사하지 않음)
ALTER TABLE items ADD COLUMN IF NOT EXISTS brix_min NUMERIC(4, 1);
ALTER TABLE items ADD COLUMN IF NOT EXISTS brix_max NUMERIC(4, 1);
-- 당도 등급 기준 (품종별 높은 당도·매우높은 당도, server/brix.js). 비어 있으면 등급 없이 측정값만 보여 준다
ALTER TABLE items ADD COLUMN IF NOT EXISTS brix_standards JSONB NOT NULL DEFAULT '[]';
ALTER TABLE items ADD COLUMN IF NOT EXISTS brix_standard_source TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variety TEXT; -- 품종: 품목 기준에서 고른다. 기타면 등급 없음
-- 3) 판매 중 상품의 가격·당도·수확일 수정 이력 (누가 언제 무엇을)
CREATE TABLE IF NOT EXISTS product_changes (
  id SERIAL PRIMARY KEY,
  product_code TEXT NOT NULL REFERENCES products(product_code) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_changes_idx ON product_changes (product_code, changed_at DESC);
-- 4) 후기: 상품 페이지의 당도·수확일 같은 정보와 맞았는지 (yes / no / 비움). '달랐어요'가 많으면 당도 표시를 내린다
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS info_match TEXT;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_info_match_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_info_match_check CHECK (info_match IN ('yes', 'no'));

-- 금지어 사전 (관리자 화면 [금지어]에서 고침). 기본 단어는 표가 비어 있을 때 한 번만 넣는다 (지운 단어가 다시 생기지 않게)
CREATE TABLE IF NOT EXISTS banned_words (
  word TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('효능', '욕설', '광고', '기타')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO banned_words (word, kind)
SELECT w, k FROM (VALUES
  ('면역력', '효능'), ('다이어트', '효능'), ('치료', '효능'), ('예방', '효능'), ('해독', '효능'), ('항암', '효능'),
  ('혈압', '효능'), ('혈당', '효능'), ('기관지', '효능'), ('피로회복', '효능'), ('숙취해소', '효능'), ('변비', '효능'),
  ('씨발', '욕설'), ('시발', '욕설'), ('병신', '욕설'), ('개새끼', '욕설'), ('지랄', '욕설'),
  ('오픈채팅', '광고'), ('텔레그램', '광고'), ('바카라', '광고'), ('카지노', '광고'), ('수익보장', '광고'), ('대출문의', '광고')
) AS v(w, k)
WHERE NOT EXISTS (SELECT 1 FROM banned_words);


-- 판매 옵션 (예: 같은 사과를 5kg·10kg 로). 옵션마다 이름·가격·재고가 따로 있다. 옵션이 없는 상품은 지금처럼 상품 가격·재고로 판다
-- 옵션이 하나라도 있는 상품은 옵션을 골라야 살 수 있고, products.price·stock 은 판매 중 옵션의 최저가·재고 합으로 맞춰 둔다 (server/options.js)
-- 주문 기록이 있는 옵션은 지우지 않고 판매 중지(stopped)로 내린다 (order_items 가 참조해서 지울 수도 없다)
CREATE TABLE IF NOT EXISTS product_options (
  id SERIAL PRIMARY KEY,
  product_code TEXT NOT NULL REFERENCES products(product_code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_code, name)
);
-- 주문 줄에 고른 옵션과 그때의 옵션 이름을 남긴다 (가격은 price 칸에 그때 옵션 가격). 옵션 없는 주문은 비어 있다
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS option_id INT REFERENCES product_options(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS option_name TEXT;
CREATE INDEX IF NOT EXISTS order_items_option_idx ON order_items (option_id) WHERE option_id IS NOT NULL;

-- 농가별 부분 취소와 반품 (2026-11-04)
-- 반품 신청: 배송 완료된 농가 배송 한 건에 손님이 사유와 함께 신청한다. 신청(requested) → 승인(approved) → 환불 완료(refunded), 또는 거절(rejected)
-- 신청만으로는 돈이 나가지 않는다. 관리자가 승인하고 환불 금액을 확인한 뒤 눌러야 토스 취소가 실행된다 (판매자는 의견만 남긴다)
-- items: 돌려보낼 주문 줄 [{ item_id, name, option_name, unit, price, quantity }] (주문 당시 값 그대로). reason 은 손님이 쓴 글이라 암호화해서 저장 (server/pii.js)
CREATE TABLE IF NOT EXISTS order_returns (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seller_code TEXT NOT NULL REFERENCES sellers(seller_code),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'refunded')),
  reason_type TEXT NOT NULL CHECK (reason_type IN ('change_mind', 'defect', 'wrong_item')),
  reason TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  requested_by TEXT NOT NULL,
  seller_note TEXT,
  seller_noted_by TEXT,
  seller_noted_at TIMESTAMPTZ,
  admin_note TEXT, -- 승인 메모·거절 사유 (손님에게 보인다)
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  refund_amount INT,
  refunded_by TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 한 농가 배송에 진행 중인 반품은 하나만 (같은 신청을 두 번 보내도 하나만 생긴다)
CREATE UNIQUE INDEX IF NOT EXISTS order_returns_open_key ON order_returns (order_id, seller_code) WHERE status IN ('requested', 'approved');
CREATE INDEX IF NOT EXISTS order_returns_status_idx ON order_returns (status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_returns_seller_idx ON order_returns (seller_code, created_at DESC);

-- 돌려준 돈 기록: 토스 결제 취소 한 번이 한 줄 (누가 언제 얼마를). 매출·정산은 결제 금액에서 이 금액을 뺀다
-- kind: cancel(아직 안 보낸 농가 몫 부분 취소) · return(반품 환불) · full(주문 전체 취소)
-- status: requested(토스에 보냈고 결과를 아직 모름 — 같은 멱등키로 다시 확인) → done / failed(확실히 실패, 돈이 나가지 않음)
-- 같은 대상(농가 배송·반품 신청)에는 끝났거나 결과를 기다리는 기록이 하나만 있을 수 있다 → 같은 요청이 두 번 와도 돈은 한 번만 나간다
CREATE TABLE IF NOT EXISTS order_refunds (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seller_code TEXT REFERENCES sellers(seller_code),
  return_id INT REFERENCES order_returns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'return', 'full')),
  amount INT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done', 'failed')),
  idempotency_key TEXT UNIQUE NOT NULL,
  reason TEXT,
  processed_by TEXT NOT NULL,
  fail_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON order_refunds (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_cancel_key ON order_refunds (order_id, seller_code) WHERE kind = 'cancel' AND status IN ('requested', 'done');
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_return_key ON order_refunds (return_id) WHERE kind = 'return' AND status IN ('requested', 'done');
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_full_key ON order_refunds (order_id) WHERE kind = 'full' AND status IN ('requested', 'done');

-- 예약 판매 (2026-11-06): 상품의 출고 시작일. 오늘보다 뒤면 예약 상품이다.
-- 주문할 때 그 날짜를 주문 상품과 농가 배송에 함께 남긴다 (농가가 나중에 날짜를 바꿔도 손님에게 약속한 날짜가 남게)
ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_from DATE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ship_from DATE;
ALTER TABLE order_shipments ADD COLUMN IF NOT EXISTS ship_from DATE;

-- 재입고 알림 (2026-11-07): 품절 상품·옵션에 남긴 이메일 (암호화). 다시 들어오면 한 번 알리고 notified_at 을 남긴다.
-- 같은 상품·옵션·이메일은 알림 전까지 하나만. 보낸 신청은 30일, 못 보낸 신청은 180일 뒤 지운다 (server/restock.js)
CREATE TABLE IF NOT EXISTS restock_requests (
  id SERIAL PRIMARY KEY,
  product_code TEXT NOT NULL REFERENCES products(product_code) ON DELETE CASCADE,
  option_id INT REFERENCES product_options(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS restock_requests_once ON restock_requests (product_code, (COALESCE(option_id, 0)), email_hash) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS restock_requests_waiting ON restock_requests (product_code) WHERE notified_at IS NULL;
-- 신청 확인 메일의 취소 링크 (토큰은 해시만 저장)
ALTER TABLE restock_requests ADD COLUMN IF NOT EXISTS cancel_token_hash TEXT;
CREATE INDEX IF NOT EXISTS restock_requests_cancel ON restock_requests (cancel_token_hash) WHERE cancel_token_hash IS NOT NULL;

-- 간편 로그인 (2026-11-07): 카카오·네이버 회원 번호는 그대로 두지 않고 찾기용 HMAC(lookupHash)만 저장한다 (server/oauth.js)
CREATE TABLE IF NOT EXISTS customer_identities (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('kakao', 'naver')),
  provider_user_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_hash),
  UNIQUE (customer_id, provider)
);

-- 상품 문의 비밀글·회원 연결·답변 알림 (2026-11). 비밀글은 쓴 회원·판매 농가·관리자만 본다
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_seen_at TIMESTAMPTZ;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_mailed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS questions_customer_idx ON questions (customer_id) WHERE customer_id IS NOT NULL;

-- 회사 콘텐츠 (2026-11-08): 상품 상세 이미지(세로로 긴 상세페이지), 공지사항·언론보도 게시판 (server/posts.js)
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_images TEXT[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'press')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  image_url TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  popup BOOLEAN NOT NULL DEFAULT false,
  popup_until DATE,
  hidden BOOLEAN NOT NULL DEFAULT false,
  author TEXT,
  seed_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_list_idx ON posts (kind, pinned DESC, created_at DESC);
