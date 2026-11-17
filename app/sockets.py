"""Socket.IO: nhận sự kiện cảm biến / thao tác UI, chuyển cho StationController.

Client -> server:
  join            {role: 'sim' | 'screen'}       scene 3D vào room 'sim' để nhận lệnh cơ cấu
  sensor          {name, value}                  cảm biến cửa / khay / ngăn trả rác
  pay_button      {}                             nút TÍNH TIỀN
  slot_item       {}                             cảm biến cuối máng lỗ bỏ chai: có vật rơi xuống
  ui              {action, ...}                  select_user | logout | continue | activity | payout{method}
  sim:ack         {id, data?}                    scene 3D báo đã chạy xong lệnh actuator
Server -> client:
  state, screen:message, result, session:countdown, actuator, payout, slot:result, scan:frame
"""
from flask import current_app
from flask_socketio import emit, join_room

from app.station.hal import SimulatedHardware


def register_socket_handlers(socketio):
    def ctrl():
        return current_app.extensions["station"]

    @socketio.on("connect")
    def on_connect():
        emit("state", ctrl().snapshot())  # chỉ gửi cho client vừa kết nối

    @socketio.on("join")
    def on_join(data):
        role = (data or {}).get("role")
        if role in ("sim", "screen"):
            join_room(role)
        return {"ok": True, "state": ctrl().snapshot()}

    @socketio.on("sensor")
    def on_sensor(data):
        try:
            ctrl().on_sensor(data["name"], bool(data["value"]))
        except (KeyError, TypeError):
            return {"ok": False, "error": "Cảm biến không hợp lệ"}
        return {"ok": True}

    @socketio.on("pay_button")
    def on_pay(_data=None):
        return {"ok": ctrl().press_pay()}

    @socketio.on("slot_item")
    def on_slot_item(_data=None):
        return {"ok": ctrl().on_slot_item()}

    @socketio.on("ui")
    def on_ui(data):
        data = data or {}
        action = data.get("action")
        c = ctrl()
        if action == "select_user":
            try:
                return {"ok": c.select_user(int(data["user_id"]))}
            except (KeyError, TypeError, ValueError):
                return {"ok": False, "error": "user_id không hợp lệ"}
        if action == "logout":
            c.logout("user")
        elif action == "continue":
            return {"ok": c.continue_session()}
        elif action == "payout":
            return {"ok": c.payout(str(data.get("method")))}
        elif action == "activity":
            c.touch()
        else:
            return {"ok": False, "error": f"action không hợp lệ: {action}"}
        return {"ok": True}

    @socketio.on("sim:ack")
    def on_ack(data):
        hal = ctrl().hal
        if isinstance(hal, SimulatedHardware):
            hal.ack(int(data["id"]), data.get("data"))
