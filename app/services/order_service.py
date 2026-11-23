"""Bán hàng ở quầy cửa hàng: danh mục sản phẩm, thanh toán (voucher trừ trước, phần thiếu trả tiền mặt).

Voucher vẫn dùng 1 lần: hóa đơn nhỏ hơn mệnh giá thì phần dư không hoàn (quầy cảnh báo trước khi thanh toán).
"""
from datetime import datetime

from app.models import Merchant, Order, OrderItem, Product, db
from app.services import voucher_service

CATEGORIES = {"do_uong": "Đồ uống", "do_an": "Đồ ăn", "ve_xe": "Vé xe", "khac": "Khác"}
# Sản phẩm mẫu của cửa hàng demo PEACEMART (tools/migrate.py) – (tên, giá, nhóm, biểu tượng)
DEMO_PRODUCTS = [
    ("Nước suối 500ml", 5000, "do_uong", "💧"),
    ("Trà chanh", 10000, "do_uong", "🍋"),
    ("Nước dừa tươi", 15000, "do_uong", "🥥"),
    ("Cà phê sữa đá", 18000, "do_uong", "☕"),
    ("Bánh mì", 15000, "do_an", "🥖"),
    ("Kem que", 8000, "do_an", "🍦"),
    ("Snack khoai tây", 12000, "do_an", "🍟"),
    ("Kẹo cao su", 3000, "do_an", "🍬"),
    ("Vé xe buýt", 7000, "ve_xe", "🚌"),
    ("Kem chống nắng mini", 35000, "khac", "🧴"),
]
MAX_LINES, MAX_QTY = 30, 20


class OrderError(ValueError):
    pass


def product_to_dict(p: Product) -> dict:
    return {"id": p.id, "merchant_id": p.merchant_id, "name": p.name, "price": int(p.price), "category": p.category,
            "category_vi": CATEGORIES.get(p.category, p.category), "icon": p.icon, "is_active": bool(p.is_active),
            "sort_order": p.sort_order}


def products(merchant: Merchant, active_only: bool = True) -> list[Product]:
    q = Product.query.filter_by(merchant_id=merchant.id)
    if active_only:
        q = q.filter_by(is_active=True)
    return q.order_by(Product.sort_order, Product.id).all()


def apply_product(p: Product, d: dict) -> None:
    """Sửa / tạo sản phẩm từ form admin (chỉ các khóa có mặt)."""
    if "name" in d:
        name = " ".join(str(d["name"] or "").split())[:100]
        if not name:
            raise OrderError("Vui lòng nhập tên sản phẩm")
        p.name = name
    if "price" in d:
        try:
            price = int(d["price"])
        except (TypeError, ValueError):
            raise OrderError("Giá phải là số nguyên")
        if not 0 < price <= 10_000_000:
            raise OrderError("Giá phải từ 1đ đến 10.000.000đ")
        p.price = price
    if "category" in d:
        if d["category"] not in CATEGORIES:
            raise OrderError("Nhóm sản phẩm không hợp lệ")
        p.category = d["category"]
    if "icon" in d:
        p.icon = str(d["icon"] or "").strip()[:8] or None
    if "is_active" in d:
        p.is_active = bool(d["is_active"])
    if "sort_order" in d:
        p.sort_order = int(d["sort_order"] or 0)


def quote(merchant: Merchant, items: list) -> tuple[list[tuple[Product, int]], int]:
    """Kiểm tra giỏ hàng -> ([(sản phẩm, số lượng)], tổng tiền)."""
    if not isinstance(items, list) or not items:
        raise OrderError("Hóa đơn trống")
    if len(items) > MAX_LINES:
        raise OrderError(f"Tối đa {MAX_LINES} dòng mỗi hóa đơn")
    lines, total = [], 0
    for it in items:
        try:
            pid, qty = int(it["product_id"]), int(it.get("qty", 1))
        except (TypeError, ValueError, KeyError):
            raise OrderError("Dòng hóa đơn không hợp lệ")
        p = db.session.get(Product, pid)
        if p is None or p.merchant_id != merchant.id or not p.is_active:
            raise OrderError("Sản phẩm không còn bán")
        if not 1 <= qty <= MAX_QTY:
            raise OrderError(f"Số lượng mỗi món từ 1 đến {MAX_QTY}")
        lines.append((p, qty))
        total += int(p.price) * qty
    return lines, total


def checkout(merchant: Merchant, items: list, voucher_code: str | None = None) -> Order:
    lines, total = quote(merchant, items)
    order = Order(merchant_id=merchant.id, total=total, voucher_amount=0, voucher_lost=0, created_at=datetime.now())
    if voucher_code:
        try:
            v = voucher_service.redeem(voucher_code, merchant, commit=False)
        except voucher_service.VoucherError as e:
            db.session.rollback()
            raise OrderError(str(e))
        order.voucher_id = v.id
        order.voucher_amount = min(int(v.amount), total)
        order.voucher_lost = int(v.amount) - order.voucher_amount
    order.cash_amount = total - order.voucher_amount
    for p, qty in lines:
        order.items.append(OrderItem(product_id=p.id, name=p.name, price=int(p.price), qty=qty))
    db.session.add(order)
    db.session.commit()       # voucher 'used' + đơn hàng ghi cùng 1 lần
    return order


def order_to_dict(o: Order) -> dict:
    return {
        "id": o.id, "merchant_id": o.merchant_id, "total": int(o.total), "voucher_amount": int(o.voucher_amount),
        "voucher_lost": int(o.voucher_lost), "cash_amount": int(o.cash_amount),
        "voucher": o.voucher.code if o.voucher else None,
        "created_at": o.created_at.isoformat(" ", "minutes") if o.created_at else None,
        "items": [{"name": i.name, "price": int(i.price), "qty": i.qty, "product_id": i.product_id} for i in o.items],
    }
