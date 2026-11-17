import pytest
from PIL import Image

from app import create_app
from app.config import TestConfig
from app.detection import Frame, MockDetector
from app.models import Setting, Station, db
from app.station.hal import HardwareInterface


class FakeHardware(HardwareInterface):
    """Phần cứng giả cho test: chạy tức thì, ảnh chụp lấy từ hàng đợi `scenes`."""

    def __init__(self):
        super().__init__()
        self.calls = []
        self.scenes: list[list[dict]] = []  # mỗi lần capture lấy 1 phần tử (danh sách hints)
        self.fail_on: str | None = None

    def _log(self, *c):
        if self.fail_on == c[0]:
            from app.station.hal import HardwareError
            raise HardwareError(f"{c[0]} lỗi giả lập")
        self.calls.append(c)

    def lock_door(self, locked): self._log("lock_door", locked)
    def dump_feed_tray(self): self._log("dump_feed_tray")
    def vibrate(self, seconds): self._log("vibrate", seconds)
    def tilt_plate(self, target): self._log("tilt_plate", target)
    def slot_gate(self, open_): self.calls.append(("slot_gate", open_))
    def set_led(self, name, mode): self.calls.append(("set_led", name, mode))

    def capture(self):
        self._log("capture")
        hints = self.scenes.pop(0) if len(self.scenes) > 1 else (self.scenes[0] if self.scenes else [])
        return Frame(Image.new("RGB", (640, 480), (40, 40, 40)), hints)

    def names(self):
        return [c[0] for c in self.calls if c[0] not in ("set_led", "slot_gate")]


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
