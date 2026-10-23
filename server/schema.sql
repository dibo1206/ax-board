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
