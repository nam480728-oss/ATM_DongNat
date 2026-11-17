"""Nghiệp vụ người dùng: tạo, tìm, tên hiển thị (trùng tên thì thêm 4 số cuối STK)."""
import re
import unicodedata
from collections import Counter

from app.models import User, db

ACCOUNT_RE = re.compile(r"^\d{6,19}$")


class UserError(ValueError):
    """Lỗi nghiệp vụ, message hiển thị thẳng lên màn hình (tiếng Việt)."""


def normalize_name(name: str) -> str:
    """Chuẩn hóa để so trùng tên: bỏ khoảng trắng thừa, NFC, không phân biệt hoa thường."""
    name = unicodedata.normalize("NFC", " ".join((name or "").split()))
    return name.casefold()


def clean_name(name: str) -> str:
    return unicodedata.normalize("NFC", " ".join((name or "").split()))


def create_user(name: str, account_number: str) -> User:
    name = clean_name(name)
    account_number = (account_number or "").strip().replace(" ", "")
    if not name:
        raise UserError("Vui lòng nhập tên")
    if len(name) > 100:
        raise UserError("Tên tối đa 100 ký tự")
    if not ACCOUNT_RE.match(account_number):
        raise UserError("Số tài khoản phải gồm 6–19 chữ số")
    if User.query.filter_by(account_number=account_number).first():
        raise UserError("Số tài khoản này đã được đăng ký")
    user = User(name=name, account_number=account_number)
    db.session.add(user)
    db.session.commit()
    return user


def active_users():
    return User.query.filter_by(is_active=True)


def display_names(users: list[User]) -> dict[int, str]:
    """Tên hiển thị. Trùng tên (trong toàn bộ người dùng đang hoạt động) -> 'Tên (*1234)'."""
    counts = Counter(normalize_name(n) for (n,) in db.session.query(User.name).filter_by(is_active=True))
    return {
        u.id: f"{u.name} (*{u.last4})" if counts[normalize_name(u.name)] > 1 else u.name
        for u in users
    }


def search_users(q: str | None = None, limit: int = 100) -> list[dict]:
    query = active_users()
    users = query.order_by(User.last_used_at.desc(), User.name).all()
    if q:
        nq = normalize_name(q)
        users = [u for u in users if nq in normalize_name(u.name)]
    users = users[:limit]
    names = display_names(users)
    return [user_to_dict(u, names[u.id]) for u in users]


def user_to_dict(u: User, display_name: str | None = None) -> dict:
    if display_name is None:
        display_name = display_names([u])[u.id]
    return {
        "id": u.id,
        "name": u.name,
        "display_name": display_name,
        "masked_account": u.masked_account,
        "total_received": int(u.total_received or 0),
        "total_donated": int(u.total_donated or 0),
    }
