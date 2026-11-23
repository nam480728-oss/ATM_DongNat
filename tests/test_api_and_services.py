import base64
import io

from PIL import Image

from app.detection.cropper import crop_detection
from app.services.pricing import calc_amount, format_vnd


def test_pricing():
    assert calc_amount(3, 2, 200, 300) == 1200
    assert format_vnd(1200) == "1.200đ"
    assert format_vnd(0) == "0đ"


def test_phone_normalize_and_mask():
    from app.services import user_service as us
    assert us.normalize_phone("+84 912.345.678") == "0912345678"
    assert us.valid_phone("0912345678") and not us.valid_phone("0112345678") and not us.valid_phone("091234567")
    assert us.mask_name("  Nguyễn   Văn An ") == "Nguyễn V** A*"
    assert us.mask_name("Lan") == "L**"
    assert us.mask_phone("0912345678") == "091****678"


def test_old_user_api_removed(ctx):
    assert ctx["client"].get("/api/users").status_code == 404     # không còn danh sách tên công khai


def test_scan_endpoint_with_hints(ctx):
    buf = io.BytesIO()
    Image.new("RGB", (320, 240)).save(buf, "PNG")
    url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = ctx["client"].post("/api/scan", json={"image": url, "hints": [
        {"label": "can_tall", "bbox": [10, 10, 50, 90]},
        {"label": "foam_box", "bbox": [100, 10, 200, 90]},
        {"label": "x", "bbox": [500, 500, 600, 600]},  # ngoài khung -> bỏ
    ]})
    dets = r.get_json()["detections"]
    assert [d["group"] for d in dets] == ["can", "other"]


def test_state_endpoint(ctx):
    s = ctx["client"].get("/api/state").get_json()
    assert s["state"] == "IDLE" and s["prices"] == {"bottle": 200, "can": 300}
    assert s["station"]["storage_capacity"] == 300


def test_crop_margin_and_clamp():
    img = Image.new("RGB", (100, 100))
    assert crop_detection(img, (10, 10, 60, 60), 0.1).size == (60, 60)
    assert crop_detection(img, (0, 0, 100, 100), 0.1).size == (100, 100)
