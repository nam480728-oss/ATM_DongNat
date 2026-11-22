"""Hardware Abstraction Layer.

Controller chỉ nói chuyện với HardwareInterface. Bản mô phỏng dùng SimulatedHardware
(gửi lệnh cho scene 3D qua Socket.IO và chờ scene báo xong). Khi có máy thật, viết
GpioHardware cùng interface (Raspberry Pi: relay, motor, servo, camera) là chạy.
"""
import base64
import io
import itertools
import threading
from abc import ABC, abstractmethod

from PIL import Image

from app.detection import Frame


class HardwareError(RuntimeError):
    """Cơ cấu không phản hồi / lỗi phần cứng."""


class HardwareInterface(ABC):
    """Cảm biến sự kiện (không phải trạng thái): cảm biến hồng ngoại cuối máng lỗ bỏ chai báo có vật rơi xuống
    mặt phẳng quét -> lớp phần cứng gọi StationController.on_slot_item()."""

    # ---- Cảm biến (trạng thái hiện tại) ----
    def __init__(self):
        self.sensors = {
            "door_closed": True,
            "feed_drawer_in": True,
            "feed_drawer_jammed": False,
            "return_drawer_in": True,
            "rear_door_closed": True,   # cửa sau (nhân viên thu gom, khóa bằng chìa)
            "storage_bin_in": True,     # thùng chứa đã đẩy vào đúng vị trí
        }

    def update_sensor(self, name: str, value: bool) -> None:
        if name not in self.sensors:
            raise KeyError(name)
        self.sensors[name] = bool(value)

    # ---- Cơ cấu chấp hành (các hàm chặn cho đến khi chạy xong) ----
    @abstractmethod
    def lock_door(self, locked: bool) -> None: ...

    @abstractmethod
    def dump_feed_tray(self) -> None:
        """Lật đáy khay nạp, đổ rác xuống mặt phẳng rung."""

    @abstractmethod
    def vibrate(self, seconds: float) -> None: ...

    @abstractmethod
    def capture(self) -> Frame:
        """Chụp ảnh mặt phẳng rung từ camera buồng quét."""

    def capture_background(self) -> Frame:
        """Chụp mặt phẳng rung đang TRỐNG để học nền (so nền khay). Mặc định = chụp thường."""
        return self.capture()

    @abstractmethod
    def tilt_plate(self, target: str) -> None:
        """target = 'storage' (nghiêng sau, vào kho) | 'return' (nghiêng trước, ra ngăn trả rác)."""

    @abstractmethod
    def slot_gate(self, open_: bool) -> None:
        """Nắp (servo) của lỗ bỏ từng chai/lon: mở khi trạm nhận vật, đóng khi đang bận / bảo trì / đầy."""

    @abstractmethod
    def set_led(self, name: str, mode: str) -> None:
        """Đèn: name in {'status','pay_button','door_lock','return_drawer','slot'}; mode tùy đèn."""


class SimulatedHardware(HardwareInterface):
    """Phần cứng ảo = scene 3D trên trình duyệt (room 'sim')."""

    SIM_ROOM = "sim"

    def __init__(self, socketio, timeout: float = 30):
        super().__init__()
        self.socketio = socketio
        self.timeout = timeout
        self._ids = itertools.count(1)
        self._pending: dict[int, dict] = {}
        self._lock = threading.Lock()

    # Gửi lệnh và chờ scene 3D báo xong (event 'sim:ack')
    def _command(self, cmd: str, wait: bool = True, **args):
        cmd_id = next(self._ids)
        slot = {"event": threading.Event(), "data": None}
        if wait:
            with self._lock:
                self._pending[cmd_id] = slot
        self.socketio.emit("actuator", {"id": cmd_id, "cmd": cmd, "args": args}, to=self.SIM_ROOM)
        if not wait:
            return None
        ok = slot["event"].wait(self.timeout)
        with self._lock:
            self._pending.pop(cmd_id, None)
        if not ok:
            raise HardwareError(f"Cơ cấu '{cmd}' không phản hồi sau {self.timeout}s")
        data = slot["data"] or {}
        if data.get("error"):
            raise HardwareError(f"Cơ cấu '{cmd}' báo lỗi: {data['error']}")
        return data

    def ack(self, cmd_id: int, data: dict | None = None) -> None:
        """Gọi từ handler socket khi scene 3D báo đã chạy xong lệnh."""
        with self._lock:
            slot = self._pending.get(cmd_id)
        if slot:
            slot["data"] = data
            slot["event"].set()

    def lock_door(self, locked: bool) -> None:
        self._command("lock_door", locked=locked)

    def dump_feed_tray(self) -> None:
        self._command("dump_feed_tray")

    def vibrate(self, seconds: float) -> None:
        self._command("vibrate", seconds=seconds)

    def capture(self) -> Frame:
        data = self._command("capture")
        return Frame(image=decode_data_url(data["image"]), hints=data.get("hints", []))

    def capture_background(self) -> Frame:
        data = self._command("capture", quick=True)   # chụp ngay, không chạy hiệu ứng laser/flash
        return Frame(image=decode_data_url(data["image"]))

    def tilt_plate(self, target: str) -> None:
        self._command("tilt_plate", target=target)

    def slot_gate(self, open_: bool) -> None:
        self._command("slot_gate", open=open_)

    def set_led(self, name: str, mode: str) -> None:
        self._command("set_led", wait=False, name=name, mode=mode)


def decode_data_url(data_url: str) -> Image.Image:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(data_url)))
    img.load()
    return img.convert("RGB")
