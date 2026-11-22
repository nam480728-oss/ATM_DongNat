"""Màn xác nhận OK trước khi nghiêng mặt phẳng + so nền khay (vật model không khoanh được)."""
import threading
import time

from PIL import Image, ImageDraw

from app.detection import Detection, Frame
from app.detection.background import BackgroundCheck
from app.station import controller as C

from .conftest import item
from .test_controller import login


def wait_state(ctrl, state, timeout=5):
    t0 = time.time()
    while ctrl.state != state:
        assert time.time() - t0 < timeout, f"không tới trạng thái {state}, đang {ctrl.state}"
        time.sleep(0.01)


def confirm_request(ctx, timeout=5):
    t0 = time.time()
    while True:
        reqs = [d for e, d in ctx["events"] if e == "confirm:request"]
        if reqs:
            return reqs[-1]
        assert time.time() - t0 < timeout, "không thấy confirm:request"
        time.sleep(0.01)


def threaded(ctx):
    ctrl = ctx["ctrl"]
    ctrl.app.config["REQUIRE_CONFIRM"] = True
    threads = []

    def spawn(fn):
        t = threading.Thread(target=fn, daemon=True)
        threads.append(t)
        t.start()

    ctrl._spawn = spawn
    ctrl._test_threads = threads
    return ctrl


def finish(ctrl):
    """Chờ luồng xử lý chạy hết trước khi fixture xóa database (tránh lỗi SQLite ngẫu nhiên)."""
    for t in ctrl._test_threads:
        t.join(5)


def test_tray_waits_for_ok_before_tilt(ctx):
    login(ctx)
    ctrl = threaded(ctx)
    ctx["hal"].scenes = [[item("bottle_500"), item("can_tall", x=300)]]
    assert ctrl.press_pay()
    wait_state(ctrl, C.CONFIRM)
    req = confirm_request(ctx)
    assert req["kind"] == "tray" and req["decision"] == "accept"
    assert (req["bottles"], req["cans"], req["amount"]) == (1, 1, 500)
    assert req["image"].startswith("data:image/jpeg;base64,") and len(req["boxes"]) == 2
    assert ctrl.snapshot()["confirm"]["decision"] == "accept"
    time.sleep(0.1)
    assert "tilt_plate" not in ctx["hal"].names()      # chưa bấm OK -> chưa đổ
    assert ctrl.press_pay() is False                    # đang chờ: không nhận thao tác khác
    assert ctrl.confirm()
    wait_state(ctrl, C.RESULT)
    finish(ctrl)
    assert ("tilt_plate", "storage") in ctx["hal"].calls
    assert ctrl.snapshot()["confirm"] is None
    assert ctrl.confirm() is False                      # hết chờ thì OK không còn tác dụng


def test_tray_reject_preview(ctx):
    login(ctx)
    ctrl = threaded(ctx)
    ctx["hal"].scenes = [[item("bottle_500"), item("milk_carton", x=300)]]
    assert ctrl.press_pay()
    wait_state(ctrl, C.CONFIRM)
    req = confirm_request(ctx)
    assert req["decision"] == "reject" and req["amount"] == 0 and req["others"] == 1
    assert ctrl.confirm()
    wait_state(ctrl, C.RESULT)
    finish(ctrl)
    assert ("tilt_plate", "return") in ctx["hal"].calls


def test_slot_waits_for_ok(ctx):
    login(ctx)
    ctrl = threaded(ctx)
    ctx["hal"].scenes = [[item("can_short")]]
    assert ctrl.on_slot_item()
    wait_state(ctrl, C.CONFIRM)
    req = confirm_request(ctx)
    assert req["kind"] == "slot" and req["cans"] == 1 and req["amount"] == 300
    assert ctrl.confirm()
    wait_state(ctrl, C.READY)
    finish(ctrl)
    assert ("tilt_plate", "storage") in ctx["hal"].calls


def _scene(rects):
    img = Image.new("RGB", (640, 480), (43, 47, 51))
    g = ImageDraw.Draw(img)
    for r, color in rects:
        g.rectangle(r, fill=color)
    return img


def test_background_finds_object_model_missed():
    bg = BackgroundCheck()
    bg.learn([_scene([])])
    img = _scene([((100, 100, 220, 160), (200, 30, 30)), ((400, 250, 470, 330), (230, 220, 200))])
    seen = Detection("metal", "can", 0.95, (95, 95, 225, 165))
    unk = bg.unknown_objects(img, [seen])
    assert len(unk) == 1
    x1, y1, x2, y2 = unk[0].bbox
    assert abs(x1 - 400) < 12 and abs(y2 - 330) < 12
    assert unk[0].source == "background" and not unk[0].is_valid
    assert bg.unknown_objects(img, [seen, Detection("other", "other", 0.9, (395, 245, 475, 335))]) == []
    assert bg.unknown_objects(_scene([]), []) == []


def test_switch_detector(ctx, monkeypatch):
    ctrl = ctx["ctrl"]
    assert ctrl.detector_kind == "mock" and ctrl.snapshot()["detector_kind"] == "mock"
    assert ctrl.set_detector("abc")[0] is False

    class FakeYolo:
        uses_image = True
        name = "fake"

        def detect(self, frame):
            return []

    import app.detection as D
    monkeypatch.setattr(D, "build_detector", lambda cfg: FakeYolo() if cfg["DETECTOR"] == "yolo" else None)
    r = ctx["client"].post("/api/dev/detector", json={"kind": "yolo"})
    assert r.status_code == 200 and ctrl.detector_kind == "yolo"
    assert ctx["events"][-1][1]["detector_kind"] == "yolo"
    assert ctrl.set_detector("mock") == (True, None) and ctrl.detector_kind == "mock"   # bản cũ còn trong bộ nhớ
    ctrl.state = C.SCAN
    assert ctrl.set_detector("yolo")[0] is False                                         # đang xử lý: không đổi
