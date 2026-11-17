"""Máy trạng thái của trạm – nguồn sự thật duy nhất cho toàn bộ quy trình.

Front-end (scene 3D / màn hình cảm ứng) chỉ gửi sự kiện và hiển thị trạng thái server phát ra.

Hai đường nhận rác:
  * Khay nạp (cần chọn tên): TÍNH TIỀN -> đổ -> (rung) -> quét -> kho | trả cả đống.
  * Lỗ bỏ từng chai/lon (không cần mở cửa): mỗi vật rơi xuống mặt phẳng quét được quét riêng.
    Có người dùng -> cộng dồn chờ tính tiền; chưa chọn tên -> vẫn phân loại nhưng không tính tiền.
Sau TÍNH TIỀN, tiền chờ (khay + lỗ) được người dùng chọn: chuyển khoản hoặc góp quỹ từ thiện.
"""
import base64
import io
import logging
import threading
import time
from datetime import datetime

from app.detection import Detector, Frame
from app.detection.cropper import save_crop
from app.models import PAYOUTS, RejectedItem, Transaction, User, db
from app.services import settings_service as settings
from app.services.pricing import calc_amount, format_vnd
from app.services.user_service import user_to_dict

from .hal import HardwareError, HardwareInterface

log = logging.getLogger(__name__)

# ---- Trạng thái ----
IDLE = "IDLE"
READY = "READY"
TRANSFER = "PROCESSING_TRANSFER"
PRESCAN = "PROCESSING_PRESCAN"
VIBRATE = "PROCESSING_VIBRATE"
SCAN = "PROCESSING_SCAN"
ACCEPTING = "ACCEPTING"
REJECTING = "REJECTING"
SLOT = "PROCESSING_SLOT"   # đang quét 1 vật bỏ qua lỗ
RESULT = "RESULT"

PROCESSING_STATES = {TRANSFER, PRESCAN, VIBRATE, SCAN, ACCEPTING, REJECTING, SLOT}
SESSION_STATES = {READY, RESULT}  # có người dùng, máy đang rảnh

SENSOR_NAMES = {"door_closed", "feed_drawer_in", "feed_drawer_jammed", "return_drawer_in",
                "rear_door_closed", "storage_bin_in"}


