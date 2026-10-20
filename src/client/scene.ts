// Cena 3D: lava, arena de pedra que encolhe, magos (KayKit), projéteis e efeitos.
// Coordenadas: o plano da simulação (x, y) vira (x, 0, y) no Three.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SHAPES as ARENAS, edgeAt, inLavaAt, type ArenaId, type Isle } from '../shared/arena.ts';
import { ARENA_STEP, CHEST, ISLAND, OBSTACLES, RUNE, SHRINK_WARN, WIZ_R, type RuneKind } from '../shared/constants.ts';
import { lookBody, lookOf, lookPieces, type CharacterId } from '../shared/characters.ts';
import type { MatchOpts } from '../shared/match.ts';
import type { ProjKind, SimEvent } from '../shared/sim.ts';
import type { PillarView, ProjView, RuneView, ZoneKind, ZoneView } from '../shared/snapshot.ts';
import { add, scale, v, type Vec } from '../shared/vec.ts';
import { createDecor } from './decor.ts';
import { t } from './i18n.ts';
import { BAD_STATUS, ICON, ITEM_ICON, RUNE_ICON, STATUS_ICONS, UI_ICON, el, fxClock, icon } from './icons.ts';
import { SPELLS } from '../shared/spells.ts';

// cor de cada lugar (0..7) e o giro de matiz que leva o roxo do mago até ela
export const COLORS = ['#e5484d', '#3e8ef7', '#30a46c', '#f5d90a', '#a26bf5', '#12c7c7', '#f76b15', '#e93d82'];
// modo Times: Azul e Vermelho (anel no chão e barra de vida)
export const TEAM_COLORS = ['#3b82f6', '#ef4444'];
// dificuldade dos bots, curta (rótulo em cima do mago e placar do canto)
export const BOT_LEVEL: Record<MatchOpts['difficulty'], string> = { easy: t('Fácil', 'Easy'), normal: 'Normal', hard: t('Difícil', 'Hard'), auto: 'Auto' };
const HUES = [0, 215, 145, 52, 270, 182, 24, 330];
const MAGE_HUE = 255;

export type WizDraw = { id: string; pos: Vec; facing: number; hp: number; hpMax: number; status: number; alive: boolean; shield: boolean; shieldR?: number; rushLeft?: number; regen?: number; bot?: MatchOpts['difficulty'] | null; loot?: number; color: number; character: string; look?: string; name: string; moving: boolean; cheer: boolean; team?: number | null; illusion?: boolean; ghost?: boolean; fx?: number[] }; // ghost: meio transparente; fx: tempo dos meus efeitos (snap.fx), só no meu mago

// personagens KayKit: cada GLB carrega na primeira vez que alguém usa uma peça dele
export type Model = { scene: THREE.Group; clips: THREE.AnimationClip[] };
const files = new Map<string, Model>();
const loading = new Map<string, Promise<Model | null>>();
const failed = new Set<string>();
const gltf = new GLTFLoader();
export function loadFile(id: string): Promise<Model | null> {
  let p = loading.get(id);
  if (!p) {
    p = gltf.loadAsync(`/models/${id}.glb`).then((g) => {
      const m = { scene: g.scene, clips: g.animations };
      files.set(id, m);
      return m;
    }, () => (failed.add(id), null)); // não tenta de novo a cada quadro; a aparência cai para o mago padrão
    loading.set(id, p);
  }
  return p;
}
const lookFiles = (look: string) => [...new Set([lookBody(look), ...lookPieces(look).map((x) => x.from)])];
export const loadLook = (look: string) => Promise.all(lookFiles(look).map(loadFile)).then(() => {});

// aparência montada: o esqueleto (e as animações) vêm do arquivo do Tronco; as malhas skinadas das outras peças são religadas a
// esses ossos pelo nome e as rígidas (chapéu, capa do mago, armas) presas ao osso de mesmo nome. Monta uma vez por aparência;
// cada mago clona a montagem (geometria e material ficam divididos com os GLB: não descartar)
const prefabs = new Map<string, Model>();
export function lookModel(look: string): Model | null {
  const hit = prefabs.get(look);
  if (hit) return hit;
  const ids = lookFiles(look);
  ids.forEach(loadFile);
  if (ids.some((id) => failed.has(id))) return look === lookOf('mage') ? null : lookModel(lookOf('mage'));
  if (!ids.every((id) => files.has(id))) return null;
  const m = assemble(look, (id) => files.get(id)!);
  prefabs.set(look, m);
  return m;
}
export function assemble(look: string, file: (id: CharacterId) => Model): Model {
  const base = file(lookBody(look));
  const root = base.scene.clone();
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o));
  for (const o of meshes) o.removeFromParent();
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => byName.set(o.name, o));
  for (const piece of lookPieces(look)) {
    for (const name of piece.nodes) {
      const src = file(piece.from).scene.getObjectByName(name);
      if (!src?.parent) continue;
      const part = src.clone();
      if ((part as THREE.SkinnedMesh).isSkinnedMesh) {
        const sk = part as THREE.SkinnedMesh;
        sk.bind(new THREE.Skeleton(sk.skeleton.bones.map((b) => byName.get(b.name) as THREE.Bone), sk.skeleton.boneInverses), sk.bindMatrix);
      }
      byName.get(src.parent.name)?.add(part);
    }
  }
  root.updateMatrixWorld(true);
  return { scene: root, clips: base.clips };
}

const w3 = (p: Vec, y = 0) => new THREE.Vector3(p.x, y, p.y);
// deita no chão (plano xz) na altura y
const ground = <T extends THREE.Object3D>(o: T, y: number) => {
  o.rotation.x = -Math.PI / 2;
  o.position.y = y;
  return o;
};

