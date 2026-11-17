from app.models import RejectedItem, Station, Transaction, User, db
from app.services.user_service import create_user
from app.station import controller as C

from .conftest import item


def login(ctx):
    with ctx["app"].app_context():
        uid = create_user("Nam", "0123456789").id
    assert ctx["ctrl"].select_user(uid)
    return uid


def messages(ctx):
    return [d["code"] for e, d in ctx["events"] if e == "screen:message"]


def last_result(ctx):
    return [d for e, d in ctx["events"] if e == "result"][-1]


def test_select_user_unlocks_door(ctx):
    login(ctx)
    assert ctx["ctrl"].state == C.READY
    assert ctx["ctrl"].door_locked is False
    assert ("lock_door", False) in ctx["hal"].calls


def test_pay_requires_session(ctx):
    assert ctx["ctrl"].press_pay() is False
    assert "no_session" in messages(ctx)


def test_pay_blocked_when_door_open(ctx):
    login(ctx)
    ctx["ctrl"].on_sensor("door_closed", False)
    assert ctx["ctrl"].press_pay() is False
    assert "door_open" in messages(ctx)
    assert "dump_feed_tray" not in ctx["hal"].names()


def test_pay_blocked_when_drawer_out(ctx):
    login(ctx)
    ctx["ctrl"].on_sensor("feed_drawer_in", False)
    assert ctx["ctrl"].press_pay() is False
    assert "door_open" in messages(ctx)


def test_jammed_drawer_message(ctx):
    login(ctx)
    ctx["ctrl"].on_sensor("feed_drawer_jammed", True)
    assert "jammed" in messages(ctx)
    assert ctx["ctrl"].press_pay() is False


def test_empty_tray(ctx):
    login(ctx)
    ctx["hal"].scenes = [[]]
    assert ctx["ctrl"].press_pay()
    r = last_result(ctx)
    assert r["status"] == "empty" and r["amount"] == 0
    assert ctx["ctrl"].state == C.RESULT
    assert "vibrate" not in ctx["hal"].names()


def test_single_item_no_vibration(ctx):
    uid = login(ctx)
    ctx["hal"].scenes = [[item("bottle_500")]]
    ctx["ctrl"].press_pay()
    r = last_result(ctx)
    assert r["status"] == "accepted" and r["bottles"] == 1 and r["amount"] == 200
    assert "vibrate" not in ctx["hal"].names()
    assert ("tilt_plate", "storage") in ctx["hal"].calls
    with ctx["app"].app_context():
        assert db.session.get(User, uid).total_received == 0  # chờ người dùng chọn
        assert db.session.get(Station, 1).storage_count == 1
    assert ctx["ctrl"].payout("transfer")
    with ctx["app"].app_context():
        assert db.session.get(User, uid).total_received == 200


def test_many_items_vibrate_then_accept(ctx):
    uid = login(ctx)
    pile = [item("bottle_500", 0), item("bottle_1500", 70), item("bottle_flat", 140),
            item("can_tall", 210), item("can_short", 280)]
    ctx["hal"].scenes = [pile, pile]
    ctx["ctrl"].press_pay()
    r = last_result(ctx)
    assert (r["bottles"], r["cans"], r["amount"]) == (3, 2, 1200)
    assert ctx["hal"].names().count("vibrate") == 1
    seq = [c for c in ctx["hal"].calls if c[0] != "set_led"]
    i = seq.index(("lock_door", True))
    assert seq[i:i + 6] == [("lock_door", True), ("dump_feed_tray",), ("capture",), ("vibrate", 0),
                            ("capture",), ("tilt_plate", "storage")]
    with ctx["app"].app_context():
        tx = Transaction.query.one()
        assert tx.status == "accepted" and tx.scan_attempts == 2 and tx.user_id == uid
        assert tx.price_bottle == 200 and tx.price_can == 300


def test_invalid_item_rejects_whole_pile_with_crop(ctx, tmp_path):
    uid = login(ctx)
    pile = [item("bottle_500", 0), item("bottle_500", 100), item("milk_carton", 200)]
    ctx["hal"].scenes = [pile, pile]
    ctx["ctrl"].press_pay()
    r = last_result(ctx)
    assert r["status"] == "rejected" and r["amount"] == 0
    assert len(r["rejected"]) == 1 and r["rejected"][0]["label_vi"] == "Hộp sữa giấy"
    assert ("tilt_plate", "return") in ctx["hal"].calls
    with ctx["app"].app_context():
        assert db.session.get(User, uid).total_received == 0
        ri = RejectedItem.query.one()
        assert (tmp_path / ri.crop_path).is_file()
        assert db.session.get(Station, 1).storage_count == 0


def test_overlap_retries_then_scan_failed(ctx):
    login(ctx)
    pile = [item("bottle_500", 0, overlapped=True), item("can_tall", 30, overlapped=True)]
    ctx["hal"].scenes = [pile]  # luôn đè nhau
    ctx["ctrl"].press_pay()
    r = last_result(ctx)
    assert r["status"] == "scan_failed"
    assert ctx["hal"].names().count("vibrate") == 3  # rung lần đầu + 2 lần rung lại
    assert ("tilt_plate", "return") in ctx["hal"].calls


def test_overlap_resolved_on_retry(ctx):
    login(ctx)
    bad = [item("bottle_500", 0, overlapped=True), item("can_tall", 30, overlapped=True)]
    good = [item("bottle_500", 0), item("can_tall", 200)]
    ctx["hal"].scenes = [bad, bad, good]
    ctx["ctrl"].press_pay()
    assert last_result(ctx)["amount"] == 500
    assert ctx["hal"].names().count("vibrate") == 2


def test_station_full_after_accept_blocks_next(ctx):
    login(ctx)
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        st.storage_count = 299
        db.session.commit()
    ctx["hal"].scenes = [[item("can_tall")]]
    ctx["ctrl"].press_pay()
    with ctx["app"].app_context():
        assert db.session.get(Station, 1).is_full
    ctx["ctrl"].payout("transfer")
    assert ctx["ctrl"].press_pay() is False
    assert "full" in messages(ctx)


def test_hardware_error_returns_trash_and_recovers(ctx):
    login(ctx)
    ctx["hal"].fail_on = "dump_feed_tray"
    ctx["ctrl"].press_pay()
    assert last_result(ctx)["status"] == "error"
    assert ctx["ctrl"].state == C.RESULT
    assert ctx["ctrl"].door_locked is False


def test_idle_timeout_logout(ctx):
    ctrl = ctx["ctrl"]
    login(ctx)
    ctrl.last_activity -= 110
    ctrl.tick()
    assert ("session:countdown", {"seconds": 10}) in ctx["events"]
    ctrl.last_activity -= 20
    ctrl.tick()
    assert ctrl.state == C.IDLE and ctrl.user_id is None
    assert "timeout" in messages(ctx)


def test_logout_with_open_door_locks_on_close(ctx):
    ctrl = ctx["ctrl"]
    login(ctx)
    ctrl.on_sensor("door_closed", False)
    ctrl.logout()
    assert ctrl.door_locked is False and "close_door" in messages(ctx)
    ctrl.on_sensor("door_closed", True)
    assert ctrl.door_locked is True


def test_continue_session(ctx):
    login(ctx)
    ctx["hal"].scenes = [[]]
    ctx["ctrl"].press_pay()
    ctx["ctrl"].continue_session()
    assert ctx["ctrl"].state == C.READY and ctx["ctrl"].last_result is None
