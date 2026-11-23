"""Camera giám sát (an ninh), mã trạm + địa chỉ, cửa hàng demo + ví voucher của mô phỏng."""
from app.models import Merchant, SecurityEvent, Station, db
from app.services import station_service, voucher_service
from app.services.user_service import create_user

from .test_admin import login as admin_login
from .test_controller import put


def login(ctx, phone="0905550001", name="Lan"):
    with ctx["app"].app_context():
        uid = create_user(phone, name).id
    assert ctx["ctrl"].select_user(uid)
    return uid


def events(ctx, name):
    return [d for e, d in ctx["events"] if e == name]


def rows(ctx):
    with ctx["app"].app_context():
        return [(e.kind, e.user_id, e.image_path) for e in SecurityEvent.query.order_by(SecurityEvent.id)]


# ------------------------------------------------------------------ camera giám sát
def test_repeated_rejects_report_with_photo(ctx):
    uid = login(ctx)
    for _ in range(2):
        put(ctx, "foam_box")
    assert rows(ctx) == []                     # 2 lần: chưa báo
    put(ctx, "foam_box")                       # lần 3 trong phiên -> báo
    assert rows(ctx) == [("reject_repeat", uid, "security/se1.jpg")]
    assert (ctx["app"].config["DATA_DIR"] / "security" / "se1.jpg").exists()
    assert ("capture", "security") in ctx["hal"].calls
    assert events(ctx, "security")[0]["kind"] == "reject_repeat"
    assert any(d["code"] == "security" and d["level"] == "error" for d in events(ctx, "screen:message"))
    put(ctx, "foam_box")                       # lần 4 ngay sau: trong thời gian chờ, không báo dồn
    assert len(rows(ctx)) == 1


def test_impact_tamper_and_camera_blocked(ctx):
    ctrl = ctx["ctrl"]
    assert not ctrl.on_security("impact", 0.8)          # rung nhẹ (gió, người dựa vào) -> bỏ qua
    assert ctrl.on_security("impact", 3.4)
    assert not ctrl.on_security("tamper", 1) and not ctrl.on_security("tamper", 1)
    assert ctrl.on_security("tamper", 1)                # 3 lần cạy trong 15 giây
    assert ctrl.on_security("camera_blocked", 6)
    assert ctrl.snapshot()["camera_blocked"]
    assert not ctrl.on_security("camera_blocked", 9)    # vẫn đang che: không báo thêm
    ctrl.on_security("camera_blocked", 0)
    assert not ctrl.snapshot()["camera_blocked"]
    assert [k for k, _, _ in rows(ctx)] == ["impact", "tamper", "camera_blocked"]
    try:
        ctrl.on_security("bogus", 1)
        raise AssertionError
    except KeyError:
        pass


def test_admin_security_list_image_and_resolve(ctx):
    ctx["ctrl"].on_security("impact", 5)
    c = ctx["client"]
    assert c.get("/api/admin/security").status_code == 401
    assert c.get("/media/security/se1.jpg").status_code == 404      # ảnh có người: không công khai
    admin_login(c)
    d = c.get("/api/admin/security").get_json()
    assert d["new"] == 1 and d["items"][0]["kind"] == "impact" and d["items"][0]["station_code"] is None
    url = d["items"][0]["image_url"]
    assert c.get(url).status_code == 200
    assert c.get("/api/admin/overview").get_json()["security_new"] == 1
    r = c.patch("/api/admin/security/1", json={"status": "resolved", "note": "Đã nhắc nhở"})
    assert r.get_json()["status"] == "resolved" and r.get_json()["resolved_at"]
    assert c.get("/api/admin/security?status=new").get_json()["items"] == []
    assert c.patch("/api/admin/security/1", json={"status": "x"}).status_code == 400


# ------------------------------------------------------------------ mã trạm + địa chỉ
def test_station_code_by_province_and_address(ctx):
    c = ctx["client"]
    admin_login(c)
    bad = c.post("/api/admin/stations", json={"name": "Trạm Mỹ Khê", "address": "Võ Nguyên Giáp"})
    assert bad.status_code == 400                       # thiếu tỉnh / phường
    body = {"name": "Trạm Mỹ Khê", "address": "1 Võ Nguyên Giáp", "ward": "Phường An Hải", "province": "DNG",
            "lat": 16.06, "lng": 108.2476}
    a = c.post("/api/admin/stations", json=body).get_json()
    b = c.post("/api/admin/stations", json=body | {"name": "Trạm 3"}).get_json()
    h = c.post("/api/admin/stations", json=body | {"province": "HCM", "ward": "Phường Bến Thành"}).get_json()
    assert (a["code"], b["code"], h["code"]) == ("DNG-001", "DNG-002", "HCM-001")
    assert a["full_address"] == "1 Võ Nguyên Giáp, Phường An Hải, Đà Nẵng" and a["lat"] == 16.06
    r = c.patch(f"/api/admin/stations/{a['id']}", json={"ward": "Phường Sơn Trà", "lat": 99})
    assert r.status_code == 400                         # tọa độ ngoài Việt Nam
    r = c.patch(f"/api/admin/stations/{a['id']}", json={"ward": "Phường Sơn Trà", "code": "XXX-999"}).get_json()
    assert r["ward"] == "Phường Sơn Trà" and r["code"] == "DNG-001"   # mã trạm không đổi
    assert len(c.get("/api/admin/provinces").get_json()) == 34
    with ctx["app"].app_context():
        st = db.session.get(Station, a["id"])
        assert station_service.next_code("DNG") == "DNG-003"
    assert st is not None


# ------------------------------------------------------------------ cửa hàng demo + ví voucher
def test_demo_shop_login_and_wallet_status(ctx):
    c = ctx["client"]
    assert c.post("/api/shop/demo-login").status_code == 404          # chưa có cửa hàng demo
    with ctx["app"].app_context():
        voucher_service.create_merchant("PEACEMART", "PEACE Mart", "2468", is_demo=True)
        uid = create_user("0905550009", "Hoa").id
        code = voucher_service.create_voucher(uid, 1, 1500).code
        db.session.commit()
    assert c.post("/api/shop/demo-login").get_json()["merchant"]["is_demo"]
    st = c.post("/api/wallet/status", json={"codes": [code, "DN-0000-0000"]}).get_json()
    assert st[0]["status"] == "active" and st[0]["amount"] == 1500 and "user_id" not in st[0]
    assert st[1]["status"] == "missing"
    assert c.post("/api/shop/redeem", json={"code": code}).status_code == 200
    assert c.post("/api/wallet/status", json={"codes": [code]}).get_json()[0]["status"] == "used"
    # admin tắt chế độ demo -> quầy thu ngân không vào thẳng được nữa
    admin_login(c)
    with ctx["app"].app_context():
        mid = Merchant.query.filter_by(code="PEACEMART").one().id
    assert c.patch(f"/api/admin/merchants/{mid}", json={"is_demo": False}).get_json()["is_demo"] is False
    assert c.post("/api/shop/demo-login").status_code == 404


def test_index_shows_three_street_stations(ctx):
    with ctx["app"].app_context():
        db.session.add_all([Station(id=2, name="Trạm 2", code="DNG-002"), Station(id=3, name="Trạm 3", code="DNG-003"),
                            Station(id=4, name="Trạm 4", code="DNG-004")])
        db.session.commit()
    c = ctx["client"]
    html = c.get("/?station=4").get_data(as_text=True)
    assert "window.STREET" in html and "DNG-004" in html and "DNG-002" not in html.split("window.STREET")[1].split(";")[0]
