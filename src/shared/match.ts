// Partida: fases, rodadas, pontos, ouro e loja. Pura; a sala chama tickMatch a cada passo da simulação.
import { ARENA_IDS } from './arena.ts';
import { BOT_SKILL, botBuy, botCmds, botThinks, botWatch, skillAt, threatTo, type BotPlan, type BotSkill } from './bots.ts';
import { CHARACTERS, lookHead, lookOf, type CharacterId } from './characters.ts';
import {
  ASSIST_GOLD, ASSIST_MIN_DMG, BOUNTY, STREAK, COUNTDOWN_MS, LEADER_WIN_GOLD, RECOVERY, DM_ROUND_MS, KILL_GOLD, MAX_PLAYERS, PILLAR, PROJ_R, ROUND_END_MS, ROUND_GOLD, SELL_DECAY, SELL_FLOOR, TOP_DMG_GOLD, VOTE_MS, WIN_GOLD, WIZ_R,
} from './constants.ts';
import { ITEMS, ITEM_IDS, itemPrice, noItems, type ItemId } from './items.ts';
import type { BotSetup } from './protocol.ts';
import { newWorld, stepWorld, type Cmd, type Projectile, type SimEvent, type World } from './sim.ts';
import { MAX_SPELLS, SPELL_IDS, isSpell, noSpells, priceOf, spellCount, spellLevel, type SpellId } from './spells.ts';
import { dist, len, type Vec } from './vec.ts';

// como no original, todo mundo começa com o Flagelo (além da Bola de fogo)
const startItems = (): Record<ItemId, number> => ({ ...noItems(), scourge: 1 });

// estatísticas do placar: ouro ganho, dano causado e precisão (lançadas e acertadas) por magia;
// jeito de jogar (watchStyle): ameaças, atingido por elas, Escudo pronto e usado, tempo de reação e distância do inimigo (somas e contagens)
export type Stat = {
  gold: number; dmg: number; kills: number; dmgBy: Record<string, number>; fired: Record<string, number>; landed: Record<string, number>; deaths: number; deathBy: Record<string, number>; alive: number;
  threats: number; struck: number; shieldable: number; shielded: number; reactSum: number; reactN: number; nearSum: number; nearN: number;
};
export type Stats = { round: Stat; match: Stat; room: Stat };
const newStat = (): Stat => ({ gold: 0, dmg: 0, kills: 0, dmgBy: {}, fired: {}, landed: {}, deaths: 0, deathBy: {}, alive: 0, threats: 0, struck: 0, shieldable: 0, shielded: 0, reactSum: 0, reactN: 0, nearSum: 0, nearN: 0 }); // alive: segundos vivo
const newStats = (): Stats => ({ round: newStat(), match: newStat(), room: newStat() });
// salas gravadas antes de um campo existir (ex.: a precisão): sem isso a soma quebrava o passo inteiro e os efeitos daquele instante sumiam
const fillStats = (s?: Partial<Record<keyof Stats, Partial<Stat>>>): Stats => ({ round: { ...newStat(), ...s?.round }, match: { ...newStat(), ...s?.match }, room: { ...newStat(), ...s?.room } });
function addStat(p: Player, f: (s: Stat) => void) {
  f(p.stats.round);
  f(p.stats.match);
  f(p.stats.room);
}
// toda renda passa por aqui e é multiplicada pela economia da sala (scaled = false: o valor já vem na escala dela); devolve o ganho
function earn(m: Match, p: Player, gold: number, scaled = true): number {
  const n = scaled ? Math.round(gold * m.opts.economy) : gold;
  p.gold += n;
  addStat(p, (s) => (s.gold += n));
  return n;
}

// rounds: último vivo ganha a rodada; deathmatch: rodadas de 60 s, quem morre volta e cada abate vale 1 ponto;
// teams: 2 times, a rodada acaba quando só sobra um time e todos dele pontuam
export const MODES = ['rounds', 'deathmatch', 'teams'] as const;
export type Mode = (typeof MODES)[number];
export type Phase = 'lobby' | 'shop' | 'countdown' | 'playing' | 'roundEnd' | 'end';
// votação na partida: trocar o modo (target = modo novo), expulsar um humano (target = id dele),
// trocar o sorteio dos times (target = 'round' sorteados a cada rodada, 'match' fixos na partida),
// mudar uma opção da partida (target = 'chave:valor', ex.: 'shop:60', 'runes:false'; vale na próxima rodada),
// reiniciar, encerrar agora, pôr ou tirar um bot (na próxima rodada) e pular a loja (target vazio)
const VOTE_KINDS = ['mode', 'kick', 'shuffle', 'opt', 'restart', 'end', 'addBot', 'removeBot', 'skipShop'] as const;
export type Vote = { kind: (typeof VOTE_KINDS)[number]; target: string; by: string; yes: string[]; no: string[]; ends: number };

