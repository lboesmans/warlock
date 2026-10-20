// Simulação 2D da arena. Pura: o servidor roda a 60 passos/s; o cliente usa moveWizard para prever o próprio mago.
import {
  ARENA_MIN, ARENA_STEP, CHEST, CREDIT_WINDOW, ZONES, DM_RESPAWN, DM_SPAWN_GAP, OBSTACLES, OBSTACLE_KINDS, PILLAR, type ObstacleKind, DT, FRICTION, HP_MAX, HP_REGEN, INVULN_TIME, KB_PER_DMG, KB_SOFT_CAP, KNOCK_HP_SCALE, LAVA_DPS, LAVA_KB_FACTOR, PROJ_R, SHRINK_EVERY, SPAWN_INSET, STUN_SPEED,
  ISLAND, RUNE, RUNE_KINDS, SUDDEN, WALL_GAP, WIZ_R, WIZ_SPEED, arenaRadius, type RuneKind,
} from './constants.ts';
import { SHAPES, edge, inArena, inLavaAt, isleSpot, safeInside, type ArenaId, type Isle } from './arena.ts';
import { ACTIVE_ITEMS, AEGIS, ITEM_CAST, PACT, REDIRECTOR, SCOURGE, SHOCK_BOOTS, WIND_BOOTS, isActive, itemStats, noItems, type ItemId } from './items.ts';
import { BOOMERANG, BOUNCER, CAST_POINT, CLUSTER_FAN, DRAIN, GRAVITY, GRIP, HOMING_TURN, LINK, MAGNETIZE, METEOR_DELAY, RECHARGE, RUSH, SNOWBALL, SPELL_IDS, SPLITTER, THRUST, WARPZONE, WINDWALK, spellLevel, type Level, type SpellId } from './spells.ts';
import { add, clampLen, dist, dot, len, norm, scale, sub, v, type Vec } from './vec.ts';

export type Wizard = {
  id: string;
  pos: Vec;
  vel: Vec; // só o empurrão; andar não entra aqui
  target: Vec | null;
  facing: number;
  hp: number;
  dmgTaken: number; // dano acumulado na rodada: quanto maior, mais longe o mago voa
  alive: boolean;
  shieldUntil: number;
  lastHitBy: string | null;
  lastHitAt: number;
  lastHitSrc: string; // fonte do último golpe, para a causa da morte nos dados
  shieldR: number; // raio da bolha do escudo (cresce com o nível)
  lootProg: number; // segundos em cima do monte de ouro desde o último ouro
  zone: number; // 1 = no chão lento, 2 = no chão queimando (recalculado a cada passo)
  spells: Record<SpellId, number>; // nível; 0 = não tem
  cd: Record<SpellId, number>; // instante (w.t) em que fica pronta
  items: Record<ItemId, number>;
  itemCd: Record<ItemId, number>;
  hpMax: number;
  regen: number;
  kbResist: number; // fração de empurrão a menos (itens)
  baseSpeed: number;
  speed: number; // velocidade de andar agora (botas, Investida, preso)
  debuffMult: number; // duração de lentidões e penalidades
  pactUntil: number; // Pacto armado até este instante
  gripUntil: number; // preso (Agarrar): não anda até o primeiro golpe com dano
  gripBonus: number; // empurrão a mais desse golpe (pelo nível do Agarrar de quem prendeu)
  windBonus: number; // Botas de vento: velocidade a mais depois de WIND_BOOTS.calm s sem dano (0 = não tem)
  calmSince: number; // último instante em que causou ou levou dano
  rushUntil: number; // Investida ativa até este instante
  rushLeft: number; // dano que a Investida ainda pode absorver
  rushBonus: number; // velocidade extra da Investida agora (m/s)
  dashUntil: number; // avanço da Investida em curso até este instante
  dashVel: Vec; // velocidade do avanço (m/s)
  dashHit: string[]; // quem este avanço já acertou
  thrustUntil: number; // Estocada em curso até este instante (0 = nenhuma)
  thrustAcc: Vec; // aceleração da Estocada (m/s²)
  thrustMult: number; // Pacto na Estocada
  slowUntil: number; // lento (Drenar, Bola de neve) até este instante
  slow: number; // m/s a menos enquanto lento
  hasteUntil: number; // acelerado (Drenar num aliado) até este instante
  haste: number; // m/s a mais enquanto acelerado
  snow: { until: number; by: string; dmg: number } | null; // Bola de neve encostou: dano quando acabar
  magnetUntil: number; // Magnetizar até este instante
  magnet: number; // 1 atrai, −1 repele os projéteis inimigos
  alterUntil: number; // Alteração ativa até este instante
  windUntil: number; // Caminhada no vento (invisível) até este instante
  windMult: number; // Pacto na Caminhada no vento
  veilUntil: number; // Ilusão: invisível até a cópia acabar
  streak: number; // Recarga: acertos seguidos
  invulnUntil: number;
  respawnAt: number; // deathmatch: instante (w.t) em que o morto volta
  rangeF: number; // alcance das magias (Elmo: −10%)
  lifesteal: number; // fração do dano causado que volta como vida
  lavaCut: number; // Botas de lava: fração do dano da lava a menos
  ward: number; // Guardião: dano a menos por golpe (até metade do golpe)
  shockBonus: number; // Botas de choque: velocidade a mais depois de levar um golpe (já descontadas as Botas)
  shockUntil: number;
  aegis: boolean; // Égide ainda não usada nesta rodada (nesta vida, no deathmatch)
  rune: RuneKind | null; // runa ativa até runeUntil (pegar outra troca)
  runeUntil: number;
  team: number | null; // modo Times: 0 ou 1; fora dele null (ninguém é aliado)
  // magia ou item sendo conjurado: sai em fireAt e o mago fica parado até lá (pedido do Fernando, 17/10:
  // clicar para andar não cancela); o clique de andar fica guardado em `then` e vale quando a magia sai
  casting: { spell?: SpellId; item?: ItemId; at: Vec; fireAt: number; then?: Vec | null } | null;
  god?: boolean; // sandbox: vida infinita (não morre; da lava volta para a pedra)
};

// meteor fica parado no ponto de impacto até `until` e então explode; swap e grip não causam dano
// boomerang curva e volta ao dono; gravity não bate em mago, só puxa; bouncer pula de mago em mago
// drain e recharge com back voltam a quem lançou (cura, recarga); link fica preso a um mago ou obstáculo; splitter vira lançador de shard;
// warpzone não anda (zona de tempo lento); illusion é a cópia autônoma do mago, que dura até o prazo mesmo quando atingida
export const PROJ_KINDS = ['fireball', 'homing', 'swap', 'grip', 'meteor', 'cluster', 'boomerang', 'gravity', 'bouncer',
  'drain', 'snowball', 'illusion', 'magnetize', 'recharge', 'link', 'splitter', 'shard', 'warpzone'] as const;
export type ProjKind = (typeof PROJ_KINDS)[number];

export type Projectile = {
  id: number;
  born?: number; // w.t em que surgiu (os bots só reagem depois do tempo de reação deles)
  kind: ProjKind;
  owner: string;
  pos: Vec;
  vel: Vec;
  level: number;
  until: number;
  target: string | null;
  dmgMult: number; // Pacto
  caster: string; // quem lançou (o dono muda quando um escudo reflete)
  dest?: Vec; // Troca: aonde o mago vai se ela não tocar ninguém (o ponto da mira)
  curve?: { acc: Vec; next: Vec; flipAt: number; stopAt: number }; // Bumerangue indo: aceleração agora, a da volta e quando trocam
  back?: boolean; // Bumerangue voltando ao dono
  prev?: string; // Ricochete: último mago tocado (não bate nele de novo em seguida)
  tick?: number; // Gravidade: próximo dano
  landed?: boolean; // já contou 'land' (Bumerangue e Ricochete acertam mais de uma vez)
  turnAt?: number; // Drenar: quando vira para o mago mais perto; Elo: quando recolhe
  bonus?: number; // Recarga: dano a mais pelos acertos seguidos
  waves?: number; // Divisor: ondas de filhotes que faltam (lançador)
  pillar?: number; // Elo preso a este obstáculo
};

export type Cmd =
  | { id: string; kind: 'move'; to: Vec }
  | { id: string; kind: 'stop' }
  | { id: string; kind: 'cast'; spell: SpellId; at: Vec }
  | { id: string; kind: 'item'; item: ItemId; at: Vec };

export type SimEvent =
  | { k: 'cast'; id: string; spell: SpellId }
  | { k: 'hit'; id: string; by: string; x: number; y: number; dmg: number; src: string }
  | { k: 'reflect'; id: string; x: number; y: number }
  | { k: 'lightning'; from: Vec; to: Vec }
  | { k: 'teleport'; id: string; from: Vec; to: Vec }
  | { k: 'grip'; id: string; x: number; y: number }
  | { k: 'death'; id: string; by: string | null; src: string } // src: o que empurrou por último (dentro da janela de crédito) ou 'lava'
  | { k: 'gold'; id: string; n: number; x: number; y: number }
  | { k: 'shrink'; r: number }
  | { k: 'item'; id: string; item: ItemId }
  | { k: 'aegis'; id: string } // a Égide tirou o mago da lava (junto vem um 'teleport')
  | { k: 'rune'; kind: RuneKind; x: number; y: number } // runa apareceu
  | { k: 'runeTake'; id: string; kind: RuneKind } // alguém pegou a runa
  | { k: 'sudden' } // morte súbita: a arena passa a encolher mais rápido
  // sequência de abate (vem da partida): multi = abates seguidos rápidos, spree = abates sem morrer, breaker = acabou com a sequência de victim
  | { k: 'streak'; id: string; kind: 'multi' | 'spree' | 'breaker'; n: number; victim?: string }
  | { k: 'scourge'; id: string; x: number; y: number; r: number }
  | { k: 'redirect'; x: number; y: number }
  | { k: 'clash'; x: number; y: number; combo: Combo; r: number }
  | { k: 'pillar'; i: number; x: number; y: number }
  | { k: 'chest'; x: number; y: number } // baú apareceu
  | { k: 'loot'; id: string; x: number; y: number } // alguém ganhou 1 de ouro em cima do monte
  // estatística de precisão: 'fire' quando uma magia de dano sai, 'land' quando ela acerta um inimigo (uma vez por projétil; a Rajada conta os 4)
  | { k: 'fire'; id: string; src: AimSrc }
  | { k: 'land'; id: string; src: AimSrc };

// as de utilidade (teleport, shield, swap, grip, rush, pact, redirector) contam uso em 'fire' e, quando pegam alguém, 'land'
type AimSrc = SpellId | 'scourge' | 'pact' | 'redirector';

// choque de magias: fogo×fogo, fogo×míssil, míssil×míssil, e o raio detonando uma bola de fogo
type Combo = 'fire' | 'arcane' | 'pulse' | 'detonate' | 'pillar' | 'snow'; // snow: explosão da Bola de neve

// until: some sozinho (Pilar de pedra); wall: índice do pedaço do meio da parede do Pilar de pedra (os 3 dividem a vida)
export type Pillar = { pos: Vec; hp: number; alive: boolean; kind: ObstacleKind; until?: number; wall?: number };

type Zone = { pos: Vec; r: number; kind: 'burn' | 'slow' | 'pull'; until: number };

export type World = {
  t: number;
  arena: ArenaId; // formato desta rodada (arena.ts)
  arenaR: number; // raio atual: o encolhimento escala a forma
  shrinkAt: number;
  wizards: Wizard[];
  projectiles: Projectile[];
  pillars: Pillar[];
  zones: Zone[]; // chão com efeito deixado pelos choques
  loots: { pos: Vec; left: number; until: number }[]; // montes de ouro dos baús quebrados
  chestAt: number; // quando o próximo baú aparece
  chestsLeft: number; // baús que ainda podem aparecer nesta rodada
  runes: { pos: Vec; kind: RuneKind }[]; // no máximo uma
  runeAt: number; // quando a próxima runa aparece
  isles: (Isle & { a: number; d: number })[]; // ilhas de refúgio: rumo a do centro e distância d da borda (a posição segue o encolhimento)
  sudden: boolean; // morte súbita já começou
  rules: Rules; // mecânicas ligadas nesta rodada (opções da partida)
  events: SimEvent[];
  // dano de lava creditado neste passo (quem acertou → quem queimou → dano); fica no servidor, não vai para o navegador
  lavaCredit: Record<string, Record<string, number>>;
  nextId: number;
  dm: boolean; // deathmatch: a arena não encolhe e quem morre volta depois de DM_RESPAWN s
  shrink?: boolean; // sandbox (mundo de deathmatch): a arena encolhe mesmo assim
};

