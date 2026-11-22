"""So nền khay: lớp chặn thứ hai cho vật model không khoanh được (bản dùng trong trạm của models/scripts/so_nen.py).

Camera buồng quét cố định nhìn xuống mặt phẳng rung một màu. Học ảnh mặt phẳng TRỐNG, mỗi lần quét so ảnh hiện tại
với nền để tìm mọi vùng "có vật". Vùng nào không được khung model (bất kỳ lớp nào) phủ đủ -> vật lạ -> trả cả mẻ.
"""
import cv2
import numpy as np
from PIL import Image

from .base import GROUP_OTHER, Detection


def pil_to_bgr(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)


class BackgroundCheck:
    def __init__(self, nguong_mau=22, nguong_canh=30, dien_tich_min=0.004, phu_min=0.60, rong=640):
        self.nguong_mau = nguong_mau          # chênh lệch màu Lab tối thiểu để coi là "có vật"
        self.nguong_canh = nguong_canh        # chênh lệch độ mạnh cạnh (bắt chai nhựa trong suốt)
        self.dien_tich_min = dien_tich_min    # vùng nhỏ hơn 0,4% ảnh -> nhiễu
        self.phu_min = phu_min                # vùng được khung model phủ dưới 60% -> vật lạ
        self.rong = rong
        self.nen_lab = self.nen_canh = None

    @property
    def ready(self) -> bool:
        return self.nen_lab is not None

    def _chuan(self, bgr):
        h, w = bgr.shape[:2]
        s = self.rong / w
        img = cv2.resize(bgr, (self.rong, round(h * s)), interpolation=cv2.INTER_AREA)
        img = cv2.GaussianBlur(img, (5, 5), 0)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.int16)
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        canh = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
        return lab, canh

    def learn(self, images: list[Image.Image]) -> None:
        """Ảnh nền = trung vị của các ảnh mặt phẳng trống (1 ảnh cũng được với camera mô phỏng)."""
        labs, canhs = zip(*(self._chuan(pil_to_bgr(i)) for i in images))
        self.nen_lab = np.median(np.stack(labs), 0).astype(np.int16)
        self.nen_canh = np.median(np.stack(canhs), 0).astype(np.float32)

    def regions(self, image: Image.Image) -> tuple[list[dict], np.ndarray]:
        """Các vùng có vật: [{'box': (x1,y1,x2,y2) pixel ảnh gốc, 'area': tỉ lệ ảnh}], mask nhãn vùng (ảnh đã thu nhỏ)."""
        lab, canh = self._chuan(pil_to_bgr(image))
        d = np.abs(lab - self.nen_lab)
        d_mau = np.maximum(d[..., 0] * 0.5, np.maximum(d[..., 1], d[..., 2]))   # giảm trọng số độ sáng -> bớt bóng
        m = (d_mau > self.nguong_mau) | (np.abs(canh - self.nen_canh) > self.nguong_canh)
        m = m.astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        n, lb, st, _ = cv2.connectedComponentsWithStats(m)
        H, W = m.shape
        s = image.width / W
        out, mask = [], np.zeros((H, W), np.int32)
        for i in range(1, n):
            x, y, w, h, a = st[i]
            if a / (H * W) < self.dien_tich_min:
                continue
            mask[lb == i] = len(out) + 1
            out.append({"box": (round(x * s), round(y * s), round((x + w) * s), round((y + h) * s)), "area": a / (H * W)})
        return out, mask

    def unknown_objects(self, image: Image.Image, dets: list[Detection]) -> list[Detection]:
        """Vùng có vật mà khung model không phủ đủ -> Detection 'unknown' (nhóm other, không hợp lệ)."""
        if not self.ready:
            return []
        regs, mask = self.regions(image)
        H, W = mask.shape
        s = W / image.width
        phu = np.zeros((H, W), bool)
        for d in dets:
            x1, y1, x2, y2 = (round(v * s) for v in d.bbox)
            phu[max(0, y1):y2, max(0, x1):x2] = True
        out = []
        for i, r in enumerate(regs, 1):
            cover = float(phu[mask == i].mean())
            if cover < self.phu_min:
                out.append(Detection("unknown", GROUP_OTHER, 0.0, r["box"], source="background"))
        return out
