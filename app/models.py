"""Model SQLAlchemy ánh xạ đúng các bảng trong database/schema.sql.

Hệ sinh thái chung: 1 server trung tâm + 1 CSDL, nhiều trạm (bảng station). Người dùng định danh bằng
số điện thoại, dùng được ở mọi trạm. Không lưu số tài khoản ngân hàng (chỉ ghi ngân hàng + 4 số cuối
trong bảng payouts để đối soát).
"""
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import BigInteger, Integer

db = SQLAlchemy()

# BIGINT tự tăng trên MySQL, INTEGER trên SQLite (SQLite chỉ tự tăng với INTEGER) – dùng cho test.
BigId = BigInteger().with_variant(Integer, "sqlite")

TX_STATUSES = ("accepted", "rejected", "empty", "scan_failed")
TX_SOURCES = ("tray", "slot")
PAYOUTS = ("transfer", "charity", "voucher")          # 3 nút người dùng chọn
TX_PAYOUTS = (*PAYOUTS, "held")                       # held = hết giờ không chọn -> giữ vào số dư
VOUCHER_STATUSES = ("active", "used", "void")
# Sự cố an ninh do camera giám sát (gắn trên màn hình trạm, nhìn thẳng vào người dùng) ghi lại
SECURITY_KINDS = ("reject_repeat", "impact", "tamper", "camera_blocked")
SECURITY_STATUSES = ("new", "seen", "resolved")


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(15), nullable=False, unique=True)
    name = db.Column(db.String(100), nullable=False, index=True)
    balance = db.Column(db.BigInteger, nullable=False, default=0)          # tiền chờ chọn (hết giờ không chọn)
    total_received = db.Column(db.BigInteger, nullable=False, default=0)   # đã chuyển khoản
    total_donated = db.Column(db.BigInteger, nullable=False, default=0)    # đã góp từ thiện
    total_voucher = db.Column(db.BigInteger, nullable=False, default=0)    # đã đổi voucher
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_station_id = db.Column(db.SmallInteger)
    last_station_id = db.Column(db.SmallInteger)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    last_used_at = db.Column(db.DateTime)

    transactions = db.relationship("Transaction", back_populates="user", lazy="dynamic")


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(BigId, primary_key=True)
    station_id = db.Column(db.SmallInteger, nullable=False, default=1)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # NULL = khách
    source = db.Column(db.Enum(*TX_SOURCES, name="tx_source"), nullable=False, default="tray")
    bottles = db.Column(db.SmallInteger, nullable=False, default=0)
    cans = db.Column(db.SmallInteger, nullable=False, default=0)
    price_bottle = db.Column(db.Integer, nullable=False)
    price_can = db.Column(db.Integer, nullable=False)
    amount = db.Column(db.Integer, nullable=False, default=0)
    payout = db.Column(db.Enum(*TX_PAYOUTS, name="tx_payout"))
    payout_id = db.Column(BigId, db.ForeignKey("payouts.id", ondelete="SET NULL"))
    paid_at = db.Column(db.DateTime)
    status = db.Column(db.Enum(*TX_STATUSES, name="tx_status"), nullable=False)
    scan_attempts = db.Column(db.SmallInteger, nullable=False, default=1)
    image_path = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    user = db.relationship("User", back_populates="transactions")
    rejected_items = db.relationship(
        "RejectedItem", back_populates="transaction", cascade="all, delete-orphan"
    )


