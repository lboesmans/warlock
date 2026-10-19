import { describe, expect, it, vi } from 'vitest';
import { BOT_SKILL, CLASSIC_PLAN, botBuy, botCmds, skillAt } from '../src/shared/bots.ts';
import { ARENA_R0, ASSIST_GOLD, COUNTDOWN_MS, DM_ROUND_MS, KILL_GOLD, ROUND_END_MS, ROUND_GOLD, SHOP_MS, START_GOLD, TOP_DMG_GOLD, VOTE_MS, WIN_GOLD, WINS_TO_WIN } from '../src/shared/constants.ts';
import { SPELLS } from '../src/shared/spells.ts';
import { lookOf } from '../src/shared/characters.ts';
import { BOT_NAMES, addPlayer, botSkill, buy, castBallot, endIdle, kick, newMatch, removePlayer, resume, setLook, setReady, shouldRun, startMatch, startVote, tickMatch, type Match, type Stat } from '../src/shared/match.ts';
import { newWorld } from '../src/shared/sim.ts';
import { roundRecord } from '../src/shared/telemetry.ts';
import { publicRoom } from '../src/shared/protocol.ts';
import { noItems } from '../src/shared/items.ts';
import { noSpells } from '../src/shared/spells.ts';
import { v } from '../src/shared/vec.ts';
import { STEP_MS, kill, toPlaying, until } from './helpers.ts';

function twoPlayers(): Match {
  const m = newMatch();
  addPlayer(m, 'a', 'Ana');
  addPlayer(m, 'b', 'Bia');
  startMatch(m, 0, 0);
  return m;
}


