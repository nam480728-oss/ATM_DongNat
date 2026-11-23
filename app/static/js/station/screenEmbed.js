// Nhúng trang /screen (HTML thật) lên mặt màn hình 3D bằng CSS3DRenderer.
// Ở xa: màn hình chỉ để xem, bấm vào thì camera bay tới bảng thao tác.
// Ở gần (nhìn thẳng): thao tác trực tiếp trên màn hình như cảm ứng thật.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { SCREEN_SIZE } from './panel.js';
import { flyTo } from '../ui/viewButtons.js';

const PX_W = 1280, PX_H = 800;
const NEAR_DIST = 1.15;   // m: gần hơn mức này mới thao tác trực tiếp
const MAX_ANGLE = 55;     // độ: nhìn lệch quá thì không thao tác

export function setupScreenEmbed(ctx) {
  const { scene, camera, controls, parts } = ctx;
  const host = document.getElementById('css3d');
  const css = new CSS3DRenderer({ element: host });
  css.setSize(window.innerWidth, window.innerHeight);

  const wrap = document.createElement('div');
  wrap.className = 'screen3d';
  wrap.style.width = PX_W + 'px';
  wrap.style.height = PX_H + 'px';
  const iframe = document.createElement('iframe');
  iframe.src = '/screen?station=' + (window.STATION_ID || 1);
  iframe.title = 'Màn hình cảm ứng của trạm';
  iframe.width = PX_W; iframe.height = PX_H;
  wrap.appendChild(iframe);

  // CSS3DRenderer duyệt cả cây scene mỗi lần vẽ -> để iframe trong 1 scene riêng chỉ có nó,
  // bám theo điểm neo gắn trên màn hình 3D (khung phố lớn không làm chậm lớp HTML)
  const anchor = new THREE.Object3D();
  anchor.scale.setScalar(SCREEN_SIZE.w / PX_W);
  anchor.position.copy(parts.screen.position).add(new THREE.Vector3(0, 0, 0.0004));
  parts.screenMount.add(anchor);
  const cssScene = new THREE.Scene();
  const obj = new CSS3DObject(wrap);
  obj.matrixAutoUpdate = false;
  cssScene.add(obj);
  ctx.screenIframe = iframe;

  // Bấm vào màn hình khi đứng xa -> bay tới bảng thao tác
  parts.screen.userData.action = 'screen';
  parts.screen.userData.hint = 'Bấm để đến gần màn hình';
  parts.screen.userData.onClick = () => flyTo(camera, controls, 'panel');
  (ctx.extraPickables ||= []).push(parts.screen);

  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  let interactive = null;
  // CSS3DRenderer cập nhật transform của iframe -> chỉ vẽ lại khi camera / màn hình thật sự đổi (đỡ tính lại style mỗi khung)
  const lastCam = new THREE.Matrix4(), lastObj = new THREE.Matrix4();
  let lastAspect = 0, forceCss = true;
  window.addEventListener('resize', () => { forceCss = true; });
  ctx.onFrame.push(() => {
    parts.screen.getWorldPosition(center);
    normal.set(0, 0, 1).applyQuaternion(parts.screen.getWorldQuaternion(new THREE.Quaternion()));
    toCam.copy(camera.position).sub(center);
    const dist = toCam.length();
    const angle = THREE.MathUtils.radToDeg(normal.angleTo(toCam.normalize()));
    const near = dist < NEAR_DIST && angle < MAX_ANGLE;
    if (near !== interactive) {
      interactive = near;
      wrap.classList.toggle('interactive', near);
      parts.screen.userData.hint = near ? '' : 'Bấm để đến gần màn hình';
    }
    anchor.updateWorldMatrix(true, false);
    if (forceCss || !lastCam.equals(camera.matrixWorld) || !lastObj.equals(anchor.matrixWorld) || lastAspect !== camera.aspect) {
      lastCam.copy(camera.matrixWorld); lastObj.copy(anchor.matrixWorld); lastAspect = camera.aspect; forceCss = false;
      obj.matrix.copy(anchor.matrixWorld);
      css.render(cssScene, camera);
    }
  });

  window.addEventListener('resize', () => css.setSize(window.innerWidth, window.innerHeight));
  return css;
}
