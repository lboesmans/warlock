// Estado compacto enviado 30 vezes por segundo, e a leitura dele no navegador.
import type { Snap } from './protocol.ts';
import { PROJ_KINDS, bootsBonus, isSliding, type ProjKind, type SimEvent, type World } from './sim.ts';
import { CHEST, OBSTACLES, OBSTACLE_KINDS, RUNE_KINDS, WIZ_R, type ObstacleKind, type RuneKind } from './constants.ts';
import { ACTIVE_ITEMS } from './items.ts';
import { SPELL_IDS, spellLevel } from './spells.ts';
import type { Isle } from './arena.ts';
import { dist, v, type Vec } from './vec.ts';

const r2 = (x: number) => Math.round(x * 100) / 100;
const ZONE_KINDS = ['burn', 'slow', 'pull'] as const;
const RUNE_BIT: Record<RuneKind, number> = { haste: 262144, fury: 524288, shield: 1048576, recharge: 4194304 };
export type ZoneKind = (typeof ZONE_KINDS)[number];

// troca os ids secretos dos eventos pelos públicos (ver publicId)
export function publicEvents(events: SimEvent[], pub: (id: string) => string): SimEvent[] {
  return events.map((e) => {
    const out: Record<string, unknown> = { ...e };
    if ('id' in e) out.id = pub(e.id);
    if ('by' in e && e.by) out.by = pub(e.by);
    if ('victim' in e && e.victim) out.victim = pub(e.victim);
    return out as SimEvent;
  });
}