describe('partida', () => {
  it('needs two players to start', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    expect(startMatch(m, 0, 0)).toBe(false);
    expect(startMatch(m, 0, 2)).toBe(true);
    expect(m.players.filter((p) => p.bot).length).toBe(2);
  });

  it('uses the injected random source when creating a round', () => {
    const m = twoPlayers();
    const nativeRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      tickMatch(m, SHOP_MS + 1, [], () => 0.5);
      expect(nativeRandom).not.toHaveBeenCalled();
    } finally {
      nativeRandom.mockRestore();
    }
    expect(m.world).not.toBeNull();
  });

  it('last alive gets 1 point', () => {
    const m = twoPlayers();
    let now = toPlaying(m, 0);
    kill(m, 'b', null);
    now = until(m, now, () => m.phase === 'roundEnd');
    expect(m.players.find((p) => p.id === 'a')!.score).toBe(1);
    expect(m.lastRoundWinner).toBe('a');
  });

  it('kill gives no points', () => {
    const m = twoPlayers();
    addPlayer(m, 'c', 'Caio');
    const now = toPlaying(m, 0);
    kill(m, 'b', 'a');
    until(m, now, () => !m.world!.wizards[1].alive);
    expect(m.players.find((p) => p.id === 'a')!.score).toBe(0);
  });

  it('kill gives gold to the killer, with a live event over them', () => {
    const m = twoPlayers();
    addPlayer(m, 'c', 'Caio');
    let now = toPlaying(m, 0);
    const before = m.players.find((p) => p.id === 'a')!.gold;
    kill(m, 'b', 'a');
    let ev: unknown;
    for (let i = 0; i < 600 && !ev; i++) ev = tickMatch(m, (now += STEP_MS), [], () => 0.5).find((e) => e.k === 'gold');
    expect(ev).toMatchObject({ k: 'gold', id: 'a', n: KILL_GOLD });
    expect(m.players.find((p) => p.id === 'a')!.gold).toBe(before + KILL_GOLD);
  });

  it('a room saved before accuracy stats existed still counts hits without breaking the step', () => {
    const m = twoPlayers();
    for (const p of m.players) {
      delete (p.stats.room as Partial<Stat>).fired;
      delete (p.stats.room as Partial<Stat>).landed;
    }
    resume(m, 0);
    let now = toPlaying(m, 0);
    const w = m.world!;
    w.pillars = [];
    w.wizards[0].pos = v(0, 0);
    w.wizards[1].pos = v(3, 0);
    for (const z of w.wizards) z.invulnUntil = 0;
    const kinds: string[] = [];
    for (let i = 0; i < 60; i++) kinds.push(...tickMatch(m, (now += STEP_MS), i === 0 ? [{ id: 'a', kind: 'cast', spell: 'fireball', at: v(3, 0) }] : [], () => 0.5).map((e) => e.k));
    expect(kinds).toContain('hit');
    expect(m.players[0].stats.room.landed.fireball).toBe(1);
  });

  it('assist: whoever hit the victim the most, other than the killer, gets 2 gold', () => {
    const m = twoPlayers();
    addPlayer(m, 'c', 'Caio');
    let now = toPlaying(m, 0);
    m.dmgOn = { b: { c: 80, a: 20 } };
    const before = m.players.find((p) => p.id === 'c')!.gold;
    kill(m, 'b', 'a');
    for (let i = 0; i < 600 && m.world!.wizards[1].alive; i++) tickMatch(m, (now += STEP_MS), [], () => 0.5);
    expect(m.players.find((p) => p.id === 'c')!.gold).toBe(before + ASSIST_GOLD);
  });

  it('if the last ones die together, the one with more hp wins', () => {
    const m = twoPlayers();
    const now = toPlaying(m, 0);
    kill(m, 'a', null);
    kill(m, 'b', null);
    m.world!.wizards[1].hp = 0.5;
    until(m, now, () => m.phase === 'roundEnd');
    expect(m.lastRoundWinner).toBe('b');
  });

  it('kick removes bots and dropped players, never connected people', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 2);
    expect(kick(m, 'a')).toBe(false);
    expect(kick(m, 'bot-1')).toBe(true);
    expect(m.players.some((p) => p.id === 'bot-1')).toBe(false);
    addPlayer(m, 'c', 'Caio');
    removePlayer(m, 'c');
    expect(kick(m, 'c')).toBe(true);
  });

  it('idle match is closed', () => {
    const m = twoPlayers();
    toPlaying(m, 0);
    m.players[0].score = 2;
    endIdle(m);
    expect(m.phase).toBe('end');
    expect(m.winner).toBe('a');
  });

  it('first to WINS_TO_WIN rounds wins the match', () => {
    const m = twoPlayers();
    let now = 0;
    for (let r = 0; r < WINS_TO_WIN + 2; r++) {
      now = toPlaying(m, now);
      kill(m, 'b', null);
      now = until(m, now, () => m.phase === 'roundEnd');
      now = until(m, now, () => m.phase !== 'roundEnd');
      if (m.phase === 'end') break;
    }
    expect(m.phase).toBe('end');
    expect(m.winner).toBe('a');
    expect(m.players[0].score).toBe(WINS_TO_WIN);
    expect(m.round).toBe(WINS_TO_WIN);
  });

  it('buy deducts gold and caps at level 7', () => {
    const m = twoPlayers();
    m.players[0].gold = 200;
    expect(buy(m, 'a', 'lightning')).toBe(true);
    expect(m.players[0].gold).toBe(200 - SPELLS.lightning.cost);
    for (let i = 0; i < 6; i++) expect(buy(m, 'a', 'lightning')).toBe(true);
    expect(buy(m, 'a', 'lightning')).toBe(false);
    expect(m.players[0].spells.lightning).toBe(7);
    expect(m.players[0].gold).toBe(200 - SPELLS.lightning.cost - SPELLS.lightning.up.reduce((a, b) => a + b, 0));
  });

  it('cannot buy without gold or outside the shop', () => {
    const m = twoPlayers();
    m.players[0].gold = 5;
    expect(buy(m, 'a', 'shield')).toBe(false);
    m.players[0].gold = 50;
    toPlaying(m, 0);
    expect(buy(m, 'a', 'shield')).toBe(false);
  });

  it('shop ends early when all ready', () => {
    const m = twoPlayers();
    setReady(m, 'a');
    tickMatch(m, 1, []);
    expect(m.phase).toBe('shop');
    setReady(m, 'b');
    tickMatch(m, 2, []);
    expect(m.phase).toBe('countdown');
  });

  it('shop ends by time', () => {
    const m = twoPlayers();
    tickMatch(m, SHOP_MS + 1, []);
    expect(m.phase).toBe('countdown');
    tickMatch(m, SHOP_MS + COUNTDOWN_MS + 2, []);
    expect(m.phase).toBe('playing');
  });

  it('late joiner waits for next shop', () => {
    const m = twoPlayers();
    let now = toPlaying(m, 0);
    addPlayer(m, 'c', 'Caio');
    expect(m.world!.wizards.some((z) => z.id === 'c')).toBe(false);
    kill(m, 'b', null);
    now = until(m, now, () => m.phase === 'shop');
    expect(m.players.find((p) => p.id === 'c')!.gold).toBe(START_GOLD + 0);
    toPlaying(m, now);
    expect(m.world!.wizards.some((z) => z.id === 'c')).toBe(true);
  });

  it('disconnect keeps the player during the match', () => {
    const m = twoPlayers();
    removePlayer(m, 'b');
    expect(m.players.length).toBe(2);
    expect(m.players[1].connected).toBe(false);
    tickMatch(m, 1, []);
    expect(m.phase).toBe('shop'); // 'a' ainda não clicou pronto
    setReady(m, 'a');
    tickMatch(m, 2, []);
    expect(m.phase).toBe('countdown');
  });

  it('round gold is paid to everyone', () => {
    const m = twoPlayers();
    const now = toPlaying(m, 0);
    kill(m, 'b', null);
    until(m, now, () => m.phase === 'roundEnd');
    expect(m.players[0].gold).toBe(START_GOLD + ROUND_GOLD + WIN_GOLD);
    // b ficou atrás da média da partida: recebe metade da diferença (recuperação)
    const avg = (ROUND_GOLD + WIN_GOLD + ROUND_GOLD) / 2;
    expect(m.players[1].gold).toBe(START_GOLD + ROUND_GOLD + Math.floor((avg - ROUND_GOLD) / 2));
    expect(ROUND_END_MS).toBeGreaterThan(0);
  });

  it('killing the leader pays a bounty and the leader wins less', () => {
    const m = twoPlayers();
    addPlayer(m, 'c', 'Caio');
    let now = toPlaying(m, 0);
    m.players.find((p) => p.id === 'b')!.score = 3; // b lidera: média 1, vantagem 2 → +6
    const before = m.players.find((p) => p.id === 'a')!.gold;
    kill(m, 'b', 'a');
    for (let i = 0; i < 600 && m.world!.wizards[1].alive; i++) tickMatch(m, (now += STEP_MS), [], () => 0.5);
    expect(m.players.find((p) => p.id === 'a')!.gold).toBe(before + KILL_GOLD + 6);
  });

  it('whoever dealt the most damage in the round gets extra gold, with a live event', () => {
    const m = twoPlayers();
    const now = toPlaying(m, 0);
    m.players[1].stats.round.dmg = 300;
    m.players[0].stats.round.dmg = 120;
    kill(m, 'b', null);
    let evs: { k: string; id?: string; n?: number }[] = [];
    for (let t = now; m.phase !== 'roundEnd'; ) evs = tickMatch(m, (t += STEP_MS), [], () => 0.5);
    expect(m.players[0].gold).toBe(START_GOLD + ROUND_GOLD + WIN_GOLD);
    expect(m.players[1].gold).toBe(START_GOLD + ROUND_GOLD + TOP_DMG_GOLD);
    expect(evs.filter((e) => e.k === 'gold').map((e) => [e.id, e.n])).toEqual([['a', WIN_GOLD], ['b', TOP_DMG_GOLD]]);
  });

  it('aparência troca em qualquer fase, até no meio da rodada; o personagem vira o da cabeça', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    expect(m.players[0]).toMatchObject({ character: 'mage', look: lookOf('mage') });
    expect(setLook(m, 'a', lookOf('knight'))).toBe(true);
    startMatch(m, 0, 2);
    const bots = m.players.filter((p) => p.bot);
    expect(new Set(bots.map((p) => p.look)).size).toBe(bots.length);
    for (const b of bots) expect(b.look).toBe(lookOf(b.character));
    toPlaying(m, 0);
    expect(setLook(m, 'a', '5000000')).toBe(true); // cabeça do esqueleto mago no corpo do mago
    expect(m.players[0]).toMatchObject({ character: 'skeleton_mage', look: '5000000' });
    expect(setLook(m, 'a', '5000000')).toBe(false); // igual: nada a repassar
    expect(setLook(m, 'zz', '5000000')).toBe(false);
    expect(publicRoom('r', m, 0).players[0]).toMatchObject({ character: 'skeleton_mage', look: '5000000' });
  });

  it('sala gravada antes da aparência ganha a do personagem', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    m.players[0].character = 'rogue_hooded';
    delete (m.players[0] as { look?: string }).look;
    resume(m, 0);
    expect(m.players[0].look).toBe(lookOf('rogue_hooded'));
  });

  it('loop stops without humans', () => {
    const m = twoPlayers();
    expect(shouldRun(m, 1)).toBe(true);
    expect(shouldRun(m, 0)).toBe(false);
    expect(shouldRun(newMatch(), 3)).toBe(false);
  });
});

