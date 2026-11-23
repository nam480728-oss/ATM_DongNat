"""Chuyển khoản / từ thiện, lỗ từ thiện (vật rơi thẳng xuống băng chuyền), thùng công cộng, cửa sau + xe thùng."""
import time

import re

from app.models import Payout, Station, Transaction, User, Voucher, db
from app.services.user_service import create_user
from app.station import controller as C

from .test_admin import login as admin_login
from .test_controller import put


def login(ctx, name="Lan", phone="0905550001"):
    with ctx["app"].app_context():
        uid = create_user(phone, name).id
    assert ctx["ctrl"].select_user(uid)
    return uid


def codes(ctx):
    return [d["code"] for e, d in ctx["events"] if e == "screen:message"]


def get_user(ctx, uid):
    with ctx["app"].app_context():
        u = db.session.get(User, uid)
        return int(u.total_received), int(u.total_donated)


# ------------------------------------------------------------------ 3 cách nhận tiền
def test_transfer_needs_bank_and_account_and_stores_only_last4(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "bottle_500", "can_tall")
    snap = ctrl.snapshot()
    assert snap["state"] == C.RESULT and snap["pending"]["amount"] == 500
    assert snap["payout_in"] is not None and 55 <= snap["payout_in"] <= 60
    assert ctrl.payout("transfer", bank="Ngân hàng X", account="0123456789")["ok"] is False
    assert "6–19" in ctrl.payout("transfer", bank="BIDV", account="12")["error"]
    assert ctrl.payout("transfer", bank="BIDV", account="0123 4567 89")["ok"]
    assert get_user(ctx, uid) == (500, 0)
    snap = ctrl.snapshot()
    assert snap["pending"]["amount"] == 0 and snap["last_payout"]["account"] == "****6789"
    assert snap["payout_in"] is None
    assert ctrl.payout("charity")["ok"] is False          # không trả 2 lần
    with ctx["app"].app_context():
        tx = Transaction.query.one()
        po = Payout.query.one()
        assert tx.payout == "transfer" and tx.payout_id == po.id
        assert (po.bank, po.account_last4, po.amount) == ("BIDV", "6789", 500)
        assert "0123456789" not in repr(po.__dict__)       # STK đầy đủ không lưu ở đâu


def test_charity_goes_to_fund(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "can_short")
    assert ctrl.payout("charity")["ok"]
    assert get_user(ctx, uid) == (0, 300)
    assert any(e == "payout" and d["method"] == "charity" for e, d in ctx["events"])
    c = ctx["client"]
    admin_login(c)
    ch = c.get("/api/admin/charity").get_json()
    assert ch["total"] == 300 and ch["donors"] == 1 and ch["items"][0]["user"] == "Lan"
    s = c.get("/api/admin/overview").get_json()
    assert (s["transfer"], s["charity"]) == (0, 300)


def test_voucher_qr_then_shop_redeems_once(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "bottle_500", "bottle_500", "can_tall")
    assert ctrl.payout("voucher", base_url="http://192.168.1.5:5000/")["ok"]
    v = ctrl.snapshot()["last_payout"]["voucher"]
    assert v["amount"] == 700 and v["status"] == "active" and re.match(r"^DN-[A-Z2-9]{4}-[A-Z2-9]{4}$", v["code"])
    assert v["url"] == f"http://192.168.1.5:5000/v/{v['code']}" and v["qr_svg"].startswith("<svg")
    with ctx["app"].app_context():
        assert int(db.session.get(User, uid).total_voucher) == 700

    c = ctx["client"]
    admin_login(c)
    r = c.post("/api/admin/merchants", json={"code": "XEBUYT01", "name": "Nhà xe Bến Thành", "kind": "parking", "pin": "1234"})
    assert r.status_code == 201
    shop = ctx["app"].test_client()
    assert shop.post("/api/shop/redeem", json={"code": v["code"]}).status_code == 401
    assert shop.post("/api/shop/login", json={"code": "xebuyt01", "pin": "9999"}).status_code == 401
    assert shop.post("/api/shop/login", json={"code": "xebuyt01", "pin": "1234"}).status_code == 200
    assert shop.get(f"/v/{v['code']}").status_code == 302
    raw = v["code"].replace("DN-", "").replace("-", "").lower()
    assert shop.get(f"/api/shop/voucher/{raw}").get_json()["amount"] == 700      # gõ tay không dấu gạch
    r = shop.post("/api/shop/redeem", json={"code": v["code"]})
    assert r.status_code == 200 and r.get_json()["status"] == "used" and r.get_json()["merchant"] == "Nhà xe Bến Thành"
    r = shop.post("/api/shop/redeem", json={"code": v["code"]})
    assert r.status_code == 400 and "đã được dùng" in r.get_json()["error"]
    vs = c.get("/api/admin/vouchers?status=used").get_json()
    assert vs[0]["code"] == v["code"] and vs[0]["phone"] == "0905550001"


