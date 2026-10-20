import {
  ARENA_MIN, ARENA_R0, ASSIST_GOLD, ASSIST_MIN_DMG, BOUNTY, CHEST, CREDIT_WINDOW, DM_RESPAWN, DM_ROUND_MS, DM_SPAWN_GAP, HP_MAX, HP_REGEN, INVULN_TIME, KILL_GOLD, LAVA_DPS, LAVA_KB_FACTOR,
  LEADER_WIN_GOLD, OBSTACLES, RECOVERY, ROUND_GOLD, RUNE, SHRINK_EVERY, START_GOLD, STREAK, SUDDEN, TOP_DMG_GOLD, VOTE_MS, WIN_GOLD, ZONES,
} from '../shared/constants.ts';
import { DEFAULT_OPTS, DM_GOALS, OPTION_CHOICES } from '../shared/match.ts';
import { CLASH } from '../shared/sim.ts';
import { ITEMS, MAX_ITEMS, SCOURGE } from '../shared/items.ts';
import { keyLabel, keyOf, padButtonName, padButtonOf, uiLabel, type PadAction, type UiAction } from './keys.ts';
import { BOUNCER, CAST_POINT, GRAVITY, GRIP, MAX_SPELLS, MAX_SPELL_LEVEL, METEOR_DELAY, RECHARGE, RUSH, SPELLS, SPELL_IDS, WARPZONE, type SpellId } from '../shared/spells.ts';
import { LANG, LOCALE, spellName, t } from './i18n.ts';

// formatação dos números nos textos (também usada pela loja, ficha, dicas e opções)
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const n1 = (x: number) => x.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
const join = (xs: readonly (string | number)[], last: string) => xs.map(String).join(', ').replace(/, ([^,]*)$/, ` ${last} $1`);
const list = (xs: readonly (string | number)[]) => join(xs, t('ou', 'or'));
const L1 = (id: SpellId) => SPELLS[id].levels[0];
// magias que saem na hora (sem tempo de conjuração), lidas de CAST_POINT
const INSTANT = join(SPELL_IDS.filter((s) => CAST_POINT[s] === 0).map((s) => spellName(s)), t('e', 'and'));

