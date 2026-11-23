"""Trang quản trị trung tâm (mọi trạm) + API admin (đăng nhập bằng mật khẩu trong .env).

Quản lý: trạm (mã trạm theo tỉnh, địa chỉ, bản đồ), người dùng (số điện thoại, dùng chung mọi trạm), giao dịch,
lượt nhận tiền, voucher, cửa hàng / nhà xe nhận voucher, sự cố an ninh (camera giám sát), cấu hình chung.
"""
import hmac
from datetime import datetime, timedelta
from functools import wraps

from flask import (Blueprint, abort, current_app, jsonify, redirect, render_template, request, send_from_directory,
                   session, url_for)
from sqlalchemy import func

from app.models import (SECURITY_KINDS, SECURITY_STATUSES, Merchant, Order, Payout, Product, RejectedItem,
                        SecurityEvent, Setting, Station, Transaction, User, Voucher, db)
from app.services import settings_service as settings
from app.services import order_service, station_service, user_service, voucher_service

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


def _app():
    return current_app._get_current_object()


def _ctrl(sid, create=True):
    from app import get_controller
    return get_controller(_app(), sid, create=create)


def _running():
    return _app().extensions["stations"]


def _broadcast_all():
    for c in list(_running().values()):
        c.broadcast()


def _station_arg():
    """?station=all | <id> -> None (tất cả) hoặc id trạm."""
    v = request.args.get("station", "all")
    return None if v in ("", "all") else int(v)


def _iso(d, spec="minutes"):
    return d.isoformat(" ", spec) if d else None


def _int(data, key, lo, hi, label):
    try:
        v = int(data[key])
    except (TypeError, ValueError, KeyError):
        raise ValueError(f"{label} phải là số nguyên")
    if not lo <= v <= hi:
        raise ValueError(f"{label} phải trong khoảng {lo:,} – {hi:,}".replace(",", "."))
    return v


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
    session.pop("admin", None)
    return redirect(url_for("admin.login"))


@bp.get("/admin")
@admin_required
def dashboard():
    return render_template("admin/dashboard.html")


# ------------------------------------------------------------------ tổng quan
@bp.get("/api/admin/overview")
@admin_required
def overview():
    sid = _station_arg()
    tx = Transaction.query.filter(Transaction.status == "accepted")
    po = Payout.query
    vq = Voucher.query
    if sid:
        tx, po, vq = tx.filter(Transaction.station_id == sid), po.filter(Payout.station_id == sid), vq.filter(Voucher.station_id == sid)
    bottles = int(tx.with_entities(func.coalesce(func.sum(Transaction.bottles), 0)).scalar())
    cans = int(tx.with_entities(func.coalesce(func.sum(Transaction.cans), 0)).scalar())
    guest = int(tx.filter(Transaction.user_id.is_(None), Transaction.source == "slot")
                .with_entities(func.coalesce(func.sum(Transaction.bottles + Transaction.cans), 0)).scalar())

    def paid(method):
        return int(po.filter(Payout.method == method).with_entities(func.coalesce(func.sum(Payout.amount), 0)).scalar())

    rejected = Transaction.query.filter(Transaction.status.in_(("rejected", "scan_failed")))
    if sid:
        rejected = rejected.filter(Transaction.station_id == sid)
    used = vq.filter(Voucher.status == "used")
    return jsonify({
        "bottles": bottles, "cans": cans, "guest_items": guest,
        "transfer": paid("transfer"), "charity": paid("charity"), "voucher": paid("voucher"),
        "voucher_used": int(used.with_entities(func.coalesce(func.sum(Voucher.amount), 0)).scalar()),
        "held": int(db.session.query(func.coalesce(func.sum(User.balance), 0)).scalar()),
        "rejected_count": rejected.count(),
        "users": User.query.filter_by(is_active=True).count(),
        "security_new": (SecurityEvent.query.filter_by(status="new", station_id=sid) if sid
                         else SecurityEvent.query.filter_by(status="new")).count(),
        "new_users": (User.query.filter_by(created_station_id=sid).count() if sid else User.query.count()),
        "prices": dict(zip(("bottle", "can"), settings.get_prices())),
        "settings": {k: settings.get_int(k) for k in ("payout_timeout_sec", "voucher_days", "public_capacity",
                                                      "idle_timeout_sec", "security_reject_session",
                                                      "security_reject_day", "security_cooldown_sec")},
    })


