import pytest
from PIL import Image

from app import create_app
from app.config import TestConfig
from app.detection import Frame, MockDetector
from app.models import Setting, Station, db
from app.station.hal import HardwareInterface


class _TrayLabels(list):
    """Danh sách nhãn trên khay; += / remove sửa thẳng vào khay của FakeHardware."""

    def __init__(self, tray):
        super().__init__(e["label"] for e in tray)
        self._tray = tray

    def __iadd__(self, labels):
        self.extend(labels)      # setter của FakeHardware.intake dựng lại khay từ danh sách này
        return self

    def remove(self, label):
        super().remove(label)
        self._tray.remove(next(e for e in self._tray if e["label"] == label))


class FakeHardware(HardwareInterface):
    """Phần cứng giả cho test: chạy tức thì, mô phỏng đường đi của vật
    khay ngăn kéo -> phễu -> băng chuyền -> thùng. Ảnh chụp kèm 'đáp án' (hints) cho MockDetector."""

    def __init__(self):
        super().__init__()
        self.calls = []
        self.tray: list[dict] = []           # các vật trên khay ngăn kéo
        self.funnel: list[dict] = []         # vật đang rơi trong phễu (chưa tới camera băng chuyền)
        self.belt: list[dict] = []           # vật nằm dưới camera băng chuyền (đầu hàng = phần tử 0)
        self.jam_waits = 0                   # số lần belt_wait báo "chưa thấy vật" (giả lập kẹt phễu)
        self.bins = {"bottle": [], "can": [], "other": []}
        self.overlap_scans = 0               # số lần quét khay đầu tiên báo vật đè nhau
        self.invisible: set[str] = set()     # nhãn camera khay KHÔNG thấy (model sót)
        self.belt_labels: dict[str, str] = {}  # camera băng chuyền thấy nhãn khác
        self.fail_on: str | None = None
        self._boxes: dict[tuple, dict] = {}

    def _log(self, *c):
        if self.fail_on == c[0]:
            from app.station.hal import HardwareError
            raise HardwareError(f"{c[0]} lỗi giả lập")
        self.calls.append(c)

    def lock_door(self, locked): self._log("lock_door", locked)
    def pop_door(self): self._log("pop_door")
    def alarm(self, on): self.calls.append(("alarm", on))
    def tray_vibrate(self, seconds): self._log("tray_vibrate")
    def tray_gate(self, open_): self._log("tray_gate", open_)
    def funnel_open(self, level): self._log("funnel_open", level)
    def funnel_shake(self): self._log("funnel_shake")
    def slot_gate(self, open_): self.calls.append(("slot_gate", open_))
    def set_led(self, name, mode): self.calls.append(("set_led", name, mode))

    @property
    def intake(self):
        """Nhãn các vật đang nằm trên khay (test bỏ rác: hal.intake += [...])."""
        return _TrayLabels(self.tray)

    @intake.setter
    def intake(self, labels):
        self.tray[:] = [{"label": label} for label in labels]

    def capture(self, camera="tray"):
        self._log("capture", camera)
        if camera == "tray":
            ov = self.overlap_scans > 0
            self.overlap_scans -= ov
            hints, self._boxes = [], {}
            for i, e in enumerate(self.tray):
                if e["label"] in self.invisible:
                    continue
                h = item(e["label"], 10 + i * 80, overlapped=ov)
                self._boxes[tuple(h["bbox"])] = e
                hints.append(h)
        else:
            hints = [item(self.belt_labels.get(self.belt[0]["label"], self.belt[0]["label"]))] if self.belt else []
        return Frame(Image.new("RGB", (640, 480), (40, 40, 40)), hints)

    def gripper_push(self, bbox):
        self._log("gripper_push")
        e = self._boxes.get(tuple(int(v) for v in bbox))
        if e is None or e not in self.tray:
            return {"pushed": False}
        self.tray.remove(e)
        self.funnel.append(e)
        return {"pushed": True}

    def tray_sweep(self):
        self._log("tray_sweep")
        if not self.tray:
            return {"pushed": False}
        self.funnel.append(self.tray.pop(0))
        return {"pushed": True}

    def belt_wait(self, timeout):
        self._log("belt_wait", timeout)
        if self.jam_waits > 0 or not self.funnel:
            self.jam_waits -= self.jam_waits > 0
            return {"arrived": False}
        self.belt.append(self.funnel.pop(0))
        return {"arrived": True}

    def belt_sort(self, kind, delay):
        self._log("belt_sort", kind, delay)
        self.bins[kind].append(self.belt.pop(0)["label"])

    def names(self):
        return [c[0] for c in self.calls if c[0] not in ("set_led", "slot_gate", "alarm")]


class TestCfg(TestConfig):
    pass


@pytest.fixture
def ctx(tmp_path):
    TestCfg.DATA_DIR = tmp_path
    TestCfg.SCAN_DIR = tmp_path / "scans"
    TestCfg.CROP_DIR = tmp_path / "crops"
    hal = FakeHardware()
    events = []
    app = create_app(TestCfg, hal=hal, detector=MockDetector(TestCfg.CLASS_MAP, 0.5, seed=1),
                     spawn=lambda fn: fn())
    ctrl = app.extensions["station"]
    ctrl._emit = lambda e, d: events.append((e, d))
    with app.app_context():
        db.create_all()
        db.session.add(Station(id=1, storage_capacity=300))
        for k, v in TestCfg.DEFAULT_SETTINGS.items():
            db.session.add(Setting(key=k, value=v))
        db.session.commit()
    yield {"app": app, "hal": hal, "ctrl": ctrl, "events": events, "client": app.test_client()}
    with app.app_context():
        db.session.remove()
        db.drop_all()


def item(label, x=100, y=100, overlapped=False):
    return {"label": label, "bbox": [x, y, x + 60, y + 120], "overlapped": overlapped}
