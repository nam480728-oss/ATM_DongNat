import logging
import mimetypes
import time

from flask import Flask
from flask_socketio import SocketIO
from sqlalchemy import inspect

from .config import Config
from .models import REQUIRED_COLUMNS, REQUIRED_TABLES, db

socketio = SocketIO()
log = logging.getLogger(__name__)


class MissingTablesError(RuntimeError):
    pass


def check_tables(app):
    with app.app_context():
        existing = set(inspect(db.engine).get_table_names())
    missing = [t for t in REQUIRED_TABLES if t not in existing]
    if missing:
        raise MissingTablesError(
            f"Database thiếu bảng: {', '.join(missing)}. "
            "Hãy chạy file database/schema.sql trên atm_db (Navicat: Query -> New Query -> Run)."
        )
    with app.app_context():
        insp = inspect(db.engine)
        lacking = [f"{t}.{c}" for t, cols in REQUIRED_COLUMNS.items()
                   for c in cols if c not in {x["name"] for x in insp.get_columns(t)}]
    if lacking:
        raise MissingTablesError(f"Database thiếu cột: {', '.join(lacking)}. Hãy chạy: python tools/migrate.py")


def create_app(config_class=Config, hal=None, detector="auto", spawn=None):
    # Windows registry đôi khi map .js -> text/plain khiến trình duyệt chặn ES module
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    app = Flask(__name__)
    app.config.from_object(config_class)
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # luôn kiểm tra lại file tĩnh (tránh cache cũ)
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    for d in (app.config["SCAN_DIR"], app.config["CROP_DIR"]):
        d.mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    socketio.init_app(app, async_mode="threading", max_http_buffer_size=20_000_000)

    if app.config["CHECK_TABLES_ON_START"]:
        check_tables(app)

    # ---- Bộ nhận diện ----
    from .detection import DetectorUnavailable, build_detector
    detector_error = None
    if detector == "auto":
        try:
            detector = build_detector(app.config)
        except DetectorUnavailable as e:
            detector, detector_error = None, str(e)
            log.error("Detector: %s", e)

    # ---- Nhiều trạm trên 1 server trung tâm: mỗi trạm 1 controller + 1 phần cứng (mô phỏng: room 'sim:<id>')
    from .station.controller import StationController
    from .station.hal import SimulatedHardware

    app.extensions["stations"] = {}
    app.extensions["station_factory"] = lambda sid, hal=None: StationController(
        app, hal or SimulatedHardware(socketio, timeout=app.config["ACTUATOR_TIMEOUT_SEC"], room=f"sim:{sid}"),
        app.extensions["station"].detector if "station" in app.extensions else detector,   # trạm mới dùng bộ nhận diện hiện tại
        station_emitter(sid),
        spawn=spawn or (lambda fn: socketio.start_background_task(fn)),
        detector_error=app.extensions["station"].detector_error if "station" in app.extensions else detector_error,
        station_id=sid,
    )
    first = app.config["STATION_ID"]
    ctrl = app.extensions["station_factory"](first, hal)
    app.extensions["stations"][first] = ctrl
    app.extensions["station"] = ctrl          # trạm mặc định (test, API cũ)

    # Thêm ?v=<thời điểm sửa file> vào mọi link file tĩnh: sửa JS / CSS là trình duyệt (kể cả iframe màn hình trạm)
    # tải bản mới ngay, không dùng bản cũ trong bộ nhớ đệm
    import os

    @app.url_defaults
    def _static_version(endpoint, values):
        if endpoint == "static" and "filename" in values and "v" not in values:
            try:
                values["v"] = int(os.path.getmtime(os.path.join(app.static_folder, values["filename"])))
            except OSError:
                pass

    from .routes import admin, api, main, shop
    app.register_blueprint(main.bp)
    app.register_blueprint(shop.bp)
    app.register_blueprint(api.bp)
    app.register_blueprint(admin.bp)

    from .sockets import register_socket_handlers
    register_socket_handlers(socketio)
    return app


ADMIN_EVENTS = {"state", "result", "payout", "slot:result"}


def station_emitter(sid: int):
    """Sự kiện của trạm chỉ gửi tới màn hình + mô phỏng của trạm đó; trang admin nhận bản tin ngắn để làm mới."""
    def emit(event, data):
        socketio.emit(event, data, to=f"st:{sid}")
        if event in ADMIN_EVENTS:
            socketio.emit("admin:update", {"station": sid, "event": event}, to="admin")
        elif event == "security":     # sự cố an ninh: admin hiện thông báo ngay (ảnh xem qua API có đăng nhập)
            socketio.emit("admin:security", data, to="admin")
    return emit


def get_controller(app, sid, create: bool = True):
    """Controller của trạm `sid` (tạo khi trạm được mở lần đầu, nếu trạm có trong CSDL và đang hoạt động)."""
    stations = app.extensions["stations"]
    try:
        sid = int(sid)
    except (TypeError, ValueError):
        sid = app.config["STATION_ID"]
    if sid in stations or not create:
        return stations.get(sid)
    from .models import Station
    with app.app_context():
        st = db.session.get(Station, sid)
        if st is None or not st.is_active:
            return None
    stations[sid] = app.extensions["station_factory"](sid)
    return stations[sid]


def start_ticker(app):
    """Luồng nền gọi controller.tick() của mọi trạm mỗi giây (giữ tiền khi hết giờ chọn, tự đăng xuất)."""
    def loop():
        while True:
            time.sleep(1)
            for ctrl in list(app.extensions["stations"].values()):
                try:
                    ctrl.tick()
                except Exception:
                    log.exception("tick failed")

    socketio.start_background_task(loop)
