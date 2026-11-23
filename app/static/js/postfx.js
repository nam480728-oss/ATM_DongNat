// Hậu kỳ đồ họa + môi trường HDRI:
//   HDRI bầu trời thật (Poly Haven, CC0) cho phản chiếu kim loại / chai nhựa,
//   GTAO (bóng đổ tiếp xúc mềm ở góc khe), bloom cho đèn LED / đèn cảnh báo, SMAA khử răng cưa.
// Tắt được ở panel Dev (máy yếu) -> quay về render thường.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/** Nạp HDRI làm ánh sáng môi trường + nền trời (lỗi thì giữ nguyên môi trường cũ) */
export async function loadHdri(renderer, scene, url) {
  try {
    const hdr = await new RGBELoader().loadAsync(url);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.background = hdr;
    scene.backgroundIntensity = 0.85;
    scene.backgroundBlurriness = 0.02;
    pmrem.dispose();
    return true;
  } catch (e) {
    console.warn('HDRI', e);
    return false;
  }
}

export function setupPostFx(renderer, scene, camera, container) {
  const w = container.clientWidth, h = container.clientHeight;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, w, h);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.45, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  composer.addPass(smaa);
  const fx = {
    enabled: true,
    composer,
    /** bật / tắt GTAO (lượt hậu kỳ nặng nhất) */
    setAO(on) { gtao.enabled = on; },
    render() {
      if (fx.enabled) composer.render();
      else renderer.render(scene, camera);
    },
    resize(width, height) {
      composer.setSize(width, height);
      gtao.setSize(width, height);
      bloom.setSize(width, height);
    },
  };
  return fx;
}
