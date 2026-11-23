"""Nghiệp vụ người dùng: định danh bằng số điện thoại (dùng chung mọi trạm), tên che bớt trên màn hình trạm."""
import re
import unicodedata
from datetime import datetime

from sqlalchemy import or_

from app.models import User, db

PHONE_RE = re.compile(r"^0[35789]\d{8}$")


class UserError(ValueError):
    """Lỗi nghiệp vụ, message hiển thị thẳng lên màn hình (tiếng Việt)."""


def normalize_phone(phone: str) -> str:
    """'+84 912 345 678' | '0912.345.678' -> '0912345678'."""
    p = re.sub(r"\D", "", str(phone or ""))
    if p.startswith("84") and len(p) == 11:
        p = "0" + p[2:]
    return p


def valid_phone(phone: str) -> bool:
    return bool(PHONE_RE.match(phone))


def clean_name(name: str) -> str:
    return unicodedata.normalize("NFC", " ".join((name or "").split()))


def mask_name(name: str) -> str:
    """'Nguyễn Văn An' -> 'Nguyễn V** A*' (người đứng sau không đọc được tên đầy đủ của người khác)."""
    words = clean_name(name).split(" ")
    if not words or not words[0]:
        return ""
    if len(words) == 1:
        return words[0][0] + "*" * (len(words[0]) - 1)
    return " ".join([words[0], *(w[0] + "*" * (len(w) - 1) for w in words[1:])])


def mask_phone(phone: str) -> str:
    """'0912345678' -> '091****678'."""
    return phone[:3] + "*" * max(0, len(phone) - 6) + phone[-3:] if len(phone) >= 7 else phone


def find_by_phone(phone: str) -> User | None:
    phone = normalize_phone(phone)
    return User.query.filter_by(phone=phone).first() if phone else None


def create_user(phone: str, name: str, station_id: int | None = None) -> User:
    phone, name = normalize_phone(phone), clean_name(name)
    if not valid_phone(phone):
        raise UserError("Số điện thoại không hợp lệ (10 số, bắt đầu bằng 03, 05, 07, 08, 09)")
    if not name:
        raise UserError("Vui lòng nhập họ tên")
    if len(name) > 100:
        raise UserError("Tên tối đa 100 ký tự")
    if find_by_phone(phone):
        raise UserError("Số điện thoại này đã được đăng ký")
    user = User(phone=phone, name=name, created_station_id=station_id, last_station_id=station_id,
                created_at=datetime.now())
    db.session.add(user)
    db.session.commit()
    return user


def update_user(user: User, phone: str | None = None, name: str | None = None, is_active: bool | None = None) -> User:
    if phone is not None:
        phone = normalize_phone(phone)
        if not valid_phone(phone):
            raise UserError("Số điện thoại không hợp lệ")
        other = find_by_phone(phone)
        if other and other.id != user.id:
            raise UserError("Số điện thoại này đã thuộc người dùng khác")
        user.phone = phone
    if name is not None:
        name = clean_name(name)
        if not name or len(name) > 100:
            raise UserError("Họ tên không hợp lệ")
        user.name = name
    if is_active is not None:
        user.is_active = bool(is_active)
    db.session.commit()
    return user


def user_to_dict(u: User) -> dict:
    """Thông tin hiển thị trên MÀN HÌNH TRẠM (công khai): tên + SĐT đã che bớt."""
    return {
        "id": u.id,
        "display_name": mask_name(u.name),
        "initial": (u.name or "?")[0],
        "phone": mask_phone(u.phone),
        "balance": int(u.balance or 0),
        "total_received": int(u.total_received or 0),
        "total_donated": int(u.total_donated or 0),
        "total_voucher": int(u.total_voucher or 0),
    }


def admin_user_dict(u: User) -> dict:
    """Thông tin đầy đủ cho trang admin."""
    iso = lambda d: d.isoformat(" ", "minutes") if d else None   # noqa: E731
    return {
        "id": u.id, "phone": u.phone, "name": u.name, "is_active": bool(u.is_active),
        "balance": int(u.balance or 0), "total_received": int(u.total_received or 0),
        "total_donated": int(u.total_donated or 0), "total_voucher": int(u.total_voucher or 0),
        "created_station_id": u.created_station_id, "last_station_id": u.last_station_id,
        "created_at": iso(u.created_at), "last_used_at": iso(u.last_used_at),
    }


def search_users(q: str | None = None, limit: int = 200) -> list[User]:
    query = User.query
    if q:
        q = q.strip()
        digits = re.sub(r"\D", "", q)
        conds = [User.name.ilike(f"%{q}%")]
        if digits:
            conds.append(User.phone.like(f"%{normalize_phone(digits) if len(digits) >= 10 else digits}%"))
        query = query.filter(or_(*conds))
    return query.order_by(User.last_used_at.desc(), User.id.desc()).limit(limit).all()