// textos do grimório (Como jogar), por página; os números vêm do código
const RULES_PT = {
  objetivo: [
    `Empurre os outros magos para fora da pedra. Na lava a vida cai ${LAVA_DPS} por segundo; na pedra ela volta ${HP_REGEN} por segundo. Cada mago tem ${HP_MAX} de vida.`,
    `A arena encolhe uma faixa a cada ${SHRINK_EVERY} s até ${n1(ARENA_MIN)} m de raio; a faixa que vai afundar pisca em vermelho antes. Ela é maior quanto mais magos tiver (com 4, ${n1(ARENA_R0)} m de raio).`,
    `Com ${SUDDEN.collapse} s de rodada, o tamanho mínimo deixa de valer e a arena some aos poucos (nenhuma rodada fica sem fim).`,
    `O último vivo vence a rodada e ganha 1 ponto. Quem chega primeiro a ${DEFAULT_OPTS.goal} rodadas vence a partida (padrão; muda nas opções). Se os últimos caem juntos, vence quem tinha mais vida.`,
    `Nos ${INVULN_TIME} primeiros segundos de cada rodada ninguém leva dano.`,
    `As magias saem 0,1 s depois da tecla e o mago fica parado enquanto conjura; saem na hora: ${INSTANT}. O clique de andar dado durante a conjuração vale assim que a magia sai.`,
  ],
  empurrao: [
    'Cada golpe empurra na direção dele. O número de empurrão das magias é a distância, em metros, que um mago sem dano acumulado desliza.',
    `Quanto mais dano você já levou na rodada, mais longe voa: +10% de empurrão a cada 100 de dano levado. A lava também soma, pela metade (${pct(LAVA_KB_FACTOR)} do que ela tira).`,
    'Deslizando rápido você não consegue andar: espere parar ou use uma magia de movimento.',
    `O abate vai para quem acertou você por último nos ${CREDIT_WINDOW} s antes da morte. Cair sozinho na lava não dá abate a ninguém.`,
    `Lava conta como dano de quem empurrou: metade da vida que a lava tira de quem você acertou nos últimos ${CREDIT_WINDOW} s entra no seu dano (placar, top dano e assistência).`,
    `Abates com até ${STREAK.window} s entre eles viram Abate duplo, Abate triplo e Massacre. Abates sem morrer (contam de uma rodada para outra): ${STREAK.spree[0]} é Matança, ${STREAK.spree[1]} Fúria assassina, ${STREAK.spree[2]} Imparável e ${STREAK.spree[3]} Lendária.`,
    `Quebra-combo: derrubar quem tem ${STREAK.breakAt} ou mais abates seguidos dá +${STREAK.breakGold} de ouro.`,
  ],
  // os textos de controles leem as teclas e botões atuais (trocáveis nas configurações): getter, refeito a cada leitura
  get pc() {
    const k = (a: UiAction) => uiLabel(a);
    const sheet = keyOf('sheet') === 'Backquote' ? "Tecla à esquerda do 1 (' no teclado brasileiro)" : k('sheet');
    return [
      `Botão direito no chão: andar (segure para arrastar o destino). ${k('stop')}: parar. Esc: cancela a magia escolhida, fecha o que estiver aberto e, sem nada aberto, abre as configurações.`,
      'Tecla da magia: três jeitos de lançar, escolhidos em Configurações > Lançamento. Rápido (padrão): lança na hora na direção do mouse; o círculo de alcance aparece ao passar o mouse na magia da barra.',
      'Ao soltar: segurando a tecla aparece o círculo de alcance; ao soltar, a magia sai (Esc cancela). Com clique: a tecla escolhe a magia e mostra o alcance, o clique esquerdo lança (fora do alcance, vai até a borda); botão direito ou Esc cancelam.',
      'Clicar no botão da magia e depois no chão também lança.',
      'Roda do mouse: zoom. Espaço + arrastar com o botão esquerdo: mover a câmera; Espaço sozinho volta ao centro.',
      `${k('board')} (segurar): placar; com ele aberto, ← → troca entre Rodada, Partida e Sala.`,
      `${k('taunt')}: provocações. ${sheet}: ficha do mago. ${k('shop')}: loja só para ver durante a rodada (o jogo não pausa; ${k('shop')}, Esc ou ✕ fecham). ${k('rules')}: este grimório.${keyOf('vote') ? ` ${k('vote')}: votar.` : ''}`,
      'Dá para trocar a tecla de cada magia, item e atalho em Configurações > Teclas (Esc ou a engrenagem no topo), ou usar Q W E R D F pela ordem da barra (fica salvo no navegador).',
    ];
  },
  get controle() {
    const b = (p: PadAction) => padButtonName(padButtonOf(p), ' (', ')'); // "A (✕)"
    return [
      'Ligue o controle (Xbox ou PlayStation) e aperte qualquer botão: aparece "Controle conectado" e a barra mostra os botões do controle.',
      'Analógico esquerdo: andar. Analógico direito: mirar (o anel dourado no chão mostra onde). Sem mirar, a magia vai para onde você anda.',
      `${join((['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const).map(b), 'e')}: as magias pela ordem da barra. ${b('item1')}, ${b('item2')} e ${b('item3')}: itens ativos 1, 2 e 3.`,
      `Start (Options): o Esc do controle (fecha o que estiver aberto; sem nada aberto, abre e fecha as configurações). ${b('board')} segurado: placar. ${b('sheet')}: ficha do mago. ${b('center')}: centraliza a câmera. ${b('shop')}: loja só para ver.`,
      'Os botões da partida se trocam em Configurações > Controle (desenho do controle: clique no botão e aperte o novo).',
      'Menus e loja: D-pad ou analógico esquerdo anda entre os botões, A confirma (o Pronto da loja começa focado), B volta ou fecha, X desfaz ou vende, Y mostra a dica, LB e RB pulam entre os grupos.',
      'Vibra ao levar golpe forte e ao morrer (dá para desligar em Configurações > Controle).',
    ];
  },
  celular: [
    'Toque no chão para andar.',
    'Toque no botão da magia e depois no chão para lançar; o ✕ do aviso cancela.',
    'No topo: o gráfico de barras abre o placar, o pergaminho abre a ficha do mago, o balão manda provocações, a urna (Votar) troca o modo ou expulsa alguém e a engrenagem abre as configurações.',
    'Neste grimório: deslize o dedo para os lados para virar a página.',
  ],
  rodadas: [
    `O último vivo ganha a rodada e 1 ponto. Meta padrão: ${DEFAULT_OPTS.goal} rodadas (${list(OPTION_CHOICES.goal)} nas opções).`,
    `Morte súbita: passados ${SUDDEN.at} s de rodada, a arena encolhe a cada ${SUDDEN.every} s em vez de ${SHRINK_EVERY}.`,
  ],
  deathmatch: [
    `Rodadas de ${DM_ROUND_MS / 1000} s e a arena não encolhe. Quem cai volta ${DM_RESPAWN} s depois, longe dos outros magos (tenta ${DM_SPAWN_GAP} m ou mais), com vida cheia e ${INVULN_TIME} s sem levar dano; magias e itens continuam.`,
    `Cada abate vale 1 ponto (cair sozinho não vale). A partida acaba no fim da rodada em que alguém chega à meta (${list(Object.values(DM_GOALS))} abates; padrão ${DM_GOALS[DEFAULT_OPTS.goal]}); empate joga mais uma rodada.`,
  ],
  times: [
    'Azul contra Vermelho, times do mesmo tamanho (com número ímpar, um tem 1 a mais). Sorteados a cada rodada ou fixos na partida (escolha da sala, ou votação).',
    'A rodada acaba quando só sobra gente de um time; todos dele ganham 1 ponto e o ouro da vitória.',
    'Magia em aliado só empurra: não tira vida nem dá abate. Míssil, Ricochete, Gravidade e Agarrar só pegam inimigos; a Troca com aliado vale.',
  ],
  opcoes: [
    `Quem começa a partida escolhe o modo e as opções na sala de espera: tempo de loja (${list(OPTION_CHOICES.shop)} s), ouro ganho (×${list(OPTION_CHOICES.economy.map(n1))}), ouro inicial (${list(OPTION_CHOICES.startGold)}), meta e arena. Runas e baús dá para desligar. Embaixo do número de bots, cada bot tem a sua dificuldade (Fácil, Normal, Difícil ou Automático); bot votado no meio da partida entra Normal.`,
    `Votar, no topo: trocar o modo, mudar uma opção, sortear ou fixar os times, pôr ou tirar um bot, pular a loja, reiniciar, encerrar ou expulsar alguém. Passa com mais da metade; fecha em ${VOTE_MS / 1000} s e vale na próxima rodada.`,
  ],
  arenas: [
    `Obstáculos: pilar (${OBSTACLES.pillar.hp} de vida, explode com ${OBSTACLES.pillar.blastDmg} de dano ao quebrar), rocha (não quebra), árvore morta (${OBSTACLES.tree.hp} de vida) e altar de velas (${OBSTACLES.shrine.hp} de vida, explode com ${OBSTACLES.shrine.blastDmg} de dano em ${n1(OBSTACLES.shrine.blastR)} m). Bloqueiam magos, projéteis e o Raio.`,
    `Baú de ouro (pode desligar): o primeiro aos ${CHEST.first} s, depois um a cada ${CHEST.every} s (até ${CHEST.maxUp} de pé). Quebre com magias e fique em cima do monte: 1 de ouro a cada ${CHEST.goldEvery} s, até ${CHEST.pile}.`,
  ],
  get loja() {
    return [
      `Você começa com ${START_GOLD} de ouro (padrão), a Bola de fogo e o Flagelo (tecla ${keyLabel(keyOf('scourge'))}). A loja abre entre as rodadas e dura ${DEFAULT_OPTS.shop} s (padrão); fecha antes quando todos clicam Pronto.`,
      `Magias sobem até o nível ${MAX_SPELL_LEVEL} (mais dano e empurrão, menos recarga). No máximo ${MAX_SPELLS} magias e ${MAX_ITEMS} itens por mago.`,
      `Desfazer: devolve o ouro de uma compra feita nesta loja. Vender: devolve 100% do que você pagou, em qualquer rodada.`,
      'A Bola de fogo também se vende (vale 0 no nível 1, mas libera a vaga e a tecla); comprar de volta custa o preço normal.',
      `Durante a rodada, a tecla ${uiLabel('shop')} (ou o botão da loja, no topo) mostra a loja só para ver: preços e o que o seu ouro já compra na próxima.`,
    ];
  },
  ouro: [
    `Por rodada: ${ROUND_GOLD}. Vitória: ${WIN_GOLD} (o líder do placar que vence ganha só ${LEADER_WIN_GOLD}). Abate: ${KILL_GOLD}. Mais dano na rodada: ${TOP_DMG_GOLD}. Assistência (mais dano em quem morreu, sem ser quem matou, com pelo menos ${ASSIST_MIN_DMG}): ${ASSIST_GOLD}.`,
    `Recuperação: quem ganhou menos ouro que a média recebe metade da diferença no fim da rodada (até ${RECOVERY.max}). Abater o líder vale +${BOUNTY.perWin} por vitória de vantagem dele sobre a média (até ${BOUNTY.max}).`,
    'Tudo isso é multiplicado pelo "Ouro ganho" das opções.',
  ],
  runas: [
    `Aparece uma por vez num ponto livre da arena: a primeira aos ${RUNE.first} s e a próxima ${RUNE.every} s depois que alguém pega (ou a lava engole). Encoste para pegar; o efeito dura ${RUNE.secs} s. Pegar outra troca a runa.`,
  ],
  runa: {
    haste: `Pressa: +${pct(RUNE.haste)} de velocidade de andar.`,
    fury: `Fúria: +${pct(RUNE.fury)} de dano em tudo que você acerta.`,
    shield: `Escudo de runa: você leva ${pct(RUNE.armor)} menos dano (o empurrão continua).`,
    recharge: `Recarga: suas recargas levam ${pct(RUNE.cdr)} menos tempo.`,
  },
  choques: [
    'Bola de fogo e Míssil teleguiado de magos diferentes se anulam quando se encontram e explodem, deixando o chão com efeito:',
    `Fogo com fogo: explosão de ${CLASH.fire.dmg} em ${n1(CLASH.fire.r)} m e chão em chamas (${ZONES.burn.dps} de dano por segundo por ${n1(ZONES.burn.secs)} s).`,
    `Fogo com míssil (arcano): explosão de ${CLASH.arcane.dmg} em ${n1(CLASH.arcane.r)} m e chão lento (anda a ${pct(ZONES.slow.mult)} por ${n1(ZONES.slow.secs)} s).`,
    `Míssil com míssil (pulso): explosão de ${CLASH.pulse.dmg} em ${n1(CLASH.pulse.r)} m e um redemoinho que puxa para o centro por ${ZONES.pull.secs} s.`,
    `Raio atravessando uma Bola de fogo: detona a bola (2/3 de dano do raio + 70, caindo até a borda de ${n1(CLASH.detonate.r)} m) e deixa chão em chamas por 3,5 s.`,
    'O dano das explosões cai do centro para a borda. O Escudo não segura explosões.',
  ],
  dicas: [
    'Fique longe da borda: com dano acumulado, um golpe médio já joga você na lava.',
    'Ande o tempo todo: projéteis vão reto, e quem para de andar vira alvo fácil do Meteoro.',
    `Guarde uma magia de fuga (Teleporte, Investida, Troca) para quando cair na lava: são ${LAVA_DPS} de vida por segundo.`,
    'Prenda (Agarrar, Elo, Bola de neve) e emende a magia mais forte: o golpe que solta o Agarrar empurra mais.',
    'Combine: Magnetizar + projéteis, Gravidade + Meteoro, Pacto + Bola de fogo perto da borda.',
    `Flagelo: ${n1(SCOURGE.windup)} s de preparo e ${n1(SCOURGE.cd)} s de recarga; use quando alguém encostar em você. A explosão também destrói Bolas de fogo e Mísseis inimigos em volta. O Teleporte cancela o preparo.`,
    'Na loja, passe o mouse (ou toque) numa magia para ver os números do nível atual e do próximo.',
  ],
  creditos: [
    'Personagens e decoração: KayKit, de Kay Lousberg (kaylousberg.com). Texturas: ambientCG e Poly Haven. Partículas e sons: Kenney e OpenGameArt. Música: "Determined Pursuit", de Emma_MA. Tudo em domínio público (CC0). Ícones: game-icons.net, de Lorc, Delapouite, Skoll, Sbed e Caro Asercion (CC BY 3.0; lista em CREDITS.txt).',
    'Inspirado no Warlock do Warcraft 3 e no Warlock Brawl para Dota 2.',
  ],
};