// mecânicas que a sala pode desligar (opções da partida)
type Rules = { runes: boolean; sudden: boolean; chests: boolean };
const ALL_RULES: Rules = { runes: true, sudden: true, chests: true };

// o que os itens dão ao mago: no começo da rodada e, na sandbox, ao comprar no meio dela
export function gearOf(items: Partial<Record<ItemId, number>> = {}) {
  const own = { ...noItems(), ...items };
  const st = itemStats(own);
  return {
    items: own,
    hpMax: HP_MAX + st.hp,
    regen: HP_REGEN + st.regen,
    kbResist: st.kb,
    baseSpeed: WIZ_SPEED + st.speed,
    debuffMult: Math.max(0, 1 + st.debuff),
    windBonus: own.wind_boots ? Math.max(0, WIND_BOOTS.speed - st.speed) : 0, // como as de choque: vale a maior das botas
    rangeF: 1 + st.range, // Elmo: −10%
    lifesteal: st.lifesteal,
    lavaCut: st.lava,
    ward: st.ward,
    // não soma com as Botas: vale a maior das duas (as Botas são o único item de velocidade)
    shockBonus: own.shock_boots ? Math.max(0, SHOCK_BOOTS.speed - st.speed) : 0,
    aegis: own.aegis > 0,
  } satisfies Partial<Wizard>;
}

export function newWorld(
  ids: string[],
  spells: Record<string, Record<SpellId, number>>,
  items: Record<string, Record<ItemId, number>> = {},
  pillarCount = 0,
  rand: () => number = Math.random,
  dm = false,
  teams: Record<string, number> = {}, // modo Times: id → time
  rules: Rules = ALL_RULES,
  arena: ArenaId = 'circle',
): World {
  const arenaR = arenaRadius(ids.length);
  const wizards = ids.map((id, i): Wizard => {
    const pos = SHAPES[arena].spawn(i, ids.length, arenaR);
    const gear = gearOf(items[id]);
    return {
      id,
      pos,
      vel: v(0, 0),
      target: null,
      facing: Math.atan2(-pos.y, -pos.x), // olhando para o centro
      hp: gear.hpMax,
      dmgTaken: 0,
      alive: true,
      shieldUntil: 0,
      lastHitBy: null,
      lastHitSrc: '',
      zone: 0,
      shieldR: 0,
      lootProg: 0,
      lastHitAt: -1e9,
      spells: { ...spells[id] },
      cd: Object.fromEntries(SPELL_IDS.map((s) => [s, 0])) as Record<SpellId, number>,
      itemCd: noItems(),
      speed: gear.baseSpeed,
      pactUntil: 0,
      gripUntil: 0,
      gripBonus: 0,
      calmSince: 0,
      rushUntil: 0,
      rushLeft: 0,
      rushBonus: 0,
      dashUntil: 0,
      dashVel: v(0, 0),
      dashHit: [],
      thrustUntil: 0,
      thrustAcc: v(0, 0),
      thrustMult: 1,
      slowUntil: 0,
      slow: 0,
      hasteUntil: 0,
      haste: 0,
      snow: null,
      magnetUntil: 0,
      magnet: 0,
      alterUntil: 0,
      windUntil: 0,
      windMult: 1,
      veilUntil: 0,
      streak: 0,
      invulnUntil: INVULN_TIME,
      respawnAt: 0,
      shockUntil: 0,
      rune: null,
      runeUntil: 0,
      team: teams[id] ?? null,
      casting: null,
      ...gear,
    };
  });
  const pillars = placePillars(arena, arenaR, pillarCount, wizards.map((z) => z.pos), rand);
  // ilhas nas diagonais (±15°), longe dos eixos onde os magos nascem e caem mais
  const isles = Array.from({ length: ISLAND.n }, (_, i) => {
    const a = Math.PI / 4 + (i * Math.PI * 2) / ISLAND.n + (rand() - 0.5) * (Math.PI / 6);
    const d = ISLAND.near + rand() * (ISLAND.far - ISLAND.near);
    return { a, d, r: ISLAND.r, pos: isleSpot({ arena, arenaR }, a, d) };
  });
  return { t: 0, arena, arenaR, shrinkAt: SHRINK_EVERY, wizards, projectiles: [], pillars, zones: [], loots: [], chestAt: CHEST.first, chestsLeft: Math.min(CHEST.perRound, Math.floor(ids.length / 2) + 1), runes: [], runeAt: RUNE.first, isles, sudden: false, rules: { ...rules }, events: [], lavaCredit: {}, nextId: 1, dm };
}

export const inLava = (w: World, p: Vec) => inLavaAt(w.arena, w.arenaR, w.isles, p);

// ilhas: com alguém em cima a lava come a borda; vazia, a pedra volta a crescer (menos quando a arena já está sumindo: a rodada tem de acabar)
function stepIsles(w: World) {
  const grow = w.t < SUDDEN.collapse ? (ISLAND.r / ISLAND.regrow) * DT : 0;
  for (const i of w.isles) {
    // em cima = com o pé na ilha (centro a até o raio do mago da beira): afundada, quem está ali não a deixa voltar
    const busy = w.wizards.some((z) => z.alive && dist(z.pos, i.pos) < i.r + WIZ_R);
    i.r = busy ? Math.max(0, i.r - ISLAND.sink * DT) : Math.min(ISLAND.r, i.r + grow);
  }
}

// sorteia pilares longe de onde os magos nascem e longe uns dos outros
function pickKind(r: number): ObstacleKind {
  const total = OBSTACLE_KINDS.reduce((s, k) => s + OBSTACLES[k].weight, 0);
  let acc = 0;
  for (const k of OBSTACLE_KINDS) {
    acc += OBSTACLES[k].weight / total;
    if (r < acc) return k;
  }
  return 'pillar';
}

// cada arena tem conjuntos fixos (sorteia um deles ou o espalhado de sempre, com chances iguais)
function placePillars(arena: ArenaId, arenaR: number, n: number, spawns: Vec[], rand: () => number): Pillar[] {
  const out: Pillar[] = [];
  const put = (pos: Vec) => { const kind = pickKind(rand()); out.push({ pos, hp: OBSTACLES[kind].hp, alive: true, kind }); };
  const sets = SHAPES[arena].obstacles;
  const set = n > 0 ? Math.floor(rand() * (sets.length + 1)) : sets.length;
  if (set < sets.length) {
    for (const u of sets[set]) {
      const pos = scale(u, arenaR);
      if (!spawns.some((s) => dist(s, pos) < 2)) put(pos);
    }
    return out;
  }
  const spread = PILLAR.spread * SHAPES[arena].reach;
  for (let tries = 0; out.length < n && tries < n * 60; tries++) {
    const pos = v((rand() * 2 - 1) * spread, (rand() * 2 - 1) * spread);
    // fora da pedra (ou quase) não serve: no círculo de 3 ou mais magos isso nunca acontece
    if (edge({ arena, arenaR }, pos) < 1 || spawns.some((s) => dist(s, pos) < 2) || out.some((p) => dist(p.pos, pos) < 2)) continue;
    put(pos);
  }
  return out;
}

export const isSliding = (wz: { vel: Vec }) => len(wz.vel) > STUN_SPEED;
// velocidade das botas que agem agora: as de choque depois de um golpe, as de vento na calmaria (não somam: vale a maior)
export const bootsBonus = (w: World, wz: Wizard) =>
  Math.max(w.t < wz.shockUntil ? wz.shockBonus : 0, wz.windBonus > 0 && w.t - wz.calmSince >= WIND_BOOTS.calm ? wz.windBonus : 0);

export function moveWizard(wz: Wizard, dt: number) {
  if (wz.target && !isSliding(wz)) {
    const d = sub(wz.target, wz.pos);
    const l = len(d);
    const step = (wz.speed ?? WIZ_SPEED) * dt;
    if (l <= step) {
      wz.pos = wz.target;
      wz.target = null;
    } else {
      wz.pos = add(wz.pos, scale(d, step / l));
      wz.facing = Math.atan2(d.y, d.x);
    }
  }
  wz.pos = add(wz.pos, scale(wz.vel, dt));
  wz.vel = scale(wz.vel, Math.exp(-FRICTION * dt));
  if (len(wz.vel) < 0.05) wz.vel = v(0, 0);
}

const byId = (w: World, id: string | null) => w.wizards.find((z) => z.id === id && z.alive); // só os vivos
const anyById = (w: World, id: string | null) => w.wizards.find((z) => z.id === id); // vivo ou morto
const shielded = (w: World, wz: Wizard) => w.t < wz.shieldUntil;
const bubble = (w: World, wz: Wizard) => (shielded(w, wz) ? Math.max(0, wz.shieldR - WIZ_R) : 0); // quanto a bolha do escudo passa do mago
// modo Times: do mesmo time e não é a própria pessoa
const allies = (a: Wizard | undefined, b: Wizard) => !!a && a !== b && a.team !== null && a.team === b.team;

// src: o que causou o dano (magia, item, choque ou pilar), para o placar e os dados de balanceamento
function hit(w: World, target: Wizard, by: string, dmg: number, knock: number, dir: Vec, src: string) {
  // invulnerável: sem dano nem empurrão, mas o acerto aparece (explosão e som), senão o projétil sumiria sem efeito
  if (w.t < target.invulnUntil) return void w.events.push({ k: 'hit', id: target.id, by, x: target.pos.x, y: target.pos.y, dmg: 0, src });
  // como no mod de Dota 2 (pawn.lua): acima de 100 de dano por golpe o empurrão cresce pela raiz, não em linha reta
  const big = dmg > KB_SOFT_CAP ? Math.sqrt(KB_SOFT_CAP * dmg) / dmg : 1;
  const mult = big * (1 + (KNOCK_HP_SCALE * target.dmgTaken) / HP_MAX) * Math.max(0, 1 - target.kbResist);
  // fogo amigo: só empurra; sem dano, sem roubo de vida e sem crédito de abate para o aliado
  if (allies(anyById(w, by), target)) {
    target.vel = add(target.vel, scale(norm(dir), knock * mult));
    return void w.events.push({ k: 'hit', id: target.id, by, x: target.pos.x, y: target.pos.y, dmg: 0, src });
  }
  // runa da Fúria de quem bateu
  const att = by !== target.id ? byId(w, by) : undefined;
  if (att && att.rune === 'fury' && w.t < att.runeUntil) dmg *= 1 + RUNE.fury;
  // Guardião: tira um pouco de cada golpe, nunca mais que metade dele (senão zerava os tiques da Gravidade e do Elo)
  dmg = Math.max(dmg * 0.5, dmg - target.ward);
  // runa do Escudo: menos dano levado (o empurrão do golpe continua)
  if (target.rune === 'shield' && w.t < target.runeUntil) dmg *= 1 - RUNE.armor;
  // Botas de choque: golpe de outro mago dá velocidade por alguns segundos
  if (target.shockBonus > 0 && by !== target.id && dmg > 0) target.shockUntil = w.t + SHOCK_BOOTS.secs;
  // Investida: depois do empurrão, absorve metade do golpe (de outro mago) e converte em velocidade
  if (w.t < target.rushUntil && by !== target.id && target.rushLeft > 0) {
    const absorbed = Math.min(target.rushLeft, dmg * RUSH.share);
    target.rushLeft -= absorbed;
    target.rushBonus += absorbed * RUSH.perHp;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  target.dmgTaken += dmg;
  // Agarrar: o primeiro golpe com dano de outro mago solta o preso e empurra mais longe
  const release = w.t < target.gripUntil && dmg > 0 && by !== target.id ? 1 + target.gripBonus : 1;
  if (release > 1) target.gripUntil = 0;
  // Botas de vento: causar ou levar dano acaba a calmaria
  if (dmg > 0 && by !== target.id) {
    target.calmSince = w.t;
    if (att) att.calmSince = w.t;
  }
  target.vel = add(target.vel, scale(norm(dir), knock * mult * release));
  target.lastHitBy = by;
  target.lastHitSrc = src;
  target.lastHitAt = w.t;
  // roubo de vida: quem acertou recupera parte do dano (e, como no original, a cura reduz o dano acumulado pela metade dela)
  if (att && att.lifesteal > 0) heal(att, dmg * att.lifesteal);
  w.events.push({ k: 'hit', id: target.id, by, x: target.pos.x, y: target.pos.y, dmg: Math.round(dmg), src });
}

// ponto do segmento a→a+d mais perto de p: a fração t em [0,1] ao longo dele e a distância de p até ele
function segT(a: Vec, d: Vec, p: Vec): [t: number, gap: number] {
  const dd = dot(d, d);
  const t = dd > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / dd)) : 0;
  return [t, dist(add(a, scale(d, t)), p)];
}

