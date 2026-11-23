"""Khoang nạp: đóng cửa -> rung nhẹ -> quét -> tính tiền ngay | còi + bung hé cửa."""
from app.models import RejectedItem, Station, Transaction, User, db
from app.services.user_service import create_user
from app.station import controller as C


def login(ctx, name="Nam", phone="0912345678"):
    with ctx["app"].app_context():
        uid = create_user(phone, name).id
    assert ctx["ctrl"].select_user(uid)
    return uid


def messages(ctx):
    return [d["code"] for e, d in ctx["events"] if e == "screen:message"]


def last_result(ctx):
    return [d for e, d in ctx["events"] if e == "result"][-1]


def put(ctx, *labels):
    """Người dùng mở cửa, bỏ rác vào khoang nạp rồi đóng cửa."""
    ctrl, hal = ctx["ctrl"], ctx["hal"]
    ctrl.on_sensor("door_closed", False)
    hal.intake += list(labels)
    ctrl.on_sensor("door_closed", True)


def test_select_user_unlocks_door(ctx):
    login(ctx)
    assert ctx["ctrl"].state == C.READY
    assert ctx["ctrl"].door_locked is False
    assert ("lock_door", False) in ctx["hal"].calls


def test_closing_door_without_session_does_nothing(ctx):
    ctx["ctrl"].on_sensor("door_closed", False)
    ctx["ctrl"].on_sensor("door_closed", True)
    assert "capture" not in ctx["hal"].names()


def test_close_door_without_opening_does_not_scan(ctx):
    login(ctx)
    ctx["ctrl"].on_sensor("door_closed", True)
    assert "capture" not in ctx["hal"].names()


def test_empty_intake(ctx):
    login(ctx)
    put(ctx)
    assert ctx["ctrl"].state == C.READY and ctx["ctrl"].door_locked is False
    assert "intake" in messages(ctx)
    with ctx["app"].app_context():
        assert Transaction.query.count() == 0


def test_valid_batch_paid_immediately_and_sorted(ctx):
    uid = login(ctx)
    hal = ctx["hal"]
    put(ctx, "bottle_500", "can_tall", "bottle_1500")
    n = hal.names()
    # nhiều vật -> rung khay trước rồi mới quét tính tiền; phân loại ngay trên khay (không còn bàn nâng)
    assert n.index("capture") < n.index("tray_vibrate") < n.index("gripper_push")
    assert n.count("capture") >= 2
    r = last_result(ctx)
    assert r["status"] == "accepted" and (r["bottles"], r["cans"], r["amount"]) == (2, 1, 700)
    snap = ctx["ctrl"].snapshot()
    assert snap["state"] == C.RESULT and snap["pending"]["amount"] == 700
    assert snap["door_locked"] is False and snap["intake_busy"] is False
    # Khu phân loại: chai vào thùng chai, lon vào thùng lon
    assert sorted(hal.bins["bottle"]) == ["bottle_1500", "bottle_500"] and hal.bins["can"] == ["can_tall"]
    assert snap["bins"] == {"bottle": 2, "can": 1, "other": 0}
    assert snap["sorter"]["state"] == "idle" and snap["sorter"]["done"] == 3
    with ctx["app"].app_context():
        assert db.session.get(Station, 1).storage_count == 3
        assert db.session.get(User, uid).total_received == 0  # chờ người dùng chọn
    assert ctx["ctrl"].payout("transfer", bank="Vietcombank", account="0123456789")["ok"]
    with ctx["app"].app_context():
        assert db.session.get(User, uid).total_received == 700


def test_scan_result_event_has_image_and_boxes(ctx):
    login(ctx)
    put(ctx, "bottle_500", "can_short")
    sr = [d for e, d in ctx["events"] if e == "scan:result"][-1]
    assert sr["decision"] == "accept" and sr["image"].startswith("data:image/jpeg")
    assert len(sr["boxes"]) == 2 and sr["amount"] == 500
    assert "image" not in ctx["ctrl"].snapshot()["last_scan"]   # snapshot không mang ảnh nặng


