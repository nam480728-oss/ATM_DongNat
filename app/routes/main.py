from flask import Blueprint, abort, current_app, render_template, request, send_from_directory

from app.models import Merchant, Station, db
from app.services import station_service

bp = Blueprint("main", __name__)


def _station():
    """Trạm theo ?station=<id> (mặc định STATION_ID). Trạm không tồn tại / đã tắt -> 404."""
    try:
        sid = int(request.args.get("station") or current_app.config["STATION_ID"])
    except ValueError:
        abort(404)
    st = db.session.get(Station, sid)
    if st is None or not st.is_active:
        abort(404, description=f"Không có trạm số {sid}")
    return st


@bp.get("/")
def index():
    """Mô phỏng 3D: 3 trạm đầu tiên đang hoạt động đứng thẳng hàng trên vỉa hè ven biển + cửa hàng demo đối diện.
    ?station=<id> chọn trạm đang dùng (trạm ngoài 3 trạm đầu thì thay vào vị trí giữa)."""
    st = _station()
    active = Station.query.filter_by(is_active=True).order_by(Station.id).all()
    street = active[:3]
    if st not in street:
        street[min(1, len(street) - 1)] = st
    demo = Merchant.query.filter_by(is_demo=True, is_active=True).first()
    return render_template("index.html", station=st, stations=active,
                           street=[station_service.station_info(s) for s in street],
                           demo_shop={"code": demo.code, "name": demo.name} if demo else None)


@bp.get("/screen")
def screen():
    return render_template("screen.html", station=_station())


@bp.get("/media/<path:filename>")
def media(filename):
    """Ảnh quét (scans/...) và ảnh cắt (crops/...). Ảnh camera giám sát (security/...) chỉ xem qua API admin."""
    if not filename.startswith(("scans/", "crops/")):
        abort(404)
    return send_from_directory(current_app.config["DATA_DIR"], filename)
