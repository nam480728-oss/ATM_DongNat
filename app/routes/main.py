from flask import Blueprint, current_app, render_template, send_from_directory

bp = Blueprint("main", __name__)


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/screen")
def screen():
    return render_template("screen.html")


@bp.get("/media/<path:filename>")
def media(filename):
    """Ảnh quét (scans/...) và ảnh cắt (crops/...)."""
    return send_from_directory(current_app.config["DATA_DIR"], filename)