def test_invalid_item_alarm_and_pop_door(ctx, tmp_path):
    login(ctx)
    hal = ctx["hal"]
    put(ctx, "bottle_500", "foam_box")
    assert ctx["ctrl"].state == C.ALARM and ctx["ctrl"].alarm is True
    assert ("alarm", True) in hal.calls and "pop_door" in hal.names()
    assert "gripper_push" not in hal.names()
    r = last_result(ctx)
    assert r["status"] == "rejected" and r["amount"] == 0 and len(r["rejected"]) == 1
    assert (tmp_path / "crops").exists()
    with ctx["app"].app_context():
        assert RejectedItem.query.one().label == "foam_box"
    snap = ctx["ctrl"].snapshot()
    assert snap["pending"]["amount"] == 0 and snap["door_locked"] is False
    # Người dùng lấy hộp xốp ra (cửa đang bung hé) rồi đóng cửa -> quét lại -> nhận
    hal.intake.remove("foam_box")
    ctx["ctrl"].on_sensor("door_closed", True)       # cửa đã bung hé -> chỉ cần đóng lại là quét lại
    assert ctx["ctrl"].state == C.RESULT and ctx["ctrl"].alarm is False
    assert ("alarm", False) in hal.calls
    assert last_result(ctx)["amount"] == 200 and hal.bins["bottle"] == ["bottle_500"]


def test_alarm_close_without_removing_rejects_again(ctx):
    login(ctx)
    put(ctx, "plastic_bag")
    ctx["ctrl"].on_sensor("door_closed", False)
    ctx["ctrl"].on_sensor("door_closed", True)
    assert ctx["ctrl"].state == C.ALARM
    with ctx["app"].app_context():
        assert Transaction.query.filter_by(status="rejected").count() == 2


def test_single_item_no_vibration(ctx):
    login(ctx)
    put(ctx, "bottle_500")
    assert "tray_vibrate" not in ctx["hal"].names()
    assert last_result(ctx)["status"] == "accepted"


def test_overlap_vibrates_again_then_accepts(ctx):
    login(ctx)
    ctx["hal"].overlap_scans = 2
    put(ctx, "bottle_500", "can_tall")
    assert ctx["hal"].names().count("tray_vibrate") == 2
    assert last_result(ctx)["status"] == "accepted"


def test_overlap_never_resolved_is_scan_failed(ctx):
    login(ctx)
    ctx["hal"].overlap_scans = 99
    put(ctx, "bottle_500", "can_tall")
    assert ctx["hal"].names().count("tray_vibrate") == 3   # 1 (nhiều vật) + max_vibrate_retries (2)
    assert ctx["ctrl"].state == C.ALARM and last_result(ctx)["status"] == "scan_failed"


def test_station_full_blocks_new_session(ctx):
    login(ctx)
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        st.storage_capacity = 3
        db.session.commit()
    put(ctx, "bottle_500", "bottle_500", "can_tall")
    with ctx["app"].app_context():
        assert db.session.get(Station, 1).is_full
    assert ctx["ctrl"].payout("transfer", bank="Vietcombank", account="0123456789")["ok"]
    ctx["ctrl"].logout()
    with ctx["app"].app_context():
        uid = create_user("0987654321", "B").id
    assert ctx["ctrl"].select_user(uid) is False
    assert "full" in messages(ctx)


def test_hardware_error_unlocks_door(ctx):
    login(ctx)
    ctx["hal"].fail_on = "capture"
    put(ctx, "bottle_500")
    r = last_result(ctx)
    assert r["status"] == "error"
    assert ctx["ctrl"].state == C.READY and ctx["ctrl"].door_locked is False


def test_idle_timeout_logout(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    ctrl.idle_timeout = 0.05
    import time
    time.sleep(0.1)
    ctrl.tick()
    assert ctrl.state == C.IDLE and ctrl.door_locked is True


def test_logout_with_open_door_locks_on_close(ctx):
    login(ctx)
    ctrl = ctx["ctrl"]
    ctrl.on_sensor("door_closed", False)
    ctrl.logout()
    assert ctrl.state == C.IDLE and ctrl.door_locked is False
    ctrl.on_sensor("door_closed", True)
    assert ctrl.door_locked is True
    assert "capture" not in ctx["hal"].names()


def test_continue_session(ctx):
    login(ctx)
    put(ctx, "bottle_500")
    ctrl = ctx["ctrl"]
    assert ctrl.continue_session() is False          # còn tiền chờ chọn
    assert ctrl.payout("charity")["ok"]
    assert ctrl.continue_session() and ctrl.state == C.READY
    put(ctx, "can_tall")                                # bỏ tiếp mẻ 2
    assert last_result(ctx)["amount"] == 300
