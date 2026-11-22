"""Detector dùng model YOLO 3 nhãn plastic / metal / other (models/model/best.pt, xem models/model/MODEL_CARD.md).

Cắm model: .env  DETECTOR=yolo,  MODEL_PATH=models/model/best.pt
Luật trạm (MODEL_CARD): khung plastic/metal >= CONF_BOTTLE_CAN mới tính là chai/lon; khung other >= CONF_OTHER là rác
-> trả cả mẻ. Khung dưới ngưỡng bị bỏ qua (vật model không chắc sẽ do lớp so nền khay bắt lại).
"""
from pathlib import Path

from .base import GROUP_OTHER, Detection, Detector, Frame


class DetectorUnavailable(RuntimeError):
    pass


class YoloDetector(Detector):
    uses_image = True
    # Hai bbox có IoU vượt ngưỡng này bị coi là "đè nhau" -> cần rung lại
    OVERLAP_IOU = 0.15

    def __init__(self, model_path: str, class_map, conf_bottle_can=0.85, conf_other=0.80, imgsz=640):
        super().__init__(class_map, conf_bottle_can)
        path = Path(model_path)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[2] / path
        if not path.is_file():
            raise DetectorUnavailable(f"Không tìm thấy file model: {path}")
        try:
            import torch
            from ultralytics import YOLO
        except ImportError as e:  # pragma: no cover
            raise DetectorUnavailable("Chưa cài thư viện ultralytics (pip install ultralytics)") from e
        self.model = YOLO(str(path))
        self.device = 0 if torch.cuda.is_available() else "cpu"
        self.conf_bottle_can = conf_bottle_can
        self.conf_other = conf_other
        self.imgsz = imgsz
        self.name = f"model thật YOLO ({path.name})"
        from PIL import Image
        self.model.predict(Image.new("RGB", (640, 480)), imgsz=imgsz, device=self.device, verbose=False)  # nạp sẵn GPU

    def detect(self, frame: Frame, conf_bottle_can: float | None = None, conf_other: float | None = None,
               imgsz: int | None = None) -> list[Detection]:
        """conf_*: ghi đè ngưỡng cho 1 lần gọi (API /api/scan dùng để thử model), mặc định theo cấu hình."""
        t_pm = self.conf_bottle_can if conf_bottle_can is None else conf_bottle_can
        t_o = self.conf_other if conf_other is None else conf_other
        result = self.model.predict(frame.image, imgsz=imgsz or self.imgsz, conf=min(t_pm, t_o),
                                    device=self.device, verbose=False)[0]
        names = result.names
        dets = []
        for xyxy, c, s in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist()):
            label = names[int(c)]
            group = self.class_map.get(label, GROUP_OTHER)
            if s < (t_o if group == GROUP_OTHER else t_pm):
                continue
            dets.append(Detection(label, group, float(s), tuple(int(round(v)) for v in xyxy)))
        dets.sort(key=lambda d: (d.bbox[1] // 50, d.bbox[0]))   # thứ tự đọc: trên xuống, trái sang phải
        for i, a in enumerate(dets):
            for b in dets[i + 1:]:
                if _iou(a.bbox, b.bbox) > self.OVERLAP_IOU:
                    a.overlapped = b.overlapped = True
        return dets


def _iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0
