"""Xóa dữ liệu test (người dùng có tên bắt đầu bằng 'Test ' hoặc STK bắt đầu bằng 9000/0987654321) khỏi atm_db.

Chạy:  python tools/cleanup_test_data.py
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.models import RejectedItem, Transaction, User, db  # noqa: E402

app = create_app(detector=None)
with app.app_context():
    users = User.query.filter(
        (User.name.like("Test %")) | (User.account_number.like("9000%")) | (User.account_number == "0987654321")
    ).all()
    for u in users:
        for tx in Transaction.query.filter_by(user_id=u.id).all():
            for ri in tx.rejected_items:
                (app.config["DATA_DIR"] / ri.crop_path).unlink(missing_ok=True)
            if tx.image_path:
                (app.config["DATA_DIR"] / tx.image_path).unlink(missing_ok=True)
            db.session.delete(tx)
        print("xóa", u.id, u.name)
        db.session.delete(u)
    db.session.commit()
