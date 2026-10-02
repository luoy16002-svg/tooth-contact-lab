// Aligner-style staging: every stage may move a tooth at most STEP_MM and turn it at most STEP_DEG.
import * as THREE from 'three';

export type Pose = { p: THREE.Vector3; q: THREE.Quaternion };

export const STEP_MM = 0.25;
export const STEP_DEG = 2;

export const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({ p: a.p.clone().lerp(b.p, t), q: a.q.clone().slerp(b.q, t) });

/** How many stages a move needs on its own: the larger of the translation and rotation budgets. */
export const stepCost = (a: Pose, b: Pose) =>
  Math.max(a.p.distanceTo(b.p) / STEP_MM, THREE.MathUtils.radToDeg(a.q.angleTo(b.q)) / STEP_DEG);

/** Cuts a polyline of poses into the fewest stages that respect both step limits. Because the cost of a chord is
 *  never more than the cost of the polyline it spans, no stage can exceed either limit. */
export function retime(path: Pose[]): Pose[] {
  const cum = [0];
  for (let j = 1; j < path.length; j++) cum.push(cum[j - 1] + stepCost(path[j - 1], path[j]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(total - 1e-6));
  const out: Pose[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const c = (k / n) * total;
    while (j < path.length - 2 && cum[j + 1] < c) j++;
    const span = cum[j + 1] - cum[j];
    out.push(lerpPose(path[j], path[j + 1], span > 0 ? (c - cum[j]) / span : 0));
  }
  return out;
}

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Collision-aware path. Samples the straight path three times per stage, pushes every colliding sample along
 * `away` (a unit vector pointing from the neighbour) until it clears, then re-times the bent path to the step
 * limits. `gapAt` returns the smallest signed distance to the neighbour, negative when they overlap.
 * Yields to the event loop every few samples; returns null if `cancelled()` turns true meanwhile.
 */
export async function bentPath(
  start: Pose,
  target: Pose,
  gapAt: (pose: Pose) => number,
  away: THREE.Vector3,
  cancelled: () => boolean = () => false,
): Promise<Pose[] | null> {
  const m = Math.ceil(stepCost(start, target)) * 3;
  const path: Pose[] = [];
  for (let j = 0; j <= m; j++) {
    const pose = lerpPose(start, target, j / m);
    if (j > 0 && j < m) {
      for (let it = 0; it < 6; it++) {
        const g = gapAt(pose);
        if (g >= -0.005) break;
        pose.p.addScaledVector(away, -g + 0.03);
      }
    }
    path.push(pose);
    if (j % 4 === 3) {
      await tick();
      if (cancelled()) return null;
    }
  }
  return retime(path);
}
