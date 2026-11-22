"""Theo dõi một lần train đang chạy (đọc tien_do.jsonl + trang_thai.json + GPU). Không can thiệp vào train.

  python models/scripts/Train/theo_doi.py [tên]          in tóm tắt (mặc định: lần train mới nhất)
  python models/scripts/Train/theo_doi.py [tên] --cho-epoch N [--toi-da-phut M]
        chờ đến khi đạt epoch N HOẶC có sự kiện (xong / dừng sớm / lỗi / tiến trình biến mất / loss NaN /
        epoch chậm bất thường / treo), rồi in tóm tắt và thoát.
"""
import argparse
import statistics
import subprocess
import sys
import time

import psutil

from _chung import fmt_time, latest_run, read_progress, read_status


def gpu():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10).stdout
        u, mu, mt, t = [x.strip() for x in out.strip().split(",")]
        return f"GPU {u}% | VRAM {int(mu) / 1024:.1f}/{int(mt) / 1024:.1f} GB | {t}°C", int(t)
    except Exception:
        return "GPU: không đọc được", 0


def events(name):
    """Danh sách sự kiện bất thường hiện tại."""
    st, pr = read_status(name), read_progress(name)
    ev = []
    s = st.get("trang_thai")
    if s in ("xong", "dung_som", "loi", "dung_tay"):
        ev.append({"xong": "TRAIN XONG", "dung_som": "DỪNG SỚM (hết kiên nhẫn)", "loi": "LỖI",
                   "dung_tay": "BỊ DỪNG BẰNG Ctrl+C"}[s])
    elif s == "dang_train" and st.get("pid") and not psutil.pid_exists(st["pid"]):
        ev.append("TIẾN TRÌNH TRAIN ĐÃ BIẾN MẤT (bị tắt/treo máy?)")
    if pr and pr[-1].get("nan"):
        ev.append("LOSS = NaN")
    if len(pr) >= 6:
        med = statistics.median(p["giay_epoch"] for p in pr[:-1])
        if pr[-1]["giay_epoch"] > 1.6 * med:
            ev.append(f"EPOCH CHẬM BẤT THƯỜNG ({pr[-1]['giay_epoch']:.0f}s so với ~{med:.0f}s) — GPU nóng / máy bận?")
    if s == "dang_train" and pr:
        last = time.mktime(time.strptime(pr[-1]["thoi_gian"], "%Y-%m-%d %H:%M:%S"))
        med = statistics.median(p["giay_epoch"] for p in pr)
        if time.time() - last > max(600, 4 * med):
            ev.append(f"KHÔNG CÓ EPOCH MỚI {fmt_time(time.time() - last)} — có thể bị treo")
    return ev


def summary(name):
    st, pr = read_status(name), read_progress(name)
    L = [f"== {name} | trạng thái: {st.get('trang_thai', '?')} | bắt đầu {st.get('bat_dau', '?')}"]
    if pr:
        p = pr[-1]
        best = max(pr, key=lambda x: x["fitness"])
        L.append(f"epoch {p['epoch']}/{p['epochs']} | đã chạy {fmt_time(p['da_chay_giay'])}, còn ~{fmt_time(p['con_lai_giay'])} "
                 f"(nếu không dừng sớm) | {p['giay_epoch']:.0f}s/epoch")
        L.append(f"val hiện tại: P {p['P']:.3f} R {p['R']:.3f} mAP50 {p['mAP50']:.3f} mAP50-95 {p['mAP50_95']:.3f} | "
                 f"loss box {p['loss'].get('box_loss', 0):.3f} cls {p['loss'].get('cls_loss', 0):.3f}")
        L.append(f"tốt nhất: epoch {best['epoch']} mAP50 {best['mAP50']:.3f} mAP50-95 {best['mAP50_95']:.3f}")
        tail = pr[-10:]
        L.append("mAP50 10 epoch gần nhất: " + " ".join(f"{x['mAP50']:.3f}" for x in tail))
        L.append(f"VRAM đỉnh {p['vram_gb']} GB | RAM trống thấp nhất trong epoch {p.get('ram_trong_min_gb', p['ram_trong_gb'])} GB")
    else:
        L.append("chưa có epoch nào xong")
    L.append(gpu()[0])
    if st.get("loi"):
        L.append("LỖI:\n" + st["loi"][-800:])
    ev = events(name)
    if ev:
        L.append("SỰ KIỆN: " + " | ".join(ev))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ten", nargs="?")
    ap.add_argument("--cho-epoch", type=int)
    ap.add_argument("--toi-da-phut", type=float, default=120)
    a = ap.parse_args()
    name = a.ten or latest_run()
    if not name:
        sys.exit("chưa có lần train nào trong models/model/")
    if a.cho_epoch:
        t_end = time.time() + a.toi_da_phut * 60
        while time.time() < t_end:
            pr = read_progress(name)
            if (pr and pr[-1]["epoch"] >= a.cho_epoch) or events(name):
                break
            time.sleep(30)
    print(summary(name))


if __name__ == "__main__":
    main()
