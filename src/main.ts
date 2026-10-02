import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeMolar } from './tooth';
import { prepare, signedDistances, paint, clearPaint, icpStep, type Prepared } from './geometry';
import { bentPath, retime, type Pose } from './staging';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const deg = THREE.MathUtils.degToRad;

// ---------- scene ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#eceee9');
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 600);
camera.position.set(11, 24, 25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(5.5, 3.5, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight('#ffffff', '#b8b2a6', 1.15));
const key = new THREE.DirectionalLight('#ffffff', 1.7);
key.position.set(12, 26, 20);
scene.add(key);
const rim = new THREE.DirectionalLight('#dde7ff', 0.65);
rim.position.set(-16, 9, -22);
scene.add(rim);

const legend = document.createElement('div');
legend.className = 'legend';
legend.innerHTML = '<span><i style="background:#d9363e"></i>Overlap</span><span><i style="background:#f2a33a"></i>Contact &lt; 0.1 mm</span><span><i style="background:#7fb7d9"></i>Within 0.6 mm</span>';
view.appendChild(legend);

// The framing is tuned for a landscape view; narrower views pull the camera back so both teeth stay in frame.
const framed = { target: new THREE.Vector3(), offset: new THREE.Vector3() };
function applyFraming() {
  const k = Math.max(1, 1.2 / camera.aspect);
  controls.target.copy(framed.target);
  camera.position.copy(framed.target).addScaledVector(framed.offset, k);
}
new ResizeObserver(() => {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  applyFraming();
}).observe(view);

const material = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
const IVORY_A = new THREE.Color('#efe7d7');
const IVORY_B = new THREE.Color('#e8e2d6');

function centred(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

let A: Prepared = prepare(new THREE.Mesh(centred(makeMolar(0)), material()), IVORY_A);
let B: Prepared = prepare(new THREE.Mesh(centred(makeMolar(1)), material()), IVORY_B);
scene.add(A.mesh, B.mesh);
let baseX = 0; // B's x position where the bounding boxes just touch
let sdA = new Float32Array(0), sdB = new Float32Array(0);

function layout() {
  const a = A.mesh.geometry.boundingBox!, b = B.mesh.geometry.boundingBox!;
  baseX = a.max.x - b.min.x;
  sdA = new Float32Array(A.mesh.geometry.getAttribute('position').count);
  sdB = new Float32Array(B.mesh.geometry.getAttribute('position').count);
}
layout();

/** Buccal view for contacts and registration, an oblique occlusal view for staging (the movement is in the occlusal plane). */
function frame(m: Mode) {
  const a = A.mesh.geometry.boundingBox!;
  const h = a.max.y - a.min.y;
  if (m === 'stages') {
    framed.target.set(baseX / 2 + 0.6, a.max.y - h * 0.2, -2.4);
    framed.offset.set(baseX / 2 + 2, a.max.y + 24, 25).sub(framed.target);
  } else {
    framed.target.set(baseX / 2, a.min.y + h * 0.68, 0);
    framed.offset.set(baseX / 2 + 3, a.min.y + h * 2.0, 34).sub(framed.target);
  }
  applyFraming();
}

// ---------- contacts ----------
const gapEl = $<HTMLInputElement>('gap'), rotEl = $<HTMLInputElement>('rot'), tipEl = $<HTMLInputElement>('tip'), openEl = $<HTMLInputElement>('open');
const fmt = (mm: number) => `${mm.toFixed(2)} mm`;

function resetA() {
  A.mesh.position.set(0, 0, 0);
  A.mesh.rotation.set(0, 0, 0);
}

function contactPose(gap: number, rot: number, tip: number) {
  resetA();
  B.mesh.position.set(baseX + gap, 0, 0);
  B.mesh.rotation.set(0, deg(rot), deg(tip));
}

function analyse() {
  const t0 = performance.now();
  signedDistances(A, B, sdA);
  signedDistances(B, A, sdB);
  const ms = performance.now() - t0;
  const ra = paint(A, sdA), rb = paint(B, sdB);
  return { minD: Math.min(ra.minD, rb.minD), contact: (ra.contactArea + rb.contactArea) / 2, pen: (ra.penArea + rb.penArea) / 2, ms };
}

let pending = false;
function updateContacts() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (mode !== 'contacts') return; // the tab changed before this frame
    $('gapOut').textContent = fmt(+gapEl.value);
    $('rotOut').textContent = `${(+rotEl.value).toFixed(1)}°`;
    $('tipOut').textContent = `${(+tipEl.value).toFixed(1)}°`;
    contactPose(+gapEl.value, +rotEl.value, +tipEl.value);
    const r = analyse();
    $('sMin').textContent = r.minD < 0 ? `${fmt(-r.minD)} overlap` : `${fmt(r.minD)} gap`;
    $('sContact').textContent = `${r.contact.toFixed(2)} mm²`;
    $('sPen').textContent = `${r.pen.toFixed(2)} mm²`;
    const verts = sdA.length + sdB.length;
    $('sTime').textContent = `${r.ms.toFixed(0)} ms / ${(verts / 1000).toFixed(0)}k pts`;
    markDeepest();
    if (openEl.checked) {
      hitMark.visible = false;
      hitTag.hidden = true;
      // distances were measured at the real pose; now turn each proximal face toward the camera
      A.mesh.position.set(-2.5, 0, 0);
      A.mesh.rotation.set(0, deg(-90), 0);
      B.mesh.position.set(baseX + 2.5, 0, 0);
      B.mesh.rotation.set(0, deg(90), 0);
    }
  });
}
for (const el of [gapEl, rotEl, tipEl, openEl]) el.addEventListener('input', updateContacts);