def test_expired_and_void_voucher_rejected(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "can_short")
    ctrl.payout("voucher")
    code = ctrl.last_payout["voucher"]["code"]
    with ctx["app"].app_context():
        from datetime import datetime, timedelta

        from app.services import voucher_service
        voucher_service.create_merchant("SHOP1", "Tạp hóa", "4321")
        v = Voucher.query.filter_by(code=code).one()
        v.expires_at = datetime.now() - timedelta(minutes=1)
        db.session.commit()
    shop = ctx["app"].test_client()
    shop.post("/api/shop/login", json={"code": "SHOP1", "pin": "4321"})
    assert "hết hạn" in shop.post("/api/shop/redeem", json={"code": code}).get_json()["error"]


def test_second_batch_while_payout_pending_adds_up(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "can_short")
    put(ctx, "bottle_500")                     # bỏ tiếp khi chưa chọn
    assert ctrl.snapshot()["pending"]["amount"] == 500
    ctrl.payout("charity")
    assert get_user(ctx, uid) == (0, 500)


def test_invalid_method_rejected(ctx):
    login(ctx)
    put(ctx, "can_short")
    assert ctx["ctrl"].payout("bitcoin")["ok"] is False
    assert ctx["ctrl"].snapshot()["pending"]["amount"] == 300


def test_timeout_holds_money_as_balance_then_claim_at_other_station(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "bottle_500")
    ctrl.payout_deadline = time.monotonic() - 0.1  # giả lập đã hết giờ chọn
    ctrl.tick()
    assert get_user(ctx, uid) == (0, 0) and "held" in codes(ctx)
    snap = ctrl.snapshot()
    assert snap["user"]["balance"] == 200 and snap["pending"]["amount"] == 200 and snap["pending"]["new_amount"] == 0
    assert ctrl.continue_session()                       # số dư không bắt chọn ngay
    put(ctx, "can_tall")
    ctrl.logout("user")                                  # đăng xuất khi chưa chọn -> cũng giữ vào số dư
    with ctx["app"].app_context():
        assert int(db.session.get(User, uid).balance) == 500
        assert {t.payout for t in Transaction.query} == {"held"}
        db.session.add(Station(id=2, name="Trạm 2"))
        db.session.commit()

    # Trạm 2 (cùng hệ sinh thái): nhập đúng số điện thoại -> thấy số dư, nhận luôn
    from .conftest import FakeHardware
    app = ctx["app"]
    c2 = app.extensions["station_factory"](2, FakeHardware())
    c2._emit = lambda e, d: None
    app.extensions["stations"][2] = c2
    look = c2.lookup_phone("+84 905 550 001")
    assert look == {"ok": True, "found": True, "name": "L**", "balance": 500}
    assert c2.login_phone("0905550001")["ok"]
    assert c2.snapshot()["pending"]["amount"] == 500
    assert c2.payout("voucher")["ok"]
    with ctx["app"].app_context():
        u = db.session.get(User, uid)
        assert (int(u.balance), int(u.total_voucher), u.last_station_id) == (0, 500, 2)
        po = Payout.query.one()
        assert po.station_id == 2 and {t.payout_id for t in Transaction.query} == {po.id}