// primeiro mago (fora os excluídos) que o segmento a→b toca; t em [0,1] ao longo do segmento
function firstOnSegment(w: World, a: Vec, b: Vec, radius: number, skip: string): { wz: Wizard; t: number } | null {
  const d = sub(b, a);
  let best: { wz: Wizard; t: number } | null = null;
  for (const wz of w.wizards) {
    if (!wz.alive || wz.id === skip) continue;
    const [t, gap] = segT(a, d, wz.pos);
    // com escudo, a bolha (maior que o mago) é que encosta
    if (gap > radius + bubble(w, wz)) continue;
    if (!best || t < best.t) best = { wz, t };
  }
  return best;
}

// só bola de fogo e míssil se chocam entre si e com o raio; as outras magias atravessam
const clashes = (p: Projectile) => p.kind === 'fireball' || p.kind === 'homing';

// bola de fogo de qualquer dono ou míssil de outro dono no caminho do raio
function firstProjectileOnSegment(w: World, a: Vec, b: Vec, caster: string): { p: Projectile; t: number } | null {
  const d = sub(b, a);
  let best: { p: Projectile; t: number } | null = null;
  for (const p of w.projectiles) {
    if (!clashes(p) || (p.kind === 'homing' && p.owner === caster)) continue;
    const [t, gap] = segT(a, d, p.pos);
    if (gap > PROJ_R + 0.15) continue;
    if (!best || t < best.t) best = { p, t };
  }
  return best;
}

// explosão em área: dano e empurrão em todos dentro do raio (inclusive donos), caindo até zero na borda
function area(w: World, at: Vec, radius: number, dmg: number, kbFactor: number, by: string | null, combo: Combo) {
  for (const o of w.wizards) {
    if (!o.alive) continue;
    const d = dist(o.pos, at);
    if (d > radius + WIZ_R) continue;
    const k = Math.max(0, 1 - d / (radius + WIZ_R));
    const amount = dmg * k;
    if (amount <= 0.5) continue;
    hit(w, o, by && by !== o.id ? by : (o.lastHitBy ?? by ?? o.id), amount, amount * KB_PER_DMG * kbFactor, sub(o.pos, at), 'choque:' + combo);
  }
  for (const q of w.projectiles) {
    const owner = anyById(w, q.owner);
    const caster = by ? byId(w, by) : undefined;
    if (q.kind !== 'illusion' || q.owner === by || (caster && owner && allies(caster, owner))) continue;
    const d = dist(q.pos, at);
    if (d > radius + WIZ_R) continue;
    const amount = dmg * Math.max(0, 1 - d / (radius + WIZ_R));
    if (amount > 0.5) q.vel = add(q.vel, scale(norm(sub(q.pos, at)), amount * KB_PER_DMG * kbFactor));
  }
  w.events.push({ k: 'clash', x: at.x, y: at.y, combo, r: radius });
  const kind = combo === 'fire' || combo === 'detonate' ? 'burn' : combo === 'arcane' ? 'slow' : combo === 'pulse' ? 'pull' : null;
  if (kind) w.zones.push({ pos: at, r: radius * ZONES.size, kind, until: w.t + (combo === 'detonate' ? 3.5 : ZONES[kind].secs) });
}

// combinações quando dois projéteis de donos diferentes se encontram (minha decisão; no original os dois só somem)
// (mais fortes e maiores a pedido do Fernando, 17/10)
export const CLASH = {
  fire: { r: 2.0, dmg: 70, kb: 1.3 },
  arcane: { r: 2.6, dmg: 90, kb: 1.6 },
  pulse: { r: 1.6, dmg: 50, kb: 1.1 },
  detonate: { r: 2.0 }, // original 225 unidades (1,46 m)
};

function clashProjectiles(w: World) {
  const gone = new Set<Projectile>();
  for (let i = 0; i < w.projectiles.length; i++) {
    const a = w.projectiles[i];
    if (gone.has(a) || !clashes(a)) continue;
    for (let j = i + 1; j < w.projectiles.length; j++) {
      const b = w.projectiles[j];
      // magias do mesmo dono ou de aliados (modo Times) não se chocam
      const team = byId(w, a.owner)?.team ?? null;
      if (gone.has(b) || !clashes(b) || a.owner === b.owner || (team !== null && team === byId(w, b.owner)?.team) || dist(a.pos, b.pos) > PROJ_R * 2 + 0.1) continue;
      gone.add(a);
      gone.add(b);
      const at = scale(add(a.pos, b.pos), 0.5);
      const combo: Combo = a.kind === b.kind ? (a.kind === 'fireball' ? 'fire' : 'pulse') : 'arcane';
      const c = CLASH[combo];
      area(w, at, c.r, c.dmg * Math.max(a.dmgMult, b.dmgMult), c.kb, null, combo);
      break;
    }
  }
  if (gone.size) w.projectiles = w.projectiles.filter((p) => !gone.has(p));
}

function firstPillarOnSegment(w: World, a: Vec, b: Vec, radius: number): { i: number; t: number } | null {
  const d = sub(b, a);
  let best: { i: number; t: number } | null = null;
  w.pillars.forEach((p, i) => {
    if (!p.alive) return;
    const [t, gap] = segT(a, d, p.pos);
    if (gap > OBSTACLES[p.kind].r + radius) return;
    if (!best || t < best.t) best = { i, t };
  });
  return best;
}

function damagePillar(w: World, i: number, dmg: number, by: string | null) {
  const p = w.pillars[i];
  // parede: os 3 pedaços compartilham a vida, quebram juntos e explodem uma vez só, no meio
  const mates = p.wall === undefined ? [p] : w.pillars.filter((q) => q.wall === p.wall && q.alive);
  for (const q of mates) q.hp -= dmg;
  w.events.push({ k: 'pillar', i, x: p.pos.x, y: p.pos.y });
  if (p.hp > 0) return;
  for (const q of mates) q.alive = false;
  const at = p.wall === undefined ? p.pos : w.pillars[p.wall].pos;
  const o = OBSTACLES[p.kind];
  // o ouro cai na pedra: baú que a lava pegou espalha o monte na beira de dentro
  if (p.kind === 'chest') w.loots.push({ pos: safeInside(w, p.pos, 0.6), left: CHEST.pile, until: w.t + CHEST.pileSecs });
  if (o.blastR > 0) area(w, at, o.blastR, o.blastDmg, 1, by, 'pillar');
  else w.events.push({ k: 'clash', x: at.x, y: at.y, combo: 'pillar', r: o.r * 1.5 });
}

// magos não atravessam pilares: empurra para fora e corta o deslize na direção do pilar
function blockPillars(w: World) {
  for (const p of w.pillars) {
    if (p.alive && p.until !== undefined && w.t >= p.until) {
      // o Pilar de pedra acaba: some sem explodir (removeObstacle do original); a parede some com uma nuvem só, no meio, do tamanho dela
      p.alive = false;
      if (p.wall === undefined) w.events.push({ k: 'clash', x: p.pos.x, y: p.pos.y, combo: 'pillar', r: OBSTACLES[p.kind].r * 1.5 });
      else if (w.pillars[p.wall] === p) w.events.push({ k: 'clash', x: p.pos.x, y: p.pos.y, combo: 'pillar', r: 1.1 });
    }
    if (!p.alive) continue;
    // baú na lava quebra sozinho (Fernando, 18/10)
    if (p.kind === 'chest' && edge(w, p.pos) < 0) {
      damagePillar(w, w.pillars.indexOf(p), p.hp, null);
      continue;
    }
    for (const wz of w.wizards) {
      if (!wz.alive) continue;
      const d = sub(wz.pos, p.pos);
      const l = len(d);
      const min = OBSTACLES[p.kind].r + WIZ_R;
      if (l >= min) continue;
      const n = l > 1e-6 ? scale(d, 1 / l) : v(1, 0);
      wz.pos = add(p.pos, scale(n, min));
      const into = dot(wz.vel, n);
      if (into < 0) wz.vel = sub(wz.vel, scale(n, into * 1.5)); // quica de leve
    }
  }
}

// o mais perto, fora skip; nos Times, também fora o time do dono (só inimigos)
function nearestEnemy(w: World, to: Vec, skip: string, owner = skip): Wizard | null {
  const team = anyById(w, owner)?.team ?? null;
  let best: Wizard | null = null;
  for (const wz of w.wizards) {
    if (!wz.alive || wz.id === skip || wz.id === owner || (team !== null && wz.team === team)) continue;
    if (!best || dist(wz.pos, to) < dist(best.pos, to)) best = wz;
  }
  return best;
}

// cura (Drenar, Roubo de vida): como no original, tira do dano acumulado metade do que curou (pawn.lua)
function heal(wz: Wizard, amount: number) {
  wz.hp = Math.min(wz.hpMax, wz.hp + amount);
  wz.dmgTaken = Math.max(0, wz.dmgTaken - amount * 0.5);
}

// ponytail: duas lentidões juntas valem a maior (no original somavam); somar pede uma lista de efeitos por mago
function slowDown(w: World, wz: Wizard, amount: number, secs: number) {
  wz.slow = w.t < wz.slowUntil ? Math.max(wz.slow, amount) : amount;
  wz.slowUntil = Math.max(wz.slowUntil, w.t + secs);
}

// quantos 'fire' cada lançamento conta (a Rajada sai com 4 e o Divisor com 8 filhotes); as outras, 1
const SHOTS: Partial<Record<SpellId, number>> = { cluster: CLUSTER_FAN.length, splitter: 2 * SPLITTER.waves };

