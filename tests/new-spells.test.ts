import { describe, expect, it } from 'vitest';
import { DT, HP_MAX, OBSTACLES, WIZ_R, WIZ_SPEED } from '../src/shared/constants.ts';
import { botBuy, botCmds, botWatch, type BotPlan } from '../src/shared/bots.ts';
import { addPlayer, buy, newMatch, resume, startMatch, undoBuy } from '../src/shared/match.ts';
import { parseClientMessage } from '../src/shared/protocol.ts';
import { decodeSnap, encodeSnap } from '../src/shared/snapshot.ts';
import { PROJ_KINDS, newWorld, stepWorld, type Cmd, type SimEvent, type World } from '../src/shared/sim.ts';
import { MAX_SPELLS, RUSH, SPELLS, SPELL_IDS, WARPZONE, noSpells, spellLevel, type SpellId } from '../src/shared/spells.ts';
import { dist, len, v } from '../src/shared/vec.ts';
import { run, world as spotsWorld } from './helpers.ts';

// mundo sem invulnerabilidade inicial; todos os magos com as magias dadas no nível 1
const world = (spots: [number, number][], spells: SpellId[]) => spotsWorld(spots, { ...noSpells(), ...Object.fromEntries(spells.map((s) => [s, 1])) });

const cast = (id: string, spell: SpellId, x: number, y: number): Cmd => ({ id, kind: 'cast', spell, at: v(x, y) });

describe('Troca', () => {
  it('swaps places with the wizard it hits', () => {
    const w = world([[0, 0], [3, 0]], ['swap']);
    run(w, 0.5, [cast('p0', 'swap', 3, 0)]);
    expect(w.wizards[0].pos.x).toBeCloseTo(3, 1);
    expect(w.wizards[1].pos.x).toBeCloseTo(0, 1);
    expect(w.projectiles).toHaveLength(0);
  });

  it('flies past the click point and swaps with whoever is beyond it', () => {
    const w = world([[0, 0], [4.5, 0]], ['swap']);
    run(w, 0.6, [cast('p0', 'swap', 2, 0)]);
    expect(w.wizards[0].pos.x).toBeCloseTo(4.5, 1);
    expect(w.wizards[1].pos.x).toBeCloseTo(0, 1);
  });

  it('with no hit the caster ends where the projectile stopped, up to max range', () => {
    const w = world([[0, 0], [0, -8]], ['swap']);
    run(w, 0.6, [cast('p0', 'swap', 3, 0)]);
    expect(w.wizards[0].pos.x).toBeCloseTo(1.5, 3); // errou: vai até a metade do caminho até a mira
    w.wizards[0].cd.swap = 0;
    w.wizards[0].pos = v(0, 0);
    run(w, 1, [cast('p0', 'swap', 50, 0)]);
    expect(dist(w.wizards[0].pos, v(0, 0))).toBeCloseTo(SPELLS.swap.levels[0].range / 2, 3);
  });
});

describe('escudo contra as magias novas', () => {
  it('blocks Troca: nobody moves and the projectile is gone', () => {
    const w = world([[0, 0], [3, 0]], ['swap']);
    w.wizards[1].shieldUntil = 99;
    run(w, 0.5, [cast('p0', 'swap', 3, 0)]);
    expect(w.wizards[0].pos).toEqual(v(0, 0));
    expect(w.wizards[1].pos.x).toBeCloseTo(3, 5);
    expect(w.projectiles).toHaveLength(0);
  });

  it('reflects Rajada back at the caster without crediting a hit', () => {
    const w = world([[0, 0], [4, 0]], ['cluster']);
    w.wizards[1].shieldUntil = 99;
    let landed = false;
    stepWorld(w, [cast('p0', 'cluster', 4, 0)]);
    for (let i = 0; i < 60; i++) {
      stepWorld(w, []);
      landed ||= w.events.some((e) => e.k === 'land');
    }
    expect(w.projectiles.some((p) => p.kind === 'cluster' && p.owner === 'p1')).toBe(true);
    expect(w.wizards[1].hp).toBe(HP_MAX);
    expect(landed).toBe(false);
  });
});

describe('Agarrar', () => {
  it('stops the target from walking while it lasts, then releases', () => {
    const w = world([[0, 0], [4, 0]], ['grip']);
    run(w, 1.2, [cast('p0', 'grip', 4, 0)]);
    const L = spellLevel('grip', 1);
    expect(w.wizards[1].gripUntil).toBeGreaterThan(w.t);
    const before = w.wizards[1].pos;
    run(w, 2, [{ id: 'p1', kind: 'move', to: v(4, 6) }]);
    expect(w.wizards[1].pos).toEqual(before);
    run(w, L.duration, []);
    run(w, 1, [{ id: 'p1', kind: 'move', to: v(4, 6) }]);
    expect(w.wizards[1].pos.y).toBeGreaterThan(0.5);
  });

  it('the first damaging hit frees the gripped target and knocks it further (by grip level); cancels the target cast', () => {
    const a = world([[0, 0], [4, 0]], ['fireball']);
    const g = world([[0, 0], [4, 0]], ['fireball']);
    Object.assign(g.wizards[1], { gripUntil: 99, gripBonus: 0.3 });
    for (const x of [a, g]) x.wizards[1].invulnUntil = 0; // sem os 2 s de invulnerável do começo
    run(a, 1, [cast('p0', 'fireball', 4, 0)]);
    run(g, 1, [cast('p0', 'fireball', 4, 0)]);
    expect(len(a.wizards[1].vel)).toBeGreaterThan(1);
    expect(len(g.wizards[1].vel)).toBeCloseTo(len(a.wizards[1].vel) * 1.3, 3);
    expect(g.wizards[1].gripUntil).toBe(0); // solto: o próximo golpe empurra normal
    // nível 7: +90%
    const h = world([[0, 0], [4, 0]], ['grip']);
    h.wizards[0].spells.grip = 7;
    h.wizards[1].invulnUntil = 0;
    run(h, 1, [cast('p0', 'grip', 4, 0)]);
    expect(h.wizards[1].gripUntil).toBeGreaterThan(h.t);
    expect(h.wizards[1].gripBonus).toBe(0.9);
    const c = world([[0, 0], [4, 0]], ['grip', 'meteor']);
    stepWorld(c, [cast('p1', 'meteor', 0, 0)]);
    expect(c.wizards[1].casting).not.toBeNull();
    run(c, 0.4, [cast('p0', 'grip', 4, 0)]);
    expect(c.wizards[1].casting).toBeNull();
  });
});