// opções da partida (pedido do Fernando, 18/10: "o jogo fluir com mais itens ou menos por rodada"), escolhidas na sala de espera
// por quem começa a partida: segundos de loja, ritmo da contagem e do fim de rodada, multiplicador de toda renda de ouro,
// ouro inicial (também multiplicado) e rodadas para vencer (no Deathmatch vira DM_GOALS abates)
export const OPTION_CHOICES = {
  shop: [30, 45, 60, 90, 120], // a loja ainda acaba antes quando todos clicam Pronto
  pace: ['short', 'normal', 'long'],
  economy: [0.6, 1, 1.6, 2.5],
  startGold: [30, 60, 100],
  goal: [3, 5, 7],
  // mecânicas que dá para desligar: runas, morte súbita e baús de ouro
  runes: [true, false],
  sudden: [true, false],
  chests: [true, false],
  // dificuldade dos bots (pedido do Fernando, 18/10); 'auto' ajusta cada bot pelo placar dos humanos
  difficulty: ['easy', 'normal', 'hard', 'auto'],
  // formato da arena (pedido do Fernando, 18/10): sorteado a cada rodada ou fixo
  arena: ['random', ...ARENA_IDS],
} as const;
export type MatchOpts = { [K in keyof typeof OPTION_CHOICES]: (typeof OPTION_CHOICES)[K][number] };
// os padrões são os números de sempre (SHOP_MS, START_GOLD, WINS_TO_WIN), para o simulador e as salas antigas
export const DEFAULT_OPTS: MatchOpts = { shop: 30, pace: 'normal', economy: 1, startGold: 30, goal: 5, runes: true, sudden: true, chests: true, difficulty: 'normal', arena: 'random' };
// 'chave:valor' de um voto de opção → [chave, valor] válidos, ou null
export function parseOpt(target: string): [keyof MatchOpts, MatchOpts[keyof MatchOpts]] | null {
  const [k, raw] = target.split(':');
  if (!(k in OPTION_CHOICES) || raw === undefined) return null;
  const val = (OPTION_CHOICES[k as keyof MatchOpts] as readonly (string | number | boolean)[]).find((c) => String(c) === raw);
  return val === undefined ? null : [k as keyof MatchOpts, val as MatchOpts[keyof MatchOpts]];
}
export const PACE = { short: 0.6, normal: 1, long: 1.6 }; // multiplica COUNTDOWN_MS e ROUND_END_MS
export const DM_GOALS = { 3: 10, 5: 15, 7: 25 }; // 15 = DM_KILLS_TO_WIN
export const goalOf = (m: Pick<Match, 'mode' | 'opts'>) => (m.mode === 'deathmatch' ? DM_GOALS[m.opts.goal] : m.opts.goal);
const startGold = (m: Match) => Math.round(m.opts.startGold * m.opts.economy);

export type Player = {
  id: string;
  name: string;
  bot: boolean;
  color: number; // 0..7
  character: CharacterId; // o da cabeça da aparência (retrato 2D)
  look: string; // aparência montada (7 dígitos, ver LOOK_PARTS)
  score: number; // rodadas vencidas (deathmatch: abates)
  gold: number;
  spells: Record<SpellId, number>;
  items: Record<ItemId, number>;
  stats: Stats;
  // compras feitas nesta loja (mais recente por último), para poder desfazer e trocar
  bought: { key: string; price: number }[];
  held: Record<string, number[]>; // rodada em que cada nível comprado (magia/item) entrou, para o valor de venda
  ready: boolean;
  connected: boolean;
  team: number | null; // modo Times: 0 = Azul, 1 = Vermelho
  setup?: BotSetup; // treino: magias, itens e jeito de jogar escolhidos para este bot
  difficulty?: MatchOpts['difficulty']; // bot: a dificuldade dele, escolhida na sala (sem ela, a da partida)
};

export type Match = {
  phase: Phase;
  mode: Mode;
  round: number;
  phaseEnds: number;
  players: Player[];
  world: World | null;
  winner: string | null;
  lastRoundWinner: string | null;
  emptyRounds: number; // rodadas seguidas sem vencedor
  steps: number;
  vote: Vote | null;
  dmgOn?: Record<string, Record<string, number>>; // dano de cada atacante em cada vítima desde que ela entrou viva (para a assistência)
  // sequências de abate: kills = abates sem morrer (atravessa as rodadas), multi = abates seguidos rápidos, at = w.t do último abate
  streaks?: Record<string, { kills: number; multi: number; at: number }>;
  pendingMode: Mode | null; // modo votado: vale quando a próxima rodada começar
  banned: string[]; // expulsos por votação não voltam a esta sala
  teamShuffle: boolean; // Times: sorteados a cada rodada (true) ou fixos na partida
  pendingShuffle: boolean | null; // sorteio votado: vale quando a próxima rodada começar
  winnerTeam: number | null; // Times fixos: o time campeão
  opts: MatchOpts;
  pendingOpts: Partial<MatchOpts>; // opções votadas: valem quando a próxima rodada começar
  botDelta: number; // bots votados para entrar (+) ou sair (−) quando a próxima rodada começar
};

export const newMatch = (): Match => ({
  phase: 'lobby', mode: 'rounds', round: 0, phaseEnds: 0, players: [], world: null, winner: null, lastRoundWinner: null, emptyRounds: 0, steps: 0, vote: null, pendingMode: null, banned: [],
  teamShuffle: true, pendingShuffle: null, winnerTeam: null, opts: { ...DEFAULT_OPTS }, pendingOpts: {}, botDelta: 0,
});

const player = (m: Match, id: string | null) => m.players.find((p) => p.id === id);

// o bot i+1 da partida recebe BOT_NAMES[i] (a sala mostra a lista nesta ordem)
export const BOT_NAMES = ['Gul’dan', 'Merlim', 'Morgana', 'Rasputin', 'Zatanna', 'Mandrake', 'Gandalfo'];

export function addPlayer(m: Match, id: string, name: string, bot = false): boolean {
  if (m.banned.includes(id)) return false;
  const known = player(m, id);
  if (known) {
    known.name = name;
    known.connected = true;
    return true;
  }
  if (m.players.length >= MAX_PLAYERS) return false;
  const used = new Set(m.players.map((p) => p.color));
  const color = [0, 1, 2, 3, 4, 5, 6, 7].find((c) => !used.has(c)) ?? 0;
  // bots ganham um personagem diferente cada um, na ordem da lista (sem sorteio, para os testes)
  const character = bot ? CHARACTERS[(m.players.length + 1) % CHARACTERS.length].id : 'mage';
  m.players.push({ id, name, bot, color, character, look: lookOf(character), score: 0, gold: startGold(m), spells: noSpells(), items: startItems(), stats: newStats(), bought: [], held: {}, ready: bot, connected: true, team: null });
  return true;
}

// no lobby e no fim sai da lista; no meio da partida o mago fica parado esperando a pessoa voltar
export function removePlayer(m: Match, id: string) {
  if (m.phase === 'lobby' || m.phase === 'end') m.players = m.players.filter((p) => p.id !== id);
  else {
    const p = player(m, id);
    if (p) p.connected = false;
  }
}

