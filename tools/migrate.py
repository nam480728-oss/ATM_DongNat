"""Nâng cấp cấu trúc database atm_db lên bản mới nhất (chạy lại nhiều lần vẫn an toàn).

Chạy:  python tools/migrate.py

002 – Chuyển khoản / từ thiện + lỗ bỏ chai:
  users.balance -> users.total_received, thêm users.total_donated
  transactions.user_id cho phép NULL (khách bỏ qua lỗ khi chưa chọn tên)
  transactions.source ('tray' | 'slot'), transactions.payout ('transfer' | 'charity'), transactions.paid_at
  settings.payout_timeout_sec

003 – Hệ sinh thái nhiều trạm + đăng nhập bằng số điện thoại + voucher:
  station: address, is_active, bin_* / public_* (chuyển từ bảng settings sang từng trạm), thêm trạm 2
  bảng mới: merchants, vouchers, payouts
  transactions: station_id, payout_id, payout thêm 'voucher' | 'held', xóa user -> user_id = NULL
  users: XÓA TOÀN BỘ người dùng cũ (giao dịch giữ lại, ẩn danh), bỏ cột account_number (không lưu STK),
         thêm phone (duy nhất), balance, total_voucher, created_station_id, last_station_id
  -> bước xóa người dùng cũ chỉ chạy khi thêm cờ:  python tools/migrate.py --delete-old-users
     (nên sao lưu trước:  python tools/backup_db.py)

004 – Mã trạm + địa chỉ chi tiết + camera an ninh + cửa hàng demo đối diện trạm (mô phỏng 3D):
  station: code (DNG-001 ...), ward, province, lat, lng; thêm trạm 3; điền mã / địa chỉ mẫu cho trạm chưa có
  merchants.is_demo; tạo cửa hàng demo PEACEMART (PIN 2468) nếu chưa có
  bảng mới: security_events; settings security_*

005 – Bán hàng ở quầy cửa hàng (nhân vật 3D vào PEACE Mart mua hàng, trả bằng voucher + tiền mặt):
  bảng mới: products, orders, order_items; thêm ~10 sản phẩm mẫu cho cửa hàng demo PEACEMART
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import Config  # noqa: E402


def columns(conn, table):
    rows = conn.execute(text(
        "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"), {"t": table}).all()
    return {r[0]: r[1] for r in rows}


def fks(conn, table):
    rows = conn.execute(text(
        "SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS "
        "WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = :t"), {"t": table}).all()
    return {r[0]: r[1] for r in rows}


def tables(conn):
    return {r[0] for r in conn.execute(text("SHOW TABLES"))}


NEW_TABLES = ("merchants", "vouchers", "payouts", "security_events", "products", "orders", "order_items")


def create_new_tables(conn) -> list[str]:
    """Tạo bảng mới (lấy đúng câu lệnh trong database/schema.sql)."""
    sql = (Path(__file__).resolve().parent.parent / "database" / "schema.sql").read_text(encoding="utf-8")
    have, done = tables(conn), []
    for name in NEW_TABLES:
        if name in have:
            continue
        start = sql.index(f"CREATE TABLE IF NOT EXISTS {name} (")
        conn.execute(text(sql[start:sql.index(";", start)]))
        done.append(f"bảng {name}")
    return done


def migrate_002(conn) -> list[str]:
    done = []
    u = columns(conn, "users")
    if "balance" in u and "total_received" not in u:
        conn.execute(text("ALTER TABLE users CHANGE balance total_received BIGINT UNSIGNED NOT NULL DEFAULT 0 "
                          "COMMENT 'tổng tiền đã chuyển khoản cho người dùng (VNĐ)'"))
        done.append("users.balance -> total_received")
    if "total_donated" not in columns(conn, "users"):
        conn.execute(text("ALTER TABLE users ADD COLUMN total_donated BIGINT UNSIGNED NOT NULL DEFAULT 0 "
                          "COMMENT 'tổng tiền người dùng góp quỹ từ thiện (VNĐ)' AFTER total_received"))
        done.append("users.total_donated")

    t = columns(conn, "transactions")
    if t.get("user_id") == "NO":
        conn.execute(text("ALTER TABLE transactions MODIFY user_id INT UNSIGNED NULL"))
        done.append("transactions.user_id NULL")
    if "source" not in t:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN source ENUM('tray','slot') NOT NULL DEFAULT 'tray' "
                          "AFTER user_id"))
        done.append("transactions.source")
    if "payout" not in t:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN payout ENUM('transfer','charity') NULL AFTER amount, "
                          "ADD COLUMN paid_at DATETIME NULL AFTER payout, ADD KEY idx_tx_payout (payout)"))
        done.append("transactions.payout, paid_at")
        n = conn.execute(text("UPDATE transactions SET payout = 'transfer', paid_at = created_at "
                              "WHERE status = 'accepted' AND amount > 0 AND user_id IS NOT NULL")).rowcount
        done.append(f"{n} giao dịch cũ -> đã chuyển khoản")

    r = conn.execute(text("INSERT IGNORE INTO settings (`key`, `value`, description) VALUES "
                          "('payout_timeout_sec', '60', 'Hết giờ không chọn thì giữ tiền vào số dư (giây)')"))
    if r.rowcount:
        done.append("settings.payout_timeout_sec")
    return done


def migrate_003(conn, delete_old_users: bool) -> list[str]:
    done = []
    # ---- users trước tiên: nếu còn người dùng cũ mà chưa cho xóa thì dừng, không đổi gì
    u = columns(conn, "users")
    if "phone" not in u:
        old = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if old and not delete_old_users:
            print(
                f"Có {old} người dùng cũ (lưu STK, chưa có số điện thoại). Bản mới XÓA toàn bộ người dùng cũ "
                "(giao dịch giữ lại, ẩn danh).\n  Sao lưu trước:  python tools/backup_db.py\n"
                "  rồi chạy:       python tools/migrate.py --delete-old-users")
            raise SystemExit(1)

    # ---- station: số liệu từng thùng chuyển từ settings sang từng trạm
    if "bin_bottle" not in columns(conn, "station"):
        conn.execute(text(
            "ALTER TABLE station ADD COLUMN address VARCHAR(200) NULL AFTER name, "
            "ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER address, "
            "ADD COLUMN bin_bottle INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_full, "
            "ADD COLUMN bin_can INT UNSIGNED NOT NULL DEFAULT 0 AFTER bin_bottle, "
            "ADD COLUMN bin_other INT UNSIGNED NOT NULL DEFAULT 0 AFTER bin_can, "
            "ADD COLUMN public_left INT UNSIGNED NOT NULL DEFAULT 0 AFTER bin_other, "
            "ADD COLUMN public_right INT UNSIGNED NOT NULL DEFAULT 0 AFTER public_left"))
        for k in ("bin_bottle", "bin_can", "bin_other", "public_left", "public_right"):
            v = conn.execute(text("SELECT value FROM settings WHERE `key` = :k"), {"k": k}).scalar()
            if v is not None:
                conn.execute(text(f"UPDATE station SET {k} = :v WHERE id = 1"), {"v": int(v)})
        conn.execute(text("DELETE FROM settings WHERE `key` IN "
                          "('bin_bottle','bin_can','bin_other','public_left','public_right')"))
        done.append("station.address, is_active, bin_*, public_* (chuyển từ settings)")
    if conn.execute(text("INSERT IGNORE INTO station (id, name, storage_capacity) "
                         "VALUES (2, 'ATM Đồng Nát – Trạm 2', 300)")).rowcount:
        done.append("thêm trạm 2")

    done += create_new_tables(conn)

    # ---- transactions
    t = columns(conn, "transactions")
    if "station_id" not in t:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN station_id TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER id, "
                          "ADD KEY idx_tx_station_created (station_id, created_at)"))
        done.append("transactions.station_id")
    if "payout_id" not in t:
        conn.execute(text("ALTER TABLE transactions MODIFY payout ENUM('transfer','charity','voucher','held') NULL, "
                          "ADD COLUMN payout_id BIGINT UNSIGNED NULL AFTER payout"))
        conn.execute(text("ALTER TABLE transactions ADD CONSTRAINT fk_tx_payout FOREIGN KEY (payout_id) "
                          "REFERENCES payouts(id) ON UPDATE CASCADE ON DELETE SET NULL"))
        done.append("transactions.payout_id, payout + voucher/held")
    rule = fks(conn, "transactions").get("fk_tx_user")
    if rule and rule != "SET NULL":
        conn.execute(text("ALTER TABLE transactions DROP FOREIGN KEY fk_tx_user"))
        conn.execute(text("ALTER TABLE transactions ADD CONSTRAINT fk_tx_user FOREIGN KEY (user_id) "
                          "REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL"))
        done.append("transactions.fk_tx_user ON DELETE SET NULL")

    # ---- users: đăng nhập bằng số điện thoại, không lưu STK
    if "phone" not in u:
        old = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if old:
            conn.execute(text("UPDATE transactions SET user_id = NULL WHERE user_id IS NOT NULL"))
            conn.execute(text("DELETE FROM users"))
            done.append(f"xóa {old} người dùng cũ (giao dịch giữ lại, ẩn danh)")
        if "account_number" in u:
            idx = {r[2] for r in conn.execute(text("SHOW INDEX FROM users"))}
            if "uq_users_account_number" in idx:
                conn.execute(text("ALTER TABLE users DROP INDEX uq_users_account_number"))
            conn.execute(text("ALTER TABLE users DROP COLUMN account_number"))
            done.append("users.account_number (bỏ, không lưu STK)")
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN phone VARCHAR(15) NOT NULL AFTER id, ADD UNIQUE KEY uq_users_phone (phone), "
            "ADD COLUMN balance BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER name, "
            "ADD COLUMN total_voucher BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER total_donated, "
            "ADD COLUMN created_station_id TINYINT UNSIGNED NULL AFTER is_active, "
            "ADD COLUMN last_station_id TINYINT UNSIGNED NULL AFTER created_station_id"))
        done.append("users.phone, balance, total_voucher, created_station_id, last_station_id")

    # ---- settings
    for key, val, desc in (("voucher_days", "30", "Hạn dùng voucher (ngày)"),
                           ("public_capacity", "30", "Sức chứa mỗi thùng rác mini (vật)")):
        if conn.execute(text("INSERT IGNORE INTO settings (`key`, `value`, description) VALUES (:k, :v, :d)"),
                        {"k": key, "v": val, "d": desc}).rowcount:
            done.append(f"settings.{key}")
    if conn.execute(text("UPDATE settings SET value = '60', "
                         "description = 'Hết giờ không chọn thì giữ tiền vào số dư (giây)' "
                         "WHERE `key` = 'payout_timeout_sec' AND value = '30'")).rowcount:
        done.append("settings.payout_timeout_sec 30 -> 60 (có thêm bước nhập STK)")
    return done


# Địa chỉ mẫu 3 trạm trên đường ven biển (giống bối cảnh mô phỏng 3D) – admin sửa lại được
SAMPLE_STATIONS = {
    1: ("DNG-001", "Đường Võ Nguyên Giáp (cổng bãi tắm số 1)", 16.061200, 108.247600),
    2: ("DNG-002", "Đường Võ Nguyên Giáp (cổng bãi tắm số 2)", 16.059400, 108.247900),
    3: ("DNG-003", "Đường Võ Nguyên Giáp (cổng bãi tắm số 3)", 16.057600, 108.248200),
}
DEMO_MERCHANT = ("PEACEMART", "PEACE Mart (đối diện trạm)", "2468")


def migrate_004(conn) -> list[str]:
    from werkzeug.security import generate_password_hash
    done = []
    if "code" not in columns(conn, "station"):
        conn.execute(text(
            "ALTER TABLE station ADD COLUMN code VARCHAR(12) NULL AFTER id, "
            "ADD COLUMN ward VARCHAR(100) NULL AFTER address, ADD COLUMN province CHAR(3) NULL AFTER ward, "
            "ADD COLUMN lat DECIMAL(9,6) NULL AFTER province, ADD COLUMN lng DECIMAL(9,6) NULL AFTER lat, "
            "ADD UNIQUE KEY uq_station_code (code)"))
        done.append("station.code, ward, province, lat, lng")
    if conn.execute(text("INSERT IGNORE INTO station (id, name, storage_capacity) "
                         "VALUES (3, 'ATM Đồng Nát – Trạm 3', 300)")).rowcount:
        done.append("thêm trạm 3")
    for sid, (code, addr, lat, lng) in SAMPLE_STATIONS.items():
        n = conn.execute(text(
            "UPDATE station SET code = :c, address = COALESCE(address, :a), ward = COALESCE(ward, 'Phường An Hải'), "
            "province = COALESCE(province, 'DNG'), lat = COALESCE(lat, :lat), lng = COALESCE(lng, :lng) "
            "WHERE id = :id AND code IS NULL"), {"c": code, "a": addr, "lat": lat, "lng": lng, "id": sid}).rowcount
        if n:
            done.append(f"trạm {sid}: mã {code} + địa chỉ mẫu")
    # trạm khác chưa có mã (admin tạo trước bản này): tạm cấp mã DNG-1xx, admin sửa địa chỉ sau
    for (sid,) in conn.execute(text("SELECT id FROM station WHERE code IS NULL")).all():
        conn.execute(text("UPDATE station SET code = :c, province = COALESCE(province, 'DNG') WHERE id = :id"),
                     {"c": f"DNG-{100 + sid:03d}", "id": sid})
        done.append(f"trạm {sid}: mã tạm DNG-{100 + sid:03d}")

    done += create_new_tables(conn)
    if "is_demo" not in columns(conn, "merchants"):
        conn.execute(text("ALTER TABLE merchants ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active"))
        done.append("merchants.is_demo")
    code, name, pin = DEMO_MERCHANT
    if not conn.execute(text("SELECT COUNT(*) FROM merchants WHERE code = :c"), {"c": code}).scalar():
        conn.execute(text("INSERT INTO merchants (code, name, kind, address, pin_hash, is_active, is_demo) "
                          "VALUES (:c, :n, 'shop', 'Đối diện trạm, đường Võ Nguyên Giáp', :h, 1, 1)"),
                     {"c": code, "n": name, "h": generate_password_hash(pin)})
        done.append(f"cửa hàng demo {code}")
    for key, val, desc in (
            ("security_reject_session", "3", "An ninh: số lần bỏ rác lạ trong 1 phiên thì báo admin"),
            ("security_reject_day", "5", "An ninh: số lần bỏ rác lạ trong 24 giờ (cùng SĐT) thì báo admin"),
            ("security_cooldown_sec", "30", "An ninh: cùng loại sự cố ở 1 trạm chỉ báo lại sau bấy nhiêu giây")):
        if conn.execute(text("INSERT IGNORE INTO settings (`key`, `value`, description) VALUES (:k, :v, :d)"),
                        {"k": key, "v": val, "d": desc}).rowcount:
            done.append(f"settings.{key}")
    return done


def migrate_005(conn) -> list[str]:
    from app.services.order_service import DEMO_PRODUCTS
    done = create_new_tables(conn)
    mid = conn.execute(text("SELECT id FROM merchants WHERE code = 'PEACEMART'")).scalar()
    if mid and not conn.execute(text("SELECT COUNT(*) FROM products WHERE merchant_id = :m"), {"m": mid}).scalar():
        for i, (name, price, cat, icon) in enumerate(DEMO_PRODUCTS):
            conn.execute(text("INSERT INTO products (merchant_id, name, price, category, icon, sort_order) "
                              "VALUES (:m, :n, :p, :c, :i, :s)"), {"m": mid, "n": name, "p": price, "c": cat, "i": icon, "s": i})
        done.append(f"{len(DEMO_PRODUCTS)} sản phẩm mẫu cho PEACEMART")
    return done


def migrate(url: str = Config.SQLALCHEMY_DATABASE_URI, delete_old_users: bool = False) -> list[str]:
    engine = create_engine(url)
    with engine.begin() as conn:
        done = migrate_002(conn)
    # ALTER TABLE của MySQL tự commit từng câu -> chạy 003 riêng (lỗi giữa chừng: sửa rồi chạy lại vẫn an toàn)
    with engine.begin() as conn:
        done += migrate_003(conn, delete_old_users)
    with engine.begin() as conn:
        done += migrate_004(conn)
    with engine.begin() as conn:
        done += migrate_005(conn)
    return done


if __name__ == "__main__":
    changes = migrate(delete_old_users="--delete-old-users" in sys.argv)
    print("Đã nâng cấp:" if changes else "Database đã ở bản mới nhất.")
    for c in changes:
        print("  +", c)
