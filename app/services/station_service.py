"""Trạm: mã trạm theo tỉnh (vd DNG-001) + địa chỉ chi tiết + tọa độ bản đồ.

Địa chỉ theo mô hình chính quyền 2 cấp (từ 01/7/2025): số nhà / đường, phường / xã, tỉnh / thành phố
(34 tỉnh, thành). Mã trạm = <mã tỉnh>-<số thứ tự 3 chữ số>, cấp tự động khi tạo trạm và KHÔNG đổi về sau
(in trên thân trạm, dùng khi báo hỏng / đối soát).
"""
import re

from sqlalchemy import func

from app.models import Station, db

# Mã viết tắt nội bộ của hệ thống (không phải mã hành chính chính thức)
PROVINCES = [
    ("HNI", "Hà Nội"), ("HUE", "Huế"), ("HPG", "Hải Phòng"), ("DNG", "Đà Nẵng"), ("HCM", "TP. Hồ Chí Minh"),
    ("CTO", "Cần Thơ"),
    ("TQG", "Tuyên Quang"), ("LCI", "Lào Cai"), ("TNN", "Thái Nguyên"), ("PTO", "Phú Thọ"), ("BNH", "Bắc Ninh"),
    ("HYN", "Hưng Yên"), ("NBH", "Ninh Bình"), ("QTI", "Quảng Trị"), ("QNI", "Quảng Ngãi"), ("GLI", "Gia Lai"),
    ("KHA", "Khánh Hòa"), ("LDG", "Lâm Đồng"), ("DLK", "Đắk Lắk"), ("DNI", "Đồng Nai"), ("TNH", "Tây Ninh"),
    ("VLG", "Vĩnh Long"), ("DTP", "Đồng Tháp"), ("CMU", "Cà Mau"), ("AGG", "An Giang"),
    ("CBG", "Cao Bằng"), ("DBN", "Điện Biên"), ("HTH", "Hà Tĩnh"), ("LCU", "Lai Châu"), ("LSN", "Lạng Sơn"),
    ("NAN", "Nghệ An"), ("QNH", "Quảng Ninh"), ("THA", "Thanh Hóa"), ("SLA", "Sơn La"),
]
PROVINCE_NAME = dict(PROVINCES)
CODE_RE = re.compile(r"^([A-Z]{3})-(\d{3})$")


class StationError(ValueError):
    pass


def next_code(province: str) -> str:
    """Mã trạm kế tiếp của tỉnh: DNG-001, DNG-002, ..."""
    if province not in PROVINCE_NAME:
        raise StationError("Vui lòng chọn tỉnh / thành phố")
    codes = [c for (c,) in db.session.query(Station.code).filter(Station.code.like(f"{province}-%"))]
    used = [int(m.group(2)) for c in codes if c and (m := CODE_RE.match(c))]
    return f"{province}-{(max(used) + 1 if used else 1):03d}"


def full_address(st: Station) -> str:
    parts = [st.address, st.ward, PROVINCE_NAME.get(st.province or "", st.province)]
    return ", ".join(p for p in parts if p)


def _coord(v, lo, hi, label):
    if v in (None, ""):
        return None
    try:
        f = round(float(v), 6)
    except (TypeError, ValueError):
        raise StationError(f"{label} không hợp lệ")
    if not lo <= f <= hi:
        raise StationError(f"{label} phải trong khoảng {lo} – {hi}")
    return f


def apply_address(st: Station, data: dict) -> None:
    """Cập nhật địa chỉ / tọa độ từ dữ liệu form admin (chỉ các khóa có mặt)."""
    def text(key, n):
        return " ".join(str(data.get(key) or "").split())[:n] or None
    if "address" in data:
        st.address = text("address", 200)
    if "ward" in data:
        st.ward = text("ward", 100)
    if "province" in data:
        p = str(data.get("province") or "")
        if p not in PROVINCE_NAME:
            raise StationError("Vui lòng chọn tỉnh / thành phố")
        st.province = p
    if "lat" in data:
        st.lat = _coord(data.get("lat"), 8.0, 23.5, "Vĩ độ")
    if "lng" in data:
        st.lng = _coord(data.get("lng"), 102.0, 117.5, "Kinh độ")


def create_station(name: str, data: dict) -> Station:
    name = " ".join(str(name or "").split())
    if not name:
        raise StationError("Vui lòng nhập tên trạm")
    new_id = (db.session.query(func.max(Station.id)).scalar() or 0) + 1
    if new_id > 255:
        raise StationError("Đã đủ 255 trạm")
    st = Station(id=new_id, name=name[:100])
    apply_address(st, {"province": data.get("province"), **data})
    if not st.address or not st.ward:
        raise StationError("Vui lòng nhập đủ số nhà / đường và phường / xã")
    st.code = next_code(st.province)
    db.session.add(st)
    db.session.commit()
    return st


def station_info(st: Station) -> dict:
    """Thông tin nhận dạng + địa chỉ (dùng cho màn hình trạm, trang mô phỏng, admin)."""
    return {
        "id": st.id, "code": st.code, "name": st.name,
        "address": st.address, "ward": st.ward, "province": st.province,
        "province_name": PROVINCE_NAME.get(st.province or ""),
        "full_address": full_address(st),
        "lat": float(st.lat) if st.lat is not None else None,
        "lng": float(st.lng) if st.lng is not None else None,
    }