// opts: só as opções que mudam (sem elas fica o que a sala já tinha); setup[i]: configuração do bot i+1, só com uma pessoa
// na sala (ninguém dá magias aos bots numa partida com outras pessoas); a dificuldade de cada bot vale em qualquer sala
export function startMatch(m: Match, now: number, bots: number, mode: Mode = 'rounds', teamShuffle = true, rand: () => number = Math.random, opts: Partial<MatchOpts> = {}, setup: BotSetup[] = []): boolean {
  if (m.phase !== 'lobby' && m.phase !== 'end') return false;
  m.opts = { ...m.opts, ...opts };
  m.players = m.players.filter((p) => !p.bot && p.connected);
  const solo = m.players.length === 1;
  for (let i = 0; m.players.length < MAX_PLAYERS && i < bots; i++) {
    addPlayer(m, 'bot-' + (i + 1), BOT_NAMES[i % BOT_NAMES.length], true);
    const bot = m.players[m.players.length - 1];
    const { difficulty, ...rest } = setup[i] ?? {};
    if (difficulty) bot.difficulty = difficulty;
    // só a dificuldade não é treino (a rodada não sai marcada na telemetria)
    if (solo && setup[i] && (!difficulty || Object.keys(rest).length)) bot.setup = rest;
  }
  if (m.players.length < 2) return false;
  fresh(m, now, mode, teamShuffle, rand);
  return true;
}

// zera a partida e abre a loja da rodada 1 (começar, ou reiniciar por votação com os mesmos jogadores)
function fresh(m: Match, now: number, mode: Mode, teamShuffle: boolean, rand: () => number) {
  for (const p of m.players) {
    Object.assign(p, { score: 0, gold: startGold(m), spells: noSpells(), items: startItems() });
    p.held = {};
    p.stats.match = newStat();
    p.stats.round = newStat();
    p.team = null;
  }
  Object.assign(m, { streaks: {}, mode, round: 0, winner: null, lastRoundWinner: null, emptyRounds: 0, steps: 0, vote: null, pendingMode: null, teamShuffle, pendingShuffle: null, winnerTeam: null, pendingOpts: {}, botDelta: 0 });
  // já sorteia na loja para cada um ver o time; com sorteio a cada rodada, a contagem sorteia de novo
  if (mode === 'teams') shuffleTeams(m, rand);
  enterShop(m, now);
}

// loja aberta: na fase da loja ou, nas Rodadas e nos Times, para quem já caiu na rodada (sugestão do Reinaldo, 18/10: montar a build morto)
export function canShop(m: Match, id: string): boolean {
  if (m.phase === 'shop') return true;
  return m.phase === 'playing' && m.mode !== 'deathmatch' && m.world?.wizards.find((z) => z.id === id)?.alive === false;
}

// compra: confere a loja, o preço (null = no máximo), o ouro e o resto (can); cobra e anota para desfazer e vender
function pay(m: Match, id: string, key: string, price: (p: Player) => number | null, can = (_: Player) => true): Player | null {
  const p = player(m, id);
  if (!p || !canShop(m, id)) return null;
  const cost = price(p);
  if (cost === null || p.gold < cost || !can(p)) return null;
  p.gold -= cost;
  p.bought.push({ key, price: cost });
  (p.held[key] ??= []).push(m.round);
  return p;
}

export function buy(m: Match, id: string, spell: SpellId): boolean {
  const p = pay(m, id, 'spell:' + spell, (p) => priceOf(spell, p.spells[spell]), (p) => p.spells[spell] > 0 || spellCount(p.spells) < MAX_SPELLS);
  if (p) p.spells[spell]++;
  return !!p;
}

// troca de aparência em qualquer fase, até no meio da luta (pedido do Fernando, 19/10); o personagem vira o da cabeça
export function setLook(m: Match, id: string, look: string): boolean {
  const p = player(m, id);
  if (!p || p.look === look) return false;
  p.look = look;
  p.character = lookHead(look);
  return true;
}

export function buyItem(m: Match, id: string, item: ItemId): boolean {
  const p = pay(m, id, 'item:' + item, (p) => itemPrice(p.items, item));
  if (p) p.items[item]++;
  return !!p;
}

// desfaz a compra mais recente daquele tipo feita nesta loja: devolve o ouro e baixa o nível
export function undoBuy(m: Match, id: string, key: string): boolean {
  const p = player(m, id);
  if (!p || !canShop(m, id)) return false;
  const i = p.bought.map((b) => b.key).lastIndexOf(key);
  if (i < 0) return false;
  const [kind, what] = key.split(':');
  if (kind === 'spell') p.spells[what as SpellId]--;
  else if (kind === 'item') p.items[what as ItemId]--;
  p.gold += p.bought[i].price;
  p.bought.splice(i, 1);
  p.held[key]?.pop();
  return true;
}

// quanto volta ao vender a magia/item inteiro ('spell:<id>' ou 'item:<id>'): cada nível volta 100% na loja em que foi comprado
// e perde 5% por rodada que a pessoa ficou com ele, até 75%; o nível inicial grátis não se vende. Nível sem registro (sala antiga) conta desde a rodada 0
const sellRate = (rounds: number) => Math.max(SELL_FLOOR, 1 - SELL_DECAY * Math.max(0, rounds));
export function sellValue(p: { spells: Record<SpellId, number>; items: Record<ItemId, number>; held?: Record<string, number[]> }, round: number, key: string): number {
  const [kind, what] = key.split(':');
  const spell = kind === 'spell';
  if (!spell && kind !== 'item') return 0; // só magia e item se vendem
  if (!(spell ? (SPELL_IDS as readonly string[]) : (ITEM_IDS as readonly string[])).includes(what)) return 0;
  const now = spell ? p.spells[what as SpellId] : p.items[what as ItemId];
  const first = spell ? noSpells()[what as SpellId] : startItems()[what as ItemId];
  if (now <= first) return 0;
  const when = p.held?.[key] ?? [];
  let total = 0;
  for (let l = first; l < now; l++) {
    const price = (spell ? priceOf(what as SpellId, l) : ITEMS[what as ItemId].cost) ?? 0;
    const k = when.length - (now - l); // os níveis mais novos estão no fim da lista
    total += price * sellRate(round - (k >= 0 ? when[k] : 0));
  }
  return Math.floor(total + 1e-9);
}

