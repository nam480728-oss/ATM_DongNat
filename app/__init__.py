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

    # ---- Phần cứng + controller ----
    from .station.controller import StationController
    from .station.hal import SimulatedHardware
    if hal is None:
        hal = SimulatedHardware(socketio, timeout=app.config["ACTUATOR_TIMEOUT_SEC"])

    def emit(event, data):
        socketio.emit(event, data)

    app.extensions["station"] = StationController(
        app, hal, detector, emit,
        spawn=spawn or (lambda fn: socketio.start_background_task(fn)),
        detector_error=detector_error,
    )

    from .routes import admin, api, main
    app.register_blueprint(main.bp)
    app.register_blueprint(api.bp)
    app.register_blueprint(admin.bp)

    from .sockets import register_socket_handlers
    register_socket_handlers(socketio)
    return app


def start_ticker(app):
    """Luồng nền gọi controller.tick() mỗi giây (tự đăng xuất)."""
    ctrl = app.extensions["station"]

    def loop():
        while True:
            time.sleep(1)
            try:
                ctrl.tick()
            except Exception:
                log.exception("tick failed")

    socketio.start_background_task(loop)