# ------------------------------------------------------------------ trạm
def _station_dict(st: Station) -> dict:
    c = _running().get(st.id)
    snap_user = None
    if c and c.user_id:
        u = db.session.get(User, c.user_id)
        snap_user = f"{u.name} ({u.phone})" if u else None
    return {
        **station_service.station_info(st), "is_active": bool(st.is_active),
        "storage_count": st.storage_count, "storage_capacity": st.storage_capacity, "is_full": bool(st.is_full),
        "bins": {"bottle": st.bin_bottle, "can": st.bin_can, "other": st.bin_other},
        "public": {"left": st.public_left, "right": st.public_right, "capacity": settings.get_int("public_capacity")},
        "last_emptied_at": _iso(st.last_emptied_at),
        "online": c is not None, "state": c.state if c else None, "user": snap_user,
        "sorting": bool(c and c._sorter_running), "funnel_jam": bool(c and c.funnel["jam"]),
        "maintenance": bool(c and c.maintenance),
        "camera_blocked": bool(c and c.camera_blocked),
        "security_new": SecurityEvent.query.filter_by(station_id=st.id, status="new").count(),
        "today_items": int(db.session.query(func.coalesce(func.sum(Transaction.bottles + Transaction.cans), 0))
                           .filter(Transaction.station_id == st.id, Transaction.status == "accepted",
                                   Transaction.created_at >= datetime.now().replace(hour=0, minute=0, second=0))
                           .scalar()),
    }


@bp.get("/api/admin/stations")
@admin_required
def stations():
    return jsonify([_station_dict(s) for s in Station.query.order_by(Station.id).all()])


@bp.get("/api/admin/provinces")
@admin_required
def provinces():
    return jsonify([{"code": c, "name": n} for c, n in station_service.PROVINCES])


@bp.post("/api/admin/stations")
@admin_required
def create_station():
    """Tạo trạm: tên + địa chỉ (số nhà / đường, phường / xã, tỉnh) + tọa độ. Mã trạm cấp tự động theo tỉnh."""
    data = request.get_json(silent=True) or {}
    try:
        cap = _int(data, "storage_capacity", 10, 100_000, "Sức chứa") if "storage_capacity" in data else 300
        st = station_service.create_station(data.get("name"), data)
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    st.storage_capacity = cap
    db.session.commit()
    return jsonify(_station_dict(st)), 201


@bp.patch("/api/admin/stations/<int:sid>")
@admin_required
def update_station(sid):
    st = db.session.get(Station, sid)
    if st is None:
        return jsonify({"error": "Không tìm thấy trạm"}), 404
    data = request.get_json(silent=True) or {}
    try:
        if "name" in data:
            name = " ".join(str(data["name"]).split())
            if not name:
                raise ValueError("Tên trạm không được trống")
            st.name = name[:100]
        station_service.apply_address(st, data)      # mã trạm không đổi; địa chỉ + tọa độ sửa được
        if "storage_capacity" in data:
            st.storage_capacity = _int(data, "storage_capacity", 10, 100_000, "Sức chứa")
            st.is_full = st.storage_count >= st.storage_capacity
        if "is_active" in data:
            c = _running().get(sid)
            if not data["is_active"] and c and c.user_id:
                raise ValueError("Trạm đang có người sử dụng")
            st.is_active = bool(data["is_active"])
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    db.session.commit()
    if sid in _running():
        _running()[sid].broadcast()
    return jsonify(_station_dict(st))


@bp.post("/api/admin/stations/<int:sid>/empty-storage")
@admin_required
def empty_storage(sid):
    c = _ctrl(sid)
    if c is None:
        return jsonify({"error": "Không tìm thấy trạm"}), 404
    c.empty_storage()
    return jsonify({"ok": True})


@bp.post("/api/admin/stations/<int:sid>/empty-public")
@admin_required
def empty_public(sid):
    """Nhân viên đã đổ thùng rác mini {"side": "left" | "right" | "all"}."""
    c = _ctrl(sid)
    side = str((request.get_json(silent=True) or {}).get("side", "all"))
    if c is None or not c.empty_public(side):
        return jsonify({"error": "Thùng không hợp lệ"}), 400
    return jsonify({"ok": True})