class Payout(db.Model):
    """Một lần người dùng nhận tiền (chuyển khoản / từ thiện / voucher), gồm tiền mẻ vừa bỏ + số dư cũ."""
    __tablename__ = "payouts"

    id = db.Column(BigId, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    station_id = db.Column(db.SmallInteger, nullable=False)
    method = db.Column(db.Enum(*PAYOUTS, name="payout_method"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    bank = db.Column(db.String(50))            # chuyển khoản: tên ngân hàng
    account_last4 = db.Column(db.String(4))    # chuyển khoản: 4 số cuối STK (không lưu STK đầy đủ)
    voucher_id = db.Column(BigId, db.ForeignKey("vouchers.id", ondelete="SET NULL"))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)


class Voucher(db.Model):
    """Voucher QR dùng 1 lần ở cửa hàng / nhà xe quanh trạm."""
    __tablename__ = "vouchers"

    id = db.Column(BigId, primary_key=True)
    code = db.Column(db.String(16), nullable=False, unique=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    station_id = db.Column(db.SmallInteger, nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    status = db.Column(db.Enum(*VOUCHER_STATUSES, name="voucher_status"), nullable=False, default="active")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    merchant_id = db.Column(db.Integer, db.ForeignKey("merchants.id", ondelete="SET NULL"))

    merchant = db.relationship("Merchant")


class Merchant(db.Model):
    """Cửa hàng / nhà xe nhận voucher. Đăng nhập trang /shop bằng mã + PIN."""
    __tablename__ = "merchants"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True)
    name = db.Column(db.String(100), nullable=False)
    kind = db.Column(db.String(20), nullable=False, default="shop")   # shop | parking | other
    address = db.Column(db.String(200))
    pin_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    # cửa hàng DEMO đối diện trạm trong bản mô phỏng 3D: quầy thu ngân mở /shop?demo=1 là vào luôn (không cần PIN)
    is_demo = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)


class Product(db.Model):
    """Sản phẩm của cửa hàng (bán ở quầy, trả bằng voucher + tiền mặt)."""
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    merchant_id = db.Column(db.Integer, db.ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    price = db.Column(db.Integer, nullable=False)
    category = db.Column(db.String(30), nullable=False, default="khac")   # do_uong | do_an | ve_xe | khac
    icon = db.Column(db.String(8))                                         # emoji hiện trên kệ / hóa đơn
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)


class Order(db.Model):
    """Đơn bán ở quầy: voucher trừ trước, phần thiếu khách trả tiền mặt."""
    __tablename__ = "orders"

    id = db.Column(BigId, primary_key=True)
    merchant_id = db.Column(db.Integer, db.ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False)
    voucher_id = db.Column(BigId, db.ForeignKey("vouchers.id", ondelete="SET NULL"))
    total = db.Column(db.Integer, nullable=False)
    voucher_amount = db.Column(db.Integer, nullable=False, default=0)   # phần voucher trả
    voucher_lost = db.Column(db.Integer, nullable=False, default=0)     # voucher lớn hơn hóa đơn: phần dư bỏ
    cash_amount = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    items = db.relationship("OrderItem", cascade="all, delete-orphan", order_by="OrderItem.id")
    voucher = db.relationship("Voucher")


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(BigId, primary_key=True)
    order_id = db.Column(BigId, db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id", ondelete="SET NULL"))
    name = db.Column(db.String(100), nullable=False)
    price = db.Column(db.Integer, nullable=False)
    qty = db.Column(db.SmallInteger, nullable=False)


class RejectedItem(db.Model):
    __tablename__ = "rejected_items"

    id = db.Column(BigId, primary_key=True)
    transaction_id = db.Column(BigId, db.ForeignKey("transactions.id"), nullable=False)
    label = db.Column(db.String(50), nullable=False)
    confidence = db.Column(db.Numeric(5, 4), nullable=False)
    bbox_x1 = db.Column(db.Integer, nullable=False)
    bbox_y1 = db.Column(db.Integer, nullable=False)
    bbox_x2 = db.Column(db.Integer, nullable=False)
    bbox_y2 = db.Column(db.Integer, nullable=False)
    crop_path = db.Column(db.String(255), nullable=False)

    transaction = db.relationship("Transaction", back_populates="rejected_items")


class Station(db.Model):
    __tablename__ = "station"

    id = db.Column(db.SmallInteger, primary_key=True, autoincrement=False)
    code = db.Column(db.String(12), unique=True)               # mã trạm theo tỉnh, vd DNG-001 (không đổi)
    name = db.Column(db.String(100), nullable=False, default="ATM Đồng Nát")
    address = db.Column(db.String(200))                         # số nhà, đường
    ward = db.Column(db.String(100))                            # phường / xã
    province = db.Column(db.String(3))                          # mã tỉnh / thành (services/station_service.py)
    lat = db.Column(db.Numeric(9, 6))
    lng = db.Column(db.Numeric(9, 6))
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    storage_count = db.Column(db.Integer, nullable=False, default=0)
    storage_capacity = db.Column(db.Integer, nullable=False, default=300)
    is_full = db.Column(db.Boolean, nullable=False, default=False)
    # số vật trong từng thùng bên trong (tổng = storage_count) + 2 thùng rác mini
    bin_bottle = db.Column(db.Integer, nullable=False, default=0)
    bin_can = db.Column(db.Integer, nullable=False, default=0)
    bin_other = db.Column(db.Integer, nullable=False, default=0)
    public_left = db.Column(db.Integer, nullable=False, default=0)
    public_right = db.Column(db.Integer, nullable=False, default=0)
    last_emptied_at = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class SecurityEvent(db.Model):
    """Camera giám sát ghi nhận hành vi bất thường (bỏ rác lạ nhiều lần, đập máy, cạy khay / cửa, che camera)."""
    __tablename__ = "security_events"

    id = db.Column(BigId, primary_key=True)
    station_id = db.Column(db.SmallInteger, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))   # người đang đăng nhập (nếu có)
    kind = db.Column(db.Enum(*SECURITY_KINDS, name="security_kind"), nullable=False)
    detail = db.Column(db.String(255))
    image_path = db.Column(db.String(255))        # ảnh camera giám sát lúc xảy ra
    before_path = db.Column(db.String(255))       # che camera: ảnh cuối cùng trước khi bị che
    status = db.Column(db.Enum(*SECURITY_STATUSES, name="security_status"), nullable=False, default="new")
    note = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    resolved_at = db.Column(db.DateTime)

    user = db.relationship("User")


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.String(255), nullable=False)
    description = db.Column(db.String(255))
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


REQUIRED_TABLES = ("users", "transactions", "rejected_items", "station", "settings", "payouts", "vouchers", "merchants",
                   "security_events", "products", "orders", "order_items")
# Cột mới so với bản đầu – thiếu thì phải chạy tools/migrate.py
REQUIRED_COLUMNS = {
    "users": ("phone", "balance", "total_voucher"),
    "transactions": ("source", "payout", "paid_at", "station_id", "payout_id"),
    "station": ("bin_bottle", "public_left", "address", "code", "ward", "province", "lat"),
    "merchants": ("is_demo",),
}