class StationController:
    def __init__(self, app, hal: HardwareInterface, detector: Detector | None, emit, spawn=None,
                 detector_error: str | None = None):
        self.app = app
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
        # Lỗ bỏ chai
        self._resume_state = IDLE
        self._gate_open: bool | None = None
        self.last_slot: dict | None = None
        # Thùng chứa đã được rút ra (để biết khi đẩy vào là đã đổ rác)
        self._bin_removed = False

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
        return (self.state not in PROCESSING_STATES and not station_full and not self.maintenance
                and self.hal.sensors["return_drawer_in"] and self.detector is not None)

    def _sync_gate(self, open_: bool):
        """Nắp lỗ bỏ chai bám theo điều kiện nhận vật."""
        if open_ == self._gate_open:
            return
        self._gate_open = open_
        self._hw(self.hal.slot_gate, open_)
        self.hal.set_led("slot", "open" if open_ else "closed")

    def _pending_summary(self) -> dict:
        """Tổng tiền chờ chọn (gọi trong app context)."""
        if not self.pending_ids:
            return {"amount": 0, "bottles": 0, "cans": 0, "count": 0}
        txs = Transaction.query.filter(Transaction.id.in_(self.pending_ids)).all()
        return {"amount": sum(t.amount for t in txs), "bottles": sum(t.bottles for t in txs),
                "cans": sum(t.cans for t in txs), "count": len(txs)}

    def snapshot(self) -> dict:
        with self.app.app_context():
            station = settings.get_station()
            price_bottle, price_can = settings.get_prices()
            user = db.session.get(User, self.user_id) if self.user_id else None
            pending = self._pending_summary() if user else None
            payout_in = (max(0, int(self.payout_deadline - time.monotonic() + 0.999))
                         if self.payout_deadline is not None else None)
            return {
                "state": self.state,
                "processing": self.state in PROCESSING_STATES,
                "user": user_to_dict(user) if user else None,
                "sensors": dict(self.hal.sensors),
                "door_locked": self.door_locked,
                "maintenance": self.maintenance,
                "slot_open": self._slot_open(bool(station.is_full)),
                "station": {
                    "name": station.name,
                    "storage_count": station.storage_count,
                    "storage_capacity": station.storage_capacity,
                    "is_full": bool(station.is_full),
                },
                "prices": {"bottle": price_bottle, "can": price_can},
                "last_result": self.last_result,
                "pending": pending,
                "payout_in": payout_in,
                "last_payout": self.last_payout,
                "last_slot": self.last_slot,
                "countdown": self.countdown,
                "detector_error": self.detector_error,
            }

    def _station_full(self) -> bool:
        with self.app.app_context():
            return bool(settings.get_station().is_full)

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

    def touch(self):
        """Ghi nhận có thao tác của người dùng (reset đồng hồ tự đăng xuất)."""
        self.last_activity = time.monotonic()
        if self.countdown is not None:
            self.countdown = None
            self.broadcast()

    # ------------------------------------------------------------------ phiên người dùng
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
                db.session.commit()
                self.idle_timeout = settings.get_int("idle_timeout_sec")
                name = user.name
            self.user_id = user_id
            self.last_result = None
            self.last_payout = None
            self.pending_ids = []
            self.payout_deadline = None
            self.countdown = None
            self.touch()
            self.state = READY
            self._set_lock(False)
        self.broadcast()
        self._message(f"Xin chào {name}. Mời mở cửa và kéo khay ra", "info", "welcome")
        return True

    def logout(self, reason: str = "user") -> None:
        with self._lock:
            if self.state in PROCESSING_STATES or self.state == IDLE:
                return
            auto = self._do_payout("transfer", auto=True) if self.pending_ids else None
            self.state = IDLE
            self.user_id = None
            self.last_result = None
            self.last_payout = None
            self.payout_deadline = None
            self.countdown = None
            # Cửa đang mở thì chưa khóa được – sẽ khóa khi cửa đóng (xem on_sensor)
            if self.hal.sensors["door_closed"]:
                self._set_lock(True)
        self.broadcast()
        if auto:
            self._message(f"Đã tự động chuyển {auto['amount_text']} tới STK {auto['masked_account']}", "info", "auto_payout")
        if reason == "timeout":
            self._message("Đã tự đăng xuất do không có thao tác trong 2 phút", "info", "timeout")
        if not self.hal.sensors["door_closed"] or not self.hal.sensors["feed_drawer_in"]:
            self._message("Vui lòng đẩy khay vào và đóng cửa", "warning", "close_door")

    def continue_session(self) -> bool:
        with self._lock:
            if self.state == RESULT:
                if self.pending_ids:
                    self._message("Vui lòng chọn Chuyển khoản hoặc Từ thiện trước", "warning", "choose_payout")
                    return False
                self.state = READY
                self.last_result = None
                self.last_payout = None
        self.touch()
        self.broadcast()
        return True

    def tick(self):
        """Gọi mỗi giây: tự chuyển khoản khi hết giờ chọn, tự đăng xuất."""
        with self._lock:
            if self.state not in SESSION_STATES:
                return
            if self.payout_deadline is not None and time.monotonic() >= self.payout_deadline and self.pending_ids:
                self.payout("transfer", auto=True)
                return
            remaining = self.idle_timeout - (time.monotonic() - self.last_activity)
            warn = self.app.config["LOGOUT_WARNING_SEC"]
        if remaining <= 0:
            self.logout("timeout")
        elif remaining <= warn:
            sec = int(remaining + 0.999)
            if sec != self.countdown:
                self.countdown = sec
                self._emit("session:countdown", {"seconds": sec})

    # ------------------------------------------------------------------ chuyển khoản / từ thiện
    def _arm_payout_deadline(self):
        if self.pending_ids and self.state == RESULT and self.payout_deadline is None:
            with self.app.app_context():
                sec = settings.get_int("payout_timeout_sec")
            self.payout_deadline = time.monotonic() + sec

    def _do_payout(self, method: str, auto: bool = False) -> dict | None:
        """Ghi payout cho toàn bộ tiền chờ. Gọi khi đang giữ _lock."""
        ids, self.pending_ids = self.pending_ids, []
        self.payout_deadline = None
        with self.app.app_context():
            txs = Transaction.query.filter(Transaction.id.in_(ids)).all()
            user = db.session.get(User, self.user_id)
            amount = sum(t.amount for t in txs)
            now = datetime.now()
            for t in txs:
                t.payout = method
                t.paid_at = now
            if method == "transfer":
                user.total_received = int(user.total_received or 0) + amount
            else:
                user.total_donated = int(user.total_donated or 0) + amount
            db.session.commit()
            info = {
                "method": method, "auto": auto, "amount": amount, "amount_text": format_vnd(amount),
                "bottles": sum(t.bottles for t in txs), "cans": sum(t.cans for t in txs),
                "masked_account": user.masked_account,
                "total_received": int(user.total_received), "total_donated": int(user.total_donated),
                "tx_ids": ids,
            }
        self.last_payout = info
        return info

    def payout(self, method: str, auto: bool = False) -> bool:
        if method not in PAYOUTS:
            return False
        with self._lock:
            if self.state not in SESSION_STATES or not self.pending_ids:
                return False
            info = self._do_payout(method, auto)
            self.touch()
        if method == "transfer":
            pre = "Đã tự động chuyển" if auto else "Chuyển khoản thành công"
            self._message(f"{pre} {info['amount_text']} tới STK {info['masked_account']}", "success", "transfer")
        else:
            self._message(f"Cảm ơn bạn đã góp {info['amount_text']} vào quỹ từ thiện", "success", "charity")
        self._emit("payout", info)
        self.broadcast()
        return True

    # ------------------------------------------------------------------ cảm biến
    def on_sensor(self, name: str, value: bool):
        if name not in SENSOR_NAMES:
            raise KeyError(name)
        emptied = False
        with self._lock:
            self.hal.update_sensor(name, value)
            if self.state in SESSION_STATES:
                self.touch()
            if name == "feed_drawer_jammed" and value:
                self._message("Rác quá nhiều, khay không đẩy vào được. Vui lòng bớt rác ra", "warning", "jammed")
            if name == "door_closed" and value and self.state == IDLE and not self.door_locked:
                self._set_lock(True)
            if name == "return_drawer_in" and not value:
                self.hal.set_led("return_drawer", "off")
            if name == "storage_bin_in":
                if not value:
                    self._bin_removed = True
                elif self._bin_removed:
                    self._bin_removed = False
                    emptied = True
        if emptied:
            self.empty_storage()  # thùng đã được rút ra đổ rồi đẩy vào lại
        self.broadcast()

    def empty_storage(self):
        with self.app.app_context():
            st = settings.get_station()
            st.storage_count = 0
            st.is_full = False
            st.last_emptied_at = datetime.now()
            db.session.commit()
        self.hal.set_led("status", "busy" if self.state in PROCESSING_STATES else "ready")
        self.broadcast()

    # ------------------------------------------------------------------ nút TÍNH TIỀN
    def press_pay(self) -> bool:
        with self._lock:
            if self.state in PROCESSING_STATES:
                return False
            if self.state == IDLE:
                self._message("Vui lòng chọn tên của bạn trên màn hình trước", "warning", "no_session")
                return False
            self.touch()
            if self.state == RESULT and self.pending_ids:
                self._message("Vui lòng chọn Chuyển khoản hoặc Từ thiện trước", "warning", "choose_payout")
                return False
            if self.maintenance:
                self._message("Trạm đang được bảo trì / thu gom, vui lòng chờ", "warning", "maintenance")
                return False
            if self._station_full():
                self._message("Trạm đã đầy, vui lòng quay lại sau", "error", "full")
                return False
            s = self.hal.sensors
            if s["feed_drawer_jammed"] or not s["feed_drawer_in"] or not s["door_closed"]:
                self._message("Vui lòng đẩy khay vào và đóng cửa trước khi tính tiền", "warning", "door_open")
                return False
            if not s["return_drawer_in"]:
                self._message("Vui lòng đóng ngăn trả rác trước khi tính tiền", "warning", "return_open")
                return False
            if self.detector is None:
                self._message(f"Bộ nhận diện chưa sẵn sàng: {self.detector_error}", "error", "detector")
                return False
            self.state = TRANSFER
            self.last_result = None
            self.last_payout = None
            self.countdown = None
            self.door_locked = True
        self.broadcast()
        self._spawn(self._process_safe)
        return True

    # ------------------------------------------------------------------ quy trình xử lý khay
    def _process_safe(self):
        with self.app.app_context():
            try:
                self._process()
            except Exception as e:  # lỗi phần cứng hoặc lỗi bất ngờ
                log.exception("Processing failed")
                db.session.rollback()
                try:
                    self.hal.tilt_plate("return")
                except Exception:
                    pass
                self._finish({"status": "error", "message": "Lỗi thiết bị, rác đã được trả về ngăn dưới. Vui lòng thử lại",
                              "detail": str(e), "bottles": 0, "cans": 0, "amount": 0, "rejected": []})

    def _detect(self) -> tuple[Frame, list]:
        frame = self.hal.capture()
        dets = self.detector.detect(frame)
        self._emit_scan_frame(frame, dets)
        return frame, dets

    def _emit_scan_frame(self, frame: Frame, dets: list):
        """Gửi ảnh vừa chụp + khung nhận diện cho màn hình (như máy thật hiện ảnh camera)."""
        try:
            img = frame.image.copy()
            img.thumbnail((480, 360))
            sx = img.width / frame.image.width
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=72)
            labels_vi = self.app.config["LABEL_VI"]
            self._emit("scan:frame", {
                "image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
                "width": img.width, "height": img.height,
                "boxes": [{"bbox": [round(v * sx) for v in d.bbox], "label_vi": labels_vi.get(d.label, d.label),
                           "valid": d.is_valid, "overlapped": d.overlapped} for d in dets],
            })
        except Exception:  # chỉ để hiển thị, không được làm hỏng quy trình
            log.exception("scan:frame")

    def _process(self):
        self.hal.lock_door(True)
        self.hal.set_led("status", "busy")
        self.hal.dump_feed_tray()

        self._set_state(PRESCAN)
        frame, dets = self._detect()
        attempts = 1

        if len(dets) > 1:
            max_retries = settings.get_int("max_vibrate_retries")
            for _ in range(1 + max_retries):
                self._set_state(VIBRATE)
                self.hal.vibrate(self.app.config["VIBRATE_SECONDS"])
                self._set_state(SCAN)
                frame, dets = self._detect()
                attempts += 1
                if not any(d.overlapped for d in dets):
                    break
            else:
                return self._reject(frame, dets, attempts, scan_failed=True)

        if not dets:
            return self._record_empty(frame, attempts)
        if all(d.is_valid for d in dets):
            return self._accept(frame, dets, attempts)
        return self._reject(frame, dets, attempts)

    def _new_tx(self, status, attempts, bottles=0, cans=0, amount=0, source="tray", user_id="session") -> Transaction:
        pb, pc = settings.get_prices()
        tx = Transaction(user_id=self.user_id if user_id == "session" else user_id, source=source,
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

    def _add_to_storage(self, n: int):
        station = settings.get_station()
        station.storage_count += n
        if station.storage_count >= station.storage_capacity:
            station.is_full = True

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
                             "confidence": round(d.confidence, 4), "crop_url": f"/media/{rel}"})
        return rejected

    def _record_empty(self, frame, attempts):
        tx = self._new_tx("empty", attempts)
        self._save_scan(tx, frame)
        db.session.commit()
        self._finish({"status": "empty", "message": "Không phát hiện rác", "tx_id": tx.id,
                      "bottles": 0, "cans": 0, "amount": 0, "rejected": []})

    def _accept(self, frame, dets, attempts):
        self._set_state(ACCEPTING)
        self.hal.tilt_plate("storage")
        bottles = sum(d.group == "bottle" for d in dets)
        cans = sum(d.group == "can" for d in dets)
        pb, pc = settings.get_prices()
        amount = calc_amount(bottles, cans, pb, pc)

        tx = self._new_tx("accepted", attempts, bottles, cans, amount)
        self._save_scan(tx, frame)
        self._add_to_storage(bottles + cans)
        db.session.commit()
        if amount > 0:
            self.pending_ids.append(tx.id)

        self._finish({
            "status": "accepted", "tx_id": tx.id, "bottles": bottles, "cans": cans, "amount": amount,
            "amount_text": format_vnd(amount), "rejected": [],
            "message": f"Đã nhận {bottles} chai nhựa, {cans} lon nhôm",
        })

    def _reject(self, frame, dets, attempts, scan_failed=False):
        self._set_state(REJECTING)
        self.hal.tilt_plate("return")
        self.hal.set_led("return_drawer", "blink")

        tx = self._new_tx("scan_failed" if scan_failed else "rejected", attempts)
        self._save_scan(tx, frame)
        rejected = [] if scan_failed else self._save_rejected(tx, frame, dets)
        db.session.commit()

        if scan_failed:
            msg = "Không thể quét do rác đè lên nhau. Vui lòng lấy lại rác ở ngăn dưới và thử lại"
        else:
            msg = (f"Phát hiện {len(rejected)} vật không hợp lệ. Vui lòng lấy rác ở ngăn dưới, "
                   f"loại bỏ vật này rồi thử lại")
        self._finish({"status": tx.status, "tx_id": tx.id, "bottles": 0, "cans": 0, "amount": 0,
                      "rejected": rejected, "message": msg})

    def _finish(self, result: dict):
        with self._lock:
            self.last_result = result
            self.state = RESULT if self.user_id else IDLE
            self.door_locked = False
            self._arm_payout_deadline()
            self.touch()
        try:
            self.hal.lock_door(False)
        except HardwareError as e:
            log.warning("Hardware: %s", e)
        self.hal.set_led("status", "full" if self._station_full() else "ready")
        self._emit("result", result)
        self.broadcast()

    # ------------------------------------------------------------------ lỗ bỏ từng chai/lon
    def on_slot_item(self) -> bool:
        """Cảm biến cuối máng lỗ bỏ chai: có 1 vật vừa rơi xuống mặt phẳng quét."""
        with self._lock:
            if self.state in PROCESSING_STATES:
                return False
            self._resume_state = self.state
            self.state = SLOT
            self.countdown = None
        self.touch()
        self.broadcast()
        self._spawn(self._process_slot_safe)
        return True

    def _process_slot_safe(self):
        with self.app.app_context():
            try:
                self._process_slot()
            except Exception as e:
                log.exception("Slot processing failed")
                db.session.rollback()
                try:
                    self.hal.tilt_plate("return")
                except Exception:
                    pass
                self._finish_slot({"status": "error", "detail": str(e), "rejected": [],
                                   "message": "Lỗi thiết bị, vật đã được trả về ngăn dưới"})

    def _process_slot(self):
        self.hal.set_led("status", "busy")
        if self.detector is None:
            self.hal.tilt_plate("return")
            return self._finish_slot({"status": "error", "rejected": [],
                                      "message": "Bộ nhận diện chưa sẵn sàng, vật đã được trả về ngăn dưới"})
        frame, dets = self._detect()
        if not dets:
            self.hal.tilt_plate("return")
            return self._finish_slot({"status": "empty", "rejected": [],
                                      "message": "Không nhận diện được vật, đã trả về ngăn dưới"})

        user_id = self.user_id
        labels_vi = self.app.config["LABEL_VI"]
        names = ", ".join(labels_vi.get(d.label, d.label) for d in dets)
        if all(d.is_valid for d in dets):
            self.hal.tilt_plate("storage")
            bottles = sum(d.group == "bottle" for d in dets)
            cans = sum(d.group == "can" for d in dets)
            pb, pc = settings.get_prices()
            amount = calc_amount(bottles, cans, pb, pc) if user_id else 0
            tx = self._new_tx("accepted", 1, bottles, cans, amount, source="slot", user_id=user_id)
            self._save_scan(tx, frame)
            self._add_to_storage(bottles + cans)
            db.session.commit()
            if user_id and amount > 0:
                self.pending_ids.append(tx.id)
                msg = f"Đã nhận {names}: +{format_vnd(amount)} (cộng vào lần tính tiền)"
            else:
                msg = f"Đã nhận {names}. Chọn tên trước khi bỏ để được tính tiền"
            return self._finish_slot({"status": "accepted", "tx_id": tx.id, "bottles": bottles, "cans": cans,
                                      "amount": amount, "guest": not user_id, "label_vi": names,
                                      "rejected": [], "message": msg})

        self.hal.tilt_plate("return")
        self.hal.set_led("return_drawer", "blink")
        tx = self._new_tx("rejected", 1, source="slot", user_id=user_id)
        self._save_scan(tx, frame)
        rejected = self._save_rejected(tx, frame, dets)
        db.session.commit()
        self._finish_slot({"status": "rejected", "tx_id": tx.id, "rejected": rejected, "guest": not user_id,
                           "message": f"{names} không hợp lệ, đã trả về ngăn dưới"})

    def _finish_slot(self, result: dict):
        result["at"] = time.time()
        with self._lock:
            self.last_slot = result
            resume = self._resume_state
            # người dùng không thể đăng xuất khi máy bận nên phiên vẫn còn nguyên
            self.state = resume if (resume == IDLE or self.user_id) else IDLE
            self._arm_payout_deadline()
            self.touch()
        self.hal.set_led("status", "full" if self._station_full() else "ready")
        level = {"accepted": "success", "rejected": "warning"}.get(result["status"], "warning")
        self._message(result["message"], level, "slot")
        self._emit("slot:result", result)
        self.broadcast()