// seeAll (sandbox): ninguém fica escondido para quem recebe; o navegador decide mostrar meio transparente ("Ver invisíveis")
export function encodeSnap(w: World, forId: string, ack: number, events: SimEvent[], seeAll = false): Snap {
  const wz: number[] = [];
  const ab: number[] = []; // por mago: dano que a Investida ainda absorve
  const me = w.wizards.find((z) => z.id === forId);
  const linked = new Set(w.projectiles.filter((p) => p.kind === 'link' && p.target).map((p) => p.target));
  for (const z of w.wizards) {
    // bits: 1 vivo, 2 escudo, 4 lento (chão arcano, Drenar, Bola de neve), 512 queimando (chão de fogo), 16 atordoado (arremessado), 32 invulnerável, 64 Pacto armado, 128 preso (Agarrar), 256 Investida,
    // 1024 Caminhada no vento (quem anda e os aliados veem), 2048 invisível para quem recebe (o cliente esconde), 4096 acelerado (Drenar, Botas de choque ou de vento),
    // 8192 magnetizado atraindo, 16384 magnetizado repelindo, 32768 Alteração, 65536 preso pelo Elo, 131072 Égide pronta,
    // runas: 262144 Pressa, 524288 Fúria, 1048576 Escudo de runa (−30% de dano); 2097152 no redemoinho (mesma conta do puxão em sim.ts);
    // Ilusão: o próprio jogador recebe 1024 (efeito visual da Caminhada no vento); todos os outros recebem 2048 e não o veem
    const hidden = !seeAll && z.id !== forId && !(me && me.team !== null && me.team === z.team);
    const bits = (z.alive ? 1 : 0) | (w.t < z.shieldUntil ? 2 : 0)
      | (isSliding(z) ? 16 : 0) | (w.t < z.invulnUntil ? 32 : 0) | (w.t < z.pactUntil ? 64 : 0)
      | (w.t < z.gripUntil ? 128 : 0) | (w.t < z.rushUntil ? 256 : 0) | (z.zone & 1 || w.t < z.slowUntil ? 4 : 0) | (z.zone & 2 ? 512 : 0)
      | (w.t < z.windUntil ? (hidden ? 2048 : 1024) : 0) | (w.t < z.hasteUntil || bootsBonus(w, z) > 0 ? 4096 : 0) | (w.t < z.magnetUntil ? (z.magnet > 0 ? 8192 : 16384) : 0)
      | (w.t < z.alterUntil ? 32768 : 0) | (linked.has(z.id) ? 65536 : 0) | (z.aegis ? 131072 : 0)
      | (w.t < z.runeUntil && z.rune ? RUNE_BIT[z.rune] : 0)
      | (z.alive && w.zones.some((q) => q.kind === 'pull' && dist(q.pos, z.pos) < q.r + WIZ_R) ? 2097152 : 0)
      | (w.t < z.veilUntil ? (z.id === forId ? 1024 : hidden ? 2048 : 8388608) : 0);
    // avançando (Investida): a velocidade enviada inclui o avanço, e o cliente segue o servidor como num empurrão
    const dash = w.t < z.dashUntil ? z.dashVel : { x: 0, y: 0 };
    wz.push(r2(z.pos.x), r2(z.pos.y), r2(z.vel.x + dash.x), r2(z.vel.y + dash.y), Math.ceil(z.hp), r2(z.facing), bits);
    const seen = !(bits & 2048); // inimigo invisível não entrega nada
    ab.push(seen && w.t < z.rushUntil ? Math.ceil(z.rushLeft) : 0);
  }
  const p: number[] = [];
  // o meteoro e a Zona de dobra não andam: no lugar da velocidade vão o raio e os segundos que faltam;
  // o Elo manda a posição de quem lançou (o cliente desenha o fio até ela); a cópia da Ilusão, o índice do dono e para onde olha
  for (const q of w.projectiles) {
    const still = q.kind === 'meteor' || q.kind === 'warpzone' ? q.kind : null;
    const tail = q.kind === 'link' ? w.wizards.find((z) => z.id === q.owner)?.pos : q.kind === 'illusion' ? v(w.wizards.findIndex((z) => z.id === q.owner), Math.atan2(q.vel.y, q.vel.x)) : undefined;
    const a = still ? spellLevel(still, q.level).radius : (tail ?? q.vel).x;
    const b = still ? Math.max(0, q.until - w.t) : (tail ?? q.vel).y;
    p.push(q.id, PROJ_KINDS.indexOf(q.kind), r2(q.pos.x), r2(q.pos.y), r2(a), r2(b));
  }
  const cd = SPELL_IDS.map((s) => (me ? r2(Math.max(0, me.cd[s] - w.t)) : 0));
  const icd = ACTIVE_ITEMS.map((i) => (me ? r2(Math.max(0, me.itemCd[i] - w.t)) : 0));
  const snap: Snap = { t: 'snap', time: r2(w.t * 1000) / 1000, r: r2(w.arenaR), s: r2(w.shrinkAt), w: wz, p, cd, icd, sp: r2(me?.speed ?? 0), pl: w.pillars.flatMap((q) => [r2(q.pos.x), r2(q.pos.y), q.alive ? (Number.isFinite(q.hp) ? Math.ceil((q.hp / OBSTACLES[q.kind].hp) * 100) : 100) : 0, OBSTACLE_KINDS.indexOf(q.kind)]), ack };
  // deathmatch: segundos até cada mago voltar (0 = vivo), na ordem de room.ids; o limite cobre o expulso, que não volta
  if (w.dm) snap.rs = w.wizards.map((z) => (z.alive ? 0 : r2(Math.min(99, Math.max(0, z.respawnAt - w.t)))));
  if (w.loots.length) {
    snap.ch = w.loots.flatMap((l) => [r2(l.pos.x), r2(l.pos.y), l.left]);
    snap.lp = w.wizards.map((z) => r2(z.lootProg / CHEST.goldEvery));
  }
  if (ab.some((x) => x > 0)) snap.ab = ab;
  // efeitos com prazo de quem recebe: bit (o mesmo de w) e segundos que faltam; os sem prazo (queimando, atordoado, Elo) ficam só no bit
  if (me) {
    const fx: number[] = [];
    const left = (bit: number, until: number) => w.t < until && fx.push(bit, r2(until - w.t));
    left(32, me.invulnUntil);
    left(64, me.pactUntil);
    left(128, me.gripUntil);
    left(256, me.rushUntil);
    left(4, me.slowUntil);
    left(1024, me.windUntil);
    left(4096, Math.max(me.hasteUntil, me.shockUntil));
    left(me.magnet > 0 ? 8192 : 16384, me.magnetUntil);
    left(32768, me.alterUntil);
    if (me.rune) left(RUNE_BIT[me.rune], me.runeUntil);
    if (fx.length) snap.fx = fx;
  }
  // chão dos choques: x, y, raio, tipo, segundos que faltam
  if (w.zones.length) snap.zn = w.zones.flatMap((z) => [r2(z.pos.x), r2(z.pos.y), r2(z.r), ZONE_KINDS.indexOf(z.kind), r2(Math.max(0, z.until - w.t))]);
  // ilhas de refúgio: x, y, raio (raio 0 = afundada)
  if (w.isles?.length) snap.il = w.isles.flatMap((i) => [r2(i.pos.x), r2(i.pos.y), r2(i.r)]);
  if (w.runes.length) snap.ru = w.runes.flatMap((r) => [r2(r.pos.x), r2(r.pos.y), RUNE_KINDS.indexOf(r.kind)]);
  if (events.length) snap.e = events;
  return snap;
}