// ---------- registration ----------
let scan: THREE.Points | null = null;
let scanSample: THREE.Vector3[] = [];
const chart = $('chart') as unknown as SVGSVGElement;
let icpRunning = false;

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function newScan() {
  if (scan) { scene.remove(scan); scan.geometry.dispose(); }
  const pos = A.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const bb = A.mesh.geometry.boundingBox!;
  const cropY = bb.min.y + (bb.max.y - bb.min.y) * 0.58; // crown only, like an intraoral scan
  const pts: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < cropY || Math.random() > 0.6) continue;
    pts.push(pos.getX(i) + gauss() * 0.03, pos.getY(i) + gauss() * 0.03, pos.getZ(i) + gauss() * 0.03);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scan = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#0e7c86', size: 0.13, sizeAttenuation: true }));
  const axis = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
  scan.quaternion.setFromAxisAngle(axis, deg(10 + Math.random() * 8));
  scan.position.set(gauss(), gauss() * 0.6, gauss()).normalize().multiplyScalar(1.6 + Math.random() * 1.2);
  scene.add(scan);
  const all: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length; i += 3) all.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  scanSample = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 1500)) === 0);
  chart.innerHTML = '';
  report(null, 0);
}

function report(rms: number | null, it: number) {
  if (!scan) return;
  $('rRms').textContent = rms === null ? '-' : `${(rms * 1000).toFixed(0)} µm`;
  $('rIt').textContent = String(it);
  const ang = 2 * Math.acos(Math.min(1, Math.abs(scan.quaternion.w)));
  $('rRot').textContent = `${THREE.MathUtils.radToDeg(ang).toFixed(2)}°`;
  $('rTr').textContent = fmt(scan.position.length());
}

function drawChart(values: number[]) {
  const max = Math.max(...values, 0.05);
  const pts = values.map((v, i) => `${10 + (i / Math.max(1, values.length - 1)) * 280},${100 - (v / max) * 88}`).join(' ');
  chart.innerHTML = `<polyline points="${pts}" fill="none" stroke="#0e7c86" stroke-width="2"/><text x="10" y="12" font-size="10" fill="#676a71">RMS ${(max * 1000).toFixed(0)} µm</text>`;
}

