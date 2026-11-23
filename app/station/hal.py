"""Hardware Abstraction Layer.

Controller chỉ nói chuyện với HardwareInterface. Bản mô phỏng dùng SimulatedHardware
(gửi lệnh cho scene 3D qua Socket.IO và chờ scene báo xong). Khi có máy thật, viết
GpioHardware cùng interface (Raspberry Pi / PLC: relay, motor, servo, xy-lanh, camera) là chạy.

Cơ cấu của trạm:
  * Khoang nạp: cửa (khóa điện từ + lò xo bung hé), còi + đèn đỏ.
  * Khay ngăn kéo KÍN (2 bên + mặt sau; vách trái là cửa lật xuống phễu), rung được, camera khay
    (quét tính tiền VÀ vẽ khung cho tay gắp), tay gắp 2 ngón trên giàn XY, phễu nón khớp kín mép khay.
  * Phễu: cổ hẹp; cánh nón mở dần khi camera băng chuyền lâu không thấy vật mới (kẹt), rung được.
  * Băng chuyền: camera băng chuyền, thanh gạt chai (trước), thanh gạt lon (sau) đẩy thẳng vào thùng sát mép băng,
    tấm gạt chéo cuối băng = thùng 'khác'.
  * Lỗ từ thiện: nắp servo, ống chúc xuống miệng phễu (cảm biến hồng ngoại cuối ống -> on_slot_item()).
"""
import base64
import io
import itertools
import threading
from abc import ABC, abstractmethod

from PIL import Image

from app.detection import Frame

CAMERAS = ("tray", "belt", "security")   # security = camera giám sát trên màn hình, nhìn thẳng vào người dùng


class HardwareError(RuntimeError):
    """Cơ cấu không phản hồi / lỗi phần cứng."""


class HardwareInterface(ABC):
    # ---- Cảm biến (trạng thái hiện tại) ----
    def __init__(self):
        self.sensors = {
            "door_closed": True,        # cửa khoang nạp
            "rear_door_closed": True,   # cửa sau (nhân viên thu gom, khóa bằng chìa)
            "storage_bin_in": True,     # xe thùng chứa (chai | lon | khác) đã đẩy vào đúng vị trí
        }

    def update_sensor(self, name: str, value: bool) -> None:
        if name not in self.sensors:
            raise KeyError(name)
        self.sensors[name] = bool(value)

    # ---- Khoang nạp ----
    @abstractmethod
    def lock_door(self, locked: bool) -> None: ...

    @abstractmethod
    def pop_door(self) -> None:
        """Mở khóa và để lò xo bung hé cửa khoang nạp (người dùng lấy vật lạ ra)."""

    @abstractmethod
    def alarm(self, on: bool) -> None:
        """Loa cảnh báo + đèn đỏ nhấp nháy."""

    @abstractmethod
    def tray_vibrate(self, seconds: float) -> None:
        """Rung khay cho rác tản ra (không chồng nhau)."""

    @abstractmethod
    def capture(self, camera: str = "tray") -> Frame:
        """Chụp ảnh từ camera: 'tray' (nhìn xuống khay) | 'belt' (băng chuyền)."""

    def capture_background(self) -> Frame:
        """Chụp khay đang TRỐNG để học nền (so nền). Mặc định = chụp thường."""
        return self.capture("tray")

    def security_snapshot(self) -> dict:
        """Ảnh camera giám sát lúc xảy ra sự cố: {'image': PIL, 'before': PIL | None (ảnh rõ cuối cùng khi bị che)}."""
        return {"image": self.capture("security").image, "before": None}

    # ---- Phân loại trên khay ----
    @abstractmethod
    def tray_gate(self, open_: bool) -> None:
        """Cửa lật vách trái khay: mở (lật xuống, mép khay khớp miệng phễu) chỉ khi khay đã vào hẳn + cửa khóa."""

    @abstractmethod
    def gripper_push(self, bbox) -> dict:
        """Tay gắp hạ xuống ôm đúng khung bbox (pixel ảnh camera khay), lùa vật qua mép khay vào phễu.
        Trả về {'pushed': bool} – có gắp được vật nào không."""

    @abstractmethod
    def tray_sweep(self) -> dict:
        """Gạt MỘT vật còn sót trên khay vào phễu (vật model không thấy). {'pushed': False} khi khay đã trống."""

    # ---- Phễu ----
    @abstractmethod
    def funnel_open(self, level: float) -> None:
        """Độ mở cổ phễu 0 (hẹp, bình thường) .. 1 (loe hết cỡ, gỡ kẹt)."""

    @abstractmethod
    def funnel_shake(self) -> None:
        """Rung phễu (motor rung gắn vành miệng) cho vật kẹt lật xuống."""

    # ---- Băng chuyền ----
    @abstractmethod
    def belt_wait(self, timeout: float) -> dict:
        """Băng chạy, camera băng chuyền canh vật MỚI rơi xuống; thấy vật thì dừng băng khi vật nằm dưới camera.
        {'arrived': False} nếu sau `timeout` giây vẫn chưa thấy."""

    @abstractmethod
    def belt_sort(self, kind: str, delay: float) -> None:
        """Chạy băng tiếp; sau `delay` giây bật thanh gạt của `kind` ('bottle' | 'can'), loại khác chạy tới cuối băng."""

    # ---- Máy in phiếu (khe dưới màn hình) ----
    def print_voucher(self, voucher: dict) -> None:
        """In phiếu voucher (mã QR + mã chữ + mệnh giá + hạn) ra khe dưới màn hình. Mặc định: không có máy in."""

    # ---- Lỗ từ thiện + đèn ----
    @abstractmethod
    def slot_gate(self, open_: bool) -> None:
        """Nắp (servo) lỗ từ thiện: mở khi băng chuyền rảnh, đóng khi đang phân loại / bảo trì / đầy."""

    @abstractmethod
    def set_led(self, name: str, mode: str) -> None:
        """Đèn: name in {'status','door_lock','slot'}; mode tùy đèn."""


