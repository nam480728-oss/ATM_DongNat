"""Thử model lần 3 (y11s_1119_02) REALTIME qua webcam: khoanh vật, đếm chai/lon, tính tiền, báo rác.

Chạy (trong thư mục D:\\ATM_Dong_Nat\\models\\scripts):
  python test_came.py                     webcam mặc định (số 0)
  python test_came.py --cam 1             webcam khác (cắm ngoài)
  python test_came.py --hd                xin camera độ phân giải 1280x720 (nếu camera hỗ trợ)
Tùy chọn ngưỡng như test.py: --nguong 0.85 (chai/lon), --nguong-other 0.80 (rác).

Phím (bấm khi cửa sổ đang được chọn):
  SPACE  chốt mẻ: dừng hình + in hóa đơn ra terminal (bấm lần nữa để chạy tiếp)
  Q/ESC  thoát (hoặc đóng cửa sổ)
Không lưu file nào. Tiền: chai nhựa 200đ, lon nhôm 300đ; có rác (other) -> không tính tiền.
Hiển thị bằng tkinter (OpenCV trên máy là bản không có giao diện nên không dùng cv2.imshow).
"""
import argparse
import sys
import time
import tkinter as tk
from pathlib import Path

import cv2
from PIL import Image, ImageTk

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

WEIGHTS = Path(__file__).resolve().parent.parent / "model" / "y11s_1119_02" / "weights" / "best.pt"   # lần 3
GIA = {"plastic": 200, "metal": 300}
TEN = {"plastic": "Chai nhựa", "metal": "Lon nhôm", "other": "RÁC"}
MAU = {"plastic": (0, 200, 0), "metal": (255, 140, 0), "other": (0, 0, 255)}   # BGR: xanh lá, xanh dương, đỏ


def tien(x):
    return f"{x:,}đ".replace(",", ".")


def ve(img, dets):
    img = img.copy()
    day = max(2, round(max(img.shape[:2]) / 400))
    co = max(0.5, max(img.shape[:2]) / 1400)
    for k, (nhan, conf, (x0, y0, x1, y1)) in enumerate(dets, 1):
        c = MAU[nhan]
        cv2.rectangle(img, (x0, y0), (x1, y1), c, day)
        chu = f"{k}.{nhan} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(chu, cv2.FONT_HERSHEY_SIMPLEX, co, day)
        y = max(th + 6, y0)
        cv2.rectangle(img, (x0, y - th - 6), (x0 + tw + 4, y), c, -1)
        cv2.putText(img, chu, (x0 + 2, y - 4), cv2.FONT_HERSHEY_SIMPLEX, co, (255, 255, 255), day)
    return img