function runIcp() {
  if (!scan || icpRunning) return;
  icpRunning = true;
  ($('runIcp') as HTMLButtonElement).disabled = true;
  const history: number[] = [];
  let it = 0;
  const step = () => {
    const rms = icpStep(scan!, scanSample, A, it);
    history.push(rms);
    it++;
    drawChart(history);
    report(rms, it);
    const done = it >= 60 || (history.length > 3 && Math.abs(history[history.length - 2] - rms) < 2e-6);
    if (!done) setTimeout(() => requestAnimationFrame(step), 140);
    else { icpRunning = false; ($('runIcp') as HTMLButtonElement).disabled = false; }
  };
  step();
}
$('newScan').addEventListener('click', () => { if (!icpRunning) newScan(); });
$('runIcp').addEventListener('click', runIcp);

// ---------- staging ----------
type Stage = { pose: Pose; gap: number }; // gap: smallest signed distance between the teeth, negative = overlap
type PlanKind = 'straight' | 'aware';
const HIT_MM = 0.05;
const ARCH = new THREE.Vector3(1, 0, 0); // B sits on +x of A, so +x points away from the neighbour
const plans: Partial<Record<PlanKind, Stage[]>> = {};
let planKind: PlanKind = 'straight';
let planToken = 0;
let stages: Stage[] = [];
const stageEl = $<HTMLInputElement>('stage');
let playTimer = 0;

// The target is drawn as the dashed outline of B's widest crown contour, lifted above the cusps; the path as
// the crown centre at every stage. Both draw on top so the crowns never hide them.
const overlay = { depthTest: false, transparent: true };
const ghost = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#0e7c86', dashSize: 0.45, gapSize: 0.3, ...overlay }));
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#0e7c86', ...overlay }));
const pathDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#0e7c86', size: 0.36, ...overlay }));
ghost.renderOrder = pathLine.renderOrder = pathDots.renderOrder = 2;
scene.add(ghost, pathLine, pathDots);
// Marks the deepest point of an overlap, which is otherwise hidden inside the other crown.
const hitMark = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshBasicMaterial({ color: '#d9363e', ...overlay }));
hitMark.renderOrder = 3;
hitMark.visible = false;
scene.add(hitMark);
const hitTag = document.createElement('div');
hitTag.className = 'tag';
hitTag.hidden = true;
view.appendChild(hitTag);

function markDeepest() {
  let depth = HIT_MM, at: THREE.Vector3 | null = null;
  for (const [p, sd] of [[A, sdA], [B, sdB]] as const) {
    const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sd.length; i++) {
      if (-sd[i] > depth) { depth = -sd[i]; at = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(p.mesh.matrixWorld); }
    }
  }
  hitMark.visible = !!at;
  hitTag.hidden = !at;
  if (at) {
    hitMark.position.copy(at);
    hitTag.textContent = `${depth.toFixed(2)} mm overlap`;
  }
}

function crownOutline(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const bb = geo.boundingBox!;
  const bins = 160, best = new Float32Array(bins), pts: (THREE.Vector3 | null)[] = new Array(bins).fill(null);
  const crownFrom = bb.max.y - (bb.max.y - bb.min.y) * 0.45;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < crownFrom) continue;
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const b = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * bins) % bins;
    if (r > best[b]) { best[b] = r; pts[b] = new THREE.Vector3(x, bb.max.y + 0.15, z); }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts.filter((p): p is THREE.Vector3 => !!p));
  ghost.geometry.dispose();
  ghost.geometry = g;
  ghost.computeLineDistances();
}
crownOutline(B.mesh.geometry);

const tick = () => new Promise(r => setTimeout(r, 0));

function startPose(): Pose {
  return { p: new THREE.Vector3(baseX - 0.8, 0, -5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(30), 0)) };
}
function targetPose(): Pose {
  return { p: new THREE.Vector3(baseX, 0, 0), q: new THREE.Quaternion() };
}

