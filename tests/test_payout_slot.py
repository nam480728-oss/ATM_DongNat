"""Chuyển khoản / từ thiện, lỗ bỏ từng chai/lon, cửa sau + thùng chứa."""
import time

from app.models import Station, Transaction, User, db
from app.services.user_service import create_user
from app.station import controller as C

from .conftest import item
from .test_admin import login as admin_login


def login(ctx, name="Lan", acc="5550001111"):
    with ctx["app"].app_context():
        uid = create_user(name, acc).id
    assert ctx["ctrl"].select_user(uid)
    return uid


def codes(ctx):
    return [d["code"] for e, d in ctx["events"] if e == "screen:message"]


def get_user(ctx, uid):
    with ctx["app"].app_context():
        u = db.session.get(User, uid)
        return int(u.total_received), int(u.total_donated)


# ------------------------------------------------------------------ chuyển khoản / từ thiện
def test_transfer_after_pay(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500", 0), item("can_tall", 200)]] * 2
    ctrl.press_pay()
    snap = ctrl.snapshot()
    assert snap["state"] == C.RESULT and snap["pending"]["amount"] == 500
    assert snap["payout_in"] is not None and 25 <= snap["payout_in"] <= 30
    assert ctrl.payout("transfer")
    assert get_user(ctx, uid) == (500, 0)
    snap = ctrl.snapshot()
    assert snap["pending"]["amount"] == 0 and snap["last_payout"]["method"] == "transfer"
    assert snap["payout_in"] is None
    assert ctrl.payout("transfer") is False  # không trả 2 lần
    with ctx["app"].app_context():
        tx = Transaction.query.one()
        assert tx.payout == "transfer" and tx.paid_at is not None


def test_charity_goes_to_fund(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("can_short")]]
    ctrl.press_pay()
    assert ctrl.payout("charity")
    assert get_user(ctx, uid) == (0, 300)
    assert any(e == "payout" and d["method"] == "charity" for e, d in ctx["events"])
    c = ctx["client"]
    admin_login(c)
    ch = c.get("/api/admin/charity").get_json()
    assert ch["total"] == 300 and ch["donors"] == 1 and ch["items"][0]["user"] == "Lan"
    s = c.get("/api/admin/stats").get_json()
    assert (s["paid"], s["charity"]) == (0, 300)


def test_pay_blocked_until_payout_chosen(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("can_short")]]
    ctrl.press_pay()
    assert ctrl.press_pay() is False and "choose_payout" in codes(ctx)
    ctrl.payout("transfer")
    assert ctrl.continue_session() and ctrl.press_pay()


def test_invalid_method_rejected(ctx):
    login(ctx)
    ctx["hal"].scenes = [[item("can_short")]]
    ctx["ctrl"].press_pay()
    assert ctx["ctrl"].payout("bitcoin") is False
    assert ctx["ctrl"].snapshot()["pending"]["amount"] == 300


