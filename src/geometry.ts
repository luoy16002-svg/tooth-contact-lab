// Contact analysis and registration on triangle meshes, accelerated with three-mesh-bvh.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export type Prepared = {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  vertexArea: Float32Array; // a third of the area of every triangle around each vertex, mm²
  base: THREE.Color;
};

export function prepare(mesh: THREE.Mesh, base: THREE.Color): Prepared {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const bvh = new MeshBVH(geo);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.getIndex()!;
  const area = new Float32Array(pos.count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tri = new THREE.Triangle();
  for (let f = 0; f < index.count; f += 3) {
    const i0 = index.getX(f), i1 = index.getX(f + 1), i2 = index.getX(f + 2);
    tri.set(a.fromBufferAttribute(pos, i0), b.fromBufferAttribute(pos, i1), c.fromBufferAttribute(pos, i2));
    const s = tri.getArea() / 3;
    area[i0] += s; area[i1] += s; area[i2] += s;
  }
  if (!geo.getAttribute('color')) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  return { mesh, bvh, vertexArea: area, base };
}

const _p = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _hit: { point: THREE.Vector3; distance: number; faceIndex: number } = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/** Signed distance from every vertex of `from` to the surface of `to` (negative inside `to`), in mm. */
export function signedDistances(from: Prepared, to: Prepared, out: Float32Array, maxDist = 3): Float32Array {
  const pos = from.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  from.mesh.updateMatrixWorld();
  to.mesh.updateMatrixWorld();
  _inv.copy(to.mesh.matrixWorld).invert();
  const tPos = to.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const tIdx = to.mesh.geometry.getIndex()!;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(from.mesh.matrixWorld).applyMatrix4(_inv);
    const hit = to.bvh.closestPointToPoint(_p, _hit as never, 0, maxDist) as typeof _hit | null;
    if (!hit) { out[i] = maxDist; continue; }
    const f = hit.faceIndex * 3;
    _a.fromBufferAttribute(tPos, tIdx.getX(f));
    _b.fromBufferAttribute(tPos, tIdx.getX(f + 1));
    _c.fromBufferAttribute(tPos, tIdx.getX(f + 2));
    _n.subVectors(_c, _b).cross(_cp.subVectors(_a, _b)).normalize();
    const sign = _cp.subVectors(_p, hit.point).dot(_n) < 0 ? -1 : 1;
    out[i] = sign * hit.distance;
  }
  return out;
}

const PEN = new THREE.Color('#d9363e');
const CONTACT = new THREE.Color('#f2a33a');
const NEAR = new THREE.Color('#7fb7d9');
const _col = new THREE.Color();

export const CONTACT_MM = 0.1;

/** Paints penetration red, contact amber and the near zone blue. Returns the summary for the panel. */
export function paint(p: Prepared, sd: Float32Array) {
  const geo = p.mesh.geometry as THREE.BufferGeometry;
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  let minD = Infinity, contactArea = 0, penArea = 0;
  for (let i = 0; i < sd.length; i++) {
    const d = sd[i];
    if (d < minD) minD = d;
    if (d < 0) {
      penArea += p.vertexArea[i];
      _col.copy(p.base).lerp(PEN, Math.min(1, 0.55 + -d / 0.4));
    } else if (d < CONTACT_MM) {
      contactArea += p.vertexArea[i];
      _col.copy(p.base).lerp(CONTACT, 0.85);
    } else if (d < 0.6) {
      _col.copy(p.base).lerp(NEAR, 0.55 * (1 - (d - CONTACT_MM) / (0.6 - CONTACT_MM)));
    } else {
      _col.copy(p.base);
    }
    col.setXYZ(i, _col.r, _col.g, _col.b);
  }
  col.needsUpdate = true;
  return { minD, contactArea, penArea };
}

export function clearPaint(p: Prepared) {
  const col = p.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, p.base.r, p.base.g, p.base.b);
  col.needsUpdate = true;
}

// ---------- rigid registration (ICP, point-to-point, Horn's closed form) ----------