// dá para vender: vale ouro, ou é a Bola de fogo (pedido do Fernando, 18/10: deixa de ser obrigatória; o nível 1 grátis vale 0,
// mas vender libera a vaga das magias e a tecla; comprar de volta custa o preço normal, 0 no nível 1)
export const canSell = (p: Parameters<typeof sellValue>[0], round: number, key: string) =>
  sellValue(p, round, key) > 0 || (key === 'spell:fireball' && p.spells.fireball > 0);

// vende a magia ou o item inteiro (magia vai a 0, item volta ao nível inicial); não é ganho de ouro, então fora das estatísticas
export function sell(m: Match, id: string, key: string): boolean {
  const p = player(m, id);
  if (!p || !canShop(m, id) || !canSell(p, m.round, key)) return false;
  const value = sellValue(p, m.round, key);
  const [kind, what] = key.split(':');
  if (kind === 'spell') p.spells[what as SpellId] = 0;
  else p.items[what as ItemId] = startItems()[what as ItemId];
  p.gold += value;
  p.bought = p.bought.filter((b) => b.key !== key);
  delete p.held[key];
  return true;
}

export function setReady(m: Match, id: string): boolean {
  const p = player(m, id);
  if (m.phase !== 'shop' || !p || p.ready) return false;
  p.ready = true;
  return true;
}

// a sala reiniciou (o mundo da rodada só vive na memória): repete a rodada a partir da loja
export function resume(m: Match, now: number) {
  // salas gravadas antes da escolha de personagem e do deathmatch existirem
  m.emptyRounds ??= 0;
  m.mode ??= 'rounds';
  m.banned ??= []; // salas gravadas antes da votação
  m.pendingMode ??= null;
  // salas gravadas antes do modo Times
  m.teamShuffle ??= true;
  m.pendingShuffle ??= null;
  m.winnerTeam ??= null;
  m.opts = { ...DEFAULT_OPTS, ...m.opts }; // salas gravadas antes das opções da partida e das votações novas
  m.pendingOpts ??= {};
  m.botDelta ??= 0;
  m.vote = null; // o prazo de uma votação gravada já passou
  for (const p of m.players) {
    p.character ??= 'mage';
    p.look ??= lookOf(p.character); // salas gravadas antes da aparência montada
    // salas gravadas antes das magias novas, ou com uma que saiu do jogo (os Gêmeos, 19/10): fica só o que existe
    p.spells = Object.fromEntries(SPELL_IDS.map((s) => [s, p.spells[s] ?? noSpells()[s]])) as Record<SpellId, number>;
    const plan = (p as { plan?: BotPlan }).plan;
    if (plan) plan.buys = plan.buys.filter((b) => b.kind === 'item' || isSpell(b.id));
    p.items = { ...noItems(), ...p.items }; // salas gravadas antes dos itens novos
    // salas gravadas com a maestria Roubo de vida: vira o item (sem passar do nível máximo)
    const old = (p as { masteries?: { lifesteal?: number } }).masteries?.lifesteal ?? 0;
    if (old && !p.items.vampire) p.items.vampire = Math.min(6, old);
    delete (p as { masteries?: unknown }).masteries;
    p.held ??= {}; // salas gravadas antes da venda por rodada
    p.team ??= null;
    p.stats = fillStats(p.stats);
  }
  if (m.phase === 'countdown' || m.phase === 'playing') {
    m.round--;
    enterShop(m, now);
  } else if (m.phase === 'roundEnd') afterRound(m, now);
}

// expulsa um bot ou alguém que caiu e não voltou (gente conectada não pode ser expulsa por outro)
export function kick(m: Match, id: string): boolean {
  const p = player(m, id);
  if (!p || (!p.bot && p.connected)) return false;
  drop(m, id);
  return true;
}

// tira da partida e mata o mago, se a rodada estiver rolando
function drop(m: Match, id: string) {
  m.players = m.players.filter((q) => q.id !== id);
  const wz = m.world?.wizards.find((z) => z.id === id);
  if (wz) {
    wz.alive = false;
    wz.hp = 0;
    wz.respawnAt = Infinity; // no deathmatch o expulso não volta
  }
}

export const VOTE_PHASES: Phase[] = ['shop', 'countdown', 'playing', 'roundEnd'];
// só humanos conectados votam; passa com mais da metade deles
const voters = (m: Match) => m.players.filter((p) => !p.bot && p.connected).map((p) => p.id);
export const votesNeeded = (humans: number) => Math.floor(humans / 2) + 1;

// abre uma votação (uma por vez, só com a partida rolando); quem abre já conta como SIM
export function startVote(m: Match, id: string, kind: Vote['kind'], target: string, now: number): boolean {
  if (m.vote || !VOTE_PHASES.includes(m.phase) || !voters(m).includes(id)) return false;
  if (kind === 'kick') {
    const t = player(m, target);
    if (!t || t.bot || t.id === id) return false; // bot já tem o ✕ direto
  } else if (kind === 'mode') {
    // qualquer um dos modos, menos o que já vale na próxima rodada
    if (!(MODES as readonly string[]).includes(target) || target === (m.pendingMode ?? m.mode)) return false;
  } else if (kind === 'shuffle') target = (m.pendingShuffle ?? m.teamShuffle) ? 'match' : 'round'; // alterna o que valeria na próxima rodada
  else if (kind === 'opt') {
    // uma opção, com valor diferente do que já vale na próxima rodada
    const o = parseOpt(target);
    if (!o || { ...m.opts, ...m.pendingOpts }[o[0]] === o[1]) return false;
  } else {
    if (kind === 'addBot' && m.players.length + Math.max(0, m.botDelta) >= MAX_PLAYERS) return false;
    if (kind === 'removeBot' && m.players.filter((p) => p.bot).length + m.botDelta <= 0) return false;
    if (kind === 'skipShop' && m.phase !== 'shop') return false;
    target = '';
  }
  m.vote = { kind, target, by: id, yes: [id], no: [], ends: now + VOTE_MS };
  settleVote(m, now);
  return true;
}

