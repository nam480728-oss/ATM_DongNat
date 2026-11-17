import base64
import io

from PIL import Image

from app.detection.cropper import crop_detection
from app.services.pricing import calc_amount, format_vnd


def test_pricing():
    assert calc_amount(3, 2, 200, 300) == 1200
    assert format_vnd(1200) == "1.200đ"
    assert format_vnd(0) == "0đ"


def test_create_and_list_users_duplicate_names(ctx):
    c = ctx["client"]
    assert c.post("/api/users", json={"name": "  Nguyễn  Nam ", "account_number": "0011223344"}).status_code == 201
    assert c.post("/api/users", json={"name": "Đặng Lan", "account_number": "998877665"}).status_code == 201
    names = {u["display_name"] for u in c.get("/api/users").get_json()}
    assert names == {"Nguyễn Nam", "Đặng Lan"}

    assert c.post("/api/users", json={"name": "nguyễn nam", "account_number": "5555661234"}).status_code == 201
    names = {u["display_name"] for u in c.get("/api/users").get_json()}
    assert names == {"Nguyễn Nam (*3344)", "nguyễn nam (*1234)", "Đặng Lan"}
    # Tìm theo tên không dấu hoa thường
    assert len(c.get("/api/users?q=NAM").get_json()) == 2


def test_create_user_validation(ctx):
    c = ctx["client"]
    assert c.post("/api/users", json={"name": "", "account_number": "123456"}).status_code == 400
    r = c.post("/api/users", json={"name": "A", "account_number": "12ab56"})
    assert r.status_code == 400 and "6–19" in r.get_json()["error"]
    c.post("/api/users", json={"name": "A", "account_number": "123456"})
    r = c.post("/api/users", json={"name": "B", "account_number": "123456"})
    assert r.status_code == 400 and "đã được đăng ký" in r.get_json()["error"]


def test_users_api_masks_account(ctx):
    c = ctx["client"]
    c.post("/api/users", json={"name": "A", "account_number": "0123456789"})
    u = c.get("/api/users").get_json()[0]
    assert "account_number" not in u and u["masked_account"] == "******6789"


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