describe('Meteoro', () => {
  it('lands only after the delay and hurts only inside the radius', () => {
    const L = spellLevel('meteor', 1);
    const w = world([[0, 0], [4, 0], [4, L.radius + WIZ_R + 1]], ['meteor']);
    run(w, 0.5, [cast('p0', 'meteor', 4, 0)]);
    expect(w.projectiles.map((p) => p.kind)).toEqual(['meteor']);
    expect(w.wizards[1].hp).toBe(HP_MAX);
    run(w, 1, []);
    expect(w.projectiles).toHaveLength(0);
    expect(w.wizards[1].hp).toBeCloseTo(HP_MAX - L.dmg, -1); // no centro: dano máximo
    expect(w.wizards[2].hp).toBe(HP_MAX); // fora do raio
    expect(w.wizards[0].hp).toBe(HP_MAX); // quem lança não leva
    expect(len(w.wizards[1].vel)).toBeGreaterThan(0);
  });

  it('deals less at the edge', () => {
    const L = spellLevel('meteor', 1);
    const w = world([[0, 0], [4 + L.radius * 0.9, 0]], ['meteor']);
    run(w, 1.7, [cast('p0', 'meteor', 4, 0)]);
    const lost = HP_MAX - w.wizards[1].hp;
    expect(lost).toBeGreaterThan(L.dmgMin - 2);
    expect(lost).toBeLessThan(L.dmg * 0.7); // borda 60 desde 17/10 (era 40)
  });
});

describe('Investida', () => {
  it('raises walking speed and turns hits into extra speed', () => {
    const w = world([[0, 0], [4, 0]], ['rush', 'fireball']);
    // avança para (4, 3), de lado, para a bola de fogo ir até lá
    run(w, 0.3, [cast('p1', 'rush', 4, 9)]);
    const z = w.wizards[1];
    expect(z.speed).toBeCloseTo(WIZ_SPEED + RUSH.bonus, 5);
    const fb = spellLevel('fireball', 1);
    run(w, 1.2, [cast('p0', 'fireball', z.pos.x, z.pos.y)]);
    expect(z.speed).toBeGreaterThan(WIZ_SPEED + RUSH.bonus);
    expect(HP_MAX - z.hp).toBeCloseTo(fb.dmg - Math.min(spellLevel('rush', 1).absorb, fb.dmg * RUSH.share), -1); // absorveu até metade do golpe
  });

  it('the dash damages whoever it touches, once', () => {
    const w = world([[0, 0], [0, -1.5]], ['rush']);
    run(w, 0.5, [cast('p0', 'rush', 0, -10)]);
    expect(w.wizards[1].hp).toBeCloseTo(HP_MAX - RUSH.dashDmg, -1);
  });

  it('scourge can start during the dash', () => {
    const w = world([[0, 0], [0, -4]], ['rush']);
    w.wizards[0].items.scourge = 1;
    stepWorld(w, [{ id: 'p0', kind: 'cast', spell: 'rush', at: v(0, -10) }]);
    stepWorld(w, [{ id: 'p0', kind: 'item', item: 'scourge', at: v(0, -10) }]);
    expect(w.wizards[0].casting?.item).toBe('scourge');
    run(w, 0.8);
    expect(w.wizards[1].hp).toBeLessThan(HP_MAX);
  });

  it('dashes 3 m toward the cursor', () => {
    const w = world([[0, 0], [9, 9]], ['rush']);
    run(w, 0.5, [cast('p0', 'rush', 0, -10)]);
    expect(w.wizards[0].pos.x).toBeCloseTo(0, 1);
    expect(w.wizards[0].pos.y).toBeCloseTo(-RUSH.dash, 1);
  });

  it('ends after its duration', () => {
    const w = world([[0, 0], [4, 0]], ['rush']);
    run(w, 0.1, [cast('p0', 'rush', 0, 0)]);
    run(w, spellLevel('rush', 1).duration + 0.5);
    expect(w.wizards[0].speed).toBeCloseTo(WIZ_SPEED, 5);
  });
});

describe('Rajada', () => {
  it('spawns 4 projectiles in a fan and each can land', () => {
    const w = world([[0, 0], [3, 0]], ['cluster']);
    run(w, 0.15, [cast('p0', 'cluster', 3, 0)]);
    expect(w.projectiles.filter((p) => p.kind === 'cluster')).toHaveLength(4);
    const dirs = new Set(w.projectiles.map((p) => Math.round(Math.atan2(p.vel.y, p.vel.x) * 100)));
    expect(dirs.size).toBe(4);
    run(w, 1);
    expect(w.wizards[1].hp).toBeLessThan(HP_MAX);
    expect(w.wizards[1].hp).toBeGreaterThan(HP_MAX - 4 * spellLevel('cluster', 1).dmg - 10);
  });

  it('passes through enemy fireballs instead of clashing', () => {
    const w = world([[0, 0], [8, 0]], ['cluster', 'fireball']);
    let clashed = false;
    stepWorld(w, [cast('p0', 'cluster', 8, 0), cast('p1', 'fireball', 0, 0)]);
    for (let i = 0; i < 60; i++) {
      stepWorld(w, []);
      clashed ||= w.events.some((e) => e.k === 'clash');
    }
    expect(clashed).toBe(false);
  });
});