function place(pose: Pose) {
  B.mesh.position.copy(pose.p);
  B.mesh.quaternion.copy(pose.q);
}
/** Deepest point of B inside A (cheap, one direction). */
function gapOneWay(pose: Pose) {
  place(pose);
  signedDistances(B, A, sdB);
  let m = Infinity;
  for (let i = 0; i < sdB.length; i++) if (sdB[i] < m) m = sdB[i];
  return m;
}
function gapBothWays(pose: Pose) {
  let m = gapOneWay(pose);
  signedDistances(A, B, sdA);
  for (let i = 0; i < sdA.length; i++) if (sdA[i] < m) m = sdA[i];
  return m;
}

async function measure(poses: Pose[], token: number): Promise<Stage[] | null> {
  const out: Stage[] = [];
  for (let k = 0; k < poses.length; k++) {
    out.push({ pose: poses[k], gap: gapBothWays(poses[k]) });
    if (k % 3 === 2) { await tick(); if (token !== planToken) return null; }
  }
  return out;
}

async function planStages() {
  const token = ++planToken;
  resetA();
  for (const k of Object.keys(plans)) delete plans[k as PlanKind];
  const start = startPose(), target = targetPose();
  ghost.position.copy(target.p);
  ghost.quaternion.copy(target.q);
  setPlanBusy(true, 'Checking the straight-line plan…');
  const straight = await measure(retime([start, target]), token);
  if (!straight) return;
  plans.straight = straight;
  if (planKind === 'straight') showPlan();
  setPlanBusy(true, planKind === 'straight' ? '' : 'Bending the path around the neighbour…');
  const bent = await bentPath(start, target, gapOneWay, ARCH, () => token !== planToken);
  const aware = bent && (await measure(bent, token));
  if (!aware) return;
  plans.aware = aware;
  setPlanBusy(false, '');
  showPlan();
}

function setPlanBusy(busy: boolean, msg: string) {
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => (b.disabled = busy && b.dataset.plan === 'aware'));
  if (msg) { $('planNote').textContent = msg; $('planNote').className = 'note'; }
}

function describe(kind: PlanKind, st: Stage[]) {
  const n = st.length - 1;
  const hits = st.map((s, k) => (s.gap < -HIT_MM ? k : -1)).filter(k => k >= 0);
  const more = plans.straight ? n - (plans.straight.length - 1) : 0;
  const extra = kind !== 'aware' || !plans.straight ? '' : more > 0 ? ` (${more} more than the straight line)` : ' (as many as the straight line)';
  if (!hits.length) {
    const how = kind === 'aware' ? ' Colliding samples were pushed out along the arch, then the path was re-timed to the step limits.' : '';
    return { bad: false, text: `${n} stages${extra}.${how} Every stage clears its neighbour, so no IPR is needed.` };
  }
  const worst = Math.max(...st.map(s => -s.gap));
  const ipr = Math.ceil(worst * 10) / 10;
  return { bad: true, text: `${n} stages${extra}. Stages ${hits[0]}–${hits[hits.length - 1]} drive the tooth through its neighbour, up to ${worst.toFixed(2)} mm deep. Staged this way the case needs ${ipr.toFixed(1)} mm of IPR.` };
}

function showPlan() {
  const st = plans[planKind];
  if (!st) return;
  stages = st;
  clearInterval(playTimer);
  const n = st.length - 1;
  stageEl.max = String(n);
  stageEl.value = '0';
  const d = describe(planKind, st);
  $('planNote').textContent = d.text;
  $('planNote').className = `note ${d.bad ? 'bad' : 'good'}`;
  $('stageList').innerHTML = st.map((s, k) => {
    const label = k === 0 ? 'Start' : k === n ? 'Target' : `Stage ${k}`;
    const hit = s.gap < -HIT_MM;
    const state = hit ? `overlap ${(-s.gap).toFixed(2)} mm` : `${s.gap < 0.1 ? 'contact' : 'clear'}, ${Math.max(0, s.gap).toFixed(2)} mm`;
    return `<li class="${hit ? 'ipr' : ''}" value="${k}">${label}: ${state}</li>`;
  }).join('');
  // the path of the crown centre, one dot per stage
  const top = B.mesh.geometry.boundingBox!.max.y + 0.15;
  const pts = st.map(s => new THREE.Vector3(0, top, 0).applyQuaternion(s.pose.q).add(s.pose.p));
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  pathDots.geometry.dispose();
  pathDots.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  showStage(0);
}

