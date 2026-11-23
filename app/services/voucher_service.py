"""Voucher QR (dùng 1 lần, có hạn) + cửa hàng / nhà xe nhận voucher."""
import io
import secrets
from datetime import datetime, timedelta

from werkzeug.security import check_password_hash, generate_password_hash

from app.models import Merchant, Voucher, db
from app.services import settings_service as settings

# Bỏ ký tự dễ nhầm (0/O, 1/I/L) – người bán có thể gõ tay mã in dưới QR
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
MERCHANT_KINDS = {"shop": "Cửa hàng", "parking": "Nhà xe / vé xe", "other": "Khác"}


class VoucherError(ValueError):
    """Lỗi nghiệp vụ (tiếng Việt, hiển thị thẳng cho người bán / admin)."""


def new_code() -> str:
    while True:
        raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
        code = f"DN-{raw[:4]}-{raw[4:]}"
        if not Voucher.query.filter_by(code=code).first():
            return code


def normalize_code(code: str) -> str:
    raw = "".join(c for c in str(code or "").upper() if c.isalnum())
    if raw.startswith("DN"):
        raw = raw[2:]
    return f"DN-{raw[:4]}-{raw[4:8]}" if len(raw) == 8 else str(code or "").strip().upper()


def create_voucher(user_id: int | None, station_id: int, amount: int) -> Voucher:
    """Tạo voucher (chưa commit – gọi trong cùng giao dịch ghi payout)."""
    days = settings.get_int("voucher_days")
    v = Voucher(code=new_code(), user_id=user_id, station_id=station_id, amount=int(amount),
                status="active", created_at=datetime.now(), expires_at=datetime.now() + timedelta(days=days))
    db.session.add(v)
    db.session.flush()
    return v


def effective_status(v: Voucher) -> str:
    if v.status == "active" and v.expires_at < datetime.now():
        return "expired"
    return v.status


def voucher_to_dict(v: Voucher, qr: bool = False, base_url: str = "") -> dict:
    iso = lambda d: d.isoformat(" ", "minutes") if d else None   # noqa: E731
    d = {
        "id": v.id, "code": v.code, "amount": int(v.amount), "status": effective_status(v),
        "station_id": v.station_id, "user_id": v.user_id,
        "created_at": iso(v.created_at), "expires_at": iso(v.expires_at), "used_at": iso(v.used_at),
        "merchant": v.merchant.name if v.merchant else None,
    }
    if qr:
        d["url"] = voucher_url(v.code, base_url)
        d["qr_svg"] = qr_svg(d["url"])
    return d


def voucher_url(code: str, base_url: str = "") -> str:
    return f"{base_url.rstrip('/')}/v/{code}"


def qr_svg(data: str) -> str:
    """Mã QR dạng SVG (nhúng thẳng vào HTML, không cần file ảnh)."""
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2,
                      error_correction=qrcode.constants.ERROR_CORRECT_M)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    return svg[svg.index("<svg"):]


def find_voucher(code: str) -> Voucher | None:
    return Voucher.query.filter_by(code=normalize_code(code)).first()


def redeem(code: str, merchant: Merchant, commit: bool = True) -> Voucher:
    v = find_voucher(code)
    if v is None:
        raise VoucherError("Không tìm thấy voucher")
    st = effective_status(v)
    if st == "used":
        raise VoucherError(f"Voucher đã được dùng lúc {v.used_at:%H:%M %d/%m/%Y}")
    if st == "expired":
        raise VoucherError(f"Voucher đã hết hạn ngày {v.expires_at:%d/%m/%Y}")
    if st == "void":
        raise VoucherError("Voucher đã bị hủy")
    v.status = "used"
    v.used_at = datetime.now()
    v.merchant_id = merchant.id
    if commit:
        db.session.commit()
    return v


# ---------------------------------------------------------------- cửa hàng / nhà xe
def create_merchant(code: str, name: str, pin: str, kind: str = "shop", address: str | None = None,
                    is_demo: bool = False) -> Merchant:
    code = (code or "").strip().upper()
    name = " ".join((name or "").split())
    if not code or len(code) > 20 or not code.replace("-", "").replace("_", "").isalnum():
        raise VoucherError("Mã cửa hàng gồm chữ/số, tối đa 20 ký tự")
    if not name:
        raise VoucherError("Vui lòng nhập tên cửa hàng")
    if kind not in MERCHANT_KINDS:
        raise VoucherError("Loại cửa hàng không hợp lệ")
    if not (pin or "").isdigit() or not 4 <= len(pin) <= 8:
        raise VoucherError("PIN gồm 4–8 chữ số")
    if Merchant.query.filter_by(code=code).first():
        raise VoucherError("Mã cửa hàng đã tồn tại")
    m = Merchant(code=code, name=name, kind=kind, address=(address or "").strip() or None,
                 pin_hash=generate_password_hash(pin), is_demo=bool(is_demo))
    db.session.add(m)
    db.session.commit()
    return m


def set_merchant_pin(m: Merchant, pin: str) -> None:
    if not (pin or "").isdigit() or not 4 <= len(pin) <= 8:
        raise VoucherError("PIN gồm 4–8 chữ số")
    m.pin_hash = generate_password_hash(pin)
    db.session.commit()


def check_merchant(code: str, pin: str) -> Merchant | None:
    m = Merchant.query.filter_by(code=(code or "").strip().upper(), is_active=True).first()
    if m and check_password_hash(m.pin_hash, pin or ""):
        return m
    return None


def merchant_to_dict(m: Merchant) -> dict:
    used = Voucher.query.filter_by(merchant_id=m.id)
    return {"id": m.id, "code": m.code, "name": m.name, "kind": m.kind, "kind_vi": MERCHANT_KINDS.get(m.kind, m.kind),
            "address": m.address, "is_active": bool(m.is_active), "is_demo": bool(m.is_demo),
            "redeemed": used.count(), "redeemed_amount": int(sum(v.amount for v in used))}