export type WizView = { id: string; pos: Vec; vel: Vec; hp: number; facing: number; alive: boolean; shield: boolean; status: number; rushLeft?: number };
// meteor e warpzone: vel = (raio, segundos que faltam); link: vel = posição de quem lançou; illusion: vel = (índice do dono, para onde olha)
export type ProjView = { id: number; kind: ProjKind; pos: Vec; vel: Vec };
export type PillarView = { pos: Vec; hp: number; kind: ObstacleKind };
export type RuneView = { pos: Vec; kind: RuneKind };
export type ZoneView = { pos: Vec; r: number; kind: ZoneKind; left: number };
export type SnapView = { time: number; arenaR: number; shrinkAt: number; wizards: WizView[]; projectiles: ProjView[]; pillars: PillarView[]; loots: { pos: Vec; left: number }[]; runes: RuneView[]; zones?: ZoneView[]; isles?: Isle[] };

// lista achatada → linhas de n números
const rows = (a: number[] | undefined, n: number) => Array.from({ length: Math.floor((a?.length ?? 0) / n) }, (_, i) => a!.slice(i * n, i * n + n));

export function decodeSnap(s: Snap, ids: string[]): SnapView {
  const wizards = rows(s.w, 7).slice(0, ids.length).map(([x, y, vx, vy, hp, facing, bits], i): WizView =>
    ({ id: ids[i], pos: v(x, y), vel: v(vx, vy), hp, facing, alive: (bits & 1) > 0, shield: (bits & 2) > 0, status: bits, rushLeft: s.ab?.[i] ?? 0 }));
  const projectiles = rows(s.p, 6).map(([id, kind, x, y, vx, vy]): ProjView => ({ id, kind: PROJ_KINDS[kind] ?? 'fireball', pos: v(x, y), vel: v(vx, vy) }));
  const pillars = rows(s.pl, 4).map(([x, y, hp, k]): PillarView => ({ pos: v(x, y), hp, kind: OBSTACLE_KINDS[k] ?? 'pillar' }));
  const runes = rows(s.ru, 3).map(([x, y, k]): RuneView => ({ pos: v(x, y), kind: RUNE_KINDS[k] ?? 'haste' }));
  const zones = rows(s.zn, 5).map(([x, y, r, k, left]): ZoneView => ({ pos: v(x, y), r, kind: ZONE_KINDS[k] ?? 'burn', left }));
  const isles = rows(s.il, 3).map(([x, y, r]): Isle => ({ pos: v(x, y), r }));
  const loots = rows(s.ch, 3).map(([x, y, left]) => ({ pos: v(x, y), left }));
  return { time: s.time, arenaR: s.r, shrinkAt: s.s, wizards, projectiles, pillars, runes, zones, isles, loots };
}
