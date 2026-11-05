import * as THREE from 'three';
import { Items } from './catalog';
import { buildItemModel } from './models';

/**
 * Inventory icons rendered from the items' own 3D models (so no art is
 * needed and icons always match the world). Rendered once, on first use,
 * with a small offscreen renderer, and cached as data URLs.
 */
const SIZE = 128;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

function setup(): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

export function itemIcon(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    if (!renderer) setup();
    const obj = buildItemModel(Items[id].model);
    scene.add(obj);
    // Frame the model from above at an angle, filling the icon.
    _box.setFromObject(obj);
    _box.getSize(_size);
    _box.getCenter(_center);
    const radius = Math.max(_size.length() / 2, 0.02);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
    camera.position.copy(_center).add(new THREE.Vector3(0.45, 1, 0.75).normalize().multiplyScalar(dist));
    camera.lookAt(_center);
    renderer!.render(scene, camera);
    const url = renderer!.domElement.toDataURL('image/png');
    scene.remove(obj);
    obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    cache.set(id, url);
    return url;
  } catch {
    return '';
  }
}