const RULES_EN: typeof RULES_PT = {
  objetivo: [
    `Knock the other wizards off the rock. In the lava, health drops ${LAVA_DPS} per second; on the rock it comes back ${HP_REGEN} per second. Each wizard has ${HP_MAX} health.`,
    `The arena shrinks one ring every ${SHRINK_EVERY} s down to a radius of ${n1(ARENA_MIN)} m; the ring about to sink flashes red first. It is bigger the more wizards there are (with 4, a radius of ${n1(ARENA_R0)} m).`,
    `At ${SUDDEN.collapse} s into the round, the minimum size no longer applies and the arena crumbles away (no round goes on forever).`,
    `The last one alive wins the round and gets 1 point. First to ${DEFAULT_OPTS.goal} rounds wins the match (default; change it in the options). If the last ones fall together, whoever had more health wins.`,
    `For the first ${INVULN_TIME} seconds of each round nobody takes damage.`,
    `Spells go off 0.1 s after the key and the wizard stands still while casting; these go off instantly: ${INSTANT}. A walk click made during casting takes effect as soon as the spell goes off.`,
  ],
  empurrao: [
    "Each hit knocks back in the direction it travels. A spell's knockback number is the distance, in meters, that a wizard with no accumulated damage slides.",
    `The more damage you have taken in the round, the farther you fly: +10% knockback for every 100 damage taken. Lava adds too, at half rate (${pct(LAVA_KB_FACTOR)} of what it takes).`,
    'While sliding fast you cannot walk: wait until you stop or use a movement spell.',
    `The kill goes to whoever hit you last in the ${CREDIT_WINDOW} s before the death. Falling into the lava on your own gives no kill to anyone.`,
    `Lava counts as damage from whoever knocked you in: half of the health the lava takes from someone you hit in the last ${CREDIT_WINDOW} s is added to your damage (scoreboard, top damage and assists).`,
    `Kills within ${STREAK.window} s of each other become a Double kill, Triple kill and Ultra kill. Kills without dying (carried over from one round to the next): ${STREAK.spree[0]} is a Killing spree, ${STREAK.spree[1]} a Rampage, ${STREAK.spree[2]} Unstoppable and ${STREAK.spree[3]} Godlike.`,
    `Combo breaker: taking down someone with ${STREAK.breakAt} or more kills in a row gives +${STREAK.breakGold} gold.`,
  ],
  get pc() {
    const k = (a: UiAction) => uiLabel(a);
    const sheet = keyOf('sheet') === 'Backquote' ? 'Key left of the 1 (` on a US keyboard)' : k('sheet');
    return [
      `Right-click the ground: walk (hold to drag the destination). ${k('stop')}: stop. Esc: cancels the chosen spell, closes whatever is open and, with nothing open, opens the settings.`,
      'Spell key: three ways to cast, chosen in Settings > Casting. Quick (default): casts instantly toward the mouse; the range circle shows when you hover the spell on the bar.',
      'On release: holding the key shows the range circle; when you release, the spell goes off (Esc cancels). With click: the key picks the spell and shows the range, left click casts (out of range, it goes to the edge); right click or Esc cancel.',
      'Clicking the spell button and then the ground also casts.',
      'Mouse wheel: zoom. Space + drag with the left button: move the camera; Space alone recenters.',
      `${k('board')} (hold): scoreboard; with it open, ← → switches between Round, Match and Room.`,
      `${k('taunt')}: taunts. ${sheet}: wizard sheet. ${k('shop')}: view-only shop during the round (the game does not pause; ${k('shop')}, Esc or ✕ close it). ${k('rules')}: this grimoire.${keyOf('vote') ? ` ${k('vote')}: vote.` : ''}`,
      'You can rebind the key of each spell, item and shortcut in Settings > Keys (Esc or the gear at the top), or use Q W E R D F in bar order (saved in the browser).',
    ];
  },
  get controle() {
    const b = (p: PadAction) => padButtonName(padButtonOf(p), ' (', ')'); // "A (✕)"
    return [
      'Plug in the controller (Xbox or PlayStation) and press any button: "Controller connected" appears and the bar shows the controller buttons.',
      'Left stick: walk. Right stick: aim (the golden ring on the ground shows where). Without aiming, the spell goes where you walk.',
      `${join((['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const).map(b), 'and')}: the spells in bar order. ${b('item1')}, ${b('item2')} and ${b('item3')}: active items 1, 2 and 3.`,
      `Start (Options): the controller's Esc (closes whatever is open; with nothing open, opens and closes the settings). ${b('board')} held: scoreboard. ${b('sheet')}: wizard sheet. ${b('center')}: centers the camera. ${b('shop')}: view-only shop.`,
      'The in-match buttons are changed in Settings > Controller (controller drawing: click the button and press the new one).',
      "Menus and shop: D-pad or left stick moves between buttons, A confirms (the shop's Ready starts focused), B goes back or closes, X undoes or sells, Y shows the tip, LB and RB jump between groups.",
      'Rumbles on a strong hit and on death (can be turned off in Settings > Controller).',
    ];
  },
  celular: [
    'Tap the ground to walk.',
    'Tap the spell button and then the ground to cast; the ✕ on the notice cancels.',
    'At the top: the bar chart opens the scoreboard, the scroll opens the wizard sheet, the speech bubble sends taunts, the ballot box (Vote) changes the mode or kicks someone and the gear opens the settings.',
    'In this grimoire: swipe sideways to turn the page.',
  ],
  rodadas: [
    `The last one alive wins the round and 1 point. Default goal: ${DEFAULT_OPTS.goal} rounds (${list(OPTION_CHOICES.goal)} in the options).`,
    `Sudden death: after ${SUDDEN.at} s of the round, the arena shrinks every ${SUDDEN.every} s instead of ${SHRINK_EVERY}.`,
  ],
  deathmatch: [
    `Rounds of ${DM_ROUND_MS / 1000} s and the arena does not shrink. Whoever falls comes back ${DM_RESPAWN} s later, away from the other wizards (tries ${DM_SPAWN_GAP} m or more), with full health and ${INVULN_TIME} s without taking damage; spells and items stay.`,
    `Each kill is worth 1 point (falling on your own does not count). The match ends at the end of the round in which someone reaches the goal (${list(Object.values(DM_GOALS))} kills; default ${DM_GOALS[DEFAULT_OPTS.goal]}); a tie plays one more round.`,
  ],
  times: [
    'Blue against Red, teams of the same size (with an odd number, one has 1 more). Shuffled every round or fixed for the match (room choice, or vote).',
    'The round ends when only one team has anyone left; all of them get 1 point and the victory gold.',
    'Spells on an ally only knock back: no damage and no kill. Homing Missile, Bouncer, Gravity and Grip only hit enemies; Swap with an ally works.',
  ],
  opcoes: [
    `Whoever starts the match picks the mode and options in the lobby: shop time (${list(OPTION_CHOICES.shop)} s), gold earned (×${list(OPTION_CHOICES.economy.map(n1))}), starting gold (${list(OPTION_CHOICES.startGold)}), goal and arena. Runes and chests can be turned off. Below the bot count, each bot has its own difficulty (Easy, Normal, Hard or Auto); a bot voted in mid-match joins on Normal.`,
    `Vote, at the top: change the mode, change an option, shuffle or fix the teams, add or remove a bot, skip the shop, restart, end or kick someone. Passes with more than half; closes in ${VOTE_MS / 1000} s and takes effect next round.`,
  ],
  arenas: [
    `Obstacles: pillar (${OBSTACLES.pillar.hp} health, explodes for ${OBSTACLES.pillar.blastDmg} damage when broken), boulder (unbreakable), dead tree (${OBSTACLES.tree.hp} health) and candle shrine (${OBSTACLES.shrine.hp} health, explodes for ${OBSTACLES.shrine.blastDmg} damage in ${n1(OBSTACLES.shrine.blastR)} m). They block wizards, projectiles and Lightning.`,
    `Gold chest (can be turned off): the first at ${CHEST.first} s, then one every ${CHEST.every} s (up to ${CHEST.maxUp} standing). Break it with spells and stand on the pile: 1 gold every ${CHEST.goldEvery} s, up to ${CHEST.pile}.`,
  ],
  get loja() {
    return [
      `You start with ${START_GOLD} gold (default), the Fireball and the Scourge (key ${keyLabel(keyOf('scourge'))}). The shop opens between rounds and lasts ${DEFAULT_OPTS.shop} s (default); it closes early when everyone clicks Ready.`,
      `Spells go up to level ${MAX_SPELL_LEVEL} (more damage and knockback, less cooldown). At most ${MAX_SPELLS} spells and ${MAX_ITEMS} items per wizard.`,
      `Undo: refunds the gold of a purchase made in this shop. Sell: refunds 100% of what you paid, in any round.`,
      'The Fireball can also be sold (worth 0 at level 1, but it frees the slot and the key); buying it back costs the normal price.',
      `During the round, the ${uiLabel('shop')} key (or the shop button at the top) shows the shop view-only: prices and what your gold already buys in the next one.`,
    ];
  },
  ouro: [
    `Per round: ${ROUND_GOLD}. Victory: ${WIN_GOLD} (the scoreboard leader who wins gets only ${LEADER_WIN_GOLD}). Kill: ${KILL_GOLD}. Most damage in the round: ${TOP_DMG_GOLD}. Assist (most damage on the one who died, other than the killer, with at least ${ASSIST_MIN_DMG}): ${ASSIST_GOLD}.`,
    `Catch-up: whoever earned less gold than the average gets half the difference at the end of the round (up to ${RECOVERY.max}). Killing the leader is worth +${BOUNTY.perWin} per win of lead over the average (up to ${BOUNTY.max}).`,
    'All of this is multiplied by the "Gold earned" option.',
  ],
  runas: [
    `One appears at a time at a free spot on the arena: the first at ${RUNE.first} s and the next ${RUNE.every} s after someone picks it up (or the lava swallows it). Touch it to pick it up; the effect lasts ${RUNE.secs} s. Picking up another swaps the rune.`,
  ],
  runa: {
    haste: `Haste: +${pct(RUNE.haste)} walking speed.`,
    fury: `Fury: +${pct(RUNE.fury)} damage on everything you hit.`,
    shield: `Rune shield: you take ${pct(RUNE.armor)} less damage (knockback still applies).`,
    recharge: `Recharge: your cooldowns take ${pct(RUNE.cdr)} less time.`,
  },
  choques: [
    'Fireball and Homing Missile from different wizards cancel each other out when they meet and explode, leaving an effect on the ground:',
    `Fire with fire: ${CLASH.fire.dmg} explosion in ${n1(CLASH.fire.r)} m and burning ground (${ZONES.burn.dps} damage per second for ${n1(ZONES.burn.secs)} s).`,
    `Fire with missile (arcane): ${CLASH.arcane.dmg} explosion in ${n1(CLASH.arcane.r)} m and slow ground (move at ${pct(ZONES.slow.mult)} for ${n1(ZONES.slow.secs)} s).`,
    `Missile with missile (pulse): ${CLASH.pulse.dmg} explosion in ${n1(CLASH.pulse.r)} m and a whirlpool that pulls toward the center for ${ZONES.pull.secs} s.`,
    `Lightning passing through a Fireball: detonates the ball (2/3 of the lightning damage + 70, falling off to the edge at ${n1(CLASH.detonate.r)} m) and leaves burning ground for 3.5 s.`,
    'Explosion damage falls off from the center to the edge. The Shield does not stop explosions.',
  ],
  dicas: [
    'Stay away from the edge: with accumulated damage, an average hit already throws you into the lava.',
    'Keep moving: projectiles go straight, and anyone who stops walking becomes an easy target for the Meteor.',
    `Keep an escape spell (Teleport, Rush, Swap) for when you fall into the lava: that is ${LAVA_DPS} health per second.`,
    'Pin them down (Grip, Link, Snowball) and follow up with your strongest spell: the hit that releases the Grip knocks back farther.',
    'Combine: Magnetize + projectiles, Gravity + Meteor, Pact + Fireball near the edge.',
    `Scourge: ${n1(SCOURGE.windup)} s of windup and ${n1(SCOURGE.cd)} s of cooldown; use it when someone gets on top of you. The blast also destroys enemy Fireballs and Missiles around you. Teleport cancels the windup.`,
    'In the shop, hover (or tap) a spell to see the numbers for the current and the next level.',
  ],
  creditos: [
    'Characters and decoration: KayKit, by Kay Lousberg (kaylousberg.com). Textures: ambientCG and Poly Haven. Particles and sounds: Kenney and OpenGameArt. Music: "Determined Pursuit", by Emma_MA. All public domain (CC0). Icons: game-icons.net, by Lorc, Delapouite, Skoll, Sbed and Caro Asercion (CC BY 3.0; list in CREDITS.txt).',
    'Inspired by Warlock from Warcraft 3 and Warlock Brawl for Dota 2.',
  ],
};
export { RULES_EN, RULES_PT };
export const RULES = LANG === 'en' ? RULES_EN : RULES_PT;