/** Eigen-decomposition of a symmetric 4x4 matrix by cyclic Jacobi rotations. Returns the eigenvector of the largest eigenvalue. */
function largestEigenvector4(m: number[][]): number[] {
  const a = m.map(r => r.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

/** Best rigid transform (rotation + translation) taking points P onto Q, by Horn's quaternion method. */
export function bestRigid(P: THREE.Vector3[], Q: THREE.Vector3[]): THREE.Matrix4 {
  const n = P.length;
  const pc = new THREE.Vector3(), qc = new THREE.Vector3();
  for (let i = 0; i < n; i++) { pc.add(P[i]); qc.add(Q[i]); }
  pc.divideScalar(n); qc.divideScalar(n);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i].x - pc.x, py = P[i].y - pc.y, pz = P[i].z - pc.z;
    const qx = Q[i].x - qc.x, qy = Q[i].y - qc.y, qz = Q[i].z - qc.z;
    Sxx += px * qx; Sxy += px * qy; Sxz += px * qz;
    Syx += py * qx; Syy += py * qy; Syz += py * qz;
    Szx += pz * qx; Szy += pz * qy; Szz += pz * qz;
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [w, x, y, z] = largestEigenvector4(N);
  const qrot = new THREE.Quaternion(x, y, z, w).normalize();
  const t = qc.clone().sub(pc.clone().applyQuaternion(qrot));
  return new THREE.Matrix4().compose(t, qrot, new THREE.Vector3(1, 1, 1));
}

/** Solves the symmetric 6x6 system M x = b by Gaussian elimination with partial pivoting. */
function solve6(M: Float64Array, b: Float64Array): number[] {
  const a = Array.from({ length: 6 }, (_, i) => [...M.subarray(i * 6, i * 6 + 6), b[i]]);
  for (let c = 0; c < 6; c++) {
    let piv = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    if (Math.abs(a[c][c]) < 1e-14) return [0, 0, 0, 0, 0, 0];
    for (let r = c + 1; r < 6; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 7; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = [0, 0, 0, 0, 0, 0];
  for (let r = 5; r >= 0; r--) {
    let s = a[r][6];
    for (let k = r + 1; k < 6; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Linearised point-to-plane step: minimises sum(((R p + t) - q) . n)^2 for small rotations about the centroid. */
function pointToPlane(P: THREE.Vector3[], Q: THREE.Vector3[], N: THREE.Vector3[]): THREE.Matrix4 {
  const g = new THREE.Vector3();
  for (const p of P) g.add(p);
  g.divideScalar(P.length);
  const M = new Float64Array(36), b = new Float64Array(6), row = new Float64Array(6);
  const d = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    const n = N[i];
    c.crossVectors(d.subVectors(P[i], g), n);
    row[0] = c.x; row[1] = c.y; row[2] = c.z; row[3] = n.x; row[4] = n.y; row[5] = n.z;
    const r = d.subVectors(Q[i], P[i]).dot(n);
    for (let j = 0; j < 6; j++) {
      b[j] += row[j] * r;
      for (let k = 0; k < 6; k++) M[j * 6 + k] += row[j] * row[k];
    }
  }
  const x = solve6(M, b);
  const w = new THREE.Vector3(x[0], x[1], x[2]);
  const angle = w.length();
  const q = angle > 1e-12 ? new THREE.Quaternion().setFromAxisAngle(w.divideScalar(angle), angle) : new THREE.Quaternion();
  // p' = R (p - g) + g + t
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
  return new THREE.Matrix4().makeTranslation(g.x + x[3], g.y + x[4], g.z + x[5]).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-g.x, -g.y, -g.z));
}

/** One ICP iteration: moves `scan` (its world matrix) toward the reference surface. The first iterations use
 *  point-to-point pairs (Horn) to get close, later ones point-to-plane, which converges in far fewer steps.
 *  Returns the RMS distance before the move, in mm. */
export function icpStep(scan: THREE.Object3D, scanPoints: THREE.Vector3[], ref: Prepared, iteration: number): number {
  scan.updateMatrixWorld();
  ref.mesh.updateMatrixWorld();
  _inv.copy(ref.mesh.matrixWorld).invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(ref.mesh.matrixWorld);
  const tPos = ref.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const tIdx = ref.mesh.geometry.getIndex()!;
  const P: THREE.Vector3[] = [], Q: THREE.Vector3[] = [], N: THREE.Vector3[] = [];
  let sum = 0;
  for (const local of scanPoints) {
    const w = local.clone().applyMatrix4(scan.matrixWorld);
    const hit = ref.bvh.closestPointToPoint(w.clone().applyMatrix4(_inv), _hit as never) as typeof _hit | null;
    if (!hit) continue;
    const q = hit.point.clone().applyMatrix4(ref.mesh.matrixWorld);
    const f = hit.faceIndex * 3;
    _a.fromBufferAttribute(tPos, tIdx.getX(f));
    _b.fromBufferAttribute(tPos, tIdx.getX(f + 1));
    _c.fromBufferAttribute(tPos, tIdx.getX(f + 2));
    const n = new THREE.Vector3().subVectors(_c, _b).cross(_cp.subVectors(_a, _b)).applyMatrix3(normalMatrix).normalize();
    sum += hit.distance * hit.distance;
    P.push(w); Q.push(q); N.push(n);
  }
  const step = iteration < 2 ? bestRigid(P, Q) : pointToPlane(P, Q, N);
  scan.matrix.premultiply(step);
  scan.matrix.decompose(scan.position, scan.quaternion, scan.scale);
  return Math.sqrt(sum / Math.max(1, P.length));
}