def test_register_new_phone_at_station(ctx):
    ctrl = ctx["ctrl"]
    assert ctrl.lookup_phone("123")["ok"] is False
    assert ctrl.lookup_phone("0938000111") == {"ok": True, "found": False}
    assert ctrl.login_phone("0938000111")["ok"] is False
    assert "họ tên" in ctrl.register("0938000111", "  ")["error"]
    assert ctrl.register("0938000111", "Trần Thị Bích Ngọc")["ok"]
    snap = ctrl.snapshot()
    assert snap["state"] == C.READY and snap["user"]["display_name"] == "Trần T** B*** N***"
    assert snap["user"]["phone"] == "093****111" and "name" not in snap["user"]
    ctrl.logout()
    assert "đã được đăng ký" in ctrl.register("0938000111", "Ai Đó")["error"]


def test_locked_user_cannot_login(ctx):
    uid = login(ctx)
    ctx["ctrl"].logout()
    with ctx["app"].app_context():
        db.session.get(User, uid).is_active = False
        db.session.commit()
    assert "khóa" in ctx["ctrl"].lookup_phone("0905550001")["error"]
    assert ctx["ctrl"].login_phone("0905550001")["ok"] is False


def test_no_payout_choice_when_rejected(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "bottle_500", "foam_box")
    snap = ctrl.snapshot()
    assert snap["state"] == C.ALARM and snap["last_result"]["status"] == "rejected"
    assert snap["pending"]["amount"] == 0 and snap["payout_in"] is None


# ------------------------------------------------------------------ lỗ từ thiện
def slot(ctx, label):
    ctx["hal"].funnel.append({"label": label})
    return ctx["ctrl"].on_slot_item()


def test_slot_charity_no_login_no_money(ctx):
    ctrl, hal = ctx["ctrl"], ctx["hal"]
    assert ctrl.snapshot()["slot_open"]
    assert slot(ctx, "bottle_1500")
    assert ctrl.state == C.IDLE
    assert hal.bins["bottle"] == ["bottle_1500"]
    assert "lock_door" not in hal.names() and "gripper_push" not in hal.names()
    sort = [c for c in hal.calls if c[0] == "belt_sort"][-1]
    assert sort[1] == "bottle" and abs(sort[2] - 1.0) < 1e-6      # (0.0 - -0.30) / 0.30 m/s
    r = [d for e, d in ctx["events"] if e == "slot:result"][-1]
    assert r["status"] == "accepted" and r["kind"] == "bottle"
    with ctx["app"].app_context():
        tx = Transaction.query.one()
        assert tx.user_id is None and tx.source == "slot" and tx.bottles == 1 and tx.amount == 0
        assert db.session.get(Station, 1).storage_count == 1


def test_slot_can_goes_to_later_pusher(ctx):
    slot(ctx, "can_tall")
    sort = [c for c in ctx["hal"].calls if c[0] == "belt_sort"][-1]
    assert sort[1] == "can" and abs(sort[2] - (0.32 + 0.30) / 0.30) < 1e-3
    assert ctx["ctrl"].snapshot()["bins"]["can"] == 1


def test_slot_other_runs_to_end_bin_with_crop(ctx, tmp_path):
    ctrl = ctx["ctrl"]
    slot(ctx, "glass_bottle")
    r = ctrl.last_slot
    assert r["status"] == "rejected" and r["kind"] == "other"
    assert ctx["hal"].bins["other"] == ["glass_bottle"]
    assert (tmp_path / r["rejected"][0]["crop_url"].removeprefix("/media/")).is_file()


def test_slot_with_user_does_not_add_money(ctx):
    uid = login(ctx)
    slot(ctx, "bottle_500")
    assert ctx["ctrl"].state == C.READY
    assert ctx["ctrl"].snapshot()["pending"]["amount"] == 0
    assert get_user(ctx, uid) == (0, 0)


def test_slot_gate_closes_while_belt_busy_and_maintenance(ctx):
    ctrl = ctx["ctrl"]
    ctrl.broadcast()
    assert ("slot_gate", True) in ctx["hal"].calls
    ctx["hal"].calls.clear()
    ctrl.on_sensor("rear_door_closed", False)
    assert ctx["hal"].calls.count(("slot_gate", False)) == 1
    assert ctrl.snapshot()["slot_open"] is False and ctrl.snapshot()["maintenance"]
    ctrl.on_sensor("rear_door_closed", True)
    assert ("slot_gate", True) in ctx["hal"].calls
    ctrl._sorter_running = True
    assert ctrl.snapshot()["slot_open"] is False
    assert ctrl.on_slot_item() is False


