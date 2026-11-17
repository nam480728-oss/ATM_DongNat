"""Model SQLAlchemy ánh xạ đúng các bảng trong database/schema.sql."""
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import BigInteger, Integer

db = SQLAlchemy()

# BIGINT tự tăng trên MySQL, INTEGER trên SQLite (SQLite chỉ tự tăng với INTEGER) – dùng cho test.
BigId = BigInteger().with_variant(Integer, "sqlite")

TX_STATUSES = ("accepted", "rejected", "empty", "scan_failed")
TX_SOURCES = ("tray", "slot")
PAYOUTS = ("transfer", "charity")


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, index=True)
    account_number = db.Column(db.String(19), nullable=False, unique=True)
    total_received = db.Column(db.BigInteger, nullable=False, default=0)  # đã chuyển khoản
    total_donated = db.Column(db.BigInteger, nullable=False, default=0)   # đã góp từ thiện
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    last_used_at = db.Column(db.DateTime)

    transactions = db.relationship("Transaction", back_populates="user", lazy="dynamic")

    @property
    def last4(self) -> str:
        return self.account_number[-4:]

    @property
    def masked_account(self) -> str:
        return "*" * max(0, len(self.account_number) - 4) + self.last4


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(BigId, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)  # NULL = khách (lỗ bỏ chai)
    source = db.Column(db.Enum(*TX_SOURCES, name="tx_source"), nullable=False, default="tray")
    bottles = db.Column(db.SmallInteger, nullable=False, default=0)
    cans = db.Column(db.SmallInteger, nullable=False, default=0)
    price_bottle = db.Column(db.Integer, nullable=False)
    price_can = db.Column(db.Integer, nullable=False)
    amount = db.Column(db.Integer, nullable=False, default=0)
    payout = db.Column(db.Enum(*PAYOUTS, name="tx_payout"))
    paid_at = db.Column(db.DateTime)
    status = db.Column(db.Enum(*TX_STATUSES, name="tx_status"), nullable=False)
    scan_attempts = db.Column(db.SmallInteger, nullable=False, default=1)
    image_path = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    user = db.relationship("User", back_populates="transactions")
    rejected_items = db.relationship(
        "RejectedItem", back_populates="transaction", cascade="all, delete-orphan"
    )


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
    name = db.Column(db.String(100), nullable=False, default="ATM Đồng Nát")
    storage_count = db.Column(db.Integer, nullable=False, default=0)
    storage_capacity = db.Column(db.Integer, nullable=False, default=300)
    is_full = db.Column(db.Boolean, nullable=False, default=False)
    last_emptied_at = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.String(255), nullable=False)
    description = db.Column(db.String(255))
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)


REQUIRED_TABLES = ("users", "transactions", "rejected_items", "station", "settings")
# Cột mới so với bản đầu – thiếu thì phải chạy tools/migrate.py
REQUIRED_COLUMNS = {"users": ("total_received", "total_donated"), "transactions": ("source", "payout", "paid_at")}