describe('bots', () => {
  it('bot buys the next spell of its plan, saving gold for it', () => {
    expect(botBuy({ gold: 11, spells: noSpells(), items: noItems(), plan: CLASSIC_PLAN })).toEqual({ kind: 'spell', id: 'lightning' });
    // sem dinheiro para o próximo do plano: guarda (não gasta em outra coisa)
    expect(botBuy({ gold: 10, spells: noSpells(), items: noItems(), plan: CLASSIC_PLAN })).toBeNull();
  });

  it('bot walks inward when near edge', () => {
    const w = newWorld(['bot', 'x'], { bot: noSpells(), x: noSpells() });
    w.wizards[0].pos = v(ARENA_R0 - 0.5, 0);
    w.wizards[0].cd.fireball = 99;
    const move = botCmds(w, 'bot', () => 0.5).find((c) => c.kind === 'move');
    expect(move && move.kind === 'move' && move.to.x < ARENA_R0 - 1.5).toBe(true); // para dentro (o primeiro ponto do caminho, ao menos 1 m)
  });

  it('bot casts fireball at nearest enemy', () => {
    const w = newWorld(['bot', 'near', 'far'], { bot: noSpells(), near: noSpells(), far: noSpells() });
    w.wizards[0].pos = v(0, 0);
    w.wizards[1].pos = v(4, 0);
    w.wizards[2].pos = v(-6, 0);
    const cast = botCmds(w, 'bot', () => 0.3).find((c) => c.kind === 'cast');
    expect(cast && cast.kind === 'cast' && cast.spell === 'fireball' && cast.at.x > 2).toBe(true);
  });
});

