import { inLavaAt, type ArenaId } from '../shared/arena.ts';
import { ARENA_MIN, HP_MAX, HP_REGEN, RUNE, SHRINK_EVERY, STUN_SPEED, SUDDEN, type RuneKind } from '../shared/constants.ts';
import { lookOf } from '../shared/characters.ts';
import type { BotSetup, PublicRoom, RoomInfo, ServerMsg, Snap } from '../shared/protocol.ts';
import type { BotSkill } from '../shared/bots.ts';
import { DEFAULT_OPTS } from '../shared/match.ts';
import type { SimEvent } from '../shared/sim.ts';
import { decodeSnap, type SnapView, type WizView } from '../shared/snapshot.ts';
import { ACTIVE_ITEMS, ITEM_CAST, SCOURGE, itemStats, type ItemId } from '../shared/items.ts';
import { CAST_POINT, SPELLS, SPELL_IDS, type SpellId } from '../shared/spells.ts';
import { add, dist, len, scale, type Vec } from '../shared/vec.ts';
import { CHALLENGES, endRun, runText, saveBest, scoreOf, stepRun, type Challenge, type Run } from './challenges.ts';
import { LOOK_EVENT, saveLook, savedLook } from './avatar.ts';
import { coachTip } from './coach.ts';
import { PROFILE_KEY, addRound, toSkill, type Profile } from './mimic.ts';
import { n1 } from './rules-text.ts';
import { reachOf } from './reach.ts';
import { ITEM_ICON, RUNE_ICON, SOURCE_ICON, icon } from './icons.ts';
import { createInput } from './input.ts';
import { t } from './i18n.ts';
import { isPadMode, labelOf, onFreeEsc } from './keys.ts';
import { openSettings } from './settings.ts';
import { rumble, startPad } from './gamepad.ts';
import { DELAY, REPLAY_MAX, createInterp, keepLast } from './interp.ts';
import { connect } from './net.ts';
import { createPredict } from './predict.ts';
import { createScene, type WizDraw } from './scene.ts';
import { createSound, type SoundKind } from './sound.ts';
import { store } from './store.ts';
import { hasBotSetup, savedBotSetup } from './train.ts';
import { TEAM_NAMES, TOUCH, askName, banner, createRoomUi, curtain, renderLobby, screen, srcName, toast } from './ui.ts';
import { endResult } from './screen-data.ts';
import { TAUNTS } from '../shared/taunts.ts';

// som de cada magia: as novas reaproveitam os sons que já existem
const SPELL_SOUND: Record<SpellId, SoundKind> = {
  fireball: 'fireball', lightning: 'lightning', homing: 'homing', shield: 'shield', teleport: 'teleport',
  swap: 'teleport', grip: 'lightning', meteor: 'fireball', rush: 'shield', cluster: 'fireball',
  boomerang: 'homing', thrust: 'teleport', gravity: 'homing', rockpillar: 'shield', bouncer: 'lightning',
  drain: 'homing', snowball: 'fireball', illusion: 'teleport', magnetize: 'lightning', recharge: 'homing',
  alteration: 'teleport', link: 'lightning', windwalk: 'shield', splitter: 'fireball', warpzone: 'shield',
};

// mensagens de erro do servidor (em português, protocolo inalterado) -> inglês
const SERVER_EN: Record<string, string> = {
  'Mensagem inválida.': 'Invalid message.',
  'Esta conexão já é de outro jogador.': 'This connection already belongs to another player.',
  'Envie hello primeiro.': 'Send hello first.',
  'Sala não encontrada.': 'Room not found.',
  'Sala aberta em outra aba.': 'Room open in another tab.',
  'Sala cheia.': 'Room full.',
  'Você foi removido da sala por votação.': 'You were removed from the room by vote.',
};

// treino escolhido na tela inicial ('train', 'shadow' ou o id do desafio): atravessa o recarregar da página ao entrar na sala nova
const AUTOSTART = 'warlock:autostart';
function takeAutostart(): string | null {
  try {
    const k = sessionStorage.getItem(AUTOSTART);
    sessionStorage.removeItem(AUTOSTART);
    return k;
  } catch {
    return null;
  }
}

// ?as=nome dá outra identidade na mesma máquina (testar com várias abas)
const as = new URLSearchParams(location.search).get('as')?.replace(/[^a-z0-9]/gi, '').slice(0, 12) ?? '';
const PID = 'warlock:pid' + (as && ':' + as);
const NAME = 'warlock:name' + (as && ':' + as);
const CHAR = 'warlock:char' + (as && ':' + as);
const playerId = store.get(PID) ?? crypto.randomUUID();
store.set(PID, playerId);

const ui = document.getElementById('ui')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
addEventListener('hashchange', () => location.reload());

// volumes guardados no navegador (0 a 1); quem tinha deixado mudo na versão antiga começa em zero
function loadVolumes() {
  const readVol = (k: string, fallback: number) => {
    const n = Number(store.get(k));
    return Number.isFinite(n) && store.get(k) !== null ? Math.max(0, Math.min(1, n)) : fallback;
  };
  const oldMute = store.get('warlock:mute') === '1';
  return { sfx: readVol('warlock:vol-sfx', oldMute ? 0 : 1), music: readVol('warlock:vol-music', oldMute || store.get('warlock:music') === '0' ? 0 : 0.7) };
}

// som curto ao passar o mouse num botão, no máximo 1 a cada 60 ms (o toque não tem hover; o clique tem som próprio)
function hoverSound(sound: ReturnType<typeof createSound>) {
  let at = 0;
  addEventListener('pointerover', (e) => {
    const b = (e.target as Element).closest?.('button:not(:disabled):not(.spell), .button'); // na barra de magias, no meio da luta, não
    if (e.pointerType !== 'mouse' || !b || b === (e.relatedTarget as Element | null)?.closest?.('button, .button') || performance.now() - at < 60) return;
    at = performance.now();
    sound.play('hover');
  });
}

async function main() {
  const name = store.get(NAME) || (await askName(ui, as));
  store.set(NAME, name);
  const id = location.hash.slice(1).toUpperCase();
  if (/^[A-Z]{4}$/.test(id)) startRoom(id, name);
  else startLobby(name);
  // Esc sem nada para cancelar ou fechar abre as configurações (pedido do Fernando, 18/10); por último, depois dos ouvintes da sala
  onFreeEsc(() => !document.querySelector('.overlay, .rules-overlay') && openSettings());
}