function cast(w: World, wz: Wizard, spell: SpellId, at: Vec) {
  const level = wz.spells[spell];
  if (!level || w.t < wz.cd[spell]) return;
  const L = spellLevel(spell, level);
  wz.cd[spell] = w.t + L.cd;
  for (let i = 0; i < (SHOTS[spell] ?? 1); i++) w.events.push({ k: 'fire', id: wz.id, src: spell });
  wz.windUntil = 0; // qualquer magia acaba com a Caminhada no vento (windwalkmodifier.lua)
  // Elo: teleportar ou trocar para fora da arena solta o mago ligado (linkmodifier.lua)
  if ((spell === 'teleport' || spell === 'swap') && !inArena(w, at)) w.projectiles = w.projectiles.filter((p) => !(p.kind === 'link' && p.owner === wz.id && p.target));
  if (w.t < wz.gripUntil) wz.dmgTaken += GRIP.castPenalty; // preso, cada magia custa mais empurrão
  const dmgMult = L.dmg > 0 ? usePact(w, wz) : 1;
  const dir = norm(sub(at, wz.pos));
  wz.facing = Math.atan2(dir.y, dir.x);
  const flight = (L.range / L.speed) * wz.rangeF; // segundos de voo do alcance todo

  // projétil reto saindo do mago; life em segundos (já com o alcance do Elmo)
  const launch = (kind: ProjKind, d: Vec, life: number, target: string | null = null, from = add(wz.pos, scale(d, WIZ_R + PROJ_R + 0.05))) => {
    const p: Projectile = { id: w.nextId++, born: w.t, kind, owner: wz.id, pos: from, vel: scale(d, L.speed), level, until: w.t + life, target, dmgMult, caster: wz.id };
    w.projectiles.push(p);
    return p;
  };

  if (spell === 'fireball' || spell === 'homing') {
    const homing = spell === 'homing';
    launch(spell, dir, homing ? L.duration * wz.rangeF : flight, homing ? (nearestEnemy(w, at, wz.id)?.id ?? null) : null);
  } else if (spell === 'cluster') {
    const base = Math.atan2(dir.y, dir.x);
    for (const off of CLUSTER_FAN) launch('cluster', v(Math.cos(base + off), Math.sin(base + off)), flight);
  } else if (spell === 'grip' || spell === 'snowball' || spell === 'magnetize') {
    launch(spell, dir, flight);
  } else if (spell === 'swap') {
    // voa o alcance todo e troca com o primeiro mago que tocar (no original parava no clique e errava quem se mexia);
    // errou: vai só até a metade do caminho até a mira (pedidos do Fernando, 17/10)
    launch('swap', dir, (L.range * wz.rangeF) / L.speed, null, wz.pos).dest = add(wz.pos, scale(clampLen(sub(at, wz.pos), L.range * wz.rangeF), 0.5));
  } else if (spell === 'meteor') {
    const to = add(wz.pos, clampLen(sub(at, wz.pos), L.range * wz.rangeF));
    w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'meteor', owner: wz.id, pos: to, vel: v(0, 0), level, until: w.t + METEOR_DELAY, target: null, dmgMult, caster: wz.id });
  } else if (spell === 'rush') {
    wz.rushUntil = w.t + L.duration;
    wz.rushLeft = L.absorb;
    wz.rushBonus = RUSH.bonus;
    wz.dashUntil = w.t + RUSH.dashTime - DT / 2; // meio passo de folga: o arredondamento daria um passo a mais
    wz.dashVel = scale(dir, RUSH.dash / RUSH.dashTime);
    wz.dashHit = [];
    wz.target = null;
  } else if (spell === 'boomerang') {
    // boomerang.lua e boomerangprojectile.lua: velocidade e acelerações que levam ao ponto (300 a 800 u) em curva e trazem de volta
    const d = Math.min(Math.max(len(sub(at, wz.pos)), BOOMERANG.minDist), L.range * wz.rangeF);
    const perp = v(-dir.y, dir.x);
    const par = -(L.speed * L.speed) / (2 * d);
    const side = (2 * par * BOOMERANG.side) / L.speed;
    const flip = -L.speed / par;
    const p = launch('boomerang', dir, BOOMERANG.life);
    p.vel = add(scale(dir, L.speed), scale(perp, BOOMERANG.side));
    p.curve = { acc: add(scale(dir, par), scale(perp, side)), next: sub(scale(dir, par), scale(perp, side)), flipAt: w.t + flip, stopAt: w.t + 2 * flip - 0.15 };
  } else if (spell === 'gravity') {
    launch('gravity', dir, flight).tick = w.t + GRAVITY.tick;
  } else if (spell === 'bouncer') {
    launch('bouncer', dir, flight).prev = wz.id;
  } else if (spell === 'thrust') {
    // thrust.lua: sai a 77% da velocidade rumo ao ponto (até 900 u) e acelera; dura o caminho + 0,09 s
    const d = Math.min(len(sub(at, wz.pos)), L.range * wz.rangeF);
    wz.vel = scale(dir, THRUST.start * L.speed);
    wz.thrustAcc = scale(dir, L.speed * THRUST.accel);
    wz.thrustUntil = w.t + THRUST.extra + d / L.speed;
    wz.thrustMult = dmgMult;
    wz.target = null;
  } else if (spell === 'rockpillar') {
    // rockpillar.lua: obstáculo no ponto (até o alcance) que some depois da duração
    const pos = add(wz.pos, clampLen(sub(at, wz.pos), L.range * wz.rangeF));
    // parede atravessada no caminho mago → ponto: o do meio no ponto, os outros dois para os lados
    const way = len(sub(at, wz.pos)) > 1e-6 ? norm(sub(at, wz.pos)) : v(Math.cos(wz.facing), Math.sin(wz.facing));
    const side = v(-way.y, way.x), mid = w.pillars.length;
    for (const k of [0, -1, 1]) w.pillars.push({ pos: add(pos, scale(side, k * WALL_GAP)), hp: OBSTACLES.rockpillar.hp, alive: true, kind: 'rockpillar', until: w.t + L.duration, wall: mid });
  } else if (spell === 'drain') {
    // drain.lua: reto até o ponto (no máximo o alcance), depois vira para o mago mais perto e voa mais 1,2 s
    const turn = Math.min(len(sub(at, wz.pos)), L.range * wz.rangeF) / L.speed;
    launch('drain', dir, turn + DRAIN.extra * wz.rangeF).turnAt = w.t + turn;
  } else if (spell === 'illusion') {
    // a cópia segue o movimento atual (ou o destino recém-ordenado); parada, usa a direção da magia
    const moveDir = len(wz.vel) > 0.5 ? norm(wz.vel) : wz.target && dist(wz.target, wz.pos) > 0.1 ? norm(sub(wz.target, wz.pos)) : dir;
    launch('illusion', moveDir, L.duration, null, wz.pos);
    wz.veilUntil = w.t + L.duration;
  } else if (spell === 'recharge') {
    launch('recharge', dir, flight).bonus = RECHARGE.perHit * wz.streak;
  } else if (spell === 'alteration') {
    wz.alterUntil = w.t + L.duration;
  } else if (spell === 'link') {
    // link.lua: voa o alcance e recolhe; preso a alguém ou a um obstáculo, fica até soltar (linkHold)
    launch('link', dir, LINK.life).turnAt = w.t + (L.range * wz.rangeF) / L.speed;
  } else if (spell === 'windwalk') {
    wz.windUntil = w.t + L.duration;
    wz.windMult = dmgMult;
  } else if (spell === 'splitter') {
    // splitter.lua: estoura no ponto se ele estiver mais perto que 1 s de voo; os 8 filhotes contam como 8 tiros (SHOTS)
    launch('splitter', dir, Math.min(L.range * wz.rangeF, len(sub(at, wz.pos))) / L.speed);
  } else if (spell === 'warpzone') {
    const to = add(wz.pos, clampLen(sub(at, wz.pos), L.range * wz.rangeF));
    w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'warpzone', owner: wz.id, pos: to, vel: v(0, 0), level, until: w.t + L.duration, target: null, dmgMult, caster: wz.id });
  } else if (spell === 'lightning') {
    const end = add(wz.pos, scale(dir, L.range * wz.rangeF));
    const found = firstOnSegment(w, wz.pos, end, WIZ_R, wz.id);
    const proj = firstProjectileOnSegment(w, wz.pos, end, wz.id);
    const pil = firstPillarOnSegment(w, wz.pos, end, 0.1);
    if (pil && (!found || pil.t < found.t) && (!proj || pil.t < proj.t)) {
      const at = w.pillars[pil.i].pos;
      w.events.push({ k: 'lightning', from: wz.pos, to: at });
      damagePillar(w, pil.i, L.dmg * dmgMult, wz.id);
      return;
    }
    if (proj && (!found || proj.t < found.t)) {
      w.events.push({ k: 'lightning', from: wz.pos, to: proj.p.pos });
      w.projectiles = w.projectiles.filter((q) => q !== proj.p);
      // como no original: dano máximo 2/3 de (dano do raio + 70), caindo até zero na borda, empurrão 1,35×
      if (proj.p.kind === 'fireball') area(w, proj.p.pos, CLASH.detonate.r, (2 / 3) * (L.dmg * dmgMult + 70), 1.35, wz.id, 'detonate');
      else w.events.push({ k: 'clash', x: proj.p.pos.x, y: proj.p.pos.y, combo: 'pulse', r: 0.6 });
      return;
    }
    if (!found) return void w.events.push({ k: 'lightning', from: wz.pos, to: end });
    const target = found.wz;
    w.events.push({ k: 'lightning', from: wz.pos, to: target.pos });
    if (shielded(w, target)) {
      w.events.push({ k: 'reflect', id: target.id, x: target.pos.x, y: target.pos.y });
      w.events.push({ k: 'lightning', from: target.pos, to: wz.pos });
      hit(w, wz, target.id, L.dmg * dmgMult, L.knock * dmgMult, scale(dir, -1), 'lightning');
    } else {
      hit(w, target, wz.id, L.dmg * dmgMult, L.knock * dmgMult, dir, 'lightning');
      w.events.push({ k: 'land', id: wz.id, src: 'lightning' });
    }
  } else if (spell === 'shield') {
    wz.shieldUntil = w.t + L.duration;
    wz.shieldR = L.radius;
  } else {
    // teleport
    const from = wz.pos;
    wz.pos = add(wz.pos, clampLen(sub(at, wz.pos), L.range * wz.rangeF));
    wz.target = null;
    w.events.push({ k: 'teleport', id: wz.id, from, to: wz.pos });
  }
}

// Pacto armado: esta magia sai 2× mais forte (dano e empurrão) e o Pacto acaba
function usePact(w: World, wz: Wizard): number {
  if (w.t >= wz.pactUntil) return 1;
  wz.pactUntil = 0;
  return PACT.mult;
}

// começa a conjurar: confere nível e recarga agora; o efeito sai depois do tempo de conjuração
function beginCast(w: World, wz: Wizard, what: { spell?: SpellId; item?: ItemId }, at: Vec) {
  // a mesma magia já sendo conjurada: ignora a tecla repetida (a recarga só começa quando ela sai)
  if (wz.casting && wz.casting.spell === what.spell && wz.casting.item === what.item) return;
  // Flagelo em preparo: nada mais sai até ele explodir, menos o Teleporte, que cancela a explosão (pedidos do Fernando, 17/10)
  if (wz.casting?.item === 'scourge') {
    if (what.spell !== 'teleport') return;
    wz.casting = null;
  }
  if (what.spell) {
    if (!wz.spells[what.spell] || w.t < wz.cd[what.spell]) return;
  } else if (what.item) {
    if (!wz.items[what.item] || !isActive(what.item) || w.t < wz.itemCd[what.item]) return;
  }
  const delay = what.spell ? CAST_POINT[what.spell] : (ITEM_CAST[what.item!] ?? 0);
  const d = sub(at, wz.pos);
  if (len(d) > 0.01) wz.facing = Math.atan2(d.y, d.x);
  if (what.spell) w.events.push({ k: 'cast', id: wz.id, spell: what.spell });
  else w.events.push({ k: 'item', id: wz.id, item: what.item! });
  if (what.spell && what.spell !== 'illusion') wz.veilUntil = 0; // outra magia revela o dono, mas a cópia continua até o próprio prazo
  if (delay <= 0) return fire(w, wz, what, at);
  wz.target = null;
  wz.casting = { ...what, at, fireAt: w.t + delay };
}

function fire(w: World, wz: Wizard, what: { spell?: SpellId; item?: ItemId }, at: Vec) {
  if (what.spell) cast(w, wz, what.spell, at);
  else useItem(w, wz, what.item!, at);
}

function useItem(w: World, wz: Wizard, item: ItemId, at: Vec) {
  const level = wz.items[item];
  if (!level || w.t < wz.itemCd[item]) return; // item ativo: beginCast já conferiu
  if (item === 'scourge') {
    wz.itemCd.scourge = w.t + SCOURGE.cd;
    scourge(w, wz);
  } else if (item === 'pact') {
    w.events.push({ k: 'fire', id: wz.id, src: 'pact' });
    wz.itemCd.pact = w.t + PACT.cd;
    wz.pactUntil = w.t + PACT.window;
  } else {
    // todos os projéteis seus voando viram para o cursor; sem nenhum, o item não gasta
    const mine = w.projectiles.filter((p) => p.owner === wz.id && !fixed(p) && !returning(p) && p.kind !== 'link' && dist(p.pos, at) > 0.05);
    if (!mine.length) return;
    w.events.push({ k: 'fire', id: wz.id, src: 'redirector' });
    wz.itemCd.redirector = w.t + REDIRECTOR.cd;
    for (const p of mine) {
      p.vel = scale(norm(sub(at, p.pos)), len(p.vel));
      p.until += REDIRECTOR.extraLife;
      p.target = null; // o míssil passa a seguir reto para onde foi mandado
      w.events.push({ k: 'redirect', x: p.pos.x, y: p.pos.y });
    }
  }
}

