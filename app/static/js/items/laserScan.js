// Đầu laser vạch (line laser) đặt cạnh camera buồng quét: tia đỏ quét qua mặt phẳng rung từ sau ra trước rồi
// quay lại. Vạch đỏ được "in" thật lên bề mặt mặt phẳng và rác (shader cắt theo mặt phẳng tia laser),
// kèm quạt sáng mờ trong không khí và ánh đỏ hắt quanh vạch.
import * as THREE from 'three';
import { M } from '../station/materials.js';
import { box } from '../station/helpers.js';
import { PLATE, SCAN_CAM } from '../station/interior.js';

const gsap = () => window.gsap;
const RED = new THREE.Color(1.0, 0.06, 0.04);

export function setupLaser(ctx, interior) {
  const g = interior.group;
  // Vị trí đầu phát: cạnh camera (cùng giá treo), hơi lệch phải
  const E = new THREE.Vector3(SCAN_CAM.pos[0] + 0.075, SCAN_CAM.pos[1] + 0.004, SCAN_CAM.pos[2]);

  // ---- Mô hình đầu phát ----
  const head = new THREE.Group();
  head.name = 'laserHead';
  head.position.copy(E);
  head.add(box(0.034, 0.026, 0.05, M.rubber));
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: RED, emissiveIntensity: 0, roughness: 0.1 });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16), lensMat);
  lens.position.y = -0.016;
  head.add(lens);
  g.add(head);

  // ---- Uniform dùng chung cho mọi vật liệu được "chiếu laser" ----
  const U = {
    uLaserOn: { value: 0 },
    uLaserPoint: { value: E.clone() },
    uLaserNormal: { value: new THREE.Vector3(0, 0, 1) },
    uLaserWidth: { value: 0.0032 },
    uLaserMin: { value: new THREE.Vector3(-0.42, PLATE.y - 0.08, PLATE.z - PLATE.d / 2 - 0.08) },
    uLaserMax: { value: new THREE.Vector3(0.42, PLATE.y + 0.35, PLATE.z + PLATE.d / 2 + 0.08) },
  };

  function patch(mat) {
    if (mat.userData.laser) return;
    mat.userData.laser = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      prev?.call(mat, shader, r);
      Object.assign(shader.uniforms, U);
      shader.vertexShader = 'varying vec3 vLaserW;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vLaserW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = `varying vec3 vLaserW;
uniform float uLaserOn; uniform vec3 uLaserPoint; uniform vec3 uLaserNormal; uniform float uLaserWidth;
uniform vec3 uLaserMin; uniform vec3 uLaserMax;
` + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (uLaserOn > 0.0 && all(greaterThan(vLaserW, uLaserMin)) && all(lessThan(vLaserW, uLaserMax))) {
    float ld = abs(dot(vLaserW - uLaserPoint, uLaserNormal));
    float core = 1.0 - smoothstep(uLaserWidth * 0.35, uLaserWidth, ld);
    float halo = 1.0 - smoothstep(0.0, uLaserWidth * 7.0, ld);
    totalEmissiveRadiance += vec3(1.0, 0.06, 0.04) * uLaserOn * (core * 7.0 + halo * 0.35);
  }`);
    };
    const key = mat.customProgramCacheKey?.bind(mat);
    mat.customProgramCacheKey = () => (key ? key() : '') + '|laser';
    mat.needsUpdate = true;
  }

  /** Gắn hiệu ứng laser cho mọi mesh trong obj (mặt phẳng rung, rác). Gọi lại nhiều lần vẫn an toàn. */
  function attach(obj) {
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // vật liệu dùng chung (M.steel...) -> tách riêng để không ảnh hưởng chỗ khác
      const own = mats.map((m) => (Object.values(M).includes(m) ? m.clone() : m));
      o.material = Array.isArray(o.material) ? own : own[0];
      own.forEach((m) => { if (m.isMeshStandardMaterial) patch(m); });
    });
  }
  attach(interior.plate);

  // ---- Quạt sáng (tấm tam giác cộng sáng) từ đầu phát xuống vạch ----
  const fanGeo = new THREE.BufferGeometry();
  const halfW = PLATE.w / 2 + 0.01;
  fanGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -halfW, -1, 0, halfW, -1, 0], 3));
  fanGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25], 3));
  const fanMat = new THREE.MeshBasicMaterial({
    color: RED, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  const fanPivot = new THREE.Group();
  fanPivot.position.copy(E);
  fanPivot.add(fan);
  fan.renderOrder = 5;
  g.add(fanPivot);
  fanPivot.visible = false;

  // ánh đỏ hắt quanh vạch
  const glow = new THREE.PointLight(0xff2010, 0, 0.3, 2);
  g.add(glow);

  const X = new THREE.Vector3(1, 0, 0);
  const d = new THREE.Vector3();
  /** Đặt tia laser chiếu tới điểm z (tọa độ trạm) trên mặt phẳng rung */
  function aim(z) {
    const P = new THREE.Vector3(0, PLATE.y, z);
    d.subVectors(P, E);
    const len = d.length();
    d.normalize();
    U.uLaserPoint.value.copy(E);
    U.uLaserNormal.value.crossVectors(X, d).normalize();
    fanPivot.rotation.x = Math.atan2(-d.z, -d.y);
    fanPivot.scale.y = len + 0.02;
    glow.position.set(0, PLATE.y + 0.04, z);
  }

  function setPower(v) {
    U.uLaserOn.value = v;
    fanMat.opacity = 0.12 * v;
    lensMat.emissiveIntensity = 4 * v;
    glow.intensity = 0.35 * v;
    fanPivot.visible = v > 0.001;
  }

  /** Quét 1 lượt: sau -> trước -> sau. Trả về Promise khi xong. */
  async function sweep({ forward = 1.1, back = 0.8 } = {}) {
    const zBack = PLATE.z - PLATE.d / 2 + 0.005, zFront = PLATE.z + PLATE.d / 2 - 0.005;
    const s = { z: zBack, p: 0 };
    const upd = () => { aim(s.z); setPower(s.p); };
    upd();
    await gsap().to(s, { p: 1, duration: 0.12, onUpdate: upd }).then();
    await gsap().to(s, { z: zFront, duration: forward, ease: 'sine.inOut', onUpdate: upd }).then();
    await gsap().to(s, { z: zBack, duration: back, ease: 'sine.inOut', onUpdate: upd }).then();
    await gsap().to(s, { p: 0, duration: 0.12, onUpdate: upd }).then();
    setPower(0);
  }

  setPower(0);
  ctx.laser = { attach, sweep, aim, setPower };
  return ctx.laser;
}
