"""Nâng cấp cấu trúc database atm_db lên bản mới nhất (chạy lại nhiều lần vẫn an toàn).

Chạy:  python tools/migrate.py

002 – Chuyển khoản / từ thiện + lỗ bỏ chai:
  users.balance -> users.total_received, thêm users.total_donated
  transactions.user_id cho phép NULL (khách bỏ qua lỗ khi chưa chọn tên)
  transactions.source ('tray' | 'slot'), transactions.payout ('transfer' | 'charity'), transactions.paid_at
  settings.payout_timeout_sec
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


def migrate(url: str = Config.SQLALCHEMY_DATABASE_URI) -> list[str]:
    done = []
    engine = create_engine(url)
    with engine.begin() as conn:
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
            # Giao dịch cũ: tiền đã được cộng thẳng vào số dư (= đã chuyển khoản)
            n = conn.execute(text("UPDATE transactions SET payout = 'transfer', paid_at = created_at "
                                  "WHERE status = 'accepted' AND amount > 0 AND user_id IS NOT NULL")).rowcount
            done.append(f"{n} giao dịch cũ -> đã chuyển khoản")

        r = conn.execute(text("INSERT IGNORE INTO settings (`key`, `value`, description) VALUES "
                              "('payout_timeout_sec', '30', 'Tự chuyển khoản nếu không chọn (giây)')"))
        if r.rowcount:
            done.append("settings.payout_timeout_sec")
    return done


if __name__ == "__main__":
    changes = migrate()
    print("Đã nâng cấp:" if changes else "Database đã ở bản mới nhất.")
    for c in changes:
        print("  +", c)