// Flagelo: explosão em volta; quanto mais perto do centro, mais empurrão (no original custava a mesma vida a quem usa;
// aqui não custa nada, a pedido do Fernando em 17/10)
function scourge(w: World, wz: Wizard) {
  const mult = usePact(w, wz);
  const dmg = SCOURGE.dmg[wz.items.scourge - 1] * mult;
  w.events.push({ k: 'fire', id: wz.id, src: 'scourge' });
  let landed = false;
  for (const o of w.wizards) {
    if (!o.alive || o.id === wz.id) continue;
    const d = dist(o.pos, wz.pos);
    if (d > SCOURGE.radius + WIZ_R) continue;
    const factor = 0.75 + 0.25 * Math.max(0, 1 - d / SCOURGE.radius);
    hit(w, o, wz.id, dmg, dmg * KB_PER_DMG * factor, sub(o.pos, wz.pos), 'scourge');
    landed = true;
  }
  if (landed) w.events.push({ k: 'land', id: wz.id, src: 'scourge' });
  for (const q of w.projectiles) {
    const owner = anyById(w, q.owner);
    if (q.kind !== 'illusion' || q.owner === wz.id || (owner && allies(wz, owner))) continue;
    const d = dist(q.pos, wz.pos);
    if (d <= SCOURGE.radius + WIZ_R) {
      const factor = 0.75 + 0.25 * Math.max(0, 1 - d / SCOURGE.radius);
      q.vel = add(q.vel, scale(norm(sub(q.pos, wz.pos)), dmg * KB_PER_DMG * factor));
    }
  }
  // também bate nos obstáculos e no baú dentro da explosão (pedido do Fernando, 17/10)
  // a parede apanha uma vez, mesmo com mais de um pedaço dentro
  const walls = new Set<number>();
  w.pillars.forEach((q, i) => {
    if (!q.alive || dist(q.pos, wz.pos) > SCOURGE.radius + OBSTACLES[q.kind].r || (q.wall !== undefined && walls.has(q.wall))) return;
    if (q.wall !== undefined) walls.add(q.wall);
    damagePillar(w, i, dmg, wz.id);
  });
  // também destrói bolas de fogo e mísseis inimigos dentro da explosão (pedido do Fernando, 17/10)
  const caught = w.projectiles.filter((p) => p.owner !== wz.id && p.kind !== 'illusion' && !fixed(p) && p.kind !== 'snowball' && dist(p.pos, wz.pos) <= SCOURGE.radius + PROJ_R);
  if (caught.length) {
    w.projectiles = w.projectiles.filter((p) => !caught.includes(p));
    for (const p of caught) w.events.push({ k: 'clash', x: p.pos.x, y: p.pos.y, combo: 'pulse', r: 0.6 });
  }
  w.events.push({ k: 'scourge', id: wz.id, x: wz.pos.x, y: wz.pos.y, r: SCOURGE.radius });
}

// o meteoro cai: dano de dmgMin na borda até o máximo no centro, em todos menos quem lançou
function meteorLand(w: World, p: Projectile) {
  const L = spellLevel('meteor', p.level);
  let landed = false;
  for (const o of w.wizards) {
    if (!o.alive || o.id === p.owner) continue;
    const d = dist(o.pos, p.pos);
    if (d > L.radius + WIZ_R) continue;
    const amount = (L.dmgMin + (L.dmg - L.dmgMin) * Math.max(0, 1 - d / L.radius)) * p.dmgMult;
    hit(w, o, p.owner, amount, amount * (L.knock / L.dmg), sub(o.pos, p.pos), 'meteor');
    landed = true;
  }
  const owner = anyById(w, p.owner);
  for (const q of w.projectiles) {
    const qo = q.kind === 'illusion' ? anyById(w, q.owner) : undefined;
    if (!qo || q.owner === p.owner || allies(owner, qo)) continue;
    const d = dist(q.pos, p.pos);
    if (d > L.radius + WIZ_R) continue;
    const amount = (L.dmgMin + (L.dmg - L.dmgMin) * Math.max(0, 1 - d / L.radius)) * p.dmgMult;
    q.vel = add(q.vel, scale(norm(sub(q.pos, p.pos)), amount * (L.knock / L.dmg) * KB_PER_DMG));
  }
  w.events.push({ k: 'clash', x: p.pos.x, y: p.pos.y, combo: 'fire', r: L.radius });
  if (landed) land(w, p, 'meteor');
}

// a Troca sem alvo: o mago vai ao destino (metade do caminho até a mira), ou para onde ela bateu num obstáculo antes de chegar lá
function swapEnd(w: World, p: Projectile) {
  const wz = byId(w, p.owner);
  if (!wz) return;
  const from = wz.pos;
  wz.pos = p.dest && dot(sub(p.pos, p.dest), p.vel) >= 0 ? p.dest : p.pos;
  wz.target = null;
  w.events.push({ k: 'teleport', id: wz.id, from, to: wz.pos });
}

function swapPlaces(w: World, p: Projectile, other: Wizard) {
  const wz = byId(w, p.owner);
  if (!wz) return;
  const [a, b] = [wz.pos, other.pos];
  wz.pos = b;
  other.pos = a;
  wz.target = null;
  w.events.push({ k: 'teleport', id: wz.id, from: a, to: b }, { k: 'teleport', id: other.id, from: b, to: a });
}

// projétil quica num círculo (mago ou obstáculo): reflete se estava indo para ele e sai de dentro
function bounceOff(p: Projectile, center: Vec, r: number, speed = len(p.vel)) {
  const n = norm(sub(p.pos, center));
  const into = dot(p.vel, n);
  if (into < 0) p.vel = sub(p.vel, scale(n, 2 * into));
  p.vel = scale(norm(p.vel), speed);
  p.pos = add(center, scale(n, r + PROJ_R + BOOMERANG.gap));
}

// Gravidade (gravityprojectile.lua): puxa magos inimigos e todos os projéteis (menos meteoro e outra gravidade) e queima
// quem está perto a cada 0,2 s, sem empurrão
function gravityPull(w: World, g: Projectile) {
  const L = spellLevel('gravity', g.level);
  const owner = anyById(w, g.owner);
  for (const o of w.wizards) {
    if (!o.alive || o.id === g.owner || allies(owner, o)) continue; // aliado não é puxado nem queimado
    const d = dist(g.pos, o.pos);
    // no original é aceleração na velocidade; aqui o mago parado zera velocidade abaixo de 0,05 m/s (moveWizard), então o puxão
    // vira deslocamento na velocidade de equilíbrio (puxão ÷ atrito), sem deixar o mago atordoado: ele ainda anda contra, como lá
    if (d <= GRAVITY.wizR) o.pos = add(o.pos, scale(norm(sub(g.pos, o.pos)), (L.pull / FRICTION) * (1 - (d * d) / (GRAVITY.wizR * GRAVITY.wizR)) * DT));
  }
  for (const q of w.projectiles) {
    if (fixed(q) || q.kind === 'gravity') continue;
    const d = dist(g.pos, q.pos);
    if (d <= GRAVITY.projR) q.vel = add(q.vel, scale(norm(sub(g.pos, q.pos)), GRAVITY.projPull * (1.5 - (d * d) / (GRAVITY.projR * GRAVITY.projR)) * DT));
  }
  if (w.t < (g.tick ?? 0)) return;
  g.tick = w.t + GRAVITY.tick;
  for (const o of w.wizards) {
    if (!o.alive || o.id === g.owner || allies(owner, o) || dist(g.pos, o.pos) > L.radius) continue;
    hit(w, o, g.owner, L.dmg * GRAVITY.tick * g.dmgMult, 0, sub(o.pos, g.pos), 'gravity');
    land(w, g, 'gravity', true);
  }
}

// Bumerangue (boomerangprojectile.lua): indo, segue as acelerações da curva; voltando, vira até 1000 u/s² rumo ao dono
// a 1000 u/s e some ao encostar nele. Devolve false quando acabou
function steerBoomerang(w: World, p: Projectile, dt: number): boolean {
  const owner = byId(w, p.owner);
  if (!owner) return false;
  if (p.curve) {
    p.vel = add(p.vel, scale(p.curve.acc, dt));
    if (w.t >= p.curve.flipAt) [p.curve.acc, p.curve.flipAt] = [p.curve.next, Infinity];
    if (w.t >= p.curve.stopAt) [p.curve, p.back] = [undefined, true];
    return true;
  }
  if (dist(owner.pos, p.pos) < WIZ_R + PROJ_R) return false;
  const want = sub(scale(norm(sub(owner.pos, p.pos)), BOOMERANG.back), p.vel);
  p.vel = add(p.vel, scale(norm(want), Math.min(len(want), BOOMERANG.turn * dt)));
  return true;
}

// Estocada (thrustmodifier.lua): acelera e, ao encostar num inimigo, para e causa dano proporcional ao quadrado da
// velocidade (cheio a partir de 80% dele); escudo faz o mago quicar; sem acertar, freia para 20% no fim
function stepThrust(w: World, wz: Wizard) {
  if (wz.thrustUntil <= 0) return;
  if (w.t >= wz.thrustUntil) {
    wz.thrustUntil = 0;
    wz.vel = scale(wz.vel, THRUST.endSlow);
    return;
  }
  wz.vel = add(wz.vel, scale(wz.thrustAcc, DT));
  const L = spellLevel('thrust', wz.spells.thrust);
  for (const o of w.wizards) {
    if (!o.alive || o === wz) continue;
    const n = norm(sub(o.pos, wz.pos));
    if (dist(o.pos, wz.pos) > 2 * WIZ_R + THRUST.reach + bubble(w, o)) continue;
    if (shielded(w, o)) {
      const into = dot(wz.vel, n);
      if (into > 0) {
        wz.vel = sub(wz.vel, scale(n, 2 * into));
        w.events.push({ k: 'reflect', id: o.id, x: o.pos.x, y: o.pos.y });
      }
      continue;
    }
    const k = Math.min(1, dot(wz.vel, wz.vel) / (L.speed * L.speed) / THRUST.full);
    wz.vel = v(0, 0);
    wz.thrustUntil = 0;
    hit(w, o, wz.id, L.dmg * k * wz.thrustMult, L.knock * k * wz.thrustMult, n, 'thrust');
    w.events.push({ k: 'land', id: wz.id, src: 'thrust' });
    return;
  }
}

// Caminhada no vento (windwalkmodifier.lua): o primeiro inimigo que encosta leva o dano e o efeito acaba (aliado atravessa)
function windTouch(w: World, wz: Wizard) {
  const L = spellLevel('windwalk', wz.spells.windwalk);
  for (const o of w.wizards) {
    if (!o.alive || o === wz || allies(wz, o) || dist(o.pos, wz.pos) > 2 * WIZ_R + WINDWALK.reach) continue;
    wz.windUntil = 0;
    hit(w, o, wz.id, L.dmg * wz.windMult, L.knock * wz.windMult, sub(o.pos, wz.pos), 'windwalk');
    w.events.push({ k: 'land', id: wz.id, src: 'windwalk' });
    return;
  }
}

// não andam: meteoro e zona de dobra. A cópia da Ilusão anda sozinha e pode ser afetada por habilidades.
const fixed = (p: Projectile) => p.kind === 'meteor' || p.kind === 'warpzone';
const returning = (p: Projectile) => !!p.back && (p.kind === 'drain' || p.kind === 'recharge'); // bolinha voltando a quem lançou
export const spellOf = (k: ProjKind): SpellId => (k === 'shard' ? 'splitter' : k); // os filhotes são do Divisor
// acerto conta para quem lançou ('land'), não para quem devolveu; once: só o primeiro (os que acertam mais de uma vez)
function land(w: World, p: Projectile, src: AimSrc, once = false) {
  if (p.owner === p.caster && !(once && p.landed)) w.events.push({ k: 'land', id: p.caster, src });
  if (once) p.landed = true;
}

// Zonas de dobra (warpzone.lua) de inimigos de `id` (quem não é ele nem aliado dele) que cobrem o ponto p
function enemyWarps(w: World, id: string, p: Vec): Projectile[] {
  const me = anyById(w, id);
  return w.projectiles.filter((z) => {
    if (z.kind !== 'warpzone' || z.owner === id) return false;
    const zo = anyById(w, z.owner);
    return (!zo || !allies(me, zo)) && dist(z.pos, p) <= spellLevel('warpzone', z.level).radius;
  });
}

// projétil anda e vive mais devagar dentro da zona de um inimigo do dono (zonas juntas multiplicam)
function timeScale(w: World, p: Projectile): number {
  let ts = 1;
  for (const z of enemyWarps(w, p.owner, p.pos)) ts *= spellLevel('warpzone', z.level).scale;
  return ts;
}

// mago dentro da zona de um inimigo anda mais devagar (zonas juntas não somam)
const inWarp = (w: World, wz: Wizard) => enemyWarps(w, wz.id, wz.pos).length > 0;

// tempo lento: todos os prazos do projétil andam junto
function delay(p: Projectile, d: number) {
  p.until += d;
  if (p.curve) [p.curve.flipAt, p.curve.stopAt] = [p.curve.flipAt + d, p.curve.stopAt + d];
  if (p.tick !== undefined) p.tick += d;
  if (p.turnAt !== undefined) p.turnAt += d;
}

// Magnetizar (magnetizemodifier.lua): projéteis de inimigos do magnetizado a até 300 u viram para ele (atrai) ou para longe (repele)
function magnetPull(w: World) {
  for (const z of w.wizards) {
    if (!z.alive || w.t >= z.magnetUntil) continue;
    for (const q of w.projectiles) {
      if (fixed(q) || q.owner === z.id || allies(anyById(w, q.owner), z)) continue;
      const d = dist(q.pos, z.pos);
      if (d > MAGNETIZE.r) continue;
      // o original vira f por tique de 0,035 s; aqui a mesma curva por segundo com passos de 1/60 s
      const f = 1 - (1 - MAGNETIZE.f * (1 - (d * d) / (MAGNETIZE.r * MAGNETIZE.r))) ** (DT / MAGNETIZE.tick);
      q.vel = add(scale(q.vel, 1 - f), scale(norm(sub(z.pos, q.pos)), f * len(q.vel) * z.magnet));
    }
  }
}