// grimório: como usar cada magia e contra o quê ela funciona (lido do comportamento em shared/sim.ts)
type SpellTips = Record<SpellId, [use: string, vs: string]>;
const SPELL_TIPS_PT: SpellTips = {
  fireball: ['Mire um pouco à frente de quem anda. Perto da borda, um acerto já joga na lava.', 'O Escudo devolve; Teleporte e Troca escapam. O Raio detona a bola no ar e duas bolas que se chocam viram chão em chamas.'],
  lightning: ['Não dá tempo de desviar: bom em quem está preso, conjurando ou na borda. Passar pela sua Bola de fogo a detona.', `Obstáculos bloqueiam; o Escudo devolve o raio para você. Alcance curto (${n1(L1('lightning').range)} m no nível 1).`],
  homing: ['Bom contra quem foge e desvia: mire perto do alvo, ele persegue o inimigo mais perto da mira.', 'O Escudo devolve e ele passa a perseguir você; obstáculos o param. Com uma Bola de fogo inimiga, vira chão lento.'],
  shield: [`Ligue quando o projétil estiver chegando: dura só ${n1(L1('shield').duration)} s. Devolve mirando quem lançou.`, 'Devolve projéteis e o Raio; barra a Troca; Bumerangue e Elo quicam. Não segura áreas: Meteoro, Flagelo, explosões dos choques e lava.'],
  teleport: ['Volte da lava para a pedra ou saia da frente de um projétil. É a única magia que sai durante o preparo do seu Flagelo (e o cancela).', `Quem lê o salto atira no ponto de chegada. Recarga longa no começo (${n1(L1('teleport').cd)} s).`],
  swap: ['Fique perto da lava e troque: o inimigo vai para o seu lugar ruim. Errou? Você vai até a metade do caminho da mira, que também serve de fuga.', 'O Escudo barra a Troca: ninguém sai do lugar.'],
  grip: [`Prenda e acerte com a magia mais forte: o golpe que solta empurra mais (+${pct(L1('grip').scale)} no nível 1). Cada magia que o preso lança soma ${GRIP.castPenalty} de dano acumulado.`, 'Não prende aliados. O Escudo devolve e quem prende é ele.'],
  meteor: [`Mire onde o inimigo vai estar daqui a ${METEOR_DELAY.toLocaleString(LOCALE)} s, ou em quem está preso ou conjurando. O dano é maior no centro.`, 'Dá para sair andando da marca. O Escudo não segura.'],
  rush: [`O avanço de ${n1(RUSH.dash)} m sai na hora e quem você encostar leva ${RUSH.dashDmg} de dano. Durante a Investida, metade de cada golpe vira velocidade (até o limite do nível).`, 'Só o dano é absorvido: o empurrão continua valendo.'],
  cluster: ['De perto os 4 projéteis acertam juntos: muito dano e empurrão.', `Alcance curto (${n1(L1('cluster').range)} m): de longe erra.`],
  boomerang: ['Acerta na ida e na volta: deixe o inimigo entre você e o ponto. Quica em obstáculos.', 'No Escudo ele quica e volta sem trocar de dono.'],
  thrust: ['O dano cheio vem com velocidade: comece de longe. Você para no primeiro inimigo que tocar.', 'No Escudo você quica. Se errar, freia no fim do caminho.'],
  gravity: [`Jogue no meio de um grupo: puxa inimigos até ${n1(GRAVITY.wizR)} m e queima quem fica a ${n1(L1('gravity').radius)} m. Também puxa projéteis de qualquer dono.`, `É lento (${n1(L1('gravity').speed)} m/s): dá para sair andando.`],
  rockpillar: [`Erga entre você e um projétil: a parede (2 m, atravessada no caminho) segura magos e projéteis por ${n1(L1('rockpillar').duration)} s.`, `Magias quebram a parede (${OBSTACLES.rockpillar.hp} de vida para ela toda), e ela explode ao quebrar.`],
  bouncer: [`Melhor com inimigos juntos: pula para o mago mais perto, perdendo ${pct(1 - BOUNCER.decay)} do dano por inimigo.`, 'Contra um inimigo sozinho é só um acerto.'],
  drain: ['Mire perto do grupo: depois do ponto, vira para o mago mais perto. No inimigo, dano, lentidão e a vida volta para você; no aliado, cura e pressa.', `É lento (${n1(L1('drain').speed)} m/s) e o Escudo devolve.`],
  snowball: ['Quem encosta é arrastado junto: role na direção da lava. No fim do caminho ela explode.', `Muito lenta (${n1(L1('snowball').speed)} m/s) e de alcance curto: dá para sair da frente.`],
  illusion: [`Cria uma cópia no seu lugar, que segue reto na direção do seu movimento por ${n1(L1('illusion').duration)} s. Você pode se mover livremente, invisível, até ela sumir. A cópia não é destruída por golpes, mas pode ser empurrada.`, 'Mísseis teleguiados e bots são enganados pela cópia.'],
  magnetize: ['Magnetize o inimigo e atire perto dele: os seus projéteis curvam até ele. Em você ou num aliado, afasta os projéteis inimigos.', 'Só curva projéteis que passam perto (menos de 2 m).'],
  recharge: [`Se acertar, ela volta até você e zera a recarga: lance de novo, com +${RECHARGE.perHit} de dano por acerto seguido.`, `Errar zera a sequência e a recarga é longa (${n1(L1('recharge').cd)} s no nível 1).`],
  alteration: [`Ligue quando um projétil estiver chegando: por ${n1(L1('alteration').duration)} s você troca de lugar com o primeiro que entrar na bolha.`, 'Não serve contra Raio, Meteoro, Flagelo e explosões, que não são projéteis.'],
  link: ['Puxe o inimigo para perto (e para o seu Meteoro), ou prenda num obstáculo e puxe-se até ele para fugir.', 'O Escudo faz o Elo quicar e voltar.'],
  windwalk: ['Fique invisível, chegue perto e encoste: o primeiro inimigo leva dano. Também serve para fugir sem ser visto.', `Lançar qualquer magia desfaz; dura ${n1(L1('windwalk').duration)} s.`],
  splitter: ['Estoura no ponto (ou no primeiro que tocar) em 8 projéteis em leque: cobre uma área ou acerta quem está atrás de obstáculo.', 'Cada filhote é fraco; de longe eles se espalham.'],
  warpzone: [`Ponha entre você e os projéteis: dentro dela os projéteis inimigos andam a ${pct(L1('warpzone').scale)} (nível 1) e os inimigos a ${pct(WARPZONE.wizMult)} da velocidade.`, 'Não para o Raio nem áreas.'],
};