@bp.post("/api/admin/stations/<int:sid>/clear-jam")
@admin_required
def clear_jam(sid):
    """Nhân viên đã gỡ vật kẹt trong phễu -> máy kiểm tra lại camera băng chuyền, chạy tiếp."""
    c = _running().get(sid)
    if c is None or not c.clear_jam():
        return jsonify({"error": "Phễu không bị kẹt"}), 400
    return jsonify({"ok": True})


# ------------------------------------------------------------------ người dùng (dùng chung mọi trạm)
def _in_use(user_id: int) -> int | None:
    for sid, c in _running().items():
        if c.user_id == user_id:
            return sid
    return None


@bp.get("/api/admin/users")
@admin_required
def users():
    rows = user_service.search_users(request.args.get("q"), limit=300)
    counts = dict(db.session.query(Transaction.user_id, func.count()).filter(
        Transaction.user_id.in_([u.id for u in rows])).group_by(Transaction.user_id).all()) if rows else {}
    return jsonify([{**user_service.admin_user_dict(u), "transactions": counts.get(u.id, 0)} for u in rows])


@bp.post("/api/admin/users")
@admin_required
def create_user():
    data = request.get_json(silent=True) or {}
    try:
        u = user_service.create_user(str(data.get("phone", "")), str(data.get("name", "")))
    except user_service.UserError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(user_service.admin_user_dict(u)), 201


@bp.get("/api/admin/users/<int:user_id>")
@admin_required
def user_detail(user_id):
    u = db.session.get(User, user_id)
    if u is None:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    pos = Payout.query.filter_by(user_id=u.id).order_by(Payout.created_at.desc()).limit(30).all()
    vs = Voucher.query.filter_by(user_id=u.id).order_by(Voucher.created_at.desc()).limit(30).all()
    stats = db.session.query(Transaction.station_id, func.count(), func.sum(Transaction.bottles),
                             func.sum(Transaction.cans)).filter(
        Transaction.user_id == u.id, Transaction.status == "accepted").group_by(Transaction.station_id).all()
    return jsonify({
        **user_service.admin_user_dict(u), "in_use_at": _in_use(u.id),
        "by_station": [{"station_id": s, "visits": n, "bottles": int(b or 0), "cans": int(c or 0)} for s, n, b, c in stats],
        "payouts": [_payout_dict(p) for p in pos],
        "vouchers": [voucher_service.voucher_to_dict(v) for v in vs],
    })


@bp.patch("/api/admin/users/<int:user_id>")
@admin_required
def update_user(user_id):
    u = db.session.get(User, user_id)
    if u is None:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    data = request.get_json(silent=True) or {}
    if data.get("is_active") is False and _in_use(u.id):
        return jsonify({"error": "Người dùng đang sử dụng trạm"}), 409
    try:
        user_service.update_user(u, phone=data.get("phone"), name=data.get("name"), is_active=data.get("is_active"))
    except user_service.UserError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    return jsonify(user_service.admin_user_dict(u))


@bp.delete("/api/admin/users/<int:user_id>")
@admin_required
def delete_user(user_id):
    """Xóa hẳn người dùng (giao dịch, lượt nhận tiền, voucher giữ lại nhưng ẩn danh)."""
    u = db.session.get(User, user_id)
    if u is None:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    if _in_use(u.id):
        return jsonify({"error": "Người dùng đang sử dụng trạm"}), 409
    if u.balance:
        return jsonify({"error": f"Người dùng còn {u.balance:,}đ số dư chưa nhận".replace(",", ".")}), 409
    Transaction.query.filter_by(user_id=u.id).update({"user_id": None})
    Payout.query.filter_by(user_id=u.id).update({"user_id": None})
    Voucher.query.filter_by(user_id=u.id).update({"user_id": None})
    db.session.delete(u)
    db.session.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ giao dịch / lượt nhận tiền
@bp.get("/api/admin/transactions")
@admin_required
def transactions():
    q = Transaction.query.outerjoin(User)
    sid = _station_arg()
    if sid:
        q = q.filter(Transaction.station_id == sid)
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
        "id": t.id, "station_id": t.station_id,
        "user": t.user.name if t.user else ("Khách (lỗ từ thiện)" if t.source == "slot" else "Đã xóa"),
        "phone": t.user.phone if t.user else "", "user_id": t.user_id,
        "source": t.source, "payout": t.payout, "paid_at": _iso(t.paid_at, "seconds"),
        "bottles": t.bottles, "cans": t.cans, "amount": t.amount, "status": t.status,
        "scan_attempts": t.scan_attempts, "price_bottle": t.price_bottle, "price_can": t.price_can,
        "image_url": f"/media/{t.image_path}" if t.image_path else None,
        "rejected": [{"label": r.label, "label_vi": current_app.config["LABEL_VI"].get(r.label, r.label),
                      "confidence": float(r.confidence), "crop_url": f"/media/{r.crop_path}"} for r in t.rejected_items],
        "created_at": _iso(t.created_at, "seconds"),
    } for t in rows])