// Alteração (alterationmodifier.lua): o primeiro projétil inimigo que entra na bolha indo para o mago troca de lugar com ele
function alter(w: World, p: Projectile, next: Vec): boolean {
  if (p.kind === 'gravity') return false;
  const owner = anyById(w, p.owner);
  for (const z of w.wizards) {
    if (!z.alive || w.t >= z.alterUntil || z.id === p.owner || allies(owner, z)) continue;
    if (dist(next, z.pos) > spellLevel('alteration', z.spells.alteration).radius + PROJ_R || dot(p.vel, sub(z.pos, p.pos)) <= 0) continue;
    const from = z.pos;
    [z.pos, p.pos] = [p.pos, from];
    z.alterUntil = 0;
    w.events.push({ k: 'teleport', id: z.id, from, to: z.pos }, { k: 'land', id: z.id, src: 'alteration' });
    return true;
  }
  return false;
}

// bolinha voltando a quem lançou: a do Drenar cura, a da Recarga zera a recarga (drainhealprojectile.lua, rechargerefreshprojectile.lua)
function flyBack(w: World, p: Projectile, dt: number): boolean {
  const to = byId(w, p.target);
  if (!to || w.t >= p.until) return false;
  const drain = p.kind === 'drain';
  if (dist(to.pos, p.pos) < (drain ? DRAIN.reach : RECHARGE.reach)) {
    if (drain) heal(to, spellLevel('drain', p.level).dmg * p.dmgMult);
    else to.cd.recharge = w.t;
    return false;
  }
  p.vel = scale(norm(sub(to.pos, p.pos)), drain ? DRAIN.back : RECHARGE.back);
  p.pos = add(p.pos, scale(p.vel, dt));
  return true;
}

// Drenar: no inimigo, dano (empurrão 0,2), lentidão e uma bolinha de cura que volta a quem lançou; no aliado, cura e pressa
function drainHit(w: World, p: Projectile, wz: Wizard, L: Level) {
  const owner = anyById(w, p.owner);
  const amount = L.dmg * p.dmgMult;
  if (allies(owner, wz)) {
    heal(wz, amount);
    wz.haste = DRAIN.haste;
    wz.hasteUntil = w.t + L.duration;
    return;
  }
  hit(w, wz, p.owner, amount, L.knock * p.dmgMult, p.vel, 'drain');
  slowDown(w, wz, DRAIN.slow, L.duration * wz.debuffMult);
  land(w, p, 'drain');
  w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'drain', owner: p.owner, pos: p.pos, vel: v(0, 0), level: p.level, until: w.t + DRAIN.life, target: p.owner, dmgMult: p.dmgMult, caster: p.caster, back: true });
}

export const snowR = (level: number) => SNOWBALL.coll + SNOWBALL.perLevel * (level - 1);

// Bola de neve rolando: arrasta quem encosta e, a cada 0,5 s de contato, deixa lento e marca o dano (só inimigos, como no original)
function snowRoll(w: World, p: Projectile, at: Vec) {
  const L = spellLevel('snowball', p.level);
  const owner = anyById(w, p.owner);
  const dir = norm(p.vel);
  for (const o of w.wizards) {
    if (!o.alive || o.id === p.owner || allies(owner, o) || dist(at, o.pos) > WIZ_R + snowR(p.level)) continue;
    const c = SNOWBALL.drag - dot(dir, o.vel);
    if (c > 0) o.vel = add(o.vel, scale(dir, c));
    if (o.snow) continue;
    o.snow = { until: w.t + SNOWBALL.period, by: p.owner, dmg: L.dot * SNOWBALL.period * p.dmgMult };
    slowDown(w, o, SNOWBALL.slow, SNOWBALL.period);
    land(w, p, 'snowball', true);
  }
}

// a Bola de neve explode (fim do voo ou obstáculo): 0 na borda até dmg no centro, em todos menos quem lançou (como o Meteoro)
function snowBlast(w: World, p: Projectile) {
  const L = spellLevel('snowball', p.level);
  let landed = false;
  for (const o of w.wizards) {
    const k = 1 - dist(o.pos, p.pos) / L.radius;
    if (!o.alive || o.id === p.owner || k <= 0) continue;
    hit(w, o, p.owner, L.dmg * k * p.dmgMult, L.knock * k * p.dmgMult, sub(o.pos, p.pos), 'snowball');
    landed = true;
  }
  if (landed) land(w, p, 'snowball', true);
  w.events.push({ k: 'clash', x: p.pos.x, y: p.pos.y, combo: 'snow', r: L.radius });
}

// cópia da Ilusão de um inimigo do dono de p que o segmento p.pos→b toca (a mais perto do começo); t em [0,1]
function decoyOnSegment(w: World, p: Projectile, b: Vec, radius: number): { q: Projectile; t: number } | null {
  const owner = anyById(w, p.owner);
  const d = sub(b, p.pos);
  let best: { q: Projectile; t: number } | null = null;
  for (const q of w.projectiles) {
    const qo = q.kind === 'illusion' && q.until > w.t && q.owner !== p.owner ? anyById(w, q.owner) : undefined;
    if (!qo || allies(owner, qo)) continue;
    const [t, gap] = segT(p.pos, d, q.pos);
    if (gap <= radius && (!best || t < best.t)) best = { q, t };
  }
  return best;
}

// Divisor: o projétil vira o lançador de filhotes (sem colisão), que anda devagar e solta 4 ondas de 2
function split(w: World, p: Projectile) {
  p.vel = scale(norm(p.vel), SPLITTER.spawnSpeed);
  p.waves = SPLITTER.waves;
  p.tick = w.t + SPLITTER.spawnLife / SPLITTER.waves;
  p.until = Infinity; // acaba na última onda
}

// splitterspawnerprojectile.lua: filhotes simétricos que abrem menos a cada onda (a conta do original, sem normalizar)
function spawnShards(w: World, p: Projectile, dt: number): boolean {
  p.pos = add(p.pos, scale(p.vel, dt));
  if (w.t < (p.tick ?? 0)) return true;
  const d = norm(p.vel);
  const a = SPLITTER.spawnLife * (p.waves! / SPLITTER.waves);
  for (const s of [-1, 1]) {
    const dir = v((d.x - s * d.y * a) / (1 + a), (d.y + s * d.x * a) / (1 + a));
    w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'shard', owner: p.owner, pos: p.pos, vel: scale(dir, SPLITTER.childSpeed), level: p.level, until: w.t + SPLITTER.childLife, target: null, dmgMult: p.dmgMult, caster: p.caster });
  }
  p.tick = (p.tick ?? 0) + SPLITTER.spawnLife / SPLITTER.waves;
  return --p.waves! > 0;
}

// Elo preso (linkmodifier.lua): puxa o mago ligado até quem lançou (ou quem lançou até o obstáculo), com dano a cada 0,2 s no inimigo;
// solta perto, com escudo ou Investida no ligado, ou se alguém morreu. Devolve false quando acabou
function linkHold(w: World, p: Projectile): boolean {
  const owner = byId(w, p.owner);
  if (!owner) return false;
  const L = spellLevel('link', p.level);
  if (p.pillar !== undefined) {
    const q = w.pillars[p.pillar];
    if (!q.alive || dist(owner.pos, q.pos) < OBSTACLES[q.kind].r + WIZ_R + LINK.pillarGap) return false;
    owner.vel = add(owner.vel, scale(norm(sub(q.pos, owner.pos)), L.pull * DT));
    return true;
  }
  const o = byId(w, p.target);
  if (!o || shielded(w, o) || w.t < o.rushUntil || dist(owner.pos, o.pos) < 2 * WIZ_R + LINK.wizGap) return false;
  o.vel = add(o.vel, scale(norm(sub(owner.pos, o.pos)), L.pull * DT));
  p.pos = o.pos;
  if (w.t >= (p.tick ?? 0)) {
    p.tick = w.t + LINK.tick;
    if (!allies(owner, o)) hit(w, o, p.owner, L.dmg * LINK.tick * p.dmgMult, 0, v(0, 0), 'link');
  }
  return true;
}