def test_auto_transfer_after_timeout(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctrl.press_pay()
    ctrl.payout_deadline = time.monotonic() - 0.1  # giả lập đã hết 30 giây
    ctrl.tick()
    assert get_user(ctx, uid) == (200, 0)
    assert ctrl.last_payout["auto"] is True
    assert ctrl.state == C.RESULT


def test_logout_with_pending_transfers(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctrl.press_pay()
    ctrl.logout("user")
    assert ctrl.state == C.IDLE
    assert get_user(ctx, uid) == (200, 0)
    assert "auto_payout" in codes(ctx)


def test_no_payout_choice_when_rejected(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500", 0), item("foam_box", 200)]] * 2
    ctrl.press_pay()
    snap = ctrl.snapshot()
    assert snap["last_result"]["status"] == "rejected" and snap["pending"]["amount"] == 0
    assert snap["payout_in"] is None
    assert ctrl.continue_session()


# ------------------------------------------------------------------ lỗ bỏ chai
def test_slot_guest_sorts_without_money(ctx):
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_1500")]]
    assert ctrl.snapshot()["slot_open"]
    assert ctrl.on_slot_item()
    assert ctrl.state == C.IDLE
    assert ("tilt_plate", "storage") in ctx["hal"].calls
    assert "dump_feed_tray" not in ctx["hal"].names() and "lock_door" not in ctx["hal"].names()
    r = [d for e, d in ctx["events"] if e == "slot:result"][-1]
    assert r["status"] == "accepted" and r["guest"] and r["amount"] == 0
    with ctx["app"].app_context():
        tx = Transaction.query.one()
        assert tx.user_id is None and tx.source == "slot" and tx.bottles == 1 and tx.amount == 0
        assert db.session.get(Station, 1).storage_count == 1
    assert any(e == "scan:frame" and d["boxes"][0]["valid"] for e, d in ctx["events"])


def test_slot_guest_invalid_returned_with_crop(ctx, tmp_path):
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("glass_bottle")]]
    ctrl.on_slot_item()
    r = ctrl.last_slot
    assert r["status"] == "rejected" and r["rejected"][0]["label_vi"] == "Chai thủy tinh"
    assert ("tilt_plate", "return") in ctx["hal"].calls
    assert (tmp_path / r["rejected"][0]["crop_url"].removeprefix("/media/")).is_file()


def test_slot_with_user_accumulates_until_pay(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctrl.on_slot_item()
    ctx["hal"].scenes = [[item("can_tall")]]
    ctrl.on_slot_item()
    assert ctrl.state == C.READY
    snap = ctrl.snapshot()
    assert snap["pending"] == {"amount": 500, "bottles": 1, "cans": 1, "count": 2}
    assert snap["payout_in"] is None  # chưa bấm TÍNH TIỀN thì chưa đếm giờ
    assert get_user(ctx, uid) == (0, 0)
    # khay trống nhưng có tiền từ lỗ -> vẫn chọn chuyển khoản / từ thiện
    ctx["hal"].scenes = [[]]
    ctrl.press_pay()
    snap = ctrl.snapshot()
    assert snap["last_result"]["status"] == "empty" and snap["pending"]["amount"] == 500
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctrl.payout("charity")
    assert get_user(ctx, uid) == (0, 500)


def test_slot_plus_tray_total(ctx):
    uid = login(ctx)
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("can_short")]]
    ctrl.on_slot_item()
    ctx["hal"].scenes = [[item("bottle_500", 0), item("bottle_500", 100)]] * 2
    ctrl.press_pay()
    assert ctrl.snapshot()["pending"]["amount"] == 700
    ctrl.payout("transfer")
    assert get_user(ctx, uid) == (700, 0)


def test_slot_gate_closes_while_busy_and_maintenance(ctx):
    ctrl = ctx["ctrl"]
    ctrl.broadcast()
    assert ("slot_gate", True) in ctx["hal"].calls
    ctx["hal"].calls.clear()
    ctrl.on_sensor("rear_door_closed", False)
    assert ctx["hal"].calls.count(("slot_gate", False)) == 1
    assert ctrl.snapshot()["slot_open"] is False and ctrl.snapshot()["maintenance"]
    ctrl.on_sensor("rear_door_closed", True)
    assert ("slot_gate", True) in ctx["hal"].calls
    ctrl.on_sensor("return_drawer_in", False)
    assert ctrl.snapshot()["slot_open"] is False


def test_slot_ignored_while_processing(ctx):
    ctrl = ctx["ctrl"]
    ctrl.state = C.SCAN
    assert ctrl.on_slot_item() is False


# ------------------------------------------------------------------ cửa sau + thùng chứa
def test_rear_door_blocks_use(ctx):
    with ctx["app"].app_context():
        uid = create_user("Ba", "5550002222").id
    ctrl = ctx["ctrl"]
    ctrl.on_sensor("rear_door_closed", False)
    assert ctrl.select_user(uid) is False and "maintenance" in codes(ctx)
    ctrl.on_sensor("rear_door_closed", True)
    assert ctrl.select_user(uid)
    ctrl.on_sensor("rear_door_closed", False)
    assert ctrl.press_pay() is False


def test_bin_removed_and_reinserted_empties_storage(ctx):
    ctrl = ctx["ctrl"]
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctrl.on_slot_item()
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
