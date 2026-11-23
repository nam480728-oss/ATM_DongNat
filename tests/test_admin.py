"""Trang admin trung tâm: trạm, người dùng (SĐT), giao dịch, cấu hình, công cụ dev."""
from app import create_app
from app.config import TestConfig
from app.models import Payout, Setting, Station, Transaction, User, db
from app.services.user_service import create_user
from app.station import controller as C

from .test_controller import put


def login(c, pw="admin123"):
    return c.post("/admin/login", data={"password": pw})


def new_user(ctx, phone="0911000111", name="Lan"):
    with ctx["app"].app_context():
        return create_user(phone, name).id


def test_admin_requires_login(ctx):
    c = ctx["client"]
    assert c.get("/admin").status_code == 302
    assert c.get("/api/admin/overview").status_code == 401
    assert login(c, "sai").status_code == 200  # ở lại trang login
    assert c.get("/api/admin/users").status_code == 401
    assert login(c).status_code == 302
    assert c.get("/admin").status_code == 200


def test_overview_transactions_and_empty_storage(ctx):
    c = ctx["client"]
    uid = new_user(ctx)
    ctrl = ctx["ctrl"]
    ctrl.select_user(uid)
    put(ctx, "bottle_500", "can_tall")
    assert ctrl.continue_session() is False  # phải chọn cách nhận trước
    ctrl.payout("transfer", bank="ACB", account="99887766")
    assert ctrl.continue_session()
    put(ctx, "bottle_500", "foam_box")

    login(c)
    s = c.get("/api/admin/overview").get_json()
    assert (s["bottles"], s["cans"], s["transfer"], s["rejected_count"]) == (1, 1, 500, 1)
    assert c.get("/api/admin/overview?station=2").get_json()["bottles"] == 0
    st = c.get("/api/admin/stations").get_json()[0]
    assert st["storage_count"] == 2 and st["bins"] == {"bottle": 1, "can": 1, "other": 0}
    assert st["online"] and st["user"] == "Lan (0911000111)"

    txs = c.get("/api/admin/transactions").get_json()
    assert [t["status"] for t in txs] == ["rejected", "accepted"] and txs[0]["station_id"] == 1
    assert txs[0]["rejected"][0]["label_vi"] == "Hộp xốp"
    assert c.get(f"/api/admin/transactions?status=accepted&user_id={uid}").get_json()[0]["amount"] == 500
    assert c.get("/api/admin/transactions?date_from=xx").status_code == 400
    po = c.get("/api/admin/payouts").get_json()[0]
    assert (po["method"], po["bank"], po["account"], po["phone"]) == ("transfer", "ACB", "****7766", "0911000111")

    assert c.post("/api/admin/stations/1/empty-storage").get_json()["ok"]
    with ctx["app"].app_context():
        st = db.session.get(Station, 1)
        assert st.storage_count == 0 and not st.is_full and st.last_emptied_at and st.bin_bottle == 0


def test_stations_create_update(ctx):
    c = ctx["client"]
    login(c)
    r = c.post("/api/admin/stations", json={"name": "Trạm Chợ Lớn", "address": "1 Hùng Vương", "ward": "Phường Chợ Lớn",
                                             "province": "HCM", "storage_capacity": 500})
    assert r.status_code == 201 and r.get_json()["id"] == 2 and not r.get_json()["online"]
    assert c.patch("/api/admin/stations/1", json={"storage_capacity": 50, "name": "Trạm 1"}).status_code == 200
    with ctx["app"].app_context():
        assert db.session.get(Station, 1).storage_capacity == 50
    assert c.patch("/api/admin/stations/1", json={"storage_capacity": "abc"}).status_code == 400
    assert c.get("/screen?station=2").status_code == 200
    assert c.patch("/api/admin/stations/2", json={"is_active": False}).status_code == 200
    assert c.get("/screen?station=2").status_code == 404
    assert c.get("/screen?station=99").status_code == 404


def test_update_settings(ctx):
    c = ctx["client"]
    login(c)
    assert c.post("/api/admin/settings", json={"price_bottle": 250, "price_can": 350, "voucher_days": 7}).status_code == 200
    with ctx["app"].app_context():
        assert db.session.get(Setting, "price_bottle").value == "250"
    assert c.get("/api/state").get_json()["prices"] == {"bottle": 250, "can": 350}
    assert c.post("/api/admin/settings", json={"price_bottle": -1}).status_code == 400
    assert c.post("/api/admin/settings", json={"voucher_days": "abc"}).status_code == 400


def test_users_search_edit_lock_delete(ctx):
    c = ctx["client"]
    login(c)
    r = c.post("/api/admin/users", json={"phone": "0912 345 678", "name": "Nguyễn Văn An"})
    assert r.status_code == 201
    uid = r.get_json()["id"]
    assert c.post("/api/admin/users", json={"phone": "0912345678", "name": "B"}).status_code == 400
    assert c.post("/api/admin/users", json={"phone": "12345", "name": "B"}).status_code == 400
    new_user(ctx, "0987000222", "Lê Thị Hoa")
    assert [u["name"] for u in c.get("/api/admin/users?q=345").get_json()] == ["Nguyễn Văn An"]
    assert [u["name"] for u in c.get("/api/admin/users?q=hoa").get_json()] == ["Lê Thị Hoa"]
    assert c.patch(f"/api/admin/users/{uid}", json={"phone": "0987000222"}).status_code == 400   # trùng
    assert c.patch(f"/api/admin/users/{uid}", json={"name": "Nguyễn Văn Bình"}).get_json()["name"] == "Nguyễn Văn Bình"

    ctx["ctrl"].select_user(uid)
    assert c.delete(f"/api/admin/users/{uid}").status_code == 409            # đang dùng trạm
    assert c.patch(f"/api/admin/users/{uid}", json={"is_active": False}).status_code == 409
    put(ctx, "bottle_500")
    ctx["ctrl"].logout()                                                     # tiền giữ vào số dư
    detail = c.get(f"/api/admin/users/{uid}").get_json()
    assert detail["balance"] == 200 and detail["by_station"][0]["bottles"] == 1
    assert c.delete(f"/api/admin/users/{uid}").status_code == 409            # còn số dư
    with ctx["app"].app_context():
        db.session.get(User, uid).balance = 0
        db.session.commit()
    assert c.delete(f"/api/admin/users/{uid}").status_code == 200
    with ctx["app"].app_context():
        assert db.session.get(User, uid) is None
        assert Transaction.query.one().user_id is None                      # giao dịch giữ lại, ẩn danh
        assert Payout.query.count() == 0


def test_dev_fill_storage_blocks_login(ctx):
    c = ctx["client"]
    assert c.post("/api/dev/fill-storage", json={"station": 1}).status_code == 200
    uid = new_user(ctx, "0933111222", "Full")
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