const SPELL_TIPS_EN: SpellTips = {
  fireball: ['Aim a little ahead of anyone who is moving. Near the edge, one hit already sends them into the lava.', 'The Shield reflects it; Teleport and Swap escape it. Lightning detonates the ball in the air and two balls that collide become burning ground.'],
  lightning: ['No time to dodge: good against anyone gripped, casting or at the edge. Passing through your Fireball detonates it.', `Obstacles block it; the Shield sends the bolt back at you. Short range (${n1(L1('lightning').range)} m at level 1).`],
  homing: ['Good against anyone who runs and dodges: aim near the target, it chases the enemy closest to your aim.', 'The Shield reflects it and it starts chasing you; obstacles stop it. With an enemy Fireball, it becomes slow ground.'],
  shield: [`Turn it on when the projectile is about to arrive: it lasts only ${n1(L1('shield').duration)} s. It sends it back aimed at whoever cast it.`, 'Reflects projectiles and Lightning; blocks Swap; Boomerang and Link bounce off. Does not hold areas: Meteor, Scourge, clash explosions and lava.'],
  teleport: ['Get back from the lava to the rock or get out of a projectile\'s path. It is the only spell that goes off during your Scourge windup (and cancels it).', `Whoever reads the jump shoots at the landing point. Long cooldown at the start (${n1(L1('teleport').cd)} s).`],
  swap: ['Stand near the lava and swap: the enemy goes to your bad spot. Missed? You go halfway along your aim, which also works as an escape.', 'The Shield blocks Swap: nobody moves.'],
  grip: [`Pin them and hit with your strongest spell: the hit that releases them knocks back farther (+${pct(L1('grip').scale)} at level 1). Each spell the gripped one casts adds ${GRIP.castPenalty} accumulated damage.`, 'Does not grip allies. The Shield reflects it and the gripper becomes the one gripped.'],
  meteor: [`Aim where the enemy will be in ${METEOR_DELAY.toLocaleString(LOCALE)} s, or at someone gripped or casting. Damage is greater at the center.`, 'You can walk out of the mark. The Shield does not stop it.'],
  rush: [`The ${n1(RUSH.dash)} m dash goes off instantly and anyone you touch takes ${RUSH.dashDmg} damage. During Rush, half of each hit becomes speed (up to the level cap).`, 'Only the damage is absorbed: knockback still applies.'],
  cluster: ['Up close all 4 projectiles hit together: lots of damage and knockback.', `Short range (${n1(L1('cluster').range)} m): misses from afar.`],
  boomerang: ['Hits on the way out and on the way back: leave the enemy between you and the point. Bounces off obstacles.', 'On the Shield it bounces and comes back without changing owner.'],
  thrust: ['Full damage comes with speed: start from afar. You stop at the first enemy you touch.', 'On the Shield you bounce off. If you miss, you brake at the end of the path.'],
  gravity: [`Throw it into the middle of a group: it pulls enemies within ${n1(GRAVITY.wizR)} m and burns anyone within ${n1(L1('gravity').radius)} m. It also pulls projectiles from any owner.`, `It is slow (${n1(L1('gravity').speed)} m/s): you can walk away.`],
  rockpillar: [`Raise it between you and a projectile: the wall (2 m, across the path) holds wizards and projectiles for ${n1(L1('rockpillar').duration)} s.`, `Spells break the wall (${OBSTACLES.rockpillar.hp} health for the whole thing), and it explodes when broken.`],
  bouncer: [`Best with enemies grouped: it jumps to the nearest wizard, losing ${pct(1 - BOUNCER.decay)} of the damage per enemy.`, 'Against a lone enemy it is just one hit.'],
  drain: ['Aim near the group: after the point, it turns to the nearest wizard. On an enemy, damage, slow and the health comes back to you; on an ally, heal and haste.', `It is slow (${n1(L1('drain').speed)} m/s) and the Shield reflects it.`],
  snowball: ['Anyone it touches is dragged along: roll toward the lava. At the end of the path it explodes.', `Very slow (${n1(L1('snowball').speed)} m/s) and short range: you can step out of the way.`],
  illusion: [`Creates a copy at your location that moves straight in your current direction for ${n1(L1('illusion').duration)} s. You can move freely while invisible until it vanishes. The copy cannot be destroyed by attacks, but can be pushed.`, 'Homing missiles and bots are fooled by the copy.'],
  magnetize: ['Magnetize the enemy and fire near them: your projectiles curve toward them. On yourself or an ally, it repels enemy projectiles.', 'Only curves projectiles that pass close by (under 2 m).'],
  recharge: [`If it hits, it comes back to you and resets the cooldown: cast again, with +${RECHARGE.perHit} damage per consecutive hit.`, `A miss resets the streak and the cooldown is long (${n1(L1('recharge').cd)} s at level 1).`],
  alteration: [`Turn it on when a projectile is about to arrive: for ${n1(L1('alteration').duration)} s you swap places with the first one that enters the bubble.`, 'Useless against Lightning, Meteor, Scourge and explosions, which are not projectiles.'],
  link: ['Pull the enemy close (and into your Meteor), or latch onto an obstacle and pull yourself to it to escape.', 'The Shield makes the Link bounce and come back.'],
  windwalk: ['Turn invisible, get close and touch: the first enemy takes damage. Also works to flee unseen.', `Casting any spell cancels it; lasts ${n1(L1('windwalk').duration)} s.`],
  splitter: ['Bursts at the point (or at the first thing it touches) into 8 projectiles in a fan: covers an area or hits someone behind an obstacle.', 'Each fragment is weak; from afar they spread out.'],
  warpzone: [`Place it between you and the projectiles: inside it enemy projectiles move at ${pct(L1('warpzone').scale)} (level 1) and enemies at ${pct(WARPZONE.wizMult)} of their speed.`, 'Does not stop Lightning or areas.'],
};
export { SPELL_TIPS_EN, SPELL_TIPS_PT };
export const SPELL_TIPS = LANG === 'en' ? SPELL_TIPS_EN : SPELL_TIPS_PT;