# ------------------------------------------------------------------ thùng rác công cộng 2 bên
def test_public_bins_count_and_full(ctx):
    ctrl = ctx["ctrl"]
    assert ctrl.public_drop("left") and ctrl.public_drop("left") and ctrl.public_drop("right")
    assert ctrl.public_drop("middle") is False
    pb = ctrl.snapshot()["public_bins"]
    assert (pb["left"], pb["right"], pb["capacity"]) == (2, 1, 30)
    with ctx["app"].app_context():
        from app.services import settings_service as settings
        settings.set_setting("public_capacity", 2)
    assert ctrl.public_drop("left") is False and "public_full" in codes(ctx)
    c = ctx["client"]
    admin_login(c)
    assert c.get("/api/admin/stations").get_json()[0]["public"]["left"] == 2
    assert c.post("/api/admin/stations/1/empty-public", json={"side": "left"}).get_json()["ok"]
    assert ctrl.snapshot()["public_bins"]["left"] == 0
    assert c.post("/api/admin/stations/1/empty-public", json={"side": "x"}).status_code == 400


# ------------------------------------------------------------------ cửa sau + xe thùng
def test_rear_door_blocks_use(ctx):
    with ctx["app"].app_context():
        uid = create_user("0905550002", "Ba").id
    ctrl = ctx["ctrl"]
    ctrl.on_sensor("rear_door_closed", False)
    assert ctrl.select_user(uid) is False and "maintenance" in codes(ctx)
    ctrl.on_sensor("rear_door_closed", True)
    assert ctrl.select_user(uid)
    ctrl.on_sensor("rear_door_closed", False)
    put(ctx, "bottle_500")
    assert "capture" not in ctx["hal"].names() and "maintenance" in codes(ctx)


def test_bin_removed_and_reinserted_empties_storage(ctx):
    ctrl = ctx["ctrl"]
    slot(ctx, "bottle_500")
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        st.storage_count, st.is_full = 300, True
        db.session.commit()
    ctrl.on_sensor("rear_door_closed", False)
    ctrl.on_sensor("storage_bin_in", True)  # chưa rút ra -> không reset
    with ctx["app"].app_context():
        assert db.session.get(Station, 1).storage_count == 300
    ctrl.on_sensor("storage_bin_in", False)
    ctrl.on_sensor("storage_bin_in", True)
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        assert st.storage_count == 0 and not st.is_full and st.last_emptied_at
    assert ctrl.snapshot()["bins"] == {"bottle": 0, "can": 0, "other": 0}


def test_save_to_account_accumulates_and_claim_later(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    put(ctx, "bottle_500", "can_tall")                  # 500đ
    assert ctrl.save_balance()["ok"]
    snap = ctrl.snapshot()
    assert snap["last_payout"]["method"] == "save" and snap["last_payout"]["balance"] == 500
    assert snap["payout_in"] is None and snap["pending"]["new_amount"] == 0
    assert not ctrl.save_balance()["ok"]                # không có tiền mới
    ctrl.continue_session()
    put(ctx, "bottle_500")                              # mẻ 2: 200đ, lưu tiếp
    assert ctrl.save_balance()["ok"]
    with ctx["app"].app_context():
        assert db.session.get(User, uid).balance == 700
        assert {t.payout for t in Transaction.query.filter_by(user_id=uid)} == {"held"}
    ctrl.logout("user")
    assert ctrl.select_user(uid)                        # lần sau: rút cả số dư tích lũy
    assert ctrl.payout("charity")["ok"]
    with ctx["app"].app_context():
        u = db.session.get(User, uid)
        assert (u.balance, u.total_donated) == (0, 700)


def test_print_voucher_up_to_three_times(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    assert not ctrl.print_voucher()["ok"]               # chưa có voucher
    put(ctx, "bottle_500")
    assert ctrl.payout("voucher")["ok"]
    printed = []
    ctx["hal"].print_voucher = lambda v: printed.append(v)
    for _ in range(3):
        assert ctrl.print_voucher()["ok"]
    assert not ctrl.print_voucher()["ok"]
    assert printed[0]["amount"] == 200 and printed[0]["code"].startswith("DN-") and printed[0]["qr_svg"]
    assert "print" in codes(ctx)
