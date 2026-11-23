"""Trang cửa hàng / nhà xe: đăng nhập bằng mã + PIN, quét QR (điện thoại mở link /v/<mã>) hoặc gõ mã voucher,
xác nhận dùng -> voucher hết hiệu lực.

Mô phỏng 3D: cửa hàng demo đối diện trạm (merchants.is_demo = 1) – quầy thu ngân mở /shop?demo=1 vào thẳng tài khoản
demo không cần PIN (admin tắt được ở tab Cửa hàng). Ví voucher của người chơi hỏi trạng thái qua /api/wallet/status.
"""
from functools import wraps

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for

from app.models import Merchant, Order, Voucher, db
from app.services import order_service, voucher_service

bp = Blueprint("shop", __name__)


def _merchant() -> Merchant | None:
    mid = session.get("merchant_id")
    m = db.session.get(Merchant, mid) if mid else None
    return m if m and m.is_active else None


def merchant_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if _merchant() is None:
            return jsonify({"error": "Chưa đăng nhập cửa hàng"}), 401
        return fn(*a, **kw)
    return wrapper


@bp.get("/v/<code>")
def voucher_link(code):
    """Link trong mã QR: người bán quét bằng camera điện thoại -> mở trang cửa hàng với sẵn mã."""
    return redirect(url_for("shop.page", code=code))


@bp.get("/shop")
def page():
    return render_template("shop.html")


@bp.get("/api/shop/me")
def me():
    m = _merchant()
    return jsonify({"merchant": voucher_service.merchant_to_dict(m) if m else None})


@bp.post("/api/shop/login")
def login():
    d = request.get_json(silent=True) or {}
    m = voucher_service.check_merchant(str(d.get("code", "")), str(d.get("pin", "")))
    if m is None:
        return jsonify({"error": "Sai mã cửa hàng hoặc PIN"}), 401
    session["merchant_id"] = m.id
    return jsonify({"merchant": voucher_service.merchant_to_dict(m)})


@bp.post("/api/shop/demo-login")
def demo_login():
    m = Merchant.query.filter_by(is_demo=True, is_active=True).order_by(Merchant.id).first()
    if m is None:
        return jsonify({"error": "Chưa có cửa hàng demo (admin bật ở tab Cửa hàng)"}), 404
    session["merchant_id"] = m.id
    return jsonify({"merchant": voucher_service.merchant_to_dict(m)})


@bp.post("/api/wallet/status")
def wallet_status():
    """Ví voucher (mô phỏng): trạng thái các mã người chơi đang giữ. Người giữ mã mới biết mã -> chỉ trả
    mệnh giá / hạn / trạng thái, không kèm thông tin người nhận."""
    codes = (request.get_json(silent=True) or {}).get("codes") or []
    out = []
    for c in list(codes)[:50]:
        v = voucher_service.find_voucher(str(c))
        if v is None:
            out.append({"code": str(c)[:20], "status": "missing"})
            continue
        d = voucher_service.voucher_to_dict(v)
        out.append({k: d.get(k) for k in ("code", "amount", "status", "expires_at", "used_at", "merchant")})
    return jsonify(out)


@bp.get("/api/store/<code>/products")
def store_products(code):
    """Danh mục công khai (kệ hàng trong mô phỏng 3D hiện giá, khách chọn vào giỏ)."""
    m = Merchant.query.filter_by(code=str(code).upper(), is_active=True).first()
    if m is None:
        return jsonify({"error": "Không tìm thấy cửa hàng"}), 404
    return jsonify({"merchant": {"code": m.code, "name": m.name},
                    "categories": order_service.CATEGORIES,
                    "products": [order_service.product_to_dict(p) for p in order_service.products(m)]})


@bp.get("/api/shop/products")
@merchant_required
def shop_products():
    return jsonify([order_service.product_to_dict(p) for p in order_service.products(_merchant())])


@bp.post("/api/shop/checkout")
@merchant_required
def checkout():
    """Thanh toán hóa đơn {items: [{product_id, qty}], voucher?: mã} – voucher trừ trước, thiếu thì tiền mặt."""
    d = request.get_json(silent=True) or {}
    try:
        o = order_service.checkout(_merchant(), d.get("items"), (d.get("voucher") or "").strip() or None)
    except order_service.OrderError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(order_service.order_to_dict(o))


@bp.get("/api/shop/orders")
@merchant_required
def orders():
    rows = Order.query.filter_by(merchant_id=_merchant().id).order_by(Order.id.desc()).limit(30).all()
    return jsonify([order_service.order_to_dict(o) for o in rows])


@bp.post("/api/shop/logout")
def logout():
    session.pop("merchant_id", None)
    return jsonify({"ok": True})


@bp.get("/api/shop/voucher/<code>")
@merchant_required
def check(code):
    v = voucher_service.find_voucher(code)
    if v is None:
        return jsonify({"error": "Không tìm thấy voucher"}), 404
    return jsonify(voucher_service.voucher_to_dict(v))


@bp.post("/api/shop/redeem")
@merchant_required
def redeem():
    code = str((request.get_json(silent=True) or {}).get("code", ""))
    try:
        v = voucher_service.redeem(code, _merchant())
    except voucher_service.VoucherError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(voucher_service.voucher_to_dict(v))


@bp.get("/api/shop/history")
@merchant_required
def history():
    rows = Voucher.query.filter_by(merchant_id=_merchant().id).order_by(Voucher.used_at.desc()).limit(50).all()
    return jsonify([voucher_service.voucher_to_dict(v) for v in rows])
