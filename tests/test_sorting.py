"""Khu phân loại: thứ tự lùa vào phễu, rung khi chồng nhau, camera băng chuyền, hẹn giờ thanh gạt."""
import threading

from app.detection import Detection
from app.station import controller as C
from app.station.sorting import belt_delay, pick_order

from .test_controller import login, put


def det(x, y, w=60, h=60, label="bottle_500"):
    return Detection(label, "bottle", 0.9, (x - w // 2, y - h // 2, x + w // 2, y + h // 2))


def test_pick_order_center_first_then_nearest_funnel():
    # ảnh 640x480, phễu ở giữa mép trái (0, 240)
    a = det(330, 230)       # gần tâm nhất
    b = det(80, 250)        # sát phễu
    c = det(600, 60)        # xa phễu nhất
    d = det(250, 420)
    e = det(200, 90)
    order = pick_order([c, d, b, a, e], (640, 480))
    assert order[0] is a
    assert order[1] is b and order[-1] is c
    assert order.index(e) < order.index(c) and order.index(d) < order.index(c)
    assert pick_order([], (640, 480)) == []


def test_belt_delay():
    pushers = {"bottle": 0.0, "can": 0.32}
    assert belt_delay("bottle", -0.30, pushers, 0.30, 0.58) == 1.0
    assert abs(belt_delay("can", -0.30, pushers, 0.30, 0.58) - 0.62 / 0.30) < 1e-9
    assert abs(belt_delay("other", -0.30, pushers, 0.30, 0.58) - 0.88 / 0.30) < 1e-9
    assert belt_delay("bottle", -0.30, pushers, 0.30, 0.58) < belt_delay("can", -0.30, pushers, 0.30, 0.58)


def test_sorter_pushes_each_item_in_pick_order(ctx):
    login(ctx)
    put(ctx, "bottle_500", "can_tall", "can_short", "bottle_1500")
    hal = ctx["hal"]
    assert hal.names().count("gripper_push") == 4
    plan = [d for e, d in ctx["events"] if e == "sorter:scan"][0]
    xs = [(b["bbox"][0] + b["bbox"][2]) / 2 for b in plan["boxes"]]
    # vật gần tâm ảnh (x=320) lấy trước, sau đó lần lượt gần mép trái (phễu)
    assert abs(xs[0] - 320) == min(abs(x - 320) for x in xs)
    assert xs[1:] == sorted(xs[1:])
    assert sorted(hal.bins["bottle"]) == ["bottle_1500", "bottle_500"]
    assert sorted(hal.bins["can"]) == ["can_short", "can_tall"]
    belt = [d for e, d in ctx["events"] if e == "belt:frame"]
    assert len(belt) == 4 and all(b["by"] == "belt" for b in belt)
    assert {b["kind"]: b["delay"] for b in belt} == {"bottle": 1.0, "can": round(0.62 / 0.30, 3)}


def test_belt_camera_unsure_falls_back_to_tray_label(ctx):
    login(ctx)
    ctx["hal"].belt_labels = {"can_tall": "milk_carton"}     # camera băng chuyền nhận nhầm
    put(ctx, "can_tall")
    assert ctx["hal"].bins["can"] == ["can_tall"]
    last = [d for e, d in ctx["events"] if e == "belt:frame"][-1]
    assert last["by"] == "sorter" and last["kind"] == "can"


def test_item_model_missed_is_swept_to_belt(ctx):
    login(ctx)
    ctx["hal"].invisible = {"bottle_flat"}
    put(ctx, "bottle_500", "bottle_flat")
    hal = ctx["hal"]
    assert "tray_sweep" in hal.names() and hal.tray == []
    assert sorted(hal.bins["bottle"]) == ["bottle_500", "bottle_flat"]   # camera băng chuyền vẫn nhận ra
    assert ctx["ctrl"].snapshot()["sorter"]["done"] == 2


def test_door_locked_while_sorting_then_unlocked(ctx):
    """Luồng thật: người dùng thấy RESULT (đã tính tiền) ngay, cửa khóa tới khi khay phân loại xong."""
    ctrl, hal = ctx["ctrl"], ctx["hal"]
    login(ctx)
    gate = threading.Event()
    orig = hal.gripper_push

    def slow_push(bbox):
        gate.wait(5)
        return orig(bbox)

    hal.gripper_push = slow_push
    threads = []

    def spawn(fn):
        t = threading.Thread(target=fn, daemon=True)
        threads.append(t)
        t.start()

    ctrl._spawn = spawn
    put(ctx, "bottle_500")
    for t in list(threads):
        t.join(0.3)
    snap = ctrl.snapshot()
    assert ctrl.state == C.RESULT and snap["pending"]["amount"] == 200
    assert ctrl.door_locked and snap["intake_busy"] and snap["slot_open"] is False
    ctrl.on_sensor("door_closed", False)          # cửa đang khóa: đóng/mở giả không kích hoạt quét
    ctrl.on_sensor("door_closed", True)
    assert ctrl.state == C.RESULT
    gate.set()
    for t in list(threads):
        t.join(5)
    assert ctrl.door_locked is False and not ctrl.snapshot()["intake_busy"]
    assert hal.bins["bottle"] == ["bottle_500"] and ctrl.snapshot()["sorter"]["state"] == "idle"


def test_sorter_error_reported(ctx):
    login(ctx)
    ctx["hal"].fail_on = "gripper_push"
    put(ctx, "bottle_500")
    snap = ctx["ctrl"].snapshot()
    assert snap["sorter"]["state"] == "error" and snap["door_locked"] is False
    assert snap["pending"]["amount"] == 200          # tiền của người dùng vẫn giữ


def test_funnel_opens_gradually_when_belt_camera_sees_nothing(ctx):
    login(ctx)
    hal = ctx["hal"]
    hal.jam_waits = 2                       # 10 s + nấc 1 chưa thấy -> nấc 2 thì vật lọt
    put(ctx, "bottle_1500")
    opens = [c[1] for c in hal.calls if c[0] == "funnel_open"]
    assert opens == [0.25, 0.5, 0.0]        # mở dần rồi thu về hẹp
    assert "funnel_shake" not in hal.names()
    assert hal.bins["bottle"] == ["bottle_1500"]
    snap = ctx["ctrl"].snapshot()
    assert snap["funnel"] == {"open": 0.0, "jam": False}


def test_funnel_jam_shakes_then_reports_and_recovers(ctx):
    login(ctx)
    hal = ctx["hal"]
    cfg = ctx["app"].config
    hal.jam_waits = 1 + cfg["FUNNEL_OPEN_STEPS"] + cfg["FUNNEL_SHAKES"] + 1   # kẹt hẳn, lần kiểm tra lại thứ 2 thì lọt
    put(ctx, "can")
    assert hal.names().count("funnel_shake") == cfg["FUNNEL_SHAKES"]
    codes = [d.get("code") for e, d in ctx["events"] if e == "screen:message"]
    assert "jam" in codes
    assert hal.bins["can"] == ["can"]
    assert ctx["ctrl"].snapshot()["funnel"]["jam"] is False


def test_tray_gate_open_only_while_sorting(ctx):
    login(ctx)
    hal = ctx["hal"]
    put(ctx, "bottle_500")
    gates = [c for c in hal.calls if c[0] == "tray_gate"]
    assert gates[0] == ("tray_gate", True) and gates[-1] == ("tray_gate", False)
    i_open = hal.calls.index(("tray_gate", True))
    i_push = next(i for i, c in enumerate(hal.calls) if c[0] == "gripper_push")
    assert i_open < i_push
