"""So nền khoang nạp (vật model không khoanh được) + đổi bộ nhận diện ở panel Dev."""
from PIL import Image, ImageDraw

from app.detection import Detection
from app.detection.background import BackgroundCheck
from app.station import controller as C


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
