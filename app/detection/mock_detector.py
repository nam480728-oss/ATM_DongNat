"""Detector giả lập: trả kết quả theo 'đáp án' (hints) do scene 3D gửi kèm ảnh."""
import random

from .base import Detection, Detector, Frame


class MockDetector(Detector):
    name = "giả lập (đáp án 3D)"

    def __init__(self, class_map, conf_threshold=0.5, seed: int | None = None):
        super().__init__(class_map, conf_threshold)
        self._rng = random.Random(seed)

    def detect(self, frame: Frame) -> list[Detection]:
        w, h = frame.image.size
        out = []
        for hint in frame.hints:
            x1, y1, x2, y2 = (int(round(v)) for v in hint["bbox"])
            x1, x2 = sorted((max(0, min(w, x1)), max(0, min(w, x2))))
            y1, y2 = sorted((max(0, min(h, y1)), max(0, min(h, y2))))
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue  # vật nằm ngoài khung hình
            # Độ tin cậy giả lập cho giống model thật (luôn trên ngưỡng)
            conf = hint.get("confidence")
            if conf is None:
                conf = self._rng.uniform(max(self.conf_threshold + 0.05, 0.85), 0.99)
            label = hint["label"]
            out.append(
                Detection(
                    label=label,
                    group=self.group_of(label, conf),
                    confidence=float(conf),
                    bbox=(x1, y1, x2, y2),
                    overlapped=bool(hint.get("overlapped", False)),
                )
            )
        return out