// grimório: o que a demonstração do item mostra (itens sem demonstração não aparecem aqui)
type ItemDemo = Partial<Record<keyof typeof ITEMS, string>>;
const ITEM_DEMO_PT: ItemDemo = {
  scourge: 'Você explode em volta e empurra os dois magos de treino.',
  redirector: 'A Bola de fogo sai para o lado e o Redirecionador a desvia para o mago de treino.',
  pact: 'Pacto e depois Bola de fogo: dano e empurrão dobrados.',
  aegis: 'O mago de treino tem a Égide: cai na lava com pouca vida e volta para a pedra.',
};
const ITEM_DEMO_EN: ItemDemo = {
  scourge: 'You blast outward and knock back both practice wizards.',
  redirector: 'The Fireball goes off to the side and the Redirector bends it toward the practice wizard.',
  pact: 'Pact, then Fireball: double damage and knockback.',
  aegis: 'The practice wizard has the Aegis: falls into the lava with low health and returns to the rock.',
};
export { ITEM_DEMO_EN, ITEM_DEMO_PT };
export const ITEM_DEMO = LANG === 'en' ? ITEM_DEMO_EN : ITEM_DEMO_PT;

// loja e ajuda: magias agrupadas pelo efeito principal (o que cada uma faz está em RULES_SHORT)
type SpellGroups = [name: string, hint: string, spells: SpellId[]][];
const SPELL_GROUPS_PT: SpellGroups = [
  ['Ataque', 'dano e empurrão', ['fireball', 'lightning', 'homing', 'meteor', 'cluster', 'boomerang', 'bouncer', 'recharge', 'splitter', 'snowball']],
  ['Mobilidade', 'sair do lugar', ['teleport', 'swap', 'rush', 'thrust', 'windwalk']],
  ['Defesa', 'parar o que vem', ['shield', 'alteration', 'warpzone', 'rockpillar', 'illusion']],
  ['Controle', 'prender, puxar, atrasar', ['grip', 'gravity', 'link', 'magnetize', 'drain']],
];
const SPELL_GROUPS_EN: SpellGroups = [
  ['Attack', 'damage and knockback', ['fireball', 'lightning', 'homing', 'meteor', 'cluster', 'boomerang', 'bouncer', 'recharge', 'splitter', 'snowball']],
  ['Mobility', 'get out of the way', ['teleport', 'swap', 'rush', 'thrust', 'windwalk']],
  ['Defense', 'stop what is coming', ['shield', 'alteration', 'warpzone', 'rockpillar', 'illusion']],
  ['Control', 'grip, pull, slow', ['grip', 'gravity', 'link', 'magnetize', 'drain']],
];
export { SPELL_GROUPS_EN, SPELL_GROUPS_PT };
export const SPELL_GROUPS = LANG === 'en' ? SPELL_GROUPS_EN : SPELL_GROUPS_PT;
// classe de cor do grupo (Fernando, 19/10: uma cor por setor): g-ataque, g-mobilidade, g-defesa, g-controle (o rótulo em inglês cai na mesma classe)
const GROUP_CLASS_EN: Record<string, string> = { attack: 'ataque', mobility: 'mobilidade', defense: 'defesa', control: 'controle' };
export const groupClass = (name: string) => 'g-' + (GROUP_CLASS_EN[name.toLowerCase()] ?? name.toLowerCase());
export const spellClass = (s: SpellId) => groupClass(SPELL_GROUPS.find(([, , ids]) => ids.includes(s))?.[0] ?? '');

