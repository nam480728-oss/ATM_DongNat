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
    MODEL_PATH = os.getenv("MODEL_PATH", "models/model/best.pt")   # tương đối tính từ thư mục dự án
    CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.5"))     # chỉ dùng cho detector giả lập (mock)
    # Ngưỡng model YOLO (MODEL_CARD.md, chọn trên val): chai/lon và rác (other)
    CONF_BOTTLE_CAN = float(os.getenv("CONF_BOTTLE_CAN", "0.85"))
    CONF_OTHER = float(os.getenv("CONF_OTHER", "0.80"))
    # Cỡ ảnh đưa vào model khi quét khay: 1280 vì cả khay 10–15 vật nằm trong 1 khung -> vật nhỏ, chạy 640 dễ sót
    YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "1280"))
    # So nền khay (bắt vật model không khoanh được) – chỉ chạy với detector nhìn ảnh thật (yolo)
    BG_CHECK = os.getenv("BG_CHECK", "1") == "1"
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
        "can_dented": "can",
        "aluminum_can": "can",
        "plastic": "bottle",  # model 3 nhãn: plastic / metal / other
        "metal": "can",
        "cup_straw": "bottle",  # ly nhựa có ống hút = nhựa
    }
    CROP_MARGIN = 0.10  # chừa lề 10% khi cắt ảnh vật không hợp lệ
    # Tên tiếng Việt hiển thị trên màn hình cho từng lớp
    LABEL_VI = {
        "plastic": "Nhựa",
        "metal": "Kim loại",
        "other": "Rác khác",
        "unknown": "Vật lạ",
        "bottle_500": "Chai nhựa 500ml",
        "bottle_1500": "Chai nhựa 1,5L",
        "bottle_flat": "Chai nhựa bẹp",
        "can_tall": "Lon nhôm cao",
        "can_short": "Lon nhôm lùn",
        "can_dented": "Lon nhôm móp",
        "snack_bag": "Vỏ bánh snack",
        "paper_cup": "Ly giấy cà phê",
        "milk_carton": "Hộp sữa giấy",
        "plastic_bag": "Túi nilon",
        "cup_straw": "Cốc nhựa có ống hút",
        "glass_bottle": "Chai thủy tinh",
        "foam_box": "Hộp xốp",
        "paper_ball": "Giấy vo",
    }

    # ---- Trạm ----
    STATION_ID = 1                 # trạm mặc định khi link không có ?station=
    # Ngân hàng hiện trong ô chọn khi người dùng chọn "Chuyển vào STK"
    BANKS = ["Vietcombank", "VietinBank", "BIDV", "Agribank", "Techcombank", "MB Bank", "ACB", "VPBank",
             "Sacombank", "TPBank", "VIB", "HDBank", "SHB", "OCB", "SeABank", "MoMo", "ZaloPay"]
    # Địa chỉ gắn vào mã QR voucher (điện thoại của người bán phải mở được). Trống = lấy theo địa chỉ trình duyệt
    # màn hình trạm đang dùng (vd http://192.168.1.10:5000)
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")
    # Thời gian tối đa chờ một cơ cấu chấp hành (hoạt ảnh 3D / phần cứng) phản hồi
    ACTUATOR_TIMEOUT_SEC = 30
    VIBRATE_SECONDS = 2.0          # rung khay cho rác tản ra (nhiều vật / chồng nhau)
    ALARM_SECONDS = 5              # loa cảnh báo kêu bao lâu khi có rác lạ (đèn đỏ sáng tới khi quét lại)
    SORT_MAX_ROUNDS = 4            # số vòng quét lại khay (vật bị che lộ ra sau khi lấy vật khác)
    LOGOUT_WARNING_SEC = 15  # hiện đếm ngược khi còn 15 giây
    # Miệng phễu trong ảnh camera khay (chuẩn hóa 0..1): giữa mép trái
    FUNNEL_IMG = (0.0, 0.5)
    # Băng chuyền (mét, tính theo trục X của trạm; PHẢI trùng app/static/js/station/dims.js -> BELT)
    BELT_SPEED = 0.30                              # m/s
    BELT_CAMERA_X = -0.30                          # camera băng chuyền
    BELT_PUSHERS = {"bottle": 0.0, "can": 0.32}    # thanh gạt chai trước, lon sau
    BELT_END_X = 0.62                              # tấm gạt chéo cuối băng -> thùng 'khác'
    TRAY_MAX_ITEMS = 15                            # tối đa vật mỗi mẻ trên khay
    # Phễu: camera băng chuyền canh vật mới rơi xuống; quá FUNNEL_WAIT_SEC chưa thấy = kẹt -> mở dần cổ phễu
    FUNNEL_WAIT_SEC = 10
    FUNNEL_OPEN_STEPS = 4                          # số nấc mở (mỗi nấc chờ FUNNEL_STEP_SEC)
    FUNNEL_STEP_SEC = 1.5
    FUNNEL_SHAKES = 2                              # mở hết cỡ vẫn kẹt -> rung phễu bấy nhiêu lần rồi báo kẹt
    FUNNEL_JAM_RECHECK_SEC = 10                    # đang báo kẹt: tự kiểm tra lại camera mỗi bấy nhiêu giây

    # Giá trị mặc định nếu bảng settings thiếu khóa
    DEFAULT_SETTINGS = {
        "price_bottle": "200",
        "price_can": "300",
        "idle_timeout_sec": "120",
        "max_vibrate_retries": "2",
        "payout_timeout_sec": "60",      # hết giờ không chọn -> giữ tiền vào số dư
        "voucher_days": "30",
        "public_capacity": "30",          # thùng mini gắn 2 bên hông trạm
        "security_reject_session": "3",   # camera giám sát: bỏ rác lạ bấy nhiêu lần / phiên -> báo admin
        "security_reject_day": "5",       # ... hoặc bấy nhiêu lần / 24 giờ cùng số điện thoại
        "security_cooldown_sec": "30",    # cùng loại sự cố ở 1 trạm chỉ báo lại sau bấy nhiêu giây
    }
    # Camera giám sát: cạy khay / cửa bấy nhiêu lần trong SECURITY_TAMPER_WINDOW giây -> sự cố
    SECURITY_TAMPER_COUNT = 3
    SECURITY_TAMPER_WINDOW = 15
    # Lỗ từ thiện: đường kính lỗ 11 cm (vật to hơn không lọt – kiểm tra ở cơ khí)
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
    FUNNEL_WAIT_SEC = 0
    FUNNEL_STEP_SEC = 0
    FUNNEL_JAM_RECHECK_SEC = 0
    BG_CHECK = False