function showStage(k: number) {
  const s = stages[k];
  if (!s) return;
  place(s.pose);
  analyse();
  markDeepest();
  let moved = 0;
  for (let i = 1; i <= k; i++) moved += stages[i].pose.p.distanceTo(stages[i - 1].pose.p);
  const turned = THREE.MathUtils.radToDeg(s.pose.q.angleTo(stages[0].pose.q));
  $('stageLabel').textContent = `${k} of ${stages.length - 1} · ${moved.toFixed(2)} mm, ${turned.toFixed(1)}°`;
  const list = $('stageList');
  [...list.children].forEach((li, i) => li.classList.toggle('now', i === k));
  const now = list.children[k] as HTMLElement | undefined;
  if (now) list.scrollTop = now.offsetTop - list.offsetTop - list.clientHeight / 2;
}
stageEl.addEventListener('input', () => { clearInterval(playTimer); showStage(+stageEl.value); });
$('play').addEventListener('click', () => {
  clearInterval(playTimer);
  let k = 0;
  stageEl.value = '0';
  showStage(0);
  playTimer = window.setInterval(() => {
    k++;
    if (k >= stages.length) { clearInterval(playTimer); return; }
    stageEl.value = String(k);
    showStage(k);
  }, 360);
});
document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(b => b.addEventListener('click', () => {
  planKind = b.dataset.plan as PlanKind;
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach(o => o.setAttribute('aria-checked', String(o === b)));
  showPlan();
}));

// ---------- modes ----------
type Mode = 'contacts' | 'register' | 'stages';
let mode: Mode = 'contacts';
function setMode(m: Mode) {
  const changed = m !== mode;
  mode = m;
  clearInterval(playTimer);
  planToken++;
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  document.querySelectorAll<HTMLElement>('.panel').forEach(p => (p.hidden = p.dataset.panel !== m));
  B.mesh.visible = m !== 'register';
  ghost.visible = pathLine.visible = pathDots.visible = m === 'stages';
  hitMark.visible = false;
  hitTag.hidden = true;
  legend.style.display = m === 'register' ? 'none' : '';
  if (scan) scan.visible = m === 'register';
  if (changed) frame(m);
  if (m === 'contacts') updateContacts();
  if (m === 'register') { resetA(); clearPaint(A); if (!scan) newScan(); }
  if (m === 'stages') planStages();
}
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));

// ---------- your own STL ----------
const loader = new STLLoader();
async function load(file: File, which: 'A' | 'B') {
  let geo = loader.parse(await file.arrayBuffer());
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  centred(geo);
  const old = which === 'A' ? A : B;
  old.mesh.geometry.dispose();
  const mesh = new THREE.Mesh(geo, old.mesh.material);
  scene.remove(old.mesh);
  const prepared = prepare(mesh, which === 'A' ? IVORY_A : IVORY_B);
  if (which === 'A') A = prepared; else B = prepared;
  scene.add(mesh);
  layout();
  crownOutline(B.mesh.geometry);
  frame(mode);
  if (scan) { scene.remove(scan); scan = null; }
  setMode(mode);
}
$<HTMLInputElement>('fileA').addEventListener('change', e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f, 'A'); });
$<HTMLInputElement>('fileB').addEventListener('change', e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f, 'B'); });

frame('contacts');
setMode('contacts');
const _tag = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (hitMark.visible) {
    _tag.copy(hitMark.position).project(camera);
    hitTag.style.transform = `translate(${(_tag.x * 0.5 + 0.5) * view.clientWidth + 14}px, ${(-_tag.y * 0.5 + 0.5) * view.clientHeight - 30}px)`;
  }
});
