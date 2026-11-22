"""So nền khay (plan_model.md mục 1.5; bước 5 mục 12.7 plan_train.md, anh/chị chốt 19/11).

Chế độ khay: camera cố định nhìn xuống khay một màu. So ảnh hiện tại với ảnh KHAY TRỐNG để tìm mọi vùng
"có vật", kể cả vật model chưa từng thấy. Đây là lớp chặn thứ hai cho trường hợp rác lẫn trong mẻ 10–15 vật mà
model không khoanh được (khi đó controller sẽ tưởng cả mẻ là chai/lon).

Luật (mỗi lần quét):
  - có khung other (conf ≥ t_other)                                  -> TRẢ (có rác)
  - có vùng vật không được khung nhựa/kim loại (conf ≥ t_pm) phủ ≥ 70%  -> TRẢ (vật lạ model không thấy)
  - không có vùng nào                                                 -> KHAY_TRONG (cập nhật nền)
  - còn lại                                                           -> NHẬN
Chỉ dùng OpenCV (trừ ảnh, tìm vùng) — không phải model có sẵn.

Dùng:
  sn = SoNen(); sn.hoc_nen(cac_khung_khay_trong)        # ~30 khung lúc khởi động
  kq = sn.quyet_dinh(khung, dets, t_pm=0.80, t_other=0.80)   # dets: [(nhãn, conf, [x0,y0,x1,y1] chuẩn hóa 0–1)]
Tự kiểm tra:  python models/scripts/so_nen.py
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

PM = ("plastic", "metal")


@dataclass
class KetQua:
    quyet_dinh: str                  # NHAN | TRA | KHAY_TRONG
    ly_do: list = field(default_factory=list)
    vung: list = field(default_factory=list)   # [{"box": [x0,y0,x1,y1] chuẩn hóa, "phu": tỉ lệ được phủ, "dien_tich": tỉ lệ ảnh}]
    mask: np.ndarray = None


class SoNen:
    def __init__(self, nguong_mau=22, nguong_canh=30, dien_tich_min=0.002, phu_min=0.70, rong=640):
        self.nguong_mau = nguong_mau          # chênh lệch màu Lab tối thiểu để coi là "có vật"
        self.nguong_canh = nguong_canh        # chênh lệch độ mạnh cạnh (bắt chai nhựa trong suốt)
        self.dien_tich_min = dien_tich_min    # vùng nhỏ hơn 0,2% ảnh -> nhiễu
        self.phu_min = phu_min
        self.rong = rong                      # xử lý ở độ rộng 640 px cho nhanh
        self.nen_lab = self.nen_canh = None

    # ---------- tiền xử lý ----------
    def _chuan(self, img):
        h, w = img.shape[:2]
        s = self.rong / w
        img = cv2.resize(img, (self.rong, round(h * s)), interpolation=cv2.INTER_AREA)
        img = cv2.GaussianBlur(img, (5, 5), 0)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.int16)
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        canh = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
        return lab, canh

    def hoc_nen(self, khung_list):
        """Ảnh nền = trung vị của nhiều khung khay trống (khử nhiễu, bóng tay thoáng qua)."""
        labs, canhs = zip(*(self._chuan(k) for k in khung_list))
        self.nen_lab = np.median(np.stack(labs), 0).astype(np.int16)
        self.nen_canh = np.median(np.stack(canhs), 0).astype(np.float32)

    def cap_nhat_nen(self, khung, alpha=0.05):
        """Khay trống: trộn dần khung mới vào nền (bù ánh sáng thay đổi chậm)."""
        lab, canh = self._chuan(khung)
        self.nen_lab = ((1 - alpha) * self.nen_lab + alpha * lab).astype(np.int16)
        self.nen_canh = ((1 - alpha) * self.nen_canh + alpha * canh).astype(np.float32)

    # ---------- tìm vùng có vật ----------
    def tim_vung(self, khung):
        assert self.nen_lab is not None, "chưa học nền (hoc_nen)"
        lab, canh = self._chuan(khung)
        d = np.abs(lab - self.nen_lab)
        d_mau = np.maximum(d[..., 0] * 0.5, np.maximum(d[..., 1], d[..., 2]))   # giảm trọng số độ sáng -> bớt bóng
        m = (d_mau > self.nguong_mau) | (np.abs(canh - self.nen_canh) > self.nguong_canh)
        m = m.astype(np.uint8) * 255
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        n, lb, st, _ = cv2.connectedComponentsWithStats(m)
        H, W = m.shape
        vung, mask = [], np.zeros_like(m)
        for i in range(1, n):
            x, y, w, h, a = st[i]
            if a / (H * W) < self.dien_tich_min:
                continue
            mask[lb == i] = len(vung) + 1
            vung.append({"box": [x / W, y / H, (x + w) / W, (y + h) / H], "dien_tich": a / (H * W)})
        return vung, mask

    # ---------- quyết định ----------
    def quyet_dinh(self, khung, dets, t_pm=0.80, t_other=0.80):
        vung, mask = self.tim_vung(khung)
        H, W = mask.shape
        kq = KetQua("NHAN", vung=vung, mask=mask)
        if any(n == "other" and c >= t_other for n, c, _ in dets):
            kq.quyet_dinh = "TRA"
            kq.ly_do.append("có vật other")
        phu = np.zeros((H, W), bool)
        for n, c, b in dets:
            if n in PM and c >= t_pm:
                x0, y0, x1, y1 = (round(b[0] * W), round(b[1] * H), round(b[2] * W), round(b[3] * H))
                phu[y0:y1, x0:x1] = True
        for i, v in enumerate(vung, 1):
            px = mask == i
            v["phu"] = float(phu[px].mean())
            if v["phu"] < self.phu_min:
                kq.quyet_dinh = "TRA"
                kq.ly_do.append(f"vùng {i} chỉ được khung nhựa/kim loại phủ {v['phu']:.0%} (vật lạ?)")
        if not vung and kq.quyet_dinh == "NHAN":
            kq.quyet_dinh = "KHAY_TRONG"
            if not any(c >= t_pm for n, c, _ in dets if n in PM):
                self.cap_nhat_nen(khung)
        return kq


# ---------------- tự kiểm tra bằng ảnh giả lập ----------------
def _tu_kiem_tra():
    rng = np.random.default_rng(0)
    H, W = 480, 640

    def khay():
        img = np.full((H, W, 3), 60, np.uint8)                       # khay xám đậm
        return np.clip(img + rng.normal(0, 3, img.shape), 0, 255).astype(np.uint8)  # nhiễu cảm biến

    sn = SoNen()
    sn.hoc_nen([khay() for _ in range(30)])

    def canh_vat(rac=True):
        img = khay()
        cv2.rectangle(img, (100, 100), (160, 220), (40, 40, 200), -1)          # lon đỏ
        cv2.rectangle(img, (300, 80), (360, 260), (75, 75, 75), -1)            # chai nhựa trong: chỉ sáng hơn chút
        cv2.rectangle(img, (300, 80), (360, 260), (200, 200, 200), 2)          # viền sáng của chai trong
        if rac:
            cv2.circle(img, (500, 350), 40, (30, 140, 200), -1)                # rác (model không thấy)
        return img

    n = lambda b: [b[0] / W, b[1] / H, b[2] / W, b[3] / H]
    lon = ("metal", 0.95, n([95, 95, 165, 225]))
    chai = ("plastic", 0.90, n([295, 75, 365, 265]))
    ok = True

    def check(ten, kq, mong):
        nonlocal ok
        good = kq.quyet_dinh == mong
        ok &= good
        print(f"  {'OK ' if good else 'SAI'} {ten}: {kq.quyet_dinh} (mong {mong}) | {len(kq.vung)} vùng | {kq.ly_do}")

    check("khay trống", sn.quyet_dinh(khay(), []), "KHAY_TRONG")
    check("lon + chai, không rác", sn.quyet_dinh(canh_vat(False), [lon, chai]), "NHAN")
    check("lon + chai + rác model KHÔNG thấy", sn.quyet_dinh(canh_vat(True), [lon, chai]), "TRA")
    check("lon + chai + rác model gọi other", sn.quyet_dinh(canh_vat(True), [lon, chai, ("other", 0.9, n([455, 305, 545, 395]))]), "TRA")
    check("model bỏ sót chai trong", sn.quyet_dinh(canh_vat(False), [lon]), "TRA")
    print("Tự kiểm tra:", "ĐẠT" if ok else "CÓ LỖI")
    return ok


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(0 if _tu_kiem_tra() else 1)