// chão da arena: o contorno da forma (arena.ts, escala 1) com 4 cm de espessura, quase rente à lava (a borda derretida
// é desenhada pelos shaders, ver SHORE_GLSL); a malha é escalada pelo raio atual
function floorGeo(id: ArenaId) {
  const [outer, ...holes] = ARENAS[id].outline; // toda forma tem um contorno de fora (o anel tem um buraco)
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)));
  shape.holes = holes.map((h) => new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // (x, y) da forma vira (x, z) do mundo, a espessura para baixo; o topo em y = 0
  return g;
}
// distância com sinal até a borda da forma (arena.ts sdf, escala 1) numa textura 256×256 que cobre ±SDF_SPAN:
// os shaders da pedra e da lava leem a mesma distância, então a borda derretida casa dos dois lados
const SDF_N = 256, SDF_CLAMP = 0.3;
const sdfSpan = (id: ArenaId) => ARENAS[id].reach + 0.35;
function sdfTexture(id: ArenaId) {
  const S = sdfSpan(id), data = new Uint8Array(SDF_N * SDF_N * 4);
  for (let j = 0; j < SDF_N; j++) for (let i = 0; i < SDF_N; i++) {
    const d = ARENAS[id].sdf(((i + 0.5) / SDF_N) * 2 * S - S, ((j + 0.5) / SDF_N) * 2 * S - S);
    data[(j * SDF_N + i) * 4] = Math.round((Math.max(-1, Math.min(1, d / SDF_CLAMP)) * 0.5 + 0.5) * 255);
  }
  const t = new THREE.DataTexture(data, SDF_N, SDF_N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
// GLSL comum: shoreDist(xz) = metros até a borda, positivo na lava; vnoise = ruído de valor barato
const SHORE_GLSL = `
uniform sampler2D uSdf; uniform float uSpan; uniform float uR; uniform float uShoreTime; uniform float uLick; uniform float uWarn;
float shoreDist(vec2 xz){ vec2 uv = (xz / uR + uSpan) / (2.0 * uSpan); return (texture2D(uSdf, uv).r * 2.0 - 1.0) * ${SDF_CLAMP.toFixed(2)} * uR; }
float shash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shash(i), shash(i + vec2(1, 0)), u.x), mix(shash(i + vec2(0, 1)), shash(i + vec2(1, 1)), u.x), u.y); }
// lava lambendo a borda: a linha onde a pedra derrete sobe e desce uns centímetros, devagar (parada no modo leve)
float shoreLick(vec2 xz){ return uLick * (0.08 + 0.07 * sin(uShoreTime * 1.6 + xz.x * 1.7 + xz.y * 1.3) * sin(uShoreTime * 0.9 - xz.x * 0.8 + xz.y * 2.1)); }
`;
// faixa no chão entre dois contornos de mesmo número de pontos (a e b); keep diz se o quadrilátero entra (pelo meio dele)
function bandGeo(pairs: [Vec[], Vec[]][], keep: (m: Vec) => boolean = () => true) {
  const pos: number[] = [];
  for (const [a, b] of pairs) for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    if (!keep(scale(add(add(a[i], a[j]), add(b[i], b[j])), 0.25))) continue;
    for (const p of [a[i], a[j], b[j], a[i], b[j], b[i]]) pos.push(p.x, 0, p.y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

type Mage = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
  oneShotUntil: number;
  ring: THREE.Mesh;
  shield: THREE.Mesh;
  aura: THREE.Mesh; // anel no chão: dourado invulnerável, azul com Escudo de runa
  bar: HTMLDivElement;
  absRush: HTMLDivElement;
  extraEl: HTMLSpanElement; // números pequenos ao lado da barra: regeneração por segundo e o que os escudos ainda absorvem
  extraKey: string;
  aegisEl: HTMLElement;
  shieldBar: HTMLDivElement; // tempo que falta do Escudo
  shieldFill: HTMLDivElement;
  shieldSince: number;
  prevHp: number; // cura: vida do quadro anterior, quando subiu e o que somou no último segundo
  prevAlive: boolean;
  healAt: number;
  healSum: number;
  healFlushAt: number;
  lootBar: HTMLDivElement;
  lootFill: HTMLDivElement;
  label: HTMLDivElement;
  hpFill: HTMLDivElement;
  hpText: HTMLSpanElement;
  nameEl: HTMLSpanElement;
  botEl: HTMLElement; // bot: robô e a dificuldade ao lado do nome
  botKey: string;
  tint: string; // cor do anel e da barra (do jogador, ou do time no modo Times)
  statusEl: HTMLSpanElement;
  statusKey: number;
  statusClocks: Map<number, HTMLElement>; // bit → reloginho em cima do ícone (só o meu mago tem tempo: d.fx)
  clock: ReturnType<typeof fxClock>;
  ghost: boolean; // desenhado meio transparente agora (Ilusão)
  dead: boolean;
  color: number;
  look: string;
  // materiais próprios deste boneco (o clone do SkeletonUtils divide os do modelo) e a cor de brilho original de cada um
  mats: { m: THREE.MeshStandardMaterial; c: THREE.Color; i: number; col: THREE.Color; rough: number }[];
  ghostMats: { m: THREE.Material; transparent: boolean; opacity: number }[];
  model: THREE.Object3D; // o boneco (some no fim da queima, quando fica só o esqueleto)
  burnAt: number; // morreu na lava neste instante (−1 = não está queimando)
  bones: THREE.Object3D | null; // esqueleto escuro que sobra da queima
  flash: number; // clarão branco do golpe: 1 no acerto, cai até 0
  freezeUntil: number; // hit-stop: animação parada até este instante
  cheering: boolean;
};

// limiares de golpe (dano por acerto vai de ~30 a ~170): grande e crítico
const BIG_HIT = 100;
const CRIT_HIT = 130;
// cura: salto de uma vez (Drenar, Roubo de vida num golpe forte) mostra na hora; o resto soma e aparece se passar disso em 1 s (a regeneração sozinha, 5 a ~11/s, não passa)
const HEAL_NOW = 10;
const HEAL_SUM = 15;
const SHIELD_SECS = SPELLS.shield.levels[0].duration; // igual em todos os níveis
const FX_CAP = 320; // teto de efeitos vivos: acima disso, partículas novas são puladas
const SHAKE_MAX = 0.55;

type Fx = { obj: THREE.Object3D; until: number; born: number; update?: (k: number) => void };

const LAVA_VERT = `varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const LAVA_FRAG = `
uniform float uTime; uniform sampler2D uMap; uniform float uHas; varying vec2 vUv; varying vec3 vPos;
${SHORE_GLSL}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + 1.7; a *= 0.5; } return s; }
void main(){
  vec2 p = vPos.xz * 0.18;
  float t = uTime * 0.08;
  float n = fbm(p + vec2(t, -t*0.7) + fbm(p*1.7 - t));
  float veins = smoothstep(0.5, 0.66, n);
  float core = smoothstep(0.66, 0.8, n);
  vec3 crust = mix(vec3(0.035, 0.008, 0.004), vec3(0.16, 0.025, 0.008), smoothstep(0.3, 0.5, n));
  vec3 hot = mix(vec3(0.7, 0.1, 0.01), vec3(1.0, 0.45, 0.06), core);
  vec3 col = mix(crust, hot, veins);
  if (uHas > 0.5) {
    // textura de lava (ambientCG Lava004) em duas camadas que correm em sentidos diferentes
    vec2 q = vPos.xz * 0.05;
    vec3 a = texture2D(uMap, q + vec2(t * 0.10, t * 0.04)).rgb;
    vec3 b = texture2D(uMap, q * 1.7 - vec2(t * 0.06, -t * 0.09)).rgb;
    vec3 tex = pow(max(a, b * 0.85), vec3(2.2));
    col = tex * (0.45 + 0.55 * veins) + hot * core * 0.2;
  }
  // bolhas: uma em cada ~10 células (de ~1,8 m) incha devagar como um domo aceso e estoura num clarão; mais nos veios quentes
  vec2 bp = vPos.xz * 0.55; vec2 bi = floor(bp);
  float bh = hash(bi);
  float ph = fract(uTime * (0.1 + 0.15 * bh) + bh * 7.0);
  float br = ph * ph * 0.26 * step(0.9, bh) + 0.001;
  float bd = length(fract(bp) - 0.5 - (vec2(hash(bi + 3.1), hash(bi + 7.7)) - 0.5) * 0.4);
  float dome = (1.0 - smoothstep(br * 0.2, br, bd)) * ph * 0.55;
  float pop = smoothstep(0.94, 1.0, ph) * (1.0 - smoothstep(0.0, br * 1.6, bd)) * 1.6;
  col += vec3(1.0, 0.5, 0.12) * (dome + pop) * (0.2 + 0.8 * veins) * step(0.9, bh);
  // junto da pedra: lava fresca e clara que lambe a borda em ondinhas, com crosta escura boiando; casa com a borda derretida da pedra
  float dO = shoreDist(vPos.xz) + shoreLick(vPos.xz);
  float shore = 1.0 - smoothstep(0.0, 1.3, dO);
  float ripple = 0.65 + 0.35 * sin(dO * 11.0 - uShoreTime * 2.4 * uLick + vnoise(vPos.xz * 1.4) * 5.0);
  vec3 molten = mix(vec3(0.8, 0.17, 0.02), vec3(1.0, 0.4, 0.07), ripple);
  molten = mix(molten, vec3(1.0, 0.16, 0.03), uWarn * 0.6);
  col = mix(col, molten * (0.6 + 0.3 * ripple), shore * shore * 0.6);
  float scum = smoothstep(0.55, 0.75, vnoise(vPos.xz * 2.3 + uShoreTime * 0.05)) * smoothstep(0.05, 0.4, dO) * shore;
  col = mix(col, vec3(0.09, 0.025, 0.01), scum * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function stoneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3633';
  g.fillRect(0, 0, 1024, 1024);
  // lajes irregulares com rejunte escuro
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 8 + Math.random() * 30;
    const l = 24 + Math.random() * 18;
    g.fillStyle = `hsl(20, 6%, ${l}%)`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(20,16,14,.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 140; i++) {
    g.beginPath();
    let x = Math.random() * 1024, y = Math.random() * 1024;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) g.lineTo((x += (Math.random() - 0.5) * 70), (y += (Math.random() - 0.5) * 70));
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createScene(canvas: HTMLCanvasElement, labels: HTMLElement) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a0603');
  scene.fog = new THREE.Fog('#1a0603', 30, 70);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);

  // luz um pouco mais dramática: menos preenchimento, sol mais quente e a lava mais forte por baixo
  scene.add(new THREE.HemisphereLight('#ffd2b0', '#ff4a10', 0.45));
  const sun = new THREE.DirectionalLight('#ffe6c8', 1.7);
  sun.position.set(-8, 20, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
  scene.add(sun);
  const under = new THREE.PointLight('#ff5a1a', 60, 30, 1.6); // brilho da lava por baixo da borda
  under.position.set(0, -1.5, 0);
  scene.add(under);

  // assets CC0 em public/ (créditos em public/CREDITS.txt); enquanto não carregam, fica o visual gerado por código
  const loader = new THREE.TextureLoader();
  const tex = (path: string, srgb = true, repeat = 0) => {
    const t = loader.load(path);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
    }
    return t;
  };
  const fxTex = (name: string) => tex(`/fx/${name}.png`);
  // quadros de chama e de fumaça (Kenney Particle Pack, CC0): o fogo anima trocando o quadro, a fumaça varia
  const FLAMES = ['flame_01', 'flame_02', 'flame_03', 'flame_04', 'flame_05', 'flame_06'].map(fxTex);
  const SMOKES = ['smoke_01', 'smoke_03', 'smoke_05', 'smoke_07'].map(fxTex);
  const FX = {
    flame: FLAMES[0], fire: fxTex('fire_01'), smoke: SMOKES[0], spark: fxTex('spark_01'),
    magic: fxTex('magic_02'), light: fxTex('light_01'), circle: fxTex('circle_05'), scorch: fxTex('scorch_02'),
    twirl: fxTex('twirl_01'), twirl2: fxTex('twirl_02'), star: fxTex('star_04'),
  };
  const FIRE_KINDS = new Set<ProjKind>(['fireball', 'cluster', 'meteor']);
  // distância até a borda e relógio da borda derretida, divididos pela lava e pela pedra
  const shoreU = { uSdf: { value: sdfTexture('circle') }, uSpan: { value: sdfSpan('circle') }, uR: { value: 11 }, uShoreTime: { value: 0 }, uLick: { value: 1 }, uWarn: { value: 0 } };
  const lavaMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uMap: { value: null }, uHas: { value: 0 }, ...shoreU }, vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG });
  loader.load('/tex/lava_emit.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    lavaMat.uniforms.uMap.value = t;
    lavaMat.uniforms.uHas.value = 1;
  });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), lavaMat);
  ground(lava, -0.02); // a pedra fica só 2 cm acima
  scene.add(lava);

  // arena: a forma em escala 1 escalada pelo raio; o topo de pedra, a lateral brilha com a lava
  const stone = stoneTexture();
  let shownArena: ArenaId = 'circle';
  const arena = new THREE.Mesh(
    floorGeo(shownArena),
    [new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
      new THREE.MeshBasicMaterial({ color: '#d2480c' })], // lateral de 4 cm: a cor da pedra derretida, sem risco escuro na emenda
  );
  arena.receiveShadow = true;
  scene.add(arena);
  // borda da pedra: escurece e racha nos últimos ~0,9 m, as rachaduras acendem em laranja e, colada na lava, a pedra derrete
  // (a lava lambe uns centímetros para dentro); no aviso de encolhimento a borda puxa para o vermelho e pulsa
  (arena.material as THREE.MeshStandardMaterial[])[0].onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shoreU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + SHORE_GLSL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float eIn = -shoreDist(vWPos.xz);
      float nz = vnoise(vWPos.xz * 1.3);
      float band = 1.0 - smoothstep(0.0, 1.3, eIn - 0.4 * (nz - 0.5));
      diffuseColor.rgb *= mix(1.0, 0.3, band);
      float crack = max(1.0 - smoothstep(0.0, 0.05, abs(vnoise(vWPos.xz * 1.6 + 7.0) - 0.5)), 0.6 * (1.0 - smoothstep(0.0, 0.04, abs(vnoise(vWPos.xz * 4.1 - 3.0) - 0.5))));
      vec3 hot = mix(vec3(1.0, 0.34, 0.05), vec3(1.0, 0.1, 0.02), uWarn);
      float melt = 1.0 - smoothstep(0.0, 0.22, eIn - shoreLick(vWPos.xz) - 0.12 * (nz - 0.5));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.02, 0.0), melt);
      totalEmissiveRadiance += hot * (crack * band * band * (0.9 + 1.2 * uWarn) + melt * (0.85 + 0.9 * uWarn));`);
  };
  // ardósia de verdade (Poly Haven Slate Floor 02) quando a textura chegar
  loader.load('/tex/stone.jpg', (t) => {
    const top = (arena.material as THREE.MeshStandardMaterial[])[0];
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // o topo usa as coordenadas da forma (-1 a 1 no círculo): 2,5 por unidade = os 5 ladrilhos de lado a lado de antes
    t.repeat.set(2.5, 2.5);
    top.map = t;
    top.normalMap = tex('/tex/stone_nor.jpg', false, 2.5);
    top.color.set('#e6ddd6');
    top.needsUpdate = true;
  });
  // faixa que pisca em vermelho onde a pedra vai afundar
  const warnMat = new THREE.MeshBasicMaterial({ color: '#ff2a00', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const warn = new THREE.Mesh(new THREE.BufferGeometry(), warnMat);
  warn.position.y = 0.02;
  scene.add(warn);
  let shownR = 11;
  let shownIsles: Isle[] = []; // ilhas de refúgio do último quadro (morrer em cima de uma não é cair na lava)
  // decoração arrumada para esta arena e este tamanho (rodada nova = arena maior)
  let decorArena: ArenaId | null = null;
  let decorR = 0;
  let shake = 0; // tremor da câmera nos choques
  let warnR = -1;
  // Efeitos "Leve": sem tremor, sem hit-stop e sem partículas extras (PC fraco ou quem enjoa)
  let lite = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let celebrate = 0; // 0..1: zoom da câmera no vencedor no fim da rodada

  const glow = glowTexture();
  // brasas que sobem da lava em volta da arena: 28 sprites fixos com um só material, reciclados (nada alocado por quadro)
  const emberMat = new THREE.SpriteMaterial({ map: glow, color: '#ff8a2a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const embers = Array.from({ length: 28 }, () => {
    const s = new THREE.Sprite(emberMat);
    s.userData = { a: 0, r: 0, vy: 0, size: 0, wait: Math.random() * 4 }; // wait: segundos escondida antes de subir
    s.visible = false;
    scene.add(s);
    return s;
  });
  // núcleo quase branco e brilho saturado: destaca do chão marrom e da lava laranja (legibilidade, ideia do Spellsworn)
  const fireMat = new THREE.MeshBasicMaterial({ color: '#fff2b0' });
  const homingMat = new THREE.MeshBasicMaterial({ color: '#f3d4ff' });
  const ballGeo = new THREE.SphereGeometry(0.28, 16, 12);
  const swapMat = new THREE.MeshBasicMaterial({ color: '#dcfffb' });
  const gripMat = new THREE.MeshBasicMaterial({ color: '#ffd6de' });
  // aparência de cada projétil: corpo, cor do brilho e do rastro, textura do rastro e tamanho
  // a cópia da Ilusão não entra: é desenhada como mago (main.ts)
  const LOOK: Record<Exclude<ProjKind, 'illusion'>, { mat: THREE.Material; halo: string; trail: string; tex: THREE.Texture; size: number }> = {
    fireball: { mat: fireMat, halo: '#ffb000', trail: '#ff8a00', tex: FX.flame, size: 1.15 },
    homing: { mat: homingMat, halo: '#c23cff', trail: '#b040ff', tex: FX.magic, size: 1.1 },
    cluster: { mat: fireMat, halo: '#fff066', trail: '#ffd23a', tex: FX.spark, size: 0.65 },
    swap: { mat: swapMat, halo: '#00fff0', trail: '#2fe0d0', tex: FX.magic, size: 1 },
    grip: { mat: gripMat, halo: '#ff1f4f', trail: '#e0103a', tex: FX.magic, size: 1 },
    meteor: { mat: fireMat, halo: '#ff5a1a', trail: '#ff7a20', tex: FX.fire, size: 3 },
    boomerang: { mat: swapMat, halo: '#7dff5a', trail: '#5ad040', tex: FX.spark, size: 0.85 },
    gravity: { mat: homingMat, halo: '#3b2bff', trail: '#6a3cff', tex: FX.magic, size: 1.5 },
    bouncer: { mat: gripMat, halo: '#3cff9a', trail: '#20d080', tex: FX.magic, size: 0.8 },
    drain: { mat: gripMat, halo: '#9aff4a', trail: '#5ac020', tex: FX.magic, size: 0.9 },
    snowball: { mat: swapMat, halo: '#cfefff', trail: '#e8f6ff', tex: FX.smoke, size: 1.2 },
    magnetize: { mat: gripMat, halo: '#ff4040', trail: '#c0c0d0', tex: FX.spark, size: 1 },
    recharge: { mat: swapMat, halo: '#3aa8ff', trail: '#5ac8ff', tex: FX.spark, size: 0.9 },
    link: { mat: swapMat, halo: '#6aa8ff', trail: '#4a88ff', tex: FX.magic, size: 0.8 },
    splitter: { mat: swapMat, halo: '#40c8ff', trail: '#30a0ff', tex: FX.magic, size: 1 },
    shard: { mat: swapMat, halo: '#8fd8ff', trail: '#60b8ff', tex: FX.spark, size: 0.6 },
    warpzone: { mat: swapMat, halo: '#7ad8ff', trail: '#7ad8ff', tex: FX.magic, size: 1 },
  };
  // corpo de cada projétil: formas low-poly próprias em vez da mesma bola de luz (pedido do Fernando, 17/10;
  // não há modelos CC0 prontos para magias, então são feitas aqui com as geometrias do Three.js)
  const jitter = (g: THREE.BufferGeometry, amount: number) => {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + (Math.random() - 0.5) * amount), pos.getY(i) * (1 + (Math.random() - 0.5) * amount), pos.getZ(i) * (1 + (Math.random() - 0.5) * amount));
    g.computeVertexNormals();
    return g;
  };
  const flat = (color: string, emissive: string, intensity = 0.6) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, roughness: 0.5 });
  const SHAPES: Partial<Record<ProjKind, () => THREE.Object3D>> = {
    fireball: () => new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.24, 1), 0.35), flat('#ffb347', '#ff6a00', 1.4)),
    cluster: () => new THREE.Mesh(new THREE.TetrahedronGeometry(0.2), flat('#ffe066', '#ff9a00', 1.2)),
    homing: () => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), flat('#e7b8ff', '#9a30ff', 1.2));
      m.scale.set(0.8, 0.8, 2); // cristal comprido apontando para onde voa
      return m;
    },
    swap: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2), flat('#cffffb', '#00d8c8', 1.2)));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 24), flat('#00fff0', '#00b0a8', 1.4));
      ring.name = 'spin';
      g.add(ring);
      return g;
    },
    grip: () => {
      const g = new THREE.Group();
      const hook = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), flat('#ff8095', '#e0103a', 1.1));
      hook.rotation.x = Math.PI / 2; // ponta para a frente
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 16), flat('#c0c0c8', '#400010', 0.4));
      ring.position.z = -0.3;
      g.add(hook, ring);
      return g;
    },
    meteor: () => new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(0.3, 0), 0.4), flat('#4a2c20', '#ff4a00', 0.9)),
    boomerang: () => {
      // V de dois braços, extrudado, girando
      const s = new THREE.Shape();
      s.moveTo(-0.38, 0.16);
      s.lineTo(0, -0.12);
      s.lineTo(0.38, 0.16);
      s.lineTo(0.3, 0.24);
      s.lineTo(0, 0.04);
      s.lineTo(-0.3, 0.24);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false });
      geo.center();
      const m = new THREE.Mesh(geo, flat('#8fe060', '#3a8a10', 0.7));
      m.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(m);
      g.name = 'spin';
      return g;
    },
    gravity: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: '#05020c' })));
      for (const tilt of [0.5, -0.9]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 32), flat('#8a6cff', '#4a20ff', 1.6));
        ring.rotation.x = tilt;
        ring.name = 'spin';
        g.add(ring);
      }
      return g;
    },
    bouncer: () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), flat('#7dffb8', '#10c070', 1.2)),
    drain: () => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), flat('#c8ff9a', '#3a9a10', 1.2));
      m.scale.set(0.7, 0.7, 1.7); // espinho verde apontando para onde voa
      return m;
    },
    snowball: () => new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.42, 1), 0.15), flat('#f4fbff', '#9ad8ff', 0.35)),
    magnetize: () => {
      // ímã em U: arco vermelho com pontas prateadas
      const g = new THREE.Group();
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 16, Math.PI), flat('#ff4a4a', '#a00000', 0.8));
      arc.rotation.x = -Math.PI / 2;
      g.add(arc);
      for (const x of [-0.2, 0.2]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), flat('#e0e0e8', '#404050', 0.4));
        tip.position.set(x, 0, 0.04);
        g.add(tip);
      }
      return g;
    },
    recharge: () => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 8), flat('#9ae6ff', '#1a90ff', 1.3));
      m.rotation.x = Math.PI / 2; // pilha deitada apontando para a frente
      return m;
    },
    link: () => new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 16), flat('#bfe6ff', '#2a7aff', 1.2)),
    splitter: () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), flat('#a0f0ff', '#2080ff', 1.2)),
    shard: () => new THREE.Mesh(new THREE.TetrahedronGeometry(0.13), flat('#d0f4ff', '#40a0ff', 1.4)),
    warpzone: () => {
      // cúpula de vidro com borda no chão; raio 1 aqui, o tamanho real vem do servidor
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7ad8ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 4, 48), new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0.6 }));
      rim.rotation.x = -Math.PI / 2;
      g.add(rim);
      return g;
    },
  };
  const projs = new Map<number, THREE.Group>();
  const fx: Fx[] = [];

  // cada jogador ganha um clone da aparência dele. O mago define a escala (os pacotes KayKit usam a mesma medida) e as peças
  // do mago (chapéu, tronco, capa) são tingidas na cor do jogador
  let mageScale = 1;
  const tinted = new Map<number, THREE.Texture>();
  const ready = loadFile('mage').then((g) => {
    if (!g) return;
    const box = new THREE.Box3().setFromObject(g.scene);
    mageScale = 1.9 / (box.max.y - box.min.y);
  });

  function tintFor(color: number, base: THREE.Texture): THREE.Texture {
    const hit = tinted.get(color);
    if (hit) return hit;
    const img = base.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.filter = `hue-rotate(${HUES[color] - MAGE_HUE}deg) saturate(1.25)`;
    g.drawImage(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = base.flipY;
    tex.colorSpace = THREE.SRGBColorSpace;
    tinted.set(color, tex);
    return tex;
  }

  const mages = new Map<string, Mage>();
  const decor = createDecor(scene, ready.then(() => mageScale), FX.flame);

  // geometrias de efeito compartilhadas: criar uma por efeito vazava memória de vídeo
  const ringGeo = new THREE.RingGeometry(WIZ_R * 0.9, WIZ_R * 1.25, 40);
  const discGeo = new THREE.CircleGeometry(1, 48);
  const shieldGeo = new THREE.SphereGeometry(0.85, 24, 16);
  const markerGeo = new THREE.RingGeometry(0.15, 0.25, 24);
  const scorchGeo = new THREE.PlaneGeometry(1.6, 1.6);
  const waveGeo = new THREE.RingGeometry(0.85, 1, 64);
  const SHARED = new Set<THREE.BufferGeometry>([ringGeo, shieldGeo, markerGeo, scorchGeo, waveGeo, ballGeo]);

  // libera o que o efeito criou (material sempre; geometria se não for compartilhada; sprite usa a geometria interna do three)
  function dispose(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.Line).isLine && !(o as THREE.Sprite).isSprite) return;
      if (!(o as THREE.Sprite).isSprite && mesh.geometry && !SHARED.has(mesh.geometry)) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
    });
  }

  // corpo na lava (Fernando, 18/10): boia quase na superfície escurecendo com brilho de brasa e fumaça; aos BURN.swap s vira um
  // esqueleto escuro (o Skeleton_Minion do projeto, materiais clonados: cor × 0,2 com #2a1a12, brasa #ff4a10 a 0,06, aspereza 1)
  // que boia mais um pouco e afunda de BURN.dive a BURN.end s (a lava é opaca: abaixo de ~0,3 m o corpo deitado some). No modo leve, só a fumaça diminui
  const BONES = 'skeleton_minion';
  const BURN = { swap: 3.5, dive: 6, end: 7.5, sink: 0.08, deep: 0.9 };
  const CHAR = new THREE.Color('#2a1a12');
  const EMBER = new THREE.Color('#ff4a10');
  const charred = (c: THREE.Color) => c.clone().multiplyScalar(0.2).lerp(CHAR, 0.5);
  function burnCorpse(m: Mage, t: number, at: Vec) {
    const k = Math.min(1, t / BURN.swap);
    if (t < BURN.swap) {
      const heat = (0.35 + 0.25 * Math.sin(t * 9 + m.color)) * k * (1 - 0.6 * k); // brasa que acende e vai apagando no carvão
      for (const x of m.mats) {
        x.m.color.copy(x.col).lerp(charred(x.col), k);
        x.m.emissive.copy(EMBER);
        x.m.emissiveIntensity = heat;
        x.m.roughness = x.rough + (1 - x.rough) * k;
      }
      m.root.position.y = -BURN.sink * k;
    } else {
      if (!m.bones) {
        m.bones = makeBones(m) ?? m.model; // sem o esqueleto, fica o corpo carbonizado
        burst(at, '#ff7a2a', 1.6, 0.6, 0.4, FX.spark, 0.8);
        smoke(at, 1.6, 2);
      }
      const e = Math.max(0, Math.min(1, (t - BURN.dive) / (BURN.end - BURN.dive)));
      m.root.position.y = -BURN.sink - (BURN.deep - BURN.sink) * e;
    }
    m.root.visible = t < BURN.end + 0.3;
    // fumaça escura subindo do corpo (no leve, quase nada) e uma brasa ou outra
    if (t < BURN.end - 1 && Math.random() < (lite ? 0.03 : 0.14)) {
      const p = v(at.x + (Math.random() - 0.5) * 0.5, at.y + (Math.random() - 0.5) * 0.5);
      if (Math.random() < 0.5) smoke(p, 1 + Math.random() * 0.5, 1.8);
      else puff(p, 0.8 + Math.random() * 0.4, 1.6); // vapor claro: a fumaça escura some contra a lava
    }
    if (!lite && t < BURN.swap + 1 && Math.random() < 0.08) burst(v(at.x + (Math.random() - 0.5) * 0.6, at.y + (Math.random() - 0.5) * 0.6), '#ff8a2a', 0.3, 0.9, 0.3, glow, 1.2);
  }
  // esqueleto deitado na pose final da morte, com os materiais carbonizados; se o modelo ainda não chegou (ou já é um esqueleto), o próprio corpo carbonizado
  function makeBones(m: Mage): THREE.Object3D | null {
    const src = files.get(BONES);
    if (!src || lookBody(m.look).startsWith('skeleton')) return null;
    const b = cloneSkinned(src.scene) as THREE.Group;
    b.scale.setScalar(mageScale);
    b.rotation.copy(m.model.rotation);
    b.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.color = charred(mat.color);
      mat.emissive = EMBER.clone();
      mat.emissiveIntensity = 0.06;
      mat.roughness = 1;
      mesh.material = mat;
    });
    const clip = src.clips.find((c) => c.name === 'Death_A');
    if (clip) {
      const mixer = new THREE.AnimationMixer(b);
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      mixer.setTime(clip.duration);
    }
    m.model.visible = false;
    m.root.add(b);
    return b;
  }
  // voltou (deathmatch) ou rodada nova: o boneco como era
  function unburn(m: Mage) {
    m.root.position.y = 0;
    m.root.visible = true;
    m.model.visible = true;
    if (m.burnAt >= 0) {
      for (const x of m.mats) {
        x.m.color.copy(x.col);
        x.m.emissive.copy(x.c);
        x.m.emissiveIntensity = x.i;
        x.m.roughness = x.rough;
      }
    }
    m.burnAt = -1;
    if (m.bones === m.model) m.bones = null;
    if (m.bones) {
      m.root.remove(m.bones);
      m.bones.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
      });
      m.bones = null;
    }
  }

  function makeMage(d: WizDraw, look: string): Mage | null {
    const src = lookModel(look);
    if (!src) return null;
    const model = cloneSkinned(src.scene) as THREE.Group;
    model.scale.setScalar(mageScale);
    const mats: Mage['mats'] = [];
    const ghostMats: Mage['ghostMats'] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      // material próprio de cada boneco: o clarão do golpe não pode acender os outros magos do mesmo modelo
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((source) => {
          const mat = source.clone();
          ghostMats.push({ m: mat, transparent: mat.transparent, opacity: mat.opacity });
          return mat;
        });
        return;
      }
      const mat = mesh.material.clone();
      if (mat instanceof THREE.MeshStandardMaterial && /^Mage_(Hat|Body|Cape)$/.test(mesh.name) && mat.map) mat.map = tintFor(d.color, mat.map);
      mesh.material = mat;
      ghostMats.push({ m: mat, transparent: mat.transparent, opacity: mat.opacity });
      if (mat instanceof THREE.MeshStandardMaterial) mats.push({ m: mat, c: mat.emissive.clone(), i: mat.emissiveIntensity, col: mat.color.clone(), rough: mat.roughness });
    });
    const root = new THREE.Group();
    root.add(model);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS[d.color], transparent: true, opacity: 0.85, depthWrite: false }));
    ground(ring, 0.03);
    root.add(ring);
    const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
    shield.position.y = 0.8;
    shield.visible = false;
    root.add(shield);
    const aura = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ground(aura, 0.045);
    aura.scale.setScalar(1.45);
    aura.visible = false;
    root.add(aura);
    scene.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const c of src.clips) actions[c.name] = mixer.clipAction(c);
    for (const n of ['Spellcast_Shoot', 'Hit_A', 'Death_A', 'Spellcast_Raise']) {
      actions[n]?.setLoop(THREE.LoopOnce, 1);
      if (actions[n]) actions[n].clampWhenFinished = true;
    }
    actions.Idle?.play();
    const hpFill = el('div', { class: 'hp-fill', style: `background: ${COLORS[d.color]}` });
    const botEl = el('small', { class: 'bot-tag', hidden: true });
    const nameEl = el('span', {}, d.name, botEl);
    const hpText = el('span', { class: 'hp-text' });
    const absRush = el('div', { class: 'hp-abs rush' });
    const bar = el('div', { class: 'hp' }, hpFill, absRush, hpText);
    // selo da Égide ao lado da barra, enquanto não usada
    const aegisEl = el('i', { class: 'aegis', title: t('Égide pronta', 'Aegis ready'), hidden: true }, icon(ITEM_ICON.aegis));
    const extraEl = el('span', { class: 'hp-extra' });
    const shieldFill = el('div');
    const shieldBar = el('div', { class: 'shield-bar', hidden: true }, shieldFill);
    const statusEl = el('span', { class: 'status-icons' });
    // barrinha dourada do monte de ouro: enche a cada 2 s em cima dele
    const lootFill = el('div');
    const lootBar = el('div', { class: 'loot-bar', hidden: true }, lootFill);
    const label = el('div', { class: 'wiz-label' }, statusEl, nameEl, el('div', { class: 'hp-row' }, aegisEl, bar, extraEl), shieldBar, lootBar);
    labels.append(label);
    return { root, mixer, actions, current: 'Idle', oneShotUntil: 0, ring, shield, aura, bar, absRush, extraEl, extraKey: '', aegisEl, shieldBar, shieldFill, shieldSince: 0, prevHp: 0, prevAlive: false, healAt: -9, healSum: 0, healFlushAt: 0, label, hpFill, hpText, nameEl, botEl, botKey: '', tint: COLORS[d.color], lootBar, lootFill, statusEl, statusKey: -1, statusClocks: new Map(), clock: fxClock(), ghost: false, dead: false, color: d.color, look, mats, ghostMats, model, burnAt: -1, bones: null, flash: 0, freezeUntil: 0, cheering: false };
  }

  function play(m: Mage, name: string, fade = 0.15) {
    if (m.current === name || !m.actions[name]) return;
    m.actions[m.current]?.fadeOut(fade);
    m.actions[name].reset().fadeIn(fade).play();
    m.current = name;
  }

  // animação de conjurar: Escudo e Investida erguem as mãos, o resto atira
  const castAnim = (spell: string) => (spell === 'shield' || spell === 'rush' ? 'Spellcast_Raise' : 'Spellcast_Shoot');
  function oneShot(id: string, name: string, secs: number) {
    const m = mages.get(id);
    if (!m || m.dead) return;
    play(m, name, 0.08);
    m.oneShotUntil = performance.now() / 1000 + secs;
  }

  function addFx(obj: THREE.Object3D, secs: number, update?: (k: number) => void) {
    scene.add(obj);
    const now = performance.now() / 1000;
    fx.push({ obj, born: now, until: now + secs, update });
  }

  function burst(at: Vec, color: string, size: number, secs: number, y = 0.8, map: THREE.Texture = glow, rise = 0) {
    if (fx.length > FX_CAP) return; // limite de partículas: no caos, o que passa do teto não nasce
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, rotation: Math.random() * Math.PI * 2 }));
    s.position.copy(w3(at, y));
    addFx(s, secs, (k) => {
      s.scale.setScalar(size * (0.4 + k));
      s.position.y = y + rise * k;
      s.material.opacity = 1 - k;
    });
  }

  // labareda animada: troca o quadro da chama enquanto cresce, sobe e some
  function flameBurst(at: Vec, size: number, secs: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAMES[0], color: '#ffd080', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, rotation: Math.random() * Math.PI * 2 }));
    s.position.copy(w3(at, 0.9));
    addFx(s, secs, (k) => {
      s.material.map = FLAMES[Math.min(FLAMES.length - 1, Math.floor(k * FLAMES.length))];
      s.scale.setScalar(size * (0.5 + k * 0.8));
      s.position.y = 0.9 + k * 0.8;
      s.material.opacity = 1 - k * k;
    });
  }

  // fumaça escura que sobe (mistura normal, não soma luz)
  function smoke(at: Vec, size: number, secs: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKES[Math.floor(Math.random() * SMOKES.length)], color: '#3a2a22', transparent: true, opacity: 0.55, depthWrite: false, rotation: Math.random() * Math.PI * 2 }));
    s.position.copy(w3(at, 0.9));
    addFx(s, secs, (k) => {
      s.scale.setScalar(size * (0.6 + k));
      s.position.y = 0.9 + k * 1.4;
      s.material.opacity = 0.55 * (1 - k);
    });
  }

  // marca de queimado no chão onde a bola de fogo explodiu
  function scorch(at: Vec) {
    const m = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: FX.scorch, color: '#000000', transparent: true, opacity: 0.7, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.copy(w3(at, 0.025));
    addFx(m, 7, (k) => ((m.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.min(1, (1 - k) * 3)));
  }

  // texto que sobe e some (dano, cura, ouro); pop = quanto ele pula ao nascer
  const numbers: { el: HTMLDivElement; at: THREE.Vector3; born: number; pop?: number }[] = [];
  function floatText(cls: string, at: THREE.Vector3, size: string, pop: number | undefined, ...body: (string | Node)[]) {
    const e = el('div', { class: cls, style: size && `font-size: ${size}` }, ...body);
    labels.append(e);
    numbers.push({ el: e, at, born: performance.now() / 1000, pop });
  }
  // em cima de quem levou ou se curou, com um pouco de espalhamento de lado
  const overHead = (at: Vec) => w3(at, 1.6).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, 0));

  // número de dano: o tamanho cresce com o golpe (30 de dano ≈ 1,3rem, 170 ≈ 2,9rem)
  function damageNumber(at: Vec, dmg: number) {
    if (dmg < 5) return;
    const crit = dmg >= CRIT_HIT;
    floatText('dmg' + (crit ? ' crit' : dmg >= BIG_HIT ? ' big' : ''), overHead(at), `${Math.min(3, 0.95 + dmg / 90).toFixed(2)}rem`, crit ? 0.9 : dmg >= BIG_HIT ? 0.55 : 0.3, '-' + Math.round(dmg) + (crit ? '!' : ''));
  }

  // cura que sobe em verde em cima de quem se curou
  const healNumber = (at: Vec, n: number) => floatText('dmg heal', overHead(at), `${Math.min(2.2, 0.95 + n / 90).toFixed(2)}rem`, undefined, '+' + Math.round(n));

  // impacto no mago: clarão branco, hit-stop curto, tremor pela força (mais perto da câmera, mais forte) e anel no golpe forte
  function impact(id: string, at: Vec, dmg: number) {
    const m = mages.get(id);
    if (m) {
      m.flash = 1;
      if (!lite) m.freezeUntil = performance.now() / 1000 + 0.06;
    }
    if (!lite) {
      const near = Math.max(0.3, 1 - Math.hypot(at.x - focus.x, at.y - focus.z) / 14);
      shake = Math.min(SHAKE_MAX, shake + dmg * 0.0028 * near);
    }
    if (dmg >= BIG_HIT) shockwave(at, dmg >= CRIT_HIT ? 2.2 : 1.5, dmg >= CRIT_HIT ? '#ffe9a8' : '#ffb347');
    if (dmg >= CRIT_HIT && !lite) {
      burst(at, '#fff6d8', 3.2, 0.22, 1, FX.star);
      for (let i = 0; i < 5; i++) burst(v(at.x + (Math.random() - 0.5) * 1.2, at.y + (Math.random() - 0.5) * 1.2), '#ffe27a', 0.9, 0.7, 1, FX.star, 1.8);
    }
  }

  // queda na lava: coroa de respingos que sobem e caem, clarão laranja e fumaça
  function lavaSplash(at: Vec) {
    burst(at, '#ffb347', 3.6, 0.5, 0.1, FX.light);
    burst(at, '#ff6a10', 4.2, 0.7, 0.05, FX.circle);
    flameBurst(at, 2.8, 0.6);
    smoke(at, 2.8, 1.8);
    const drops = lite ? 4 : 10;
    for (let i = 0; i < drops && fx.length < FX_CAP; i++) {
      const a = (i / drops) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 1.2 + Math.random() * 1.6, up = 3.5 + Math.random() * 2.5;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: i % 2 ? '#ffd27a' : '#ff6a1a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const size = 0.35 + Math.random() * 0.3;
      s.scale.setScalar(size);
      addFx(s, 0.9, (k) => {
        const t = k * 0.9;
        s.position.set(at.x + Math.cos(a) * sp * t, up * t - 9 * t * t, at.y + Math.sin(a) * sp * t);
        s.material.opacity = 1 - k * k;
      });
    }
    if (!lite) smoke(v(at.x + 0.4, at.y - 0.3), 2, 2.2);
  }

  // vencedor da rodada: faíscas douradas em volta e anel de ouro no chão
  function victoryBurst(at: Vec) {
    shockwave(at, 2.6, '#ffd84a');
    burst(at, '#fff2a0', 3, 0.5, 1, FX.light);
    if (lite) return;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      burst(v(at.x + Math.cos(a) * 0.9, at.y + Math.sin(a) * 0.9), i % 2 ? '#ffd84a' : '#fff2a0', 0.8, 1.1, 0.6, FX.star, 2.4);
    }
  }
  // ouro ganho no abate: sobe dourado em cima de quem matou
  const goldNumber = (at: Vec, n: number) => floatText('dmg gold', w3(at, 2.1), '', undefined, `+${n} `, icon(UI_ICON.gold));

  // marca que fica no chão alguns segundos onde houve choque de magias (só visual)
  // (os choques que deixam chão com efeito desenham a zona do servidor, ver syncZones)
  const MARK: Record<string, { map: THREE.Texture; color: string; secs: number; spin: number }> = {
    pillar: { map: FX.scorch, color: '#ffb066', secs: 4, spin: 0 },
    snow: { map: FX.circle, color: '#dff4ff', secs: 3, spin: 0.4 },
  };
  function groundMark(at: Vec, combo: string, radius: number) {
    const m = MARK[combo];
    if (!m) return;
    const plane = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: m.map, color: m.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.copy(w3(at, 0.035));
    const size = Math.max(0.8, radius * 1.4);
    plane.scale.setScalar(size / 1.6);
    const spin = m.spin * (Math.random() < 0.5 ? -1 : 1);
    addFx(plane, m.secs, (k) => {
      plane.rotation.z += spin * 0.016;
      // tremula como brasa e some no fim
      const flicker = 0.75 + 0.25 * Math.sin(performance.now() / 90 + at.x * 7);
      (plane.material as THREE.MeshBasicMaterial).opacity = flicker * Math.min(1, (1 - k) * 2.5);
    });
  }

  // obstáculos da rodada: modelo KayKit de cada tipo, treme quando apanha e afunda ao quebrar
  const OBSTACLE_MODEL: Record<string, string> = { pillar: 'pillar_decorated', rock: 'rubble_large', tree: 'tree_dead_large', shrine: 'shrine_candles' };
  // parede do Pilar de pedra (KayKit Dungeon barrier_half): um modelo no pedaço do meio, atravessado como os 3 círculos da simulação
  let wallModel: THREE.Object3D | null = null;
  void loadFile('barrier_half').then((g) => (wallModel = g?.scene ?? null));
  function makeWall(along: Vec) {
    const o = wallModel?.clone(true) ?? new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.5), new THREE.MeshStandardMaterial({ color: '#6b625c' }));
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(o);
    const g = new THREE.Group();
    const k = 2 / Math.max(0.01, box.max.x - box.min.x); // 2 m de ponta a ponta
    o.scale.setScalar(k);
    // a origem do modelo fica numa ponta: centra no pedaço do meio e apoia no chão
    o.position.set((-(box.min.x + box.max.x) / 2) * k, -box.min.y * k, (-(box.min.z + box.max.z) / 2) * k);
    g.add(o);
    g.rotation.y = -Math.atan2(along.y, along.x); // o comprimento (x do modelo) no rumo dos pedaços
    return g;
  }
  const pillarMeshes: { obj: THREE.Object3D; pos: Vec; bar: HTMLDivElement | null; fill: HTMLDivElement | null; height: number }[] = [];
  // baú: caixa simples com tampa dourada e brilho (é um obstáculo: as magias quebram)
  const chestWood = new THREE.MeshStandardMaterial({ color: '#7a4a22', roughness: 0.7 });
  const chestGold = new THREE.MeshStandardMaterial({ color: '#ffcc33', emissive: '#a06a00', metalness: 0.6, roughness: 0.3 });
  function makeChest() {
    const g = new THREE.Group();
    const wood = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.38), chestWood);
    wood.position.y = 0.16;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.4), chestGold);
    lid.position.y = 0.38;
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffd84a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glowSprite.scale.setScalar(1.2);
    glowSprite.position.y = 0.3;
    g.add(wood, lid, glowSprite);
    return g;
  }
  // monte de ouro do baú quebrado: moedas no chão com brilho baixo e fraco que pulsa (não cobre quem passa por cima)
  const pile = new THREE.Group();
  const pileShine = new THREE.SpriteMaterial({ map: glow, color: '#ffd84a', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    for (let k = 0; k < 9; k++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 12), chestGold);
      coin.position.set((Math.random() - 0.5) * 0.6, 0.03 + Math.random() * 0.12, (Math.random() - 0.5) * 0.6);
      coin.rotation.set(Math.random(), Math.random(), Math.random());
      pile.add(coin);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.73, 40), new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    ground(ring, 0.03);
    const shine = new THREE.Sprite(pileShine);
    shine.scale.setScalar(0.8);
    shine.position.y = 0.12;
    pile.add(ring, shine);
  }
  const piles: THREE.Group[] = [];
  // runas com a cara do efeito (Fernando, 18/10: as de antes eram feias): ícone grande do game-icons em cima, pedra flutuando
  // e base discreta no chão; brilho baixo (pedido anterior dele: runas e ouro menos brilhantes). Pressa: verde-ciano com asas e giro
  // rápido; Fúria: vermelha com espinhos pulsando e chama; Escudo: azul dentro de uma bolha; Recarga: dourada com anéis e ponteiro de relógio
  const RUNE_COLOR: Record<RuneKind, string> = { haste: '#2dd4bf', fury: '#ef4444', shield: '#60a5fa', recharge: '#facc15' };
  type RuneDraw = { g: THREE.Group; tick: (now: number) => void };
  const runeSlots: Partial<Record<RuneKind, RuneDraw>>[] = [];
  function runeDraw(kind: RuneKind): RuneDraw {
    const c = RUNE_COLOR[kind];
    const g = new THREE.Group();
    const gem = new THREE.Group(); // o que flutua: a pedra e os enfeites
    const core = new THREE.Mesh(kind === 'fury' ? new THREE.IcosahedronGeometry(0.2, 0) : new THREE.OctahedronGeometry(0.22, 0), flat(c, c, 0.3));
    gem.add(core);
    // base: anel fino e disco bem fraco no chão
    const base = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.5, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    ground(base, 0.03);
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, depthWrite: false }));
    ground(disc, 0.028);
    disc.scale.setScalar(0.46);
    // ícone em cima, sem somar luz (só a cor)
    const ico = new THREE.Sprite(new THREE.SpriteMaterial({ map: groundIcon(RUNE_ICON[kind]), color: c, transparent: true, opacity: 0.95, depthWrite: false }));
    ico.scale.setScalar(0.75);
    ico.position.y = 1.55;
    g.add(gem, base, disc, ico);
    let tick: (now: number) => void;
    if (kind === 'haste') {
      // duas asas batendo e giro rápido; no modo completo, faíscas ficando para trás
      const wing = new THREE.Shape();
      wing.moveTo(0, 0);
      wing.quadraticCurveTo(0.25, 0.22, 0.48, 0.16);
      wing.quadraticCurveTo(0.3, 0.05, 0.42, -0.04);
      wing.quadraticCurveTo(0.2, -0.02, 0, 0);
      const wmat = new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: c, emissiveIntensity: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const wings = [1, -1].map((sx) => {
        const w = new THREE.Mesh(new THREE.ShapeGeometry(wing), wmat);
        w.scale.x = sx;
        gem.add(w);
        return w;
      });
      tick = (now) => {
        gem.rotation.y = now * 6;
        const flap = Math.sin(now * 14) * 0.6;
        wings[0].rotation.y = flap;
        wings[1].rotation.y = -flap;
        if (!lite && Math.random() < 0.15) burst(v(g.position.x + Math.cos(-now * 6) * 0.45, g.position.z + Math.sin(-now * 6) * 0.45), c, 0.25, 0.5, gem.position.y, glow);
      };
    } else if (kind === 'fury') {
      // espinhos em volta pulsando e uma chama fraca subindo
      const spikes = new THREE.Group();
      const sgeo = new THREE.ConeGeometry(0.05, 0.22, 5);
      const smat = flat('#7f1d1d', '#ef4444', 0.35);
      for (let k = 0; k < 8; k++) {
        const sp = new THREE.Mesh(sgeo, smat);
        const a = (k / 8) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), k % 2 ? 0.5 : -0.3, Math.sin(a)).normalize();
        sp.position.copy(dir.clone().multiplyScalar(0.24));
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        spikes.add(sp);
      }
      gem.add(spikes);
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAMES[0], color: '#ff6a3a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      fire.scale.setScalar(0.7);
      fire.position.y = 0.15;
      gem.add(fire);
      tick = (now) => {
        gem.rotation.y = now * 1.5;
        spikes.scale.setScalar(1 + 0.18 * Math.max(0, Math.sin(now * 8)));
        fire.material.map = FLAMES[Math.floor(now * 12) % FLAMES.length];
      };
    } else if (kind === 'shield') {
      // bolha translúcida em volta da pedra, respirando devagar
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 16), new THREE.MeshStandardMaterial({ color: '#93c5fd', emissive: c, emissiveIntensity: 0.15, transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false }));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.012, 6, 40), new THREE.MeshBasicMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.4 }));
      rim.rotation.x = Math.PI / 2;
      gem.add(bubble, rim);
      tick = (now) => {
        gem.rotation.y = now * 1.2;
        bubble.scale.setScalar(1 + 0.05 * Math.sin(now * 2.5));
      };
    } else {
      // dois anéis (dourado e roxo) girando em eixos diferentes e um relógio no chão com o ponteiro andando
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 6, 40), flat('#fde68a', '#facc15', 0.3));
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 6, 40), flat('#d8b4fe', '#a855f7', 0.3));
      gem.add(r1, r2);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.36), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.6 }));
      hand.position.z = -0.18;
      const pivot = new THREE.Group();
      pivot.position.y = 0.035;
      pivot.add(hand);
      const marks = mergeGeometries(Array.from({ length: 12 }, (_, k) => new THREE.RingGeometry(0.38, 0.44, 1, 1, (k / 12) * Math.PI * 2 - 0.04, 0.08)));
      const dial = new THREE.Mesh(marks, new THREE.MeshBasicMaterial({ color: '#c084fc', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      ground(dial, 0.032);
      g.add(pivot, dial);
      tick = (now) => {
        r1.rotation.set(now * 1.7, now * 0.6, 0);
        r2.rotation.set(Math.PI / 2, now * -2.2, now * 0.9);
        core.rotation.y = now * 1.2;
        pivot.rotation.y = -now * 3;
      };
    }
    scene.add(g);
    return {
      g,
      tick: (now) => {
        gem.position.y = 0.7 + Math.sin(now * 3) * 0.08;
        tick(now);
      },
    };
  }

  // chão dos choques, cada tipo com borda nítida no raio real, cor, movimento e ícone próprios; apaga no último 0,8 s
  // queimando: brasa laranja tremulando; lento: névoa de gelo com borda tracejada; redemoinho: três braços roxos girando para o centro
  const ZONE_LOOK: Record<ZoneKind, { fill: string; edge: string; tex: THREE.Texture; texColor: string; icon: string; mark: string; add: boolean }> = {
    burn: { fill: '#ff3d0a', edge: '#ffb347', tex: FX.fire, texColor: '#ff5a10', icon: STATUS_ICONS.find(([b]) => b === 512)![1], mark: '#ffe0a0', add: true },
    slow: { fill: '#2f8cff', edge: '#e2f4ff', tex: FX.smoke, texColor: '#7cc4ff', icon: STATUS_ICONS.find(([b]) => b === 4)![1], mark: '#0b2a4a', add: false },
    pull: { fill: '#6a2cff', edge: '#c9a8ff', tex: FX.twirl, texColor: '#b48cff', icon: STATUS_ICONS.find(([b]) => b === 2097152)![1], mark: '#f0e6ff', add: true },
  };
  const edgeGeo = new THREE.RingGeometry(0.93, 1, 64);
  const dashGeo = mergeGeometries(Array.from({ length: 20 }, (_, i) => new THREE.RingGeometry(0.92, 1, 3, 1, (i / 20) * Math.PI * 2, ((Math.PI * 2) / 20) * 0.55)));
  const texGeo = new THREE.PlaneGeometry(2, 2);
  type ZoneDraw = { g: THREE.Group; fill: THREE.MeshBasicMaterial; edge: THREE.Mesh; dash: THREE.Mesh; edgeMat: THREE.MeshBasicMaterial; arms: THREE.Group; texMat: THREE.MeshBasicMaterial; mark: THREE.Mesh; markMat: THREE.MeshBasicMaterial; kind: ZoneKind | null };
  const zoneDraws: ZoneDraw[] = [];
  // ícone do sprite (public/icons.svg) desenhado no chão, por baixo dos magos: um símbolo vira imagem branca uma vez só
  const iconTex = new Map<string, THREE.CanvasTexture>();
  const iconSprite = fetch('/icons.svg').then((r) => r.text()).catch(() => '');
  function groundIcon(id: string) {
    let tex = iconTex.get(id);
    if (tex) return tex;
    const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
    iconTex.set(id, (tex = new THREE.CanvasTexture(c)));
    void iconSprite.then((svg) => {
      const sym = new DOMParser().parseFromString(svg, 'image/svg+xml').getElementById(id);
      if (!sym) return;
      const img = new Image();
      img.onload = () => {
        c.getContext('2d')!.drawImage(img, 8, 8, 112, 112);
        tex.needsUpdate = true;
      };
      img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="#fff">${sym.innerHTML}</svg>`);
    });
    return tex;
  }
  function zoneDraw(): ZoneDraw {
    const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => ground(new THREE.Mesh(geo, mat), y);
    const fill = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const edgeMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const texMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const edge = flat(edgeGeo, edgeMat, 0.04);
    const dash = flat(dashGeo, edgeMat, 0.04);
    // gira em torno do centro; o redemoinho usa os três braços, os outros só o primeiro
    const arms = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = flat(texGeo, texMat, 0.037 + i * 0.001);
      a.rotation.z = (i / 3) * Math.PI * 2;
      arms.add(a);
    }
    const markMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const mark = flat(texGeo, markMat, 0.042);
    const g = new THREE.Group();
    g.add(flat(discGeo, fill, 0.033), arms, edge, dash, mark);
    scene.add(g);
    return { g, fill, edge, dash, edgeMat, arms, texMat, mark, markMat, kind: null };
  }
  function syncZones(list: ZoneView[], now: number, dt: number) {
    while (zoneDraws.length < list.length) zoneDraws.push(zoneDraw());
    zoneDraws.forEach((d, i) => {
      const z = list[i];
      d.g.visible = !!z;
      if (!z) return;
      const L = ZONE_LOOK[z.kind];
      if (d.kind !== z.kind) {
        d.kind = z.kind;
        d.fill.color.set(L.fill);
        d.edgeMat.color.set(L.edge);
        d.texMat.map = L.tex;
        d.texMat.color.set(L.texColor);
        d.texMat.blending = L.add ? THREE.AdditiveBlending : THREE.NormalBlending;
        d.texMat.needsUpdate = true;
        d.edge.visible = z.kind !== 'slow';
        d.dash.visible = z.kind === 'slow';
        d.arms.children.forEach((a, k) => (a.visible = z.kind === 'pull' || k === 0));
        d.markMat.map = groundIcon(L.icon);
        d.markMat.color.set(L.mark);
        d.markMat.needsUpdate = true;
      }
      d.g.position.copy(w3(z.pos, 0));
      d.g.scale.setScalar(z.r);
      d.mark.scale.setScalar(0.42 / z.r); // ícone de ~0,84 m, qualquer que seja o raio
      const fade = Math.min(1, z.left / 0.8);
      const flicker = 0.8 + 0.2 * Math.sin(now * 13 + i) * Math.sin(now * 7.7 + i * 3);
      d.fill.opacity = (z.kind === 'slow' ? (mobile ? 0.6 : 0.42) : 0.24) * fade;
      d.edgeMat.opacity = (z.kind === 'burn' ? flicker : 0.95) * fade;
      d.texMat.opacity = (z.kind === 'pull' ? 0.85 : z.kind === 'burn' ? 0.75 * flicker : 0.4) * fade;
      d.arms.rotation.y += (z.kind === 'pull' ? 2.6 : z.kind === 'slow' ? 0.15 : 0.4) * dt;
      if (z.kind === 'slow') d.dash.rotation.z += 0.25 * dt;
      d.markMat.opacity = 0.9 * fade;
      // brasas subindo e brilhos de gelo (só no modo completo)
      if (!lite && fade > 0.5) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * z.r * 0.9;
        const at = v(z.pos.x + Math.cos(a) * rr, z.pos.y + Math.sin(a) * rr);
        if (z.kind === 'burn' && Math.random() < 0.35 * z.r) burst(at, Math.random() < 0.5 ? '#ff7a1a' : '#ffb347', 0.35, 0.8, 0.1, FLAMES[Math.floor(Math.random() * FLAMES.length)], 0.7);
        else if (z.kind === 'slow' && Math.random() < 0.12 * z.r) burst(at, '#e2f4ff', 0.4, 0.7, 0.15, FX.star);
      }
    });
  }

  // ilhas de refúgio (sim.ts): disco de pedra rente à lava com a beira de lava (ambientCG Lava005) que come a pedra quando
  // alguém pisa, pedras do KayKit Hexagon na beira afundando junto e vapor (Kenney Smoke) enquanto encolhe
  const PUFFS = ['puff_0', 'puff_1', 'puff_2'].map(fxTex);
  const isleSide = new THREE.MeshStandardMaterial({ color: '#2a1610', roughness: 1, emissive: '#ff4a10', emissiveIntensity: 0.25 });
  const lava005 = tex('/tex/lava005.jpg');
  // beira derretida: a crosta da textura escura e as rachaduras acesas (brilho da própria textura)
  const isleLava = new THREE.MeshStandardMaterial({ map: lava005, color: '#5a2a1a', emissive: '#ff5a14', emissiveMap: lava005, emissiveIntensity: 2.2, roughness: 1 });
  const isleStone = new THREE.MeshStandardMaterial({ map: tex('/tex/stone.jpg'), color: '#b8aaa0', roughness: 1, emissive: '#3a0c02', emissiveIntensity: 0.4 });
  const isleBaseGeo = new THREE.CylinderGeometry(1, 1.15, 0.6, 28);
  const isleTopGeo = new THREE.CylinderGeometry(1, 1, 0.06, 28);
  const rockModels: THREE.Object3D[] = [];
  for (const k of ['A', 'B', 'C', 'D', 'E']) gltf.loadAsync(`/models/hex/rock_single_${k}.gltf`).then((g) => rockModels.push(g.scene)).catch(() => {});
  type IsleDraw = { g: THREE.Group; top: THREE.Mesh; rocks: THREE.Group; r: number; seen: number; shrinkAt: number };
  const isleDraws: IsleDraw[] = [];
  function isleDraw(i: number): IsleDraw {
    const g = new THREE.Group();
    const base = new THREE.Mesh(isleBaseGeo, [isleSide, isleLava, isleSide]);
    base.position.y = -0.305; // topo de lava 0,5 cm acima da lava do mar
    const top = new THREE.Mesh(isleTopGeo, isleStone);
    top.position.y = 0.01; // pedra 4 cm acima do chão da arena: dá para ver que é pedra firme
    top.receiveShadow = true;
    const rocks = new THREE.Group();
    g.add(base, top, rocks);
    scene.add(g);
    return { g, top, rocks, r: -1, seen: i, shrinkAt: -1 };
  }
  function syncIsles(list: Isle[], now: number, dt: number) {
    while (isleDraws.length < list.length) isleDraws.push(isleDraw(isleDraws.length));
    isleDraws.forEach((d, i) => {
      const it = list[i];
      d.g.visible = !!it && it.r > 0.02;
      if (!it) {
        d.r = -1;
        return;
      }
      // pedras da beira: quando os modelos chegam (um jeito por ilha, sempre o mesmo)
      if (!d.rocks.children.length && rockModels.length === 5) {
        for (let k = 0; k < 4; k++) {
          const o = rockModels[(i + k * 2) % 5].clone(true);
          const box = new THREE.Box3().setFromObject(o);
          o.scale.setScalar(0.42 / Math.max(0.01, box.max.x - box.min.x));
          const a = (k / 4) * Math.PI * 2 + i * 1.3;
          o.position.set(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82);
          o.rotation.y = a * 3;
          d.rocks.add(o);
        }
      }
      // a ilha chega junto com a borda: anda devagar até o lugar novo, e o raio acompanha sem saltos
      const to = w3(it.pos);
      if (d.r < 0 || d.g.position.distanceTo(to) > 3) d.g.position.copy(to); // rodada nova: aparece direto no lugar
      else d.g.position.lerp(to, Math.min(1, dt * 4));
      if (d.r >= 0 && it.r < d.r - 1e-4) d.shrinkAt = now;
      d.r = d.r < 0 ? it.r : d.r + (it.r - d.r) * Math.min(1, dt * 8);
      const melt = 1 - d.r / ISLAND.r;
      d.g.scale.set(d.r, 1, d.r);
      // a lava come a pedra de fora para dentro: a beira de lava engrossa e a pedra afunda um pouco
      const k = 0.84 - 0.34 * melt;
      d.top.scale.set(k, 1, k);
      d.top.position.y = 0.01 - 0.04 * melt;
      d.rocks.children.forEach((o, n) => (o.position.y = -0.45 * melt - 0.08 * n * melt));
      d.rocks.visible = d.r > 0.3;
      // vapor enquanto encolhe (no modo leve, bem menos)
      if (now - d.shrinkAt < 0.3 && Math.random() < (lite ? 0.02 : 0.08)) {
        const a = Math.random() * Math.PI * 2;
        const at = v(it.pos.x + Math.cos(a) * d.r * 0.9, it.pos.y + Math.sin(a) * d.r * 0.9);
        puff(at, 0.6 + Math.random() * 0.4, 1.4);
      }
    });
  }
  // vapor claro que sobe da lava (Kenney Smoke, mistura normal)
  function puff(at: Vec, size: number, secs: number) {
    if (fx.length > FX_CAP) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: PUFFS[Math.floor(Math.random() * PUFFS.length)], color: '#b0a49c', transparent: true, opacity: 0.35, depthWrite: false, rotation: Math.random() * Math.PI * 2 }));
    s.position.copy(w3(at, 0.2));
    addFx(s, secs, (k) => {
      s.scale.setScalar(size * (0.5 + k));
      s.position.y = 0.2 + k * 1.6;
      s.material.opacity = 0.35 * (1 - k);
    });
  }

  function syncPillars(list: PillarView[]) {
    const changed = list.length !== pillarMeshes.length || list.some((p, i) => p.pos.x !== pillarMeshes[i].pos.x || p.pos.y !== pillarMeshes[i].pos.y);
    const radius = (p: PillarView) => OBSTACLES[p.kind].r;
    if (changed) {
      for (const p of pillarMeshes) {
        scene.remove(p.obj);
        p.bar?.remove();
      }
      pillarMeshes.length = 0;
      let run = 0; // pedaços de parede seguidos: a simulação põe cada parede como [meio, lado, lado]
      list.forEach((p, i) => {
        run = p.kind === 'rockpillar' ? run + 1 : 0;
        const wall = p.kind === 'rockpillar' && run % 3 === 1 && list[i + 2]?.kind === 'rockpillar';
        const side = p.kind === 'rockpillar' && !wall; // os lados não têm modelo nem barra (a vida é a da parede)
        let obj: THREE.Object3D;
        if (wall) obj = makeWall(v(list[i + 2].pos.x - list[i + 1].pos.x, list[i + 2].pos.y - list[i + 1].pos.y));
        else if (side) obj = new THREE.Group();
        else {
          obj = (p.kind === 'chest' ? makeChest() : decor.clone(OBSTACLE_MODEL[p.kind])) ?? new THREE.Mesh(new THREE.CylinderGeometry(radius(p), radius(p), 2.2, 12), new THREE.MeshStandardMaterial({ color: '#6b625c' }));
          // ajusta a largura do modelo ao raio de colisão do pilar
          const box = new THREE.Box3().setFromObject(obj);
          const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
          // árvore é fina no tronco e larga nos galhos: mede pelo tronco (menos que a copa)
          obj.scale.multiplyScalar((radius(p) * (p.kind === 'tree' ? 6 : 2.3)) / width);
        }
        obj.position.copy(w3(p.pos, 0));
        scene.add(obj);
        // barra de vida em tudo que quebra (pedido do Fernando, 17/10: sempre visível)
        let bar: HTMLDivElement | null = null, fill: HTMLDivElement | null = null;
        if (Number.isFinite(OBSTACLES[p.kind].hp) && !side) {
          fill = el('div');
          bar = el('div', { class: 'obstacle-hp' + (p.kind === 'chest' ? ' chest' : '') }, fill);
          labels.append(bar);
        }
        const height = new THREE.Box3().setFromObject(obj).max.y;
        pillarMeshes.push({ obj, pos: p.pos, bar, fill, height });
        // a lista muda no meio da rodada (baú, Pilar de pedra): o que já tinha quebrado não afunda de novo
        if (p.hp <= 0) obj.position.y = -3;
      });
    }
    list.forEach((p, i) => {
      const m = pillarMeshes[i];
      if (p.hp <= 0) {
        m.obj.position.y = Math.max(-3, m.obj.position.y - 0.05);
        m.obj.visible = m.obj.position.y > -2.9;
        if (m.bar) m.bar.hidden = true;
      } else {
        // tremida curta quando apanha
        const shake = p.hp < 100 ? (100 - p.hp) / 100 : 0;
        if (m.fill) m.fill.style.width = `${p.hp}%`;
        m.obj.rotation.z = Math.sin(performance.now() / 40) * 0.02 * shake;
      }
    });
  }

  // anel que se expande no chão até o raio da área
  function shockwave(at: Vec, radius: number, color: string) {
    const ring = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(w3(at, 0.06));
    addFx(ring, 0.45, (k) => {
      ring.scale.setScalar(Math.max(0.01, radius * (0.2 + 0.8 * k)));
      (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
  }

  // acerto: clarão branco, bola de fogo, onda no chão e faíscas; durava 0,3 s e quase não se via (relato do Fernando, 17/10)
  function explosion(at: Vec) {
    burst(at, '#ffffff', 2.2, 0.18, 0.9, FX.light);
    flameBurst(at, 3.6, 0.55);
    burst(at, '#ffb347', 3, 0.5, 0.8, FX.fire);
    burst(at, '#ff6a10', 4.8, 0.45, 0.8, FX.light);
    burst(at, '#ff8a3a', 3.6, 0.55, 0.15, FX.circle);
    for (let i = 0; i < 6; i++) burst(v(at.x + (Math.random() - 0.5) * 0.9, at.y + (Math.random() - 0.5) * 0.9), '#ffd27a', 1.1, 0.6, 0.9, FX.spark, 1.6);
    smoke(at, 2.2, 1.3);
  }

  function zap(at: Vec) {
    burst(at, '#ffffff', 2.2, 0.18, 1, FX.light);
    burst(at, '#9fd0ff', 4.4, 0.6, 1, FX.light);
    burst(at, '#e6f4ff', 2.8, 0.5, 1, FX.spark);
    burst(at, '#6fb6ff', 3.8, 0.6, 0.15, FX.circle);
  }

  function bolt(from: Vec, to: Vec) {
    const pts: THREE.Vector3[] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const p = w3(v(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n), 1);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5));
      pts.push(p);
    }
    // três traços tortos sobrepostos para o raio parecer grosso (linha de WebGL tem 1 px)
    for (let j = 0; j < 3; j++) {
      const jit = pts.map((p, i) => (i === 0 || i === n ? p : p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.18))));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(jit), new THREE.LineBasicMaterial({ color: j ? '#9fd0ff' : '#ffffff', transparent: true, blending: THREE.AdditiveBlending }));
      addFx(line, 0.35, (k) => ((line.material as THREE.LineBasicMaterial).opacity = 1 - k));
    }
    burst(to, '#9fd0ff', 2.4, 0.3, 1, FX.light);
    burst(to, '#e6f4ff', 1.4, 0.35, 1, FX.spark);
    burst(from, '#9fd0ff', 1.2, 0.2, 1, FX.light);
  }

  function onEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.k === 'cast') oneShot(e.id, castAnim(e.spell), 0.55);
      else if (e.k === 'hit') {
        oneShot(e.id, 'Hit_A', 0.45);
        // o acerto do raio tem impacto elétrico próprio: a explosão de fogo cobria o raio e parecia que ele não tinha saído
        if (e.src === 'lightning') zap(v(e.x, e.y));
        else explosion(v(e.x, e.y));
        scorch(v(e.x, e.y));
        damageNumber(v(e.x, e.y), e.dmg);
        // dano 0 (invulnerável, aliado) não sacode nem acende
        if (e.dmg > 0) impact(e.id, v(e.x, e.y), e.dmg);
      } else if (e.k === 'gold') goldNumber(v(e.x, e.y), e.n);
      else if (e.k === 'reflect') {
        burst(v(e.x, e.y), '#8fd3ff', 2.4, 0.3, 0.8, FX.circle);
        burst(v(e.x, e.y), '#cfeaff', 1.6, 0.25, 0.8, FX.light);
      }
      else if (e.k === 'lightning') bolt(e.from, e.to);
      else if (e.k === 'grip') {
        burst(v(e.x, e.y), '#e0203a', 2.4, 0.5, 0.8, FX.magic);
        burst(v(e.x, e.y), '#ffd0d8', 1.6, 0.3, 0.8, FX.light);
        shockwave(v(e.x, e.y), 1.2, '#e0203a');
      }
      else if (e.k === 'teleport') {
        burst(e.from, '#c49bff', 2.4, 0.45, 0.8, FX.magic);
        burst(e.to, '#c49bff', 2.6, 0.45, 0.8, FX.magic);
        burst(e.to, '#e9d8ff', 1.6, 0.3, 0.8, FX.light);
      } else if (e.k === 'item' && e.item === 'scourge') {
        // preparo do Flagelo: brasa crescendo em volta de quem vai explodir
        const m = mages.get(e.id);
        if (m) {
          const at = v(m.root.position.x, m.root.position.z);
          burst(at, '#ff5a1a', 3, 0.9, 0.6, FX.magic);
          burst(at, '#ffb347', 1.6, 0.9, 1.2, FX.light);
        }
      } else if (e.k === 'item' && e.item === 'pact') {
        const m = mages.get(e.id);
        if (m) burst(v(m.root.position.x, m.root.position.z), '#c2122a', 2.6, 0.6, 1, FX.magic);
      } else if (e.k === 'scourge') {
        shockwave(v(e.x, e.y), e.r, '#ff7a1a');
        explosion(v(e.x, e.y));
      } else if (e.k === 'pillar') {
        // projétil batendo em obstáculo também explode
        explosion(v(e.x, e.y));
        burst(v(e.x, e.y), '#d8c8b8', 1.4, 0.3, 1.2, FX.smoke);
      } else if (e.k === 'clash') {
        const at = v(e.x, e.y);
        groundMark(at, e.combo, e.r);
        if (e.combo !== 'pillar' && e.combo !== 'snow') {
          shake = Math.min(0.6, shake + e.r * 0.15);
          burst(at, '#fff1d0', e.r * 2.2, 0.25, 0.9, FX.light);
          burst(at, '#ffb347', e.r * 1.8, 0.5, 0.9, FX.fire);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            burst(v(at.x + Math.cos(a) * e.r * 0.5, at.y + Math.sin(a) * e.r * 0.5), '#ffd27a', 1.1, 0.5, 0.9, FX.spark, 1.5);
          }
        }
        if (e.combo === 'fire') {
          shockwave(at, e.r, '#ff7a1a');
          explosion(at);
          scorch(at);
        } else if (e.combo === 'arcane') {
          shockwave(at, e.r, '#c46bff');
          shockwave(at, e.r * 0.6, '#ffb347');
          burst(at, '#c46bff', 3.6, 0.5, 0.9, FX.magic);
          burst(at, '#ffd27a', 2.8, 0.4, 0.9, FX.fire);
          smoke(at, 2, 1.2);
        } else if (e.combo === 'snow') {
          shockwave(at, e.r, '#e8f8ff');
          burst(at, '#ffffff', e.r * 2, 0.4, 0.8, FX.smoke);
          burst(at, '#bfe8ff', e.r * 1.4, 0.35, 0.9, FX.spark);
        } else if (e.combo === 'detonate') {
          shockwave(at, e.r, '#9fd0ff');
          burst(at, '#e6f4ff', 2.6, 0.35, 0.9, FX.spark);
          explosion(at);
          scorch(at);
        } else {
          shockwave(at, e.r, '#b98cff');
          burst(at, '#b98cff', 2.2, 0.4, 0.9, FX.magic);
        }
      } else if (e.k === 'redirect') {
        burst(v(e.x, e.y), '#b98cff', 2, 0.35, 0.9, FX.circle);
      } else if (e.k === 'death') {
        const m = mages.get(e.id);
        if (m) {
          const at = v(m.root.position.x, m.root.position.z);
          // fora da pedra: caiu na lava (respingo); em cima dela: estoura em fogo
          if (inLavaAt(shownArena, shownR, shownIsles, at, 0.3)) lavaSplash(at);
          else {
            burst(at, '#ffcf5a', 4, 0.6, 0.3, FX.fire);
            smoke(at, 2.6, 1.6);
          }
        }
      }
    }
  }

  function syncProjectiles(list: ProjView[]) {
    const seen = new Set<number>();
    for (const p of list) {
      if (p.kind === 'illusion') continue;
      seen.add(p.id);
      let g = projs.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const look = LOOK[p.kind];
        const core = SHAPES[p.kind]?.() ?? new THREE.Mesh(ballGeo, look.mat);
        core.scale.multiplyScalar(look.size);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.light, color: look.halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.scale.setScalar(1.2 * look.size);
        halo.material.opacity = 0.7;
        g.add(core, halo);
        if (p.kind === 'warpzone') {
          core.scale.setScalar(p.vel.x); // vel.x = raio
          halo.visible = false;
        }
        // fogo de verdade: chama animada em volta dos projéteis de fogo; redemoinho na Gravidade e na Zona de dobra
        if (FIRE_KINDS.has(p.kind)) {
          const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAMES[0], color: '#ffc060', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          flame.name = 'flame';
          flame.scale.setScalar(1.3 * look.size);
          g.add(flame);
        } else if (p.kind === 'gravity' || p.kind === 'warpzone') {
          const swirl = new THREE.Sprite(new THREE.SpriteMaterial({ map: p.kind === 'gravity' ? FX.twirl : FX.twirl2, color: p.kind === 'gravity' ? '#7a5cff' : '#5ab0ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
          swirl.name = 'swirl';
          swirl.scale.setScalar(p.kind === 'gravity' ? 1.6 * look.size : p.vel.x * 2.2);
          g.add(swirl);
        }
        if (p.kind === 'link') {
          // fio do Elo até quem lançou (vel = posição dele)
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7ab8ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
          g.add(beam);
        }
        if (p.kind === 'meteor') {
          // aviso no chão: círculo do tamanho da explosão, que pulsa até a pedra cair
          const warn = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: FX.circle, color: '#ff3a1a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          warn.rotation.x = -Math.PI / 2;
          warn.scale.setScalar((p.vel.x * 2) / 1.6);
          warn.name = 'warn';
          g.add(warn);
        }
        scene.add(g);
        projs.set(p.id, g);
      }
      if (p.kind === 'meteor') {
        const y = 0.9 + p.vel.y * 8; // vel.y = segundos até cair
        g.position.copy(w3(p.pos, y));
        const warn = g.getObjectByName('warn') as THREE.Mesh;
        warn.position.y = 0.04 - y;
        (warn.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(performance.now() / 70);
      } else if (p.kind === 'warpzone') g.position.copy(w3(p.pos, 0));
      else g.position.copy(w3(p.pos, 0.9));
      if (p.kind === 'link') {
        const dx = p.vel.x - p.pos.x, dz = p.vel.y - p.pos.y;
        const beam = g.children[2];
        beam.position.set(dx / 2, 0, dz / 2);
        beam.rotation.y = Math.atan2(dx, dz);
        beam.scale.set(1, 1, Math.hypot(dx, dz));
      }
      // giro e direção: aponta para onde voa; anéis, bumerangue e pedras giram
      const body = g.children[0];
      const t = performance.now() / 1000;
      if (p.kind !== 'meteor' && p.kind !== 'warpzone' && p.kind !== 'link' && (p.vel.x || p.vel.y)) body.rotation.y = Math.atan2(p.vel.x, p.vel.y);
      if (p.kind === 'boomerang') body.rotation.y = t * 18;
      else if (p.kind === 'fireball' || p.kind === 'meteor' || p.kind === 'cluster' || p.kind === 'bouncer' || p.kind === 'snowball' || p.kind === 'splitter' || p.kind === 'shard') body.rotation.set(t * 3, t * 4, 0);
      else if (p.kind === 'link') body.rotation.y = t * 6;
      body.traverse((o) => {
        if (o !== body && o.name === 'spin') o.rotation.y = t * 6; // anel simétrico: girar no próprio eixo não aparece
      });
      const flame = g.getObjectByName('flame') as THREE.Sprite | undefined;
      if (flame) {
        flame.material.map = FLAMES[Math.floor(t * 16 + p.id) % FLAMES.length];
        flame.material.rotation = Math.atan2(-p.vel.x, p.vel.y) + Math.PI; // a chama "puxa" para trás
        flame.scale.setScalar(LOOK[p.kind].size * (1.2 + 0.15 * Math.sin(t * 30 + p.id)));
      }
      const swirl = g.getObjectByName('swirl') as THREE.Sprite | undefined;
      if (swirl) swirl.material.rotation = -t * 4;
      // rastro: brasas que ficam para trás e somem
      const look = LOOK[p.kind];
      if (p.kind !== 'warpzone' && Math.random() < (lite ? 0.35 : 0.7)) burst(p.pos, look.trail, 1.1 * look.size, 0.35, 0.9, FIRE_KINDS.has(p.kind) ? FLAMES[Math.floor(Math.random() * FLAMES.length)] : look.tex);
    }
    for (const [id, g] of projs) if (!seen.has(id)) {
      scene.remove(g);
      dispose(g); // corpo, halo e aviso são de cada projétil (geometrias compartilhadas ficam)
      projs.delete(id);
    }
  }

  function syncWizards(list: WizDraw[], now: number) {
    const seen = new Set<string>();
    for (const d of list) {
      let m = mages.get(d.id);
      const look = d.look ?? lookOf(d.character as CharacterId);
      // trocou de aparência (vale até no meio da luta): o boneco novo entra quando estiver montado, e só então o antigo sai
      if (!m || m.look !== look) {
        const made = makeMage(d, look);
        if (!made && !m) continue;
        if (made && m) {
          unburn(m);
          scene.remove(m.root);
          for (const o of [m.ring, m.shield, m.aura]) (o.material as THREE.Material).dispose();
          for (const x of m.mats) x.m.dispose();
          m.label.remove();
        }
        if (made) mages.set(d.id, (m = made));
      }
      if (!m) continue;
      seen.add(d.id);
      // modo Times: anel e barra na cor do time (pode mudar a cada rodada); o nome fica com a cor do jogador
      const tint = d.team != null ? TEAM_COLORS[d.team] : COLORS[d.color];
      if (m.tint !== tint) {
        m.tint = tint;
        (m.ring.material as THREE.MeshBasicMaterial).color.set(tint);
        m.hpFill.style.background = tint;
        m.nameEl.style.color = d.team != null ? COLORS[d.color] : '';
      }
      const hidden = !d.illusion && (d.status & 2048) > 0; // a cópia é sempre visível; os inimigos não veem o jogador velado
      m.root.visible = !hidden;
      // A cópia é sólida e visível; a invisibilidade vale somente para o jogador real.
      const ghost = !!d.ghost || (d.status & 1024) > 0; // efeito translúcido da Caminhada no vento, também usado no véu visto por si
      if (m.ghost !== ghost) {
        m.ghost = ghost;
        for (const x of m.ghostMats) Object.assign(x.m, { transparent: ghost || x.transparent, opacity: ghost ? x.opacity * (d.ghost ? 0.45 : 0.35) : x.opacity, needsUpdate: true });
        m.label.style.opacity = ghost ? '0.6' : '';
      }
      m.root.position.copy(w3(d.pos));
      m.root.rotation.y = Math.PI / 2 - d.facing;
      // Escudo: bolha no raio real que vai apagando, e a barrinha do tempo que falta
      if (d.shield && !m.shield.visible) m.shieldSince = now;
      m.shield.visible = d.shield && d.alive;
      if (d.shieldR) m.shield.scale.setScalar(d.shieldR / 0.85);
      const shieldLeft = Math.max(0, 1 - (now - m.shieldSince) / SHIELD_SECS);
      (m.shield.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.28 * shieldLeft;
      m.shieldBar.hidden = !m.shield.visible;
      if (m.shield.visible) m.shieldFill.style.width = `${shieldLeft * 100}%`;
      // anel no chão: dourado pulsando invulnerável (começo da rodada), azul da runa com Escudo de runa
      const invuln = (d.status & 32) > 0, armor = (d.status & 1048576) > 0; // runa do Escudo: −30% de dano
      m.aura.visible = d.alive && (invuln || armor);
      if (m.aura.visible) {
        const mat = m.aura.material as THREE.MeshBasicMaterial;
        mat.color.set(invuln ? '#ffd36a' : RUNE_COLOR.shield);
        mat.opacity = invuln ? 0.55 + 0.3 * Math.sin(now * 8) : 0.8;
      }
      m.ring.visible = d.alive;
      if (!d.alive) {
        if (!m.dead) {
          m.dead = true;
          play(m, 'Death_A', 0.1);
          // caiu na lava (fora da pedra e fora das ilhas): o corpo queima
          if (inLavaAt(shownArena, shownR, shownIsles, d.pos)) {
            m.burnAt = now;
            loadFile(BONES);
          }
        }
        if (m.burnAt >= 0) burnCorpse(m, now - m.burnAt, d.pos);
      } else {
        if (m.dead) {
          m.dead = false;
          unburn(m);
        }
        if (now > m.oneShotUntil) play(m, d.cheer ? 'Cheer' : d.moving ? 'Running_A' : 'Idle');
        // vencedor: estouro dourado ao começar a comemorar e faíscas subindo enquanto dura
        if (d.cheer && !m.cheering) victoryBurst(d.pos);
        if (d.cheer && !lite && Math.random() < 0.2) burst(v(d.pos.x + (Math.random() - 0.5) * 1.4, d.pos.y + (Math.random() - 0.5) * 1.4), Math.random() < 0.5 ? '#ffd84a' : '#fff2a0', 0.7, 1.2, 0.4, FX.star, 2.6);
      }
      m.cheering = d.cheer && d.alive;
      // clarão branco do golpe: some em ~0,15 s
      if (m.flash > 0) {
        m.flash = Math.max(0, m.flash - 0.12);
        for (const x of m.mats) {
          if (m.flash > 0) {
            x.m.emissive.setRGB(1, 0.95, 0.85);
            x.m.emissiveIntensity = m.flash * 1.6;
          } else {
            x.m.emissive.copy(x.c);
            x.m.emissiveIntensity = x.i;
          }
        }
      }
      m.label.hidden = !d.alive || hidden;
      // ícones de efeito em cima do mago (negativos primeiro)
      if (m.statusKey !== d.status) {
        m.statusKey = d.status;
        m.statusClocks.clear();
        m.statusEl.replaceChildren(...STATUS_ICONS.filter(([bit]) => d.status & bit && bit !== 131072).map(([bit, ico, name]) => {
          const c = el('b', { class: 'fx-clock', 'aria-hidden': 'true' });
          m.statusClocks.set(bit, c);
          return el('i', { title: name, class: BAD_STATUS.includes(bit) ? 'bad' : 'good' }, c, icon(ico));
        }));
      }
      // reloginho em cima de cada efeito com prazo: os mesmos segundos da fileira acima da barra (mesma conta, fxClock)
      for (const [bit, c] of m.statusClocks) {
        const left = d.fx ? m.clock(d.fx, bit) : null;
        c.textContent = left?.text ?? '';
        c.style.setProperty('--left', left ? left.frac.toFixed(3) : '0');
      }
      // Investida na barra (estilo Overwatch): o que ainda absorve vem depois da vida; passando do máximo, a barra inteira encolhe
      const rush = d.rushLeft ?? 0;
      const total = Math.max(d.hpMax, d.hp + rush);
      m.hpFill.style.width = `${Math.max(0, Math.min(100, (d.hp / total) * 100))}%`;
      m.absRush.hidden = !rush;
      if (rush) m.absRush.style.width = `${(rush / total) * 100}%`;
      m.aegisEl.hidden = !(d.status & 131072);
      m.bar.classList.toggle('invuln', invuln);
      // cura: a vida subiu (fora da volta à vida e do começo da rodada, que enchem a barra)
      if (d.alive && m.prevAlive && !invuln && !hidden && d.hp > m.prevHp) {
        const gain = d.hp - m.prevHp;
        if (gain >= HEAL_NOW) {
          healNumber(d.pos, gain);
          m.healAt = now;
        } else m.healSum += gain;
      }
      if (now >= m.healFlushAt) {
        if (m.healSum >= HEAL_SUM && d.alive && !hidden) healNumber(d.pos, m.healSum);
        m.healSum = 0;
        m.healFlushAt = now + 1;
      }
      // brilho verde sutil só nas curas grandes
      m.bar.classList.toggle('heal', now - m.healAt < 0.6);
      // ao lado da barra: +N/s enquanto a vida volta (na pedra, sem vida cheia; na lava não regenera) e o que cada escudo ainda absorve
      const regen = d.alive && d.hp < d.hpMax && (d.regen ?? 0) > 0 && edgeAt(shownArena, shownR, d.pos) >= 0 ? d.regen! : 0;
      const key = `${regen}|${armor}|${rush}`;
      if (m.extraKey !== key) {
        m.extraKey = key;
        const part = (cls: string, text: string, ico?: string) => {
          return el('span', { class: cls }, ico && icon(ico), text);
        };
        m.extraEl.replaceChildren(...[
          regen ? part('regen', `+${Math.round(regen * 10) / 10}/s`) : null,
          armor ? part('rune', `+${Math.round(RUNE.armor * 100)}%`, RUNE_ICON.shield) : null, // + como bônus de defesa (pedido do Sky, 19/10); o dano levado cai 30%
          rush ? part('rush', String(Math.ceil(rush)), ICON.rush) : null,
        ].filter((e) => e !== null));
      }
      m.prevHp = d.hp;
      m.prevAlive = d.alive;
      m.hpText.textContent = `${Math.max(0, Math.ceil(d.hp))}/${d.hpMax}`;
      if (m.botKey !== (d.bot ?? '')) {
        m.botKey = d.bot ?? '';
        m.botEl.hidden = !d.bot;
        m.botEl.replaceChildren(icon(UI_ICON.bot), d.bot ? BOT_LEVEL[d.bot] : '');
      }
      m.lootBar.hidden = !d.loot;
      if (d.loot) m.lootFill.style.width = `${Math.min(100, d.loot * 100)}%`;
    }
    for (const [id, m] of mages) if (!seen.has(id)) {
      m.root.visible = false;
      m.label.hidden = true;
    }
  }

  let focus = new THREE.Vector3();
  // câmera do jogador: roda do mouse aproxima/afasta; Espaço + arrastar desloca (Espaço sozinho volta ao centro)
  let zoom = 1;
  const pan = new THREE.Vector3();
  let lastDist = 20;
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  let composer: EffectComposer | null = null;
  if (!mobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.45, 0.85));
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    // distância para caber a arena inteira; retrato (celular em pé) precisa de mais
    camera.userData.fit = camera.aspect < 1 ? 1 / Math.max(0.5, camera.aspect) : 1;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let lastFrame = performance.now() / 1000;
  // retículo do controle: anel dourado com um ponto no meio, no chão onde o analógico direito mira (desenhado por cima de tudo)
  const aimMat = new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 40), aimMat);
  aimRing.add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), aimMat));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.renderOrder = 10;
  aimRing.visible = false;
  scene.add(aimRing);
  // círculo de alcance da magia segurada ou escolhida: anel fino e discreto na cor da mira, escalado pelo alcance
  const rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.45, depthWrite: false }));
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.renderOrder = 9;
  rangeRing.visible = false;
  scene.add(rangeRing);

  return {
    ready,
    onEvents,
    // centro no mago e raio em metros; null (ou raio 0) esconde
    range(at: Vec | null, r: number) {
      rangeRing.visible = !!at && r > 0;
      if (!at || r <= 0) return;
      rangeRing.position.copy(w3(at, 0.04));
      rangeRing.scale.setScalar(r);
    },
    aim(at: Vec | null) {
      aimRing.visible = !!at;
      if (at) aimRing.position.copy(w3(at, 0.05));
      aimRing.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 120));
    },
    // baixa antes as peças de quem está na sala, para ninguém aparecer invisível na rodada
    preload(looks: string[]) {
      for (const look of looks) void loadLook(look);
    },
    // ponto do chão sob o cursor, em coordenadas da simulação
    pick(clientX: number, clientY: number): Vec | null {
      const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(floorPlane, hit) ? v(hit.x, hit.z) : null;
    },
    clickMarker(at: Vec, cast: boolean) {
      const ring = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: cast ? '#ffb347' : '#7dff9a', transparent: true, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(w3(at, 0.04));
      addFx(ring, 0.45, (k) => {
        ring.scale.setScalar(1 + k * 2);
        (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      });
      // segundo anel que fecha sobre o ponto ("travou aqui") e um pingo de luz no centro
      const lock = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: cast ? '#ffe0a0' : '#c8ffd4', transparent: true, depthWrite: false }));
      lock.rotation.x = -Math.PI / 2;
      lock.position.copy(w3(at, 0.045));
      addFx(lock, 0.3, (k) => {
        lock.scale.setScalar(2.6 - k * 1.8);
        (lock.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * 4) * (1 - k);
      });
      burst(at, cast ? '#ffb347' : '#7dff9a', 0.7, 0.25, 0.08, FX.light);
    },
    // Efeitos: true = Leve (sem tremor, hit-stop e partículas extras)
    setFx(on: boolean) {
      lite = on;
      if (lite) shake = 0;
      for (const s of embers) s.visible = false;
    },
    // balão do taunt em cima do mago por 2,5 s
    bubble(id: string, text: string) {
      const m = mages.get(id);
      if (!m) return false;
      m.label.querySelector('.bubble')?.remove();
      const b = el('div', { class: 'bubble' }, text);
      m.label.prepend(b);
      setTimeout(() => b.remove(), 2500);
      return true;
    },
    zoomBy(deltaY: number) {
      zoom = Math.min(1.7, Math.max(0.45, zoom * Math.exp(deltaY * 0.0012)));
    },
    // arrasto em pixels de tela → deslocamento no chão (o chão "anda junto" com o mouse)
    panBy(dx: number, dy: number) {
      const k = (lastDist * 1.1) / innerHeight;
      pan.x -= dx * k;
      pan.z -= dy * k * 1.3;
      pan.clampLength(0, 30);
    },
    resetCamera() {
      pan.set(0, 0, 0);
    },
    castLocal(id: string, spell: string, at?: Vec) {
      oneShot(id, castAnim(spell), 0.55);
      const m = mages.get(id);
      if (!m || m.dead) return;
      // brilho na mão (um pouco à frente do mago, na cor da magia) e linha de mira fraca até o ponto
      const color = LOOK[spell as keyof typeof LOOK]?.halo ?? '#ffb347';
      const from = v(m.root.position.x, m.root.position.z);
      const dir = at ? Math.atan2(at.y - from.y, at.x - from.x) : Math.PI / 2 - m.root.rotation.y;
      const hand = v(from.x + Math.cos(dir) * 0.45, from.y + Math.sin(dir) * 0.45);
      burst(hand, color, 1.3, 0.35, 1.15, FX.light);
      burst(hand, '#ffffff', 0.6, 0.2, 1.15, FX.light);
      if (!at || Math.hypot(at.x - from.x, at.y - from.y) < 0.8) return;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([w3(hand, 0.9), w3(at, 0.1)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      addFx(line, 0.35, (k) => ((line.material as THREE.LineBasicMaterial).opacity = 0.35 * (1 - k)));
    },
    render(state: { arena: ArenaId; arenaR: number; shrinkIn: number; wizards: WizDraw[]; projectiles: ProjView[]; pillars: PillarView[]; loots: { pos: Vec; left: number }[]; runes: RuneView[]; zones?: ZoneView[]; isles?: Isle[]; follow: Vec | null; lock?: boolean }) {
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - lastFrame);
      lastFrame = now;
      lavaMat.uniforms.uTime.value = now;

      // arena nova (sorteada a cada rodada): troca o chão e a borda
      if (state.arena !== shownArena) {
        shownArena = state.arena;
        arena.geometry.dispose();
        arena.geometry = floorGeo(shownArena);
        shoreU.uSdf.value.dispose();
        shoreU.uSdf.value = sdfTexture(shownArena);
        shoreU.uSpan.value = sdfSpan(shownArena);
        warnR = -1;
      }
      // a decoração em volta se afasta da pedra quando a arena muda ou cresce (rodada nova); no encolhimento fica
      if (state.arena !== decorArena || state.arenaR > decorR + 0.3) decor.layout((p) => edgeAt(state.arena, state.arenaR, p));
      decorR = state.arena !== decorArena || state.arenaR > decorR + 0.3 ? state.arenaR : Math.min(decorR, state.arenaR);
      decorArena = state.arena;
      shownR += (state.arenaR - shownR) * Math.min(1, dt * 4);
      arena.scale.set(shownR, 1, shownR);
      shoreU.uR.value = Math.max(0.01, shownR);
      shoreU.uShoreTime.value = now;
      shoreU.uLick.value = lite ? 0 : 1;
      under.intensity = 52 + Math.sin(now * 2) * 9 + Math.sin(now * 7.3) * 3;
      const warning = state.shrinkIn > 0 && state.shrinkIn < SHRINK_WARN && state.arenaR > 0;
      warnMat.opacity = warning ? 0.25 + 0.25 * Math.sin(now * 14) : 0;
      // borda derretida puxa para o vermelho e pulsa quando a arena vai encolher
      shoreU.uWarn.value = warning ? 0.5 + 0.5 * Math.sin(now * 14) : 0;
      // brasas: sobem da lava em volta da pedra, cada uma com seu ritmo
      if (!lite) for (const s of embers) {
        const u = s.userData as { a: number; r: number; vy: number; size: number; wait: number };
        if (!s.visible) {
          u.wait -= dt;
          if (u.wait > 0) continue;
          // um ponto na lava a até 8 m da pedra (algumas tentativas: a forma pode ter buraco e reentrâncias)
          for (let k = 0; k < 6; k++) {
            u.a = Math.random() * Math.PI * 2;
            u.r = Math.random() * (shownR * ARENAS[shownArena].reach + 8);
            const e = edgeAt(shownArena, shownR, v(Math.cos(u.a) * u.r, Math.sin(u.a) * u.r));
            if (e < -0.8 && e > -8) break;
          }
          u.vy = 0.5 + Math.random() * 0.9;
          u.size = 0.12 + Math.random() * 0.16;
          s.position.set(Math.cos(u.a) * u.r, 0, Math.sin(u.a) * u.r);
          s.visible = true;
        }
        s.position.y += u.vy * dt;
        s.position.x += Math.sin(now * 1.3 + u.a * 5) * 0.25 * dt;
        s.scale.setScalar(u.size * Math.max(0, 1 - (s.position.y + 0.5) / 4));
        if (s.position.y > 3.5) {
          s.visible = false;
          u.wait = Math.random() * 3;
        }
      }
      if (warning && warnR !== state.arenaR) {
        warnR = state.arenaR;
        // entre o contorno de agora e o do próximo tamanho, só onde é pedra que vira lava
        // (no anel o buraco encolhe junto com a forma: lá a lava vira pedra e não pisca)
        const next = Math.max(0.01, state.arenaR - ARENA_STEP), r = state.arenaR;
        warn.geometry.dispose();
        warn.geometry = bandGeo(ARENAS[shownArena].outline.map((loop): [Vec[], Vec[]] => [loop.map((p) => scale(p, r)), loop.map((p) => scale(p, next))]),
          (m) => edgeAt(shownArena, r, m) > 0 && edgeAt(shownArena, next, m) <= 0);
      }

      syncWizards(state.wizards, now);
      syncProjectiles(state.projectiles);
      syncPillars(state.pillars);
      // montes de ouro: um clone do monte por baú quebrado
      while (piles.length < state.loots.length) {
        const c = pile.clone();
        scene.add(c);
        piles.push(c);
      }
      piles.forEach((g, i) => {
        const l = state.loots[i];
        g.visible = !!l;
        if (!l) return;
        g.position.copy(w3(l.pos, 0));
        g.scale.setScalar(0.6 + 0.4 * (l.left / CHEST.pile));
        g.rotation.y = now * 0.6;
      });
      pileShine.opacity = 0.22 + 0.1 * Math.sin(now * 3);
      // uma runa por vez no jogo; cada vaga monta o desenho de cada tipo na primeira vez e mostra o da vez
      while (runeSlots.length < state.runes.length) runeSlots.push({});
      runeSlots.forEach((slot, i) => {
        const rune = state.runes[i];
        for (const k of Object.keys(slot) as RuneKind[]) slot[k]!.g.visible = k === rune?.kind;
        if (!rune) return;
        const r = (slot[rune.kind] ??= runeDraw(rune.kind));
        r.g.position.copy(w3(rune.pos, 0));
        r.tick(now);
      });
      syncZones(state.zones ?? [], now, dt);
      shownIsles = state.isles ?? [];
      syncIsles(shownIsles, now, dt);
      // hit-stop: quem acabou de apanhar fica com a animação parada por ~60 ms
      for (const m of mages.values()) if (now >= m.freezeUntil) m.mixer.update(dt);
      decor.update((p) => edgeAt(shownArena, shownR, p), now);
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        const k = (now - f.born) / (f.until - f.born);
        if (k >= 1) {
          scene.remove(f.obj);
          dispose(f.obj);
          fx.splice(i, 1);
        } else f.update?.(k);
      }

      // câmera inclinada estilo Dota, seguindo de leve o próprio mago
      // em pé a arena não cabe na largura: a câmera acompanha mais o próprio mago
      // assistindo outro mago (lock): centra nele
      let target = (state.follow ? w3(state.follow).multiplyScalar(state.lock ? 1 : camera.aspect < 1 ? 0.65 : 0.3) : new THREE.Vector3()).add(pan);
      // fim da rodada: a câmera vai devagar até quem comemora (no modo Times, o meio do time) e aproxima um pouco
      const champs = state.wizards.filter((w) => w.cheer && w.alive);
      celebrate += ((champs.length ? 1 : 0) - celebrate) * Math.min(1, dt * 1.5);
      if (champs.length) {
        const c = champs.reduce((a, w) => a.add(w3(w.pos)), new THREE.Vector3()).multiplyScalar(1 / champs.length);
        target = target.lerp(c, celebrate);
      }
      focus.lerp(target, Math.min(1, dt * 3));
      // aproxima conforme a arena encolhe
      const dist = Math.min(44, Math.max(13, shownR * ARENAS[shownArena].reach * 2.1 + 2) * (camera.userData.fit as number)) * zoom * (1 - 0.3 * celebrate);
      lastDist = dist;
      // olha um pouco à frente do centro para a borda de baixo não ficar atrás da barra de magias
      const lookZ = focus.z + dist * 0.06;
      camera.position.set(focus.x, dist * 0.74, lookZ + dist * 0.67);
      camera.lookAt(focus.x, 0, lookZ);
      if (shake > 0.01 && !lite) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.z += (Math.random() - 0.5) * shake;
      }
      shake *= 0.9;

      // ponto 3D → pixels na tela
      const toScreen = (p: THREE.Vector3) => {
        const q = p.project(camera);
        return [(q.x * innerWidth) / 2 + innerWidth / 2, (-q.y * innerHeight) / 2 + innerHeight / 2];
      };
      // números de dano: sobem 1,2 m em 0,9 s e somem
      for (let i = numbers.length - 1; i >= 0; i--) {
        const d = numbers[i];
        const k = (now - d.born) / 1.2;
        if (k >= 1) {
          d.el.remove();
          numbers.splice(i, 1);
          continue;
        }
        const [x, y] = toScreen(d.at.clone().setY(d.at.y + k * 1.2));
        d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + (d.pop ?? 0.3) * Math.max(0, 0.2 - k) * 5})`;
        d.el.style.opacity = String(Math.min(1, (1 - k) * 2.5));
      }

      // barras dos obstáculos, logo acima de cada um
      for (const p of pillarMeshes) {
        if (!p.bar || p.bar.hidden) continue;
        const [x, y] = toScreen(p.obj.position.clone().setY(p.height + 0.15));
        p.bar.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }

      // nome e vida em cima de cada mago
      for (const m of mages.values()) {
        if (m.label.hidden) continue;
        const [x, y] = toScreen(m.root.position.clone().setY(2.1));
        m.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }

      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
