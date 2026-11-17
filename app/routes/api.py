import io

from flask import Blueprint, current_app, jsonify, request
from PIL import Image, UnidentifiedImageError

from app.detection import Frame
from app.services import user_service
from app.station.hal import decode_data_url

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.get("/users")
def list_users():
    return jsonify(user_service.search_users(request.args.get("q")))


@bp.post("/users")
def create_user():
    data = request.get_json(silent=True) or {}
    try:
        user = user_service.create_user(data.get("name", ""), str(data.get("account_number", "")))
    except user_service.UserError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(user_service.user_to_dict(user)), 201


@bp.get("/state")
def state():
    return jsonify(current_app.extensions["station"].snapshot())


@bp.post("/scan")
def scan():
    """Chạy detector trên 1 ảnh (không đi qua quy trình máy). Dùng để thử model.

    multipart: file=<ảnh>   hoặc   JSON: {"image": "<data url>", "hints": [...]}
    """
    ctrl = current_app.extensions["station"]
    if ctrl.detector is None:
        return jsonify({"error": f"Bộ nhận diện chưa sẵn sàng: {ctrl.detector_error}"}), 503
    try:
        if "file" in request.files:
            image = Image.open(io.BytesIO(request.files["file"].read())).convert("RGB")
            hints = []
        else:
            data = request.get_json(silent=True) or {}
            image = decode_data_url(data["image"])
            hints = data.get("hints", [])
    except (KeyError, UnidentifiedImageError, ValueError):
        return jsonify({"error": "Ảnh không hợp lệ"}), 400
    dets = ctrl.detector.detect(Frame(image, hints))
    return jsonify({"width": image.width, "height": image.height, "detections": [d.to_dict() for d in dets]})
