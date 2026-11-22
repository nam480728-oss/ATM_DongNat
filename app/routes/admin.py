"""Trang quản trị + API admin (đăng nhập bằng mật khẩu trong .env)."""
import hmac
from datetime import datetime, timedelta
from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import func

from app.models import RejectedItem, Setting, Transaction, User, db
from app.services import settings_service as settings
from app.services.user_service import display_names

bp = Blueprint("admin", __name__)


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get("admin"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Chưa đăng nhập admin"}), 401
            return redirect(url_for("admin.login"))
        return fn(*a, **kw)
    return wrapper


def _broadcast():
    current_app.extensions["station"].broadcast()


# ------------------------------------------------------------------ trang
@bp.route("/admin/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        pw = request.form.get("password", "")
        if hmac.compare_digest(pw.encode(), current_app.config["ADMIN_PASSWORD"].encode()):
            session.clear()
            session["admin"] = True
            return redirect(url_for("admin.dashboard"))
        error = "Sai mật khẩu"
    return render_template("admin/login.html", error=error)


@bp.post("/admin/logout")
def logout():
    session.clear()
    return redirect(url_for("admin.login"))


@bp.get("/admin")
@admin_required
def dashboard():
    return render_template("admin/dashboard.html")


# ------------------------------------------------------------------ API
@bp.get("/api/admin/stats")
@admin_required
def stats():
    st = settings.get_station()
    acc = db.session.query(
        func.coalesce(func.sum(Transaction.bottles), 0),
        func.coalesce(func.sum(Transaction.cans), 0),
    ).filter(Transaction.status == "accepted").one()

    def total(payout):
        return int(db.session.query(func.coalesce(func.sum(Transaction.amount), 0))
                   .filter(Transaction.status == "accepted", Transaction.payout == payout).scalar())

    guest_items = db.session.query(func.coalesce(func.sum(Transaction.bottles + Transaction.cans), 0)).filter(
        Transaction.status == "accepted", Transaction.user_id.is_(None)).scalar()
    by_status = dict(db.session.query(Transaction.status, func.count()).group_by(Transaction.status).all())
    pb, pc = settings.get_prices()
    return jsonify({
        "bottles": int(acc[0]), "cans": int(acc[1]),
        "paid": total("transfer"), "charity": total("charity"), "guest_items": int(guest_items),
        "transactions": sum(by_status.values()), "by_status": by_status,
        "rejected_count": by_status.get("rejected", 0) + by_status.get("scan_failed", 0),
        "users": User.query.filter_by(is_active=True).count(),
        "station": {"storage_count": st.storage_count, "storage_capacity": st.storage_capacity,
                    "is_full": bool(st.is_full),
                    "last_emptied_at": st.last_emptied_at.isoformat(" ", "minutes") if st.last_emptied_at else None},
        "prices": {"bottle": pb, "can": pc},
    })


@bp.get("/api/admin/charity")
@admin_required
def charity():
    """Quỹ từ thiện: tổng + các lượt góp gần nhất (gộp theo thời điểm chọn)."""
    rows = (db.session.query(Transaction.user_id, Transaction.paid_at, func.sum(Transaction.amount),
                             func.sum(Transaction.bottles), func.sum(Transaction.cans))
            .filter(Transaction.payout == "charity")
            .group_by(Transaction.user_id, Transaction.paid_at)
            .order_by(Transaction.paid_at.desc()).limit(50).all())
    users = {u.id: u for u in User.query.filter(User.id.in_({r[0] for r in rows})).all()} if rows else {}
    names = display_names(list(users.values())) if users else {}
    total = db.session.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(
        Transaction.payout == "charity").scalar()
    return jsonify({
        "total": int(total),
        "donors": db.session.query(func.count(func.distinct(Transaction.user_id))).filter(
            Transaction.payout == "charity").scalar(),
        "items": [{"user": names.get(uid, "?"), "paid_at": paid.isoformat(" ", "seconds") if paid else None,
                   "amount": int(amt), "bottles": int(b), "cans": int(c)} for uid, paid, amt, b, c in rows],
    })


@bp.get("/api/admin/users")
@admin_required
def users():
    rows = User.query.filter_by(is_active=True).order_by(User.created_at.desc()).all()
    counts = dict(db.session.query(Transaction.user_id, func.count()).group_by(Transaction.user_id).all())
    names = display_names(rows)
    return jsonify([{
        "id": u.id, "name": u.name, "display_name": names[u.id], "masked_account": u.masked_account,
        "total_received": int(u.total_received), "total_donated": int(u.total_donated),
        "transactions": counts.get(u.id, 0),
        "created_at": u.created_at.isoformat(" ", "minutes"),
        "last_used_at": u.last_used_at.isoformat(" ", "minutes") if u.last_used_at else None,
    } for u in rows])


@bp.delete("/api/admin/users/<int:user_id>")
@admin_required
def delete_user(user_id):
    user = db.session.get(User, user_id)
    if not user or not user.is_active:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    if current_app.extensions["station"].user_id == user_id:
        return jsonify({"error": "Người dùng đang sử dụng trạm"}), 409
    user.is_active = False  # xóa mềm, giữ lịch sử giao dịch
    db.session.commit()
    return jsonify({"ok": True})


@bp.get("/api/admin/transactions")
@admin_required
def transactions():
    q = Transaction.query.outerjoin(User)
    if request.args.get("user_id") == "guest":
        q = q.filter(Transaction.user_id.is_(None))
    elif request.args.get("user_id"):
        q = q.filter(Transaction.user_id == int(request.args["user_id"]))
    if request.args.get("status"):
        q = q.filter(Transaction.status == request.args["status"])
    if request.args.get("source"):
        q = q.filter(Transaction.source == request.args["source"])
    if request.args.get("payout") == "none":
        q = q.filter(Transaction.payout.is_(None))
    elif request.args.get("payout"):
        q = q.filter(Transaction.payout == request.args["payout"])
    try:
        if request.args.get("date_from"):
            q = q.filter(Transaction.created_at >= datetime.fromisoformat(request.args["date_from"]))
        if request.args.get("date_to"):
            q = q.filter(Transaction.created_at < datetime.fromisoformat(request.args["date_to"]) + timedelta(days=1))
    except ValueError:
        return jsonify({"error": "Ngày không hợp lệ (YYYY-MM-DD)"}), 400
    limit = min(int(request.args.get("limit", 100)), 500)
    rows = q.order_by(Transaction.created_at.desc()).limit(limit).all()
    return jsonify([{
        "id": t.id, "user": t.user.name if t.user else "Khách", "user_id": t.user_id,
        "masked_account": t.user.masked_account if t.user else "",
        "source": t.source, "payout": t.payout,
        "paid_at": t.paid_at.isoformat(" ", "seconds") if t.paid_at else None,
        "bottles": t.bottles, "cans": t.cans, "amount": t.amount, "status": t.status,
        "scan_attempts": t.scan_attempts, "price_bottle": t.price_bottle, "price_can": t.price_can,
        "image_url": f"/media/{t.image_path}" if t.image_path else None,
        "rejected": [{"label": r.label, "label_vi": current_app.config["LABEL_VI"].get(r.label, r.label),
                      "confidence": float(r.confidence), "crop_url": f"/media/{r.crop_path}"} for r in t.rejected_items],
        "created_at": t.created_at.isoformat(" ", "seconds"),
    } for t in rows])


@bp.post("/api/admin/empty-storage")
@admin_required
def empty_storage():
    current_app.extensions["station"].empty_storage()
    return jsonify({"ok": True})


@bp.post("/api/admin/settings")
@admin_required
def update_settings():
    data = request.get_json(silent=True) or {}
    changes = {}
    for key, field in (("price_bottle", "price_bottle"), ("price_can", "price_can")):
        if field in data:
            try:
                v = int(data[field])
            except (TypeError, ValueError):
                return jsonify({"error": "Giá phải là số nguyên"}), 400
            if not 0 <= v <= 100_000:
                return jsonify({"error": "Giá phải trong khoảng 0 – 100.000đ"}), 400
            changes[key] = v
    if "storage_capacity" in data:
        try:
            cap = int(data["storage_capacity"])
        except (TypeError, ValueError):
            return jsonify({"error": "Sức chứa phải là số nguyên"}), 400
        if not 10 <= cap <= 100_000:
            return jsonify({"error": "Sức chứa phải trong khoảng 10 – 100.000"}), 400
        st = settings.get_station()
        st.storage_capacity = cap
        st.is_full = st.storage_count >= cap
        db.session.commit()
    for k, v in changes.items():
        settings.set_setting(k, v)
    _broadcast()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ công cụ mô phỏng (panel Dev)
@bp.post("/api/dev/detector")
def dev_set_detector():
    """Chỉ dùng cho bản mô phỏng: đổi bộ nhận diện {"kind": "yolo" | "mock"} (model thật / giả lập theo đáp án 3D)."""
    if not current_app.config.get("SIM_DEV_TOOLS"):
        return jsonify({"error": "Đã tắt công cụ dev"}), 403
    kind = str((request.get_json(silent=True) or {}).get("kind", ""))
    ok, err = current_app.extensions["station"].set_detector(kind)
    if not ok:
        return jsonify({"error": err}), 409
    return jsonify({"ok": True, "kind": kind})


@bp.post("/api/dev/fill-storage")
def dev_fill_storage():
    """Chỉ dùng cho bản mô phỏng: ép kho đầy để thử kịch bản 'trạm đầy'."""
    if not current_app.config.get("SIM_DEV_TOOLS"):
        return jsonify({"error": "Đã tắt công cụ dev"}), 403
    st = settings.get_station()
    st.storage_count = st.storage_capacity
    st.is_full = True
    db.session.commit()
    _broadcast()
    return jsonify({"ok": True})


_ = (Setting, RejectedItem)  # import để SQLAlchemy biết quan hệ