def _payout_dict(p: Payout) -> dict:
    u = db.session.get(User, p.user_id) if p.user_id else None
    v = db.session.get(Voucher, p.voucher_id) if p.voucher_id else None
    return {"id": p.id, "station_id": p.station_id, "method": p.method, "amount": p.amount,
            "user": u.name if u else "Đã xóa", "phone": u.phone if u else "",
            "bank": p.bank, "account": f"****{p.account_last4}" if p.account_last4 else None,
            "voucher": v.code if v else None, "created_at": _iso(p.created_at, "seconds")}


@bp.get("/api/admin/payouts")
@admin_required
def payouts():
    q = Payout.query
    sid = _station_arg()
    if sid:
        q = q.filter(Payout.station_id == sid)
    if request.args.get("method"):
        q = q.filter(Payout.method == request.args["method"])
    rows = q.order_by(Payout.created_at.desc()).limit(min(int(request.args.get("limit", 100)), 500)).all()
    return jsonify([_payout_dict(p) for p in rows])


# ------------------------------------------------------------------ voucher
@bp.get("/api/admin/vouchers")
@admin_required
def vouchers():
    q = Voucher.query
    sid = _station_arg()
    if sid:
        q = q.filter(Voucher.station_id == sid)
    st = request.args.get("status")
    now = datetime.now()
    if st == "active":
        q = q.filter(Voucher.status == "active", Voucher.expires_at >= now)
    elif st == "expired":
        q = q.filter(Voucher.status == "active", Voucher.expires_at < now)
    elif st in ("used", "void"):
        q = q.filter(Voucher.status == st)
    if request.args.get("q"):
        code = voucher_service.normalize_code(request.args["q"])
        q = q.filter(Voucher.code.like(f"%{code}%") | Voucher.code.like(f"%{request.args['q'].upper()}%"))
    rows = q.order_by(Voucher.created_at.desc()).limit(300).all()
    users = {u.id: u for u in User.query.filter(User.id.in_({v.user_id for v in rows if v.user_id})).all()} if rows else {}
    return jsonify([{**voucher_service.voucher_to_dict(v),
                     "user": users[v.user_id].name if v.user_id in users else "",
                     "phone": users[v.user_id].phone if v.user_id in users else ""} for v in rows])


@bp.post("/api/admin/vouchers/<int:vid>/void")
@admin_required
def void_voucher(vid):
    v = db.session.get(Voucher, vid)
    if v is None:
        return jsonify({"error": "Không tìm thấy voucher"}), 404
    if v.status != "active":
        return jsonify({"error": "Chỉ hủy được voucher chưa dùng"}), 400
    v.status = "void"
    db.session.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ cửa hàng / nhà xe
@bp.get("/api/admin/merchants")
@admin_required
def merchants():
    return jsonify([voucher_service.merchant_to_dict(m) for m in Merchant.query.order_by(Merchant.id).all()])


@bp.post("/api/admin/merchants")
@admin_required
def create_merchant():
    d = request.get_json(silent=True) or {}
    try:
        m = voucher_service.create_merchant(str(d.get("code", "")), str(d.get("name", "")), str(d.get("pin", "")),
                                            str(d.get("kind", "shop")), d.get("address"))
    except voucher_service.VoucherError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(voucher_service.merchant_to_dict(m)), 201


