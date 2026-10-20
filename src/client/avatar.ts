// Criação de personagem (pedido do Fernando, 19/10): 7 peças misturando os 9 bonecos, com prévia 3D girando. Salva neste navegador
// e avisa a sala pelo evento 'warlock:look' (main.ts manda ao servidor, que vale até no meio da partida).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS, LOOK_PARTS, isCharacter, isLook, lookOf, randomLook, type Piece } from '../shared/characters.ts';
import { t } from './i18n.ts';
import { el } from './icons.ts';
import { loadFile, loadLook, lookModel } from './scene.ts';
import { store } from './store.ts';

// ?as=nome (várias abas na mesma máquina) também separa a aparência, como o apelido e o personagem em main.ts
const as = new URLSearchParams(location.search).get('as')?.replace(/[^a-z0-9]/gi, '').slice(0, 12) ?? '';
export const LOOK_KEY = 'warlock:look' + (as && ':' + as);
const CHAR_KEY = 'warlock:char' + (as && ':' + as);
export const LOOK_EVENT = 'warlock:look';

// a salva; sem ela, a do personagem pronto escolhido antes; sem nada, o mago
export function savedLook(): string {
  const look = store.get(LOOK_KEY);
  if (isLook(look)) return look;
  const c = store.get(CHAR_KEY);
  return lookOf(isCharacter(c) ? c : 'mage');
}
// cliques seguidos nas setas: guarda na hora e manda ao servidor só o último, 250 ms depois do último clique
let sendTimer: ReturnType<typeof setTimeout> | undefined;
export function saveLook(look: string) {
  store.set(LOOK_KEY, look);
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => dispatchEvent(new CustomEvent(LOOK_EVENT, { detail: look })), 250);
}

const optName = (o: Piece, part: string) => {
  if (!o) return part === 'hands' ? t('Nada', 'Nothing') : t('Nenhum', 'None');
  const c = CHARACTERS.find((x) => x.id === o.from)!;
  return o.name ? t(o.name, o.en!) : t(c.name, c.en);
};

const W = 200, H = 240;
let panel: HTMLElement | null = null;
let look = '';
let sync = () => {};
let running = false;

// um painel só (um contexto WebGL só): as Configurações redesenham as abas a cada mudança e chamam isto de novo
export function avatarPanel(): HTMLElement {
  if (!panel) panel = build();
  sync();
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
  return panel;
}

let renderer: THREE.WebGLRenderer;
let stage: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let shown: { model: THREE.Object3D; mixer: THREE.AnimationMixer } | null = null;
let last = 0;
let scale = 0;
let orbitYaw = 0;
let orbitPitch = 0.04;
let orbitDistance = 4.6;
let cameraTouched = false;
function frame(now: number) {
  // parado enquanto o painel não está na tela; volta na próxima chamada de avatarPanel()
  if (!panel?.isConnected) return void (running = false);
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  if (shown) {
    shown.mixer.update(dt);
    if (!cameraTouched) shown.model.rotation.y += dt * 0.5;
  }
  renderer.render(stage, camera);
  requestAnimationFrame(frame);
}

// boneco da prévia: clone da montagem de scene.ts (geometria e material divididos; nada a descartar)
function show(want: string) {
  void Promise.all([loadLook(want), loadFile('mage')]).then(([, mage]) => {
    const src = lookModel(want);
    if (want !== look || !src) return;
    // mesma escala do jogo: o mago mede 1,9 m (scene.ts)
    if (mage && !scale) scale = 1.9 / new THREE.Box3().setFromObject(mage.scene).getSize(new THREE.Vector3()).y;
    const rot = shown?.model.rotation.y ?? 0.6;
    if (shown) stage.remove(shown.model);
    const model = cloneSkinned(src.scene);
    model.scale.setScalar(scale || 1);
    model.rotation.y = rot;
    stage.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const idle = src.clips.find((c) => c.name === 'Idle');
    if (idle) mixer.clipAction(idle).play();
    shown = { model, mixer };
  });
}