describe('treino: magias dos bots', () => {
  const cfg = [{ spells: { fireball: 0, lightning: 3, shield: 7 } }, {}, { items: { armor: 2 }, skill: { aim: 0.2 } }];

  it('sala com uma pessoa: o bot entra exatamente com o que foi pedido, em toda rodada, sem comprar', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    expect(startMatch(m, 0, 3, 'rounds', true, Math.random, {}, cfg)).toBe(true);
    const bot = (n: number) => m.players.find((p) => p.id === 'bot-' + n)!;
    const want = { ...noSpells(), fireball: 0, lightning: 3, shield: 7 };
    expect(bot(1).spells).toEqual(want);
    expect(bot(1).items).toEqual({ ...noItems(), scourge: 1 });
    expect(bot(1).gold).toBe(START_GOLD); // não gastou nada
    expect(bot(3).spells).toEqual(noSpells());
    expect(bot(3).items).toEqual({ ...noItems(), scourge: 1, armor: 2 });
    let now = toPlaying(m, 0);
    expect(m.world!.wizards.find((z) => z.id === 'bot-1')!.spells).toEqual(want);
    // a rodada sai marcada na telemetria
    for (const id of ['a', 'bot-2', 'bot-3']) kill(m, id, 'bot-1');
    now = until(m, now, () => m.phase === 'roundEnd');
    expect(roundRecord(m, now).setup).toBe(true);
    now = until(m, now, () => m.phase === 'shop');
    expect(m.round).toBe(1);
    expect(bot(1).spells).toEqual(want);
    expect(bot(1).gold).toBeGreaterThan(START_GOLD);
  });

  it('com duas pessoas a configuração é ignorada', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    addPlayer(m, 'b', 'Bia');
    startMatch(m, 0, 3, 'rounds', true, Math.random, {}, cfg);
    expect(m.players.some((p) => p.setup)).toBe(false);
    expect(m.players.find((p) => p.id === 'bot-1')!.spells.shield).toBeLessThan(7);
    const now = toPlaying(m, 0);
    for (const id of ['b', 'bot-1', 'bot-2', 'bot-3']) kill(m, id, 'a');
    expect(roundRecord(m, until(m, now, () => m.phase === 'roundEnd')).setup).toBeUndefined();
  });

  it('botSkill: o skill parcial vai por cima da dificuldade', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 3, 'rounds', true, Math.random, { difficulty: 'hard' }, cfg);
    const bot = (n: number) => m.players.find((p) => p.id === 'bot-' + n)!;
    expect(botSkill(m, bot(3))).toEqual({ ...BOT_SKILL.hard, aim: 0.2 });
    expect(botSkill(m, bot(1))).toBe(BOT_SKILL.hard);
  });
});

