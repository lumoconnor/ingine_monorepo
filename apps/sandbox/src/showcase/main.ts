import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CharacterSpec } from '@ingine/engine/render/painterly/character';
import { registerCharacters, prebuildCharacters, spawnCharacter, characterStats } from '@ingine/engine/render/painterly/characters';
import { painterlyMaterial, setPainterlyLook, defaultLook } from '@ingine/engine/render/painterly/PainterlyMaterial';
import { PainterlyPost } from '@ingine/engine/render/painterly/PainterlyPost';
import specs from '../content/characters.json';

/**
 * Character showcase: every sandbox character in the painterly style on a
 * neutral stage, under lighting moods from different kinds of setting.
 * URL options: ?light=day|dusk|lamp|overcast  &view=lineup|<id>|<id>-face
 *              &post=0|1  &walk=1  &turn=1
 */

const params = new URLSearchParams(location.search);
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, container.clientWidth / container.clientHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 40 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.01;
const lamp = new THREE.PointLight(0xffa860, 0, 12, 1.6);
lamp.castShadow = true;
lamp.shadow.mapSize.set(1024, 1024);
scene.add(hemi, sun, sun.target, lamp);

// Stage: a painted floor and a soft backdrop gradient.
const floorMat = painterlyMaterial({ color: 0x8a8068, space: 'world', brush: 1 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function gradient(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Mood {
  sky: [string, string];
  hemi: [number, number, number];
  sun: [number, number];
  sunDir: [number, number, number];
  lamp?: number;
  floor: number;
  rim: number;
  rimColor: number;
  exposure: number;
}

/** Lighting moods for different settings: the same characters have to hold up in all of them. */
const moods: Record<string, Mood> = {
  day: { sky: ['#9fb8cc', '#d9d0bb'], hemi: [0xbfd4ea, 0x6a5a40, 1.25], sun: [0xffe6c4, 2.8], sunDir: [6, 6, 2.5], floor: 0x8a8068, rim: 0.22, rimColor: 0xcfe0ff, exposure: 1.0 },
  dusk: { sky: ['#3a3f63', '#d98a5a'], hemi: [0x6a6aa0, 0x5a3a2a, 1.0], sun: [0xff9a5a, 2.8], sunDir: [-6, 2.2, 3], floor: 0x7a6656, rim: 0.35, rimColor: 0xa0a0ff, exposure: 1.05 },
  lamp: { sky: ['#14161c', '#2a2420'], hemi: [0x34405a, 0x1a1410, 0.6], sun: [0x8aa0d0, 0.35], sunDir: [-3, 6, -4], lamp: 22, floor: 0x5a5046, rim: 0.3, rimColor: 0x7088c0, exposure: 1.15 },
  overcast: { sky: ['#8e9698', '#b5b2a6'], hemi: [0xc8d0d0, 0x5a584a, 1.7], sun: [0xe8ecf0, 0.9], sunDir: [2, 8, 3], floor: 0x7c7a6c, rim: 0.18, rimColor: 0xd8e0e0, exposure: 1.0 },
};

function setMood(name: string): void {
  const m = moods[name] ?? moods.day;
  scene.background = gradient(m.sky[0], m.sky[1]);
  hemi.color.setHex(m.hemi[0]);
  hemi.groundColor.setHex(m.hemi[1]);
  hemi.intensity = m.hemi[2];
  sun.color.setHex(m.sun[0]);
  sun.intensity = m.sun[1];
  sun.position.set(...m.sunDir).multiplyScalar(2);
  lamp.intensity = m.lamp ?? 0;
  lamp.position.set(1.2, 2.3, 2.2);
  floorMat.color.setHex(m.floor);
  renderer.toneMappingExposure = m.exposure;
  setPainterlyLook({ ...defaultLook(), rim: m.rim, rimColor: new THREE.Color(m.rimColor) });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mood]')) b.classList.toggle('on', b.dataset.mood === name);
}

// Characters.
const order = ['bram', 'tess', 'mira', 'bandit', 'marksman'];
const built: Record<string, { root: THREE.Object3D; bones: Map<string, THREE.Object3D> }> = {};
const statsLines: string[] = [];
const spacing = 0.95;
registerCharacters(specs as Record<string, CharacterSpec>);
const tBuild = performance.now();
await prebuildCharacters(order);
statsLines.push(`all characters sculpted in ${Math.round(performance.now() - tBuild)} ms (parallel workers)`);
order.forEach((id, i) => {
  const c = spawnCharacter(id);
  const bones = new Map<string, THREE.Object3D>();
  c.root.traverse((o) => o.name && bones.set(o.name, o));
  built[id] = { root: c.root, bones };
  c.root.position.x = (i - (order.length - 1) / 2) * spacing;
  c.root.rotation.y = (i - (order.length - 1) / 2) * -0.12;
  scene.add(c.root);
  const st = characterStats(id);
  const verts = st.reduce((s, p) => s + p.verts, 0);
  const tris = st.reduce((s, p) => s + p.tris, 0);
  statsLines.push(`${id.padEnd(9)} ${verts} verts  ${tris} tris  (${st.map((p) => `${p.piece} ${p.ms}ms`).join(', ')})`);
});
document.getElementById('stats')!.textContent = statsLines.join('\n');
console.log(statsLines.join('\n'));

// Camera framings.
function frame(view: string): void {
  const [id, part] = view.split('-');
  const c = built[id];
  if (!c) {
    camera.position.set(0, 1.35, 7.6);
    controls.target.set(0, 0.95, 0);
  } else {
    const head = c.bones.get('head')!;
    const p = new THREE.Vector3();
    head.getWorldPosition(p);
    const yaw = c.root.rotation.y;
    if (part === 'face') {
      const d = 0.75;
      camera.position.set(p.x + Math.sin(yaw + 0.35) * d, p.y + 0.12, p.z + Math.cos(yaw + 0.35) * d);
      controls.target.set(p.x, p.y + 0.07, p.z);
    } else {
      const d = 3.1;
      camera.position.set(c.root.position.x + Math.sin(yaw + 0.3) * d, 1.2, Math.cos(yaw + 0.3) * d);
      controls.target.set(c.root.position.x, 0.92, 0);
    }
  }
  controls.update();
}

// Post filter.
const post = new PainterlyPost(renderer, scene, camera);
post.enabled = params.get('post') !== '0';

// UI.
const ui = document.getElementById('ui')!;
const button = (label: string, on: () => void, data?: Record<string, string>) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = on;
  if (data) Object.assign(b.dataset, data);
  ui.appendChild(b);
  return b;
};
for (const m of Object.keys(moods)) button(m, () => setMood(m), { mood: m });
const postBtn = button('paint filter', () => {
  post.enabled = !post.enabled;
  postBtn.classList.toggle('on', post.enabled);
});
postBtn.classList.toggle('on', post.enabled);
let walking = params.get('walk') === '1';
const walkBtn = button('walk', () => {
  walking = !walking;
  walkBtn.classList.toggle('on', walking);
});
walkBtn.classList.toggle('on', walking);
button('lineup', () => frame('lineup'));
for (const id of order) button(id, () => frame(`${id}-face`));

setMood(params.get('light') ?? 'day');
frame(params.get('view') ?? 'lineup');

// Idle breathing and an optional walk, to show the skinning holds up.
const timer = new THREE.Timer();
let t = Number(params.get('t') ?? 0);
const maxFrames = Number(params.get('frames') ?? Infinity);
let frames = 0;
function animate(): void {
  timer.update();
  const dt = maxFrames < Infinity ? 1 / 30 : Math.min(timer.getDelta(), 0.05);
  t += dt;
  order.forEach((id, i) => {
    const b = built[id].bones;
    const ph = t * 1.6 + i;
    const sw = walking ? Math.sin(t * 5 + i) * 0.55 : 0;
    b.get('chest')!.rotation.x = Math.sin(ph) * 0.015;
    b.get('arm_l')!.rotation.set(-sw * 0.6 + Math.sin(ph) * 0.02, 0, 0.06);
    b.get('arm_r')!.rotation.set(sw * 0.6 + Math.sin(ph) * 0.02, 0, -0.06);
    b.get('forearm_l')!.rotation.x = -0.12 - Math.max(0, sw) * 0.4;
    b.get('forearm_r')!.rotation.x = -0.12 - Math.max(0, -sw) * 0.4;
    b.get('leg_l')!.rotation.x = sw;
    b.get('leg_r')!.rotation.x = -sw;
    b.get('shin_l')!.rotation.x = Math.max(0, sw) * 0.7;
    b.get('shin_r')!.rotation.x = Math.max(0, -sw) * 0.7;
    b.get('head')!.rotation.y = Math.sin(ph * 0.3) * 0.15;
    if (params.get('turn') === '1') built[id].root.rotation.y += dt * 0.4;
  });
  controls.update();
  if (post.enabled) post.render();
  else renderer.render(scene, camera);
  if (++frames < maxFrames) requestAnimationFrame(animate);
  else Object.assign(window, { __done: true });
}
animate();
addEventListener('resize', () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  post.setSize(container.clientWidth, container.clientHeight);
});
Object.assign(window, { built, scene, camera, controls, setMood, frame, post, __ready: true });
