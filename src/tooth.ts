// A procedural lower molar in millimetres: a welded sphere bent into a boxy crown with four cusps and a
// central fossa on top of a tapered root. Closed and consistently oriented, so the inside test works on it.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function makeMolar(variant = 0): THREE.BufferGeometry {
  const base = new THREE.SphereGeometry(1, 144, 108);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geo = mergeVertices(base, 1e-5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const jitter = (n: number) => 1 + 0.06 * Math.sin(n * 12.9898 + variant * 4.1);
  const cusps: [number, number, number][] = [
    [0.42, 0.40, jitter(1)], [-0.40, 0.42, jitter(2)], [0.40, -0.42, jitter(3)], [-0.42, -0.38, jitter(4)], [0.0, 0.55, 0.55],
  ];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const th = Math.atan2(z, x);
    const box = Math.pow(Math.pow(Math.abs(Math.cos(th)), 2.8) + Math.pow(Math.abs(Math.sin(th)), 2.8), -1 / 2.8);
    let k: number, ny: number;
    if (y >= 0) {
      // narrow at the neck, widest at the contact height (upper middle third), a little narrower at the occlusal table
      k = (0.8 + 0.27 * Math.sin(Math.PI * y * 0.82)) * Math.pow(box, 0.8);
      ny = 0.6 + 6.2 * Math.pow(Math.sin((y * Math.PI) / 2), 0.7);
    } else {
      const t = -y;
      k = 0.8 * (1 - 0.62 * Math.pow(t, 1.2)) * Math.pow(box, 0.8 * (1 - t));
      ny = 0.6 - 12.5 * t;
    }
    const nx = x * k * 5.1;
    const nz = z * k * 5.6;
    let lift = 0;
    if (y > 0.5) {
      const u = nx / 5.1, w = nz / 5.6;
      let bump = 0;
      for (const [cx, cz, h] of cusps) bump += h * Math.exp(-((u - cx) ** 2 + (w - cz) ** 2) / 0.045);
      const fossa = Math.exp(-(u * u + w * w) / 0.035);
      lift = smoothstep(0.5, 0.93, y) * (1.15 * bump - 1.0 * fossa);
    }
    pos.setXYZ(i, nx, ny + lift, nz);
  }
  geo.computeVertexNormals();
  return geo;
}
