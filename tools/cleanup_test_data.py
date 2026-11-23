"""Xóa dữ liệu test (người dùng có tên bắt đầu bằng 'Test ' hoặc SĐT 0999xxxxxx) khỏi atm_db (kèm giao dịch,
lượt nhận tiền, voucher của họ).

Chạy:  python tools/cleanup_test_data.py
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.models import Payout, RejectedItem, Transaction, User, Voucher, db  # noqa: E402

app = create_app(detector=None)
with app.app_context():
    users = User.query.filter(
        (User.name.like("Test %")) | (User.phone.like("0999%"))
    ).all()
    for u in users:
        for tx in Transaction.query.filter_by(user_id=u.id).all():
            for ri in tx.rejected_items:
                (app.config["DATA_DIR"] / ri.crop_path).unlink(missing_ok=True)
            if tx.image_path:
                (app.config["DATA_DIR"] / tx.image_path).unlink(missing_ok=True)
            db.session.delete(tx)
        Payout.query.filter_by(user_id=u.id).delete()
        Voucher.query.filter_by(user_id=u.id).delete()
        print("xóa", u.id, u.name)
        db.session.delete(u)
    db.session.commit()