function stepProjectiles(w: World) {
  for (const g of w.projectiles) if (g.kind === 'gravity') gravityPull(w, g);
  magnetPull(w);
  const keep: Projectile[] = [];
  // projéteis criados durante o passo (cura do Drenar, filhotes do Divisor) entram no fim da lista e já andam neste passo
  for (const p of w.projectiles) {
    if (p.kind === 'meteor') {
      if (w.t >= p.until) meteorLand(w, p);
      else keep.push(p);
      continue;
    }
    if (p.kind === 'warpzone') {
      if (w.t < p.until) keep.push(p);
      continue;
    }
    if (p.kind === 'link' && (p.target || p.pillar !== undefined)) {
      if (linkHold(w, p)) keep.push(p);
      continue;
    }
    const ts = p.kind === 'illusion' ? 1 : timeScale(w, p); // a cópia mantém os 2 s de duração mesmo em zonas lentas
    const dt = DT * ts;
    if (ts < 1) delay(p, DT - dt);
    if (returning(p)) {
      if (flyBack(w, p, dt)) keep.push(p);
      continue;
    }
    if (p.kind === 'illusion') {
      // cópia autônoma: segue o vetor de movimento e só desaparece no prazo; projéteis podem empurrá-la, nunca destruí-la
      const next = add(p.pos, scale(p.vel, dt));
      if (!firstPillarOnSegment(w, p.pos, next, WIZ_R)) p.pos = next;
      if (w.t < p.until) keep.push(p);
      continue;
    }
    if (p.waves !== undefined) {
      if (spawnShards(w, p, dt)) keep.push(p);
      continue;
    }
    const L = spellLevel(spellOf(p.kind), p.level);
    if (p.kind === 'boomerang' && (w.t >= p.until || !steerBoomerang(w, p, dt))) continue;
    if (p.kind === 'link' && w.t >= (p.turnAt ?? Infinity)) {
      // o Elo recolhe: volta a quem lançou e some perto dele (linkprojectile.lua)
      const owner = byId(w, p.owner);
      if (!owner || dist(owner.pos, p.pos) < LINK.gone) continue;
      p.back = true;
      p.vel = scale(norm(sub(owner.pos, p.pos)), L.speed);
    }
    if (p.kind === 'drain' && w.t >= (p.turnAt ?? Infinity)) {
      // o Drenar vira para o mago mais perto, aliado ou inimigo (drainprojectile.lua)
      p.turnAt = undefined;
      let to: Wizard | null = null;
      for (const z of w.wizards) if (z.alive && z.id !== p.owner && (!to || dist(z.pos, p.pos) < dist(to.pos, p.pos))) to = z;
      p.vel = scale(to ? norm(sub(to.pos, p.pos)) : norm(p.vel), DRAIN.turnSpeed);
    }
    // Ilusão: o míssil que perseguia o dono persegue a cópia enquanto ela existir
    const chase = p.kind === 'homing' ? byId(w, p.target) : undefined;
    const target = chase && (w.projectiles.find((q) => q.kind === 'illusion' && q.owner === chase.id && q.until > w.t) ?? chase);
    if (target) {
      // gira no máximo HOMING_TURN rad/s em direção ao alvo: o atraso faz o míssil rodear antes de acertar
      const cur = Math.atan2(p.vel.y, p.vel.x);
      const want = Math.atan2(target.pos.y - p.pos.y, target.pos.x - p.pos.x);
      const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const a = cur + Math.max(-HOMING_TURN * dt, Math.min(HOMING_TURN * dt, diff));
      const speed = len(p.vel);
      p.vel = v(Math.cos(a) * speed, Math.sin(a) * speed);
    }
    // a Troca anda só o que falta no último passo, para parar exatamente no ponto da mira (até - agora = tempo de voo que falta)
    const next = add(p.pos, scale(p.vel, p.kind === 'swap' ? Math.min(dt, Math.max(0, p.until - w.t - DT + dt)) : dt));
    if (alter(w, p, next)) {
      keep.push(p);
      continue;
    }
    // a Gravidade não bate em mago; o Ricochete não repete o último mago tocado (pode voltar em quem lançou);
    // o Magnetizar só pega quem lançou depois de quicar; a Bola de neve é grande
    const r = p.kind === 'snowball' ? snowR(p.level) : PROJ_R;
    let found = p.kind === 'gravity' ? null : firstOnSegment(w, p.pos, next, WIZ_R + r, p.kind === 'bouncer' || p.kind === 'magnetize' ? (p.prev ?? p.owner) : p.owner);
    const pil = firstPillarOnSegment(w, p.pos, next, r);
    // Ilusão: projéteis não a destroem; ao acertá-la, transferem o empurrão e continuam o trajeto
    const fake = p.kind === 'gravity' ? null : decoyOnSegment(w, p, next, WIZ_R + r);
    if (fake && (!found || fake.t <= found.t) && (!pil || fake.t < pil.t)) {
      fake.q.vel = add(fake.q.vel, scale(norm(p.vel), L.knock * p.dmgMult));
    }
    // a Bola de neve atravessa magos (arrastando) e só para em obstáculo ou escudo
    if (p.kind === 'snowball' && found && !shielded(w, found.wz) && (!pil || found.t <= pil.t)) {
      snowRoll(w, p, next);
      found = null;
    }
    if (pil && (!found || pil.t < found.t)) {
      const q = w.pillars[pil.i];
      // Gravidade, Ricochete, Drenar, Magnetizar e Recarga quicam no obstáculo; o Bumerangue quica mais forte e volta ao dono
      if (p.kind === 'gravity' || p.kind === 'bouncer' || p.kind === 'boomerang' || p.kind === 'drain' || p.kind === 'magnetize' || p.kind === 'recharge') {
        bounceOff(p, q.pos, OBSTACLES[q.kind].r, p.kind === 'boomerang' ? BOOMERANG.bounceWall : undefined);
        if (p.kind === 'boomerang') [p.curve, p.back] = [undefined, true];
        if (p.kind === 'magnetize') p.prev = ''; // depois de quicar pode pegar quem lançou (repele)
        // Ricochete: do obstáculo segue para o inimigo mais perto (pedido do Fernando, 18/10)
        if (p.kind === 'bouncer') {
          const nextTo = nearestEnemy(w, p.pos, p.owner);
          if (nextTo) p.vel = scale(norm(sub(nextTo.pos, p.pos)), len(p.vel));
        }
        // o Bumerangue também quebra o baú (pedido do Fernando, 17/10; no original não batia em obstáculo)
        if (p.kind === 'boomerang' && q.kind === 'chest') damagePillar(w, pil.i, spellLevel('boomerang', p.level).dmg * p.dmgMult, p.owner);
        keep.push(p);
        continue;
      }
      if (p.kind === 'link') {
        // Elo no obstáculo: quem lançou é que é puxado até ele
        [p.pillar, p.pos, p.vel] = [pil.i, q.pos, v(0, 0)];
        keep.push(p);
        continue;
      }
      if (p.kind === 'splitter') {
        // splitterprojectile.lua: volta pelo caminho, fora do obstáculo, e solta os filhotes para trás
        p.pos = add(q.pos, scale(norm(sub(p.pos, q.pos)), OBSTACLES[q.kind].r + PROJ_R + BOOMERANG.gap));
        p.vel = scale(p.vel, -1);
        split(w, p);
        keep.push(p);
        continue;
      }
      if (p.kind === 'snowball') {
        damagePillar(w, pil.i, L.dmg * p.dmgMult, p.owner);
        snowBlast(w, p);
        continue;
      }
      if (p.kind === 'swap') swapEnd(w, p);
      else if (L.dmg > 0) damagePillar(w, pil.i, L.dmg * p.dmgMult, p.owner);
      continue;
    }
    if (found) {
      const wz = found.wz;
      if (shielded(w, wz)) {
        // a Troca não faz mal a ninguém: o escudo só a barra, ninguém sai do lugar
        if (p.kind === 'swap') {
          w.events.push({ k: 'reflect', id: wz.id, x: p.pos.x, y: p.pos.y });
          continue;
        }
        // o Bumerangue e o Elo quicam no escudo sem trocar de dono e voltam (shieldmodifier.lua)
        if (p.kind === 'boomerang' || p.kind === 'link') {
          bounceOff(p, wz.pos, Math.max(WIZ_R, wz.shieldR));
          [p.curve, p.back] = [undefined, true];
          if (p.kind === 'link') p.turnAt = w.t;
          w.events.push({ k: 'reflect', id: wz.id, x: p.pos.x, y: p.pos.y });
          keep.push(p);
          continue;
        }
        if (p.kind === 'bouncer') p.prev = wz.id;
        // devolve mirando onde quem atirou está agora (pedido do Fernando, 17/10: deixa o escudo mais forte);
        // se ele já morreu, volta pelo mesmo caminho. O projétil passa a ser de quem refletiu.
        const shooter = byId(w, p.owner);
        const back = shooter ? norm(sub(shooter.pos, p.pos)) : scale(norm(p.vel), -1);
        p.vel = scale(back, len(p.vel));
        p.target = p.kind === 'homing' ? ((shooter && !allies(shooter, wz) ? shooter.id : null) ?? nearestEnemy(w, p.pos, wz.id)?.id ?? null) : null;
        p.owner = wz.id;
        p.until = w.t + (p.kind === 'homing' ? L.duration : L.range / L.speed);
        w.events.push({ k: 'reflect', id: wz.id, x: p.pos.x, y: p.pos.y });
        keep.push(p);
        continue;
      }
      if (p.kind === 'swap') {
        swapPlaces(w, p, wz);
        w.events.push({ k: 'land', id: p.caster, src: 'swap' });
      } else if (p.kind === 'grip') {
        // aliado não fica preso
        if (w.t >= wz.invulnUntil && !allies(anyById(w, p.owner), wz)) {
          w.events.push({ k: 'land', id: p.caster, src: 'grip' });
          wz.gripUntil = w.t + L.duration * wz.debuffMult;
          wz.gripBonus = L.scale;
          wz.target = null;
          wz.casting = null;
          w.events.push({ k: 'grip', id: wz.id, x: wz.pos.x, y: wz.pos.y });
        }
      } else if (p.kind === 'boomerang') {
        // bate, quica a 500 u/s e volta ao dono; pode acertar de novo na volta
        hit(w, wz, p.owner, L.dmg * p.dmgMult, L.knock * p.dmgMult, sub(wz.pos, p.pos), 'boomerang');
        land(w, p, 'boomerang', true);
        bounceOff(p, wz.pos, WIZ_R, BOOMERANG.bounce);
        [p.curve, p.back] = [undefined, true];
        keep.push(p);
      } else if (p.kind === 'bouncer') {
        // bouncerprojectile.lua: dano só em inimigo (e −30% a cada um); segue ao inimigo mais perto, nunca de volta a quem lançou (18/10)
        // com 1 s de vida renovada, até o dano ficar abaixo de 10
        if (wz.id !== p.owner) {
          hit(w, wz, p.owner, L.dmg * p.dmgMult, L.knock * p.dmgMult, p.vel, 'bouncer');
          land(w, p, 'bouncer', true);
          p.dmgMult *= BOUNCER.decay;
        }
        if (L.dmg * p.dmgMult < BOUNCER.minDmg) continue;
        p.prev = wz.id;
        p.pos = add(p.pos, scale(p.vel, dt * found.t));
        const nextTo = nearestEnemy(w, p.pos, wz.id, p.owner);
        if (nextTo) p.vel = scale(norm(sub(nextTo.pos, p.pos)), L.speed);
        p.until = w.t + (L.range / L.speed) * (byId(w, p.caster)?.rangeF ?? 1);
        keep.push(p);
      } else if (p.kind === 'drain') {
        drainHit(w, p, wz, L);
      } else if (p.kind === 'magnetize') {
        // inimigo: atrai os projéteis dos inimigos dele; aliado ou quem lançou (depois de quicar): repele
        const enemy = wz.id !== p.owner && !allies(anyById(w, p.owner), wz);
        wz.magnet = enemy ? 1 : -1;
        wz.magnetUntil = w.t + L.duration * (enemy ? wz.debuffMult : 1);
        if (enemy) land(w, p, 'magnetize');
      } else if (p.kind === 'recharge') {
        // dano + 1 por acerto seguido; acerto sem reflexo soma, o resto zera; a recarga volta para quem a lançou por último
        const dmg = L.dmg + (p.bonus ?? 0);
        hit(w, wz, p.owner, dmg * p.dmgMult, L.knock * (dmg / L.dmg) * p.dmgMult, p.vel, 'recharge');
        const caster = anyById(w, p.caster);
        const enemy = !allies(anyById(w, p.owner), wz);
        if (caster) caster.streak = p.owner === p.caster && enemy ? caster.streak + 1 : 0;
        if (enemy) land(w, p, 'recharge');
        if (enemy) w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'recharge', owner: p.owner, pos: p.pos, vel: v(0, 0), level: p.level, until: w.t + RECHARGE.life, target: p.owner, dmgMult: 1, caster: p.caster, back: true });
      } else if (p.kind === 'link') {
        // preso: fica no mago até soltar (linkHold)
        [p.target, p.pos, p.vel, p.tick] = [wz.id, wz.pos, v(0, 0), w.t + LINK.tick];
        if (!allies(anyById(w, p.owner), wz)) land(w, p, 'link');
        keep.push(p);
      } else if (p.kind === 'splitter') {
        split(w, p); // não causa dano: só estoura em filhotes
        keep.push(p);
      } else {
        const src = spellOf(p.kind);
        hit(w, wz, p.owner, L.dmg * p.dmgMult, L.knock * p.dmgMult, p.vel, src);
        land(w, p, src);
      }
      continue;
    }
    p.pos = next;
    if (p.kind === 'swap' ? w.t + DT < p.until : w.t < p.until) keep.push(p);
    else if (p.kind === 'swap') swapEnd(w, p);
    else if (p.kind === 'snowball') snowBlast(w, p);
    else if (p.kind === 'splitter') {
      split(w, p);
      keep.push(p);
    } else if (p.kind === 'recharge') {
      const caster = anyById(w, p.caster);
      if (caster) caster.streak = 0; // errou: zera os acertos seguidos
    }
  }
  w.projectiles = keep;
}

const ELASTICITY = 0.5;

function separate(w: World) {
  const alive = w.wizards.filter((z) => z.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      if (w.t < a.windUntil || w.t < b.windUntil) continue; // Caminhada no vento atravessa magos
      const d = sub(b.pos, a.pos);
      const l = len(d);
      const overlap = 2 * WIZ_R - l;
      if (overlap <= 0) continue;
      const n = l > 1e-6 ? scale(d, 1 / l) : v(1, 0);
      const push = scale(n, overlap / 2);
      a.pos = sub(a.pos, push);
      b.pos = add(b.pos, push);
      // choque elástico como no original (physics.lua, elasticidade 0,5, massas iguais): o empurrado passa o embalo adiante
      const vn = dot(sub(b.vel, a.vel), n);
      if (vn < 0) {
        const j = (-(1 + ELASTICITY) * vn) / 2;
        a.vel = sub(a.vel, scale(n, j));
        b.vel = add(b.vel, scale(n, j));
      }
    }
  }
}

// volta ao jogo no deathmatch: sorteia um ponto na pedra longe dos inimigos vivos e dos pilares (se nenhum
// sorteio chega a DM_SPAWN_GAP, fica o melhor); vida cheia, parado e invulnerável; magias, itens e recargas ficam
function respawn(w: World, wz: Wizard, rand: () => number) {
  const reach = w.arenaR * SHAPES[w.arena].reach - SPAWN_INSET;
  const gap = (p: Vec) => Math.min(...w.wizards.filter((z) => z.alive).map((z) => dist(z.pos, p)), ...w.pillars.filter((q) => q.alive).map((q) => dist(q.pos, p)));
  // sem sorteio bom (fora da pedra), volta onde nasceu
  let best = SHAPES[w.arena].spawn(w.wizards.indexOf(wz), w.wizards.length, w.arenaR);
  let bestGap = -1;
  for (let i = 0; i < 30 && bestGap < DM_SPAWN_GAP; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * reach;
    const p = v(Math.cos(a) * r, Math.sin(a) * r);
    if (!inArena(w, p, 1.5)) continue; // no círculo nunca acontece (o sorteio já fica a SPAWN_INSET da borda)
    const g = gap(p);
    if (g > bestGap) [best, bestGap] = [p, g];
  }
  Object.assign(wz, {
    alive: true, pos: best, vel: v(0, 0), target: null, casting: null, hp: wz.hpMax, dmgTaken: 0, lastHitBy: null,
    shieldUntil: 0, pactUntil: 0, dashUntil: 0, thrustUntil: 0, invulnUntil: w.t + INVULN_TIME,
    slowUntil: 0, hasteUntil: 0, snow: null, magnetUntil: 0, alterUntil: 0, windUntil: 0, veilUntil: 0, shockUntil: 0, aegis: wz.items.aegis > 0,
    rune: null, runeUntil: 0,
  });
}