describe('snapshot e telemetria', () => {
  it('encodes new statuses and projectile kinds', () => {
    const w = world([[0, 0], [4, 0]], ['rush', 'grip', 'meteor']);
    w.wizards[0].gripUntil = 9;
    run(w, 0.1, [cast('p0', 'rush', 0, 0), cast('p1', 'meteor', 5, 0)]);
    run(w, 0.2);
    const snap = decodeSnap(encodeSnap(w, 'p0', 0, []), ['p0', 'p1']);
    expect(snap.wizards[0].status & 128).toBe(128);
    expect(snap.wizards[0].status & 256).toBe(256);
    expect(snap.projectiles[0].kind).toBe('meteor');
    expect(snap.projectiles[0].vel.x).toBeCloseTo(spellLevel('meteor', 1).radius, 1);
    expect(snap.projectiles[0].vel.y).toBeGreaterThan(0);
  });

  it('emits fire, hit and land events for meteor and cluster', () => {
    const seen = new Set<string>();
    for (const spell of ['cluster', 'meteor'] as const) {
      const w = world([[0, 0], [3, 0]], [spell]);
      stepWorld(w, [cast('p0', spell, 3, 0)]);
      for (let i = 0; i < 120; i++) {
        stepWorld(w, []);
        for (const e of w.events) {
          if (e.k === 'fire' || e.k === 'land') seen.add(`${e.k}:${e.src}`);
          else if (e.k === 'hit' && e.by === 'p0') seen.add(`hit:${e.src}`);
        }
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(['fire:cluster', 'land:cluster', 'hit:cluster', 'fire:meteor', 'land:meteor', 'hit:meteor']));
  });
});

describe('limite de 6 magias', () => {
  const shop = () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    addPlayer(m, 'b', 'Bia');
    startMatch(m, 0, 0);
    m.players[0].gold = 500;
    return m;
  };

  it('refuses a 7th different spell; undo frees the slot; upgrades keep working', () => {
    const m = shop();
    const five: SpellId[] = ['lightning', 'homing', 'shield', 'teleport', 'swap'];
    for (const s of five) expect(buy(m, 'a', s)).toBe(true);
    expect(MAX_SPELLS).toBe(6);
    const gold = m.players[0].gold;
    expect(buy(m, 'a', 'grip')).toBe(false);
    expect(m.players[0].gold).toBe(gold);
    expect(m.players[0].spells.grip).toBe(0);
    expect(buy(m, 'a', 'lightning')).toBe(true); // nível 2 da mesma
    expect(undoBuy(m, 'a', 'spell:swap')).toBe(true);
    expect(buy(m, 'a', 'grip')).toBe(true);
  });

  it('bots stop buying new spells at the limit but still upgrade', () => {
    const spells = { ...noSpells(), lightning: 1, homing: 1, meteor: 1, cluster: 1, shield: 1 };
    const pick = botBuy({ gold: 99, spells });
    expect(pick?.kind).toBe('spell');
    expect(pick && pick.kind === 'spell' && spells[pick.id] > 0).toBe(true);
  });
});

describe('bots com as magias novas', () => {
  const duel = (own: Partial<Record<SpellId, number>>) => {
    const w = newWorld(['bot', 'x'], { bot: { ...noSpells(), ...own }, x: noSpells() });
    w.wizards[0].pos = v(0, 0);
    w.wizards[1].pos = v(4, 0);
    w.wizards[0].cd.fireball = 99;
    return w;
  };

  it('cast meteor and cluster at the nearest enemy', () => {
    expect(botCmds(duel({ meteor: 1 }), 'bot', () => 0.3).some((c) => c.kind === 'cast' && c.spell === 'meteor')).toBe(true);
    expect(botCmds(duel({ cluster: 1 }), 'bot', () => 0.3).some((c) => c.kind === 'cast' && c.spell === 'cluster')).toBe(true);
  });
});

// as cinco do Warlock Brawl (17/10): Bumerangue, Estocada, Gravidade, Pilar de pedra e Ricochete
function runEvents(w: World, seconds: number, cmds: Cmd[] = [], each?: () => void) {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(w, i === 0 ? cmds : []);
    out.push(...w.events);
    each?.();
  }
  return out;
}
const hitsOf = (ev: SimEvent[], src: string) => ev.filter((e): e is Extract<SimEvent, { k: 'hit' }> => e.k === 'hit' && e.src === src);

describe('Bumerangue', () => {
  // voo livre até (4, 0): guarda a trajetória e se o bumerangue já estava voltando
  function freeFlight() {
    const w = world([[0, 0], [0, -8]], ['boomerang']);
    const path: { x: number; y: number; back: boolean }[] = [];
    runEvents(w, 4, [cast('p0', 'boomerang', 4, 0)], () => {
      const p = w.projectiles.find((q) => q.kind === 'boomerang');
      if (p) path.push({ ...p.pos, back: !!p.back });
    });
    return { w, path };
  }

  it('curves out to the click point and comes back to the caster, where it disappears', () => {
    const { w, path } = freeFlight();
    const far = Math.max(...path.map((q) => q.x));
    expect(far).toBeGreaterThan(3.5);
    expect(far).toBeLessThan(4.7); // o passo de 1/60 s passa um pouco do ponto
    expect(path.some((q) => q.y > 0.2)).toBe(true); // ida curva para um lado
    expect(path.some((q) => q.y < -0.2)).toBe(true); // volta pelo outro
    expect(w.projectiles).toHaveLength(0);
    expect(dist(path[path.length - 1], w.wizards[0].pos)).toBeLessThan(1);
  });

  it('hits on the way out, bounces and still returns to the caster', () => {
    const out = freeFlight().path.find((q) => !q.back && q.x > 2)!;
    const w = world([[0, 0], [out.x, out.y]], ['boomerang']);
    const ev = runEvents(w, 4, [cast('p0', 'boomerang', 4, 0)]);
    const hits = hitsOf(ev, 'boomerang');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].id).toBe('p1');
    expect(hits[0].dmg).toBeCloseTo(SPELLS.boomerang.levels[0].dmg, 5);
    expect(w.projectiles).toHaveLength(0); // voltou e sumiu no dono
    expect(ev.filter((e) => e.k === 'land')).toHaveLength(1);
  });

  it('hits someone standing on the way back', () => {
    const back = freeFlight().path.find((q) => q.back && q.x < 2.5)!;
    const w = world([[0, 0], [back.x, back.y]], ['boomerang']);
    let backAtHit: boolean | null = null;
    runEvents(w, 4, [cast('p0', 'boomerang', 4, 0)], () => {
      const p = w.projectiles.find((q) => q.kind === 'boomerang');
      if (backAtHit === null && w.events.some((e) => e.k === 'hit' && e.src === 'boomerang')) backAtHit = !!p?.back;
    });
    expect(backAtHit).toBe(true);
  });
});