class SimulatedHardware(HardwareInterface):
    """Phần cứng ảo = scene 3D trên trình duyệt (room 'sim')."""

    SIM_ROOM = "sim"

    def __init__(self, socketio, timeout: float = 30, room: str | None = None):
        super().__init__()
        self.socketio = socketio
        self.room = room or self.SIM_ROOM      # mỗi trạm 1 room: 'sim:<id>' 
        self.timeout = timeout
        self._ids = itertools.count(1)
        self._pending: dict[int, dict] = {}
        self._lock = threading.Lock()

    # Gửi lệnh và chờ scene 3D báo xong (event 'sim:ack')
    def _command(self, cmd: str, wait: bool = True, timeout: float | None = None, **args):
        cmd_id = next(self._ids)
        slot = {"event": threading.Event(), "data": None}
        if wait:
            with self._lock:
                self._pending[cmd_id] = slot
        self.socketio.emit("actuator", {"id": cmd_id, "cmd": cmd, "args": args}, to=self.room)
        if not wait:
            return None
        ok = slot["event"].wait(timeout or self.timeout)
        with self._lock:
            self._pending.pop(cmd_id, None)
        if not ok:
            raise HardwareError(f"Cơ cấu '{cmd}' không phản hồi sau {timeout or self.timeout}s")
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

    def pop_door(self) -> None:
        self._command("pop_door")

    def alarm(self, on: bool) -> None:
        self._command("alarm", wait=False, on=on)

    def tray_vibrate(self, seconds: float) -> None:
        self._command("tray_vibrate", seconds=seconds)

    def capture(self, camera: str = "tray") -> Frame:
        data = self._command("capture", camera=camera)
        return Frame(image=decode_data_url(data["image"]), hints=data.get("hints", []))

    def capture_background(self) -> Frame:
        data = self._command("capture", camera="tray", quick=True)   # chụp ngay, không chạy hiệu ứng
        return Frame(image=decode_data_url(data["image"]))

    def security_snapshot(self) -> dict:
        data = self._command("capture", camera="security")
        return {"image": decode_data_url(data["image"]),
                "before": decode_data_url(data["before"]) if data.get("before") else None}

    def tray_gate(self, open_: bool) -> None:
        self._command("tray_gate", open=open_)

    def gripper_push(self, bbox) -> dict:
        return self._command("gripper_push", bbox=[float(v) for v in bbox])

    def tray_sweep(self) -> dict:
        return self._command("tray_sweep")

    def funnel_open(self, level: float) -> None:
        self._command("funnel_open", level=float(level))

    def funnel_shake(self) -> None:
        self._command("funnel_shake")

    def belt_wait(self, timeout: float) -> dict:
        return self._command("belt_wait", timeout=self.timeout + timeout, seconds=float(timeout))

    def belt_sort(self, kind: str, delay: float) -> None:
        self._command("belt_sort", timeout=self.timeout + delay, kind=kind, delay=delay)

    def slot_gate(self, open_: bool) -> None:
        self._command("slot_gate", open=open_)

    def print_voucher(self, voucher: dict) -> None:
        self._command("print_voucher", timeout=15, voucher=voucher)

    def set_led(self, name: str, mode: str) -> None:
        self._command("set_led", wait=False, name=name, mode=mode)


def decode_data_url(data_url: str) -> Image.Image:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(data_url)))
    img.load()
    return img.convert("RGB")
