// Telas em DOM: apelido, lista de salas, sala de espera, loja, barra de magias, placar e avisos.
import { avatarPanel } from './avatar.ts';
import { ASSIST_GOLD, BOUNTY, CHEST, HP_MAX, KNOCK_HP_SCALE, KILL_GOLD, STREAK, LEADER_WIN_GOLD, RECOVERY, MAX_PLAYERS, ROUND_GOLD, RUNE_KINDS, TOP_DMG_GOLD, WIN_GOLD } from '../shared/constants.ts';
import { ARENA_IDS, type ArenaId } from '../shared/arena.ts';
import { type CharacterId } from '../shared/characters.ts';
import { BOT_NAMES, DEFAULT_OPTS, DM_GOALS, MODES, OPTION_CHOICES, VOTE_PHASES, canSell, sellValue, type MatchOpts, type Mode, type Sandbox, type SandboxCmd, type Vote } from '../shared/match.ts';
import type { PublicPlayer, PublicRoom, RoomInfo } from '../shared/protocol.ts';
import { ACTIVE_ITEMS, ITEMS, ITEM_IDS, MAX_ITEMS, isActive, itemPrice, type ItemId } from '../shared/items.ts';
import { MAX_SPELLS, MAX_SPELL_LEVEL, SPELL_IDS, isSpell, priceOf, spellCount, type SpellId } from '../shared/spells.ts';
import { isPadMode, isUiKey, labelOf, onKeysChange, setSlots, typing, uiLabel, type Action, type UiAction } from './keys.ts';
import { langChoice, openSettings, setSettingsCtx, settingsLinks } from './settings.ts';
import { hideTip, itemTip, spellTip, withTip } from './tips.ts';
import { MODE_INFO, OPT_INFO, PACE_NAME, SKILL_NAME, infoButton } from './opt-info.ts';
import { COLORS, TEAM_COLORS } from './scene.ts';
import { SPELL_GROUPS, SPELL_USE, groupClass, n1, pct, spellClass } from './rules-text.ts';
import { BAD_STATUS, ICON, ITEM_ICON, RUNE_ICON, RUNE_NAME, SOURCE_ICON, STATUS_ICONS, UI_ICON, actionName, el, fxClock, icon, type Child } from './icons.ts';
import { BASE, diff, sheet, type Change, type SheetRow } from './sheet.ts';
import { store } from './store.ts';
import { SANDBOX_BOT, botSetupPanel, savedBotSetup } from './train.ts';
import { CHALLENGES, bestOf, goalText } from './challenges.ts';
import { PROFILE_KEY, toSkill, type Profile } from './mimic.ts';
import { TAUNTS } from '../shared/taunts.ts';
import { endResult, roomGroups } from './screen-data.ts';
import { LOCALE, arenaName, itemName, itemText, spellName, t } from './i18n.ts';

const TITLE = 'Warlock';
// busca pelo nome sem acento nem maiúscula (loja e biblioteca)
export const norm = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// tela de toque sem mouse: os textos de ajuda falam de tocar, não de clicar
export const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

export function askName(root: HTMLElement, current: string): Promise<string> {
  return new Promise((resolve) => {
    const input = el('input', { id: 'name', maxlength: 20, placeholder: t('Seu apelido', 'Your nickname'), value: current, autocomplete: 'nickname' }) as HTMLInputElement;
    const form = el(
      'form',
      { class: 'panel', onkeydown: (e: KeyboardEvent) => {
        // trocar o apelido: Esc desiste e fica o de antes
        if (e.key !== 'Escape' || !current) return;
        e.preventDefault(); // este Esc não abre as configurações
        overlay.remove();
        resolve(current);
      }, onsubmit: (e: Event) => {
        e.preventDefault();
        const name = input.value.replace(/[<>]/g, '').trim();
        if (!name) return input.focus();
        overlay.remove();
        resolve(name);
      } },
      el('h1', {}, TITLE),
      el('label', { for: 'name' }, t('Como seus amigos te chamam?', 'What do your friends call you?')),
      input,
      el('button', { type: 'submit', class: 'primary' }, t('Continuar', 'Continue')),
    );
    const overlay = el('div', { class: 'overlay' }, form);
    root.append(overlay);
    input.focus();
  });
}

// o que a sala está fazendo, em palavras de quem vai entrar
const roomPhase = (r: RoomInfo) => r.phase === 'lobby' ? t('esperando começar', 'waiting to start') : r.phase === 'end' ? t('partida acabou, dá para começar outra', 'match over, you can start another')
  : t(`jogando${r.round ? ` a rodada ${r.round}` : ''} · você entra na próxima rodada`, `playing${r.round ? ` round ${r.round}` : ''} · you join next round`);

let challengesOpen = false; // lista de desafios aberta ou fechada sobrevive ao redesenho do lobby

// treino na tela inicial (escolha do Fernando, 19/10): cada botão cria uma sala sozinho e começa ali (main.ts, autostart);
// kind = 'train', 'shadow' ou o id do desafio
function trainBlock(onTrain: (kind: string) => void) {
  // sombra: 1 bot com o jeito de jogar das suas últimas rodadas (mimic.ts)
  const skill = toSkill(store.json<Profile>(PROFILE_KEY));
  return el('section', { class: 'train-home' }, el('h2', {}, t('Treino', 'Practice')),
    el('div', { class: 'train-btns' },
      el('button', { type: 'button', class: 'train', onclick: () => onTrain('train') }, icon(UI_ICON.aim), ' ' + t('Treinar sozinho com bots', 'Practice solo with bots'), el('small', {}, t('3 bots e dicas nas primeiras rodadas', '3 bots and tips in the first rounds'))),
      el('button', { type: 'button', class: 'train', disabled: !skill, onclick: () => skill && onTrain('shadow') },
        icon(UI_ICON.person), ' ' + t('Treinar contra a sua sombra', 'Practice against your shadow'), el('small', {}, skill ? t('1 bot que joga como você', '1 bot that plays like you') : t('jogue 3 rodadas para a sombra aprender', 'play 3 rounds for the shadow to learn'))),
      // sandbox (pedido do Fernando, 19/10): para testar todas as magias e interações; quem tiver o link entra junto
      el('button', { type: 'button', class: 'train', onclick: () => onTrain('sandbox') }, icon(UI_ICON.bot), ' ' + t('Sandbox (testar tudo)', 'Sandbox (test everything)'),
        el('small', {}, t('vida e ouro sem fim, loja a qualquer hora, bots no painel', 'endless health and gold, shop any time, bots in the panel')))),
    botSetupPanel(3, savedBotSetup(), () => {}),
    // desafios curtos: cada um com o recorde deste navegador
    el('details', { class: 'match-opts', open: challengesOpen, ontoggle: (e: Event) => (challengesOpen = (e.target as HTMLDetailsElement).open) },
      el('summary', {}, t('Desafios', 'Challenges') + ' · ', el('small', { class: 'muted' }, t('tarefas curtas de até 90 s', 'short tasks of up to 90 s'))),
      el('div', { class: 'bs-spells' }, ...CHALLENGES.map((c) => {
        const best = bestOf(c.id);
        return el('button', { type: 'button', class: 'train', onclick: () => onTrain(c.id) }, c.name,
          el('small', {}, goalText(c)), el('small', { class: 'muted' }, best === null ? t('sem recorde', 'no record') : t(`recorde: ${n1(best)} s${c.survive ? ' vivo' : ''}`, `record: ${n1(best)} s${c.survive ? ' alive' : ''}`)));
      }))));
}

// menu principal com abas no topo, como o do Dota (decisão do Fernando, 19/10); a aba aberta fica guardada
type HomeTab = 'play' | 'library' | 'learn' | 'char' | 'settings';
const HOME_TAB = 'warlock:homeTab';
const HOME_TABS: [HomeTab, string, string][] = [['play', t('Jogar', 'Play'), UI_ICON.aim], ['library', t('Magias e itens', 'Spells and items'), ICON.fireball],
  ['learn', t('Aprender', 'Learn'), UI_ICON.help], ['char', t('Personagem', 'Character'), UI_ICON.person], ['settings', t('Configurações', 'Settings'), UI_ICON.gear]];

// aba Personagem: o criador com as 7 peças (avatar.ts)
function personagemTab(): HTMLElement {
  return el('section', { class: 'home-char' }, el('h2', {}, t('Personagem', 'Character')), avatarPanel());
}

export function renderLobby(root: HTMLElement, name: string, rooms: RoomInfo[] | null, offline: boolean, onCreate: () => void, onRename: () => void, onTrain: (kind: string) => void) {
  setSettingsCtx({ name: () => name, rename: onRename }); // no lobby: sem som nem vídeo (só existem na sala)
  const retry = el('button', { type: 'button', onclick: () => location.reload() }, t('Tentar de novo', 'Try again'));
  // um cartão por sala: código e modo, quem está lá, o que está acontecendo e o Entrar (secundário em sala no meio da partida)
  const cards = (list: RoomInfo[]) => el('ul', { class: 'rooms' }, ...list.map((r) =>
    el('li', { class: 'room-card' + (r.phase === 'lobby' ? ' open' : '') },
      el('div', { class: 'room-info' },
        el('div', { class: 'room-top' }, el('span', { class: 'code' }, r.id), r.mode && r.mode in MODE_NAME ? el('span', { class: 'room-mode' }, MODE_NAME[r.mode as Mode]) : null),
        r.players ? el('span', {}, icon(UI_ICON.person), ` ${r.players} ${r.players === 1 ? t('pessoa', 'person') : t('pessoas', 'people')}`, r.bots ? ' + ' : null, r.bots ? icon(UI_ICON.bot) : null, r.bots ? ` ${r.bots} ${r.bots === 1 ? 'bot' : 'bots'}` : null) : el('span', {}, t('Vazia (fecha sozinha daqui a pouco)', 'Empty (closes on its own soon)')),
        el('small', {}, roomPhase(r))),
      el('a', { class: 'button' + (r.phase === 'lobby' || r.phase === 'end' ? '' : ' secondary'), href: '#' + r.id, 'aria-label': t(`Entrar na sala ${r.id}`, `Join room ${r.id}`) }, t('Entrar', 'Join')),
    )));
  const groups = rooms && roomGroups(rooms);
  const list =
    rooms === null && offline
      ? el('div', { class: 'lobby-error', role: 'alert' }, el('p', {}, t('Não deu para carregar as salas. Tentando de novo sozinho…', 'Could not load the rooms. Retrying on its own…')), retry)
      : !groups
      ? el('p', { class: 'muted' }, t('Carregando salas…', 'Loading rooms…'))
      : el('div', { class: 'room-groups' },
          groups.live.length ? cards(groups.live) : el('p', { class: 'muted' }, `${groups.empty.length ? t('Nenhuma sala com gente', 'No rooms with people') : t('Nenhuma sala aberta', 'No open rooms')}. ${t('Crie uma e mande o link no grupo.', 'Create one and send the link to your group.')}`),
          // salas vazias recolhidas: fecham sozinhas daqui a pouco
          groups.empty.length ? el('details', { class: 'empty-rooms' }, el('summary', {}, `${groups.empty.length} ${groups.empty.length === 1 ? t('sala vazia', 'empty room') : t('salas vazias', 'empty rooms')}`), cards(groups.empty)) : null);
  const roomList = el('section', { class: 'lobby-rooms' }, el('h2', {}, t('Salas abertas', 'Open rooms')), rooms !== null && offline ? el('p', { class: 'lobby-error', role: 'status' }, t('Sem conexão: a lista pode estar velha. Tentando de novo…', 'No connection: the list may be stale. Retrying…')) : null, list);
  // a lista chega de novo a cada mudança numa sala: só ela é redesenhada (as abas ficam como estão, com o foco)
  const old = root.querySelector<HTMLElement>('.lobby');
  if (old?.dataset.name === name) return old.querySelector('.lobby-rooms')!.replaceWith(roomList);
  const saved = store.get(HOME_TAB) as HomeTab | null;
  const panel = (k: HomeTab, ...kids: Child[]) => el('div', { class: 'home-panel', id: 'home-' + k, role: 'tabpanel', 'aria-labelledby': 'home-tab-' + k }, ...kids);
  const panels: Record<HomeTab, HTMLElement> = {
    play: panel('play',
      el('header', { class: 'hero' }, el('p', {}, t('Empurre os amigos para a lava com bola de fogo, raio e companhia. O último de pé vence a rodada.', 'Knock your friends into the lava with fireballs, lightning and more. The last one standing wins the round.'))),
      el('div', { class: 'lobby-actions' }, el('button', { type: 'button', class: 'primary big', onclick: onCreate }, t('Criar sala', 'Create room'))),
      roomList),
    library: panel('library'),
    learn: panel('learn',
      el('section', { class: 'home-learn' }, el('h2', {}, t('Como jogar', 'How to play')),
        el('p', { class: 'muted' }, t('O grimório explica o jogo, os controles, os modos, a loja e cada magia e item, com demonstração.', 'The grimoire explains the game, the controls, the modes, the shop and every spell and item, with demos.')),
        el('button', { type: 'button', onclick: showRules }, icon(UI_ICON.help), ' ' + t('Abrir o grimório', 'Open the grimoire'))),
      trainBlock(onTrain)),
    char: panel('char', personagemTab()),
    settings: panel('settings', el('section', { class: 'home-settings' }, el('h2', {}, t('Configurações', 'Settings')), settingsLinks(), langChoice())),
  };
  const btns = HOME_TABS.map(([k, label, ico]) => el('button', { type: 'button', role: 'tab', id: 'home-tab-' + k, 'aria-controls': 'home-' + k, onclick: () => show(k) }, icon(ico), el('span', {}, label)));
  function show(k: HomeTab) {
    store.set(HOME_TAB, k);
    HOME_TABS.forEach(([id], i) => {
      btns[i].classList.toggle('on', id === k);
      btns[i].setAttribute('aria-selected', String(id === k));
      panels[id].hidden = id !== k;
    });
  }
  root.replaceChildren(
    el('div', { class: 'lobby', 'data-name': name },
      el('nav', { class: 'home-bar' }, el('b', { class: 'home-logo' }, TITLE),
        el('div', { class: 'home-tabs', role: 'tablist', 'aria-label': t('Menu principal', 'Main menu') }, ...btns),
        el('button', { type: 'button', class: 'link home-name', onclick: onRename }, icon(UI_ICON.person), ` ${name} · ${t('trocar', 'change')}`)),
      ...Object.values(panels)),
  );
  show(HOME_TABS.some(([k]) => k === saved) ? saved! : 'play');
  void import('./grimoire.ts').then((m) => panels.library.append(m.library()));
}