export function castBallot(m: Match, id: string, yes: boolean, now: number): boolean {
  const v = m.vote;
  if (!v || !voters(m).includes(id) || v.yes.includes(id) || v.no.includes(id)) return false;
  (yes ? v.yes : v.no).push(id);
  settleVote(m, now);
  return true;
}

// fecha a votação: passa com maioria; falha se os NÃO a tornam impossível, se o prazo acabou ou se a partida acabou
function settleVote(m: Match, now: number) {
  const v = m.vote;
  if (!v) return;
  const who = voters(m);
  const need = votesNeeded(who.length);
  const yes = v.yes.filter((id) => who.includes(id)).length;
  const no = v.no.filter((id) => who.includes(id)).length;
  if (!VOTE_PHASES.includes(m.phase) || now >= v.ends || who.length - no < need) m.vote = null;
  else if (yes >= need) {
    m.vote = null;
    // voltar ao que já vale agora só cancela o pendente
    if (v.kind === 'mode') m.pendingMode = v.target === m.mode ? null : (v.target as Mode);
    else if (v.kind === 'shuffle') m.pendingShuffle = (v.target === 'round') === m.teamShuffle ? null : v.target === 'round';
    else if (v.kind === 'opt') {
      const [k, val] = parseOpt(v.target)!;
      if (m.opts[k] === val) delete m.pendingOpts[k];
      else Object.assign(m.pendingOpts, { [k]: val });
    } else if (v.kind === 'restart') fresh(m, now, m.mode, m.teamShuffle, Math.random);
    else if (v.kind === 'end') {
      // vence quem tem mais pontos; empate no topo = ninguém
      const [best, top] = atTop(m.players, (p) => p.score);
      m.winner = best > 0 && top.length === 1 ? top[0].id : null;
      m.winnerTeam = m.mode === 'teams' && !m.teamShuffle && best > 0 && new Set(top.map((p) => p.team)).size === 1 ? top[0].team : null;
      m.phase = 'end';
      m.world = null;
    } else if (v.kind === 'addBot') m.botDelta++;
    else if (v.kind === 'removeBot') m.botDelta--;
    else if (v.kind === 'skipShop') m.phaseEnds = now; // a loja fecha no próximo passo
    else {
      drop(m, v.target);
      m.banned.push(v.target);
    }
  }
}

// sala esquecida aberta (ninguém joga há muito tempo): encerra a partida para o laço parar
export function endIdle(m: Match) {
  const best = Math.max(0, ...m.players.map((p) => p.score));
  m.winner = best > 0 ? (m.players.find((p) => p.score === best)?.id ?? null) : null;
  m.phase = 'end';
  m.world = null;
  m.vote = null;
}

export const shouldRun = (m: Match, humansConnected: number) => humansConnected > 0 && m.phase !== 'lobby' && m.phase !== 'end';

function enterShop(m: Match, now: number) {
  m.phase = 'shop';
  for (const p of m.players) p.bought = [];
  m.phaseEnds = now + m.opts.shop * 1000;
  m.world = null;
  for (const p of m.players) {
    p.ready = p.bot;
    // treino: bot configurado entra exatamente com as magias e itens pedidos, sem compra automática
    const s = p.setup;
    if (s?.spells || s?.items) Object.assign(p, { spells: { ...noSpells(), ...s.spells }, items: { ...startItems(), ...s.items } });
    else botShop(m, p);
  }
}

// o bot compra o que o plano dele pede enquanto o ouro der (botBuy roda mesmo para gente, como sempre rodou: gasta o sorteio)
function botShop(m: Match, p: Player) {
  for (let b = botBuy(p, Math.random, botSkill(m, p)); p.bot && b && (b.kind === 'spell' ? buy(m, p.id, b.id) : buyItem(m, p.id, b.id)); b = botBuy(p, Math.random, botSkill(m, p)));
}

// 2 times de tamanhos iguais (com número ímpar, um tem 1 a mais; qual deles também é sorteado)
function shuffleTeams(m: Match, rand: () => number) {
  const order = [...m.players];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const first = rand() < 0.5 ? 0 : 1;
  order.forEach((p, i) => (p.team = (i + first) % 2));
}

// força do bot pela dificuldade (a dele ou a da partida); no treino, o skill configurado vai por cima
export function botSkill(m: Match, bot: Player): BotSkill {
  const base = difficultySkill(m, bot);
  return bot.setup?.skill ? { ...base, ...bot.setup.skill } : base;
}

// Automático: humanos à frente deste bot no placar → bot mais forte; atrás → mais fraco (contínuo, em fração da meta)
function difficultySkill(m: Match, bot: Player): BotSkill {
  const d = bot.difficulty ?? m.opts.difficulty;
  if (d !== 'auto') return BOT_SKILL[d];
  const humans = m.players.filter((p) => !p.bot);
  if (!humans.length) return BOT_SKILL.normal;
  const avg = humans.reduce((s, p) => s + p.score, 0) / humans.length;
  return skillAt(Math.max(-1, Math.min(1, (avg - bot.score) / goalOf(m))));
}

const teamSize = (m: Match, t: number) => m.players.filter((p) => p.team === t).length;