describe('dificuldade por bot', () => {
  it('vale em qualquer sala: cada bot com a sua, sem ela a da partida; com duas pessoas as magias do treino seguem ignoradas', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    addPlayer(m, 'b', 'Bia');
    startMatch(m, 0, 3, 'rounds', true, Math.random, { difficulty: 'hard' }, [{ difficulty: 'easy', spells: { lightning: 7 } }, { difficulty: 'normal' }]);
    const bot = (n: number) => m.players.find((p) => p.id === 'bot-' + n)!;
    expect([1, 2, 3].map((n) => botSkill(m, bot(n)))).toEqual([BOT_SKILL.easy, BOT_SKILL.normal, BOT_SKILL.hard]);
    expect([1, 2, 3].map((n) => bot(n).name)).toEqual(BOT_NAMES.slice(0, 3));
    expect(m.players.some((p) => p.setup)).toBe(false);
    expect(bot(1).spells.lightning).toBeLessThan(7);
    // a sala mostra a dificuldade de cada bot (a da partida quando ele não tem a sua); humano não leva o campo
    expect(publicRoom('ABCD', m, 0).players.map((p) => p.difficulty)).toEqual([undefined, undefined, 'easy', 'normal', 'hard']);
  });

  it('sozinho, só a dificuldade não é treino: a rodada não sai marcada', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 2, 'rounds', true, Math.random, {}, [{ difficulty: 'hard' }, { difficulty: 'easy' }]);
    expect(m.players.some((p) => p.setup)).toBe(false);
    const now = toPlaying(m, 0);
    for (const id of ['bot-1', 'bot-2']) kill(m, id, 'a');
    const r = roundRecord(m, until(m, now, () => m.phase === 'roundEnd'));
    expect(r.setup).toBeUndefined();
    expect(r.players.map((p) => p.difficulty)).toEqual([undefined, 'hard', 'easy']);
  });

  it('Automático por bot: só o bot no Automático acompanha o placar', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 2, 'rounds', true, Math.random, {}, [{ difficulty: 'auto' }, { difficulty: 'hard' }]);
    const [h, b1, b2] = m.players;
    h.score = 3;
    expect(botSkill(m, b1)).toEqual(skillAt(Math.min(1, 3 / m.opts.goal)));
    expect(botSkill(m, b2)).toBe(BOT_SKILL.hard);
  });

  it('bot votado no meio da partida entra Normal, mesmo com a partida em outra dificuldade', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 1, 'rounds', true, Math.random, { difficulty: 'hard' }, [{ difficulty: 'easy' }]);
    expect(startVote(m, 'a', 'addBot', '', 0)).toBe(true);
    toPlaying(m, 0);
    const added = m.players.find((p) => p.id === 'bot-2')!;
    expect(added.difficulty).toBe('normal');
    expect(botSkill(m, added)).toBe(BOT_SKILL.normal);
  });
});