function build(): HTMLElement {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage = new THREE.Scene();
  stage.add(new THREE.HemisphereLight('#fff4e0', '#3a2a22', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.4);
  sun.position.set(2, 4, 3);
  stage.add(sun);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  const aimCamera = () => {
    const targetY = 0.95;
    camera.position.set(orbitDistance * Math.sin(orbitYaw) * Math.cos(orbitPitch), targetY + orbitDistance * Math.sin(orbitPitch), orbitDistance * Math.cos(orbitYaw) * Math.cos(orbitPitch));
    camera.lookAt(0, targetY, 0);
  };
  aimCamera();
  let drag: { id: number; x: number; y: number } | null = null;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', t('Prévia 3D do personagem. Arraste para mover a câmera e use a roda do mouse para aproximar.', '3D character preview. Drag to move the camera and use the mouse wheel to zoom.'));
  renderer.domElement.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (dx || dy) cameraTouched = true;
    orbitYaw -= dx * 0.008;
    orbitPitch = Math.max(-0.45, Math.min(0.75, orbitPitch + dy * 0.008));
    aimCamera();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    renderer.domElement.style.cursor = 'grab';
  };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbitDistance = Math.max(2.8, Math.min(8, orbitDistance * Math.exp(e.deltaY * 0.001)));
    cameraTouched = true;
    aimCamera();
  }, { passive: false });

  const names = LOOK_PARTS.map(() => el('b', { class: 'avatar-name' }));
  const set = (next: string) => {
    if (next === look) return;
    saveLook(next);
    sync();
  };
  const step = (i: number, d: number) => {
    const n = LOOK_PARTS[i].opts.length;
    set(look.slice(0, i) + ((Number(look[i]) + d + n) % n) + look.slice(i + 1));
  };
  const rows = LOOK_PARTS.map((p, i) => el('div', { class: 'keys-row' }, el('span', {}, t(p.name, p.en)),
    el('span', { class: 'avatar-pick' },
      el('button', { type: 'button', class: 'icon', 'aria-label': t(`${p.name}: anterior`, `${p.en}: previous`), onclick: () => step(i, -1) }, '‹'),
      names[i],
      el('button', { type: 'button', class: 'icon', 'aria-label': t(`${p.name}: próxima`, `${p.en}: next`), onclick: () => step(i, 1) }, '›'))));
  // os 9 bonecos originais como atalho: um clique monta o boneco inteiro (Fernando, 19/10)
  const presets = CHARACTERS.map((c) => el('button', { type: 'button', class: 'avatar-preset', title: t(c.name, c.en), 'aria-label': t(c.name, c.en), onclick: () => set(lookOf(c.id)) },
    el('img', { src: `/chars/${c.id}.webp`, alt: '', width: 48, height: 64 })));
  sync = () => {
    const now = look;
    look = savedLook();
    LOOK_PARTS.forEach((p, i) => (names[i].textContent = optName(p.opts[Number(look[i])], p.id)));
    presets.forEach((b, i) => b.setAttribute('aria-pressed', String(look === lookOf(CHARACTERS[i].id))));
    if (look !== now || !shown) show(look);
  };
  return el('div', { class: 'avatar' },
    el('style', {}, `.avatar{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.avatar-view{width:${W}px;max-width:100%;display:flex;flex-direction:column;gap:4px}.avatar canvas{width:${W}px;height:${H}px;max-width:100%;border-radius:12px;background:radial-gradient(circle at 50% 40%,#3a2a40,#15101a);touch-action:none;cursor:grab}.avatar-parts{flex:1;min-width:220px;display:flex;flex-direction:column;gap:4px}.avatar-pick{display:flex;align-items:center;gap:6px}.avatar-name{min-width:9em;text-align:center}.avatar-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}.avatar-preset{padding:2px;min-height:0;border-radius:8px}.avatar-preset[aria-pressed=true]{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}`),
    el('div', { class: 'avatar-view' }, renderer.domElement, el('small', { class: 'muted' }, t('Arraste para orbitar · role para aproximar', 'Drag to orbit · scroll to zoom'))),
    el('div', { class: 'avatar-parts' }, el('small', { class: 'muted' }, t('Prontos', 'Presets')), el('div', { class: 'avatar-presets' }, ...presets), ...rows,
      el('button', { type: 'button', onclick: () => set(randomLook()) }, t('Aleatório', 'Random')),
      el('small', { class: 'muted' }, t('Vale na hora, até no meio da partida, e os outros jogadores veem. Fica salvo neste navegador.', 'Applies right away, even mid-match, and the other players see it. Saved in this browser.'))));
}