@bp.patch("/api/admin/merchants/<int:mid>")
@admin_required
def update_merchant(mid):
    m = db.session.get(Merchant, mid)
    if m is None:
        return jsonify({"error": "Không tìm thấy cửa hàng"}), 404
    d = request.get_json(silent=True) or {}
    try:
        if d.get("pin"):
            voucher_service.set_merchant_pin(m, str(d["pin"]))
        if "name" in d and " ".join(str(d["name"]).split()):
            m.name = " ".join(str(d["name"]).split())[:100]
        if "address" in d:
            m.address = str(d["address"] or "").strip()[:200] or None
        if "kind" in d and d["kind"] in voucher_service.MERCHANT_KINDS:
            m.kind = d["kind"]
        if "is_active" in d:
            m.is_active = bool(d["is_active"])
        if "is_demo" in d:       # quầy thu ngân demo trong mô phỏng 3D vào thẳng tài khoản này (không cần PIN)
            m.is_demo = bool(d["is_demo"])
        db.session.commit()
    except voucher_service.VoucherError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(voucher_service.merchant_to_dict(m))


# ------------------------------------------------------------------ an ninh (camera giám sát trên màn hình trạm)
def _security_dict(e: SecurityEvent) -> dict:
    st = db.session.get(Station, e.station_id)
    return {
        "id": e.id, "station_id": e.station_id, "station_code": st.code if st else None, "kind": e.kind,
        "detail": e.detail, "status": e.status, "note": e.note,
        "user": {"id": e.user.id, "name": e.user.name, "phone": e.user.phone, "is_active": e.user.is_active}
                if e.user else None,
        "image_url": f"/api/admin/security/{e.id}/image" if e.image_path else None,
        "before_url": f"/api/admin/security/{e.id}/image?before=1" if e.before_path else None,
        "created_at": _iso(e.created_at, "seconds"), "resolved_at": _iso(e.resolved_at),
    }


@bp.get("/api/admin/security")
@admin_required
def security_events():
    q = SecurityEvent.query
    sid = _station_arg()
    if sid:
        q = q.filter(SecurityEvent.station_id == sid)
    if request.args.get("kind") in SECURITY_KINDS:
        q = q.filter(SecurityEvent.kind == request.args["kind"])
    if request.args.get("status") in SECURITY_STATUSES:
        q = q.filter(SecurityEvent.status == request.args["status"])
    if request.args.get("user"):
        q = q.filter(SecurityEvent.user_id == int(request.args["user"]))
    rows = q.order_by(SecurityEvent.created_at.desc(), SecurityEvent.id.desc()).limit(200).all()
    return jsonify({"items": [_security_dict(e) for e in rows],
                    "new": SecurityEvent.query.filter_by(status="new").count()})


@bp.patch("/api/admin/security/<int:eid>")
@admin_required
def update_security(eid):
    e = db.session.get(SecurityEvent, eid)
    if e is None:
        return jsonify({"error": "Không tìm thấy sự cố"}), 404
    d = request.get_json(silent=True) or {}
    if "status" in d:
        if d["status"] not in SECURITY_STATUSES:
            return jsonify({"error": "Trạng thái không hợp lệ"}), 400
        e.status = d["status"]
        e.resolved_at = datetime.now() if e.status == "resolved" else None
    if "note" in d:
        e.note = " ".join(str(d["note"] or "").split())[:255] or None
    db.session.commit()
    return jsonify(_security_dict(e))


@bp.get("/api/admin/security/<int:eid>/image")
@admin_required
def security_image(eid):
    """Ảnh camera giám sát (có hình người dùng) – chỉ admin xem được, không để ở /media công khai."""
    e = db.session.get(SecurityEvent, eid)
    path = e and (e.before_path if request.args.get("before") else e.image_path)
    if not path:
        abort(404)
    return send_from_directory(current_app.config["DATA_DIR"], path)


# ------------------------------------------------------------------ sản phẩm + đơn bán ở quầy
@bp.get("/api/admin/merchants/<int:mid>/products")
@admin_required
def merchant_products(mid):
    m = db.session.get(Merchant, mid)
    if m is None:
        return jsonify({"error": "Không tìm thấy cửa hàng"}), 404
    return jsonify([order_service.product_to_dict(p) for p in order_service.products(m, active_only=False)])


@bp.post("/api/admin/merchants/<int:mid>/products")
@admin_required
def create_product(mid):
    if db.session.get(Merchant, mid) is None:
        return jsonify({"error": "Không tìm thấy cửa hàng"}), 404
    d = request.get_json(silent=True) or {}
    p = Product(merchant_id=mid, category="khac")
    try:
        order_service.apply_product(p, {"name": d.get("name"), "price": d.get("price"), **d})
    except order_service.OrderError as e:
        return jsonify({"error": str(e)}), 400
    db.session.add(p)
    db.session.commit()
    return jsonify(order_service.product_to_dict(p)), 201