describe('votação', () => {
  const threePlayers = (): Match => {
    const m = newMatch();
    for (const [id, name] of [['a', 'Ana'], ['b', 'Bia'], ['c', 'Caio']]) addPlayer(m, id, name);
    startMatch(m, 0, 0);
    return m;
  };

  it('passes with a majority; a mode change voted in the shop is the round about to start', () => {
    const m = threePlayers();
    expect(startVote(m, 'a', 'mode', 'deathmatch', 0)).toBe(true);
    expect(m.vote).toMatchObject({ kind: 'mode', target: 'deathmatch', by: 'a', yes: ['a'], no: [] });
    expect(castBallot(m, 'b', true, 1)).toBe(true);
    expect(m.vote).toBeNull();
    expect(m.pendingMode).toBe('deathmatch');
    expect(m.mode).toBe('rounds');
    toPlaying(m, 1);
    expect(m.mode).toBe('deathmatch');
    expect(m.world!.dm).toBe(true);
  });

  it('a lone human with bots passes at once (bots do not vote)', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    startMatch(m, 0, 2);
    expect(startVote(m, 'a', 'mode', 'deathmatch', 0)).toBe(true);
    expect(m.vote).toBeNull();
    expect(m.pendingMode).toBe('deathmatch');
  });

  it('without a majority it stays open, then expires after 20 s', () => {
    const m = threePlayers();
    startVote(m, 'a', 'mode', 'deathmatch', 0);
    expect(castBallot(m, 'b', false, 1)).toBe(true);
    expect(castBallot(m, 'b', true, 2)).toBe(false); // um voto por pessoa
    tickMatch(m, VOTE_MS - 1, []);
    expect(m.vote).not.toBeNull();
    tickMatch(m, VOTE_MS, []);
    expect(m.vote).toBeNull();
    expect(m.pendingMode).toBeNull();
  });

  it('fails as soon as the NOs make passing impossible', () => {
    const m = threePlayers();
    startVote(m, 'a', 'kick', 'c', 0);
    castBallot(m, 'b', false, 1);
    castBallot(m, 'c', false, 2);
    expect(m.vote).toBeNull();
    expect(m.players.some((p) => p.id === 'c')).toBe(true);
    expect(m.banned).toEqual([]);
  });

  it('passes on the next step when people leave and the yes votes become a majority', () => {
    const m = threePlayers();
    startVote(m, 'a', 'kick', 'c', 0);
    removePlayer(m, 'b');
    removePlayer(m, 'c');
    tickMatch(m, 1, []);
    expect(m.banned).toEqual(['c']);
    expect(m.players.some((p) => p.id === 'c')).toBe(false);
  });

  it('only one vote at a time', () => {
    const m = threePlayers();
    expect(startVote(m, 'a', 'mode', 'deathmatch', 0)).toBe(true);
    expect(startVote(m, 'b', 'kick', 'c', 1)).toBe(false);
    expect(m.vote!.by).toBe('a');
  });

  it('mode switches only on the next round, zeroing points and keeping gold', () => {
    const m = twoPlayers();
    let now = toPlaying(m, 0);
    const a = m.players.find((p) => p.id === 'a')!;
    a.score = 1;
    startVote(m, 'a', 'mode', 'deathmatch', now);
    castBallot(m, 'b', true, now);
    expect(m.pendingMode).toBe('deathmatch');
    expect(startVote(m, 'b', 'mode', 'deathmatch', now)).toBe(false); // já está votado
    // a rodada atual segue nas regras de antes
    kill(m, 'b', null);
    now = until(m, now, () => m.phase === 'roundEnd');
    expect(m.mode).toBe('rounds');
    expect(a.score).toBe(2);
    now = until(m, now, () => m.phase === 'shop');
    const gold = m.players.map((p) => p.gold);
    for (const p of m.players) setReady(m, p.id);
    now = until(m, now, () => m.phase === 'countdown');
    expect(m.mode).toBe('deathmatch');
    expect(m.pendingMode).toBeNull();
    expect(m.world!.dm).toBe(true);
    expect(m.players.map((p) => p.score)).toEqual([0, 0]);
    expect(m.players.map((p) => p.gold)).toEqual(gold);
    now = until(m, now, () => m.phase === 'playing');
    expect(m.phaseEnds - now).toBe(DM_ROUND_MS);
  });

  it('kick removes the player, kills the wizard and bans them from this room', () => {
    const m = threePlayers();
    const now = toPlaying(m, 0);
    expect(startVote(m, 'a', 'kick', 'c', now)).toBe(true);
    expect(castBallot(m, 'b', true, now)).toBe(true);
    expect(m.players.some((p) => p.id === 'c')).toBe(false);
    expect(m.banned).toEqual(['c']);
    const wz = m.world!.wizards.find((z) => z.id === 'c')!;
    expect(wz.alive).toBe(false);
    expect(wz.respawnAt).toBe(Infinity);
    expect(addPlayer(m, 'c', 'Caio')).toBe(false);
    endIdle(m);
    expect(startMatch(m, now, 0)).toBe(true);
    expect(addPlayer(m, 'c', 'Caio')).toBe(false);
  });

  it('cannot vote to kick yourself or a bot', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    addPlayer(m, 'b', 'Bia');
    startMatch(m, 0, 1);
    expect(startVote(m, 'a', 'kick', 'a', 0)).toBe(false);
    expect(startVote(m, 'a', 'kick', 'bot-1', 0)).toBe(false);
    expect(startVote(m, 'a', 'kick', 'zé', 0)).toBe(false);
    expect(startVote(m, 'bot-1', 'mode', 'deathmatch', 0)).toBe(false);
    expect(m.vote).toBeNull();
  });

  it('is refused outside a running match, and the match ending closes it', () => {
    const m = newMatch();
    addPlayer(m, 'a', 'Ana');
    addPlayer(m, 'b', 'Bia');
    expect(startVote(m, 'a', 'mode', 'deathmatch', 0)).toBe(false);
    startMatch(m, 0, 0);
    startVote(m, 'a', 'mode', 'deathmatch', 0);
    expect(m.vote).not.toBeNull();
    endIdle(m);
    expect(m.vote).toBeNull();
    expect(startVote(m, 'a', 'mode', 'deathmatch', 0)).toBe(false);
    expect(castBallot(m, 'b', true, 0)).toBe(false);
  });

  it('rooms saved before voting existed get an empty ban list', () => {
    const m = twoPlayers() as Partial<Match> as Match;
    delete (m as Partial<Match>).banned;
    delete (m as Partial<Match>).pendingMode;
    resume(m, 0);
    expect(m.banned).toEqual([]);
    expect(m.pendingMode).toBeNull();
    expect(addPlayer(m, 'c', 'Caio')).toBe(true);
  });
});
