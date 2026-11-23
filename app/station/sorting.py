"""Thuật toán của khu phân loại bên trong trạm (hàm thuần, không đụng phần cứng – dễ test).

* Thứ tự tay gắp lùa vật vào phễu: vật GẦN TÂM khay lấy trước, sau đó lần lượt vật GẦN MIỆNG PHỄU nhất
  (lan dần ra 2 bên).
* Hẹn giờ thanh gạt: camera băng chuyền thấy vật ở vị trí camera -> sau (x_thanh_gạt - x_camera) / tốc độ băng
  giây thì vật tới thẳng thanh gạt -> bật thanh gạt đẩy vật vào thùng đúng loại.
"""
from __future__ import annotations

from math import hypot


def _center(bbox) -> tuple[float, float]:
    x1, y1, x2, y2 = bbox
    return (x1 + x2) / 2, (y1 + y2) / 2


def pick_order(dets: list, image_size: tuple[int, int], funnel: tuple[float, float] = (0.0, 0.5)) -> list:
    """Sắp xếp các vật trên khay theo thứ tự lùa vào phễu.

    dets: danh sách có thuộc tính .bbox (pixel ảnh camera khay); image_size = (w, h);
    funnel = vị trí miệng phễu trong ảnh, chuẩn hóa 0..1 (mặc định: giữa mép trái).
    """
    if not dets:
        return []
    w, h = image_size
    cx, cy = w / 2, h / 2
    fx, fy = funnel[0] * w, funnel[1] * h

    def d_center(d):
        x, y = _center(d.bbox)
        return hypot(x - cx, y - cy)

    def d_funnel(d):
        x, y = _center(d.bbox)
        return hypot(x - fx, y - fy)

    first = min(dets, key=d_center)
    rest = sorted((d for d in dets if d is not first), key=d_funnel)
    return [first, *rest]


def belt_delay(kind: str, camera_x: float, pushers: dict[str, float], speed: float, end_x: float) -> float:
    """Số giây từ lúc vật nằm dưới camera băng chuyền tới lúc tới thanh gạt của loại đó.

    kind không có thanh gạt (vd 'other') -> thời gian chạy tới cuối băng (rơi vào thùng 'khác')."""
    target = pushers.get(kind, end_x)
    if speed <= 0:
        raise ValueError("Tốc độ băng chuyền phải > 0")
    return max(0.0, (target - camera_x) / speed)
