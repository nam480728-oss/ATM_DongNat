-- database/schema.sql  –  chạy trên database atm_db
USE atm_db;
SET NAMES utf8mb4;

-- 1. Người dùng
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name            VARCHAR(100)     NOT NULL,
  account_number  VARCHAR(19)      NOT NULL,
  total_received  BIGINT UNSIGNED  NOT NULL DEFAULT 0,      -- tổng tiền đã chuyển khoản (VNĐ)
  total_donated   BIGINT UNSIGNED  NOT NULL DEFAULT 0,      -- tổng tiền đã góp quỹ từ thiện (VNĐ)
  is_active       TINYINT(1)       NOT NULL DEFAULT 1,      -- 0 = đã xóa (xóa mềm)
  created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_account_number (account_number),
  KEY idx_users_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Giao dịch (mỗi lần bấm TÍNH TIỀN hoặc mỗi vật bỏ qua lỗ = 1 dòng)
CREATE TABLE IF NOT EXISTS transactions (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED     NULL,                     -- NULL = khách bỏ qua lỗ khi chưa chọn tên
  source         ENUM('tray','slot') NOT NULL DEFAULT 'tray', -- khay nạp | lỗ bỏ từng chai/lon
  bottles        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  cans           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  price_bottle   INT UNSIGNED     NOT NULL,                 -- giá tại thời điểm giao dịch
  price_can      INT UNSIGNED     NOT NULL,
  amount         INT UNSIGNED     NOT NULL DEFAULT 0,       -- 0 nếu bị trả rác / khách
  payout         ENUM('transfer','charity') NULL,           -- NULL = chưa chọn (hoặc không có tiền)
  paid_at        DATETIME         NULL,
  status         ENUM('accepted','rejected','empty','scan_failed') NOT NULL,
  scan_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 1,       -- số lần quét (do rung lại)
  image_path     VARCHAR(255)     NULL,                     -- ảnh quét toàn mặt rung
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user_created (user_id, created_at),
  KEY idx_tx_status (status),
  KEY idx_tx_payout (payout),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Vật không hợp lệ trong giao dịch bị trả rác (ảnh cắt hiện lên màn hình)
CREATE TABLE IF NOT EXISTS rejected_items (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  transaction_id  BIGINT UNSIGNED  NOT NULL,
  label           VARCHAR(50)      NOT NULL,                -- tên lớp model trả về
  confidence      DECIMAL(5,4)     NOT NULL,
  bbox_x1 INT NOT NULL, bbox_y1 INT NOT NULL, bbox_x2 INT NOT NULL, bbox_y2 INT NOT NULL,
  crop_path       VARCHAR(255)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ri_tx (transaction_id),
  CONSTRAINT fk_ri_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Trạng thái trạm (1 dòng duy nhất, sau này nhiều trạm thì thêm dòng)
CREATE TABLE IF NOT EXISTS station (
  id                TINYINT UNSIGNED NOT NULL,
  name              VARCHAR(100)     NOT NULL DEFAULT 'ATM Đồng Nát',
  storage_count     INT UNSIGNED     NOT NULL DEFAULT 0,
  storage_capacity  INT UNSIGNED     NOT NULL DEFAULT 300,
  is_full           TINYINT(1)       NOT NULL DEFAULT 0,
  last_emptied_at   DATETIME         NULL,
  updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Cấu hình (giá, timeout...) – admin sửa được
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(50)   NOT NULL,
  `value`     VARCHAR(255)  NOT NULL,
  description VARCHAR(255)  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu khởi tạo
INSERT IGNORE INTO station (id, name, storage_capacity) VALUES (1, 'ATM Đồng Nát', 300);
INSERT IGNORE INTO settings (`key`, `value`, description) VALUES
  ('price_bottle',        '200', 'Giá 1 chai nhựa (VNĐ)'),
  ('price_can',           '300', 'Giá 1 lon nhôm (VNĐ)'),
  ('idle_timeout_sec',    '120', 'Tự đăng xuất khi không thao tác (giây)'),
  ('max_vibrate_retries', '2',   'Số lần rung lại tối đa khi vật đè nhau'),
  ('payout_timeout_sec',  '30',  'Tự chuyển khoản nếu không chọn (giây)');

-- Database tạo từ bản cũ: chạy  python tools/migrate.py  để nâng cấp
