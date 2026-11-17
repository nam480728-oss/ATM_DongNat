from app import create_app
from app.config import TestConfig
from app.models import Setting, Station, User, db
from app.station import controller as C

from .conftest import item


def login(c, pw="admin123"):
    return c.post("/admin/login", data={"password": pw})


def test_admin_requires_login(ctx):
    c = ctx["client"]
    assert c.get("/admin").status_code == 302
    assert c.get("/api/admin/stats").status_code == 401
    assert login(c, "sai").status_code == 200  # ở lại trang login
    assert c.get("/api/admin/stats").status_code == 401
    assert login(c).status_code == 302
    assert c.get("/admin").status_code == 200


def test_stats_transactions_and_empty_storage(ctx):
    c = ctx["client"]
    uid = c.post("/api/users", json={"name": "Lan", "account_number": "1234567"}).get_json()["id"]
    ctrl = ctx["ctrl"]
    ctrl.select_user(uid)
    ctx["hal"].scenes = [[item("bottle_500", 0), item("can_tall", 200)]]
    ctrl.press_pay()
    assert ctrl.continue_session() is False  # phải chọn chuyển khoản / từ thiện trước
    ctrl.payout("transfer")
    assert ctrl.continue_session()
    ctx["hal"].scenes = [[item("bottle_500", 0), item("foam_box", 200)]]
    ctrl.press_pay()

    login(c)
    s = c.get("/api/admin/stats").get_json()
    assert (s["bottles"], s["cans"], s["paid"], s["rejected_count"]) == (1, 1, 500, 1)
    assert s["station"]["storage_count"] == 2

    txs = c.get("/api/admin/transactions").get_json()
    assert [t["status"] for t in txs] == ["rejected", "accepted"]
    assert txs[0]["rejected"][0]["label_vi"] == "Hộp xốp"
    assert c.get(f"/api/admin/transactions?status=accepted&user_id={uid}").get_json()[0]["amount"] == 500
    assert c.get("/api/admin/transactions?date_from=xx").status_code == 400

    assert c.post("/api/admin/empty-storage").get_json()["ok"]
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        assert st.storage_count == 0 and not st.is_full and st.last_emptied_at


def test_update_prices_and_capacity(ctx):
    c = ctx["client"]
    login(c)
    assert c.post("/api/admin/settings", json={"price_bottle": 250, "price_can": 350, "storage_capacity": 50}).status_code == 200
    with ctx["app"].app_context():
        assert db.session.get(Setting, "price_bottle").value == "250"
        assert db.session.get(Station, 1).storage_capacity == 50
    assert c.get("/api/state").get_json()["prices"] == {"bottle": 250, "can": 350}
    assert c.post("/api/admin/settings", json={"price_bottle": -1}).status_code == 400
    assert c.post("/api/admin/settings", json={"storage_capacity": "abc"}).status_code == 400


def test_soft_delete_user(ctx):
    c = ctx["client"]
    uid = c.post("/api/users", json={"name": "Xoa", "account_number": "7654321"}).get_json()["id"]
    login(c)
    ctx["ctrl"].select_user(uid)
    assert c.delete(f"/api/admin/users/{uid}").status_code == 409  # đang dùng trạm
    ctx["ctrl"].logout()
    assert c.delete(f"/api/admin/users/{uid}").status_code == 200
    assert c.get("/api/users").get_json() == []
    with ctx["app"].app_context():
        assert db.session.get(User, uid).is_active is False


def test_dev_fill_storage_blocks_pay(ctx):
    c = ctx["client"]
    assert c.post("/api/dev/fill-storage").status_code == 200
    uid = c.post("/api/users", json={"name": "Full", "account_number": "1112223"}).get_json()["id"]
    assert ctx["ctrl"].select_user(uid) is False
    assert ctx["ctrl"].state == C.IDLE


def test_yolo_without_model_reports_error(tmp_path):
    class Cfg(TestConfig):
        DETECTOR = "yolo"
        MODEL_PATH = str(tmp_path / "khong_co.pt")
        DATA_DIR = tmp_path
        SCAN_DIR = tmp_path / "scans"
        CROP_DIR = tmp_path / "crops"

    app = create_app(Cfg, hal=__import__("tests.conftest", fromlist=["FakeHardware"]).FakeHardware(), spawn=lambda f: f())
    ctrl = app.extensions["station"]
    assert ctrl.detector is None and "Không tìm thấy file model" in ctrl.detector_error
    with app.app_context():
        db.create_all()
        db.session.add(Station(id=1))
        db.session.commit()
        r = app.test_client().post("/api/scan", json={"image": "x"})
        assert r.status_code == 503
        db.drop_all()