describe('Estocada', () => {
  const thrustHit = (gap: number) => {
    const w = world([[0, 0], [gap, 0]], ['thrust']);
    const ev = runEvents(w, 1, [cast('p0', 'thrust', gap, 0)]);
    return { w, hit: hitsOf(ev, 'thrust')[0] };
  };

  it('moves the caster and deals more damage the faster it is going', () => {
    const near = thrustHit(2);
    const far = thrustHit(5.5);
    expect(near.hit.id).toBe('p1');
    expect(near.w.wizards[0].pos.x).toBeGreaterThan(1);
    expect(far.w.wizards[0].pos.x).toBeGreaterThan(4);
    expect(near.hit.dmg).toBeLessThan(far.hit.dmg);
    expect(far.hit.dmg).toBeLessThanOrEqual(SPELLS.thrust.levels[0].dmg);
    expect(far.w.wizards[1].vel.x).toBeGreaterThan(0); // empurrou o alvo
    expect(len(far.w.wizards[0].vel)).toBe(0); // quem estocou para no golpe
  });

  it('without a hit it stops near the click point and slows down', () => {
    const w = world([[0, 0], [0, -8]], ['thrust']);
    run(w, 0.5, [cast('p0', 'thrust', 3, 0)]);
    expect(w.wizards[0].pos.x).toBeGreaterThan(2.3);
    expect(w.wizards[0].pos.x).toBeLessThan(3.7);
    expect(len(w.wizards[0].vel)).toBeLessThan(2);
  });
});

describe('Gravidade', () => {
  it('pulls a nearby enemy and burns it', () => {
    const w = world([[0, 0], [2, 1.5]], ['gravity']);
    run(w, 1, [cast('p0', 'gravity', 5, 0)]);
    expect(w.wizards[1].pos.y).toBeLessThan(1.4);
    expect(w.wizards[1].hp).toBeLessThan(w.wizards[1].hpMax);
    expect(w.wizards[0].pos).toEqual(v(0, 0)); // quem lançou não é puxado
  });

  it('bends a passing projectile', () => {
    const fireballY = (gravity: boolean) => {
      const w = world([[0, -1], [-1, 2]], ['gravity']);
      run(w, 0.6, [cast('p1', 'fireball', 9, 2), ...(gravity ? [cast('p0', 'gravity', 5, -1)] : [])]);
      return w.projectiles.find((p) => p.kind === 'fireball')!.pos.y;
    };
    expect(fireballY(false)).toBeCloseTo(2, 5);
    expect(fireballY(true)).toBeLessThan(1.8);
  });
});

describe('Pilar de pedra', () => {
  it('raises an obstacle at the click point (up to its range) that vanishes after 5 s', () => {
    const w = world([[0, 0], [0, -8]], ['rockpillar']);
    run(w, 0.1, [cast('p0', 'rockpillar', 3, 0)]);
    const p = w.pillars.find((q) => q.kind === 'rockpillar')!;
    expect(p.alive).toBe(true);
    expect(dist(p.pos, v(3, 0))).toBeLessThan(1e-9);
    const view = decodeSnap(encodeSnap(w, 'p0', 0, []), ['p0', 'p1']);
    expect(view.pillars.some((q) => q.kind === 'rockpillar' && q.hp > 0)).toBe(true);
    run(w, 5); // 4 → 5 s no ciclo 1 de balanceamento
    expect(p.alive).toBe(false);
    w.wizards[0].cd.rockpillar = 0;
    run(w, 0.1, [cast('p0', 'rockpillar', 50, 0)]);
    expect(len(w.pillars[w.pillars.length - 3].pos)).toBeCloseTo(SPELLS.rockpillar.levels[0].range, 5);
  });

  it('is a 2 m low wall across the cast line (3 pieces in a row), sharing one 200 hp and exploding once', () => {
    const w = world([[0, 0], [6, 0.3]], ['rockpillar']);
    run(w, 0.1, [cast('p0', 'rockpillar', 3, 0)]);
    const parts = w.pillars.filter((q) => q.kind === 'rockpillar');
    expect(parts).toHaveLength(3);
    // atravessada: os pedaços em x = 3, espalhados no eixo y (perpendicular ao caminho mago → ponto)
    for (const q of parts) expect(q.pos.x).toBeCloseTo(3, 9);
    const ys = parts.map((q) => q.pos.y).sort((a, b) => a - b);
    expect(ys[2] - ys[0] + 2 * OBSTACLES.rockpillar.r).toBeCloseTo(2, 5);
    // a Bola de fogo pega um pedaço só: a vida cai nos 3
    const ev = runEvents(w, 1, [cast('p1', 'fireball', 3, 0.3)]);
    expect(ev.some((e) => e.k === 'pillar')).toBe(true);
    expect(new Set(parts.map((q) => q.hp)).size).toBe(1);
    expect(parts[0].hp).toBeLessThan(OBSTACLES.rockpillar.hp);
    // quebra junto e explode uma vez
    w.wizards[1].cd.fireball = 0;
    const blasts: SimEvent[] = [];
    for (let k = 0; k < 6 && parts[0].alive; k++) {
      w.wizards[1].cd.fireball = 0;
      blasts.push(...runEvents(w, 0.6, [cast('p1', 'fireball', 3, 0.3)]).filter((e) => e.k === 'clash' && e.combo === 'pillar'));
    }
    expect(parts.every((q) => !q.alive)).toBe(true);
    expect(blasts).toHaveLength(1);
  });

  it('a wizard walking into the wall stops at it (no gap between the pieces)', () => {
    const w = world([[0, 0], [0, -8]], ['rockpillar']);
    run(w, 0.1, [cast('p0', 'rockpillar', 2, 0)]);
    // 4 tentativas de 1,1 s cabem nos 5 s da parede
    for (const y of [0, 0.33, -0.33, 0.66]) {
      w.wizards[0].pos = v(0.5, y);
      run(w, 1.1, [{ id: 'p0', kind: 'move', to: v(4, y) }]);
      expect(w.wizards[0].pos.x).toBeLessThan(1.45); // entre dois pedaços a face da parede fica 6 cm mais funda; ninguém passa
    }
  });
});

