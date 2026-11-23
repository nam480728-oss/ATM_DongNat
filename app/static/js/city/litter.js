// Rác vương vãi trên vỉa hè và bãi cát: nhân vật đi tới bấm E để nhặt vào tay (bảng "Rác trong tay"),
// mang tới trạm bỏ khay / lỗ từ thiện / thùng rác mini. Rác mới thỉnh thoảng xuất hiện lại (tối đa MAX vật).
import * as THREE from 'three';
import { ITEM_TYPES, createItem } from '../items/itemFactory.js';
import { L } from './street.js';
import { groundY } from '../player/player.js';

const MAX = 12;
const TYPES = ['bottle_500', 'bottle_500', 'bottle_1500', 'bottle_flat', 'can_tall', 'can_short', 'can_dented',
  'cup_straw', 'plastic_bag', 'snack_bag', 'paper_cup', 'milk_carton', 'foam_box'];

export function setupLitter(ctx) {
  const city = ctx.street.city;
  const slots = ctx.stations.slots;
  const items = [];

  function spot() {
    for (let k = 0; k < 30; k++) {
      const onSand = Math.random() < 0.4;
      const x = (Math.random() - 0.5) * 70;
      const z = onSand ? -5 - Math.random() * 10 : 1.2 + Math.random() * 2.2;
      if (slots.some((s) => Math.abs(x - s.x) < 1.6 && z < 1.6)) continue;      // không rơi sát trạm
      if (!onSand && [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5].some((lx) => Math.abs(x - lx) < 0.5 && z > 3.2)) continue;
      if (items.some((it) => Math.hypot(it.userData.sx - x, it.userData.sz - z) < 2)) continue;
      return { x, z };
    }
    return null;
  }
  function spawn() {
    const p = spot();
    if (!p) return;
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const it = createItem(type);
    const s = it.userData.size;
    it.position.set(p.x, groundY(p.x, p.z) + s.y / 2 + 0.003, p.z);
    it.rotation.y = Math.random() * Math.PI * 2;
    it.userData.sx = p.x; it.userData.sz = p.z;
    city.add(it);
    it.updateMatrixWorld(true);
    items.push(it);
  }
  for (let i = 0; i < MAX; i++) spawn();

  let t = 0;
  ctx.onFrame.push((dt) => {
    t += dt;
    if (t > 35) { t = 0; if (items.length < MAX) spawn(); }
  });

  ctx.litter = {
    items,
    nearest(x, z, r) {
      let best = null, bd = r;
      for (const it of items) {
        const d = Math.hypot(it.userData.sx - x, it.userData.sz - z);
        if (d < bd) { bd = d; best = it; }
      }
      return best && { item: best, name: ITEM_TYPES[best.userData.type].name.toLowerCase() };
    },
    pick({ item }) {
      const i = items.indexOf(item);
      if (i < 0) return;
      items.splice(i, 1);
      city.remove(item);
      item.position.set(0, 0, 0);
      item.rotation.set(0, 0, 0);
      const T = ctx.trash;
      T.hand.push(item);
      T.notify();
      ctx.minimapDirty = true;
    },
  };
  return ctx.litter;
}
