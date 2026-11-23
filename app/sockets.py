"""Socket.IO: nhận sự kiện cảm biến / thao tác UI, chuyển cho StationController của đúng trạm.

Kết nối:  io({query: {station: <id>}})  -> client vào room 'st:<id>' (nhận state / sự kiện của trạm đó).
Trang admin kết nối với query role=admin -> room 'admin' (nhận 'admin:update' của mọi trạm).

Client -> server:
  join            {role: 'sim' | 'screen'}       scene 3D vào room 'sim:<id>' để nhận lệnh cơ cấu
  sensor          {name, value}                  cảm biến cửa khoang nạp (đóng cửa = quét) / cửa sau / xe thùng
  slot_item       {}                             cảm biến cuối ống lỗ từ thiện: có vật rơi vào phễu
  public_bin      {side: 'left'|'right'}         có rác bỏ vào thùng rác mini 2 bên trạm
  funnel_clear    {}                             nhân viên đã gỡ vật kẹt trong phễu
  security        {name, value}                  cảm biến an ninh: impact{g} | tamper | camera_blocked{giây, 0 = hết che}
  ui              {action, ...}                  phone_lookup{phone} | phone_login{phone} | register{phone, name}
                                                 | logout | continue | activity | payout_form | print_voucher
                                                 | payout{method: charity|transfer|voucher|save, bank?, account?}
  sim:ack         {id, data?}                    scene 3D báo đã chạy xong lệnh actuator
Server -> client:
  state, screen:message, result, session:countdown, actuator, payout, slot:result,
  scan:frame, scan:result, sorter:scan, belt:frame, security, admin:update, admin:security
"""
from flask import current_app, request
from flask_socketio import emit, join_room

from app.station.hal import SimulatedHardware

_client_station: dict[str, int] = {}     # socket sid -> id trạm


def register_socket_handlers(socketio):
    from app import get_controller

    def ctrl():
        sid = _client_station.get(request.sid, current_app.config["STATION_ID"])
        return get_controller(current_app._get_current_object(), sid)

    @socketio.on("connect")
    def on_connect(auth=None):
        if request.args.get("role") == "admin":
            join_room("admin")
            return
        c = get_controller(current_app._get_current_object(), request.args.get("station"))
        if c is None:
            emit("station:missing", {"station": request.args.get("station")})
            return
        _client_station[request.sid] = c.station_id
        join_room(f"st:{c.station_id}")
        emit("state", c.snapshot())  # chỉ gửi cho client vừa kết nối

    @socketio.on("disconnect")
    def on_disconnect(*_):
        _client_station.pop(request.sid, None)

    @socketio.on("join")
    def on_join(data):
        c = ctrl()
        if c is None:
            return {"ok": False, "error": "Trạm không tồn tại"}
        role = (data or {}).get("role")
        if role == "sim":
            join_room(f"sim:{c.station_id}")
        return {"ok": True, "state": c.snapshot()}

    @socketio.on("sensor")
    def on_sensor(data):
        try:
            ctrl().on_sensor(data["name"], bool(data["value"]))
        except (KeyError, TypeError):
            return {"ok": False, "error": "Cảm biến không hợp lệ"}
        return {"ok": True}

    @socketio.on("security")
    def on_security(data):
        try:
            return {"ok": True, "reported": ctrl().on_security(str(data["name"]), data.get("value"))}
        except (KeyError, TypeError, ValueError):
            return {"ok": False, "error": "Cảm biến an ninh không hợp lệ"}

    @socketio.on("slot_item")
    def on_slot_item(_data=None):
        return {"ok": ctrl().on_slot_item()}

    @socketio.on("funnel_clear")
    def on_funnel_clear(_data=None):
        return {"ok": ctrl().clear_jam()}

    @socketio.on("public_bin")
    def on_public_bin(data):
        return {"ok": ctrl().public_drop(str((data or {}).get("side")))}

    @socketio.on("ui")
    def on_ui(data):
        data = data or {}
        action = data.get("action")
        c = ctrl()
        if action == "phone_lookup":
            return c.lookup_phone(str(data.get("phone", "")))
        if action == "phone_login":
            return c.login_phone(str(data.get("phone", "")))
        if action == "register":
            return c.register(str(data.get("phone", "")), str(data.get("name", "")))
        if action == "logout":
            c.logout("user")
        elif action == "continue":
            return {"ok": c.continue_session()}
        elif action == "print_voucher":
            return c.print_voucher()           # in phiếu voucher ra khe dưới màn hình
        elif action == "payout" and data.get("method") == "save":
            return c.save_balance()            # Lưu vào tài khoản (tích lũy theo số điện thoại)
        elif action == "payout":
            base = current_app.config["PUBLIC_BASE_URL"] or request.host_url
            return c.payout(str(data.get("method")), data.get("bank"), data.get("account"), base_url=base)
        elif action == "payout_form":
            return {"ok": c.extend_payout()}
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