function enterCountdown(m: Match, now: number, rand: () => number) {
  m.dmgOn = {};
  for (const s of Object.values(m.streaks ?? {})) s.at = -1e9; // o relógio do mundo volta a zero: abate rápido não atravessa rodadas
  // troca de modo votada: antes de criar o mundo (que depende do modo); os pontos zeram porque as metas são outras
  if (m.pendingMode) {
    m.mode = m.pendingMode;
    m.pendingMode = null;
    m.emptyRounds = 0;
    for (const p of m.players) p.score = 0;
  }
  if (m.pendingShuffle !== null) {
    m.teamShuffle = m.pendingShuffle;
    m.pendingShuffle = null;
  }
  m.opts = { ...m.opts, ...m.pendingOpts };
  m.pendingOpts = {};
  // bots votados (a fase ainda é a loja): o novo entra Normal, com o ouro inicial, e já compra; sai o último bot da lista
  for (; m.botDelta > 0; m.botDelta--) {
    const n = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => !m.players.some((p) => p.id === 'bot-' + k)) ?? 0;
    if (!n || !addPlayer(m, 'bot-' + n, BOT_NAMES[(n - 1) % BOT_NAMES.length], true)) break;
    m.players[m.players.length - 1].difficulty = 'normal';
    botShop(m, m.players[m.players.length - 1]);
  }
  for (; m.botDelta < 0; m.botDelta++) {
    const bot = m.players.filter((p) => p.bot).pop();
    if (bot) m.players = m.players.filter((p) => p !== bot);
  }
  m.botDelta = 0;
  if (m.mode === 'teams') {
    // a cada rodada: sorteia de novo; fixos: mantém, e quem entrou depois vai para o time menor
    if (m.teamShuffle || m.players.every((p) => p.team === null)) shuffleTeams(m, rand);
    for (const p of m.players) if (p.team === null) p.team = teamSize(m, 1) < teamSize(m, 0) ? 1 : 0;
    // um time inteiro saiu da sala: sorteia de novo, senão a rodada acabaria na hora
    if (new Set(m.players.map((p) => p.team)).size < 2) shuffleTeams(m, rand);
  }
  m.round++;
  for (const p of m.players) p.stats.round = newStat();
  const ids = m.players.map((p) => p.id);
  const teams = m.mode === 'teams' ? Object.fromEntries(m.players.map((p) => [p.id, p.team ?? 0])) : {};
  // arena fixa pela sala ou sorteada a cada rodada (o sorteio só gasta número aleatório quando é 'random')
  const arena = m.opts.arena === 'random' ? ARENA_IDS[Math.floor(rand() * ARENA_IDS.length)] : m.opts.arena;
  m.world = newWorld(ids, Object.fromEntries(m.players.map((p) => [p.id, p.spells])), Object.fromEntries(m.players.map((p) => [p.id, p.items])), PILLAR.min + Math.floor(rand() * (PILLAR.max - PILLAR.min + 1)), rand, m.mode === 'deathmatch', teams, { runes: m.opts.runes, sudden: m.opts.sudden, chests: m.opts.chests }, arena);
  m.phase = 'countdown';
  m.phaseEnds = now + COUNTDOWN_MS * PACE[m.opts.pace];
}

// ganho de ouro com o "+N" subindo em cima do mago: prêmios do fim da rodada (o mundo ainda existe até a loja), abate, assistência e monte de ouro
function bonus(m: Match, p: Player, gold: number, scaled = true) {
  if (gold <= 0) return;
  const n = earn(m, p, gold, scaled);
  const z = m.world?.wizards.find((q) => q.id === p.id);
  if (z) m.world!.events.push({ k: 'gold', id: p.id, n, x: z.pos.x, y: z.pos.y });
}

function endRound(m: Match, now: number, winner: string | null) {
  const dm = m.mode === 'deathmatch';
  const p = player(m, winner);
  // no deathmatch os pontos já vieram dos abates; aqui o vencedor é só quem fez mais abates na rodada
  const played = new Set(m.world?.wizards.map((z) => z.id));
  // nos Times, todos do time de quem venceu (vivos ou não) pontuam e ganham o ouro da vitória
  const teams = m.mode === 'teams';
  const inRound = m.players.filter((q) => played.has(q.id));
  const won = !p || dm ? [] : teams ? inRound.filter((q) => q.team === p.team) : [p];
  // quem já liderava sozinho o placar ganha menos pela vitória (freia a bola de neve); nos Times, à frente de todos os inimigos
  const leaders = won.filter((q) => q.score > 0 && m.players.every((o) => o === q || (teams && o.team === q.team) || o.score < q.score));
  for (const q of won) {
    q.score++;
    bonus(m, q, leaders.includes(q) ? LEADER_WIN_GOLD : WIN_GOLD);
  }
  // quem sobreviveu ficou vivo a rodada inteira
  for (const z of m.world?.wizards ?? []) {
    const q = player(m, z.id);
    if (q && z.alive && !dm) addStat(q, (s) => (s.alive += m.world!.t));
  }
  const top = Math.max(0, ...inRound.map((q) => q.stats.round.dmg));
  for (const q of inRound) if (top > 0 && q.stats.round.dmg === top) bonus(m, q, TOP_DMG_GOLD);
  for (const q of inRound) earn(m, q, ROUND_GOLD);
  // recuperação: quem ganhou menos ouro na partida que a média recebe metade da diferença
  const avg = inRound.reduce((sum, q) => sum + q.stats.match.gold, 0) / Math.max(1, inRound.length);
  // o ouro da partida já está na escala da economia: só o teto é multiplicado
  for (const q of inRound) bonus(m, q, Math.min(Math.round(RECOVERY.max * m.opts.economy), Math.floor((avg - q.stats.match.gold) * RECOVERY.share)), false);
  m.lastRoundWinner = winner;
  m.emptyRounds = winner || dm ? 0 : m.emptyRounds + 1;
  m.phase = 'roundEnd';
  m.phaseEnds = now + ROUND_END_MS * PACE[m.opts.pace];
}

// como no original: ganha quem vencer goalOf(m) rodadas primeiro (padrão WINS_TO_WIN)
function afterRound(m: Match, now: number) {
  if (m.mode === 'deathmatch') {
    // a meta só vale no fim da rodada (a rodada sempre dura os 60 s); empate no topo joga mais uma rodada
    const [best, top] = atTop(m.players, (p) => p.score);
    if (best < goalOf(m) || top.length > 1) return enterShop(m, now);
    m.phase = 'end';
    m.winner = top[0].id;
    m.world = null;
    return;
  }
  const champion = m.players.find((p) => p.score >= goalOf(m));
  // 3 rodadas seguidas sem ninguém sobrar: todo mundo parado, a partida acaba (e o laço da sala para)
  if (!champion && m.emptyRounds < EMPTY_ROUNDS_END) return enterShop(m, now);
  m.phase = 'end';
  m.winner = champion?.id ?? null;
  // com times fixos quem vence é o time; sorteados a cada rodada, cada um por si
  m.winnerTeam = m.mode === 'teams' && !m.teamShuffle ? (champion?.team ?? null) : null;
  m.world = null;
}