// grimório (Como jogar): módulo carregado só quando abre, para não pesar o começo do jogo
export function showRules() {
  void import('./grimoire.ts').then((m) => m.openGrimoire());
}
// atalho do grimório (F1 no padrão) em qualquer tela; com ele já aberto, nada (o Esc fecha)
addEventListener('keydown', (e) => {
  if (!isUiKey(e.code, 'rules') || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  e.preventDefault(); // F1: não abre a ajuda do navegador
  if (!document.querySelector('.rules-overlay')) showRules();
});
// biblioteca de magias e itens por cima de qualquer tela (F2 no padrão); aberta, a própria tecla ou o Esc fecham
const showLibrary = () => void import('./grimoire.ts').then((m) => m.openLibrary());
addEventListener('keydown', (e) => {
  if (!isUiKey(e.code, 'library') || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  e.preventDefault();
  showLibrary();
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// tipo do aviso: muda a cor da borda e o ícone (style.css, #toast[data-kind])
type ToastKind = 'info' | 'good' | 'bad' | 'gold';
// msg pode vir com ícones (lista de textos e nós); o de ouro ganha a moeda na frente
export function toast(msg: string | (string | Node)[], kind: ToastKind = 'info') {
  let t = document.getElementById('toast');
  if (!t) document.body.append((t = el('div', { id: 'toast', role: 'status' })));
  t.replaceChildren(...(kind === 'gold' ? [icon(UI_ICON.gold)] : []), el('span', {}, ...[msg].flat()));
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove('show'), 3500);
}

// 'win': faixa grande dourada com confete, para quem venceu a rodada ou a partida
export function banner(text: string | (string | Node)[], kind: '' | 'good' | 'bad' | 'win' = '') {
  document.querySelectorAll('.banner').forEach((b) => b.remove());
  const b = el('div', { class: `banner ${kind}`, role: 'status', 'aria-live': 'polite' }, ...[text].flat());
  if (kind === 'win') b.append(...Array.from({ length: 22 }, (_, i) => el('i', { class: 'confetti', style: `--x:${Math.round(Math.cos(i * 2.4) * (90 + (i % 5) * 40))}px;--y:${Math.round(-60 - (i % 7) * 22)}px;--r:${i * 47}deg;--d:${(i % 4) * 0.05}s` })));
  document.body.append(b);
  setTimeout(() => b.remove(), kind === 'win' ? 2600 : 1700);
}

// cortina de ~180 ms ao trocar de tela (lobby, sala e partida): cobre a troca e some sozinha, sem pegar cliques
export function curtain() {
  const c = el('div', { class: 'curtain', 'aria-hidden': 'true' });
  document.body.append(c);
  setTimeout(() => c.remove(), 300);
}

export function screen(root: HTMLElement, title: string, text: string, button: string, onClick: () => void) {
  root.replaceChildren(el('div', { class: 'overlay' }, el('div', { class: 'panel' }, el('h1', {}, title), el('p', {}, text), el('button', { type: 'button', class: 'primary', onclick: onClick }, button))));
}

type RoomActions = {
  backToMenu: () => void;
  start: (bots: Level[], mode: Mode, shuffle: boolean, opts: MatchOpts, again?: boolean) => void; // bots: a dificuldade de cada um; again: "Jogar de novo" (repete a configuração do treino)
  hover: (a: SpellId | ItemId | null) => void; // mouse em cima da magia ou item na barra (círculo de alcance)
  buy: (s: SpellId) => void;
  buyItem: (i: ItemId) => void;
  kick: (id: string) => void;
  vote: (kind: Vote['kind'], target?: string) => void;
  ballot: (yes: boolean) => void;
  undo: (key: string) => void;
  sell: (key: string) => void;
  taunt: (i: number) => void;
  useItem: (i: ItemId) => void;
  pick: (c: CharacterId) => void;
  ready: () => void;
  spell: (s: SpellId) => void;
  volumes: () => { sfx: number; music: number };
  setVolume: (kind: 'sfx' | 'music', value: number) => void;
  click: () => void;
  // Efeitos: true = Leve
  fxLite: () => boolean;
  setFxLite: (lite: boolean) => void;
  spellReady: () => void; // uma magia acabou de recarregar
  watch: (step: number) => void; // espectador: +1 próximo vivo, −1 anterior
  replay: () => void; // liga ou desliga o replay da queda
  name: () => string; // apelido atual e a troca (aba Jogador das configurações)
  rename: () => void;
  sandbox: (cmd: SandboxCmd) => void; // painel da sandbox
  seeInvis: (on: boolean) => void; // sandbox: invisíveis meio transparentes (só nesta tela)
};

type Level = MatchOpts['difficulty'];
const MODE_NAME: Record<Mode, string> = { rounds: t('Rodadas', 'Rounds'), deathmatch: 'Deathmatch', teams: t('Times', 'Teams') };
export const TEAM_NAMES = [t('Azul', 'Blue'), t('Vermelho', 'Red')];
const teamLabel = (i: number) => t(`Time ${TEAM_NAMES[i]}`, `${TEAM_NAMES[i]} team`);
const SHUFFLE_NAME =(shuffle: boolean) => (shuffle ? t('sorteados a cada rodada', 'shuffled every round') : t('fixos na partida', 'fixed for the match'));
// opções da partida: nome de cada uma e o texto de cada valor (a meta depende do modo)
type OptKey = keyof MatchOpts;
// fora da sala e da votação (pedidos do Fernando, 19/10): ritmo e morte súbita ficam no padrão e a dificuldade vai bot a bot (lista da sala);
// o servidor ainda aceita, para salas antigas
const FIXED: Partial<MatchOpts> = { pace: DEFAULT_OPTS.pace, sudden: DEFAULT_OPTS.sudden, difficulty: DEFAULT_OPTS.difficulty };
const OPT_KEYS = (Object.keys(OPTION_CHOICES) as OptKey[]).filter((k) => !(k in FIXED));
const OPT_NAME: Record<OptKey, string> = { shop: t('Tempo de loja', 'Shop time'), pace: t('Contagem e fim de rodada', 'Countdown and round end'), economy: t('Ouro ganho', 'Gold earned'), startGold: t('Ouro inicial', 'Starting gold'), goal: t('Vence com', 'Wins with'), runes: t('Runas', 'Runes'), sudden: t('Morte súbita', 'Sudden death'), chests: t('Baús de ouro', 'Gold chests'), difficulty: t('Dificuldade dos bots', 'Bot difficulty'), arena: 'Arena' };
function optText(k: OptKey, val: MatchOpts[OptKey], mode: Mode): string {
  if (k === 'shop') return (val as number) >= 120 ? '2 min' : `${val} s`;
  if (k === 'pace') return PACE_NAME[val as MatchOpts['pace']];
  if (k === 'economy') return { 0.6: t('Pouco ×0,6', 'Low ×0.6'), 1: 'Normal', 1.6: t('Muito ×1,6', 'High ×1.6'), 2.5: t('Festa ×2,5', 'Party ×2.5') }[val as MatchOpts['economy']];
  if (k === 'arena') return val === 'random' ? t('Sortear', 'Random') : arenaName(val as ArenaId);
  if (k === 'difficulty') return SKILL_NAME[val as MatchOpts['difficulty']];
  if (k === 'goal') return mode === 'deathmatch' ? `${DM_GOALS[val as MatchOpts['goal']]} ${t('abates', 'kills')}` : `${val} ${t('rodadas', 'rounds')}`;
  if (typeof val === 'boolean') return val ? t('Ligado', 'On') : t('Desligado', 'Off');
  return String(val);
}
// nome da opção com o botão "i" que explica o que ela faz e cada valor
const optLabel = (k: OptKey, mode: Mode) => el('div', { class: 'opt-label' }, el('small', {}, OPT_NAME[k]), infoButton(OPT_NAME[k], () => OPT_INFO[k](mode)));
// resumo de uma linha (loja e votação): "Loja 30 s · Ouro ×1,6 · Vence com 5 rodadas · sem runas"
function optsLine(o: MatchOpts, mode: Mode): string {
  const off = (['runes', 'sudden', 'chests'] as const).filter((k) => !o[k]).map((k) => t('sem ', 'no ') + OPT_NAME[k].toLowerCase());
  const bots = o.difficulty !== 'normal' ? [{ easy: t('bots fáceis', 'easy bots'), hard: t('bots difíceis', 'hard bots'), auto: t('bots automáticos', 'auto bots') }[o.difficulty]] : [];
  const arena = o.arena !== 'random' ? [t('arena ' + arenaName(o.arena), arenaName(o.arena) + ' arena')] : [];
  return [t(`Loja ${optText('shop', o.shop, mode)}`, `Shop ${optText('shop', o.shop, mode)}`), t(`Ouro ×${n1(o.economy)}`, `Gold ×${n1(o.economy)}`), t(`Vence com ${optText('goal', o.goal, mode)}`, `Wins with ${optText('goal', o.goal, mode)}`), ...arena, ...bots, ...off].join(' · ');
}
// texto de uma votação aberta
function voteText(v: { kind: Vote['kind']; target: string }, mode: Mode, name: (id: string) => string): string {
  if (v.kind === 'mode') return t('trocar para ', 'switch to ') + MODE_NAME[v.target as Mode];
  if (v.kind === 'shuffle') return t('times ', 'set teams to ') + SHUFFLE_NAME(v.target === 'round');
  if (v.kind === 'kick') return t('expulsar ', 'kick ') + name(v.target);
  if (v.kind === 'opt') {
    const [k, raw] = v.target.split(':') as [OptKey, string];
    const val = (OPTION_CHOICES[k] as readonly (string | number | boolean)[]).find((c) => String(c) === raw) as MatchOpts[OptKey];
    return t(`${OPT_NAME[k]}: ${optText(k, val, mode)} na próxima rodada`, `set ${OPT_NAME[k].toLowerCase()} to ${optText(k, val, mode)} next round`);
  }
  return {
    restart: t('reiniciar a partida (tudo zerado)', 'restart the match (everything reset)'), end: t('encerrar a partida agora', 'end the match now'),
    addBot: t('pôr um bot na próxima rodada', 'add a bot next round'), removeBot: t('tirar um bot na próxima rodada', 'remove a bot next round'), skipShop: t('pular a loja', 'skip the shop'),
  }[v.kind];
}
const dot = (color: number) => el('span', { class: 'dot', style: `background:${COLORS[color]}` });
// modo Times: quadradinho com a cor do time antes do nome; a lista fica agrupada por time
const teamTag = (room: PublicRoom, p: PublicPlayer) =>
  room.mode === 'teams' && p.team !== null ? el('span', { class: 'dot', title: teamLabel(p.team), style: `background:${TEAM_COLORS[p.team]};border-radius:2px` }) : null;
const byTeam = (room: PublicRoom, a: PublicPlayer, b: PublicPlayer) => (room.mode === 'teams' ? (a.team ?? 2) - (b.team ?? 2) : 0) || b.score - a.score;
// bolinhas de nível: as primeiras lvl acesas, de max
const pipsOf = (lvl: number, max: number) => Array.from({ length: max }, (_, n) => el('i', { class: n < lvl ? 'on' : '' }));
const nameOf = (p: PublicPlayer, me: string) => el('span', {}, p.name + (p.id === me ? t(' (você)', ' (you)') : ''), p.bot ? ' ' : null, p.bot ? icon(UI_ICON.bot) : null);

// placar de estatísticas: ouro ganho, dano causado e precisão de cada magia de dano (acertos / lançamentos)
type Scope = 'round' | 'match' | 'room';
const SCOPES: [Scope, string][] = [['round', t('Rodada', 'Round')], ['match', t('Partida', 'Match')], ['room', t('Sala', 'Room')]];
const n0 = (x: number) => Math.round(x).toLocaleString(LOCALE);
// magias de utilidade: mostra quantas vezes usou (não têm "acerto"); as outras mostram precisão
const UTILITY = new Set(['teleport', 'shield', 'rush', 'pact', 'redirector', 'thrust', 'rockpillar', 'magnetize', 'alteration', 'warpzone']);
const srcIcon = (k: string) => icon(k === 'lava' ? SOURCE_ICON.lava : k in ICON ? ICON[k as SpellId] : k in ITEM_ICON ? ITEM_ICON[k as ItemId] : k.startsWith('choque') ? SOURCE_ICON.shock : k === 'pillar' ? SOURCE_ICON.pillar : SOURCE_ICON.unknown);
const gold = (n: number) => el('span', {}, icon(UI_ICON.gold), ' ' + n);
export const srcName = (k: string) => (k === 'lava' ? 'lava' : isSpell(k) ? spellName(k) : k in ITEMS ? itemName(k as ItemId) : k);

// placar (pedido do Fernando, 17/10; refeito em 18/10): abas Resumo e Magias, destaques com retrato e o melhor de cada coluna em dourado
type View = 'summary' | 'spells';
const VIEWS: [View, string][] = [['summary', t('Resumo', 'Summary')], ['spells', t('Magias', 'Spells')]];
const portrait = (p: PublicPlayer) => el('img', { class: 'face', src: `/chars/${p.character}.webp`, alt: '', width: 32, height: 32, loading: 'lazy' });
// fileira de botões com um marcado (opções da partida, modo, jeito de lançar); off: botão desligado
export const choice = <T>(label: string, items: [T, string][], on: T, pick: (v: T) => void, off?: (v: T) => boolean) => el('div', { class: 'stats-tabs', role: 'group', 'aria-label': label },
  ...items.map(([v, text]) => el('button', { type: 'button', 'aria-pressed': String(v === on), class: v === on ? 'on' : '', disabled: off?.(v), onclick: () => pick(v) }, text)));
const tabs = <T extends string>(label: string, list: [T, string][], on: T, set: (k: T) => void) =>
  el('div', { class: 'stats-tabs', role: 'tablist', 'aria-label': label }, ...list.map(([k, text]) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === on), class: k === on ? 'on' : '', onclick: () => set(k) }, text)));