// ponto sorteado na pedra longe dos obstáculos e dos magos (baú e runa); null se 20 sorteios não acharem
// (a margem da borda nunca recusa no círculo: lá o sorteio já fica a 40% do raio da borda)
function freeSpot(w: World, rand: () => number, spread: number): Vec | null {
  for (let i = 0; i < 20; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * w.arenaR * spread * SHAPES[w.arena].reach;
    const p = v(Math.cos(a) * r, Math.sin(a) * r);
    if (inArena(w, p, Math.min(1, w.arenaR * 0.2)) && w.pillars.every((q) => !q.alive || dist(q.pos, p) > 1.2) && w.wizards.every((z) => !z.alive || dist(z.pos, p) > 1)) return p;
  }
  return null;
}

// runa: aparece (uma por vez), some se a lava engolir e dá o efeito a quem encostar primeiro
function stepRunes(w: World, rand: () => number) {
  const kept = w.runes.filter((r) => inArena(w, r.pos));
  if (kept.length < w.runes.length) w.runeAt = w.t + RUNE.every;
  w.runes = kept;
  if (!w.runes.length && w.t >= w.runeAt) {
    const at = freeSpot(w, rand, RUNE.spread);
    if (at) {
      const kind = RUNE_KINDS[Math.floor(rand() * RUNE_KINDS.length)];
      w.runes.push({ pos: at, kind });
      w.events.push({ k: 'rune', kind, x: at.x, y: at.y });
    } else w.runeAt = w.t + 1;
  }
  for (const r of w.runes) {
    const z = w.wizards.find((q) => q.alive && dist(q.pos, r.pos) <= RUNE.reach);
    if (!z) continue;
    w.runes = w.runes.filter((q) => q !== r);
    w.runeAt = w.t + RUNE.every;
    w.events.push({ k: 'runeTake', id: z.id, kind: r.kind });
    Object.assign(z, { rune: r.kind, runeUntil: w.t + RUNE.secs });
  }
}

// volta parado para dentro da pedra, na mesma direção (Égide; na sandbox, quem tem vida infinita e cai na lava)
function toStone(w: World, wz: Wizard) {
  const from = wz.pos;
  Object.assign(wz, { pos: safeInside(w, wz.pos, w.arenaR * (1 - AEGIS.back)), vel: v(0, 0), target: null, dashUntil: 0, thrustUntil: 0 });
  w.events.push({ k: 'teleport', id: wz.id, from, to: wz.pos });
}

export function stepWorld(w: World, cmds: Cmd[], rand: () => number = Math.random) {
  w.events = [];
  w.lavaCredit = {};
  for (const c of cmds) {
    const wz = byId(w, c.id);
    if (!wz) continue;
    if (c.kind === 'move') {
      if (wz.casting) wz.casting.then = c.to;
      else wz.target = c.to;
    } else if (c.kind === 'stop') {
      if (wz.casting) wz.casting.then = null;
      else wz.target = null;
    } else if (c.kind === 'item') beginCast(w, wz, { item: c.item }, c.at);
    else beginCast(w, wz, { spell: c.spell }, c.at);
  }
  for (const wz of w.wizards) {
    if (!wz.alive && w.dm && w.t >= wz.respawnAt) respawn(w, wz, rand);
    if (!wz.alive) continue;
    if (wz.casting && w.t >= wz.casting.fireAt) {
      const c = wz.casting;
      wz.casting = null;
      fire(w, wz, c, c.at);
      if (c.then !== undefined) wz.target = c.then;
    }
    // preso: velocidade zero e o destino de andar some; a Investida soma velocidade
    const rooted = w.t < wz.gripUntil;
    // chão do choque: lento no arcano, queima no fogo (como a lava, mas fraco)
    wz.zone = 0;
    for (const z of w.zones) if (dist(z.pos, wz.pos) < z.r + WIZ_R * 0.5) wz.zone |= z.kind === 'slow' ? 1 : z.kind === 'burn' ? 2 : 0;
    if (wz.zone & 2 && w.t >= wz.invulnUntil) {
      wz.hp -= ZONES.burn.dps * DT;
      wz.calmSince = w.t;
    }
    // Bola de neve: o efeito de 0,5 s acaba e o dano marcado sai, sem empurrão (snowballmodifier.lua)
    if (wz.snow && w.t >= wz.snow.until) {
      const s = wz.snow;
      wz.snow = null;
      hit(w, wz, s.by, s.dmg, 0, v(0, 0), 'snowball');
    }
    const extra = (w.t < wz.rushUntil ? wz.rushBonus : 0) + (w.t < wz.hasteUntil ? wz.haste : 0) + (w.t < wz.windUntil ? WINDWALK.speed : 0) + bootsBonus(w, wz) - (w.t < wz.slowUntil ? wz.slow : 0);
    const haste = wz.rune === 'haste' && w.t < wz.runeUntil ? 1 + RUNE.haste : 1;
    // runa da Recarga: as recargas correm 1/(1 − 30%) vezes mais rápido enquanto dura
    if (wz.rune === 'recharge' && w.t < wz.runeUntil) {
      const extraT = DT * (1 / (1 - RUNE.cdr) - 1);
      for (const s of SPELL_IDS) if (wz.cd[s] > w.t) wz.cd[s] -= extraT;
      for (const i of ACTIVE_ITEMS) if (wz.itemCd[i] > w.t) wz.itemCd[i] -= extraT;
    }
    wz.speed = rooted ? 0 : Math.max(0.2, (wz.baseSpeed + extra) * (wz.zone & 1 ? ZONES.slow.mult : 1) * (inWarp(w, wz) ? WARPZONE.wizMult : 1) * haste);
    if (rooted) wz.target = null;
  }

  // morte súbita: rodada longa passa a encolher mais rápido (o próximo encolhimento vem em no máximo 5 s)
  if (!w.dm && w.rules.sudden && !w.sudden && w.t >= SUDDEN.at) {
    w.sudden = true;
    w.shrinkAt = Math.min(w.shrinkAt, w.t + SUDDEN.every);
    w.events.push({ k: 'sudden' });
  }
  // passou de SUDDEN.collapse: o tamanho mínimo deixa de valer e a arena some aos poucos (vale mesmo com a morte súbita desligada)
  const collapsing = w.t >= SUDDEN.collapse;
  const minR = collapsing && !w.dm ? 0 : ARENA_MIN; // a sandbox encolhe até o mínimo, sem sumir
  if (!w.dm && collapsing && w.shrinkAt > w.t + SUDDEN.every) w.shrinkAt = w.t + SUDDEN.every;
  if ((!w.dm || w.shrink) && w.t >= w.shrinkAt && w.arenaR > minR) {
    w.arenaR = Math.max(minR, w.arenaR - ARENA_STEP);
    // as ilhas chegam junto com a borda e levam quem está em cima
    for (const i of w.isles) {
      const to = isleSpot(w, i.a, i.d);
      for (const z of w.wizards) if (z.alive && dist(z.pos, i.pos) < i.r) z.pos = add(z.pos, sub(to, i.pos));
      i.pos = to;
    }
    w.shrinkAt += w.sudden || collapsing ? SUDDEN.every : SHRINK_EVERY;
    w.events.push({ k: 'shrink', r: w.arenaR });
  }

  w.zones = w.zones.filter((z) => z.until > w.t);
  stepIsles(w);
  // baú: aparece num ponto sorteado longe dos obstáculos; as magias quebram e ele vira um monte de ouro
  const chestsUp = w.pillars.filter((q) => q.kind === 'chest' && q.alive).length;
  if (w.rules.chests && chestsUp < CHEST.maxUp && w.chestsLeft > 0 && w.t >= w.chestAt) {
    const at = freeSpot(w, rand, CHEST.spread);
    if (at) {
      w.pillars.push({ pos: at, hp: OBSTACLES.chest.hp, alive: true, kind: 'chest' });
      w.events.push({ k: 'chest', x: at.x, y: at.y });
      w.chestAt = w.t + CHEST.every;
      w.chestsLeft--;
    } else w.chestAt = w.t + 1;
  }
  // monte de ouro: cada mago em cima enche a própria barra e ganha 1 a cada 2 s; quem sai perde o progresso
  for (const z of w.wizards) {
    const loot = z.alive ? w.loots.find((l) => l.left > 0 && dist(z.pos, l.pos) <= CHEST.reach) : undefined;
    if (!loot) {
      z.lootProg = 0;
      continue;
    }
    z.lootProg += DT;
    if (z.lootProg >= CHEST.goldEvery) {
      z.lootProg = 0;
      loot.left--;
      w.events.push({ k: 'loot', id: z.id, x: loot.pos.x, y: loot.pos.y });
    }
  }
  w.loots = w.loots.filter((l) => l.left > 0 && w.t < l.until);
  if (w.rules.runes) stepRunes(w, rand);
  for (const wz of w.wizards) {
    if (!wz.alive) continue;
    if (w.t < wz.dashUntil) {
      wz.pos = add(wz.pos, scale(wz.dashVel, DT)); // avançando: não anda, mas o empurrão ainda soma
      // quem o avanço encostar leva dano e é empurrado na direção do avanço (uma vez por avanço)
      for (const o of w.wizards) {
        if (!o.alive || o === wz || wz.dashHit.includes(o.id) || dist(o.pos, wz.pos) > 2 * WIZ_R + 0.1) continue;
        wz.dashHit.push(o.id);
        hit(w, o, wz.id, RUSH.dashDmg, RUSH.dashDmg * KB_PER_DMG, wz.dashVel, 'rush');
        w.events.push({ k: 'land', id: wz.id, src: 'rush' });
      }
    }
    stepThrust(w, wz);
    if (w.t < wz.windUntil) windTouch(w, wz);
    // redemoinho do choque de pulso: puxa devagar para o centro
    for (const z of w.zones) {
      const d = sub(z.pos, wz.pos);
      if (z.kind === 'pull' && len(d) < z.r + WIZ_R && len(d) > 0.15) wz.pos = add(wz.pos, scale(norm(d), ZONES.pull.speed * DT));
    }
    moveWizard(wz, DT);
  }
  separate(w);
  blockPillars(w);
  stepProjectiles(w);
  clashProjectiles(w);

  for (const wz of w.wizards) {
    if (!wz.alive) continue;
    // sandbox: vida infinita não morre e, na lava, volta para a pedra
    if (wz.god) {
      if (inLava(w, wz.pos)) toStone(w, wz);
      wz.hp = wz.hpMax;
      continue;
    }
    if (inLava(w, wz.pos)) {
      if (w.t < wz.invulnUntil) continue;
      const dmg = LAVA_DPS * DT * (1 - wz.lavaCut), burn = Math.min(Math.max(0, wz.hp), dmg);
      wz.hp -= dmg;
      wz.calmSince = w.t;
      // metade da vida que a lava tira conta como dano de quem acertou por último (mesma janela do abate); a partida soma no placar
      if (wz.lastHitBy && wz.lastHitBy !== wz.id && w.t - wz.lastHitAt <= CREDIT_WINDOW) {
        const c = (w.lavaCredit[wz.lastHitBy] ??= {});
        c[wz.id] = (c[wz.id] ?? 0) + burn / 2;
      }
      wz.dmgTaken += LAVA_DPS * DT * LAVA_KB_FACTOR; // as Botas de lava poupam a vida, não o empurrão acumulado (ciclo 2)
      // Égide: com pouca vida na lava, volta parado para dentro da pedra na mesma direção (uma vez)
      if (wz.aegis && wz.hp > 0 && wz.hp <= AEGIS.hp) {
        wz.aegis = false;
        toStone(w, wz);
        w.events.push({ k: 'aegis', id: wz.id });
      }
    } else wz.hp = Math.min(wz.hpMax, wz.hp + wz.regen * DT);
    if (wz.hp > 0) continue;
    wz.hp = 0;
    wz.alive = false;
    wz.target = null;
    wz.respawnAt = w.t + DM_RESPAWN;
    const credited = wz.lastHitBy !== null && w.t - wz.lastHitAt <= CREDIT_WINDOW;
    const by = credited ? wz.lastHitBy : null;
    w.events.push({ k: 'death', id: wz.id, by, src: credited ? wz.lastHitSrc : 'lava' });
  }
  w.t += DT;
}