describe('Ricochete', () => {
  it('after a hit it goes to the nearest enemy, never back to the caster; from an obstacle too', () => {
    // p0 lança em p1; o próximo mais perto de p1 é o próprio p0 (2 m), mas tem de ir para p2 (3 m)
    const w = world([[0, 0], [2, 0], [2, 3]], ['bouncer']);
    const ev = runEvents(w, 2, [cast('p0', 'bouncer', 2, 0)]);
    const ids = ev.filter((e) => e.k === 'hit' && e.src === 'bouncer').map((e) => (e.k === 'hit' ? e.id : ''));
    expect(ids.slice(0, 2)).toEqual(['p1', 'p2']);
    // obstáculo no caminho: quica e segue para o inimigo
    const w2 = world([[0, 0], [0, 4]], ['bouncer']);
    w2.pillars = [{ pos: v(2, 0), hp: 999, alive: true, kind: 'rock' }];
    const ev2 = runEvents(w2, 2, [cast('p0', 'bouncer', 2, 0)]);
    expect(ev2.some((e) => e.k === 'hit' && e.src === 'bouncer' && e.id === 'p1')).toBe(true);
  });

  it('jumps to the next wizard with 70% of the damage and stops once it would drop below 10', () => {
    const w = world([[-2, 0], [2, 0], [2, 2]], ['bouncer']);
    for (const z of w.wizards) z.kbResist = 1; // sem empurrão: os alvos ficam no lugar
    const ev = runEvents(w, 3, [cast('p0', 'bouncer', 2, 0)]);
    const hits = hitsOf(ev, 'bouncer');
    const d0 = SPELLS.bouncer.levels[0].dmg;
    expect(hits.map((h) => h.id)).toEqual(['p1', 'p2', 'p1', 'p2', 'p1']);
    hits.forEach((h, i) => expect(h.dmg).toBeCloseTo(Math.round(d0 * 0.7 ** i), 5));
    expect(d0 * 0.7 ** 5).toBeLessThan(10);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('Bumerangue e baú', () => {
  it('the boomerang damages the chest', () => {
    const w = world([[0, 0], [9, 9]], ['boomerang']);
    w.pillars = [{ pos: v(2.5, 0), hp: 250, alive: true, kind: 'chest' }];
    run(w, 1.5, [cast('p0', 'boomerang', 4, 0)]);
    expect(w.pillars[0].hp).toBeLessThan(250);
  });
});

// as dez restantes do Warlock Brawl (17/10)
describe('Drenar', () => {
  it('on an enemy: damage, slow and a healing orb that flies back to the caster', () => {
    const w = world([[0, 0], [3, 0]], ['drain']);
    const L = spellLevel('drain', 1);
    w.wizards[0].hp = 800;
    const ev = runEvents(w, 0.6, [cast('p0', 'drain', 3, 0)]);
    expect(hitsOf(ev, 'drain')[0].dmg).toBeCloseTo(L.dmg, 5);
    expect(w.wizards[1].speed).toBeLessThan(WIZ_SPEED);
    expect(w.projectiles.some((p) => p.kind === 'drain' && p.back)).toBe(true);
    run(w, 1.5);
    expect(w.projectiles).toHaveLength(0);
    expect(w.wizards[0].hp).toBeGreaterThan(800 + L.dmg - 1); // cura + regeneração
  });

  it('on an ally (Times): heals and hastes instead of hurting', () => {
    const own = { ...noSpells(), drain: 1 };
    const w = newWorld(['a', 'b'], { a: own, b: own }, {}, 0, Math.random, false, { a: 0, b: 0 });
    [w.wizards[0].pos, w.wizards[1].pos] = [v(0, 0), v(3, 0)];
    for (const z of w.wizards) z.invulnUntil = 0;
    w.wizards[1].hp = 700;
    run(w, 0.8, [cast('a', 'drain', 3, 0)]);
    expect(w.wizards[1].hp).toBeGreaterThan(700 + spellLevel('drain', 1).dmg - 1);
    expect(w.wizards[1].speed).toBeGreaterThan(WIZ_SPEED);
  });
});

describe('Bola de neve', () => {
  it('rolls through the target dragging it along, hurts while touching and explodes at the end', () => {
    const w = world([[0, 0], [2, 0]], ['snowball']);
    const L = spellLevel('snowball', 1);
    const ev = runEvents(w, 2.5, [cast('p0', 'snowball', 5, 0)]);
    const hits = hitsOf(ev, 'snowball');
    expect(w.wizards[1].pos.x).toBeGreaterThan(3); // arrastado
    expect(hits.filter((h) => h.dmg === L.dot * 0.5).length).toBeGreaterThanOrEqual(1); // dano de quem encostou
    expect(hits.length).toBeGreaterThanOrEqual(2); // e a explosão
    expect(ev.some((e) => e.k === 'clash' && e.combo === 'snow')).toBe(true);
    expect(w.wizards[0].hp).toBe(HP_MAX);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('Ilusão', () => {
  const L = spellLevel('illusion', 1);
  const copy = (w: World) => w.projectiles.find((p) => p.kind === 'illusion');

  it('números: 2 s de cópia em todos os níveis, recarga 14 a 11 s, custo 12', () => {
    expect(SPELLS.illusion.levels.map((l) => [l.duration, l.cd])).toEqual([[2, 14], [2, 13.5], [2, 13], [2, 12.5], [2, 12], [2, 11.5], [2, 11]]);
    expect([SPELLS.illusion.cost, SPELLS.illusion.up]).toEqual([12, [6, 7, 8, 9, 10, 11]]);
  });

  it('a cópia sai do lugar do jogador e segue independente enquanto ele se move invisível', () => {
    const w = world([[0, 0], [0, -8]], ['illusion']);
    w.wizards[0].vel = v(0, WIZ_SPEED);
    w.wizards[0].target = v(-5, 0); // velocidade atual prevalece sobre destino e mira da magia
    stepWorld(w, [cast('p0', 'illusion', 5, 0)]);
    const copyStart = { ...copy(w)!.pos };
    const copyVel = { ...copy(w)!.vel };
    w.wizards[0].target = v(5, 0); // o jogador pode escolher outra direção sem redirecionar a cópia
    run(w, 1);
    expect(copy(w)!.pos.x).toBeCloseTo(copyStart.x + copyVel.x, 2);
    expect(copy(w)!.pos.y).toBeCloseTo(copyStart.y + copyVel.y, 2);
    expect(w.wizards[0].pos.x).toBeGreaterThan(0);
    expect(w.wizards[0].pos.y).toBeGreaterThan(0); // mantém o movimento próprio iniciado antes da mudança de direção
    expect(copy(w)!.vel.x).toBeCloseTo(copyVel.x, 6);
    expect(copy(w)!.vel.y).toBeCloseTo(copyVel.y, 6);
    expect(w.wizards[0].veilUntil).toBeCloseTo(L.duration, 6);
    const ids = ['p0', 'p1'];
    expect(decodeSnap(encodeSnap(w, 'p0', 0, []), ids).wizards[0].status & 1024).toBe(1024); // si mesmo vê a versão translúcida da Caminhada no vento
    expect(decodeSnap(encodeSnap(w, 'p1', 0, []), ids).wizards[0].status & 2048).toBe(2048); // adversário não vê o jogador
    run(w, L.duration - 1 - 3 * DT);
    expect(copy(w)).toBeTruthy();
    run(w, 6 * DT);
    expect(copy(w)).toBeUndefined();
    expect(decodeSnap(encodeSnap(w, 'p1', 0, []), ids).wizards[0].status & 2048).toBe(0);
  });

  it('usa o destino de movimento quando o jogador ainda não ganhou velocidade', () => {
    const w = world([[0, 0], [0, -8]], ['illusion']);
    w.wizards[0].target = v(-5, 0);
    stepWorld(w, [cast('p0', 'illusion', 0, 5)]);
    expect(copy(w)!.vel.x).toBeLessThan(0);
    expect(Math.abs(copy(w)!.vel.y)).toBeLessThan(1e-6);
  });

  it('adversários não veem o jogador invisível pela Ilusão', () => {
    const w = world([[0, 0], [0, -8]], ['illusion']);
    stepWorld(w, [cast('p0', 'illusion', 5, 0)]);
    const bit = decodeSnap(encodeSnap(w, 'p1', 0, []), ['p0', 'p1']).wizards[0].status & 2048;
    expect(bit).toBe(2048);
  });

  it('o jogador pode ser atingido sem perder a invisibilidade antes dos 2 s', () => {
    const w = world([[0, 0], [0, -8]], ['illusion']);
    stepWorld(w, [cast('p0', 'illusion', 5, 0)]);
    const until = w.wizards[0].veilUntil;
    copy(w)!.pos = v(5, 5); // o projétil acerta o personagem real, não a cópia
    w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'fireball', owner: 'p1', caster: 'p1', pos: v(0, -0.5), vel: v(0, 20), level: 1, until: w.t + 2, target: null, dmgMult: 1 });
    stepWorld(w, []);
    expect(w.wizards[0].hp).toBeLessThan(HP_MAX); // invisibilidade não é invulnerabilidade
    expect(w.wizards[0].veilUntil).toBe(until);
    expect(decodeSnap(encodeSnap(w, 'p1', 0, []), ['p0', 'p1']).wizards[0].status & 2048).toBe(2048);
    expect(copy(w)).toBeTruthy();
  });

  it('usar outra magia revela o jogador, mas não encerra a cópia antes dos 2 s', () => {
    const w = world([[0, 0], [0, -8]], ['illusion']);
    w.wizards[0].spells.fireball = 1;
    stepWorld(w, [cast('p0', 'illusion', 5, 0)]);
    expect(w.wizards[0].veilUntil).toBeGreaterThan(w.t);
    expect(copy(w)).toBeTruthy();
    stepWorld(w, [cast('p0', 'fireball', 5, 0)]);
    expect(w.wizards[0].veilUntil).toBe(0);
    expect(copy(w)).toBeTruthy();
  });

  it('projétil não destrói a cópia e a empurra enquanto o jogador segue livre e invisível', () => {
    const w = world([[0, 0], [5, 0]], ['illusion']);
    stepWorld(w, [cast('p0', 'illusion', 0, 5)]);
    const q = copy(w)!;
    q.pos = v(0, 0);
    q.vel = v(0, 0); // isola o empurrão do movimento natural da cópia
    w.wizards[0].pos = v(5, 0); // jogador real já se moveu livremente para longe da cópia
    w.projectiles.push({ id: w.nextId++, born: w.t, kind: 'fireball', owner: 'p1', caster: 'p1', pos: v(0, -0.5), vel: v(0, 20), level: 1, until: w.t + 2, target: null, dmgMult: 1 });
    stepWorld(w, []);
    expect(copy(w)).toBe(q); // o impacto não encerra a duração
    expect(q.vel.y).toBeGreaterThan(0); // a cópia recebe o empurrão
    expect(w.wizards[0].pos.x).toBeGreaterThan(0); // personagem independente, longe do impacto
    expect(w.wizards[0].hp).toBe(HP_MAX);
  });

  it('o Míssil teleguiado inimigo que mirava o dono persegue a cópia enquanto ela existir', () => {
    const w = world([[0, 0], [5, 0]], ['illusion', 'homing']);
    stepWorld(w, [cast('p0', 'illusion', 0, 5)]); // a cópia sobe; o dono fica
    stepWorld(w, [cast('p1', 'homing', 0, 0)]); // o míssil escolhe o dono, o mais perto da mira
    run(w, 0.5);
    const missile = () => w.projectiles.find((p) => p.kind === 'homing')!;
    expect(missile().target).toBe('p0');
    expect(missile().vel.y).toBeGreaterThan(0.2 * len(missile().vel)); // virou para a cópia, que está acima do dono
    expect(w.wizards[0].hp).toBe(HP_MAX);
    copy(w)!.until = 0; // a cópia acaba: o míssil volta para o dono e o acerta
    expect(hitsOf(runEvents(w, 1.5), 'homing').some((h) => h.id === 'p0')).toBe(true);
  });

  it('o bot inimigo não enxerga o dono velado e mira a cópia; depois do véu fica com o mais perto', () => {
    const w = world([[0, 0], [4, 0]], ['illusion']);
    const aim = () => botCmds(w, 'p1', () => 0.5).find((c) => c.kind === 'cast');
    const step = (secs: number, cmds: Cmd[] = []) => {
      for (let i = 0; i < Math.round(secs / DT); i++) {
        stepWorld(w, i === 0 ? cmds : []);
        botWatch(w);
      }
    };
    step(0.3);
    expect(aim()).toMatchObject({ spell: 'fireball', at: { y: expect.closeTo(0, 0) } }); // antes: no dono, parado
    step(0.45, [cast('p0', 'illusion', 0, 5)]);
    const veiled = aim();
    expect(w.t).toBeLessThan(0.3 + L.duration);
    expect(veiled?.kind === 'cast' && veiled.at.y).toBeGreaterThan(0.45); // na cópia, que sobe (o dono está em y = 0)
    step(1.7); // a cópia e a invisibilidade acabam juntas
    const after = aim();
    expect(after?.kind === 'cast' && Math.abs(after.at.y)).toBeLessThan(0.3);
  });

  it('os Gêmeos saíram de tudo; magia desconhecida (salas, mensagens e planos de bot antigos) não quebra', () => {
    expect(SPELL_IDS).not.toContain('twin');
    expect(PROJ_KINDS).not.toContain('twin');
    expect('twin' in SPELLS).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'cast', spell: 'twin', x: 1, y: 1, seq: 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'buy', spell: 'twin' }))).toBeNull();
    // sala gravada com os Gêmeos comprados e um bot que planejava comprá-los
    const m = newMatch();
    addPlayer(m, 'b', 'Bot', true);
    const p = m.players[0] as (typeof m.players)[number] & { plan?: BotPlan };
    (p.spells as Record<string, number>).twin = 2;
    p.plan = { buys: [{ kind: 'spell', id: 'twin' as SpellId }, { kind: 'spell', id: 'illusion' }], upgrade: 'lowest' };
    resume(m, 0);
    expect('twin' in p.spells).toBe(false);
    p.gold = 100;
    expect(botBuy(p)).toEqual({ kind: 'spell', id: 'illusion' });
  });
});

describe('Magnetizar', () => {
  it('a magnetized enemy pulls in a shot that would have missed', () => {
    const shotHits = (magnet: boolean) => {
      const w = world([[0, 0], [4, 0]], ['magnetize']);
      if (magnet) {
        run(w, 1, [cast('p0', 'magnetize', 4, 0)]);
        expect(w.wizards[1].magnetUntil).toBeGreaterThan(w.t);
      }
      w.wizards[1].pos = v(4, 0);
      w.wizards[1].vel = v(0, 0);
      const ev = runEvents(w, 1.2, [cast('p0', 'fireball', 4, 1.1)]);
      return hitsOf(ev, 'fireball').length;
    };
    expect(shotHits(false)).toBe(0);
    expect(shotHits(true)).toBe(1);
  });
});

describe('Recarga', () => {
  it('a hit sends back an orb that resets the cooldown, and the next hit deals +10', () => {
    const w = world([[0, 0], [3, 0]], ['recharge']);
    w.wizards[1].kbResist = 1;
    const L = spellLevel('recharge', 1);
    const first = hitsOf(runEvents(w, 2, [cast('p0', 'recharge', 3, 0)]), 'recharge');
    expect(first[0].dmg).toBeCloseTo(L.dmg, 5);
    expect(w.wizards[0].cd.recharge).toBeLessThanOrEqual(w.t); // recarga zerada pela volta
    expect(w.wizards[0].streak).toBe(1);
    const second = hitsOf(runEvents(w, 1, [cast('p0', 'recharge', 3, 0)]), 'recharge');
    expect(second[0].dmg).toBeCloseTo(L.dmg + 10, 5);
    // errou: zera
    runEvents(w, 2.5);
    w.wizards[0].cd.recharge = 0;
    runEvents(w, 1.5, [cast('p0', 'recharge', 0, 5)]);
    expect(w.wizards[0].streak).toBe(0);
  });
});

describe('Alteração', () => {
  it('swaps places with the first enemy projectile that gets close, unharmed', () => {
    const w = world([[0, 0], [4, 0]], ['alteration']);
    runEvents(w, 0.6, [cast('p1', 'alteration', 4, 0), cast('p0', 'fireball', 4, 0)]);
    expect(w.wizards[1].pos.x).toBeLessThan(3.4); // foi para onde o projétil estava
    expect(w.wizards[1].alterUntil).toBe(0);
    const fb = w.projectiles.find((p) => p.kind === 'fireball')!;
    expect(fb.pos.x).toBeGreaterThan(w.wizards[1].pos.x); // segue em frente, para longe
    run(w, 1);
    expect(w.wizards[1].hp).toBe(HP_MAX);
  });
});

describe('Elo', () => {
  it('latches onto an enemy, pulls it to the caster with damage, then lets go', () => {
    const w = world([[0, 0], [5, 0]], ['link']);
    let linkedBit = false;
    let closest = Infinity;
    const ev = runEvents(w, 3, [cast('p0', 'link', 5, 0)], () => {
      linkedBit ||= (decodeSnap(encodeSnap(w, 'p0', 0, []), ['p0', 'p1']).wizards[1].status & 65536) > 0;
      closest = Math.min(closest, dist(w.wizards[0].pos, w.wizards[1].pos));
    });
    expect(linkedBit).toBe(true);
    expect(closest).toBeLessThan(1.2);
    expect(hitsOf(ev, 'link').length).toBeGreaterThan(1);
    expect(w.projectiles).toHaveLength(0);
  });

  it('on an obstacle pulls the caster to it', () => {
    const w = world([[0, 0], [0, -8]], ['link']);
    w.pillars = [{ pos: v(4, 0), hp: 400, alive: true, kind: 'pillar' }];
    let far = 0;
    runEvents(w, 2, [cast('p0', 'link', 4, 0)], () => (far = Math.max(far, w.wizards[0].pos.x)));
    expect(far).toBeGreaterThan(2.5); // chega no obstáculo (e quica nele)
  });
});

describe('Caminhada no vento', () => {
  it('invisible to enemies and faster; the first enemy touched takes the hit and it ends', () => {
    const w = world([[0, 0], [3, 0]], ['windwalk']);
    run(w, 0.1, [cast('p0', 'windwalk', 0, 0), { id: 'p0', kind: 'move', to: v(6, 0) }]);
    expect(w.wizards[0].speed).toBeGreaterThan(WIZ_SPEED * 1.5);
    const ids = ['p0', 'p1'];
    expect(decodeSnap(encodeSnap(w, 'p1', 0, []), ids).wizards[0].status & 2048).toBe(2048); // o inimigo não vê
    expect(decodeSnap(encodeSnap(w, 'p0', 0, []), ids).wizards[0].status & 1024).toBe(1024); // quem anda vê o efeito
    const ev = runEvents(w, 1.5);
    expect(hitsOf(ev, 'windwalk')[0]?.dmg).toBeCloseTo(spellLevel('windwalk', 1).dmg, 5);
    expect(w.wizards[1].vel.x).toBeGreaterThan(0);
    expect(w.wizards[0].windUntil).toBe(0);
  });
});

describe('Divisor', () => {
  it('splits at the click point into 8 shards that fan out and hit whoever is ahead', () => {
    const w = world([[0, 0], [5, 0]], ['splitter']);
    const shards = new Set<number>();
    const ev = runEvents(w, 2.5, [cast('p0', 'splitter', 3, 0)], () => w.projectiles.filter((p) => p.kind === 'shard').forEach((p) => shards.add(p.id)));
    expect(shards.size).toBe(8);
    const hits = hitsOf(ev, 'splitter');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    hits.forEach((h) => expect(h.dmg).toBeCloseTo(spellLevel('splitter', 1).dmg, 5));
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('Zona de dobra', () => {
  it('slows enemy projectiles inside it, not the caster own', () => {
    const fireballX = (zone: boolean, shooter: string) => {
      const w = world([[0, -3], [6, 0]], ['warpzone']);
      const at = shooter === 'p1' ? v(0, 0) : v(9, 0);
      if (shooter === 'p0') w.wizards[0].pos = v(-1, 0);
      run(w, 0.8, [...(zone ? [cast('p0', 'warpzone', 3, 0)] : []), { id: shooter, kind: 'cast', spell: 'fireball', at }]);
      return w.projectiles.find((p) => p.kind === 'fireball')!.pos.x;
    };
    expect(fireballX(true, 'p1')).toBeGreaterThan(fireballX(false, 'p1') + 1); // inimigo: anda menos
    expect(fireballX(true, 'p0')).toBeCloseTo(fireballX(false, 'p0'), 5); // o próprio: igual
    const w = world([[0, 0], [9, 9]], ['warpzone']);
    run(w, 0.2, [cast('p0', 'warpzone', 3, 0)]);
    const view = decodeSnap(encodeSnap(w, 'p0', 0, []), ['p0', 'p1']);
    expect(view.projectiles[0].kind).toBe('warpzone');
    expect(view.projectiles[0].vel.x).toBeCloseTo(spellLevel('warpzone', 1).radius, 1);
  });

  it('slows enemies walking inside it, not the caster', () => {
    const w = world([[0, 0], [3, 0]], ['warpzone']);
    run(w, 0.3, [cast('p0', 'warpzone', 3, 0), { id: 'p1', kind: 'move', to: v(3, 3) }, { id: 'p0', kind: 'move', to: v(0, 3) }]);
    expect(w.wizards[1].speed).toBeCloseTo(w.wizards[1].baseSpeed * WARPZONE.wizMult, 5);
    expect(w.wizards[0].speed).toBeCloseTo(w.wizards[0].baseSpeed, 5);
  });
});
