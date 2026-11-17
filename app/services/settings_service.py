"""Đọc/ghi bảng settings (giá, timeout...)."""
from flask import current_app

from app.models import Setting, Station, db


def get_setting(key: str) -> str:
    row = db.session.get(Setting, key)
    if row is not None:
        return row.value
    return current_app.config["DEFAULT_SETTINGS"][key]


def get_int(key: str) -> int:
    return int(get_setting(key))


def set_setting(key: str, value, description: str | None = None) -> None:
    row = db.session.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=str(value), description=description)
        db.session.add(row)
    else:
        row.value = str(value)
    db.session.commit()


def get_prices() -> tuple[int, int]:
    """Trả về (giá chai, giá lon)."""
    return get_int("price_bottle"), get_int("price_can")


def get_station() -> Station:
    sid = current_app.config["STATION_ID"]
    station = db.session.get(Station, sid)
    if station is None:  # phòng khi bảng station trống
        station = Station(id=sid)
        db.session.add(station)
        db.session.commit()
    return station