const EMPTY_ROUNDS_END = 3;

// o maior valor entre os jogadores e quem o tem
function atTop(players: Player[], f: (p: Player) => number): [number, Player[]] {
  const best = Math.max(...players.map(f));
  return [best, players.filter((p) => f(p) === best)];
}

// quem fez mais abates na rodada; empate ou zero abates = ninguém
function topKiller(m: Match): string | null {
  const [best, top] = atTop(m.players, (p) => p.stats.round.kills);
  return best > 0 && top.length === 1 ? top[0].id : null;
}

export function tickMatch(m: Match, now: number, cmds: Cmd[], rand: () => number = Math.random): SimEvent[] {
  const events = stepMatch(m, now, cmds, rand);
  settleVote(m, now); // prazo, quem caiu e o fim da partida também fecham a votação
  return events;
}

// jeito de jogar (só mede, sem sorteio: a partida segue igual): ameaça = projétil inimigo que vai passar perto em até 0,6 s (o mesmo
// critério dos bots, vendo tudo); reação = primeira defesa em até 1 s (magia de defesa ou andar para fora da linha do tiro);
// atingido = levou dano do dono do projétil em até 1 s. Chave 'projétil>vítima'; sai quando o projétil some
const DEFENSE: SpellId[] = ['shield', 'teleport', 'rush', 'windwalk', 'alteration', 'warpzone', 'rockpillar', 'illusion'];
type Threat = { at: number; p: Projectile; owner: string; reacted: boolean; struck: boolean };
const watched = new WeakMap<World, Map<string, Threat>>();
function watchStyle(m: Match, w: World, all: Cmd[]) {
  const open = watched.get(w) ?? watched.set(w, new Map()).get(w)!;
  // humano que caiu é jogado pelo bot até voltar: fica fora, para não misturar o jeito do bot no dele
  const self = (id: string) => [player(m, id)].find((p) => p && (p.bot || p.connected));
  for (const [key, th] of open) {
    if (!w.projectiles.includes(th.p)) open.delete(key); // o golpe deste passo ainda conta
    const id = key.slice(key.indexOf('>') + 1);
    const p = self(id);
    if (!p || w.t - th.at > 1) continue;
    // fora da linha do tiro (do meteoro: fora do raio)
    const out = (to: Vec) => th.p.kind === 'meteor' ? dist(to, th.p.pos) >= spellLevel('meteor', th.p.level).radius + WIZ_R
      : Math.abs((to.x - th.p.pos.x) * th.p.vel.y - (to.y - th.p.pos.y) * th.p.vel.x) / Math.max(1e-6, len(th.p.vel)) > WIZ_R + PROJ_R + 0.25;
    const cast = w.events.find((e) => e.k === 'cast' && e.id === id && DEFENSE.includes(e.spell));
    if (!th.reacted && (cast || all.some((c) => c.id === id && c.kind === 'move' && out(c.to)))) {
      th.reacted = true;
      addStat(p, (s) => {
        s.reactSum += w.t - th.at;
        s.reactN++;
        if (cast?.k === 'cast' && cast.spell === 'shield') s.shielded++;
      });
    }
    if (!th.struck && w.events.some((e) => e.k === 'hit' && e.id === id && e.by === th.owner && e.dmg > 0)) {
      th.struck = true;
      addStat(p, (s) => s.struck++);
    }
  }
  for (const z of w.wizards) {
    const p = z.alive ? self(z.id) : undefined;
    const hit = p && threatTo(w, z, () => true);
    if (!p || !hit || open.has(hit.p.id + '>' + z.id)) continue;
    open.set(hit.p.id + '>' + z.id, { at: w.t, p: hit.p, owner: hit.p.owner, reacted: false, struck: false });
    const ready = z.spells.shield > 0 && w.t >= z.cd.shield;
    addStat(p, (s) => {
      s.threats++;
      if (ready) s.shieldable++;
    });
  }
  // distância até o inimigo vivo mais perto, a cada 6 passos
  if (m.steps % 6) return;
  for (const z of w.wizards) {
    const p = z.alive ? self(z.id) : undefined;
    const d = Math.min(...w.wizards.filter((q) => q.alive && q !== z && (z.team === null || q.team !== z.team)).map((q) => dist(q.pos, z.pos)));
    if (p && d < Infinity) addStat(p, (s) => {
      s.nearSum += d;
      s.nearN++;
    });
  }
}

