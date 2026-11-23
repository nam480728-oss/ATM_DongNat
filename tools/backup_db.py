"""Sao lưu toàn bộ database atm_db ra 1 file .sql (cấu trúc + dữ liệu) – không cần mysqldump.

Chạy:  python tools/backup_db.py            -> backups/atm_db_YYYYmmdd_HHMMSS.sql
Khôi phục (Navicat / mysql):  chạy file .sql đó trên database atm_db.
"""
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import Config  # noqa: E402


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    if isinstance(v, (datetime, date)):
        return f"'{v.isoformat(sep=' ') if isinstance(v, datetime) else v.isoformat()}'"
    if isinstance(v, bytes):
        return "0x" + v.hex()
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")
    return f"'{s}'"


def backup(url: str = Config.SQLALCHEMY_DATABASE_URI, out_dir: Path = ROOT / "backups") -> Path:
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"atm_db_{datetime.now():%Y%m%d_%H%M%S}.sql"
    engine = create_engine(url)
    with engine.connect() as conn, open(path, "w", encoding="utf-8") as f:
        f.write(f"-- Sao lưu atm_db lúc {datetime.now():%Y-%m-%d %H:%M:%S}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n")
        tables = [r[0] for r in conn.execute(text("SHOW TABLES"))]
        for t in tables:
            create = conn.execute(text(f"SHOW CREATE TABLE `{t}`")).one()[1]
            f.write(f"DROP TABLE IF EXISTS `{t}`;\n{create};\n")
            res = conn.execute(text(f"SELECT * FROM `{t}`"))
            cols = ", ".join(f"`{c}`" for c in res.keys())
            n = 0
            for row in res:
                f.write(f"INSERT INTO `{t}` ({cols}) VALUES ({', '.join(lit(v) for v in row)});\n")
                n += 1
            f.write(f"-- {t}: {n} dòng\n\n")
            print(f"  {t}: {n} dòng")
        f.write("SET FOREIGN_KEY_CHECKS=1;\n")
    return path


if __name__ == "__main__":
    p = backup()
    print("Đã sao lưu:", p)