class App:
    def __init__(self, a):
        import torch
        from ultralytics import YOLO
        self.a = a
        self.device = 0 if torch.cuda.is_available() else "cpu"
        print(f"Nạp model {WEIGHTS.parent.parent.name} ({'GPU' if self.device == 0 else 'CPU'}) ...")
        self.model = YOLO(str(WEIGHTS))
        self.cap = cv2.VideoCapture(a.cam, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            sys.exit(f"Không mở được webcam số {a.cam}. Thử --cam 1, hoặc tắt ứng dụng khác đang dùng camera (Zoom, Teams...).")
        if a.hd:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        ok, f = self.cap.read()
        if not ok:
            sys.exit("Webcam mở được nhưng không đọc được hình.")
        print(f"Webcam {a.cam}: {f.shape[1]}x{f.shape[0]}. SPACE = chốt mẻ/in hóa đơn, Q/ESC = thoát.")
        self.model.predict(f, imgsz=640, device=self.device, verbose=False)   # chạy nháp cho GPU nóng máy

        self.root = tk.Tk()
        self.root.title("ATM Đồng Nát — thử model qua webcam (SPACE: chốt mẻ, Q: thoát)")
        self.anh = tk.Label(self.root, bg="black")
        self.anh.pack()
        self.trang_thai = tk.Label(self.root, font=("Segoe UI", 16, "bold"), fg="white", bg="#006400", anchor="w", padx=10)
        self.trang_thai.pack(fill="x")
        self.root.bind("<space>", lambda e: self.chot())
        for k in ("q", "Q", "<Escape>"):
            self.root.bind(k, lambda e: self.thoat())
        self.root.protocol("WM_DELETE_WINDOW", self.thoat)
        self.dung = False
        self.kq = None
        self.t_truoc = time.time()
        self.fps = 0.0
        self.so_me = 0
        self.vong()
        self.root.mainloop()

    def nhan_dien(self, frame):
        r = self.model.predict(frame, imgsz=640, conf=min(self.a.nguong, self.a.nguong_other),
                               device=self.device, verbose=False)[0]
        dets = []
        for c, s, b in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxy.tolist()):
            nhan = self.model.names[int(c)]
            if s >= (self.a.nguong_other if nhan == "other" else self.a.nguong):
                dets.append((nhan, s, [round(v) for v in b]))
        dets.sort(key=lambda d: (d[2][1] // 50, d[2][0]))        # đánh số từ trên xuống, trái sang phải
        so = {k: sum(d[0] == k for d in dets) for k in ("plastic", "metal", "other")}
        return dets, so

    def vong(self):
        if not self.dung:
            ok, frame = self.cap.read()
            if ok:
                dets, so = self.nhan_dien(frame)
                self.kq = (frame, dets, so)
                now = time.time()
                self.fps = 0.9 * self.fps + 0.1 / max(1e-3, now - self.t_truoc) if self.fps else 1 / max(1e-3, now - self.t_truoc)
                self.t_truoc = now
                self.hien(ve(frame, dets), so)
        self.root.after(1, self.vong)

    def hien(self, img, so, chot=False):
        h, w = img.shape[:2]
        s = min(1.0, 800 / h, 1400 / w)
        if s < 1:
            img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        self._tk = ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))   # giữ tham chiếu
        self.anh.configure(image=self._tk)
        tong = so["plastic"] * GIA["plastic"] + so["metal"] * GIA["metal"]
        dau = "⏸ ĐÃ CHỐT MẺ — SPACE chạy tiếp   " if chot else ""
        if so["other"]:
            chu, mau = f"{dau}⚠ CÓ {so['other']} VẬT RÁC → KHÔNG TÍNH TIỀN  (chai {so['plastic']}, lon {so['metal']})", "#B00000"
        else:
            chu, mau = f"{dau}Chai {so['plastic']} | Lon {so['metal']} | Tổng {tien(tong)}", "#006400"
        if not chot:
            chu += f"   ·  {self.fps:.0f} FPS"
        self.trang_thai.configure(text=chu, bg=mau)

    def chot(self):
        if self.dung:                       # đang dừng -> chạy tiếp
            self.dung = False
            return
        if self.kq is None:
            return
        self.dung = True
        self.so_me += 1
        frame, dets, so = self.kq
        tong = so["plastic"] * GIA["plastic"] + so["metal"] * GIA["metal"]
        print(f"\n=== Mẻ {self.so_me} ({time.strftime('%H:%M:%S')}) ===")
        for k, (nhan, s, _) in enumerate(dets, 1):
            print(f"  {k:2d}. {TEN[nhan]:<10} tin cậy {s:.2f}")
        if not dets:
            print("  (không thấy chai/lon/rác nào)")
        print("-" * 40)
        print(f"  Chai nhựa : {so['plastic']:2d} x {tien(GIA['plastic'])}")
        print(f"  Lon nhôm  : {so['metal']:2d} x {tien(GIA['metal'])}")
        print("-" * 40)
        if so["other"]:
            print(f"  ⚠️  CÓ {so['other']} VẬT RÁC (khung đỏ) -> KHÔNG TÍNH TIỀN, trả lại cả mẻ.")
        else:
            print(f"  TỔNG TIỀN : {tien(tong)}  ({so['plastic'] + so['metal']} vật)")
        self.hien(ve(frame, dets), so, chot=True)

    def thoat(self):
        self.cap.release()
        self.root.destroy()


def main():
    ap = argparse.ArgumentParser(description="Thử model realtime qua webcam: đếm chai/lon, tính tiền, báo rác")
    ap.add_argument("--cam", type=int, default=0, help="số thứ tự webcam (mặc định 0)")
    ap.add_argument("--hd", action="store_true", help="xin độ phân giải 1280x720")
    ap.add_argument("--nguong", type=float, default=0.85, help="ngưỡng tin cậy chai/lon (mặc định 0.85)")
    ap.add_argument("--nguong-other", type=float, default=0.80, help="ngưỡng tin cậy rác (mặc định 0.80)")
    App(ap.parse_args())


if __name__ == "__main__":
    main()