function stepMatch(m: Match, now: number, cmds: Cmd[], rand: () => number): SimEvent[] {
  if (m.phase === 'shop') {
    const humans = m.players.filter((p) => !p.bot && p.connected);
    if (now >= m.phaseEnds || humans.every((p) => p.ready)) enterCountdown(m, now, rand);
    return [];
  }
  if (m.phase === 'countdown') {
    if (now >= m.phaseEnds) {
      m.phase = 'playing';
      if (m.mode === 'deathmatch') m.phaseEnds = now + DM_ROUND_MS;
    }
    return [];
  }
  if (m.phase === 'roundEnd') {
    if (now >= m.phaseEnds) afterRound(m, now);
    return [];
  }
  if (m.phase !== 'playing' || !m.world) return [];

  const w = m.world;
  m.steps++;
  const all = [...cmds];
  // os bots enxergam a cada passo e pensam D.rate vezes por segundo; o placar serve para o Difícil caçar o líder
  botWatch(w);
  const scores = Object.fromEntries(m.players.map((p) => [p.id, p.score]));
  m.players.forEach((p, i) => {
    // quem caiu vira bot até voltar, como no original (gamesetup.lua: bot assume o desconectado)
    if (p.bot || !p.connected) {
      const D = botSkill(m, p);
      if (botThinks(m.steps, i, D)) all.push(...botCmds(w, p.id, rand, D, scores));
    }
  });
  // a rodada só acaba quando sobra 1: se os últimos morrerem no mesmo passo, vence quem tinha mais vida
  const before = w.wizards.filter((z) => z.alive).map((z) => ({ id: z.id, hp: z.hp }));
  stepWorld(w, all, rand);
  watchStyle(m, w, all);
  // metade da vida tirada pela lava vira dano de quem empurrou (fonte 'lava'): placar, top dano e assistência; antes das mortes
  for (const [by, on] of Object.entries(w.lavaCredit)) for (const [id, dmg] of Object.entries(on)) {
    const p = player(m, by);
    if (!p) continue;
    const mine = ((m.dmgOn ??= {})[id] ??= {});
    mine[by] = (mine[by] ?? 0) + dmg;
    addStat(p, (s) => {
      s.dmg += dmg;
      s.dmgBy.lava = (s.dmgBy.lava ?? 0) + dmg;
    });
  }
  for (const e of w.events) {
    // dano 0 (invulnerável ou fogo amigo) não entra no dano, no top dano nem na assistência
    if (e.k === 'hit' && e.by !== e.id && e.dmg > 0) {
      const on = ((m.dmgOn ??= {})[e.id] ??= {});
      on[e.by] = (on[e.by] ?? 0) + e.dmg;
      const p = player(m, e.by);
      if (p) addStat(p, (s) => {
        s.dmg += e.dmg;
        s.dmgBy[e.src] = (s.dmgBy[e.src] ?? 0) + e.dmg;
      });
    } else if (e.k === 'fire' || e.k === 'land') {
      const p = player(m, e.id);
      const bucket = e.k === 'fire' ? 'fired' : 'landed';
      if (p) addStat(p, (s) => (s[bucket][e.src] = (s[bucket][e.src] ?? 0) + 1));
    } else if (e.k === 'death') {
      // causa da morte e tempo vivo, para os dados de balanceamento
      const dead = player(m, e.id);
      if (dead) addStat(dead, (s) => {
        s.deaths++;
        s.deathBy[e.src] = (s.deathBy[e.src] ?? 0) + 1;
        if (!w.dm) s.alive += w.t; // no deathmatch volta e morre várias vezes: tempo vivo só nas rodadas
      });
      // assistência: quem mais bateu na vítima, sem ser quem matou, ganha um pouco de ouro
      const on = m.dmgOn?.[e.id] ?? {};
      const [helper, dmg] = Object.entries(on).filter(([id]) => id !== e.by && id !== e.id).sort((a, b) => b[1] - a[1])[0] ?? [];
      const hp = helper && dmg >= ASSIST_MIN_DMG ? player(m, helper) : undefined;
      if (hp) bonus(m, hp, ASSIST_GOLD);
      if (m.dmgOn) delete m.dmgOn[e.id];
      // sequências de abate: qualquer morte (até na lava) zera a de quem morreu
      const sk = (m.streaks ??= {});
      const broken = sk[e.id]?.kills ?? 0;
      if (sk[e.id]) sk[e.id].kills = 0;
      const killer = e.by && e.by !== e.id ? player(m, e.by) : undefined;
      if (killer) {
        const s = (sk[killer.id] ??= { kills: 0, multi: 0, at: -1e9 });
        s.multi = w.t - s.at <= STREAK.window ? s.multi + 1 : 1;
        s.at = w.t;
        s.kills++;
        // Quebra-combo primeiro: o cliente toca uma voz só por vez
        if (broken >= STREAK.breakAt) {
          w.events.push({ k: 'streak', id: killer.id, kind: 'breaker', n: broken, victim: e.id });
          bonus(m, killer, STREAK.breakGold);
        }
        if (s.multi >= 2) w.events.push({ k: 'streak', id: killer.id, kind: 'multi', n: s.multi });
        if (STREAK.spree.includes(s.kills)) w.events.push({ k: 'streak', id: killer.id, kind: 'spree', n: s.kills });
        // nas rodadas o abate não vale ponto (como no original), só ouro; no deathmatch vale 1 ponto
        addStat(killer, (s) => (s.kills += 1));
        if (m.mode === 'deathmatch') killer.score++;
        // cabeça do líder: abater quem lidera o placar vale mais, conforme a vantagem dele sobre a média
        const victim = player(m, e.id);
        const avgScore = m.players.reduce((sum, q) => sum + q.score, 0) / m.players.length;
        const top = Math.max(...m.players.map((q) => q.score));
        const head = victim && m.mode !== 'deathmatch' && victim.score === top ? Math.min(BOUNTY.max, Math.round(BOUNTY.perWin * (victim.score - avgScore))) : 0;
        bonus(m, killer, KILL_GOLD + Math.max(0, head));
      }
    }
    // a Égide quebra ao salvar (consumível): sai do inventário sem valor de venda
    if (e.k === 'aegis') {
      const p = player(m, e.id);
      if (p) {
        p.items.aegis = 0;
        delete p.held['item:aegis'];
      }
    }
    if (e.k === 'loot') {
      const p = player(m, e.id);
      if (p) bonus(m, p, 1);
    }
  }
  if (m.mode === 'deathmatch') {
    if (now >= m.phaseEnds) endRound(m, now, topKiller(m));
    return w.events;
  }
  const alive = w.wizards.filter((z) => z.alive);
  // Times: acaba quando só sobra gente de um time; o vencedor da rodada guardado é um vivo dele
  if (m.mode === 'teams' && alive.length > 0) {
    if (new Set(alive.map((z) => z.team)).size === 1) endRound(m, now, alive[0].id);
  } else if (alive.length === 1) endRound(m, now, alive[0].id);
  else if (alive.length === 0) endRound(m, now, before.sort((a, b) => b.hp - a.hp)[0]?.id ?? null);
  return w.events;
}
