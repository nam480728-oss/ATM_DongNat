"""Cấu hình ứng dụng. Giá trị nhạy cảm/đổi theo máy lấy từ file .env."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "mysql+pymysql://root:@localhost:3306/atm_db?charset=utf8mb4"
    )
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 280}
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

    # Thư mục lưu ảnh quét / ảnh cắt
    DATA_DIR = BASE_DIR / "data"
    SCAN_DIR = DATA_DIR / "scans"
    CROP_DIR = DATA_DIR / "crops"

    # ---- Nhận diện ----
    DETECTOR = os.getenv("DETECTOR", "mock")  # mock | yolo
    MODEL_PATH = os.getenv("MODEL_PATH", "models/best.pt")
    CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.5"))
    # Ánh xạ tên lớp (model trả về) -> nhóm 'bottle' | 'can'. Lớp không có ở đây = 'other'.
    # Khi cắm model thật, sửa danh sách này theo tên lớp của model.
    CLASS_MAP = {
        "bottle": "bottle",
        "bottle_500": "bottle",
        "bottle_1500": "bottle",
        "bottle_flat": "bottle",
        "plastic_bottle": "bottle",
        "can": "can",
        "can_tall": "can",
        "can_short": "can",
        "aluminum_can": "can",
    }
    CROP_MARGIN = 0.10  # chừa lề 10% khi cắt ảnh vật không hợp lệ
    # Tên tiếng Việt hiển thị trên màn hình cho từng lớp
    LABEL_VI = {
        "bottle_500": "Chai nhựa 500ml",
        "bottle_1500": "Chai nhựa 1,5L",
        "bottle_flat": "Chai nhựa dẹt",
        "can_tall": "Lon nhôm cao",
        "can_short": "Lon nhôm lùn",
        "milk_carton": "Hộp sữa giấy",
        "plastic_bag": "Túi nilon",
        "cup_straw": "Cốc nhựa có ống hút",
        "glass_bottle": "Chai thủy tinh",
        "foam_box": "Hộp xốp",
        "paper_ball": "Giấy vo",
    }

    # ---- Trạm ----
    STATION_ID = 1
    # Thời gian tối đa chờ một cơ cấu chấp hành (hoạt ảnh 3D / phần cứng) phản hồi
    ACTUATOR_TIMEOUT_SEC = 30
    VIBRATE_SECONDS = 3
    LOGOUT_WARNING_SEC = 15  # hiện đếm ngược khi còn 15 giây

    # Giá trị mặc định nếu bảng settings thiếu khóa
    DEFAULT_SETTINGS = {
        "price_bottle": "200",
        "price_can": "300",
        "idle_timeout_sec": "120",
        "max_vibrate_retries": "2",
        "payout_timeout_sec": "30",
    }
    # Lỗ bỏ từng chai/lon: đường kính lỗ 11 cm (vật to hơn không lọt – kiểm tra ở cơ khí)
    SLOT_DIAMETER_MM = 110

    # Bật các công cụ thử nghiệm của bản mô phỏng (panel Dev). Máy thật: SIM_DEV_TOOLS=0
    SIM_DEV_TOOLS = os.getenv("SIM_DEV_TOOLS", "1") == "1"

    TESTING = False
    CHECK_TABLES_ON_START = True


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    CHECK_TABLES_ON_START = False
    ACTUATOR_TIMEOUT_SEC = 2
    VIBRATE_SECONDS = 0