function startLobby(name: string) {
  document.body.className = 'in-lobby';
  curtain();
  // no lobby também: hover e clique dos botões (sem música nem lava, que só existem na partida)
  const sound = createSound(loadVolumes);
  hoverSound(sound);
  ui.addEventListener('click', (e) => (e.target as Element).closest('button, .button') && sound.play('click'));
  let rooms: RoomInfo[] | null = null;
  let offline = false;
  const draw = () =>
    renderLobby(ui, name, rooms, offline, () => create(), async () => {
      name = await askName(document.body, name);
      store.set(NAME, name);
      draw();
    }, create);
  // train: o treino que começa sozinho na sala nova (sem armazenamento, entra só na sala)
  async function create(train?: string) {
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { id } = await res.json();
      try {
        if (train) sessionStorage.setItem(AUTOSTART, train);
      } catch {
        // só a sala
      }
      location.hash = id;
    } catch {
      toast(t('Não deu para criar a sala. Tente de novo.', 'Couldn’t create the room. Try again.'));
    }
  }
  connect('/ws/lobby', (m) => {
    if (m.t !== 'rooms') return;
    rooms = m.rooms as RoomInfo[]; // a ordem e as vazias recolhidas ficam com renderLobby (screen-data.ts)
    draw();
  }, () => {}, (on) => {
    // sem a conexão da lista, o lobby mostra o erro em vez de "Carregando salas…" para sempre
    if (offline === !on) return;
    offline = !on;
    draw();
  });
  draw();
}