// kick: só no fim da partida, onde a tabela substitui a lista de jogadores
function statsBoard(room: PublicRoom, me: string, scope: Scope, setScope: (s: Scope) => void, view: View, setView: (v: View) => void, kick?: (id: string) => void) {
  const st = (p: PublicPlayer) => p.stats[scope];
  const rows = [...room.players].sort((a, b) => byTeam(room, a, b) || st(b).dmg - st(a).dmg); // em Times, agrupado por time
  const used = [...new Set(rows.flatMap((p) => Object.keys(st(p).fired ?? {})))].sort((a, b) => Number(UTILITY.has(a)) - Number(UTILITY.has(b)));
  const shots = (p: PublicPlayer) => Object.keys(st(p).fired ?? {}).filter((k) => !UTILITY.has(k)).reduce((a, k) => a + (st(p).fired[k] ?? 0), 0);
  const aim = (p: PublicPlayer) => {
    let l = 0;
    for (const k of Object.keys(st(p).fired ?? {})) if (!UTILITY.has(k)) l += st(p).landed[k] ?? 0;
    const f = shots(p);
    return f ? l / f : -1;
  };
  const deathCause = (p: PublicPlayer) => {
    const by = Object.entries(st(p).deathBy ?? {}).sort((a, b) => b[1] - a[1])[0];
    return by ? el('span', { class: 'cause', title: t(`Morreu mais por: ${srcName(by[0])} (${by[1]}×)`, `Died most to: ${srcName(by[0])} (${by[1]}×)`) }, srcIcon(by[0]), ' ', el('small', {}, srcName(by[0]))) : '–';
  };
  type Col = { head: string; title: string; value: (p: PublicPlayer) => number; show: (n: number) => Child; best?: 'max' | 'min' };
  const cols: Col[] = [
    { head: room.mode === 'deathmatch' ? t('Pontos', 'Points') : t('Vitórias', 'Wins'), title: t('Pontos da partida', 'Match points'), value: (p) => p.score, show: (n) => String(n), best: 'max' },
    { head: t('Abates', 'Kills'), title: t('Abates (cair sozinho na lava não conta)', 'Kills (falling into the lava alone does not count)'), value: (p) => st(p).kills ?? 0, show: (n) => String(n), best: 'max' },
    { head: t('Mortes', 'Deaths'), title: t('Mortes', 'Deaths'), value: (p) => st(p).deaths ?? 0, show: (n) => String(n), best: 'min' },
    { head: t('Dano', 'Damage'), title: t('Dano causado', 'Damage dealt'), value: (p) => st(p).dmg, show: (n) => n0(n), best: 'max' },
    { head: t('Ouro', 'Gold'), title: t('Ouro ganho', 'Gold earned'), value: (p) => st(p).gold, show: (n) => n0(n), best: 'max' },
    { head: t('Precisão', 'Accuracy'), title: t('Acertos ÷ lançamentos das magias de dano', 'Hits ÷ casts of damage spells'), value: aim, best: 'max',
      show: (n) => (n < 0 ? '–' : el('span', { class: 'acc' }, el('span', { class: 'acc-bar' }, el('i', { style: `width:${Math.round(n * 100)}%` })), pct(n))) },
    ...(room.mode === 'deathmatch' ? [] : [{ head: t('Tempo vivo', 'Time alive'), title: t('Segundos vivo nas rodadas', 'Seconds alive in the rounds'), value: (p: PublicPlayer) => st(p).alive ?? 0, show: (n: number) => (n ? `${Math.round(n)} s` : '–'), best: 'max' as const }]),
  ];
  const bestOf = cols.map((c) => {
    const vals = rows.map(c.value).filter((n) => n >= 0);
    if (!c.best || !vals.length) return null;
    const b = c.best === 'max' ? Math.max(...vals) : Math.min(...vals);
    // todos iguais (ex.: ninguém morreu): sem destaque
    if (vals.every((n) => n === b)) return null;
    return c.best === 'max' && b <= 0 ? null : b;
  });
  const who = (p: PublicPlayer) => el('span', { class: 'who' }, portrait(p), teamTag(room, p), el('span', { class: 'who-name' }, p.name, p.id === me ? el('small', {}, t(' (você)', ' (you)')) : null, p.bot ? el('small', {}, ' ', icon(UI_ICON.bot)) : null));
  // destaques: quem foi o melhor em cada coisa (só com valor acima de zero)
  const leader = (c: (p: PublicPlayer) => number) => {
    const top = [...rows].sort((a, b) => c(b) - c(a))[0];
    return top && c(top) > 0 ? top : null;
  };
  const card = (ico: string, label: string, p: PublicPlayer | null, value: string) =>
    el('div', { class: 'stat-card' }, p ? portrait(p) : el('span', { class: 'stat-ico' }, icon(ico)), el('small', {}, icon(ico), ' ', label), el('b', {}, p ? p.name : '–'), el('span', { class: 'stat-val' }, p ? value : ''));
  const mostDmg = leader((p) => st(p).dmg);
  const mostKills = leader((p) => st(p).kills ?? 0);
  const sharp = leader((p) => (shots(p) >= 5 ? aim(p) : -1));
  const rich = leader((p) => st(p).gold);
  // modo Times: placar de abates dos dois times no topo e um cabeçalho por time na tabela
  const teamKills = (t: number) => rows.filter((p) => p.team === t).reduce((a, p) => a + (st(p).kills ?? 0), 0);
  const teamHead = room.mode === 'teams' && rows.some((p) => p.team !== null)
    ? el('p', { class: 'team-score' }, el('b', { style: `color:${TEAM_COLORS[0]}` }, teamLabel(0)), ` ${teamKills(0)} × ${teamKills(1)} `, el('b', { style: `color:${TEAM_COLORS[1]}` }, teamLabel(1)), el('small', {}, t(' · abates', ' · kills')))
    : null;
  const teamRow = (p: PublicPlayer, i: number, n: number) =>
    room.mode === 'teams' && p.team !== null && rows[i - 1]?.team !== p.team ? el('tr', { class: 'team-row' }, el('td', { colspan: n, style: `border-left:3px solid ${TEAM_COLORS[p.team]}` }, teamLabel(p.team))) : null;
  const body = (cells: (p: PublicPlayer) => HTMLElement[], n: number) =>
    el('tbody', {}, ...rows.flatMap((p, i) => [teamRow(p, i, n), el('tr', { class: p.id === me ? 'me' : '' }, el('td', { class: 'player' }, who(p), kickBtn(p, kick)), ...cells(p))]));
  const summary = () => el('table', { class: 'stats-table summary' },
    el('thead', {}, el('tr', {}, el('th', {}, t('Jogador', 'Player')), ...cols.map((c) => el('th', { class: 'num', title: c.title }, c.head)), el('th', { title: t('O que mais derrubou este jogador', 'What knocked this player down the most') }, t('Caiu mais por', 'Fell most to')))),
    body((p) => [
      ...cols.map((c, ci) => {
        const n = c.value(p);
        return el('td', { class: 'num' + (bestOf[ci] !== null && n === bestOf[ci] ? ' best' : ''), 'data-label': c.head }, c.show(n));
      }),
      el('td', { 'data-label': t('Caiu mais por', 'Fell most to') }, deathCause(p)),
    ], cols.length + 2));
  const spellCell = (p: PublicPlayer, k: string) => {
    const f = st(p).fired?.[k] ?? 0;
    if (!f) return el('td', { class: 'num none' }, '–');
    if (UTILITY.has(k)) return el('td', { class: 'num', title: t(`${srcName(k)}: usou ${f}×`, `${srcName(k)}: used ${f}×`) }, el('b', {}, `${f}×`), el('small', {}, f === 1 ? t('uso', 'use') : t('usos', 'uses')));
    const l = st(p).landed?.[k] ?? 0;
    const d = st(p).dmgBy?.[k] ?? 0;
    return el('td', { class: 'num', title: t(`${srcName(k)}: ${l} acertos em ${f} · ${n0(d)} de dano`, `${srcName(k)}: ${l} hits out of ${f} · ${n0(d)} damage`) }, el('b', {}, pct(l / f)), el('small', {}, `${n0(d)} ${t('dano', 'damage')}`));
  };
  const spells = () => used.length === 0
    ? el('p', { class: 'muted' }, t('Ninguém lançou magia ainda.', 'Nobody has cast a spell yet.'))
    : el('table', { class: 'stats-table spells' },
      el('thead', {}, el('tr', {}, el('th', {}, t('Jogador', 'Player')), ...used.map((k) => el('th', { class: 'spell-head', title: UTILITY.has(k) ? t(`${srcName(k)}: usos`, `${srcName(k)}: uses`) : t(`${srcName(k)}: precisão e dano`, `${srcName(k)}: accuracy and damage`) },el('span', {}, srcIcon(k)), srcName(k))))),
      body((p) => used.map((k) => spellCell(p, k)), used.length + 1));
  return el('div', { class: 'stats' },
    el('div', { class: 'stats-bar' }, tabs(t('Vista do placar', 'Scoreboard view'), VIEWS, view, setView), tabs(t('Período', 'Period'), SCOPES, scope, setScope)),
    el('div', { class: 'stat-cards' },
      card(UI_ICON.dmg, t('Mais dano', 'Most damage'), mostDmg, mostDmg ? n0(st(mostDmg).dmg) : ''),
      card(UI_ICON.kills, t('Mais abates', 'Most kills'), mostKills, mostKills ? String(st(mostKills).kills) : ''),
      card(UI_ICON.aim, t('Mais preciso', 'Most accurate'), sharp, sharp ? pct(aim(sharp)) : ''),
      card(UI_ICON.gold, t('Mais ouro', 'Most gold'), rich, rich ? n0(st(rich).gold) : ''),
    ),
    teamHead,
    el('div', { class: 'stats-wrap' }, view === 'summary' ? summary() : spells()),
    el('small', { class: 'muted' }, view === 'summary'
      ? t(`${scope === 'round' ? 'Ao vivo, atualiza a cada segundo. ' : ''}Dourado: o melhor da coluna. Precisão conta só as magias de dano.`, `${scope === 'round' ? 'Live, updates every second. ' : ''}Gold: the best in the column. Accuracy counts damage spells only.`)
      : t('Magias de dano: precisão (acertos ÷ lançamentos) e dano causado. Utilidade: quantas vezes usou.', 'Damage spells: accuracy (hits ÷ casts) and damage dealt. Utility: how many times used.')),
  );
}

// quadro da loja: de onde vem o ouro (regras do Warlock Brawl) e quanto você já ganhou
// os valores seguem as opções da sala: toda renda é multiplicada pela economia (shared/match.ts, earn)
function goldInfo(p: PublicPlayer, opts: MatchOpts, open: boolean, onToggle: (open: boolean) => void) {
  const row = (label: string, value: Child, cls = '') => el('div', { class: 'gold-row ' + cls }, el('span', {}, label), el('b', {}, value));
  const g = (n: number) => Math.round(n * opts.economy);
  // recolhido por padrão: o Pronto fica logo abaixo do ouro
  return el('details', { class: 'gold-info', open, ontoggle: (e: Event) => onToggle((e.target as HTMLDetailsElement).open) },
    el('summary', { class: 'gold-title' }, t('Como ganho ouro', 'How I earn gold'), opts.economy !== 1 ? el('small', {}, t(` · ouro ×${opts.economy.toLocaleString(LOCALE)} nesta sala`, ` · gold ×${opts.economy.toLocaleString(LOCALE)} in this room`)) : null),
    row(t('Começo da partida', 'Match start'), `+${g(opts.startGold)}`),
    row(t('Cada rodada que você jogou', 'Each round you played'), `+${g(ROUND_GOLD)}`),
    row(t('Vencer a rodada', 'Win the round'), t(`+${g(WIN_GOLD)} (líder: +${g(LEADER_WIN_GOLD)})`, `+${g(WIN_GOLD)} (leader: +${g(LEADER_WIN_GOLD)})`)),
    row(t('Abate', 'Kill'), `+${g(KILL_GOLD)}`),
    row(t('Abater o líder', 'Kill the leader'), t(`até +${g(BOUNTY.max)} extra`, `up to +${g(BOUNTY.max)} extra`)),
    row(t('Quebra-combo (derrubar quem tem 3+ abates seguidos)', 'Combo breaker (knock down someone on a 3+ kill streak)'), `+${g(STREAK.breakGold)}`),
    row(t('Atrás da média da partida', 'Behind the match average'), t(`até +${g(RECOVERY.max)} por rodada`, `up to +${g(RECOVERY.max)} per round`)),
    row(t('Mais dano na rodada', 'Most damage in the round'), `+${g(TOP_DMG_GOLD)}`),
    row(t('Assistência (mais dano em quem morreu)', 'Assist (most damage on whoever died)'), `+${g(ASSIST_GOLD)}`),
    row(t('Baú: em cima do ouro', 'Chest: on top of the gold'), opts.chests ? t(`+${g(1)} a cada ${CHEST.goldEvery} s`, `+${g(1)} every ${CHEST.goldEvery} s`) : t('desligado nesta sala', 'off in this room'), opts.chests ? '' : 'muted'),
    el('hr', {}),
    row(t('Ganho na última rodada', 'Earned last round'), gold(p.stats.round.gold)),
    row(t('Ganho na partida', 'Earned this match'), gold(p.stats.match.gold)),
    row(t('Ganho na sala (todas as partidas)', 'Earned in this room (all matches)'), gold(p.stats.room.gold)),
    el('small', { class: 'muted' }, t('Todo mundo ganha a rodada; vencer, abater e causar mais dano dão ouro extra. Desfazer (↩) devolve o ouro do que foi comprado nesta loja; Vender devolve 100% do que você pagou, em qualquer rodada.', 'Everyone earns gold each round; winning, kills and dealing the most damage give extra gold. Undo (↩) refunds what you bought in this shop; Sell refunds 100% of what you paid, in any round.')),
  );
}

// botão de expulsar: só para bots e para quem caiu e não voltou
const kickBtn = (p: PublicPlayer, kick?: (id: string) => void) =>
  kick && (p.bot || !p.connected) ? el('button', { type: 'button', class: 'kick', title: t(`Expulsar ${p.name}`, `Kick ${p.name}`), 'aria-label': t(`Expulsar ${p.name}`, `Kick ${p.name}`), onclick: () => kick(p.id) }, '✕') : null;

// fim da partida: com times fixos vence o time; sorteados a cada rodada, todos que chegaram à meta juntos
function winTitle(r: PublicRoom): Child[] {
  if (r.winnerTeam !== null) return [icon(UI_ICON.wins), t(` Time ${TEAM_NAMES[r.winnerTeam]} venceu!`, ` ${TEAM_NAMES[r.winnerTeam]} team wins!`)];
  const champs = r.mode === 'teams' ? r.players.filter((p) => p.score >= r.goal) : [];
  if (champs.length > 1) return [icon(UI_ICON.wins), t(` ${champs.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' e $1')} venceram!`, ` ${champs.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} win!`)];
  const winner = r.players.find((p) => p.id === r.winner)?.name ?? '?';
  return r.winner ? [icon(UI_ICON.wins), t(` ${winner} venceu!`, ` ${winner} wins!`)] : [t('Partida encerrada', 'Match ended')];
}

// pódio do fim da partida: 2º, 1º e 3º lado a lado, com o retrato; empate nos pontos desempata pelo dano da partida
function podium(room: PublicRoom, me: string) {
  const top = [...room.players].sort((a, b) => b.score - a.score || b.stats.match.dmg - a.stats.match.dmg).slice(0, 3);
  // ninguém pontuou (encerrada cedo): pódio de zeros não diz nada
  if (top.length < 2 || top[0].score === 0) return null;
  const unit = room.mode === 'deathmatch' ? [t('ponto', 'point'), t('pontos', 'points')] : [t('vitória', 'win'), t('vitórias', 'wins')];
  const step = (p: PublicPlayer, place: number) => el('div', { class: `podium-step p${place}` + (p.id === me ? ' me' : '') },
    el('img', { class: 'podium-face', src: `/chars/${p.character}.webp`, alt: '', width: 64, height: 64 }),
    el('b', {}, p.name), el('small', {}, `${p.score} ${unit[p.score === 1 ? 0 : 1]}`),
    el('span', { class: 'podium-block', 'aria-label': t(`${place}º lugar`, `${['1st', '2nd', '3rd'][place - 1]} place`) }, icon(UI_ICON.wins)));
  return el('div', { class: 'podium', 'aria-label': t('Pódio', 'Podium') }, step(top[1], 2), step(top[0], 1), top[2] ? step(top[2], 3) : null);
}

// na loja: quem já clicou em Pronto (bots ficam prontos sozinhos)
const readyTag = (p: PublicPlayer) => el('span', { class: 'ready-tag' + (p.ready ? ' on' : '') }, p.ready ? t('✓ Pronto', '✓ Ready') : t('Na loja', 'Shopping'));

function board(room: PublicRoom, me: string, kick?: (id: string) => void) {
  const sorted = [...room.players].sort((a, b) => byTeam(room, a, b));
  return el('ol', { class: 'board' }, ...sorted.map((p) =>
    el('li', { class: p.id === room.winner || (room.winnerTeam !== null && p.team === room.winnerTeam) ? 'win' : '' }, el('span', {}, teamTag(room, p), dot(p.color), ' ', nameOf(p, me), p.connected || p.bot ? '' : t(' · caiu', ' · dropped')), el('span', { class: 'board-right' }, room.phase === 'shop' ? readyTag(p) : null, el('b', {}, room.mode === 'deathmatch' ? `${p.score} ${p.score === 1 ? t('ponto', 'point') : t('pontos', 'points')}` : `${p.score} ${p.score === 1 ? t('vitória', 'win') : t('vitórias', 'wins')}`), kickBtn(p, kick))),
  ));
}

// ficha do mago: atributos com a origem de cada número, magias equipadas e itens ativos
function sheetEl(rows: SheetRow[], ...extra: Child[]) {
  const groups = [...new Set(rows.map((r) => r.group))];
  return el('div', { class: 'sheet' }, ...extra, ...groups.map((g) => el('section', {},
    el('h4', {}, g === BASE ? t('Atributos', 'Attributes') : g),
    el('dl', {}, ...rows.filter((r) => r.group === g).flatMap((r) => [el('dt', {}, r.label), el('dd', {}, r.value), r.from ? el('small', { class: 'from' }, r.from) : null])))));
}
// prévia na dica da loja: o que muda na ficha, melhor em verde e pior em vermelho
const previewHtml = (title: string, ch: Change[], extra = '') =>
  `<div class="preview"><b>${title}</b>${ch.length ? `<table>${ch.map((c) => `<tr class="${c.worse ? 'worse' : 'better'}"><th>${c.label}</th><td>${c.before ?? '—'} → ${c.after ?? '—'}</td></tr>`).join('')}</table>` : `<small>${t('Nada muda na ficha.', 'Nothing changes on the sheet.')}</small>`}${extra}</div>`;