@bp.patch("/api/admin/products/<int:pid>")
@admin_required
def update_product(pid):
    p = db.session.get(Product, pid)
    if p is None:
        return jsonify({"error": "Không tìm thấy sản phẩm"}), 404
    try:
        order_service.apply_product(p, request.get_json(silent=True) or {})
    except order_service.OrderError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    db.session.commit()
    return jsonify(order_service.product_to_dict(p))


@bp.get("/api/admin/orders")
@admin_required
def admin_orders():
    q = Order.query
    if request.args.get("merchant"):
        q = q.filter(Order.merchant_id == int(request.args["merchant"]))
    rows = q.order_by(Order.id.desc()).limit(100).all()
    names = {m.id: m.name for m in Merchant.query.all()}
    return jsonify([order_service.order_to_dict(o) | {"merchant": names.get(o.merchant_id)} for o in rows])


# ------------------------------------------------------------------ quỹ từ thiện
@bp.get("/api/admin/charity")
@admin_required
def charity():
    q = Payout.query.filter(Payout.method == "charity")
    sid = _station_arg()
    if sid:
        q = q.filter(Payout.station_id == sid)
    rows = q.order_by(Payout.created_at.desc()).limit(50).all()
    total = int(q.with_entities(func.coalesce(func.sum(Payout.amount), 0)).scalar())
    donors = q.with_entities(func.count(func.distinct(Payout.user_id))).scalar()
    guest = Transaction.query.filter(Transaction.source == "slot", Transaction.status == "accepted")
    if sid:
        guest = guest.filter(Transaction.station_id == sid)
    return jsonify({"total": total, "donors": donors, "slot_items": guest.count(),
                    "items": [_payout_dict(p) for p in rows]})


# ------------------------------------------------------------------ cấu hình chung
@bp.post("/api/admin/settings")
@admin_required
def update_settings():
    data = request.get_json(silent=True) or {}
    rules = {"price_bottle": (0, 100_000, "Giá chai"), "price_can": (0, 100_000, "Giá lon"),
             "payout_timeout_sec": (15, 600, "Thời gian chọn cách nhận"), "voucher_days": (1, 365, "Hạn voucher"),
             "public_capacity": (5, 1000, "Sức chứa thùng rác mini"), "idle_timeout_sec": (30, 1800, "Tự đăng xuất"),
             "security_reject_session": (1, 50, "Số lần rác lạ / phiên"), "security_reject_day": (1, 200, "Số lần rác lạ / 24 giờ"),
             "security_cooldown_sec": (0, 3600, "Thời gian chờ báo lại")}
    try:
        changes = {k: _int(data, k, *rules[k]) for k in rules if k in data}
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    for k, v in changes.items():
        settings.set_setting(k, v)
    _broadcast_all()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ công cụ mô phỏng (panel Dev)
@bp.post("/api/dev/detector")
def dev_set_detector():
    """Chỉ dùng cho bản mô phỏng: đổi bộ nhận diện {"kind": "yolo" | "mock"} cho MỌI trạm trên server."""
    if not current_app.config.get("SIM_DEV_TOOLS"):
        return jsonify({"error": "Đã tắt công cụ dev"}), 403
    kind = str((request.get_json(silent=True) or {}).get("kind", ""))
    if any(c.busy for c in _running().values()):
        return jsonify({"error": "Có trạm đang xử lý, đổi sau khi xong"}), 409
    for c in list(_running().values()):
        ok, err = c.set_detector(kind)
        if not ok:
            return jsonify({"error": err}), 409
    return jsonify({"ok": True, "kind": kind})


@bp.post("/api/dev/fill-storage")
def dev_fill_storage():
    """Chỉ dùng cho bản mô phỏng: ép kho đầy để thử kịch bản 'trạm đầy' {"station": id}."""
    if not current_app.config.get("SIM_DEV_TOOLS"):
        return jsonify({"error": "Đã tắt công cụ dev"}), 403
    sid = int((request.get_json(silent=True) or {}).get("station") or current_app.config["STATION_ID"])
    st = settings.get_station(sid)
    st.storage_count = st.storage_capacity
    st.is_full = True
    db.session.commit()
    if sid in _running():
        _running()[sid].broadcast()
    return jsonify({"ok": True})


_ = (Setting, RejectedItem)  # import để SQLAlchemy biết quan hệ
