import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { icpStep, prepare, signedDistances } from '../src/geometry';
import { makeMolar } from '../src/tooth';

const white = new THREE.Color('#ffffff');

function sphere(r: number) {
  const g = new THREE.SphereGeometry(r, 128, 96);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return mergeVertices(g, 1e-6);
}

function minOf(a: Float32Array) {
  let m = Infinity;
  for (const v of a) if (v < m) m = v;
  return m;
}

describe('signedDistances', () => {
  const a = prepare(new THREE.Mesh(sphere(5)), white);
  const b = prepare(new THREE.Mesh(sphere(5)), white);
  const sd = new Float32Array(b.mesh.geometry.getAttribute('position').count);

  it('reports overlap as a negative distance', () => {
    b.mesh.position.set(9.8, 0, 0);
    expect(minOf(signedDistances(b, a, sd))).toBeCloseTo(-0.2, 2);
  });

  it('reports a gap as a positive distance', () => {
    b.mesh.position.set(10.3, 0, 0);
    expect(minOf(signedDistances(b, a, sd))).toBeCloseTo(0.3, 2);
  });
});

describe('icpStep', () => {
  it('pulls a displaced crown scan back onto the reference', () => {
    const geo = makeMolar(0);
    geo.computeBoundingBox();
    const ref = prepare(new THREE.Mesh(geo), white);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const bb = geo.boundingBox!;
    const cropY = bb.min.y + (bb.max.y - bb.min.y) * 0.58;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i += 7) if (pos.getY(i) >= cropY) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));

    const scan = new THREE.Object3D();
    scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 2, 0.5).normalize(), THREE.MathUtils.degToRad(14));
    scan.position.set(1.5, -0.8, 1.2);
    for (let it = 0; it < 15; it++) icpStep(scan, pts, ref, it);

    const angle = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(scan.quaternion.w))));
    expect(angle).toBeLessThan(0.1);
    expect(scan.position.length()).toBeLessThan(0.01);
  });
});
