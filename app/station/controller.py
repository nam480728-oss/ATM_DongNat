"""Máy trạng thái của trạm – nguồn sự thật duy nhất cho toàn bộ quy trình.

Front-end (scene 3D / màn hình cảm ứng) chỉ gửi sự kiện và hiển thị trạng thái server phát ra.

0. Người dùng nhập SỐ ĐIỆN THOẠI (dùng chung mọi trạm của hệ sinh thái) – số mới thì đăng ký nhanh (họ tên).
1. Khay ngăn kéo:
   mở cửa, rút khay, bỏ rác, đẩy khay, ĐÓNG CỬA -> khóa -> camera trên khay quét
   (nhiều vật / chồng nhau -> rung khay cho tản ra rồi quét lại)
     * có vật không phải chai/lon (hoặc vật lạ model không nhận ra) -> loa + đèn đỏ, bung hé cửa (ALARM),
       người dùng lấy vật lạ ra rồi đóng cửa -> quét lại;
     * toàn chai/lon -> TÍNH TIỀN NGAY, 3 nút: Từ thiện | Chuyển vào STK (nhập ngân hàng + STK, không lưu) |
       Lấy voucher QR | Lưu vào tài khoản (tích lũy theo SĐT, rút lần sau ở trạm nào cũng được).
       Hết giờ không chọn -> cũng giữ vào số dư.
2. Phân loại ngay trên khay (luồng nền, cửa khóa tới khi khay trống):
   dùng luôn khung (bbox) của lần quét tính tiền -> tay gắp lùa từng vật vào phễu nón
   (giữa trước, rồi gần phễu nhất) -> băng chuyền -> camera băng chuyền xác định chai/lon -> hẹn giờ thanh gạt
   (chai trước, lon sau) -> thùng đúng loại. Hết vòng thì camera khay quét lại tìm vật còn sót.
3. Lỗ từ thiện (không cần chọn tên, không tính tiền): vật rơi thẳng xuống băng chuyền -> camera 3 -> thùng.
4. Hai thùng rác công cộng hai bên trạm: chỉ đếm mức đầy.
5. Camera giám sát (trên màn hình, nhìn thẳng vào người dùng): bỏ rác lạ nhiều lần, va đập mạnh, cố cạy khay / cửa,
   che camera -> chụp ảnh, lưu sự cố (bảng security_events), cảnh báo trên màn hình + báo admin ngay.
"""
import base64
import io
import logging
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path

from app.detection import Detector, Frame
from app.detection.background import BackgroundCheck
from app.detection.cropper import save_crop
from app.models import PAYOUTS, Payout, RejectedItem, SecurityEvent, Transaction, User, db
from app.services import settings_service as settings
from app.services import station_service, user_service, voucher_service
from app.services.pricing import calc_amount, format_vnd
from app.services.user_service import user_to_dict

from .hal import HardwareError, HardwareInterface
from .sorting import belt_delay, pick_order

log = logging.getLogger(__name__)

# ---- Trạng thái (phía người dùng) ----
IDLE = "IDLE"
READY = "READY"                 # có người dùng, cửa mở khóa
SETTLE = "PROCESSING_SETTLE"    # rung khay cho rác tản ra
SCAN = "PROCESSING_SCAN"        # camera khay quét
ALARM = "ALARM"                 # có rác lạ: cửa bung hé, chờ người dùng lấy ra rồi đóng cửa
RESULT = "RESULT"               # vừa nhận mẻ hợp lệ: chọn từ thiện / chuyển vào STK / voucher

PROCESSING_STATES = {SETTLE, SCAN}
SESSION_STATES = {READY, RESULT, ALARM}   # có người dùng, khay rảnh

SENSOR_NAMES = {"door_closed", "rear_door_closed", "storage_bin_in"}
SECURITY_SENSORS = {"impact", "tamper", "camera_blocked"}
SECURITY_IMPACT_G = 2.0          # cảm biến rung: gia tốc va đập (g) từ mức này trở lên = đập / đá máy
SECURITY_TEXT = {   # cảnh báo hiện trên màn hình trạm
    "reject_repeat": "Bạn đã bỏ rác không hợp lệ nhiều lần. Hình ảnh đã được camera ghi lại và gửi cho quản trị viên",
    "impact": "Cảnh báo: phát hiện va đập vào trạm. Hình ảnh đã được camera ghi lại và gửi cho quản trị viên",
    "tamper": "Cảnh báo: không cố kéo khay / cửa khi máy đang khóa. Hình ảnh đã được ghi lại và gửi cho quản trị viên",
    "camera_blocked": "Camera giám sát đang bị che. Vui lòng không che camera – sự việc đã được báo cho quản trị viên",
}
BIN_KINDS = ("bottle", "can", "other")
PUBLIC_SIDES = ("left", "right")


# Model YOLO dùng chung cho mọi trạm trên server -> mỗi lúc chỉ 1 trạm chạy nhận diện
DETECT_LOCK = threading.Lock()


