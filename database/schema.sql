-- database/schema.sql  –  chạy trên database atm_db (CSDL trung tâm dùng chung cho mọi trạm)
-- Database tạo từ bản cũ: chạy  python tools/migrate.py  để nâng cấp
USE atm_db;
SET NAMES utf8mb4;

-- 1. Trạm (mỗi trạm 1 dòng; mô phỏng mở trạm bằng /?station=<id>)
CREATE TABLE IF NOT EXISTS station (
  id                TINYINT UNSIGNED NOT NULL,
  code              VARCHAR(12)      NULL,                     -- mã trạm theo tỉnh, vd DNG-001 (cấp khi tạo, không đổi)
  name              VARCHAR(100)     NOT NULL DEFAULT 'ATM Đồng Nát',
  address           VARCHAR(200)     NULL,                     -- số nhà, đường
  ward              VARCHAR(100)     NULL,                     -- phường / xã
  province          CHAR(3)          NULL,                     -- mã tỉnh / thành (app/services/station_service.py)
  lat               DECIMAL(9,6)     NULL,
  lng               DECIMAL(9,6)     NULL,
  is_active         TINYINT(1)       NOT NULL DEFAULT 1,
  storage_count     INT UNSIGNED     NOT NULL DEFAULT 0,
  storage_capacity  INT UNSIGNED     NOT NULL DEFAULT 300,
  is_full           TINYINT(1)       NOT NULL DEFAULT 0,
  bin_bottle        INT UNSIGNED     NOT NULL DEFAULT 0,       -- số vật trong thùng chai / lon / khác
  bin_can           INT UNSIGNED     NOT NULL DEFAULT 0,
  bin_other         INT UNSIGNED     NOT NULL DEFAULT 0,
  public_left       INT UNSIGNED     NOT NULL DEFAULT 0,       -- 2 thùng rác mini hai bên
  public_right      INT UNSIGNED     NOT NULL DEFAULT 0,
  last_emptied_at   DATETIME         NULL,
  updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_station_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Người dùng (định danh bằng số điện thoại, dùng chung mọi trạm; KHÔNG lưu số tài khoản ngân hàng)
CREATE TABLE IF NOT EXISTS users (
  id                  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  phone               VARCHAR(15)      NOT NULL,
  name                VARCHAR(100)     NOT NULL,
  balance             BIGINT UNSIGNED  NOT NULL DEFAULT 0,  -- tiền chờ chọn (hết giờ không bấm nút nào)
  total_received      BIGINT UNSIGNED  NOT NULL DEFAULT 0,  -- tổng đã chuyển khoản (VNĐ)
  total_donated       BIGINT UNSIGNED  NOT NULL DEFAULT 0,  -- tổng đã góp từ thiện
  total_voucher       BIGINT UNSIGNED  NOT NULL DEFAULT 0,  -- tổng đã đổi voucher
  is_active           TINYINT(1)       NOT NULL DEFAULT 1,  -- 0 = bị khóa
  created_station_id  TINYINT UNSIGNED NULL,
  last_station_id     TINYINT UNSIGNED NULL,
  created_at          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at        DATETIME         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Cửa hàng / nhà xe nhận voucher (đăng nhập trang /shop bằng mã + PIN)
CREATE TABLE IF NOT EXISTS merchants (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)   NOT NULL,
  name        VARCHAR(100)  NOT NULL,
  kind        VARCHAR(20)   NOT NULL DEFAULT 'shop',        -- shop | parking | other
  address     VARCHAR(200)  NULL,
  pin_hash    VARCHAR(255)  NOT NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  is_demo     TINYINT(1)    NOT NULL DEFAULT 0,             -- cửa hàng demo trong mô phỏng 3D (vào không cần PIN)
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_merchants_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Voucher QR (dùng 1 lần, có hạn)
CREATE TABLE IF NOT EXISTS vouchers (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code         VARCHAR(16)      NOT NULL,
  user_id      INT UNSIGNED     NULL,
  station_id   TINYINT UNSIGNED NOT NULL,
  amount       INT UNSIGNED     NOT NULL,
  status       ENUM('active','used','void') NOT NULL DEFAULT 'active',
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME         NOT NULL,
  used_at      DATETIME         NULL,
  merchant_id  INT UNSIGNED     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vouchers_code (code),
  KEY idx_vouchers_user (user_id),
  KEY idx_vouchers_status (status),
  CONSTRAINT fk_v_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_v_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Lần nhận tiền (chuyển khoản / từ thiện / voucher). Chuyển khoản chỉ ghi ngân hàng + 4 số cuối STK.
CREATE TABLE IF NOT EXISTS payouts (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED     NULL,
  station_id     TINYINT UNSIGNED NOT NULL,
  method         ENUM('transfer','charity','voucher') NOT NULL,
  amount         INT UNSIGNED     NOT NULL,
  bank           VARCHAR(50)      NULL,
  account_last4  VARCHAR(4)       NULL,
  voucher_id     BIGINT UNSIGNED  NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_po_user (user_id),
  KEY idx_po_station_created (station_id, created_at),
  CONSTRAINT fk_po_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_po_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Giao dịch (mỗi lần quét khay hoặc mỗi vật bỏ qua lỗ từ thiện = 1 dòng)
CREATE TABLE IF NOT EXISTS transactions (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  station_id     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  user_id        INT UNSIGNED     NULL,                     -- NULL = khách (lỗ từ thiện) / người dùng đã xóa
  source         ENUM('tray','slot') NOT NULL DEFAULT 'tray',
  bottles        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  cans           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  price_bottle   INT UNSIGNED     NOT NULL,
  price_can      INT UNSIGNED     NOT NULL,
  amount         INT UNSIGNED     NOT NULL DEFAULT 0,
  payout         ENUM('transfer','charity','voucher','held') NULL,   -- held = giữ vào số dư
  payout_id      BIGINT UNSIGNED  NULL,
  paid_at        DATETIME         NULL,
  status         ENUM('accepted','rejected','empty','scan_failed') NOT NULL,
  scan_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  image_path     VARCHAR(255)     NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user_created (user_id, created_at),
  KEY idx_tx_station_created (station_id, created_at),
  KEY idx_tx_status (status),
  KEY idx_tx_payout (payout),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tx_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Vật không hợp lệ trong giao dịch bị trả rác
CREATE TABLE IF NOT EXISTS rejected_items (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  transaction_id  BIGINT UNSIGNED  NOT NULL,
  label           VARCHAR(50)      NOT NULL,
  confidence      DECIMAL(5,4)     NOT NULL,
  bbox_x1 INT NOT NULL, bbox_y1 INT NOT NULL, bbox_x2 INT NOT NULL, bbox_y2 INT NOT NULL,
  crop_path       VARCHAR(255)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ri_tx (transaction_id),
  CONSTRAINT fk_ri_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7b. Sản phẩm của cửa hàng + đơn bán ở quầy (voucher trừ trước, thiếu thì tiền mặt)
CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  merchant_id  INT UNSIGNED  NOT NULL,
  name         VARCHAR(100)  NOT NULL,
  price        INT UNSIGNED  NOT NULL,
  category     VARCHAR(30)   NOT NULL DEFAULT 'khac',
  icon         VARCHAR(8)    NULL,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order   INT           NOT NULL DEFAULT 0,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_merchant (merchant_id),
  CONSTRAINT fk_pr_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchant_id     INT UNSIGNED    NOT NULL,
  voucher_id      BIGINT UNSIGNED NULL,
  total           INT UNSIGNED    NOT NULL,
  voucher_amount  INT UNSIGNED    NOT NULL DEFAULT 0,
  voucher_lost    INT UNSIGNED    NOT NULL DEFAULT 0,
  cash_amount     INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_merchant_created (merchant_id, created_at),
  CONSTRAINT fk_or_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_or_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  order_id    BIGINT UNSIGNED  NOT NULL,
  product_id  INT UNSIGNED     NULL,
  name        VARCHAR(100)     NOT NULL,
  price       INT UNSIGNED     NOT NULL,
  qty         SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_oi_order (order_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Sự cố an ninh (camera giám sát trên màn hình trạm)
CREATE TABLE IF NOT EXISTS security_events (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  station_id   TINYINT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED     NULL,                       -- người đang đăng nhập lúc xảy ra (nếu có)
  kind         ENUM('reject_repeat','impact','tamper','camera_blocked') NOT NULL,
  detail       VARCHAR(255)     NULL,
  image_path   VARCHAR(255)     NULL,
  before_path  VARCHAR(255)     NULL,                       -- che camera: ảnh cuối trước khi bị che
  status       ENUM('new','seen','resolved') NOT NULL DEFAULT 'new',
  note         VARCHAR(255)     NULL,
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME         NULL,
  PRIMARY KEY (id),
  KEY idx_se_station_created (station_id, created_at),
  KEY idx_se_status (status),
  CONSTRAINT fk_se_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Cấu hình chung (giá, timeout...) – admin sửa được
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(50)   NOT NULL,
  `value`     VARCHAR(255)  NOT NULL,
  description VARCHAR(255)  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu khởi tạo
-- 3 trạm mẫu trên đường ven biển (địa chỉ / tọa độ là dữ liệu mẫu, sửa ở trang admin)
INSERT IGNORE INTO station (id, code, name, address, ward, province, lat, lng, storage_capacity) VALUES
  (1, 'DNG-001', 'ATM Đồng Nát – Trạm 1', 'Đường Võ Nguyên Giáp (cổng bãi tắm số 1)', 'Phường An Hải', 'DNG', 16.061200, 108.247600, 300),
  (2, 'DNG-002', 'ATM Đồng Nát – Trạm 2', 'Đường Võ Nguyên Giáp (cổng bãi tắm số 2)', 'Phường An Hải', 'DNG', 16.059400, 108.247900, 300),
  (3, 'DNG-003', 'ATM Đồng Nát – Trạm 3', 'Đường Võ Nguyên Giáp (cổng bãi tắm số 3)', 'Phường An Hải', 'DNG', 16.057600, 108.248200, 300);
INSERT IGNORE INTO settings (`key`, `value`, description) VALUES
  ('price_bottle',        '200', 'Giá 1 chai nhựa (VNĐ)'),
  ('price_can',           '300', 'Giá 1 lon nhôm (VNĐ)'),
  ('idle_timeout_sec',    '120', 'Tự đăng xuất khi không thao tác (giây)'),
  ('max_vibrate_retries', '2',   'Số lần rung lại tối đa khi vật đè nhau'),
  ('payout_timeout_sec',  '60',  'Hết giờ không chọn thì giữ tiền vào số dư (giây)'),
  ('voucher_days',        '30',  'Hạn dùng voucher (ngày)'),
  ('public_capacity',     '30',  'Sức chứa mỗi thùng rác mini (vật)'),
  ('security_reject_session', '3', 'An ninh: số lần bỏ rác lạ trong 1 phiên thì báo admin'),
  ('security_reject_day',     '5', 'An ninh: số lần bỏ rác lạ trong 24 giờ (cùng SĐT) thì báo admin'),
  ('security_cooldown_sec',   '30', 'An ninh: cùng loại sự cố ở 1 trạm chỉ báo lại sau bấy nhiêu giây');