export function createRoomUi(root: HTMLElement, code: string, act: RoomActions) {
  // uma dificuldade por bot (pedido do Fernando, 19/10); guardada nesta aba (o número de bots de antes vira 3 Normal)
  let bots: Level[] = ['normal', 'normal', 'normal'];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('warlock:bots') ?? 'null');
    if (Array.isArray(saved) && saved.every((d) => OPTION_CHOICES.difficulty.includes(d))) bots = saved;
  } catch {
    // armazenamento bloqueado: fica o padrão
  }
  const status = el('span', { class: 'dot off', title: t('conexão', 'connection') });
  // latência (ida e volta até a sala) ao lado do ponto de conexão, só na partida
  // desempenho (Fernando, 19/10: "medidor de fps e lag"): quadros por segundo e ida e volta até a sala
  const fpsEl = el('span', { title: t('Quadros por segundo', 'Frames per second') });
  const msEl = el('span', { title: t('Latência: tempo de ida e volta até a sala', 'Latency: round-trip time to the room') });
  const ping = el('small', { class: 'ping', hidden: true }, fpsEl, msEl);
  let frames = 0;
  let pingAt = 0;
  const roundEl = el('span', { class: 'round' });
  // topo como o do Dota (decisão do Fernando, 19/10): retratos dos jogadores no lugar da lista do canto, só durante a rodada
  const tops = el('div', { class: 'tops', role: 'group', 'aria-label': t('Jogadores', 'Players'), hidden: true });
  // painéis do topo: abrir um fecha os outros (pedido do Fernando, 18/10); solo(null) fecha todos (Esc, menu de configurações)
  function solo(p: HTMLElement | null) {
    if (p?.hidden) return;
    for (const [q, b] of [[votePanel, voteBtn], [tauntPanel, null], [sheetPanel, sheetBtn], [peekPanel, peekBtn], [morePanel, moreBtn], [sbPanel, sbBtn]] as [HTMLElement, HTMLElement | null][]) {
      if (q === p || q.hidden) continue;
      q.hidden = true;
      b?.setAttribute('aria-expanded', 'false');
    }
  }
  // abre ou fecha um painel do topo (fecha os outros) e marca o botão dele
  function toggle(p: HTMLElement, b: HTMLElement | null, open = p.hidden) {
    p.hidden = !open;
    solo(p);
    b?.setAttribute('aria-expanded', String(open));
  }
  // teclas, volume e efeitos moraram em painéis aqui; agora são abas do menu de configurações (settings.ts) e os botões abrem a aba
  const volIcon = () => volBtn.replaceChildren(icon(act.volumes().sfx + act.volumes().music === 0 ? UI_ICON.mute : UI_ICON.sound));
  setSettingsCtx({
    name: act.name, rename: act.rename, volumes: act.volumes, fxLite: act.fxLite, setFxLite: act.setFxLite, closePanels: () => solo(null),
    setVolume: (kind, v) => {
      act.setVolume(kind, v);
      volIcon();
    },
  });
  const gearBtn = el('button', { type: 'button', class: 'icon wide-only', title: t('Configurações (Esc)', 'Settings (Esc)'), 'aria-label': t('Configurações', 'Settings'), onclick: () => openSettings() }, icon(UI_ICON.gear));
  onKeysChange(() => {
    barWrap.querySelectorAll<HTMLElement>('[data-action]').forEach((k) => (k.textContent = labelOf(k.dataset.action as Action)));
    drawCenter();
    drawHints();
  });
  const volBtn = el('button', { type: 'button', class: 'icon wide-only', title: t('Som', 'Sound'), 'aria-label': t('Som', 'Sound'), onclick: () => openSettings('som') }, icon(act.volumes().sfx + act.volumes().music === 0 ? UI_ICON.mute : UI_ICON.sound));
  // votação na partida: o botão abre as opções; a faixa no topo mostra a votação aberta para todos
  const votePanel = el('div', { class: 'vol-panel', hidden: true });
  const voteBtn = el('button', { type: 'button', class: 'vote-btn', title: t('Votar: trocar o modo ou expulsar alguém', 'Vote: change the mode or kick someone'), 'aria-label': t('Votar', 'Vote'), 'aria-expanded': 'false', onclick: () => toggle(votePanel, voteBtn) },
    icon(UI_ICON.vote), el('span', { class: 'vote-label' }, ' ' + t('Votar', 'Vote')));
  const voteWrap = el('div', { class: 'vol' }, voteBtn, votePanel);
  // provocações (taunts): a tecla (Y no padrão) abre a lista e o número escolhe (ou clique); vale na loja e no jogo
  const sendTaunt = (i: number) => {
    act.taunt(i);
    tauntPanel.hidden = true;
  };
  const tauntTitle = el('b', {}, t('Provocações', 'Taunts'));
  const tauntPanel = el('div', { class: 'vol-panel', hidden: true }, tauntTitle,
    el('div', { class: 'taunt-list' }, ...TAUNTS.map((x, i) => el('button', { type: 'button', onclick: () => sendTaunt(i) }, `${(i + 1) % 10} · ${t(x.text, x.en)}`))));
  const sheetBtn = el('button', { type: 'button', class: 'icon', 'aria-label': t('Ficha do mago', 'Wizard sheet'), 'aria-expanded': 'false', onclick: () => toggleSheet() }, icon(UI_ICON.sheet));
  const tauntBtn = el('button', { type: 'button', class: 'icon wide-only', onclick: () => toggle(tauntPanel, null) }, icon(UI_ICON.taunt));
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (isUiKey(e.code, 'vote') && voteBtn.checkVisibility()) {
      e.preventDefault();
      voteBtn.click();
    } else if (isUiKey(e.code, 'taunt')) {
      toggle(tauntPanel, null);
      e.preventDefault();
    } else if (!tauntPanel.hidden && /^(Digit|Numpad)[0-9]$/.test(e.code)) {
      const i = (Number(e.code.slice(-1)) + 9) % 10; // 1..9 e o 0 para o 10º
      if (i < TAUNTS.length) sendTaunt(i);
      // o número não pode também usar o item da mesma tecla
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.code === 'Escape' && [votePanel, tauntPanel, sheetPanel, morePanel, sbPanel].some((p) => !p.hidden)) {
      // fechou um painel: este Esc não abre as configurações
      e.preventDefault();
      solo(null);
    }
  });
  const voteBar = el('div', { class: 'vote-bar', role: 'status', hidden: true });
  const voteLeft = el('span', { class: 'muted' });
  let voteEndsAt = 0;
  // celular: sem Tab, este botão (só aparece em tela de toque) abre e fecha o placar
  const tabBtn = el('button', { type: 'button', class: 'icon tab-toggle', title: t('Placar', 'Scoreboard'), 'aria-label': t('Placar', 'Scoreboard'), hidden: true, onclick: () => pinTab(!!tabOverlay.hidden) }, icon(UI_ICON.board));
  // loja só para ver no meio da rodada (pedido do Fernando, 18/10): botão no topo, tecla (4 no padrão), D-pad ↓; não pausa o jogo
  const PEEK_PHASES = ['countdown', 'playing', 'roundEnd'];
  const peekPanel = el('div', { class: 'peek-shop', role: 'dialog', 'aria-label': t('Loja (só para ver)', 'Shop (view only)'), hidden: true });
  const peekBtn = el('button', { type: 'button', class: 'icon', 'aria-expanded': 'false', hidden: true, onclick: () => togglePeek() }, icon(UI_ICON.shop));
  let deadShop = false; // caiu na rodada (Rodadas/Times): a loja do meio da rodada compra e vende
  const DRAWER = matchMedia('(min-width: 861px) and (min-height: 501px)'); // largura em que a loja de quem caiu vira gaveta (style.css, .peek-shop.drawer)
  function drawPeek() {
    if (peekPanel.hidden || !room) return;
    hideTip(peekPanel); // a atualização de 1 s não pode deixar a dica órfã
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
    peekPanel.replaceChildren(shopPanel(room, true));
    refocus(peekPanel, focused);
  }
  // redesenhar a loja não tira o foco de quem usa o teclado; na busca, o cursor volta para o fim do texto
  function refocus(box: HTMLElement, key?: string) {
    const f = key ? box.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
    f?.focus();
    if (f instanceof HTMLInputElement) f.setSelectionRange(f.value.length, f.value.length);
  }
  function togglePeek(open = peekPanel.hidden) {
    open &&= !!room && PEEK_PHASES.includes(room.phase);
    toggle(peekPanel, peekBtn, open);
    peekPanel.classList.toggle('drawer', deadShop); // gaveta só para quem caiu (ver deadShopping)
    if (!open) hideTip(peekPanel);
    drawPeek();
  }
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (isUiKey(e.code, 'shop') && room && PEEK_PHASES.includes(room.phase)) {
      e.preventDefault();
      togglePeek();
    } else if (e.code === 'Escape' && !peekPanel.hidden) {
      e.preventDefault();
      togglePeek(false);
    }
  });
  // sandbox: painel só nas salas sandbox, aberto pelo botão no topo (no celular também); montado uma vez, a sala só acerta o estado
  const sbPanel = el('div', { class: 'vol-panel sandbox-panel', hidden: true });
  const sbBtn = el('button', { type: 'button', class: 'vote-btn', hidden: true, 'aria-expanded': 'false', title: t('Painel da sandbox', 'Sandbox panel'), 'aria-label': t('Painel da sandbox', 'Sandbox panel'), onclick: () => toggle(sbPanel, sbBtn) },
    icon(UI_ICON.bot), el('span', { class: 'vote-label' }, ' Sandbox'));
  const sbChecks = new Map<keyof Sandbox, HTMLInputElement>();
  const check = (label: string, on: boolean, change: (on: boolean) => void) => {
    const box = el('input', { type: 'checkbox', checked: on, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) }) as HTMLInputElement;
    return { row: el('label', { class: 'sandbox-check' }, box, ' ' + label), box };
  };
  const rule = (key: keyof Sandbox, label: string) => {
    const { row, box } = check(label, false, (on) => act.sandbox({ op: 'set', key, on }));
    sbChecks.set(key, box);
    return row;
  };
  let sbLevel: Level = 'normal';
  // bot com a dificuldade escolhida e as magias marcadas abaixo (sem nenhuma, compra sozinho)
  const addBot = (dummy: boolean) => {
    const spells = savedBotSetup(SANDBOX_BOT)[0]?.spells;
    act.sandbox({ op: 'bot', bot: { difficulty: sbLevel, ...(spells && { spells }) }, ...(dummy && { dummy: true }) });
  };
  const sbBots = el('ul', { class: 'sandbox-bots' });
  const sbArena = el('select', { 'aria-label': t('Arena', 'Arena'), onchange: (e: Event) => act.sandbox({ op: 'arena', arena: (e.target as HTMLSelectElement).value as ArenaId }) },
    ...ARENA_IDS.map((a) => el('option', { value: a }, arenaName(a)))) as HTMLSelectElement;
  sbPanel.append(
    el('b', {}, 'Sandbox'),
    el('small', { class: 'muted' }, t('Nada daqui conta nos dados do jogo.', 'Nothing here counts toward the game data.')),
    rule('god', t('Vida infinita', 'Infinite health')),
    rule('noCd', t('Sem recarga', 'No cooldowns')),
    rule('shrink', t('Encolher a arena', 'Shrink the arena')),
    check(t('Ver invisíveis', 'See invisible wizards'), true, act.seeInvis).row,
    el('div', { class: 'sandbox-row' },
      el('select', { 'aria-label': t('Dificuldade do bot', 'Bot difficulty'), onchange: (e: Event) => (sbLevel = (e.target as HTMLSelectElement).value as Level) },
        ...(['easy', 'normal', 'hard'] as const).map((k) => el('option', { value: k, selected: k === sbLevel }, SKILL_NAME[k]))),
      el('button', { type: 'button', onclick: () => addBot(false) }, t('+ Bot', '+ Bot'))),
    el('button', { type: 'button', title: t('Bot que não anda nem atira: bom para testar dano e empurrão', 'A bot that neither moves nor shoots: good for testing damage and knockback'), onclick: () => addBot(true) }, t('+ Boneco parado', '+ Training dummy')),
    botSetupPanel(1, savedBotSetup(SANDBOX_BOT), () => {}, SANDBOX_BOT),
    sbBots,
    el('label', { class: 'sandbox-row' }, t('Arena', 'Arena'), sbArena),
    // runa escolhida: nasce ao lado do seu mago, no lugar da que estiver na arena
    el('div', { class: 'sandbox-row', role: 'group', 'aria-label': t('Pôr runa', 'Place rune') }, t('Runa', 'Rune'),
      ...RUNE_KINDS.map((k) => el('button', { type: 'button', class: 'icon', title: RUNE_NAME[k], 'aria-label': t(`Pôr a ${RUNE_NAME[k]} ao seu lado`, `Place the ${RUNE_NAME[k]} next to you`), onclick: () => act.sandbox({ op: 'rune', kind: k }) }, icon(RUNE_ICON[k])))),
    el('button', { type: 'button', onclick: () => act.sandbox({ op: 'restart' }) }, t('Reiniciar a rodada', 'Restart the round')));
  let sbSig = '';
  function drawSandbox(r: PublicRoom) {
    sbBtn.hidden = !r.sandbox || !PEEK_PHASES.includes(r.phase);
    if (!r.sandbox || sbBtn.hidden) {
      if (!sbPanel.hidden) toggle(sbPanel, sbBtn, false);
      return;
    }
    for (const [k, box] of sbChecks) box.checked = r.sandbox[k];
    if (r.arena && document.activeElement !== sbArena) sbArena.value = r.arena;
    // lista dos bots com o ✕ (tirar): só redesenha quando muda
    const bots = r.players.filter((p) => p.bot);
    const sig = bots.map((p) => `${p.id}:${p.name}:${p.difficulty}:${p.dummy}`).join();
    if (sig === sbSig) return;
    sbSig = sig;
    sbBots.replaceChildren(...bots.map((p) => el('li', {}, el('span', {}, `${p.name} · ${p.dummy ? t('boneco', 'dummy') : SKILL_NAME[p.difficulty ?? 'normal']}`),
      el('button', { type: 'button', class: 'icon', title: t(`Tirar ${p.name}`, `Remove ${p.name}`), 'aria-label': t(`Tirar ${p.name}`, `Remove ${p.name}`), onclick: () => act.kick(p.id) }, '✕'))));
  }
  const helpBtn = el('button', { type: 'button', class: 'icon wide-only', onclick: showRules }, icon(UI_ICON.help));
  // celular: configurações, som, provocações e ajuda moram no "⋯" (style.css, .wide-only); ficam à vista loja, placar, ficha e votar
  const morePanel = el('div', { class: 'vol-panel more-panel', hidden: true },
    el('button', { type: 'button', onclick: () => openSettings() }, icon(UI_ICON.gear), ' ' + t('Configurações', 'Settings')),
    el('button', { type: 'button', onclick: () => openSettings('som') }, icon(UI_ICON.sound), ' ' + t('Som', 'Sound')),
    el('button', { type: 'button', onclick: () => toggle(tauntPanel, null, true) }, icon(UI_ICON.taunt), ' ' + t('Provocações', 'Taunts')),
    el('button', { type: 'button', onclick: () => {
      toggle(morePanel, moreBtn, false);
      showRules();
    } }, icon(UI_ICON.help), ' ' + t('Como jogar', 'How to play')),
    el('button', { type: 'button', onclick: () => {
      toggle(morePanel, moreBtn, false);
      showLibrary();
    } }, icon(ICON.fireball), ' ' + t('Magias e itens', 'Spells and items')));
  const moreBtn = el('button', { type: 'button', class: 'icon', title: t('Mais opções', 'More options'), 'aria-label': t('Mais opções', 'More options'), 'aria-expanded': 'false', onclick: () => toggle(morePanel, moreBtn) }, '⋯');
  // dicas (title e aria-label) com a tecla atual de cada atalho
  const HINTS: [HTMLElement, string, UiAction][] = [[peekBtn, t('Ver a loja', 'View the shop'), 'shop'], [sheetBtn, t('Ficha do mago', 'Wizard sheet'), 'sheet'], [tauntBtn, t('Provocações', 'Taunts'), 'taunt'], [helpBtn, t('Como jogar', 'How to play'), 'rules'], [voteBtn, t('Votar: trocar o modo ou expulsar alguém', 'Vote: change the mode or kick someone'), 'vote']];
  function drawHints() {
    for (const [b, text, a] of HINTS) {
      const tip = uiLabel(a) === '—' ? text : `${text} (${uiLabel(a)})`;
      b.title = tip;
      b.setAttribute('aria-label', tip);
    }
    tauntTitle.textContent = uiLabel('taunt') === '—' ? t('Provocações', 'Taunts') : `${t('Provocações', 'Taunts')} (${uiLabel('taunt')})`;
  }
  drawHints();
  // sair da sala: volta ao menu inicial (main.ts recarrega no hashchange); no meio da partida pergunta antes
  const exitBtn = el('button', { type: 'button', class: 'icon', title: t('Sair da sala', 'Leave room'), 'aria-label': t('Sair da sala e voltar ao início', 'Leave the room and go back to the start'), onclick: () => {
    const mid = room && room.phase !== 'lobby' && room.phase !== 'end';
    if (!mid || confirm(t('Sair da partida e voltar ao início?', 'Leave the match and go back to the start?'))) location.hash = '';
  } }, icon(UI_ICON.exit));
  const top = el('div', { class: 'hud-top' },
    exitBtn,
    el('button', { type: 'button', class: 'code', title: t('Copiar link da sala', 'Copy room link'), 'aria-label': t(`Sala ${code}: copiar link`, `Room ${code}: copy link`), onclick: () => copyLink() }, status, ' ', code, ping),
    roundEl,
    el('div', { class: 'hud-right' }, peekBtn, tabBtn, sheetBtn, el('div', { class: 'vol' }, tauntBtn, tauntPanel), voteWrap, volBtn, gearBtn, helpBtn, el('div', { class: 'vol more-wrap' }, moreBtn, morePanel), el('div', { class: 'vol' }, sbBtn, sbPanel)),
  );
  const center = el('div', { class: 'center' });
  // a janela da loja pode ser alargada pela alça do canto (PC); o tamanho fica salvo neste navegador (pedido do Fernando, 18/10)
  const SHOP_SIZE = 'warlock:shopSize';
  new ResizeObserver(() => {
    if (!center.classList.contains('shop-open') || !center.style.width) return;
    store.set(SHOP_SIZE, JSON.stringify([center.style.width, center.style.height]));
  }).observe(center);
  const timer = el('div', { class: 'timer' });
  const respawn = el('div', { class: 'respawn' });
  const buttons = new Map<SpellId, { b: HTMLElement; cd: HTMLElement; pips: HTMLElement }>();
  let mine: PublicPlayer | undefined;
  const bar = el('div', { class: 'spellbar' }, ...SPELL_IDS.map((s) => {
    const cd = el('span', { class: 'cd' });
    const pips = el('span', { class: 'pips' });
    const b = withTip(el('button', { type: 'button', class: 'spell ' + spellClass(s), 'aria-label': spellName(s), onclick: () => act.spell(s), onpointerenter: (e: PointerEvent) => e.pointerType === 'mouse' && act.hover(s), onpointerleave: () => act.hover(null) },
      el('span', { class: 'key', 'data-action': s }, labelOf(s)), el('span', { class: 'ico' }, icon(ICON[s])), pips, cd), () => spellTip(s, mine?.spells[s] ?? 0));
    buttons.set(s, { b, cd, pips });
    return b;
  }));
  // itens ativos (teclas 1, 2 e 3) na grade de itens à direita da barra; só aparecem se comprados
  // grade 3×2 como a do Dota (MAX_ITEMS = 6): ativos com a tecla, passivos apagados e o resto vazio
  const itemGrid = el('div', { class: 'item-grid', role: 'group', 'aria-label': t('Itens', 'Items') });
  const itemButtons = new Map<ItemId, { b: HTMLElement; cd: HTMLElement }>();
  for (const i of ACTIVE_ITEMS) {
    const cd = el('span', { class: 'cd' });
    const b = withTip(el('button', { type: 'button', class: 'spell item', 'aria-label': itemName(i), onclick: () => act.useItem(i), onpointerenter: (e: PointerEvent) => e.pointerType === 'mouse' && act.hover(i), onpointerleave: () => act.hover(null) },
      el('span', { class: 'key', 'data-action': i }, labelOf(i)), el('span', { class: 'ico' }, icon(ITEM_ICON[i])), cd), () => itemTip(i, mine?.items[i] ?? 0));
    b.hidden = true;
    itemButtons.set(i, { b, cd });
    itemGrid.append(b);
  }
  // efeitos ativos em mim, numa fileira pequena acima da barra
  const statusRow = el('div', { class: 'status-icons hud-status', role: 'group', 'aria-label': t('Efeitos', 'Effects') });
  const fxCells = new Map<number, HTMLElement>(); // bit → número de segundos embaixo do ícone
  const clock = fxClock();
  // segurar Tab durante a partida mostra o placar; o 📊 (toque) e o botão Placar da loja deixam aberto até fechar
  const tabOverlay = el('div', { class: 'tab-overlay', hidden: true });
  function showTab(on: boolean) {
    tabOverlay.hidden = !on || !room;
    if (tabOverlay.hidden) tabOverlay.classList.remove('pinned');
    if (on && room) tabOverlay.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'stats-head' }, el('h2', { class: 'title' }, t('Placar', 'Scoreboard')),
        tabOverlay.classList.contains('pinned') ? el('button', { type: 'button', class: 'icon', title: t('Fechar o placar', 'Close the scoreboard'), 'aria-label': t('Fechar o placar', 'Close the scoreboard'), onclick: () => pinTab(false) }, '✕') : el('small', {}, t('← → troca o período', '← → switch period'))),
      statsBoard(room, me, scope, setScope, view, setView)));
  }
  function pinTab(open: boolean) {
    tabOverlay.classList.toggle('pinned', open);
    showTab(open);
  }
  const TAB_PHASES = ['playing', 'countdown', 'roundEnd', 'shop'];
  addEventListener('keydown', (e) => {
    if (!tabOverlay.hidden && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const i = SCOPES.findIndex(([k]) => k === scope);
      setScope(SCOPES[(i + (e.code === 'ArrowLeft' ? SCOPES.length - 1 : 1)) % SCOPES.length][0]);
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' && tabOverlay.classList.contains('pinned')) {
      e.preventDefault(); // fechou o placar fixo: este Esc não abre as configurações
      return pinTab(false);
    }
    // placar pelo Tab (pedido do Fernando, 17/10; trocável), também na loja (19/10: "na hora de compra o tab não está abrindo o placar")
    if (!isUiKey(e.code, 'board') || !room || !TAB_PHASES.includes(room.phase)) return;
    e.preventDefault();
    if (!e.repeat) showTab(true);
  });
  addEventListener('keyup', (e) => isUiKey(e.code, 'board') && !tabOverlay.classList.contains('pinned') && showTab(false));
  // magia escolhida pelo botão: diz o que fazer agora e como desistir (no toque não há Esc)
  let shownArmed: string | null = null;
  const armedText = el('span', {});
  const armedHint = el('div', { class: 'armed-hint', role: 'status', hidden: true }, armedText,
    el('button', { type: 'button', class: 'icon', title: t('Cancelar', 'Cancel'), 'aria-label': t('Cancelar a magia escolhida', 'Cancel the selected spell'), onclick: () => {
      if (isSpell(shownArmed)) act.spell(shownArmed);
      else if (shownArmed) act.useItem(shownArmed as ItemId);
    } }, '✕'));
  // barra da partida estilo Dota (decisão do Fernando, 19/10): retrato com vida e ouro à esquerda, magias no meio, itens à direita
  const hpFill = el('i', {});
  const hpText = el('span', { class: 'hp-text' });
  const hpBar = el('div', { class: 'hpbar', role: 'img' }, hpFill, hpText);
  const goldNow = el('span', { class: 'gold' });
  const vitals = el('div', { class: 'vitals', hidden: true }, hpBar, goldNow); // vida só jogando e vivo
  const heroFace = el('img', { class: 'hero-face', alt: '', width: 72, height: 84 });
  const hero = el('div', { class: 'hero-box' }, heroFace, vitals);
  const barWrap = el('div', { class: 'barwrap' }, armedHint, statusRow, el('div', { class: 'dota-bar' }, hero, el('div', { class: 'skills' }, bar, itemGrid)));
  // a barra some na sala, na loja e no fim (update, a cada segundo) e enquanto eu assisto morto (watching, a cada quadro): uma conta só, sem piscar
  let barOff = true;
  let watchingNow = false;
  const syncBar = () => (barWrap.hidden = barOff || watchingNow);
  // varredura da recarga: o total é o tempo restante quando a recarga começou (ou cresceu); a Recarga e a runa só encurtam
  const cdTotal = new Map<string, number>();
  const cdLeft = new Map<string, number>();
  // queda de conexão: faixa no topo (aparece depois de 1,5 s, para não piscar ao entrar) e botões da sala e da loja desligados
  let online = false;
  function setOnline(on: boolean) {
    online = on;
    status.className = 'dot ' + (on ? 'on' : 'off');
    offline.hidden = on;
  }
  const offline = el('div', { class: 'offline', role: 'alert', hidden: true }, t('Sem conexão, tentando de novo…', 'No connection, retrying…'));
  // ficha do mago na partida: tecla ' (à esquerda do 1) ou o botão 📜; no celular vira gaveta de baixo para cima
  const sheetPanel = el('div', { class: 'sheet-panel', role: 'dialog', 'aria-label': t('Ficha do mago', 'Wizard sheet'), hidden: true });
  let myStatus = 0;
  function drawSheet() {
    if (sheetPanel.hidden || !mine) return;
    const taken = live[me]?.taken ?? 0;
    const effects = STATUS_ICONS.filter(([bit]) => myStatus & bit);
    sheetPanel.replaceChildren(
      el('div', { class: 'stats-head' }, el('h2', { class: 'title' }, t('Ficha do mago', 'Wizard sheet')), el('button', { type: 'button', class: 'icon', title: t('Fechar a ficha', 'Close the sheet'), 'aria-label': t('Fechar a ficha', 'Close the sheet'), onclick: () => toggleSheet(false) }, '✕')),
      sheetEl(sheet(mine.spells, mine.items),
        el('section', {}, el('h4', {}, t('Agora', 'Now')), el('dl', {},
          el('dt', {}, t('Dano levado na rodada', 'Damage taken this round')), el('dd', {}, `${Math.round(taken)} · ${t('empurrão', 'knockback')} ×${(1 + (KNOCK_HP_SCALE * taken) / HP_MAX).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}`), el('small', { class: 'from' }, t('Cada ponto de dano levado faz você voar mais longe até o fim da rodada (a lava conta pela metade e não entra nesta conta).', 'Every point of damage taken sends you flying farther until the end of the round (lava counts half and is not included here).')),
          el('dt', {}, t('Efeitos', 'Effects')), el('dd', {}, ...(effects.length ? effects.flatMap(([, ico, name], i) => [i ? ' · ' : '', icon(ico), ' ' + name]) : [t('nenhum', 'none')]))))),
    );
  }
  function toggleSheet(open = sheetPanel.hidden) {
    toggle(sheetPanel, sheetBtn, open);
    drawSheet();
  }
  addEventListener('keydown', (e) => {
    if (!isUiKey(e.code, 'sheet') || typing(e) || !room || room.phase === 'lobby') return;
    e.preventDefault();
    toggleSheet();
  });
  // feed de abates no canto: quem derrubou quem e com o quê; cada linha some em 5 s
  const feed = el('ol', { class: 'feed', 'aria-live': 'polite' });
  // borda vermelha: vida baixa (fixa) e pé na lava (pulsando); fica atrás do resto da HUD
  const danger = el('div', { class: 'danger', 'aria-hidden': 'true' });
  // dica do modo treino, uma por vez
  const coachText = el('span', {});
  const coachAgain = el('button', { type: 'button', hidden: true }, t('Repetir', 'Retry')); // fim do desafio
  const coachQuit = el('button', { type: 'button', hidden: true }, t('Sair do desafio', 'Quit challenge'));
  const coach = el('div', { class: 'coach', role: 'status', hidden: true }, icon(UI_ICON.tip), ' ', coachText, coachAgain, coachQuit);
  // espectador: selo "Assistindo X" com setas para trocar (← → no teclado)
  const watchName = el('b', {});
  const watchBadge = el('div', { class: 'watching', role: 'status', hidden: true },
    el('button', { type: 'button', class: 'icon', title: t('Anterior (←)', 'Previous (←)'), 'aria-label': t('Assistir o anterior', 'Watch the previous player'), onclick: () => act.watch(-1) }, '‹'),
    el('span', {}, t('Assistindo ', 'Watching '), watchName, TOUCH ? null : el('small', {}, t(' · ← → troca', ' · ← → switch'))),
    el('button', { type: 'button', class: 'icon', title: t('Próximo (→)', 'Next (→)'), 'aria-label': t('Assistir o próximo', 'Watch the next player'), onclick: () => act.watch(1) }, '›'));
  // caiu nas Rodadas ou nos Times: botão Loja pulsando no selo (no celular a loja não abre sozinha)
  const shopNudge = el('button', { type: 'button', class: 'shop-nudge', hidden: true, onclick: () => togglePeek() }, icon(UI_ICON.shop), ' ' + t('Loja', 'Shop'));
  watchBadge.append(shopNudge);
  // replay da queda: botão depois de cair; durante o replay, a faixa com quem derrubou e o botão de sair
  const replayText = el('span', {});
  const replayBtn = el('button', { type: 'button', onclick: () => act.replay() });
  const replayBar = el('div', { class: 'replay', role: 'status', hidden: true }, replayText, replayBtn);
  addEventListener('keydown', (e) => {
    if (!isUiKey(e.code, 'replay') || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    act.replay();
  });
  root.replaceChildren(el('div', { class: 'hud' }, danger, top, offline, tops, timer, respawn, feed, coach, watchBadge, replayBar, center, voteBar, barWrap, sheetPanel, peekPanel, tabOverlay), el('div', { class: 'labels', id: 'labels' }));
  // clique dos botões da sala e da loja
  root.addEventListener('click', (e) => (e.target as HTMLElement).closest('button') && act.click());

  // convite: no celular abre o compartilhar do sistema (WhatsApp etc.); no PC copia o link e confirma no botão
  const SHARE = TOUCH && !!navigator.share;
  function copyLink(btn?: HTMLElement) {
    const url = location.href;
    if (SHARE) return void navigator.share({ title: TITLE, text: t('Bora jogar Warlock?', 'Wanna play Warlock?'), url }).catch(() => {});
    navigator.clipboard?.writeText(url).then(() => {
      toast(t('Link copiado. Mande no grupo!', 'Link copied. Send it to your group!'), 'good');
      if (!btn) return;
      btn.textContent = t('✓ Link copiado', '✓ Link copied');
      setTimeout(() => (btn.textContent = t('Copiar link da sala', 'Copy room link')), 2000);
    }, () => toast(url));
  }
  const inviteBtn = () => {
    const b: HTMLElement = el('button', { type: 'button', onclick: () => copyLink(b) }, SHARE ? t('Convidar amigos', 'Invite friends') : t('Copiar link da sala', 'Copy room link'));
    return b;
  };

  let room: PublicRoom | null = null;
  let me = '';
  let scope: Scope = 'round';
  let view: View = 'summary';
  const setScope = (s: Scope) => {
    scope = s;
    drawCenter();
    if (!tabOverlay.hidden) showTab(true);
  };
  const setView = (v: View) => {
    view = v;
    drawCenter();
    if (!tabOverlay.hidden) showTab(true);
  };
  let phaseEndsAt = 0;
  let mode: Mode = 'rounds';
  let shuffle = true; // Times: sorteados a cada rodada ou fixos na partida
  let opts: MatchOpts | null = null; // opções da partida escolhidas aqui; começa com as da sala
  let optsOpen = true;
  let setup = false; // fim da partida: true depois do "Voltar à sala"

  function lobbyPanel(r: PublicRoom) {
    const humans = r.players.filter((p) => !p.bot).length;
    const maxBots = MAX_PLAYERS - humans;
    bots = bots.slice(0, maxBots);
    const count = el('b', { class: 'count' }, String(bots.length));
    // uma linha por bot, com o nome que o servidor vai dar (BOT_NAMES, na ordem) e a dificuldade dele
    const rows = () => bots.map((d, i) => {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      return el('label', { class: 'bot-row' }, el('span', {}, icon(UI_ICON.bot), ' ' + name),
        el('select', { 'aria-label': t(`Dificuldade de ${name}`, `${name}'s difficulty`), onchange: (e: Event) => {
          // sem redesenhar a lista: a seta do teclado no seletor continua nele
          bots[i] = (e.target as HTMLSelectElement).value as Level;
          save();
        } },
          ...OPTION_CHOICES.difficulty.map((k) => el('option', { value: k, selected: k === d }, SKILL_NAME[k]))));
    });
    const list = el('div', { class: 'bot-list' }, ...rows());
    const save = () => {
      try {
        sessionStorage.setItem('warlock:bots', JSON.stringify(bots));
      } catch {
        // só nesta tela
      }
    };
    const set = (next: Level[]) => {
      bots = next.slice(0, maxBots);
      save();
      count.textContent = String(bots.length);
      list.replaceChildren(...rows());
      startBtn.toggleAttribute('disabled', humans + bots.length < 2);
    };
    const o = (opts ??= { ...DEFAULT_OPTS, ...r.opts, ...FIXED }); // o que a sala não mostra volta ao padrão (um desafio deixa a morte súbita desligada)
    const startBtn = el('button', { type: 'button', class: 'primary big', disabled: humans + bots.length < 2, onclick: () => act.start(bots, mode, shuffle, o) }, t('Começar partida', 'Start match'));
    const modes: [Mode, string, string][] = [
      ['rounds', MODE_NAME.rounds, t(`O último vivo ganha a rodada. Vence quem fizer ${o.goal} rodadas.`, `The last one alive wins the round. First to win ${o.goal} rounds wins.`)],
      ['deathmatch', MODE_NAME.deathmatch, t(`Rodadas de 60 s, quem cai volta em 10 s. Cada abate vale 1 ponto; vence quem chegar a ${DM_GOALS[o.goal]}.`, `60 s rounds, whoever falls comes back after 10 s. Each kill is worth 1 point; first to ${DM_GOALS[o.goal]} wins.`)],
      ['teams', MODE_NAME.teams, t(`Azul contra Vermelho. A rodada acaba quando só sobra um time, e todos dele ganham 1 ponto; vence quem fizer ${o.goal}. Magia em aliado só empurra.`, `Blue vs Red. The round ends when only one team is left, and everyone on it gets 1 point; first to ${o.goal} wins. Spells on allies only knock back.`)],
    ];
    // Times: o grupo escolhe se os times mudam a cada rodada ou ficam até o fim
    const shufflePicker = mode !== 'teams' ? null : choice(t('Sorteio dos times', 'Team shuffle'), [[true, t('Sorteados a cada rodada', 'Shuffled every round')], [false, t('Fixos na partida', 'Fixed for the match')]], shuffle, (k) => ((shuffle = k), drawCenter()));
    const modePicker = el('div', { class: 'mode' },
      el('div', { class: 'opt-label' }, choice(t('Modo de jogo', 'Game mode'), modes.map(([k, label]): [Mode, string] => [k, label]), mode, (k) => ((mode = k), drawCenter())), infoButton(t('Modos de jogo', 'Game modes'), MODE_INFO)),
      el('small', { class: 'muted' }, modes.find(([k]) => k === mode)![2]), shufflePicker);
    // opções da partida: uma fileira de botões por opção, como o seletor de modo; vão junto com o "Começar"
    // abertas por padrão: quem cria a sala vê as opções sem procurar (fechar fica guardado até sair da sala)
    const optsBlock = el('details', { class: 'match-opts', open: optsOpen, ontoggle: (e: Event) => (optsOpen = (e.target as HTMLDetailsElement).open) }, el('summary', {}, t('Opções da partida', 'Match options') + ' · ', el('small', { class: 'muted' }, optsLine(o, mode))),
      el('div', { class: 'opt-grid' }, ...OPT_KEYS.map((k) => el('div', { class: 'opt-row' }, optLabel(k, mode),
        choice(OPT_NAME[k], (OPTION_CHOICES[k] as readonly MatchOpts[OptKey][]).map((val): [MatchOpts[OptKey], string] => [val, optText(k, val, mode)]), o[k], (val) => (Object.assign(o, { [k]: val }), drawCenter()))))));
    return el('div', { class: 'card room-wait' },
      el('div', {}, el('h2', { class: 'title' }, t('Sala ', 'Room ') + r.id), el('p', { class: 'muted' }, t('Mande o link para os amigos entrarem. Até 8 magos.', 'Send the link so your friends can join. Up to 8 wizards.')),
        el('ul', { class: 'board' }, ...r.players.map((p) => el('li', {}, el('span', {}, teamTag(r, p), dot(p.color), ' ', nameOf(p, me), p.connected || p.bot ? '' : t(' · caiu', ' · dropped')), kickBtn(p, act.kick))))),
      // no PC em colunas, lado a lado (Fernando, 19/10: "tá muito vertical"); no celular uma embaixo da outra
      el('div', { class: 'lobby-cols' },
        el('div', { class: 'lobby-col' },
          el('div', { class: 'bots' }, el('span', {}, 'Bots ', infoButton(t('Dificuldade dos bots', 'Bot difficulty'), () => OPT_INFO.difficulty(mode))),
            el('button', { type: 'button', 'aria-label': t('Menos um bot', 'One less bot'), onclick: () => set(bots.slice(0, -1)) }, '−'), count, el('button', { type: 'button', 'aria-label': t('Mais um bot', 'One more bot'), onclick: () => set([...bots, 'normal']) }, '+')),
          list,
        ),
        el('div', { class: 'lobby-col' }, modePicker, optsBlock),
      ),
      // Começar e Convidar grudados no rodapé enquanto rola as opções
      el('div', { class: 'card-go' },
        el('div', { class: 'card-go-main' }, startBtn, el('button', { type: 'button', class: 'room-back secondary', onclick: act.backToMenu }, '← ', t('Menu principal', 'Main menu'))),
        inviteBtn()),
    );
  }

  // "Voltar à sala" e "Sair do desafio": a sala de espera começa com as opções da partida que acabou
  function toRoom(r: PublicRoom) {
    setup = true;
    mode = r.mode;
    shuffle = r.teamShuffle;
    opts = { ...r.opts, ...FIXED };
    bots = r.players.filter((p) => p.bot).map((p) => p.difficulty ?? 'normal');
    drawCenter();
    center.scrollTop = 0;
  }

  // fim da partida: resultado e as duas saídas rápidas no topo; "Voltar à sala" mostra a sala de espera para trocar modo e opções
  function endPanel(r: PublicRoom) {
    const levels = r.players.filter((p) => p.bot).map((p) => p.difficulty ?? r.opts.difficulty);
    const roomBots = levels.length;
    const humans = r.players.filter((p) => !p.bot && p.connected).length;
    const again = el('button', { type: 'button', class: 'primary big', disabled: humans + roomBots < 2, onclick: () => act.start(levels, r.mode, r.teamShuffle, r.opts, true) }, t('Jogar de novo', 'Play again'));
    // cabeçalho grande: Vitória (eu ou meu time), Derrota (outro venceu) ou Fim de jogo (sem vencedor ou só assistindo)
    const res = endResult(r, me);
    const noWinner = !r.winner && r.winnerTeam === null;
    return el('div', { class: 'card' },
      el('div', { class: 'end-head' },
        el('h2', { class: 'end-title ' + res }, res === 'win' ? t('Vitória', 'Victory') : res === 'loss' ? t('Derrota', 'Defeat') : t('Fim de jogo', 'Game over')),
        el('p', { class: 'end-winner' }, ...(noWinner ? [t('Partida encerrada sem vencedor (empate ou ninguém fez ponto).', 'Match ended with no winner (a draw, or nobody scored).')] : winTitle(r)))),
      podium(r, me),
      el('div', { class: 'end-actions' }, again, el('button', { type: 'button', class: 'big', onclick: () => {
        curtain();
        toRoom(r);
      } }, t('Voltar à sala', 'Back to lobby'))),
      el('small', { class: 'muted end-hint' }, t(`Jogar de novo repete tudo: ${MODE_NAME[r.mode]}, ${roomBots} ${roomBots === 1 ? 'bot' : 'bots'}, ${optsLine(r.opts, r.mode)}.`, `Play again repeats everything: ${MODE_NAME[r.mode]}, ${roomBots} ${roomBots === 1 ? 'bot' : 'bots'}, ${optsLine(r.opts, r.mode)}.`)),
      statsBoard(r, me, scope, setScope, view, setView, act.kick));
  }

  // estado da loja que sobrevive ao redesenho (a sala manda o estado a cada compra de qualquer jogador)
  let goldOpen = false;
  let sheetOpen = true;
  let shopQuery = ''; // busca da loja: fica ao redesenhar (a sala manda o estado a cada segundo)
  const shopSearch = () => el('input', { type: 'search', class: 'lib-search', 'data-key': 'shop-search', value: shopQuery, placeholder: t('Buscar pelo nome', 'Search by name'), 'aria-label': t('Buscar na loja pelo nome', 'Search the shop by name'),
    oninput: (e: Event) => {
      shopQuery = (e.target as HTMLInputElement).value;
      filterShop((e.target as HTMLElement).closest('.shop')!);
    } });
  // esconde os ícones que não batem com a busca e os grupos que ficaram vazios
  function filterShop(box: HTMLElement) {
    const q = norm(shopQuery.trim());
    for (const g of box.querySelectorAll<HTMLElement>('.shop-group')) {
      const cards = [...g.querySelectorAll<HTMLElement>('.shop-item')];
      for (const c of cards) c.hidden = !c.dataset.name!.includes(q);
      g.hidden = cards.every((c) => c.hidden);
    }
    return box;
  }
  let readyBtn: HTMLElement | null = null;
  // cartão de primeira vez na loja da rodada 0: some ao fechar ou ao apertar Pronto, e fica guardado no navegador
  const FIRST = 'warlock:firstshop';
  let firstSeen = store.get(FIRST) === '1';
  const seeFirst = () => {
    firstSeen = true;
    store.set(FIRST, '1');
  };
  const firstCard = () => el('div', { class: 'first-tip', role: 'note' },
    el('p', {}, el('b', {}, t('Primeira vez? ', 'First time? ')), TOUCH
      ? t('Toque no chão para andar · toque numa magia e depois no chão para lançar · compre 1 ou 2 magias e aperte Pronto.', 'Tap the ground to walk · tap a spell and then the ground to cast · buy 1 or 2 spells and press Ready.')
      : isPadMode() ? t('Analógico esquerdo anda · A atira a Bola de fogo para onde o direito mira · compre 1 ou 2 magias e aperte Start (Pronto).', 'Left stick moves · A shoots the Fireball where the right stick aims · buy 1 or 2 spells and press Start (Ready).')
      : t(`Botão direito anda · ${labelOf('fireball')} atira a Bola de fogo na direção do mouse · compre 1 ou 2 magias e aperte Pronto.`, `Right click moves · ${labelOf('fireball')} shoots the Fireball toward the mouse · buy 1 or 2 spells and press Ready.`)),
    el('button', { type: 'button', class: 'link', onclick: () => { seeFirst(); drawCenter(); } }, t('Entendi', 'Got it')));
  const readyText = (ready: boolean) => `${ready ? t('Esperando os outros', 'Waiting for the others') : t('Pronto', 'Ready')} · ${Math.ceil(Math.max(0, (phaseEndsAt - performance.now()) / 1000))} s`;

  // peek: a loja só para ver no meio da rodada (sem comprar, vender nem Pronto); morto nas Rodadas e nos Times ela vale de verdade
  function shopPanel(r: PublicRoom, look = false) {
    const peek = look && !deadShop && !r.sandbox;
    const mine = r.players.find((p) => p.id === me);
    // desfazer: só o que foi comprado nesta loja (devolve o ouro)
    const undoBtn = (key: string) => (!peek && mine?.bought.includes(key) ? el('button', { type: 'button', class: 'undo', title: t('Desfazer a compra (devolve o ouro)', 'Undo the purchase (refunds the gold)'), 'aria-label': t('Desfazer a compra', 'Undo the purchase'), 'data-key': 'undo-' + key, onclick: () => act.undo(key) }, '↩') : null);
    if (!mine) return el('div', { class: 'card' }, el('p', {}, t('Você está assistindo. Entra na próxima partida.', 'You are watching. You join the next match.')));
    // vender: magia ou item inteiro; o comprado nesta loja volta inteiro, o de antes pela metade
    const sellBtn = (key: string) => {
      const value = sellValue(mine, r.round, key);
      // a Bola de fogo vende mesmo valendo 0 (o nível 1 é grátis): libera a vaga e a tecla
      const title = value > 0 ? t('Vende tudo e devolve 100% do que você pagou', 'Sells everything and refunds 100% of what you paid') : t('O nível 1 é grátis e volta 0 de ouro; vender libera a vaga de magia (compra de volta de graça)', 'Level 1 is free and refunds 0 gold; selling frees the spell slot (buy it back for free)');
      return !peek && canSell(mine, r.round, key) ? el('button', { type: 'button', class: 'sell', title, 'aria-label': value > 0 ? t(`Vender por ${value} de ouro`, `Sell for ${value} gold`) : t('Vender', 'Sell'), 'data-key': 'sell-' + key, onclick: () => act.sell(key) }, icon(UI_ICON.gold), el('span', { class: 'sell-txt' }, value > 0 ? t(`Vender ${value}`, `Sell ${value}`) : t('Vender', 'Sell'))) : null;
    };
    // um cartão por magia ou item: "dá para comprar" e "já tenho" à vista, e quanto falta quando o ouro não dá
    type Offer = { key: string; ico: string; name: string; hotkey: string | null; use: string; lvl: number; max: number; price: number | null; blocked: string | null; buy: () => void; tip: () => string;
      // a ficha depois de comprar mais um nível e depois de vender tudo (prévia na dica)
      bought: () => SheetRow[]; sold: () => SheetRow[] };
    const now = sheet(mine.spells, mine.items);
    const sheetBox = () => el('details', { class: 'sheet-box', open: sheetOpen, ontoggle: (e: Event) => (sheetOpen = (e.target as HTMLDetailsElement).open) },
      el('summary', {}, t('Ficha do mago', 'Wizard sheet')), sheetEl(now, el('small', { class: 'muted' }, t('Passe o mouse num item para ver o que muda.', 'Hover an item to see what changes.'))));
    const offer = (o: Offer) => {
      const open = o.price !== null && !o.blocked;
      const can = open && mine.gold >= o.price!;
      const key = o.key.replace('-', ':'); // spell:x ou item:y, como na compra
      const cost = o.price === 0 ? t('de graça', 'for free') : t(`por ${o.price} de ouro`, `for ${o.price} gold`);
      const full = o.blocked ?? (o.lvl ? t(`Subir para o nível ${o.lvl + 1} ${cost}`, `Upgrade to level ${o.lvl + 1} ${cost}`) : t(`Comprar ${cost}`, `Buy ${cost}`));
      // ícone quadrado como na loja do Dota (decisão do Fernando, 19/10): tecla no canto, nível em pips e embaixo a moeda e o preço
      // (vermelho quando o ouro não dá); o nome vai dentro do cartão (Fernando, 19/10) e o que faz fica na dica
      const face = [o.hotkey !== null ? el('span', { class: 'key' }, o.hotkey) : null, el('span', { class: 'ico' }, icon(o.ico)), el('span', { class: 'tile-name' }, o.name), el('span', { class: 'pips' }, ...pipsOf(o.lvl, o.max)),
        el('span', { class: 'tile-price' + (o.blocked ? ' off' : can ? ' can' : ' cant') }, ...(o.blocked ? [o.blocked] : [o.lvl ? t(`Nv ${o.lvl + 1} `, `Lv ${o.lvl + 1} `) : '', icon(UI_ICON.gold), o.price === 0 ? t(' grátis', ' free') : ` ${o.price}`]))];
      // clique compra; clique direito também (como no Dota); só ver: o ícone não compra
      return withTip(el('div', { class: 'shop-item' + (o.key.startsWith('item') ? ' is-item' : '') + (o.lvl ? ' owned' : '') + (can && !peek ? ' can' : '') + (o.blocked && !o.lvl ? ' locked' : ''), 'data-name': norm(o.name),
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          if (can && !peek) o.buy();
        } },
        peek ? el('div', { class: 'shop-tile', role: 'img', 'aria-label': `${o.name}: ${full}` }, ...face)
          : el('button', { type: 'button', class: 'shop-tile', 'data-key': o.key, disabled: !can, 'aria-label': `${o.name}: ${full}`, onclick: o.buy }, ...face),
        el('div', { class: 'tile-acts' }, undoBtn(key), sellBtn(key)),
      ), () => {
        const sell = peek ? 0 : sellValue(mine, r.round, key);
        return o.tip() + (o.key.startsWith('spell') ? `<p><i>${o.use}</i></p>` : '')
          + (peek && can ? `<p class="up">${t('Você pode comprar isto na próxima loja.', 'You can buy this in the next shop.')}</p>` : '')
          // magia: a própria dica já mostra o nível atual → o próximo
          + (o.key.startsWith('spell') || o.blocked ? '' : previewHtml(o.lvl ? t('Se subir de nível', 'If you level up') : t('Se comprar', 'If you buy'), diff(now, o.bought())))
          + (sell > 0 ? previewHtml(t('Se vender', 'If you sell'), diff(now, o.sold()), `<small>${t(`Volta ${sell} de ouro.`, `Refunds ${sell} gold.`)}</small>`) : '');
      });
    };
    const spellOffer = (s: SpellId) => {
      const lvl = mine.spells[s];
      const price = priceOf(s, lvl);
      const full = lvl === 0 && spellCount(mine.spells) >= MAX_SPELLS;
      return offer({ key: 'spell-' + s, ico: ICON[s], name: spellName(s), hotkey: labelOf(s), use: SPELL_USE[s], lvl, max: MAX_SPELL_LEVEL, price,
        blocked: price === null ? t('Máximo', 'Max') : full ? t(`Limite de ${MAX_SPELLS} magias`, `Limit of ${MAX_SPELLS} spells`) : null, buy: () => act.buy(s), tip: () => spellTip(s, lvl),
        bought: () => sheet({ ...mine.spells, [s]: lvl + 1 }, mine.items), sold: () => sheet({ ...mine.spells, [s]: 0 }, mine.items) });
    };
    const itemOffer = (i: ItemId) => {
      const lvl = mine.items[i];
      const price = itemPrice(mine.items, i);
      return offer({ key: 'item-' + i, ico: ITEM_ICON[i], name: itemName(i), hotkey: isActive(i) ? labelOf(i) : null, use: itemText(i), lvl, max: ITEMS[i].levels.length, price,
        blocked: lvl >= ITEMS[i].levels.length ? t('Máximo', 'Max') : price === null ? t('Sem espaço', 'No room') : null, buy: () => act.buyItem(i), tip: () => itemTip(i, lvl),
        bought: () => sheet(mine.spells, { ...mine.items, [i]: lvl + 1 }), sold: () => sheet(mine.spells, { ...mine.items, [i]: 0 }) });
    };
    const group = (title: string, hint: string, cards: HTMLElement[]) =>
      el('section', { class: 'shop-group ' + groupClass(title) }, el('div', { class: 'shop-head' }, el('h3', {}, title), el('small', {}, hint)), el('div', { class: 'shop-grid' }, ...cards));
    const itemCount = t(`${ITEM_IDS.filter((i) => mine.items[i] > 0).length} de ${MAX_ITEMS} itens`, `${ITEM_IDS.filter((i) => mine.items[i] > 0).length} of ${MAX_ITEMS} items`);
    const grid = SPELL_GROUPS.map(([title, hint, ids]) => group(title, hint, ids.map(spellOffer)));
    // itens numa coluna à esquerda, com cor própria (Fernando, 19/10: distintos das magias e loja mais horizontal)
    const items = () => el('div', { class: 'shop-items' },
      group(t('Itens passivos', 'Passive items'), itemCount, ITEM_IDS.filter((i): boolean => !isActive(i)).map(itemOffer)),
      group(t('Itens ativos', 'Active items'), t('cada um com a sua tecla', 'each with its own key'), ACTIVE_ITEMS.map(itemOffer)));
    if (look) return filterShop(el('div', { class: 'card shop' }, items(), el('div', { class: 'shop-main' },
      el('div', { class: 'shop-head' }, el('h2', { class: 'title' }, r.sandbox ? t('Loja · sandbox', 'Shop · sandbox') : deadShop ? t('Loja · você caiu: monte a build', 'Shop · you fell: build your kit') : t('Loja · só para ver', 'Shop · view only')), el('small', {}, t(`${spellCount(mine.spells)} de ${MAX_SPELLS} magias · ${r.sandbox ? 'ouro sem fim: compre e venda, vale na hora' : deadShop ? 'compre e venda já; o ouro da rodada entra quando ela acabar' : 'a compra abre entre as rodadas'}`, `${spellCount(mine.spells)} of ${MAX_SPELLS} spells · ${r.sandbox ? 'endless gold: buy and sell, it applies right away' : deadShop ? 'buy and sell now; the round gold arrives when it ends' : 'buying opens between rounds'}`)),
        el('button', { type: 'button', class: 'icon peek-close', title: t(`Fechar (${uiLabel('shop')} ou Esc)`, `Close (${uiLabel('shop')} or Esc)`), 'aria-label': t('Fechar a loja', 'Close the shop'), onclick: () => togglePeek(false) }, '✕')),
      shopSearch(),
      ...grid),
      el('aside', { class: 'shop-side' }, el('span', { class: 'gold big' }, gold(mine.gold)), sheetBox())));
    readyBtn = el('button', { type: 'button', class: 'primary big', 'data-key': 'ready', disabled: mine.ready, onclick: () => {
      if (r.round === 0) seeFirst();
      act.ready();
    } }, readyText(mine.ready));
    // compras no meio; ouro, Pronto e placar à direita (pedido do Fernando: loja mais larga; o personagem saiu para o menu principal e as Configurações)
    return filterShop(el('div', { class: 'card shop' }, items(), el('div', { class: 'shop-main' },
      el('div', { class: 'shop-head' }, el('h2', { class: 'title' }, r.round === 0 ? t('Loja', 'Shop') : t(`Loja · depois da rodada ${r.round}`, `Shop · after round ${r.round}`)), el('small', {}, t(`${spellCount(mine.spells)} de ${MAX_SPELLS} magias`, `${spellCount(mine.spells)} of ${MAX_SPELLS} spells`))),
      shopSearch(),
      r.round === 0 && !firstSeen ? firstCard() : null,
      ...grid,
      ),
      el('aside', { class: 'shop-side' },
        el('span', { class: 'gold big' }, gold(mine.gold)),
        readyBtn,
        el('button', { type: 'button', 'data-key': 'placar', onclick: () => pinTab(true) }, icon(UI_ICON.board), ' ' + t('Placar', 'Scoreboard')),
        sheetBox(),
        goldInfo(mine, r.opts, goldOpen, (open) => (goldOpen = open)),
        nextModePicker(r),
        board(r, me, act.kick),
      ),
    ));
  }

  // loja: modo da próxima rodada à vista; clicar abre a votação (sozinho com bots passa na hora)
  function nextModePicker(r: PublicRoom) {
    const next = r.pendingMode ?? r.mode;
    return el('div', { class: 'mode' },
      el('small', { class: 'opts-line' }, optsLine({ ...r.opts, ...r.pendingOpts }, next)),
      el('small', { class: 'muted' }, t('Modo da próxima rodada', 'Next round mode')),
      choice(t('Modo da próxima rodada', 'Next round mode'), MODES.map((k): [Mode, string] => [k, MODE_NAME[k]]), next, (k) => k !== next && act.vote('mode', k), (k) => !!r.vote && k !== next),
      next === 'teams' ? el('button', { type: 'button', disabled: !!r.vote, onclick: () => act.vote('shuffle') }, t(`Times ${SHUFFLE_NAME(r.pendingShuffle ?? r.teamShuffle)} · trocar`, `Teams ${SHUFFLE_NAME(r.pendingShuffle ?? r.teamShuffle)} · change`)) : null,
      r.pendingMode ? el('small', {}, t(`Próxima rodada: ${MODE_NAME[r.pendingMode]} (os pontos zeram)`, `Next round: ${MODE_NAME[r.pendingMode]} (points reset)`)) : null,
      r.vote ? el('small', { class: 'muted' }, t('Votação aberta no topo da tela.', 'Vote open at the top of the screen.')) : null);
  }

  function drawVote(r: PublicRoom, prev: PublicRoom | null) {
    const v = r.vote;
    const human = !!mine && !mine.bot;
    voteWrap.hidden = !human || !VOTE_PHASES.includes(r.phase);
    const close = (f: () => void) => () => {
      toggle(votePanel, voteBtn, false);
      f();
    };
    const next = r.pendingMode ?? r.mode;
    const vote = (kind: Vote['kind'], target?: string) => close(() => act.vote(kind, target));
    const btn = (label: string, kind: Vote['kind'], target?: string) => el('button', { type: 'button', disabled: !!v, onclick: vote(kind, target) }, label);
    // grupos recolhíveis para a lista não ficar enorme
    // a sala atualiza a cada segundo: o grupo aberto e a rolagem continuam como estavam
    const opened = new Set([...votePanel.querySelectorAll<HTMLDetailsElement>('details[open] > summary')].map((x) => x.textContent));
    const scroll = votePanel.scrollTop;
    const group = (title: string, ...items: Child[]) => el('details', { class: 'vote-group', open: opened.has(title) }, el('summary', {}, title), ...items);
    const nextOpts = { ...r.opts, ...r.pendingOpts };
    const bots = r.players.filter((p) => p.bot).length + r.botDelta;
    queueMicrotask(() => (votePanel.scrollTop = scroll));
    votePanel.replaceChildren(el('b', {}, t('Votação', 'Voting')),
      v ? el('small', { class: 'muted' }, t('Já tem uma votação aberta.', 'A vote is already open.')) : '',
      group(t('Partida', 'Match'),
        btn(t('Reiniciar a partida', 'Restart the match'), 'restart'),
        btn(t('Encerrar agora (vence quem tem mais pontos)', 'End now (whoever has the most points wins)'), 'end'),
        r.phase === 'shop' ? btn(t('Pular a loja', 'Skip the shop'), 'skipShop') : '',
        ...MODES.filter((k) => k !== next).map((k) => btn(t(`Trocar para ${MODE_NAME[k]}`, `Switch to ${MODE_NAME[k]}`), 'mode', k)),
        next === 'teams' ? btn(t(`Times ${SHUFFLE_NAME(!(r.pendingShuffle ?? r.teamShuffle))}`, `Teams ${SHUFFLE_NAME(!(r.pendingShuffle ?? r.teamShuffle))}`), 'shuffle') : ''),
      group(t('Regras', 'Rules'),
        el('small', { class: 'muted' }, optsLine(nextOpts, next)),
        ...OPT_KEYS.map((k) => el('div', { class: 'opt-row' }, optLabel(k, next),
          ...(OPTION_CHOICES[k] as readonly MatchOpts[OptKey][]).filter((val) => val !== nextOpts[k]).map((val) => btn(optText(k, val, next), 'opt', `${k}:${val}`))))),
      group(t('Jogadores', 'Players'),
        r.players.length + Math.max(0, r.botDelta) < MAX_PLAYERS ? btn(t('Pôr um bot', 'Add a bot'), 'addBot') : '',
        bots > 0 ? btn(t('Tirar um bot', 'Remove a bot'), 'removeBot') : '',
        ...r.players.filter((p) => !p.bot && p.id !== me).map((p) => btn(t(`Expulsar ${p.name}`, `Kick ${p.name}`), 'kick', p.id))),
      el('small', { class: 'muted' }, t('Passa com mais da metade dos jogadores. Modo, regras e bots valem na próxima rodada; o modo novo zera os pontos, o ouro fica.', 'Passes with more than half of the players. Mode, rules and bots apply next round; a new mode resets the points, gold stays.')));
    // fim da votação: aprovada se o que ela muda mudou
    const was = prev?.vote;
    const passed = (k: Vote['kind']) => k === 'mode' ? r.pendingMode !== prev!.pendingMode : k === 'shuffle' ? r.pendingShuffle !== prev!.pendingShuffle
      : k === 'opt' ? JSON.stringify(r.pendingOpts) !== JSON.stringify(prev!.pendingOpts) : k === 'restart' ? r.round === 0 : k === 'end' ? r.phase === 'end'
        : k === 'addBot' || k === 'removeBot' ? r.botDelta !== prev!.botDelta : k === 'skipShop' ? r.phase !== 'shop' || r.phaseLeft < 1500 : !r.players.some((p) => p.id === was!.target);
    if (was && !v) toast(passed(was.kind) ? t('Votação aprovada.', 'Vote passed.') : t('Votação recusada.', 'Vote rejected.'));
    voteBar.hidden = !v;
    if (!v) return;
    voteEndsAt = performance.now() + v.left;
    const name = (id: string) => r.players.find((p) => p.id === id)?.name ?? '?';
    const can = human && !v.yes.includes(me) && !v.no.includes(me);
    voteBar.replaceChildren(
      el('span', {}, t(`${name(v.by)} quer ${voteText(v, r.pendingMode ?? r.mode, name)} · SIM ${v.yes.length} / precisa ${v.need}`, `${name(v.by)} wants to ${voteText(v, r.pendingMode ?? r.mode, name)} · YES ${v.yes.length} / needs ${v.need}`)),
      can ? el('button', { type: 'button', class: 'primary', onclick: () => act.ballot(true) }, t('Sim', 'Yes')) : '',
      can ? el('button', { type: 'button', onclick: () => act.ballot(false) }, t('Não', 'No')) : '',
      voteLeft,
    );
  }

  // recarga terminou na partida: o botão pisca (style.css .ready-flash) e toca o "plim"
  function cooled(b: HTMLElement, left: number) {
    const was = b.classList.contains('cooling');
    b.classList.toggle('cooling', left > 0.05);
    if (!was || left > 0.05 || room?.phase !== 'playing' || b.hidden) return;
    b.classList.remove('ready-flash');
    void b.offsetWidth; // reinicia a animação
    b.classList.add('ready-flash');
    act.spellReady();
  }

  let centerPhase = '';
  function drawCenter() {
    if (!room) return;
    const r = room;
    // redesenhar a loja não pode tirar o foco de quem usa o teclado
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
    hideTip(center);
    // "Voltar à sala" mostra a sala de espera: mesma largura dela, não a do fim
    center.classList.toggle('wide', r.phase === 'shop' || r.phase === 'lobby' || r.phase === 'end'); // a sala também, em colunas
    // o painel entra animado só quando a fase muda (a loja redesenha a cada compra e não pode ficar "pulando")
    const entering = r.phase !== centerPhase;
    center.classList.toggle('enter', entering);
    centerPhase = r.phase;
    center.replaceChildren(r.phase === 'lobby' || (r.phase === 'end' && setup) ? lobbyPanel(r) : r.phase === 'end' ? endPanel(r) : r.phase === 'shop' ? shopPanel(r) : '');
    const shopOpen = r.phase === 'shop';
    if (shopOpen !== center.classList.contains('shop-open')) {
      center.classList.toggle('shop-open', shopOpen);
      const size = shopOpen ? store.json<[string, string]>(SHOP_SIZE) : null;
      center.style.width = size?.[0] ?? '';
      center.style.height = size?.[1] ?? '';
    }
    // painel novo começa do topo (o fim da partida herdava a rolagem da loja e escondia o título e o pódio)
    if (entering) center.scrollTop = 0;
    if (!online) center.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
    refocus(center, focused);
  }

  // abates e dano da rodada somados no cliente a partir dos acertos (a ficha usa o dano levado)
  let live: Record<string, { dmg: number; kills: number; taken?: number }> = {};
  // lista à esquerda (Fernando, 19/10: "não dá pra saber pelo rosto"): nome na cor do jogador, vitórias e dano/abates da rodada; nos Times, um bloco por time
  // a sala manda o estado a cada segundo: só redesenha quando algo da lista muda (o apagado de quem caiu vem do frame, os números da rodada de live())
  const topCells = new Map<string, { c: HTMLElement; name: string; dmg: HTMLElement; kills: HTMLElement }>();
  let shownDead: string | null = null;
  function drawTops() {
    if (!room) return;
    const r = room;
    const sig = [me, r.mode, ...r.players.map((p) => [p.id, p.name, p.character, p.color, p.team, p.score].join(':'))].join();
    if (sig === tops.dataset.sig) return;
    tops.dataset.sig = sig;
    topCells.clear();
    shownDead = null; // o próximo frame reaplica quem está caído
    const unit = (n: number) => r.mode === 'deathmatch' ? (n === 1 ? t('ponto', 'point') : t('pontos', 'points')) : n === 1 ? t('vitória', 'win') : t('vitórias', 'wins');
    const cell = (p: PublicPlayer) => {
      const name = `${p.name}${p.id === me ? t(' (você)', ' (you)') : ''}: ${p.score} ${unit(p.score)}`;
      const dmg = el('span', {}, String(Math.round(live[p.id]?.dmg ?? 0)));
      const kills = el('span', {}, String(live[p.id]?.kills ?? 0));
      const c = el('li', { class: 'top-p' + (p.id === me ? ' me' : ''), style: `--pc:${COLORS[p.color]}`, title: name, 'aria-label': name },
        el('span', { class: 'top-name' }, p.name), el('b', { class: 'top-wins', title: unit(p.score) }, String(p.score)),
        el('span', { class: 'top-stat', title: t('Dano na rodada', 'Damage this round') }, icon(UI_ICON.dmg), dmg),
        el('span', { class: 'top-stat', title: t('Abates na rodada', 'Kills this round') }, icon(UI_ICON.kills), kills));
      topCells.set(p.id, { c, name, dmg, kills });
      return c;
    };
    const row = (list: PublicPlayer[], team?: number) => el('ul', team === undefined ? {} : { class: 'team', style: `--tc:${TEAM_COLORS[team]}`, 'aria-label': teamLabel(team) }, ...list.map(cell));
    tops.replaceChildren(...(r.mode === 'teams'
      ? [row(r.players.filter((p) => p.team === 0), 0), el('span', { class: 'vs', 'aria-hidden': 'true' }, '×'), row(r.players.filter((p) => p.team !== 0), 1)]
      : [row(r.players)]));
  }

  return {
    // abate no feed: by null = caiu sozinho na lava; destacado quando envolve você
    kill(by: string | null, id: string, src: string) {
      const who = (pid: string) => {
        const p = room?.players.find((q) => q.id === pid);
        return el('b', { style: `color:${COLORS[p?.color ?? 0]}` }, pid === me ? t('Você', 'You') : (p?.name ?? '?'));
      };
      const killer = by && by !== id ? by : null;
      const li = el('li', { class: killer === me || id === me ? 'me' : '' }, killer ? who(killer) : null,
        el('span', { class: 'feed-ico', title: killer ? srcName(src) : 'lava' }, srcIcon(killer ? src : 'lava')), who(id), killer ? null : el('small', {}, t('caiu na lava', 'fell into the lava')));
      feed.append(li);
      while (feed.children.length > 5) feed.firstElementChild!.remove();
      setTimeout(() => li.remove(), 5000);
    },
    // morto nas Rodadas e nos Times: a loja passa a comprar e vender; no PC abre sozinha uma vez, como gaveta à direita (a partida fica à vista)
    deadShopping(on: boolean) {
      if (on === deadShop) return;
      deadShop = on;
      if (on) peekPanel.classList.add('drawer'); // sai ao fechar a loja (togglePeek): no fim da rodada a gaveta aberta não pula para o meio
      shopNudge.hidden = !on;
      // abre 1,5 s depois da queda: antes passa a faixa "Você caiu"
      if (on && DRAWER.matches) setTimeout(() => deadShop && peekPanel.hidden && togglePeek(true), 1500);
      drawPeek();
    },
    watching(name: string | null) {
      watchBadge.hidden = !name;
      if (watchingNow !== !!name) {
        watchingNow = !!name;
        syncBar();
      }
      if (name && watchName.textContent !== name) watchName.textContent = name;
    },
    // ready: dá para rever a queda; text: o replay está passando (quem derrubou e com o quê)
    replay(ready: boolean, text: string | null) {
      replayBar.hidden = !ready && !text;
      replayText.hidden = !text;
      if (text && replayText.textContent !== text) replayText.textContent = text;
      const k = uiLabel('replay');
      const label = text ? (TOUCH ? t('Sair', 'Exit') : t('Sair (Esc)', 'Exit (Esc)')) : TOUCH || k === '—' ? t('Rever a queda', 'Replay the fall') : t(`Rever a queda (${k})`, `Replay the fall (${k})`);
      if (replayBtn.textContent !== label) replayBtn.textContent = label;
    },
    // again: botão Repetir no fim de um desafio; quit: botão Sair do desafio (durante e depois dele)
    coach(text: string | null, again?: () => void, quit?: () => void) {
      // primeira loja: o cartão "Primeira vez?" já diz o que fazer; a dica do treino espera ele sair
      coach.hidden = !text || !!center.querySelector('.first-tip');
      if (text && coachText.textContent !== text) coachText.textContent = text;
      coachAgain.hidden = !again;
      coachAgain.onclick = again ?? null;
      coachQuit.hidden = !quit;
      coachQuit.onclick = quit ?? null;
    },
    // fim da partida direto na sala de espera (Sair do desafio)
    toRoom() {
      if (room) toRoom(room);
    },
    danger(low: boolean, lava: boolean) {
      danger.classList.toggle('low', low);
      danger.classList.toggle('lava', lava);
      document.body.classList.toggle('in-lava', lava);
    },
    // seta na borda da tela apontando para quem bateu (ângulo em radianos, 0 = direita, cresce para baixo)
    hitFrom(angle: number) {
      const a = el('div', { class: 'hit-arrow', 'aria-hidden': 'true', style: `left:calc(50% + ${(Math.cos(angle) * 44).toFixed(1)}vw);top:calc(50% + ${(Math.sin(angle) * 40).toFixed(1)}vh);--a:${angle.toFixed(3)}rad` });
      danger.after(a);
      setTimeout(() => a.remove(), 900);
    },
    live(stats: Record<string, { dmg: number; kills: number; taken?: number }>) {
      live = stats;
      for (const [id, { dmg, kills }] of topCells) {
        dmg.textContent = String(Math.round(stats[id]?.dmg ?? 0));
        kills.textContent = String(stats[id]?.kills ?? 0);
      }
      drawSheet();
    },
    update(r: PublicRoom, you: string, isOnline: boolean) {
      // a loja abre mostrando a rodada que acabou; o fim mostra a partida inteira
      if (room && room.phase !== r.phase) {
        scope = r.phase === 'end' ? 'match' : 'round';
        setup = false;
      }
      const prev = room;
      room = r;
      me = you;
      phaseEndsAt = performance.now() + r.phaseLeft;
      setOnline(isOnline);
      // loja só para ver: botão só durante a rodada; fecha sozinha quando a loja de verdade abre (ou a partida acaba)
      peekBtn.hidden = !PEEK_PHASES.includes(r.phase);
      if (!peekPanel.hidden && !PEEK_PHASES.includes(r.phase)) togglePeek(false);
      else drawPeek();
      drawSandbox(r);
      roundEl.textContent = [
        // sala de espera e fim da partida: a rodada já não diz nada
        r.sandbox && r.phase !== 'lobby' && r.phase !== 'end' ? t('Sandbox · vida e ouro sem fim', 'Sandbox · endless health and gold')
          : r.round > 0 && r.phase !== 'lobby' && r.phase !== 'end' ? (r.mode === 'deathmatch' ? t(`Deathmatch · rodada ${r.round} · ${r.goal} abates para vencer`, `Deathmatch · round ${r.round} · ${r.goal} kills to win`) : t(`${r.mode === 'teams' ? 'Times · ' : ''}Rodada ${r.round} · vence quem fizer ${r.goal}`, `${r.mode === 'teams' ? 'Teams · ' : ''}Round ${r.round} · first to ${r.goal} wins`)) : '',
        r.pendingMode && r.phase !== 'end' ? t(`Próxima rodada: ${MODE_NAME[r.pendingMode]}`, `Next round: ${MODE_NAME[r.pendingMode]}`) : '',
        r.pendingShuffle !== null && r.phase !== 'end' ? t(`Próxima rodada: times ${SHUFFLE_NAME(r.pendingShuffle)}`, `Next round: teams ${SHUFFLE_NAME(r.pendingShuffle)}`) : '',
      ].filter(Boolean).join(' · ');
      tops.hidden = !PEEK_PHASES.includes(r.phase); // contagem, rodada e fim da rodada
      drawTops();
      mine = r.players.find((p) => p.id === you);
      for (const i of ACTIVE_ITEMS) itemButtons.get(i)!.b.hidden = !mine?.items[i];
      // meu retrato na barra: só troca quando muda o personagem ou o nome
      const face = mine ? `/chars/${mine.character}.webp` : '';
      if (mine && heroFace.getAttribute('src') !== face) heroFace.src = face;
      if (mine && heroFace.alt !== mine.name) heroFace.alt = mine.name;
      // grade de itens: ativos comprados, depois os passivos (com o nível) e as vagas vazias
      // a sala manda atualização a cada segundo: recriar sem mudança fecharia a dica aberta nos itens
      const owned = ITEM_IDS.filter((i): boolean => (mine?.items[i] ?? 0) > 0);
      const sig = owned.map((i) => i + mine!.items[i]).join();
      if (sig !== itemGrid.dataset.sig) {
        itemGrid.dataset.sig = sig;
        const passive = owned.filter((i) => !isActive(i));
        itemGrid.replaceChildren(...ACTIVE_ITEMS.map((i) => itemButtons.get(i)!.b), ...passive.map((i) =>
          withTip(el('span', { class: 'spell passive', tabindex: 0, 'aria-label': t(`${itemName(i)} (passivo) nível ${mine!.items[i]}`, `${itemName(i)} (passive) level ${mine!.items[i]}`) }, el('span', { class: 'ico' }, icon(ITEM_ICON[i])), el('small', {}, String(mine!.items[i]))), () => itemTip(i, mine?.items[i] ?? 0)),
        ), ...Array.from({ length: Math.max(0, MAX_ITEMS - owned.length) }, () => el('span', { class: 'slot-empty', 'aria-hidden': 'true' })));
        hideTip(itemGrid);
      }
      setSlots(SPELL_IDS.filter((s) => (mine?.spells[s] ?? 0) > 0));
      for (const s of SPELL_IDS) {
        const { b, pips } = buttons.get(s)!;
        const lvl = mine?.spells[s] ?? 0;
        b.hidden = lvl === 0;
        pips.replaceChildren(...pipsOf(lvl, MAX_SPELL_LEVEL));
      }
      barOff = r.phase === 'lobby' || r.phase === 'end' || r.phase === 'shop' || !mine;
      syncBar();
      goldNow.replaceChildren(gold(mine?.gold ?? 0));
      const tabPhase = TAB_PHASES.includes(r.phase);
      tabBtn.hidden = !tabPhase;
      if (!tabOverlay.hidden) showTab(tabPhase);
      drawVote(r, prev);
      drawCenter();
      sheetBtn.hidden = r.phase === 'lobby' || r.phase === 'end' || !mine;
      if (sheetBtn.hidden) sheetPanel.hidden = true;
      drawSheet();
    },
    setOnline(on: boolean) {
      const changed = on !== online;
      setOnline(on);
      if (changed) drawCenter();
    },
    // a cada quadro: recargas, magia escolhida e o relógio da fase
    // hp: minha vida e o máximo, só jogando e vivo (null esconde a barra grande); dead: ids caídos na rodada, separados por vírgula
    // fx: pares [bit, segundos que faltam] dos meus efeitos com prazo (snap.fx)
    frame(cd: number[], icd: number[], armed: string | null, shrinkIn: number | null, respawnIn: number, status = 0, rttMs: number | null = null, hp: { now: number; max: number } | null = null, dead = '', fx: number[] = []) {
      if (dead !== shownDead) {
        shownDead = dead;
        const down = new Set(dead.split(','));
        for (const [id, { c, name }] of topCells) {
          c.classList.toggle('dead', down.has(id));
          c.setAttribute('aria-label', down.has(id) ? t(`${name}, caído`, `${name}, down`) : name);
        }
      }
      if (status !== myStatus) {
        myStatus = status;
        drawSheet();
        // como em cima do mago (scene.ts), com o nome no rótulo; a Égide pronta também aparece aqui
        fxCells.clear();
        statusRow.replaceChildren(...STATUS_ICONS.filter(([bit]) => status & bit).map(([bit, ico, name]) => {
          const s = el('small', { 'aria-hidden': 'true' });
          fxCells.set(bit, s);
          return el('i', { class: BAD_STATUS.includes(bit) ? 'bad' : 'good', title: name, role: 'img', 'aria-label': name }, icon(ico), s);
        }));
      }
      // segundos que faltam de cada efeito com prazo e o filete que esvazia (--left: fração que falta, como a recarga)
      for (const [bit, s] of fxCells) {
        const c = clock(fx, bit);
        s.textContent = c?.text ?? '';
        s.parentElement!.style.setProperty('--left', c ? c.frac.toFixed(3) : '0');
      }
      vitals.hidden = !hp;
      const hpLabel = hp ? `${Math.max(0, Math.ceil(hp.now))}/${hp.max}` : '';
      if (hp && hpText.textContent !== hpLabel) {
        hpText.textContent = hpLabel;
        hpBar.setAttribute('aria-label', t(`Vida ${hpLabel}`, `Health ${hpLabel}`));
        hpFill.style.width = `${Math.max(0, Math.min(100, (hp.now / hp.max) * 100))}%`;
      }
      // recarga de cada botão (itens ativos e magias): número, varredura circular (--cd: fração que falta) e a marca da escolhida
      const tick = (a: string, { b, cd: c }: { b: HTMLElement; cd: HTMLElement }, left = 0) => {
        c.textContent = left > 0.05 ? left.toFixed(left < 1 ? 1 : 0) : '';
        if (left > (cdLeft.get(a) ?? 0) + 0.05) cdTotal.set(a, left);
        cdLeft.set(a, left);
        const frac = left > 0.05 ? Math.min(1, left / (cdTotal.get(a) ?? left)).toFixed(3) : '0';
        if (b.style.getPropertyValue('--cd') !== frac) b.style.setProperty('--cd', frac);
        cooled(b, left);
        b.classList.toggle('armed', armed === a);
      };
      ACTIVE_ITEMS.forEach((i, k) => tick(i, itemButtons.get(i)!, icd[k]));
      SPELL_IDS.forEach((s, i) => tick(s, buttons.get(s)!, cd[i]));
      if (!room) return;
      // fps e ping: atualizam 2 vezes por segundo; fps verde a partir de 50, dourado a partir de 30; ping verde até 80 ms, dourado até 150, vermelho acima
      frames++;
      const since = performance.now() - pingAt;
      if (since > 500) {
        const fps = Math.round((frames * 1000) / since);
        frames = 0;
        pingAt = performance.now();
        ping.hidden = !TAB_PHASES.includes(room.phase);
        fpsEl.textContent = `${fps} fps`;
        fpsEl.dataset.q = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
        msEl.hidden = rttMs === null || !online;
        if (rttMs !== null) {
          msEl.textContent = `${Math.round(rttMs)} ms`;
          msEl.dataset.q = rttMs < 80 ? 'good' : rttMs < 150 ? 'ok' : 'bad';
        }
      }
      const left = Math.max(0, (phaseEndsAt - performance.now()) / 1000);
      timer.textContent =
        room.phase === 'shop' ? t(`Rodada começa em ${Math.ceil(left)} s`, `Round starts in ${Math.ceil(left)} s`)
        : room.phase === 'countdown' ? String(Math.max(1, Math.ceil(left)))
        : room.phase === 'playing' && room.mode === 'deathmatch' ? t(`Rodada termina em ${Math.ceil(left)} s`, `Round ends in ${Math.ceil(left)} s`)
        : room.phase === 'playing' && shrinkIn !== null && shrinkIn > 0 ? t(`Arena encolhe em ${Math.ceil(shrinkIn)} s`, `Arena shrinks in ${Math.ceil(shrinkIn)} s`)
        : '';
      // contagem dentro do Pronto, sem redesenhar a loja
      const ready = room.phase === 'shop' && readyBtn?.isConnected ? readyText(!!mine?.ready) : null;
      if (ready !== null && readyBtn!.textContent !== ready) readyBtn!.textContent = ready;
      // últimos 5 s da loja: Pronto e relógio pulsam em vermelho
      const hurry = room.phase === 'shop' && left <= 5;
      if (readyBtn?.isConnected) readyBtn.classList.toggle('urgent', hurry && !mine?.ready);
      voteLeft.textContent = room.vote ? `${Math.max(0, Math.ceil((voteEndsAt - performance.now()) / 1000))} s` : '';
      respawn.textContent = room.phase === 'playing' && respawnIn > 0 ? t(`Você volta em ${Math.ceil(respawnIn)} s`, `You are back in ${Math.ceil(respawnIn)} s`) : '';
      // nos últimos 3 s o aviso de encolher pulsa
      timer.className = 'timer ' + room.phase + ((room.phase === 'playing' && shrinkIn !== null && shrinkIn > 0 && shrinkIn <= 3) || hurry ? ' soon' : '');
      if (armed !== shownArmed) {
        shownArmed = armed;
        armedHint.hidden = !armed;
        if (armed) armedText.textContent = t(`${TOUCH ? 'Toque' : 'Clique'} no chão para lançar ${actionName(armed as Action)}`, `${TOUCH ? 'Tap' : 'Click'} the ground to cast ${actionName(armed as Action)}`);
      }
    },
  };
}