// para que serve, em uma linha (cartão da loja)
const SPELL_USE_PT: Record<SpellId, string> = {
  fireball: 'Ataque básico: empurra de longe.',
  lightning: 'Acerta na hora, sem tempo de desviar.',
  homing: 'Persegue quem foge ou desvia.',
  meteor: 'Pune grupos e quem fica parado.',
  cluster: 'Muito dano de perto.',
  boomerang: 'Acerta na ida e na volta.',
  bouncer: 'Bom com os inimigos juntos.',
  recharge: 'Repete logo se você acertar.',
  splitter: 'Enche uma área de projéteis.',
  snowball: 'Arrasta inimigos para a lava.',
  teleport: 'Fugir da lava ou de um ataque.',
  swap: 'Põe o inimigo no seu lugar ruim.',
  rush: 'Correr e aguentar dano por um tempo.',
  thrust: 'Avançar e acertar quem estiver no caminho.',
  windwalk: 'Sumir, reposicionar e surpreender.',
  shield: 'Devolve projéteis para quem lançou.',
  alteration: 'Escapa trocando de lugar com um projétil.',
  illusion: 'Você fica invisível enquanto uma cópia sua engana mísseis e bots.',
  warpzone: 'Freia projéteis e inimigos para dar tempo de desviar.',
  rockpillar: 'Barricada contra magos e projéteis.',
  grip: 'Segura o alvo para os outros acertarem.',
  gravity: 'Puxa inimigos e desvia projéteis.',
  link: 'Puxa o inimigo, ou você até um obstáculo.',
  magnetize: 'Atrai para o alvo os projéteis dos outros.',
  drain: 'Deixa lento e devolve vida a você.',
};
const SPELL_USE_EN: Record<SpellId, string> = {
  fireball: 'Basic attack: knocks back from afar.',
  lightning: 'Hits instantly, no time to dodge.',
  homing: 'Chases anyone who flees or dodges.',
  meteor: 'Punishes groups and anyone standing still.',
  cluster: 'Lots of damage up close.',
  boomerang: 'Hits on the way out and on the way back.',
  bouncer: 'Good with enemies grouped.',
  recharge: 'Repeats soon if you hit.',
  splitter: 'Fills an area with projectiles.',
  snowball: 'Drags enemies into the lava.',
  teleport: 'Escape the lava or an attack.',
  swap: 'Puts the enemy in your bad spot.',
  rush: 'Run and shrug off damage for a while.',
  thrust: 'Dash and hit whoever is in the way.',
  windwalk: 'Vanish, reposition and surprise.',
  shield: 'Sends projectiles back at whoever cast them.',
  alteration: 'Escape by swapping places with a projectile.',
  illusion: 'You turn invisible while a copy of you fools missiles and bots.',
  warpzone: 'Slows projectiles and enemies to give you time to dodge.',
  rockpillar: 'Barricade against wizards and projectiles.',
  grip: 'Holds the target so others can hit it.',
  gravity: 'Pulls enemies and diverts projectiles.',
  link: 'Pulls the enemy, or you to an obstacle.',
  magnetize: "Draws other casters' projectiles to the target.",
  drain: 'Slows enemies and gives health back to you.',
};
export { SPELL_USE_EN, SPELL_USE_PT };
export const SPELL_USE = LANG === 'en' ? SPELL_USE_EN : SPELL_USE_PT;