function startRoom(code: string, name: string) {
  let myName = name;
  document.body.className = 'in-room';
  curtain();
  const vol = loadVolumes();
  const sound = createSound(() => vol);
  hoverSound(sound);
  let room: PublicRoom | null = null;
  let me = playerId;
  let online = false;
  let armed: SpellId | ItemId | null = null;
  // círculo de alcance: tecla segurada, magia escolhida no botão (toque no chão para lançar) ou controle mirando
  let held: SpellId | ItemId | null = null;
  let padAiming: SpellId | ItemId | null = null;
  let hovered: SpellId | ItemId | null = null; // mouse em cima da magia na barra
  let seq = 0;
  const sentAt = new Map<number, number>();
  let lastSnap: Snap | null = null;
  // a latência só existe depois do primeiro comando confirmado (antes, predict.rtt() é um chute)
  let rttSeen = false;
  // modo treino (só para quem apertou o botão): dicas nas primeiras rodadas; playingAt marca o "Já!"
  let training = false;
  let trainSetup: BotSetup[] | undefined; // magias dos bots do último treino
  let shadow = false; // treino contra a sombra: o bot aparece como "Sombra" (só nesta tela)
  let seeInvis = true; // sandbox: "Ver invisíveis" do painel
  // desafio curto: pending espera a loja da rodada 0 (começo ou Repetir); run conta a tarefa; runRound = rodada em que ela acabou
  let pending: Challenge | null = null;
  let run: Run | null = null;
  let runRound = -1;
  let quitting = false; // Sair do desafio: o fim da partida que vem abre direto na sala, sem faixa nem som
  let arenaId: ArenaId = 'circle'; // formato da arena da rodada (vem na mensagem 'room')
  let playingAt = 0;
  const justCast = new Map<string, number>();
  let scourgeUntil = 0;
  let follow = true;
  // espectador: quem a câmera segue e o pedido de troca (+1 próximo, −1 anterior) do quadro seguinte
  let watchId: string | null = null;
  let watchStep = 0;
  // replay da queda (em qualquer partida): os últimos 6 s de estados e eventos; ao eu cair, vira o trecho que dá para rever
  let ring: { s: SnapView; e: SimEvent[] }[] = [];
  let clip: typeof ring = [];
  let fall: { by: string | null; src: string } = { by: null, src: 'lava' };
  let rp: { it: ReturnType<typeof createInterp>; at: number; next: number } | null = null;
  let canReplay = false;
  function toggleReplay() {
    if (rp || !canReplay) return void (rp = null);
    const it = createInterp(REPLAY_MAX);
    for (const f of clip) it.push(f.s, f.s.time); // relógio local = do servidor: sample(t + DELAY) devolve o instante t
    rp = { it, at: performance.now(), next: 0 };
  }
  // efeitos visuais Completo/Leve guardados no navegador; sem escolha, quem pede menos movimento ao sistema começa no Leve
  let fxLite = (store.get('warlock:fx') ?? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'lite' : 'full')) === 'lite';
  document.body.classList.toggle('fx-lite', fxLite);

  const view = createRoomUi(ui, code, {
    backToMenu: () => {
      curtain();
      location.hash = '';
    },
    start: (bots, mode, shuffle, opts, again) => {
      training = false; // partida normal depois de um treino: sem dicas
      run = pending = null;
      if (!again) {
        trainSetup = undefined; // o "Jogar de novo" repete as magias dos bots do treino; começar pela sala, não
        shadow = false;
      }
      // a dificuldade de cada bot vai sempre; as magias do treino só no "Jogar de novo"
      net.send({ t: 'start', bots: bots.length, mode, shuffle, opts, setup: bots.map((difficulty, i) => ({ ...trainSetup?.[i], difficulty })) });
    },
    buy: (spell) => net.send({ t: 'buy', spell }),
    buyItem: (item) => net.send({ t: 'buyItem', item }),
    kick: (target) => net.send({ t: 'kick', target }),
    vote: (kind, target) => net.send({ t: 'vote', kind, target }),
    ballot: (yes) => net.send({ t: 'ballot', yes }),
    undo: (key) => net.send({ t: 'undo', key }),
    sell: (key) => net.send({ t: 'sell', key }),
    taunt: (i) => net.send({ t: 'taunt', i }),
    useItem: (item) => input.button(item),
    // personagem pronto da sala: vira a aparência equivalente (o evento abaixo manda ao servidor)
    pick: (character) => {
      store.set(CHAR, character);
      saveLook(lookOf(character));
    },
    ready: () => net.send({ t: 'ready' }),
    sandbox: (cmd) => net.send({ t: 'sandbox', cmd }),
    seeInvis: (on) => (seeInvis = on),
    spell: (s) => input.button(s),
    hover: (a) => (hovered = a),
    volumes: () => vol,
    setVolume: (kind, value) => {
      vol[kind] = value;
      store.set(kind === 'sfx' ? 'warlock:vol-sfx' : 'warlock:vol-music', String(value));
      sound.refresh();
      if (kind === 'sfx') sound.play('click');
    },
    click: () => sound.play('click'),
    fxLite: () => fxLite,
    setFxLite: (lite) => {
      fxLite = lite;
      store.set('warlock:fx', lite ? 'lite' : 'full');
      document.body.classList.toggle('fx-lite', lite);
      scene.setFx(lite);
    },
    spellReady: () => sound.play('ready', 0.8),
    watch: (step) => (watchStep = step),
    replay: toggleReplay,
    name: () => myName,
    // o servidor atualiza o apelido de quem já está na sala quando o hello chega de novo (addPlayer)
    rename: async () => {
      myName = await askName(document.body, myName);
      store.set(NAME, myName);
      net.send({ t: 'hello', playerId, name: myName });
    },
  });
  addEventListener('keydown', (e) => {
    // ← → já trocam o período do placar quando ele está aberto (ui.ts marca o evento; por isso este ouvinte vem depois do createRoomUi)
    if (!watchId || e.defaultPrevented || (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight')) return;
    watchStep = e.code === 'ArrowLeft' ? -1 : 1;
    e.preventDefault();
  });
  // Esc sai do replay (sem abrir as configurações)
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !rp || e.defaultPrevented) return;
    rp = null;
    e.preventDefault();
  });
  const scene = createScene(canvas, document.getElementById('labels')!);
  scene.setFx(fxLite);
  const interp = createInterp();
  const predict = createPredict();

  const myWizard = (s: SnapView | null) => s?.wizards.find((w) => w.id === me) ?? null;

  function command(msg: { t: 'move'; x: number; y: number } | { t: 'stop' } | { t: 'cast'; spell: SpellId; x: number; y: number } | { t: 'item'; item: ItemId; x: number; y: number }) {
    seq++;
    sentAt.set(seq, performance.now());
    if (sentAt.size > 50) sentAt.delete(sentAt.keys().next().value!);
    net.send({ ...msg, seq });
  }

  const input = createInput(canvas, {
    pick: (x, y) => scene.pick(x, y),
    move(to) {
      command({ t: 'move', x: to.x, y: to.y });
      predict.move(to);
      scene.clickMarker(to, false);
    },
    stop() {
      command({ t: 'stop' });
      predict.stop();
    },
    cast(spell, at) {
      const i = SPELL_IDS.indexOf(spell);
      const mine = room?.players.find((p) => p.id === me);
      if (!mine?.spells[spell]) return toast(t('Você ainda não tem essa magia. Compre na loja.', 'You don’t have that spell yet. Buy it in the shop.'));
      if ((lastSnap?.cd[i] ?? 0) > 0.1 || performance.now() < (justCast.get(spell) ?? 0) || (performance.now() < scourgeUntil && spell !== 'teleport')) return;
      if (spell === 'teleport') scourgeUntil = 0; // o Teleporte cancela o Flagelo em preparo
      if (spell === 'rush') predict.stop(); // o avanço esquece o destino de andar, como no servidor
      // até a recarga chegar do servidor, não repete a mesma magia (senão a animação e o som tocam sem sair nada)
      justCast.set(spell, performance.now() + 120 + CAST_POINT[spell] * 1000 + predict.rtt() * 1000);
      command({ t: 'cast', spell, x: at.x, y: at.y });
      // conjurando, o mago fica parado e o clique de andar espera a magia sair (o servidor faz o mesmo)
      predict.hold(CAST_POINT[spell]);
      scene.castLocal(me, spell, at);
      scene.clickMarker(at, true);
      sound.play(SPELL_SOUND[spell]);
    },
    useItem(item, at) {
      const mine = room?.players.find((p) => p.id === me);
      if (!mine?.items[item]) return toast(t('Você ainda não tem esse item. Compre na loja.', 'You don’t have that item yet. Buy it in the shop.'));
      if ((lastSnap?.icd[ACTIVE_ITEMS.indexOf(item)] ?? 0) > 0.1 || performance.now() < (justCast.get(item) ?? 0) || performance.now() < scourgeUntil) return;
      // Flagelo em preparo: o servidor ignora outras magias até ele explodir
      if (item === 'scourge') scourgeUntil = performance.now() + SCOURGE.windup * 1000;
      justCast.set(item, performance.now() + 120 + (ITEM_CAST[item] ?? 0) * 1000 + predict.rtt() * 1000);
      command({ t: 'item', item, x: at.x, y: at.y });
      predict.hold(ITEM_CAST[item] ?? 0);
      scene.clickMarker(at, true);
    },
    center: () => {
      follow = true;
      scene.resetCamera();
    },
    zoom: (d) => scene.zoomBy(d),
    pan: (dx, dy) => scene.panBy(dx, dy),
    armedChanged: (s) => (armed = s),
    preview: (s) => (held = s),
    padRange: (s) => (padAiming = s),
    me: () => (myWizard(interp.latest())?.alive ? (drawn.get(me) ?? null) : null),
    aim: (at) => scene.aim(at),
  });

  // a aparência escolhida fica salva e é reenviada ao entrar em qualquer sala; trocada nas Configurações, vale na hora
  const net = connect('/ws/room/' + code, onMsg, () => {
    net.send({ t: 'hello', playerId, name: myName });
    net.send({ t: 'look', look: savedLook() });
  }, (on) => {
    online = on;
    view.setOnline(on);
  });
  addEventListener(LOOK_EVENT, (e) => net.send({ t: 'look', look: (e as CustomEvent<string>).detail }));
  // a sala conta a CPU entre mensagens; o "estou aqui" a cada 5 s mantém a conta zerada durante a partida
  setInterval(() => room && room.phase !== 'lobby' && room.phase !== 'end' && net.send({ t: 'alive' }), 5000);

  // treino: 3 bots, modo Rodadas, regras-padrão e dicas nas primeiras rodadas (com as magias dos bots escolhidas)
  function train(setup?: BotSetup[]) {
    training = true;
    run = pending = null;
    trainSetup = setup;
    shadow = false;
    net.send({ t: 'start', bots: 3, mode: 'rounds', shuffle: true, opts: DEFAULT_OPTS, ...(setup && { setup }) });
  }
  // sombra: 1 bot que joga como você; o que não foi medido fica no Normal (mimic.ts)
  function startShadow(skill: Partial<BotSkill>) {
    training = true;
    run = pending = null;
    trainSetup = [{ skill }];
    shadow = true;
    net.send({ t: 'start', bots: 1, mode: 'rounds', shuffle: true, opts: DEFAULT_OPTS, setup: trainSetup });
  }
  // treino escolhido na tela inicial: só sozinho e com a sala em espera (uma vez, na primeira mensagem que já tem você)
  let autostart = takeAutostart();
  function begin(r: PublicRoom) {
    const k = autostart;
    if (!k || !r.players.some((p) => p.id === me)) return;
    autostart = null;
    if (r.phase !== 'lobby' || r.players.some((p) => !p.bot && p.id !== me)) return;
    const c = CHALLENGES.find((x) => x.id === k);
    const skill = toSkill(store.json<Profile>(PROFILE_KEY));
    const cfg = savedBotSetup();
    if (c) startChallenge(c);
    else if (k === 'shadow' && skill) startShadow(skill);
    else if (k === 'train') train(hasBotSetup(cfg) ? cfg : undefined);
    else if (k === 'sandbox') startSandbox();
  }
  // sandbox: começa com você e um boneco parado; o resto vem pelo painel
  function startSandbox() {
    training = shadow = false;
    run = pending = null;
    trainSetup = undefined;
    net.send({ t: 'start', bots: 0, mode: 'rounds', shuffle: true, opts: DEFAULT_OPTS, sandbox: true });
    net.send({ t: 'sandbox', cmd: { op: 'bot', dummy: true } });
  }

  function startChallenge(c: Challenge) {
    training = shadow = false;
    run = null;
    pending = c;
    net.send({ t: 'start', bots: c.bots, mode: 'rounds', shuffle: true, opts: c.opts, setup: c.setup });
  }
  // Repetir: com a partida rolando, reinicia por votação (sozinho passa na hora) e a loja da rodada 0 recomeça o desafio
  function again() {
    if (!run || !room) return;
    if (room.phase === 'end') return startChallenge(run.c);
    pending = run.c;
    net.send({ t: 'vote', kind: 'restart' });
  }
  // Sair do desafio: encerra a partida pela votação "Encerrar agora" (sozinho passa na hora) e volta para a sala
  function quit() {
    run = pending = null;
    if (room?.phase === 'end') return view.toRoom();
    quitting = true;
    net.send({ t: 'vote', kind: 'end' });
  }
  // fim do desafio: faixa, som e recorde (uma vez só)
  function finishRun(next: Run) {
    const was = run;
    run = next;
    if (was?.state !== 'on' || next.state === 'on' || !room) return;
    runRound = room.round;
    const won = next.state === 'won';
    sound.play(won ? 'winRound' : 'loseRound');
    banner(won ? t(`Desafio ${next.c.name} cumprido!`, `Challenge ${next.c.name} complete!`) : t(`Desafio ${next.c.name}: não deu`, `Challenge ${next.c.name}: failed`), won ? 'win' : 'bad');
    const score = scoreOf(next);
    if (score !== null && saveBest(next.c.id, score, !!next.c.survive)) toast(t(`Recorde novo no ${next.c.name}: ${n1(score)} s`, `New record in ${next.c.name}: ${n1(score)} s`), 'good');
  }

  function names() {
    return new Map(room?.players.map((p) => [p.id, p.name]) ?? []);
  }

  const RUNE_NAME: Record<RuneKind, string> = { haste: t('Runa da Pressa', 'Haste Rune'), fury: t('Runa da Fúria', 'Fury Rune'), shield: t('Runa do Escudo', 'Shield Rune'), recharge: t('Runa da Recarga', 'Recharge Rune') };
  const RUNE_TEXT = (k: RuneKind) => [icon(RUNE_ICON[k]), ' ' + RUNE_NAME[k]];
  // o que cada runa faz, com os números do código (pedido do Fernando, 18/10: dizer ao pegar)
  const RUNE_EFFECT: Record<RuneKind, string> = {
    haste: t(`anda ${Math.round(RUNE.haste * 100)}% mais rápido por ${RUNE.secs} s`, `moves ${Math.round(RUNE.haste * 100)}% faster for ${RUNE.secs} s`),
    fury: t(`magias causam ${Math.round(RUNE.fury * 100)}% mais dano por ${RUNE.secs} s`, `spells deal ${Math.round(RUNE.fury * 100)}% more damage for ${RUNE.secs} s`),
    shield: t(`leva ${Math.round(RUNE.armor * 100)}% menos dano por ${RUNE.secs} s`, `takes ${Math.round(RUNE.armor * 100)}% less damage for ${RUNE.secs} s`),
    recharge: t(`recargas ${Math.round(RUNE.cdr * 100)}% mais rápidas por ${RUNE.secs} s`, `cooldowns ${Math.round(RUNE.cdr * 100)}% shorter for ${RUNE.secs} s`),
  };
  const MULTI_TEXT = ['', '', t('Abate duplo!', 'Double kill!'), t('Abate triplo!', 'Triple kill!'), t('Massacre!', 'Ultra kill!')];
  const SPREE_TEXT: Record<number, string> = { 3: t('Matança', 'Killing Spree'), 5: t('Fúria assassina', 'Rampage'), 7: t('sequência Imparável', 'Unstoppable streak'), 10: t('sequência Lendária', 'Legendary streak') };
  let live: Record<string, { dmg: number; kills: number; taken?: number }> = {};
  function onEvents(events: SimEvent[]) {
    const pos = myWizard(interp.latest())?.pos;
    const near = (x: number, y: number) => (pos ? Math.max(0.25, 1 - dist(pos, { x, y }) / 20) : 0.6);
    const who = names();
    let liveChanged = false;
    let shout = '';
    let voice: string | undefined;
    const notes: string[] = [];
    for (const e of events) {
      // dano e abates da rodada ao vivo na lista do canto
      if (e.k === 'hit' && e.by !== e.id && e.dmg > 0) {
        (live[e.by] ??= { dmg: 0, kills: 0 }).dmg += e.dmg;
        liveChanged = true;
      } else if (e.k === 'death' && e.by && e.by !== e.id) {
        (live[e.by] ??= { dmg: 0, kills: 0 }).kills++;
        liveChanged = true;
      }
      // dano levado por mim na rodada (sem a lava): a ficha mostra quanto o empurrão já cresceu
      if (e.k === 'hit' && e.id === me && e.dmg > 0) {
        const mine = (live[me] ??= { dmg: 0, kills: 0 });
        mine.taken = (mine.taken ?? 0) + e.dmg;
        liveChanged = true;
      }
      hitArrow(e, interp.latest());
      // controle: vibra ao levar golpe forte e ao morrer
      if (e.k === 'hit' && e.id === me && e.dmg >= 60) rumble(Math.min(1, e.dmg / 160), 200);
      else if (e.k === 'death' && e.id === me) rumble(1, 500);
      if (e.k === 'cast' && e.id !== me) {
        const w = interp.latest()?.wizards.find((z) => z.id === e.id);
        sound.play(SPELL_SOUND[e.spell], w ? near(w.pos.x, w.pos.y) : 0.5);
      } else if (e.k === 'hit') sound.play(e.dmg >= 100 ? 'hitHeavy' : e.dmg < 50 ? 'hitLight' : 'hit', near(e.x, e.y));
      else if (e.k === 'pillar') sound.play('hit', near(e.x, e.y) * 0.6);
      else if (e.k === 'grip') sound.play('hit', near(e.x, e.y));
      else if (e.k === 'reflect') sound.play('reflect', near(e.x, e.y));
      else if (e.k === 'teleport' && e.id === me) predict.teleported(e.to);
      else if (e.k === 'item') sound.play(e.item === 'redirector' ? 'teleport' : e.item === 'pact' ? 'shield' : 'homing', 0.7);
      else if (e.k === 'scourge') sound.play('death', near(e.x, e.y));
      else if (e.k === 'shrink') sound.play('shrink');
      else if (e.k === 'chest') toast(t('Baú de ouro na arena! Quebre e fique em cima do ouro', 'Gold chest in the arena! Break it and stand on the gold'), 'gold');
      else if (e.k === 'loot') sound.play('go', near(e.x, e.y));
      else if (e.k === 'sudden') {
        sound.play('shrink');
        banner([icon(SOURCE_ICON.lava), t(' Morte súbita! A arena encolhe a cada 5 s', ' Sudden death! The arena shrinks every 5 s')], 'bad');
      } else if (e.k === 'rune') toast([...RUNE_TEXT(e.kind), t(` apareceu na arena (${RUNE_EFFECT[e.kind]})`, ` appeared in the arena (${RUNE_EFFECT[e.kind]})`)], 'info');
      else if (e.k === 'runeTake') {
        sound.play('shield', e.id === me ? 1 : 0.5);
        toast([e.id === me ? t('Você pegou ', 'You picked up ') : (who.get(e.id) ?? '?') + t(' pegou ', ' picked up '), ...RUNE_TEXT(e.kind), `: ${RUNE_EFFECT[e.kind]}`], e.id === me ? 'good' : 'info');
      } else if (e.k === 'streak') {
        const name = e.id === me ? t('Você', 'You') : (who.get(e.id) ?? '?');
        // uma voz por lote de eventos: o Quebra-combo vem primeiro, depois o multi e por último a Matança
        const say = (file: string) => voice ??= file;
        if (e.kind === 'multi') {
          shout = `${name}: ${MULTI_TEXT[Math.min(e.n, 4)]}`;
          if (e.n >= 4) say('ultra_kill');
          else if (e.n === 3) say('multi_kill');
          else sound.play('go');
        } else if (e.kind === 'spree') {
          notes.push(t(`${name} está numa ${SPREE_TEXT[e.n] ?? 'sequência'} (${e.n} abates sem morrer)`, `${name} is on a ${SPREE_TEXT[e.n] ?? 'streak'} (${e.n} kills without dying)`));
          say('laugh');
        } else {
          notes.push(t(`${name} quebrou a sequência de ${e.victim === me ? 'você' : (who.get(e.victim ?? '') ?? '?')} (Quebra-combo: ouro extra)`, `${name} broke ${e.victim === me ? 'your' : (who.get(e.victim ?? '') ?? '?') + '’s'} streak (Combo breaker: extra gold)`));
          say('combo_breaker');
        }
      } else if (e.k === 'aegis') {
        sound.play('shield');
        banner([icon(ITEM_ICON.aegis), e.id === me ? t(' A Égide te tirou da lava e quebrou', ' The Aegis pulled you out of the lava and broke') : t(` A Égide tirou ${who.get(e.id) ?? '?'} da lava`, ` The Aegis pulled ${who.get(e.id) ?? '?'} out of the lava`)], e.id === me ? 'good' : '');
      }
      else if (e.k === 'death') {
        // fora da pedra: mergulho na lava (chiado e bolhas) em vez da explosão
        const snap = interp.latest();
        const w = snap?.wizards.find((z) => z.id === e.id);
        sound.play(w && snap && inLavaAt(arenaId, snap.arenaR, snap.isles, w.pos, 0.3) ? 'splash' : 'death', w ? near(w.pos.x, w.pos.y) : 1);
        const dead = who.get(e.id) ?? '?';
        if (e.id === me) {
          clip = ring.slice();
          fall = { by: e.by, src: e.src };
        }
        // todo abate vai para o feed do canto; a faixa grande fica só para o que envolve você
        view.kill(e.by, e.id, e.src);
        if (e.by === me && e.id !== me) banner(t(`Você derrubou ${dead}!`, `You took down ${dead}!`), 'good');
        else if (e.id === me) banner(e.by && e.by !== me ? t(`${who.get(e.by)} te derrubou!`, `${who.get(e.by)} took you down!`) : t('Você caiu na lava!', 'You fell into the lava!'), 'bad');
      }
    }
    if (shout) banner(shout, 'good');
    if (notes.length) toast(notes.join(' · '));
    if (voice) void sound.taunt(voice);
    if (liveChanged) view.live(live);
    if (run?.state === 'on' && room?.phase === 'playing') finishRun(stepRun(run, 0, events, me, true));
    if (!rp) scene.onEvents(events); // durante o replay a cena mostra os efeitos do trecho gravado
  }

  // golpe recebido: seta na borda da tela do lado de quem bateu (a câmera não gira, então o ângulo do chão vale na tela)
  function hitArrow(e: SimEvent, s: SnapView | null) {
    if (e.k !== 'hit' || e.id !== me || e.dmg <= 0 || e.by === me) return;
    const from = s?.wizards.find((z) => z.id === e.by)?.pos;
    if (from && dist(from, { x: e.x, y: e.y }) > 0.5) view.hitFrom(Math.atan2(from.y - e.y, from.x - e.x));
  }

  let lastPhase = '';
  function onMsg(m: ServerMsg) {
    if (m.t === 'error') {
      if (m.code === 'not_found') return screen(ui, t('Sala não encontrada', 'Room not found'), t('Ela pode ter fechado por ficar vazia.', 'It may have closed for being empty.'), t('Ver salas', 'View rooms'), () => (location.hash = ''));
      // sem parar a conexão, ela se reconectaria sozinha e derrubaria a outra aba, num vaivém sem fim
      if (m.code === 'other_tab' || m.code === 'full' || m.code === 'kicked') net.stop();
      if (m.code === 'kicked') return screen(ui, t('Você foi removido da sala por votação', 'You were removed from the room by vote'), t('Não dá para voltar a esta sala. Entre em outra ou crie uma.', 'You can’t return to this room. Join another or create one.'), t('Ver salas', 'View rooms'), () => (location.hash = ''));
      if (m.code === 'other_tab') return screen(ui, t('Sala aberta em outra aba', 'Room open in another tab'), t('Continue por lá ou recarregue esta.', 'Continue there or reload this one.'), t('Recarregar', 'Reload'), () => location.reload());
      if (m.code === 'full') return screen(ui, t('Sala cheia', 'Room full'), t('Já tem 8 magos nesta sala.', 'There are already 8 wizards in this room.'), t('Ver salas', 'View rooms'), () => (location.hash = ''));
      sound.play('error');
      return toast(t(m.msg, SERVER_EN[m.msg] ?? m.msg), 'bad');
    }
    if (m.t === 'room') {
      const prev = room;
      if (shadow && m.room.players.filter((p) => p.bot).length === 1 && m.room.players.filter((p) => !p.bot).length === 1) for (const p of m.room.players) if (p.bot) p.name = t('Sombra', 'Shadow'); // só no duelo contra a sombra
      room = m.room;
      me = m.you;
      arenaId = room.arena ?? arenaId; // na loja não há rodada: fica a última arena
      view.update(room, me, online);
      begin(room);
      // compra na loja: o ouro caiu → som de moedas
      if (prev?.phase === 'shop' && room.phase === 'shop') {
        const was = prev.players.find((p) => p.id === me)?.gold, now = room.players.find((p) => p.id === me)?.gold;
        if (was !== undefined && now !== undefined && now < was) sound.play('buy');
      }
      scene.preload(room.players.map((p) => p.look));
      if (room.phase !== lastPhase) onPhase(prev);
      lastPhase = room.phase;
      // desafio: na loja da rodada 0 compra o que ele pede e já fica Pronto (os bots já estão, a loja fecha na hora)
      if (pending && room.phase === 'shop' && room.round === 0) {
        run = { c: pending, n: 0, t: 0, state: 'on' };
        for (const spell of pending.buy ?? []) net.send({ t: 'buy', spell });
        net.send({ t: 'ready' });
        pending = null;
      }
      return;
    }
    if (m.t === 'taunt') {
      const taunt = TAUNTS[m.i];
      if (!taunt) return;
      const text = t(taunt.text, taunt.en);
      void sound.taunt(taunt.id);
      if (!scene.bubble(m.id, text)) toast(`${room?.players.find((p) => p.id === m.id)?.name ?? '?'}: ${text}`);
      return;
    }
    lastSnap = m;
    predict.setSpeed(m.sp);
    const acked = sentAt.get(m.ack);
    if (acked !== undefined) {
      predict.setRtt(performance.now() - acked);
      rttSeen = true;
      sentAt.delete(m.ack);
    }
    if (!room) return;
    const sv = decodeSnap(m, room.ids);
    interp.push(sv, performance.now() / 1000);
    keepLast(ring, { s: sv, e: m.e ?? [] }, REPLAY_MAX); // antes do onEvents: o estado da queda entra no trecho
    if (m.e) onEvents(m.e);
  }

  function onPhase(prev: PublicRoom | null) {
    if (!room) return;
    rp = null; // troca de fase encerra o replay
    const left = quitting;
    quitting = false;
    // desafio: a rodada acabou antes da meta (a queda que decide o Duelo pode chegar depois do fim da rodada)
    if (run && prev?.phase === 'playing') finishRun(endRun(run, room.lastRoundWinner === me));
    // a sombra aprende com as rodadas jogadas fora dos desafios (alive > 0: fora o deathmatch, que não conta o tempo vivo)
    const mine = room.players.find((p) => p.id === me)?.stats.round;
    if (room.phase === 'roundEnd' && prev?.phase === 'playing' && !run && !pending && !room.sandbox && mine && mine.alive > 0) store.set(PROFILE_KEY, JSON.stringify(addRound(store.json<Profile>(PROFILE_KEY), mine, rttSeen ? predict.rtt() : 0)));
    // cortina ao entrar na partida ou voltar para a sala (sala e fim são telas de menu; o resto é a arena)
    const menu = (p: string) => p === 'lobby' || p === 'end';
    if (prev && menu(prev.phase) !== menu(room.phase)) curtain();
    // na contagem o servidor ainda não aceita comandos: liberar só quando a rodada começa
    input.setEnabled(room.phase === 'playing');
    sound.setAmbience(room.phase !== 'lobby' && room.phase !== 'end');
    sound.duck(room.phase === 'shop');
    if (room.phase === 'countdown') {
      live = {};
      view.live(live);
      interp.reset();
      predict.reset();
      ring = [];
      clip = [];
      follow = true;
      watchId = null;
      // modo Times: avisa em que time a pessoa está nesta rodada
      const team = room.mode === 'teams' ? room.players.find((p) => p.id === me)?.team : null;
      banner(team != null ? t(`Rodada ${room.round} · Você está no time ${TEAM_NAMES[team]}`, `Round ${room.round} · You are on the ${TEAM_NAMES[team]} team`) : t(`Rodada ${room.round}`, `Round ${room.round}`));
      [3, 2, 1].forEach((_, i) => setTimeout(() => sound.play('beep'), i * 1000));
    } else if (room.phase === 'playing') {
      playingAt = performance.now();
      banner(t('Já!', 'Go!'), 'good');
      sound.play('go');
    } else if (room.phase === 'roundEnd' && !(run && runRound === room.round)) { // a rodada em que o desafio acabou fica com a faixa dele
      const w = room.players.find((p) => p.id === room!.lastRoundWinner);
      const myTeam = room.players.find((p) => p.id === me)?.team;
      // vencedor (ou o time dele) vê a faixa VITÓRIA com confete e ouve o arpejo; quem jogou e perdeu ouve o arpejo descendo
      const won = !!w && (room.mode === 'teams' && w.team !== null ? w.team === myTeam : w.id === me);
      if (w && room.players.some((p) => p.id === me)) sound.play(won ? 'winRound' : 'loseRound');
      if (won) banner(room.mode === 'teams' && w!.team !== null ? t(`Vitória do time ${TEAM_NAMES[w!.team]}!`, `${TEAM_NAMES[w!.team]} team wins!`) : room.mode === 'deathmatch' ? t('Vitória! Mais abates', 'Victory! Most kills') : t('Vitória!', 'Victory!'), 'win');
      else if (room.mode === 'teams' && w && w.team !== null) banner(t(`Time ${TEAM_NAMES[w.team]} venceu a rodada!`, `${TEAM_NAMES[w.team]} team won the round!`));
      else banner(!w ? (room.mode === 'deathmatch' ? t('Fim da rodada', 'Round over') : t('Ninguém sobrou!', 'Nobody is left!')) : room.mode === 'deathmatch' ? (w.id === me ? t('Você fez mais abates!', 'You got the most kills!') : t(`${w.name} fez mais abates!`, `${w.name} got the most kills!`)) : w.id === me ? t('Você venceu a rodada!', 'You won the round!') : t(`${w.name} venceu a rodada!`, `${w.name} won the round!`), w?.id === me ? 'good' : '');
    } else if (room.phase === 'end' && left) view.toRoom();
    else if (room.phase === 'end' && prev) {
      // mesmo resultado do cabeçalho do cartão (Vitória, Derrota ou Fim de jogo); quem só assistia não ouve nada
      const res = endResult(room, me);
      if (res !== 'none') sound.play(res === 'win' ? 'winRound' : 'loseRound');
      // o cartão do fim já mostra o vencedor e o pódio: a faixa grande só para quem venceu (antes cobria o pódio)
      if (res === 'win') banner(t('Vitória na partida!', 'Match victory!'), 'win');
    }
  }

  let lastFrame = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
    lastFrame = nowMs;
    const s = interp.sample(nowMs / 1000);
    const latest = interp.latest();
    const playing = room && (room.phase === 'countdown' || room.phase === 'playing' || room.phase === 'roundEnd');
    const wizards = playing && s ? wizardsOf(s, true, dt) : [];
    const myPos = wizards.find((w) => w.id === me)?.pos ?? null;
    // perigo: vida abaixo de 25% e pé na lava (mesma regra da simulação: fora do raio da arena)
    const meW = room?.phase === 'playing' ? myWizard(latest) : null;
    const meP = room?.players.find((p) => p.id === me);
    const meMax = HP_MAX + (meP ? itemStats(meP.items).hp : 0);
    const low = !!meW?.alive && !!meP && meW.hp < 0.25 * meMax;
    const lava = !!meW?.alive && !!latest && inLavaAt(arenaId, latest.arenaR, latest.isles, meW.pos);
    view.danger(low, lava);
    const shrinkIn = s && room?.phase === 'playing' && room.mode !== 'deathmatch' && (!room.sandbox || room.sandbox.shrink) ? s.shrinkAt - s.time : null;
    // espectador: morto na rodada (ou só assistindo), a câmera segue o vivo com mais vida; ← → ou os botões trocam
    const alive = room?.phase === 'playing' && s && !meW?.alive ? wizards.filter((w) => w.alive && w.id !== me && !(w.status & 2048)) : [];
    let watched = alive.find((w) => w.id === watchId);
    if (!watched && alive.length) watched = alive.reduce((a, w) => (w.hp > a.hp ? w : a));
    if (watchStep && watched) watched = alive[(alive.indexOf(watched) + watchStep + alive.length) % alive.length];
    watchStep = 0;
    watchId = watched?.id ?? null;
    view.watching(watched?.name ?? null);
    view.deadShopping(room?.phase === 'playing' && room.mode !== 'deathmatch' && !!meP && !!meW && !meW.alive);
    // replay da queda: só caído na rodada ou no fim dela; acaba no fim do trecho (segura 1 s na queda) ou ao voltar vivo no Deathmatch
    canReplay = clip.length > 1 && (room?.phase === 'roundEnd' || (room?.phase === 'playing' && !meW?.alive));
    const rt = rp ? clip[0].s.time + (nowMs - rp.at) / 1000 : 0;
    if (rp && (!canReplay || rt > clip[clip.length - 1].s.time + 1)) rp = null;
    const rs = rp ? rp.it.sample(rt + DELAY) : null;
    document.body.classList.toggle('replaying', !!rs); // a loja de quem caiu sai da frente enquanto o replay passa
    if (rp && rs) for (; rp.next < clip.length && clip[rp.next].s.time <= rt; rp.next++) replayEvents(clip[rp.next].e, rs);
    const killer = rs && fall.by && fall.by !== me ? fall.by : null;
    view.replay(canReplay && !rp, rs ? (killer ? t(`Replay · ${names().get(killer) ?? '?'} te derrubou com ${srcName(fall.src)}`, `Replay · ${names().get(killer) ?? '?'} took you down with ${srcName(fall.src)}`) : t('Replay · Você caiu na lava sozinho', 'Replay · You fell into the lava on your own')) : null);
    const shown = rs ?? (playing ? s : null);
    const drawWiz = rs ? wizardsOf(rs, false, dt) : wizards;
    // replay: câmera travada no meio entre mim e quem me derrubou
    const rMe = rs ? drawWiz.find((w) => w.id === me)?.pos : undefined;
    const rBy = killer ? drawWiz.find((w) => w.id === killer)?.pos : undefined;
    // Ilusão: a cópia usa o visual do dono, mas tem identidade visual própria: sempre visível e sólida.
    const copies: WizDraw[] = (shown ? shown.projectiles : []).flatMap((q) => {
      const ownerId = q.kind === 'illusion' ? room?.ids[q.vel.x] : undefined;
      const o = drawWiz.find((d) => d.id === ownerId);
      return o ? [{ ...o, id: ownerId + '~ilusao', pos: q.pos, facing: q.vel.y, status: o.status & ~(1024 | 2048 | 8388608), moving: true, cheer: false, illusion: true, ghost: false }] : [];
    });
    // o desafio conta o tempo só com a rodada rolando; o progresso dele fica no lugar da dica do treino
    if (run?.state === 'on' && room?.phase === 'playing') finishRun(stepRun(run, dt, [], me, meW?.alive !== false));
    if (run) view.coach(runText(run), run.state === 'on' ? undefined : again, quit);
    else if (training && room) view.coach(meP ? coachTip({ phase: room.phase, round: room.round, playingFor: (nowMs - playingAt) / 1000, shrinkIn, low, lava, alive: !!meW?.alive, touch: TOUCH, fireKey: isPadMode() ? 'A' : labelOf('fireball'), fire: meP.spells.fireball > 0 }) : null);
    else view.coach(null);
    scene.render({
      arena: arenaId,
      arenaR: (rs ?? s)?.arenaR ?? 11,
      shrinkIn: shrinkIn ?? SHRINK_EVERY,
      wizards: [...drawWiz, ...copies],
      projectiles: shown ? shown.projectiles : [],
      pillars: shown ? shown.pillars : [],
      loots: shown ? shown.loots : [],
      runes: shown ? shown.runes : [],
      zones: shown ? shown.zones : [],
      isles: shown ? shown.isles : [],
      follow: rs ? (rMe && rBy ? scale(add(rMe, rBy), 0.5) : (rMe ?? rBy ?? null)) : watched ? watched.pos : follow ? myPos : null,
      lock: !!rs || !!watched,
    });
    // círculo de alcance em volta do próprio mago (some ao lançar ou cancelar)
    const showing = room?.phase === 'playing' && meW?.alive && myPos ? (held ?? armed ?? padAiming ?? hovered) : null;
    scene.range(showing && myPos ? myPos : null, showing && meP ? reachOf(showing, meP.spells, meP.items) : 0);
    const respawnIn = room?.phase === 'playing' ? (lastSnap?.rs?.[room.ids.indexOf(me)] ?? 0) : 0;
    // no tamanho mínimo a arena para de encolher e o aviso some; depois do colapso ela volta a encolher até sumir
    view.frame(lastSnap?.cd ?? [], lastSnap?.icd ?? [], armed, s && (s.arenaR > ARENA_MIN + 0.01 || s.time >= SUDDEN.collapse) ? shrinkIn : null, respawnIn, myWizard(latest)?.status ?? 0, rttSeen ? predict.rtt() * 1000 : null, meW?.alive && meP ? { now: meW.hp, max: meMax } : null,
      wizards.filter((w) => !w.alive).map((w) => w.id).join()); // caídos na rodada: retrato apagado no topo
  }
  const drawn = new Map<string, Vec>();
  const replayDrawn = new Map<string, Vec>();
  // magos para desenhar: ao vivo o meu vem da previsão; no replay, todos do trecho gravado (cada um com seu mapa de posições anteriores)
  function wizardsOf(s: SnapView, live: boolean, dt: number): WizDraw[] {
    const byId = new Map(room?.players.map((p) => [p.id, p]) ?? []);
    // modo Times: cor do time no anel e na barra; no fim da rodada o time vencedor inteiro comemora
    const teams = room?.mode === 'teams';
    const winTeam = teams ? byId.get(room!.lastRoundWinner ?? '')?.team : null;
    const server = live && room?.phase === 'playing' ? myWizard(interp.latest()) : null;
    const prev = live ? drawn : replayDrawn;
    return s.wizards.map((w) => {
      const p = byId.get(w.id);
      // o meu véu usa o estado mais recente do servidor, sem atraso da interpolação; andar não pode fazê-lo piscar
      const visibilityBits = 1024 | 2048 | 8388608;
      const status = w.id === me && server ? (w.status & ~visibilityBits) | (server.status & visibilityBits) : seen(w);
      const pos = w.id === me && server ? predict.frame(server, dt) : w.pos;
      const prevDraw = prev.get(w.id);
      const moving = len(w.vel) < STUN_SPEED && w.alive && (!prevDraw || dist(prevDraw, pos) > 0.004);
      prev.set(w.id, pos);
      return { ...w, status, pos, hpMax: HP_MAX + (p ? itemStats(p.items).hp : 0), regen: HP_REGEN + (p ? itemStats(p.items).regen : 0), bot: p?.bot ? (p.difficulty ?? room?.opts.difficulty) : null, color: p?.color ?? 0, character: p?.character ?? 'mage', look: p?.look, name: p?.name ?? '?', shieldR: p?.spells.shield ? SPELLS.shield.levels[p.spells.shield - 1].radius : 0, loot: live ? (lastSnap?.lp?.[room?.ids.indexOf(w.id) ?? -1] ?? 0) : 0, moving, cheer: live && room?.phase === 'roundEnd' && (room.lastRoundWinner === w.id || (teams && p?.team != null && p.team === winTeam)), team: teams ? p?.team : null };
    });
  }
  // sandbox: o servidor manda todos visíveis; "Ver invisíveis" deixa os outros na Caminhada no vento ou no véu da Ilusão
  // meio transparentes (o bit do véu); desligado, esconde como numa sala normal
  function seen(w: WizView): number {
    const s = w.status;
    if (!room?.sandbox || w.id === me) return s;
    if (seeInvis) return s & (1024 | 8388608) ? s | 8388608 : s;
    return (s & 1024 ? (s & ~1024) | 2048 : s) & ~8388608;
  }
  // eventos do replay: só a cena (clarão, explosão) e a seta do golpe que eu levei
  function replayEvents(events: SimEvent[], rs: SnapView) {
    scene.onEvents(events);
    for (const e of events) hitArrow(e, rs);
  }
  void scene.ready.then(() => requestAnimationFrame(frame), () => toast(t('Não deu para carregar o mago. Recarregue a página.', 'Couldn’t load the wizard. Reload the page.')));
}

startPad(toast);
void main();
