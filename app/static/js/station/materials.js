import * as THREE from 'three';

export const COLORS = {
  green: 0x16a34a,
  greenDark: 0x166534,
  greenLight: 0x4ade80,
  white: 0xf3f5f4,
  trim: 0x1f2933,
  steel: 0xb8c0c8,
  red: 0xef4444,
  amber: 0xf59e0b,
};

export const M = {
  body: new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.32, metalness: 0.08 }),
  green: new THREE.MeshStandardMaterial({ color: COLORS.green, roughness: 0.35, metalness: 0.1 }),
  greenDark: new THREE.MeshStandardMaterial({ color: COLORS.greenDark, roughness: 0.4, metalness: 0.1 }),
  trim: new THREE.MeshStandardMaterial({ color: COLORS.trim, roughness: 0.55, metalness: 0.2 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.9 }),
  steel: new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.25, metalness: 1.0 }),
  cavity: new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.85, metalness: 0.1 }),
  trayPlastic: new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.05 }),
  // Kính cửa khoang nạp: trong suốt thường (KHÔNG dùng transmission – khúc xạ bắt three.js vẽ lại cả cảnh
  // thêm 1 lượt mỗi khung hình, chiếm ~2/3 thời gian vẽ khi có cả khung phố)
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xdff5e8, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.3,
    clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false,
  }),
  screenOff: new THREE.MeshStandardMaterial({ color: 0x050a08, roughness: 0.15, metalness: 0.3 }),
};

export function emissive(color, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, toneMapped: true,
  });
}
