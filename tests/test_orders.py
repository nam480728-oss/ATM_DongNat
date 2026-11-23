"""Bán hàng ở quầy: danh mục, thanh toán voucher + tiền mặt, admin quản lý sản phẩm / xem đơn."""
from app.models import Merchant, Order, Product, Voucher, db
from app.services import order_service, voucher_service
from app.services.user_service import create_user

from .test_admin import login as admin_login


def setup_shop(ctx, voucher_amount=500):
    with ctx["app"].app_context():
        m = voucher_service.create_merchant("PEACEMART", "PEACE Mart", "2468", is_demo=True)
        for i, (n, p, c, ic) in enumerate(order_service.DEMO_PRODUCTS[:3]):
            db.session.add(Product(merchant_id=m.id, name=n, price=p, category=c, icon=ic, sort_order=i))
        uid = create_user("0905550011", "Hoa").id
        code = voucher_service.create_voucher(uid, 1, voucher_amount).code
        db.session.commit()
        ids = [p.id for p in Product.query.order_by(Product.sort_order)]
        return m.id, ids, code


def test_public_catalog_and_checkout_voucher_plus_cash(ctx):
    mid, ids, code = setup_shop(ctx)
    c = ctx["client"]
    cat = c.get("/api/store/peacemart/products").get_json()
    assert [p["name"] for p in cat["products"]] == ["Nước suối 500ml", "Trà chanh", "Nước dừa tươi"]
    assert c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0], "qty": 1}]}).status_code == 401
    c.post("/api/shop/demo-login")
    r = c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0], "qty": 2}, {"product_id": ids[1]}], "voucher": code})
    o = r.get_json()
    assert r.status_code == 200 and o["total"] == 20000 and o["voucher_amount"] == 500 and o["cash_amount"] == 19500
    assert o["voucher"] == code and [i["qty"] for i in o["items"]] == [2, 1]
    # voucher đã dùng -> thanh toán lại với voucher đó bị từ chối, không tạo đơn
    r2 = c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0]}], "voucher": code})
    assert r2.status_code == 400 and "đã được dùng" in r2.get_json()["error"]
    with ctx["app"].app_context():
        assert Order.query.count() == 1
        assert Voucher.query.filter_by(code=code).one().status == "used"
    assert c.get("/api/shop/orders").get_json()[0]["total"] == 20000


def test_voucher_bigger_than_bill_loses_remainder_and_cash_only(ctx):
    mid, ids, code = setup_shop(ctx, voucher_amount=8000)
    c = ctx["client"]
    c.post("/api/shop/demo-login")
    o = c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0]}], "voucher": code}).get_json()
    assert (o["voucher_amount"], o["voucher_lost"], o["cash_amount"]) == (5000, 3000, 0)
    o2 = c.post("/api/shop/checkout", json={"items": [{"product_id": ids[2], "qty": 1}]}).get_json()
    assert o2["cash_amount"] == 15000 and o2["voucher"] is None
    assert c.post("/api/shop/checkout", json={"items": []}).status_code == 400
    assert c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0], "qty": 99}]}).status_code == 400
    assert c.post("/api/shop/checkout", json={"items": [{"product_id": 9999}]}).status_code == 400


def test_admin_products_and_orders(ctx):
    mid, ids, _ = setup_shop(ctx)
    c = ctx["client"]
    admin_login(c)
    r = c.post(f"/api/admin/merchants/{mid}/products", json={"name": "Bắp nướng", "price": 10000, "category": "do_an", "icon": "🌽"})
    assert r.status_code == 201
    pid = r.get_json()["id"]
    assert c.post(f"/api/admin/merchants/{mid}/products", json={"name": "X", "price": 0}).status_code == 400
    assert c.patch(f"/api/admin/products/{pid}", json={"price": 12000, "is_active": False}).get_json()["price"] == 12000
    assert len(c.get(f"/api/admin/merchants/{mid}/products").get_json()) == 4
    assert all(p["name"] != "Bắp nướng" for p in c.get("/api/store/PEACEMART/products").get_json()["products"])
    c.post("/api/shop/demo-login")
    c.post("/api/shop/checkout", json={"items": [{"product_id": ids[0]}]})
    rows = c.get("/api/admin/orders").get_json()
    assert rows[0]["merchant"] == "PEACE Mart" and rows[0]["total"] == 5000
    with ctx["app"].app_context():
        assert Merchant.query.count() == 1
