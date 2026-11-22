"""T5 — Chốt model: chép best.pt của lần train được chọn ra models/model/, xuất ONNX, viết MODEL_CARD.md.

  python models/scripts/Train/03_chot_model.py <tên> [--khong-onnx]
Cần chạy trước: 02_danh_gia.py <tên> (val) và 02_danh_gia.py <tên> --test.
"""
import argparse
import csv
import json
import shutil
import time
from collections import Counter

import yaml

from _chung import CLASSES, DATA_DIR, MODEL_DIR, fmt_time, read_progress, run_dir


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ten")
    ap.add_argument("--khong-onnx", action="store_true")
    a = ap.parse_args()
    rd = run_dir(a.ten)
    dg = rd / "danh_gia"
    kv = json.loads((dg / "ketqua_val.json").read_text(encoding="utf-8"))
    kt = json.loads((dg / "ketqua_test.json").read_text(encoding="utf-8")) if (dg / "ketqua_test.json").is_file() else None
    if kt is None:
        print("!! chưa có kết quả TEST (02_danh_gia.py --test) — model card chỉ có số liệu val")
    src = rd / "weights" / "best.pt"
    shutil.copyfile(src, MODEL_DIR / "best.pt")
    onnx_ok = False
    if not a.khong_onnx:
        try:
            from ultralytics import YOLO
            f = YOLO(str(src)).export(format="onnx", imgsz=640, dynamic=False, simplify=True)
            shutil.copyfile(f, MODEL_DIR / "best.onnx")
            onnx_ok = True
        except Exception as e:
            print(f"!! xuất ONNX lỗi ({type(e).__name__}: {e}) — bỏ qua, best.pt vẫn dùng được")
    args = yaml.safe_load(open(rd / "args.yaml", encoding="utf-8"))
    cat = list(csv.DictReader(open(DATA_DIR / "catalog.csv", encoding="utf-8")))
    n = Counter(r["split"] for r in cat)
    box = {c: sum(int(r[f"n_{c}"]) for r in cat) for c in CLASSES}
    prog = read_progress(a.ten)
    best = max(prog, key=lambda x: x["fitness"]) if prog else {}
    t = kv["nguong"]
    t_o = kv.get("tram", {}).get("t_o", t)

    def metrics(r, label):
        if not r:
            return []
        o = r["chinh_thuc"]
        return [f"| {label} | {o['mAP50']:.3f} | {o['mAP50_95']:.3f} | {r['pr']['plastic']['P']:.3f} / {r['pr']['plastic']['R']:.3f} | "
                f"{r['pr']['metal']['P']:.3f} / {r['pr']['metal']['R']:.3f} | {r['tu_choi']:.1%} |"]

    L = ["# MODEL CARD — ATM Đồng Nát: nhận diện nhựa / kim loại / rác khác", "",
         f"- **File:** `best.pt`{' + `best.onnx`' if onnx_ok else ''} (chép từ `{a.ten}/weights/best.pt`, ngày {time.strftime('%d/%m/%Y')})",
         f"- **Kiến trúc:** YOLO11s, khởi tạo từ trọng số COCO, fine-tune 3 lớp: " +
         ", ".join(f"`{i}={c}`" for i, c in enumerate(CLASSES)),
         f"- **Ảnh vào:** {args['imgsz']} px. **Ngưỡng nhựa/kim loại: {t:.2f}** (chọn trên val: {kv['cach_chon_nguong']}). "
         f"**Ngưỡng other: {t_o:.2f}** (chấm theo trạm, mục 5 `BAO_CAO_TRAIN.md`).",
         "- **Luật dùng ở trạm (`app/station/controller.py`, plan_train.md mục 11.7):** mỗi mẻ 10–15 vật đổ lên khay, "
         f"rung đến khi không chồng nhau rồi chụp. Có khung other ≥ {t_o:.2f} -> **TRẢ cả mẻ**; không có -> NHẬN, "
         f"đếm chai/lon theo khung plastic/metal ≥ {t:.2f}. Tùy chọn: `models/scripts/so_nen.py` so với ảnh khay trống "
         "để trả cả vật model không khoanh được.", "",
         "## Dữ liệu", "",
         f"`models/data_da_xu_ly/` (xem `BAO_CAO.md` ở đó): train {n['train']:,} / val {n['val']:,} / test {n['test']:,} ảnh; "
         f"box plastic {box['plastic']:,}, metal {box['metal']:,}, other {box['other']:,}. "
         "Nguồn: Kaggle Drinking Waste + Garbage 12, Roboflow, TACO, COCO, Open Images. "
         "Tập vật lạ `unseen_test/` (600 ảnh, 10 loại) không dùng để train.", "",
         "## Train", "",
         f"- {prog[-1]['epoch'] if prog else '?'} epoch (tốt nhất: epoch {best.get('epoch', '?')}), "
         f"{fmt_time(prog[-1]['da_chay_giay']) if prog else '?'} trên RTX 4060 Laptop.",
         f"- batch {args['batch']}, optimizer {args['optimizer']}, cos_lr {args['cos_lr']}, mosaic {args['mosaic']}, "
         f"mixup {args['mixup']}, degrees {args['degrees']}, flipud {args['flipud']}, scale {args['scale']}, seed {args['seed']}.",
         f"- Cấu hình đầy đủ: `{a.ten}/args.yaml`; biểu đồ: `{a.ten}/results.png`; báo cáo: `{a.ten}/danh_gia/BAO_CAO_TRAIN.md`.", "",
         "## Kết quả", "",
         f"| Tập | mAP50 | mAP50-95 | P / R nhựa (ngưỡng {t:.2f}) | P / R kim loại | Từ chối vật lạ |",
         "|---|---|---|---|---|---|", *metrics(kv, "val"), *metrics(kt, "test"), "",
         f"Tốc độ: GPU {kv['toc_do']['GPU']['fps']:.0f} khung hình/giây, CPU {kv['toc_do']['CPU']['fps']:.1f} khung hình/giây (ảnh 640).", "",
         "## Cách dùng", "", "```python", "from ultralytics import YOLO",
         "model = YOLO(r\"D:\\ATM_Dong_Nat\\models\\model\\best.pt\")",
         f"r = model.predict(frame, imgsz=640, conf={min(t, t_o):.2f})[0]   # r.boxes.cls: 0 plastic, 1 metal, 2 other",
         f"co_rac = any(c == 2 and s >= {t_o:.2f} for c, s in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()))", "```", "",
         "## Giới hạn đã biết", "",
         "- Ảnh train chủ yếu từ internet, 77% ảnh chỉ có 1 vật; cần thử lại trên khay thật với mẻ 10–15 vật.",
         "- Vật hoàn toàn lạ vẫn có thể không bị phát hiện -> so nền khay (`so_nen.py`) để chặn thêm.", ""]
    (MODEL_DIR / "MODEL_CARD.md").write_text("\n".join(L), encoding="utf-8")
    print(f"T5 xong: {MODEL_DIR / 'best.pt'}{', best.onnx' if onnx_ok else ''}, MODEL_CARD.md (ngưỡng {t:.2f})")


if __name__ == "__main__":
    main()
