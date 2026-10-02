import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bentPath, retime, STEP_DEG, STEP_MM, type Pose } from '../src/staging';

const pose = (x: number, z: number, yaw = 0): Pose => ({
  p: new THREE.Vector3(x, 0, z),
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
});

function expectWithinLimits(stages: Pose[]) {
  for (let k = 1; k < stages.length; k++) {
    expect(stages[k].p.distanceTo(stages[k - 1].p)).toBeLessThanOrEqual(STEP_MM + 1e-9);
    expect(THREE.MathUtils.radToDeg(stages[k].q.angleTo(stages[k - 1].q))).toBeLessThanOrEqual(STEP_DEG + 1e-6);
  }
}

describe('retime', () => {
  it('splits a combined move so no stage exceeds either limit', () => {
    const start = pose(0, -5, THREE.MathUtils.degToRad(30));
    const target = pose(0.8, 0);
    const stages = retime([start, target]);
    expectWithinLimits(stages);
    expect(stages.length - 1).toBe(Math.ceil(start.p.distanceTo(target.p) / STEP_MM));
    expect(stages[0].p.distanceTo(start.p)).toBeLessThan(1e-9);
    expect(stages[stages.length - 1].p.distanceTo(target.p)).toBeLessThan(1e-9);
  });
});

describe('bentPath', () => {
  // A neighbour whose surface bulges toward the path at z = 0; the straight path cuts 0.35 mm into it.
  const gapAt = (s: Pose) => s.p.x - 0.4 * Math.exp(-(s.p.z ** 2) / 2);
  const start = pose(0.05, -4);
  const target = pose(0.05, 4);

  it('starts from a straight path that collides', () => {
    expect(Math.min(...retime([start, target]).map(gapAt))).toBeLessThan(-0.3);
  });

  it('bends around the neighbour and keeps the step limits', async () => {
    const stages = (await bentPath(start, target, gapAt, new THREE.Vector3(1, 0, 0)))!;
    expect(Math.min(...stages.map(gapAt))).toBeGreaterThan(0);
    expectWithinLimits(stages);
    expect(stages[0].p.distanceTo(start.p)).toBeLessThan(1e-9);
    expect(stages[stages.length - 1].p.distanceTo(target.p)).toBeLessThan(1e-9);
  });

  it('stops when cancelled', async () => {
    expect(await bentPath(start, target, gapAt, new THREE.Vector3(1, 0, 0), () => true)).toBeNull();
  });
});