const RULES_SHORT_PT: Record<SpellId, string> = {
  fireball: 'Projétil reto. Dano e empurrão médios.',
  lightning: 'Instantâneo. Acerta o primeiro na linha.',
  homing: `Persegue por ${n1(L1('homing').duration)} s o inimigo mais perto da mira, virando devagar.`,
  shield: `Por ${n1(L1('shield').duration)} s, devolve projéteis e o Raio para quem lançou.`,
  teleport: 'Salta até o cursor (alcance curto).',
  swap: 'Voa até o alcance e troca de lugar com o primeiro mago que tocar; sem ninguém, leva você até a metade do caminho da mira.',
  grip: 'Prende o alvo no lugar até o primeiro golpe, que o solta e empurra mais longe.',
  meteor: `Cai em área no ponto marcado, ${METEOR_DELAY.toLocaleString(LOCALE)} s depois.`,
  rush: `Avança ${n1(RUSH.dash)} m na direção da mira e fica mais rápido; parte do dano levado vira mais velocidade.`,
  cluster: 'Quatro projéteis em leque, curto alcance.',
  boomerang: 'Vai em curva até o ponto e volta para você; acerta na ida e na volta.',
  thrust: 'Você dispara até o ponto; o primeiro inimigo que tocar leva dano conforme a sua velocidade.',
  gravity: 'Orbe lento que puxa magos inimigos e projéteis e queima quem fica perto.',
  rockpillar: `Ergue uma barricada baixa (2 m) atravessada no caminho por ${n1(L1('rockpillar').duration)} s: bloqueia magos e projéteis.`,
  bouncer: `Acerta e pula para o mago mais perto, perdendo ${pct(1 - BOUNCER.decay)} do dano a cada inimigo.`,
  drain: 'Vai até o ponto e vira para o mago mais perto: no inimigo, dano, lentidão e a vida volta para você; no aliado, cura e acelera.',
  snowball: 'Bola lenta que atravessa e arrasta quem encosta, com dano, e explode no fim do caminho.',
  illusion: `Uma cópia nasce no seu lugar e segue reto na direção do seu movimento por ${n1(L1('illusion').duration)} s; você pode se mover livremente, invisível, até ela sumir. A cópia não é destruída, mas pode ser empurrada. O Míssil teleguiado e os bots miram nela. Recarga ${n1(L1('illusion').cd)} s.`,
  magnetize: 'No inimigo, puxa para ele os projéteis dos outros; num aliado ou em você (depois de quicar), afasta.',
  recharge: 'Se acertar, volta e zera a própria recarga; cada acerto seguido soma dano.',
  alteration: `Por ${n1(L1('alteration').duration)} s, troca de lugar com o primeiro projétil inimigo que chegar perto.`,
  link: 'Prende num mago e o puxa até você (com dano no inimigo); num obstáculo, puxa você até ele.',
  windwalk: `Invisível e mais rápido por ${n1(L1('windwalk').duration)} s; o primeiro inimigo em que encostar leva dano. Lançar magia desfaz.`,
  splitter: 'Estoura no ponto (ou no primeiro que tocar) em 8 projéteis que se abrem em leque.',
  warpzone: 'Esfera que deixa lentos os projéteis inimigos que passam por ela e os inimigos que andam dentro dela.',
};
const RULES_SHORT_EN: Record<SpellId, string> = {
  fireball: 'Straight projectile. Medium damage and knockback.',
  lightning: 'Instant. Hits the first one in line.',
  homing: `Chases the enemy closest to your aim for ${n1(L1('homing').duration)} s, turning slowly.`,
  shield: `For ${n1(L1('shield').duration)} s, sends projectiles and Lightning back at whoever cast them.`,
  teleport: 'Jumps to the cursor (short range).',
  swap: 'Flies to its range and swaps places with the first wizard it touches; with no one, takes you halfway along your aim.',
  grip: 'Pins the target in place until the first hit, which releases them and knocks them back farther.',
  meteor: `Falls over an area at the marked point, ${METEOR_DELAY.toLocaleString(LOCALE)} s later.`,
  rush: `Dashes ${n1(RUSH.dash)} m toward your aim and makes you faster; part of the damage you take becomes more speed.`,
  cluster: 'Four projectiles in a fan, short range.',
  boomerang: 'Curves to the point and comes back to you; hits on the way out and on the way back.',
  thrust: 'You dash to the point; the first enemy you touch takes damage based on your speed.',
  gravity: 'Slow orb that pulls enemy wizards and projectiles and burns anyone close.',
  rockpillar: `Raises a low barricade (2 m) across the path for ${n1(L1('rockpillar').duration)} s: blocks wizards and projectiles.`,
  bouncer: `Hits and jumps to the nearest wizard, losing ${pct(1 - BOUNCER.decay)} of the damage per enemy.`,
  drain: 'Goes to the point and turns to the nearest wizard: on an enemy, damage, slow and the health comes back to you; on an ally, heal and haste.',
  snowball: 'Slow ball that passes through and drags anyone it touches, with damage, and explodes at the end of the path.',
  illusion: `A copy starts at your location and moves straight in your current direction for ${n1(L1('illusion').duration)} s; you can move freely while invisible until it vanishes. The copy cannot be destroyed, but can be pushed. The Homing Missile and bots aim at it. Cooldown ${n1(L1('illusion').cd)} s.`,
  magnetize: "On an enemy, pulls other casters' projectiles toward them; on an ally or on you (after a bounce), repels them.",
  recharge: 'If it hits, it comes back and resets its own cooldown; each consecutive hit adds damage.',
  alteration: `For ${n1(L1('alteration').duration)} s, swaps places with the first enemy projectile that comes close.`,
  link: 'Latches onto a wizard and pulls them to you (damaging the enemy); on an obstacle, pulls you to it.',
  windwalk: `Invisible and faster for ${n1(L1('windwalk').duration)} s; the first enemy you touch takes damage. Casting a spell cancels it.`,
  splitter: 'Bursts at the point (or at the first thing it touches) into 8 projectiles that fan out.',
  warpzone: 'Sphere that slows enemy projectiles passing through it and enemies walking inside it.',
};
export { RULES_SHORT_EN, RULES_SHORT_PT };
export const RULES_SHORT = LANG === 'en' ? RULES_SHORT_EN : RULES_SHORT_PT;