class StationController:
    def __init__(self, app, hal: HardwareInterface, detector: Detector | None, emit, spawn=None,
                 detector_error: str | None = None, station_id: int | None = None):
        self.app = app
        self.station_id = int(station_id or app.config["STATION_ID"])
        self.hal = hal
        self.detector = detector
        self.detector_error = detector_error
        self._emit = emit
        self._spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self._lock = threading.RLock()

        self.state = IDLE
        self.user_id: int | None = None
        self.last_activity = time.monotonic()
        self.idle_timeout = 120
        self.countdown: int | None = None
        self.door_locked = True
        self.last_result: dict | None = None
        # Tiền chờ người dùng chọn chuyển khoản / từ thiện (id giao dịch accepted, chưa payout)
        self.pending_ids: list[int] = []
        self.payout_deadline: float | None = None
        self.last_payout: dict | None = None
        # Khoang nạp
        self._door_opened = False      # cửa đã mở kể từ lần quét trước -> đóng cửa = quét
        self._resume_state = READY
        self.alarm = False
        self.last_scan: dict | None = None
        # Khu phân loại + băng chuyền
        self._sort_job: tuple | None = None   # (ảnh, khung) của mẻ vừa tính tiền, chờ phân loại
        self._sorter_running = False
        self._belt_busy = False        # băng chuyền đang chở vật từ lỗ từ thiện
        self._belt_free = threading.Event()
        self._belt_free.set()
        self.sorter = {"state": "idle", "round": 0, "done": 0, "total": 0, "last": None, "error": None}
        # Phễu: bình thường cổ hẹp; camera băng chuyền không thấy vật mới rơi xuống -> mở dần -> rung -> báo kẹt
        self.funnel = {"open": 0.0, "jam": False}
        self._jam_clear = threading.Event()
        self._gate_open: bool | None = None
        self.last_slot: dict | None = None
        # Thùng chứa đã được rút ra (để biết khi đẩy vào là đã đổ rác)
        self._bin_removed = False
        # Camera giám sát
        self._session_rejects = 0              # số lần bỏ rác lạ trong phiên hiện tại
        self._tamper: deque[float] = deque()   # thời điểm các lần cạy khay / cửa gần đây
        self._sec_last: dict[str, float] = {}  # loại sự cố -> lần báo gần nhất (chống báo dồn dập)
        self.camera_blocked = False
        # So nền khay: chỉ chạy khi detector nhìn ảnh thật (model YOLO)
        self.bg = BackgroundCheck() if app.config.get("BG_CHECK") else None
        # Bộ nhận diện đã nạp (panel Dev đổi qua lại: 'yolo' model thật | 'mock' giả lập theo đáp án 3D)
        # bộ nhận diện đã nạp dùng chung mọi trạm trên server (đổi ở panel Dev áp dụng cho tất cả)
        self._detectors: dict[str, Detector] = app.extensions.setdefault("detectors", {})
        if detector is not None:
            self._detectors.setdefault(self._kind(detector), detector)

    def _detect(self, frame: Frame) -> list:
        with DETECT_LOCK:
            return self.detector.detect(frame)

    # ------------------------------------------------------------------ đổi bộ nhận diện (panel Dev)
    @staticmethod
    def _kind(detector) -> str | None:
        if detector is None:
            return None
        return "yolo" if getattr(detector, "uses_image", False) else "mock"

    @property
    def detector_kind(self) -> str | None:
        return self._kind(self.detector)

    @property
    def busy(self) -> bool:
        """Có cơ cấu nào đang chạy (không cho đổi bộ nhận diện / mở cửa sau)."""
        return self.state in PROCESSING_STATES or self._sorter_running or self._belt_busy

    def set_detector(self, kind: str) -> tuple[bool, str | None]:
        """Chuyển giữa model thật (yolo) và giả lập theo đáp án 3D (mock). Chỉ khi máy đang rảnh."""
        if kind not in ("yolo", "mock"):
            return False, f"Bộ nhận diện không hợp lệ: {kind!r}"
        with self._lock:
            if self.busy:
                return False, "Máy đang xử lý, đổi sau khi xong"
        det = self._detectors.get(kind)
        if det is None:
            from app.detection import DetectorUnavailable, build_detector
            try:
                det = build_detector({**self.app.config, "DETECTOR": kind})   # nạp model mất vài giây
            except DetectorUnavailable as e:
                return False, str(e)
            self._detectors[kind] = det
        with self._lock:
            if self.busy:
                return False, "Máy đang xử lý, đổi sau khi xong"
            self.detector = det
            self.detector_error = None
        self.broadcast()
        return True, None

    # ------------------------------------------------------------------ tiện ích
    def _message(self, text: str, level: str = "info", code: str | None = None):
        self._emit("screen:message", {"level": level, "text": text, "code": code})

    def _set_state(self, state: str):
        with self._lock:
            self.state = state
        self.broadcast()

    def broadcast(self):
        snap = self.snapshot()
        self._sync_gate(snap["slot_open"])
        self._emit("state", snap)

    @property
    def maintenance(self) -> bool:
        s = self.hal.sensors
        return not s["rear_door_closed"] or not s["storage_bin_in"]

    def _slot_open(self, station_full: bool) -> bool:
        return (not self._belt_busy and not self._sorter_running and not station_full and not self.maintenance
                and self.detector is not None)

    def _sync_gate(self, open_: bool):
        """Nắp lỗ từ thiện bám theo điều kiện nhận vật."""
        if open_ == self._gate_open:
            return
        self._gate_open = open_
        self._hw(self.hal.slot_gate, open_)
        self.hal.set_led("slot", "open" if open_ else "closed")

    def _pending_summary(self, user: User | None = None) -> dict:
        """Tiền chờ chọn = tiền các mẻ vừa bỏ + số dư cũ của người dùng (gọi trong app context)."""
        txs = Transaction.query.filter(Transaction.id.in_(self.pending_ids)).all() if self.pending_ids else []
        new = sum(t.amount for t in txs)
        balance = int(user.balance or 0) if user else 0
        return {"amount": new + balance, "new_amount": new, "balance": balance,
                "bottles": sum(t.bottles for t in txs), "cans": sum(t.cans for t in txs), "count": len(txs)}

    def _station(self):
        return settings.get_station(self.station_id)

    def _bins(self) -> dict:
        st = self._station()
        return {k: int(getattr(st, f"bin_{k}")) for k in BIN_KINDS}

    def _public(self) -> dict:
        st = self._station()
        return {"capacity": settings.get_int("public_capacity"), **{s: int(getattr(st, f"public_{s}")) for s in PUBLIC_SIDES}}

    def snapshot(self) -> dict:
        with self.app.app_context():
            station = self._station()
            price_bottle, price_can = settings.get_prices()
            user = db.session.get(User, self.user_id) if self.user_id else None
            pending = self._pending_summary(user) if user else None
            payout_in = (max(0, int(self.payout_deadline - time.monotonic() + 0.999))
                         if self.payout_deadline is not None else None)
            return {
                "state": self.state,
                "processing": self.state in PROCESSING_STATES,
                "user": user_to_dict(user) if user else None,
                "sensors": dict(self.hal.sensors),
                "door_locked": self.door_locked,
                "intake_busy": self._sorter_running,
                "alarm": self.alarm,
                "maintenance": self.maintenance,
                "slot_open": self._slot_open(bool(station.is_full)),
                "camera_blocked": self.camera_blocked,
                "station": {
                    **station_service.station_info(station),
                    "storage_count": station.storage_count,
                    "storage_capacity": station.storage_capacity,
                    "is_full": bool(station.is_full),
                },
                "bins": self._bins(),
                "public_bins": self._public(),
                "sorter": {**self.sorter, "running": self._sorter_running, "belt_busy": self._belt_busy},
                "funnel": dict(self.funnel),
                "prices": {"bottle": price_bottle, "can": price_can},
                "last_result": self.last_result,
                "last_scan": self.last_scan,
                "pending": pending,
                "payout_in": payout_in,
                "last_payout": self.last_payout,
                "last_slot": self.last_slot,
                "countdown": self.countdown,
                "detector_error": self.detector_error,
                "detector_kind": self.detector_kind,
                "banks": self.app.config["BANKS"],
            }

    def _station_full(self) -> bool:
        with self.app.app_context():
            return bool(self._station().is_full)

    def _hw(self, fn, *args):
        """Chạy lệnh phần cứng ở luồng nền (không chặn handler socket)."""
        def run():
            try:
                fn(*args)
            except HardwareError as e:
                log.warning("Hardware: %s", e)
        self._spawn(run)

    def _set_lock(self, locked: bool):
        self.door_locked = locked
        self._hw(self.hal.lock_door, locked)
        self.hal.set_led("door_lock", "locked" if locked else "unlocked")

    def _set_alarm(self, on: bool):
        if self.alarm == on:
            return
        self.alarm = on
        try:
            self.hal.alarm(on)
        except HardwareError as e:
            log.warning("Hardware: %s", e)

    def touch(self):
        """Ghi nhận có thao tác của người dùng (reset đồng hồ tự đăng xuất)."""
        self.last_activity = time.monotonic()
        if self.countdown is not None:
            self.countdown = None
            self.broadcast()

    # ------------------------------------------------------------------ phiên người dùng (số điện thoại)
    def lookup_phone(self, phone: str) -> dict:
        """Màn hình trạm: nhập SĐT -> có tài khoản chưa (chỉ trả tên đã che bớt)."""
        phone = user_service.normalize_phone(phone)
        if not user_service.valid_phone(phone):
            return {"ok": False, "error": "Số điện thoại không hợp lệ (10 số, bắt đầu bằng 03, 05, 07, 08, 09)"}
        with self.app.app_context():
            user = user_service.find_by_phone(phone)
            if user is None:
                return {"ok": True, "found": False}
            if not user.is_active:
                return {"ok": False, "error": "Tài khoản này đang bị khóa, vui lòng liên hệ nhân viên"}
            return {"ok": True, "found": True, "name": user_service.mask_name(user.name),
                    "balance": int(user.balance or 0)}

    def login_phone(self, phone: str) -> dict:
        with self.app.app_context():
            user = user_service.find_by_phone(phone)
            uid = user.id if user and user.is_active else None
        if uid is None:
            return {"ok": False, "error": "Không tìm thấy tài khoản"}
        return {"ok": self.select_user(uid)}

    def register(self, phone: str, name: str) -> dict:
        """Số điện thoại mới: đăng ký nhanh tại trạm rồi vào phiên luôn."""
        with self.app.app_context():
            try:
                uid = user_service.create_user(phone, name, self.station_id).id
            except user_service.UserError as e:
                return {"ok": False, "error": str(e)}
        return {"ok": self.select_user(uid)}

    def select_user(self, user_id: int) -> bool:
        with self._lock:
            if self.state in PROCESSING_STATES:
                self._message("Máy đang xử lý, vui lòng chờ trong giây lát", "warning", "busy")
                return False
            if self.state != IDLE:
                self._message("Trạm đang có người sử dụng", "warning", "busy")
                return False
            if self.maintenance:
                self._message("Trạm đang được bảo trì / thu gom, vui lòng chờ", "warning", "maintenance")
                return False
            if self._station_full():
                self._message("Trạm đã đầy, vui lòng quay lại sau", "error", "full")
                return False
            with self.app.app_context():
                user = db.session.get(User, user_id)
                if not user or not user.is_active:
                    self._message("Không tìm thấy người dùng", "error", "no_user")
                    return False
                user.last_used_at = datetime.now()
                user.last_station_id = self.station_id
                db.session.commit()
                self.idle_timeout = settings.get_int("idle_timeout_sec")
                name = user_service.mask_name(user.name)
                balance = int(user.balance or 0)
            self.user_id = user_id
            self.last_result = None
            self.last_payout = None
            self.last_scan = None
            self.pending_ids = []
            self.payout_deadline = None
            self.countdown = None
            self._door_opened = False
            self._session_rejects = 0
            self.touch()
            self.state = READY
            waiting = self._sorter_running
            if not waiting:
                self._set_lock(False)
        self.broadcast()
        if balance:
            self._message(f"Xin chào {name}. Bạn còn {format_vnd(balance)} chưa nhận – chọn cách nhận bất cứ lúc nào",
                          "info", "balance")
        elif waiting:
            self._message(f"Xin chào {name}. Chờ chút, máy đang phân loại mẻ trước", "info", "welcome")
        else:
            self._message(f"Xin chào {name}. Mời mở cửa, rút khay, bỏ chai nhựa / lon rồi đẩy khay vào và đóng cửa",
                          "info", "welcome")
        return True

    def logout(self, reason: str = "user") -> None:
        with self._lock:
            if self.state in PROCESSING_STATES or self.state == IDLE:
                return
            held = self._hold() if self.pending_ids else None
            self.state = IDLE
            self.user_id = None
            self.last_result = None
            self.last_payout = None
            self.last_scan = None
            self.payout_deadline = None
            self.countdown = None
            self._door_opened = False
            self._set_alarm(False)
            # Cửa đang mở thì chưa khóa được – sẽ khóa khi cửa đóng (xem on_sensor)
            if self.hal.sensors["door_closed"] and not self.door_locked:
                self._set_lock(True)
        self.broadcast()
        if held:
            self._message(f"Đã giữ {held['amount_text']} vào số dư của bạn – lần sau nhập số điện thoại ở bất kỳ trạm nào để nhận",
                          "info", "held")
        if reason == "timeout":
            self._message("Đã tự đăng xuất do không có thao tác trong 2 phút", "info", "timeout")
        if not self.hal.sensors["door_closed"]:
            self._message("Vui lòng đóng cửa khoang nạp", "warning", "close_door")

    def continue_session(self) -> bool:
        with self._lock:
            if self.state == RESULT:
                if self.pending_ids:
                    self._message("Vui lòng chọn Từ thiện, Chuyển vào STK hoặc Lấy voucher trước", "warning", "choose_payout")
                    return False
                self.state = READY
                self.last_result = None
                self.last_payout = None
        self.touch()
        self.broadcast()
        return True

    def tick(self):
        """Gọi mỗi giây: hết giờ chọn -> giữ tiền vào số dư; tự đăng xuất."""
        held = None
        with self._lock:
            if self.state not in SESSION_STATES:
                return
            if self.payout_deadline is not None and time.monotonic() >= self.payout_deadline and self.pending_ids:
                held = self._hold()
                self.touch()
        if held:
            self._message(f"Đã giữ {held['amount_text']} vào số dư – bấm chọn cách nhận bất cứ lúc nào, "
                          "hoặc lần sau nhập số điện thoại ở bất kỳ trạm nào", "info", "held")
            self.broadcast()
            return
        with self._lock:
            remaining = self.idle_timeout - (time.monotonic() - self.last_activity)
            warn = self.app.config["LOGOUT_WARNING_SEC"]
        if remaining <= 0:
            self.logout("timeout")
        elif remaining <= warn:
            sec = int(remaining + 0.999)
            if sec != self.countdown:
                self.countdown = sec
                self._emit("session:countdown", {"seconds": sec})

    # ------------------------------------------------------------------ nhận tiền: từ thiện / chuyển vào STK / voucher
    def _arm_payout_deadline(self):
        if self.pending_ids and self.state == RESULT and self.payout_deadline is None:
            with self.app.app_context():
                sec = settings.get_int("payout_timeout_sec")
            self.payout_deadline = time.monotonic() + sec

    def extend_payout(self) -> bool:
        """Người dùng đang nhập ngân hàng + STK: gia hạn đồng hồ chọn."""
        with self._lock:
            if self.payout_deadline is None:
                return False
            with self.app.app_context():
                sec = settings.get_int("payout_timeout_sec")
            self.payout_deadline = time.monotonic() + sec
            self.touch()
        self.broadcast()
        return True

    def print_voucher(self) -> dict:
        """Nút "In voucher" trên màn hình: máy in nhiệt in phiếu voucher vừa tạo (tối đa 3 lần / voucher)."""
        with self._lock:
            lp = self.last_payout
            if self.user_id is None or not lp or lp.get("method") != "voucher" or not lp.get("voucher"):
                return {"ok": False, "error": "Không có voucher để in"}
            if lp.get("printed", 0) >= 3:
                return {"ok": False, "error": "Voucher này đã in 3 lần"}
            lp["printed"] = lp.get("printed", 0) + 1
            v = lp["voucher"]
            with self.app.app_context():
                code = self._station().code
            data = {"code": v["code"], "amount": v["amount"], "expires_at": v["expires_at"], "url": v.get("url"),
                    "qr_svg": v.get("qr_svg"), "station": code}
            self.touch()
        self._hw(self.hal.print_voucher, data)
        self._message("Đang in voucher – mời lấy phiếu ở khe in dưới màn hình", "info", "print")
        self.broadcast()
        return {"ok": True}

    def save_balance(self) -> dict:
        """Nút "Lưu vào tài khoản": cộng tiền các mẻ vừa bỏ vào số dư của số điện thoại (tích lũy dần,
        rút bằng chuyển khoản / voucher / từ thiện vào lần sau, ở bất kỳ trạm nào)."""
        with self._lock:
            if self.state not in SESSION_STATES or self.user_id is None:
                return {"ok": False, "error": "Không có phiên người dùng"}
            if not self.pending_ids:
                return {"ok": False, "error": "Không có tiền mới để lưu"}
            held = self._hold()
            self.last_payout = {"method": "save", "amount": held["amount"], "amount_text": held["amount_text"],
                                "balance": held["balance"], "balance_text": format_vnd(held["balance"])}
            self.touch()
        self._message(f"Đã lưu {held['amount_text']} vào tài khoản – số dư hiện tại {format_vnd(held['balance'])}",
                      "success", "save")
        self._emit("payout", {"method": "save", "amount": held["amount"], "station_id": self.station_id})
        self.broadcast()
        return {"ok": True}

    def _hold(self) -> dict | None:
        """Hết giờ không chọn: tiền các mẻ vừa bỏ cộng vào số dư người dùng. Gọi khi đang giữ _lock."""
        ids, self.pending_ids = self.pending_ids, []
        self.payout_deadline = None
        with self.app.app_context():
            txs = Transaction.query.filter(Transaction.id.in_(ids)).all()
            user = db.session.get(User, self.user_id)
            amount = sum(t.amount for t in txs)
            now = datetime.now()
            for t in txs:
                t.payout, t.paid_at = "held", now
            user.balance = int(user.balance or 0) + amount
            db.session.commit()
            balance = int(user.balance)
        return {"amount": amount, "amount_text": format_vnd(amount), "balance": balance}

    def _do_payout(self, method: str, bank: str | None = None, account: str | None = None,
                   base_url: str = "") -> dict:
        """Trả toàn bộ tiền chờ (mẻ vừa bỏ + số dư cũ). Gọi khi đang giữ _lock. Lỗi nhập -> ValueError."""
        with self.app.app_context():
            user = db.session.get(User, self.user_id)
            txs = Transaction.query.filter(Transaction.id.in_(self.pending_ids)).all() if self.pending_ids else []
            balance = int(user.balance or 0)
            amount = sum(t.amount for t in txs) + balance
            if amount <= 0:
                raise ValueError("Không có tiền để nhận")
            last4 = voucher = None
            if method == "transfer":
                account = "".join(c for c in str(account or "") if c.isdigit())
                if bank not in self.app.config["BANKS"]:
                    raise ValueError("Vui lòng chọn ngân hàng")
                if not 6 <= len(account) <= 19:
                    raise ValueError("Số tài khoản gồm 6–19 chữ số")
                last4 = account[-4:]          # chỉ lưu 4 số cuối để đối soát, KHÔNG lưu STK đầy đủ
            po = Payout(user_id=user.id, station_id=self.station_id, method=method, amount=amount,
                        bank=bank if method == "transfer" else None, account_last4=last4, created_at=datetime.now())
            if method == "voucher":
                voucher = voucher_service.create_voucher(user.id, self.station_id, amount)
                po.voucher_id = voucher.id
            db.session.add(po)
            db.session.flush()
            now = datetime.now()
            for t in txs:
                t.payout, t.paid_at, t.payout_id = method, now, po.id
            # giao dịch đã giữ vào số dư trước đó cũng gắn vào lần nhận này
            if balance:
                for t in Transaction.query.filter_by(user_id=user.id, payout="held", payout_id=None):
                    t.payout_id = po.id
            user.balance = 0
            if method == "transfer":
                user.total_received = int(user.total_received or 0) + amount
            elif method == "charity":
                user.total_donated = int(user.total_donated or 0) + amount
            else:
                user.total_voucher = int(user.total_voucher or 0) + amount
            db.session.commit()
            info = {
                "method": method, "amount": amount, "amount_text": format_vnd(amount),
                "bottles": sum(t.bottles for t in txs), "cans": sum(t.cans for t in txs),
                "from_balance": balance,
                "bank": po.bank, "account": f"****{last4}" if last4 else None,
                "voucher": voucher_service.voucher_to_dict(voucher, qr=True, base_url=base_url) if voucher else None,
                "total_received": int(user.total_received), "total_donated": int(user.total_donated),
                "total_voucher": int(user.total_voucher), "payout_id": po.id,
            }
        self.pending_ids = []
        self.payout_deadline = None
        self.last_payout = info
        return info

    def payout(self, method: str, bank: str | None = None, account: str | None = None, base_url: str = "") -> dict:
        if method not in PAYOUTS:
            return {"ok": False, "error": "Cách nhận không hợp lệ"}
        with self._lock:
            if self.state not in SESSION_STATES or self.user_id is None:
                return {"ok": False, "error": "Không có phiên người dùng"}
            try:
                info = self._do_payout(method, bank, account, base_url or self.app.config["PUBLIC_BASE_URL"])
            except ValueError as e:
                return {"ok": False, "error": str(e)}
            self.touch()
        if method == "transfer":
            self._message(f"Đã chuyển {info['amount_text']} vào {info['bank']} {info['account']}", "success", "transfer")
        elif method == "charity":
            self._message(f"Cảm ơn bạn đã góp {info['amount_text']} vào quỹ từ thiện", "success", "charity")
        else:
            self._message(f"Đã tạo voucher {info['amount_text']} – quét mã QR để dùng", "success", "voucher")
        self._emit("payout", {k: v for k, v in info.items() if k != "voucher"} | {"station_id": self.station_id})
        self.broadcast()
        return {"ok": True}

    # ------------------------------------------------------------------ cảm biến
    def on_sensor(self, name: str, value: bool):
        if name not in SENSOR_NAMES:
            raise KeyError(name)
        emptied = start = False
        with self._lock:
            self.hal.update_sensor(name, value)
            if self.state in SESSION_STATES:
                self.touch()
            if name == "door_closed":
                if not value and self.state in SESSION_STATES:
                    self._door_opened = True
                elif value and self.state == IDLE and not self.door_locked:
                    self._set_lock(True)
                elif value and self.state in SESSION_STATES and self._door_opened:
                    start = True          # đóng cửa sau khi bỏ rác -> quét
            if name == "storage_bin_in":
                if not value:
                    self._bin_removed = True
                elif self._bin_removed:
                    self._bin_removed = False
                    emptied = True
        if emptied:
            self.empty_storage()  # xe thùng đã được rút ra đổ rồi đẩy vào lại
        if start:
            self.start_intake()
        self.broadcast()

    def empty_storage(self):
        with self.app.app_context():
            st = self._station()
            st.storage_count = 0
            st.is_full = False
            st.last_emptied_at = datetime.now()
            for k in BIN_KINDS:
                setattr(st, f"bin_{k}", 0)
            db.session.commit()
        self.hal.set_led("status", "busy" if self.busy else "ready")
        self.broadcast()

    # ------------------------------------------------------------------ thùng rác công cộng 2 bên
    def public_drop(self, side: str) -> bool:
        if side not in PUBLIC_SIDES:
            return False
        with self.app.app_context():
            p = self._public()
            if p[side] >= p["capacity"]:
                self._message("Thùng rác này đã đầy, vui lòng bỏ sang thùng bên kia", "warning", "public_full")
                return False
            st = self._station()
            setattr(st, f"public_{side}", p[side] + 1)
            db.session.commit()
        self.broadcast()
        return True

    def empty_public(self, side: str) -> bool:
        if side not in (*PUBLIC_SIDES, "all"):
            return False
        with self.app.app_context():
            st = self._station()
            for s in PUBLIC_SIDES if side == "all" else (side,):
                setattr(st, f"public_{s}", 0)
            db.session.commit()
        self.broadcast()
        return True

    # ------------------------------------------------------------------ khoang nạp: đóng cửa -> quét
    def start_intake(self) -> bool:
        with self._lock:
            if self.state not in SESSION_STATES or not self._door_opened or self._sorter_running:
                return False
            if self.maintenance:
                self._message("Trạm đang được bảo trì / thu gom, vui lòng chờ", "warning", "maintenance")
                return False
            if self._station_full():
                self._message("Trạm đã đầy, vui lòng lấy rác ra và quay lại sau", "error", "full")
                return False
            if self.detector is None:
                self._message(f"Bộ nhận diện chưa sẵn sàng: {self.detector_error}", "error", "detector")
                return False
            self._door_opened = False
            self._resume_state = READY if self.state == ALARM else self.state
            self._set_alarm(False)
            self.state = SETTLE
            self.countdown = None
            self.door_locked = True
        self.broadcast()
        self._spawn(self._intake_safe)
        return True

    def _intake_safe(self):
        with self.app.app_context():
            try:
                self._intake()
            except Exception as e:  # lỗi phần cứng hoặc lỗi bất ngờ
                log.exception("Intake failed")
                db.session.rollback()
                self._finish_intake(self._resume_state, {
                    "status": "error", "message": "Lỗi thiết bị. Vui lòng mở cửa lấy rác ra và thử lại",
                    "detail": str(e), "bottles": 0, "cans": 0, "amount": 0, "rejected": []})

    def _detect_intake(self) -> tuple[Frame, list]:
        frame = self.hal.capture("tray")
        dets = self._detect(frame)
        if self.bg is not None and getattr(self.detector, "uses_image", False):
            try:
                dets += self.bg.unknown_objects(frame.image, dets)
            except Exception:  # so nền chỉ là lớp chặn thêm, lỗi không được làm hỏng quy trình
                log.exception("background check")
        self._emit_frame("scan:frame", frame, dets)
        return frame, dets

    def _learn_bg(self):
        """Chụp khay đang trống để học nền (gọi khi chắc chắn khay trống)."""
        if self.bg is None or not getattr(self.detector, "uses_image", False):
            return
        try:
            self.bg.learn([self.hal.capture_background().image])
        except Exception:
            log.exception("learn background")

    def _summary(self, dets, decision: str, scan_failed: bool = False) -> dict:
        bottles = sum(d.group == "bottle" for d in dets)
        cans = sum(d.group == "can" for d in dets)
        others = sum(d.group == "other" and d.source == "model" for d in dets)
        unknown = sum(d.source == "background" for d in dets)
        pb, pc = settings.get_prices()
        amount = calc_amount(bottles, cans, pb, pc) if decision == "accept" else 0
        if scan_failed:
            msg = "Rác chồng lên nhau, camera không nhìn rõ. Vui lòng mở cửa, dàn rác ra rồi đóng cửa"
        elif decision == "accept":
            msg = f"Nhận {bottles} chai nhựa, {cans} lon – {format_vnd(amount)}"
        elif decision == "empty":
            msg = "Khay trống"
        else:
            parts = []
            if others:
                parts.append(f"{others} vật không phải chai/lon")
            if unknown:
                parts.append(f"{unknown} vật lạ")
            msg = f"Có {' và '.join(parts) or 'vật không hợp lệ'}! Vui lòng lấy vật khoanh đỏ ra rồi đóng cửa"
        return {"decision": decision, "scan_failed": scan_failed, "bottles": bottles, "cans": cans,
                "others": others, "unknown": unknown, "amount": amount, "amount_text": format_vnd(amount),
                "message": msg}

    def _boxes(self, dets, scale: float = 1.0) -> list[dict]:
        labels_vi = self.app.config["LABEL_VI"]
        return [{"bbox": [round(v * scale) for v in d.bbox], "label": d.label,
                 "label_vi": labels_vi.get(d.label, d.label), "group": d.group, "valid": d.is_valid,
                 "confidence": round(d.confidence, 3), "source": d.source, "overlapped": d.overlapped}
                for d in dets]

    @staticmethod
    def _jpeg(img, max_size=None, quality=85) -> tuple[str, int, int]:
        if max_size:
            img = img.copy()
            img.thumbnail(max_size)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), img.width, img.height

    def _emit_frame(self, event: str, frame: Frame, dets: list, extra: dict | None = None, max_size=(480, 360)):
        """Gửi ảnh camera + khung nhận diện cho màn hình (chỉ để hiển thị, lỗi không làm hỏng quy trình)."""
        try:
            image, w, h = self._jpeg(frame.image, max_size, 72)
            self._emit(event, {"image": image, "width": w, "height": h,
                               "boxes": self._boxes(dets, w / frame.image.width), **(extra or {})})
        except Exception:
            log.exception(event)

    def _emit_scan(self, frame: Frame, dets: list, summary: dict, result: dict | None):
        """Ảnh nhận diện khoang nạp (khung từng vật) cho popup trên trang mô phỏng + màn hình."""
        image, w, h = self._jpeg(frame.image, quality=85)
        data = {"id": time.time(), **summary, "width": w, "height": h, "boxes": self._boxes(dets),
                "detector": getattr(self.detector, "name", type(self.detector).__name__),
                "rejected": (result or {}).get("rejected", [])}
        self.last_scan = data
        self._emit("scan:result", {**data, "image": image})

    def _intake(self):
        self.hal.lock_door(True)
        self.hal.set_led("status", "busy")
        cfg = self.app.config
        self._set_state(SCAN)
        frame, dets = self._detect_intake()
        attempts = 1
        retries = settings.get_int("max_vibrate_retries")
        # Nhiều vật -> rung khay cho tản ra trước rồi mới quét tính tiền; còn chồng nhau thì rung thêm
        need = len(dets) > 1 or any(d.overlapped for d in dets)
        while need and attempts <= retries + 1:
            self._set_state(SETTLE)
            self.hal.tray_vibrate(cfg["VIBRATE_SECONDS"])
            self._set_state(SCAN)
            frame, dets = self._detect_intake()
            attempts += 1
            need = any(d.overlapped for d in dets)
        scan_failed = any(d.overlapped for d in dets)
        if scan_failed:
            decision = "reject"
        elif not dets:
            decision = "empty"
        else:
            decision = "accept" if all(d.is_valid for d in dets) else "reject"
        summary = self._summary(dets, decision, scan_failed)

        if decision == "empty":
            self._emit_scan(frame, dets, summary, None)
            return self._finish_intake(self._resume_state, None, message=("Khay trống – chưa có rác", "info"))

        if decision == "accept":
            bottles, cans, amount = summary["bottles"], summary["cans"], summary["amount"]
            tx = self._new_tx("accepted", attempts, bottles, cans, amount)
            self._save_scan(tx, frame)
            db.session.commit()
            if amount > 0:
                self.pending_ids.append(tx.id)
            result = {"status": "accepted", "tx_id": tx.id, "bottles": bottles, "cans": cans, "amount": amount,
                      "amount_text": format_vnd(amount), "rejected": [], "message": summary["message"]}
            self._emit_scan(frame, dets, summary, result)
            self._finish_intake(RESULT, result, keep_locked=True)
            self._queue_sort(frame, dets)
            return

        # Có rác lạ -> còi + đèn đỏ + bung hé cửa
        tx = self._new_tx("scan_failed" if scan_failed else "rejected", attempts)
        self._save_scan(tx, frame)
        rejected = [] if scan_failed else self._save_rejected(tx, frame, dets)
        db.session.commit()
        result = {"status": tx.status, "tx_id": tx.id, "bottles": 0, "cans": 0, "amount": 0,
                  "rejected": rejected, "message": summary["message"]}
        self._emit_scan(frame, dets, summary, result)
        with self._lock:
            self._set_alarm(True)
        self.hal.pop_door()
        self._finish_intake(ALARM, result, popped=True)
        if tx.status == "rejected":
            self._check_reject_repeat()

    def _finish_intake(self, state: str, result: dict | None, keep_locked: bool = False, popped: bool = False,
                       message: tuple[str, str] | None = None):
        with self._lock:
            if result is not None:
                self.last_result = result
            self.state = state if self.user_id else IDLE
            self.door_locked = keep_locked
            if popped:
                self._door_opened = True   # cửa đã bung hé -> người dùng đóng lại là quét lại
            self._arm_payout_deadline()
            self.touch()
        if not keep_locked and not popped:
            try:
                self.hal.lock_door(False)
            except HardwareError as e:
                log.warning("Hardware: %s", e)
        self.hal.set_led("door_lock", "locked" if keep_locked else "unlocked")
        self.hal.set_led("status", "full" if self._station_full() else ("busy" if self.busy else "ready"))
        if result is not None:
            self._emit("result", result)
        if message:
            self._message(*message, "intake")
        self.broadcast()

    # ------------------------------------------------------------------ camera giám sát (an ninh)
    def _check_reject_repeat(self):
        """Bỏ rác lạ nhiều lần (trong phiên hoặc trong 24 giờ cùng số điện thoại) -> sự cố an ninh."""
        with self._lock:
            self._session_rejects += 1
            n, uid = self._session_rejects, self.user_id
        with self.app.app_context():
            day = Transaction.query.filter(
                Transaction.user_id == uid, Transaction.status == "rejected",
                Transaction.created_at >= datetime.now() - timedelta(days=1)).count() if uid else 0
            lim_s, lim_d = settings.get_int("security_reject_session"), settings.get_int("security_reject_day")
        if n >= lim_s or (uid and day >= lim_d):
            self._security("reject_repeat", f"Bỏ rác lạ {n} lần trong phiên, {day} lần trong 24 giờ")

    def on_security(self, name: str, value) -> bool:
        """Cảm biến an ninh: impact {g}, tamper (1 lần cạy khay / cửa khi khóa), camera_blocked {giây, 0 = hết che}.
        Trả về True nếu đã lập sự cố."""
        if name not in SECURITY_SENSORS:
            raise KeyError(name)
        cfg = self.app.config
        if name == "impact":
            g = float(value or 0)
            if g < SECURITY_IMPACT_G:
                return False
            return self._security("impact", f"Va đập mạnh vào thân trạm ({g:.1f} g)")
        if name == "tamper":
            now = time.monotonic()
            with self._lock:
                self._tamper.append(now)
                while self._tamper and now - self._tamper[0] > cfg["SECURITY_TAMPER_WINDOW"]:
                    self._tamper.popleft()
                n = len(self._tamper)
                if n >= cfg["SECURITY_TAMPER_COUNT"]:
                    self._tamper.clear()
            if n < cfg["SECURITY_TAMPER_COUNT"]:
                return False
            return self._security("tamper", f"Cố cạy khay / cửa {n} lần trong {cfg['SECURITY_TAMPER_WINDOW']} giây "
                                            "khi máy đang khóa")
        sec = float(value or 0)
        was, self.camera_blocked = self.camera_blocked, sec > 0
        if was != self.camera_blocked:
            self.broadcast()
        if sec <= 0 or was:
            return False
        return self._security("camera_blocked", f"Camera giám sát bị che liên tục {sec:.0f} giây")

    def _security(self, kind: str, detail: str) -> bool:
        now = time.monotonic()
        with self.app.app_context():
            cooldown = settings.get_int("security_cooldown_sec")
        with self._lock:
            if now - self._sec_last.get(kind, -1e9) < cooldown:
                return False
            self._sec_last[kind] = now
            uid = self.user_id
        self._message(SECURITY_TEXT[kind], "error", "security")
        self._spawn(lambda: self._record_security(kind, detail, uid))
        return True

    def _record_security(self, kind: str, detail: str, uid):
        """Chụp ảnh camera giám sát, lưu sự cố, báo admin (luồng nền)."""
        shot = {}
        try:
            shot = self.hal.security_snapshot()
        except Exception as e:   # camera lỗi vẫn lưu sự cố (không có ảnh)
            log.warning("Security camera: %s", e)
        with self.app.app_context():
            ev = SecurityEvent(station_id=self.station_id, user_id=uid, kind=kind, detail=detail[:255],
                               created_at=datetime.now())
            db.session.add(ev)
            db.session.flush()
            folder = Path(self.app.config["DATA_DIR"]) / "security"
            folder.mkdir(parents=True, exist_ok=True)
            for key, col, suffix in (("image", "image_path", ""), ("before", "before_path", "_truoc")):
                img = shot.get(key)
                if img is not None:
                    name = f"se{ev.id}{suffix}.jpg"
                    img.save(folder / name, quality=85)
                    setattr(ev, col, f"security/{name}")
            db.session.commit()
            info = {"id": ev.id, "kind": kind, "detail": ev.detail, "station_id": self.station_id,
                    "station_code": self._station().code, "created_at": ev.created_at.isoformat(" ", "seconds")}
        log.warning("An ninh trạm %s: %s – %s", self.station_id, kind, detail)
        self._emit("security", info)

    # ------------------------------------------------------------------ giao dịch + lưu ảnh
    def _new_tx(self, status, attempts, bottles=0, cans=0, amount=0, source="tray", user_id="session") -> Transaction:
        pb, pc = settings.get_prices()
        tx = Transaction(station_id=self.station_id, user_id=self.user_id if user_id == "session" else user_id, source=source,
                         bottles=bottles, cans=cans, price_bottle=pb, price_can=pc,
                         amount=amount, status=status, scan_attempts=attempts)
        db.session.add(tx)
        db.session.flush()
        return tx

    def _save_scan(self, tx: Transaction, frame: Frame):
        scan_dir = self.app.config["SCAN_DIR"]
        scan_dir.mkdir(parents=True, exist_ok=True)
        frame.image.save(scan_dir / f"tx{tx.id}.jpg", quality=88)
        tx.image_path = f"scans/tx{tx.id}.jpg"

    def _save_rejected(self, tx, frame, dets) -> list[dict]:
        rejected = []
        labels_vi = self.app.config["LABEL_VI"]
        for i, d in enumerate(x for x in dets if not x.is_valid):
            path = save_crop(frame.image, d.bbox, self.app.config["CROP_DIR"], f"tx{tx.id}_{i}",
                             self.app.config["CROP_MARGIN"])
            rel = f"crops/{path.name}"
            db.session.add(RejectedItem(transaction_id=tx.id, label=d.label, confidence=round(d.confidence, 4),
                                        bbox_x1=d.bbox[0], bbox_y1=d.bbox[1], bbox_x2=d.bbox[2],
                                        bbox_y2=d.bbox[3], crop_path=rel))
            rejected.append({"label": d.label, "label_vi": labels_vi.get(d.label, d.label),
                             "confidence": round(d.confidence, 4), "crop_url": f"/media/{rel}",
                             "bbox": list(d.bbox)})
        return rejected

    def _bin_add(self, kind: str):
        """Một vật vừa rơi vào thùng `kind` bên trong (gọi trong app context)."""
        station = self._station()
        setattr(station, f"bin_{kind}", getattr(station, f"bin_{kind}") + 1)
        station.storage_count += 1
        if station.storage_count >= station.storage_capacity:
            station.is_full = True
        db.session.commit()

    # ------------------------------------------------------------------ khu phân loại (luồng nền)
    def _sorter_set(self, state: str, **kw):
        with self._lock:
            self.sorter.update(state=state, **kw)
        self.broadcast()

    def _queue_sort(self, frame: Frame, dets: list):
        """Mẻ vừa tính tiền nằm trên khay -> phân loại ngay (dùng luôn khung của lần quét tính tiền)."""
        with self._lock:
            self._sort_job = (frame, dets)
            self._sorter_running = True
        self.broadcast()
        self._spawn(self._sorter_loop)

    def _sorter_loop(self):
        with self.app.app_context():
            try:
                with self._lock:
                    job, self._sort_job = self._sort_job, None
                self._sorter_set("start", round=0, done=0, total=0, last=None, error=None, current=0)
                self._belt_free.wait(self.app.config["ACTUATOR_TIMEOUT_SEC"] * 2)   # chờ vật từ lỗ từ thiện chạy hết băng
                self.hal.tray_gate(True)           # lật vách trái khay xuống: mép khay khớp miệng phễu
                try:
                    self._sort(*job)
                finally:
                    self.hal.tray_gate(False)      # đóng lại trước khi mở khóa cửa (khay kín 4 phía)
                self._learn_bg()                   # khay vừa trống -> học lại nền cho lần quét sau
            except Exception as e:
                log.exception("Sorter failed")
                db.session.rollback()
                with self._lock:
                    self.sorter.update(state="error", error=str(e))
                self._message("Khu phân loại gặp lỗi – đã báo nhân viên kỹ thuật", "error", "sorter")
            finally:
                with self._lock:
                    self._sorter_running = False
                    if self.sorter["state"] != "error":
                        self.sorter.update(state="idle")
                self._unlock_after_sort()
                self.hal.set_led("status", "full" if self._station_full() else ("busy" if self.busy else "ready"))
                self.broadcast()

    def _unlock_after_sort(self):
        with self._lock:
            unlock = self.state in SESSION_STATES and self.door_locked
            if unlock:
                self._set_lock(False)

    def _sort(self, frame: Frame, dets: list):
        cfg = self.app.config
        done = 0
        dets = [d for d in dets if d.source == "model"]
        for rnd in range(1, cfg["SORT_MAX_ROUNDS"] + 1):
            if rnd > 1:                                     # vòng sau: quét lại tìm vật còn sót
                self._sorter_set("scan", round=rnd)
                frame, dets = self._detect_sorter()
                tries, retries = 0, settings.get_int("max_vibrate_retries")
                while any(d.overlapped for d in dets) and tries < retries:
                    self._sorter_set("vibrate")
                    self.hal.tray_gate(False)               # rung với vách kín: vật không văng vào phễu
                    self.hal.tray_vibrate(cfg["VIBRATE_SECONDS"])
                    self.hal.tray_gate(True)
                    self._sorter_set("scan")
                    frame, dets = self._detect_sorter()
                    tries += 1
            if not dets:
                break
            order = pick_order(dets, frame.image.size, cfg["FUNNEL_IMG"])
            self._emit_frame("sorter:scan", frame, order, {"round": rnd}, max_size=(640, 480))
            with self._lock:
                self.sorter.update(round=rnd, total=done + len(order))
            pushed = 0
            for i, d in enumerate(order, 1):
                self._sorter_set("pick", current=i)
                r = self.hal.gripper_push(d.bbox) or {}
                if not r.get("pushed", True):
                    continue
                pushed += 1
                self._await_drop()
                self._belt_route(fallback=d)
                done += 1
                self._sorter_set("pick", done=done)
            if not pushed:
                break
        # Vật model không thấy trên khay -> gạt từng vật còn sót vào phễu, camera băng chuyền xử lý
        for _ in range(cfg["TRAY_MAX_ITEMS"]):
            self._sorter_set("sweep")
            if not (self.hal.tray_sweep() or {}).get("pushed"):
                break
            self._await_drop()
            self._belt_route(fallback=None)
            done += 1
            self._sorter_set("sweep", done=done, total=max(done, self.sorter["total"]))

    def _detect_sorter(self) -> tuple[Frame, list]:
        frame = self.hal.capture("tray")
        return frame, self._detect(frame)

    # ------------------------------------------------------------------ phễu: chờ vật rơi xuống băng
    def _funnel_set(self, **kw):
        with self._lock:
            self.funnel.update(**kw)
        self.broadcast()

    def _await_drop(self) -> bool:
        """Vật vừa vào phễu -> camera băng chuyền canh vật mới. Quá FUNNEL_WAIT_SEC chưa thấy (kẹt):
        phễu mở dần từng nấc -> rung phễu -> báo kẹt cho nhân viên (cửa vẫn khóa), kiểm tra lại định kỳ.
        Trả về False nếu vật đã nằm trên băng ngay (không kẹt)."""
        cfg = self.app.config
        wait = lambda sec: bool((self.hal.belt_wait(sec) or {}).get("arrived"))   # noqa: E731
        if wait(cfg["FUNNEL_WAIT_SEC"]):
            return False
        log.info("Funnel: no item on belt after %ss -> opening", cfg["FUNNEL_WAIT_SEC"])
        steps = max(1, cfg["FUNNEL_OPEN_STEPS"])
        jammed = False
        try:
            for i in range(1, steps + 1):
                self._funnel_set(open=round(i / steps, 3))
                self.hal.funnel_open(i / steps)
                if wait(cfg["FUNNEL_STEP_SEC"]):
                    return True
            for _ in range(cfg["FUNNEL_SHAKES"]):
                self.hal.funnel_shake()
                if wait(cfg["FUNNEL_STEP_SEC"]):
                    return True
            # kẹt hẳn: báo nhân viên, chờ gỡ kẹt (vẫn tự kiểm tra lại định kỳ – vật có thể tự lọt)
            jammed = True
            self._jam_clear.clear()
            self._funnel_set(jam=True)
            self._message("Phễu bị kẹt rác – đã báo nhân viên kỹ thuật, vui lòng chờ", "error", "jam")
            self.hal.set_led("status", "error")
            while True:
                self._jam_clear.wait(cfg["FUNNEL_JAM_RECHECK_SEC"])
                self._jam_clear.clear()
                if wait(cfg["FUNNEL_STEP_SEC"]):
                    return True
        finally:
            self.hal.funnel_open(0.0)              # thu cổ phễu về hẹp
            self._funnel_set(open=0.0, jam=False)
            if jammed:
                self._message("Đã gỡ kẹt phễu, máy tiếp tục phân loại", "success", "jam")
                self.hal.set_led("status", "busy")

    def clear_jam(self) -> bool:
        """Nhân viên đã gỡ vật kẹt trong phễu (nút trên trang Admin / mô phỏng)."""
        if not self.funnel["jam"]:
            return False
        self._jam_clear.set()
        return True

    def _belt_route(self, fallback=None, source: str = "sorter") -> tuple[str, object, Frame | None]:
        """Vật vừa tới dưới camera băng chuyền -> nhận diện -> hẹn giờ thanh gạt -> thùng.
        Trả về (loại, detection, ảnh)."""
        cfg = self.app.config
        frame = self.hal.capture("belt")
        dets = self._detect(frame)
        best = max(dets, key=lambda d: d.confidence) if dets else None
        if best is not None and best.is_valid:
            kind, by = best.group, "belt"
        elif fallback is not None and fallback.is_valid:
            kind, by = fallback.group, "sorter"     # camera băng không chắc -> dùng kết quả camera khay
        else:
            kind, by = "other", "none"
        delay = round(belt_delay(kind, cfg["BELT_CAMERA_X"], cfg["BELT_PUSHERS"], cfg["BELT_SPEED"],
                                 cfg["BELT_END_X"]), 3)
        labels_vi = cfg["LABEL_VI"]
        det = best or fallback
        info = {"kind": kind, "by": by, "delay": delay, "source": source,
                "label": det.label if det else None,
                "label_vi": labels_vi.get(det.label, det.label) if det else "Không rõ",
                "confidence": round(det.confidence, 3) if det else None}
        self._emit_frame("belt:frame", frame, dets, info, max_size=(320, 240))
        with self._lock:
            self.sorter["last"] = info
        self.hal.belt_sort(kind, delay)
        self._bin_add(kind)
        return kind, best, frame

    # ------------------------------------------------------------------ lỗ từ thiện
    def on_slot_item(self) -> bool:
        """Cảm biến cuối ống lỗ từ thiện: 1 vật vừa rơi xuống đầu băng chuyền."""
        with self._lock:
            if self._belt_busy or self._sorter_running or self.detector is None:
                return False
            self._belt_busy = True
            self._belt_free.clear()
        self.broadcast()
        self._spawn(self._slot_safe)
        return True

    def _slot_safe(self):
        with self.app.app_context():
            try:
                self._slot()
            except Exception as e:
                log.exception("Slot processing failed")
                db.session.rollback()
                self._finish_slot({"status": "error", "detail": str(e), "rejected": [],
                                   "message": "Lỗi băng chuyền – đã báo nhân viên kỹ thuật"})

    def _slot(self):
        self._await_drop()                         # vật từ ống lỗ từ thiện rơi qua phễu xuống băng
        kind, det, frame = self._belt_route(source="slot")
        labels_vi = self.app.config["LABEL_VI"]
        name = labels_vi.get(det.label, det.label) if det else "Vật không rõ"
        ok = kind in ("bottle", "can")
        tx = self._new_tx("accepted" if ok else "rejected", 1, int(kind == "bottle"), int(kind == "can"),
                          0, source="slot", user_id=None)
        self._save_scan(tx, frame)
        rejected = self._save_rejected(tx, frame, [det]) if det is not None and not ok else []
        db.session.commit()
        msg = (f"Cảm ơn bạn đã ủng hộ! {name} → thùng {'chai nhựa' if kind == 'bottle' else 'lon'}" if ok
               else f"{name} không phải chai/lon → thùng rác khác. Lần sau hãy bỏ vào thùng rác 2 bên trạm nhé")
        self._finish_slot({"status": "accepted" if ok else "rejected", "tx_id": tx.id, "kind": kind,
                           "label_vi": name, "rejected": rejected, "message": msg})

    def _finish_slot(self, result: dict):
        result["at"] = time.time()
        with self._lock:
            self.last_slot = result
            self._belt_busy = False
            self._belt_free.set()
        level = {"accepted": "success", "rejected": "warning"}.get(result["status"], "warning")
        self._message(result["message"], level, "slot")
        self._emit("slot:result", result)
        self.broadcast()
