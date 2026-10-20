// Dica ao passar o mouse (ou focar com o teclado) em magias e itens: números do nível atual e o que muda no próximo.
import { AEGIS, ITEMS, PACT, REDIRECTOR, SCOURGE, SHOCK_BOOTS, WIND_BOOTS, isActive, type ItemId } from '../shared/items.ts';
import { LAVA_DPS } from '../shared/constants.ts';
import { SCRIPTS, createDemo, runDemo, type DemoId } from './demo.ts';
import { itemName, itemText, spellName, t } from './i18n.ts';
import { labelOf } from './keys.ts';
import { MAX_SPELL_LEVEL, RECHARGE, RUSH, SPELLS, WARPZONE, type Level, type SpellId } from '../shared/spells.ts';
import { RULES_SHORT, n1 } from './rules-text.ts';
import { COLORS } from './scene.ts';

const m = (x: number) => `${n1(x)} m`;
const s = (x: number) => `${n1(x)} s`;
// lugar da demonstração do grimório no topo da dica (withTip liga a animação quando a dica abre)
const demo = (id: DemoId) => (SCRIPTS[id] ? `<canvas class="tip-demo" data-demo="${id}" aria-hidden="true"></canvas>` : '');

// rótulos que se repetem em muitas magias
const DMG = t('Dano', 'Damage');
const KNOCK = t('Empurrão', 'Knockback');
const CD = t('Recarga', 'Cooldown');
const RANGE = t('Alcance', 'Range');
const DURATION = t('Duração', 'Duration');
const RADIUS = t('Raio', 'Radius');
const DPS = t('Dano por segundo', 'Damage per second');
const PULL = t('Puxão', 'Pull');

type Row = [label: string, value: (l: Level) => string];
// todo campo do nível que muda o jogo tem uma linha (o teste confere)
export const SPELL_ROWS: Record<SpellId, Row[]> = {
  fireball: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  lightning: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  homing: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [t('Tempo de voo', 'Flight time'), (l) => s(l.duration)]],
  shield: [[DURATION, (l) => s(l.duration)], [t('Raio da bolha', 'Bubble radius'), (l) => m(l.radius)], [CD, (l) => s(l.cd)]],
  teleport: [[RANGE, (l) => m(l.range)], [CD, (l) => s(l.cd)]],
  swap: [[RANGE, (l) => m(l.range)], [CD, (l) => s(l.cd)]],
  grip: [[t('Tempo preso', 'Time gripped'), (l) => s(l.duration) + t(' ou até o 1º golpe', ' or until the 1st hit')], [t('Empurrão do golpe que solta', 'Knockback of the hit that frees'), (l) => `+${Math.round(l.scale * 100)}%`], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  meteor: [[t('Dano no centro', 'Center damage'), (l) => n1(l.dmg)], [t('Dano na borda', 'Edge damage'), (l) => n1(l.dmgMin)], [t('Empurrão no centro', 'Center knockback'), (l) => m(l.knock / 1.166)], [RADIUS, (l) => m(l.radius)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  rush: [[t('Avanço', 'Dash'), () => m(RUSH.dash)], [DURATION, (l) => s(l.duration)], [t('Dano absorvido', 'Damage absorbed'), (l) => n1(l.absorb)], [CD, (l) => s(l.cd)]],
  cluster: [[t('Dano por projétil', 'Damage per projectile'), (l) => n1(l.dmg)], [t('Empurrão por projétil', 'Knockback per projectile'), (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  boomerang: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  thrust: [[t('Dano máximo', 'Max damage'), (l) => n1(l.dmg)], [t('Empurrão máximo', 'Max knockback'), (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  gravity: [[DPS, (l) => n1(l.dmg)], [PULL, (l) => `${n1(l.pull)} m/s²`], [RADIUS, (l) => m(l.radius)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  rockpillar: [[DURATION, (l) => s(l.duration)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  bouncer: [[t('Dano no 1º', 'Damage on the 1st hit'), (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [t('Alcance por salto', 'Range per bounce'), (l) => m(l.range)]],
  drain: [[t('Dano e cura', 'Damage and healing'), (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [t('Lentidão ou pressa', 'Slow or haste'), (l) => s(l.duration)], [CD, (l) => s(l.cd)], [t('Alcance até virar', 'Range until it turns'), (l) => m(l.range)]],
  snowball: [[t('Dano por segundo encostado', 'Damage per second touching'), (l) => n1(l.dot)], [t('Explosão no centro', 'Center blast'), (l) => n1(l.dmg)], [t('Empurrão da explosão', 'Blast knockback'), (l) => m(l.knock / 1.166)], [RADIUS, (l) => m(l.radius)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  illusion: [[t('Cópia e invisibilidade', 'Copy and invisibility'), (l) => s(l.duration)], [CD, (l) => s(l.cd)]],
  magnetize: [[DURATION, (l) => s(l.duration)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  recharge: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [t('Por acerto seguido', 'Per consecutive hit'), () => '+' + n1(RECHARGE.perHit)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  alteration: [[DURATION, (l) => s(l.duration)], [RADIUS, (l) => m(l.radius)], [CD, (l) => s(l.cd)]],
  link: [[DPS, (l) => n1(l.dmg)], [PULL, (l) => `${n1(l.pull)} m/s²`], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  windwalk: [[DMG, (l) => n1(l.dmg)], [KNOCK, (l) => m(l.knock / 1.166)], [DURATION, (l) => s(l.duration)], [CD, (l) => s(l.cd)]],
  splitter: [[t('Dano por filhote (8)', 'Damage per shard (8)'), (l) => n1(l.dmg)], [t('Empurrão por filhote', 'Knockback per shard'), (l) => m(l.knock / 1.166)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
  warpzone: [[t('Tempo dos projéteis', 'Projectile time'), (l) => `${n1(l.scale * 100)}%`], [t('Inimigos andam', 'Enemies move at'), () => t(`${n1(WARPZONE.wizMult * 100)}% da velocidade`, `${n1(WARPZONE.wizMult * 100)}% of normal speed`)], [RADIUS, (l) => m(l.radius)], [DURATION, (l) => s(l.duration)], [CD, (l) => s(l.cd)], [RANGE, (l) => m(l.range)]],
};

function table(rows: [string, string, string | null][]): string {
  return `<table>${rows.map(([k, now, next]) => `<tr><th>${k}</th><td>${now}</td>${next !== null ? `<td class="up">${next === now ? '' : '→ ' + next}</td>` : ''}</tr>`).join('')}</table>`;
}

export function spellTip(id: SpellId, level: number): string {
  const sp = SPELLS[id];
  const cur = sp.levels[Math.max(0, level - 1)];
  const next = level >= 1 && level < MAX_SPELL_LEVEL ? sp.levels[level] : null;
  const head = `<b>${spellName(id)}</b> <span class="k">${labelOf(id)}</span><br><small>${level ? t(`Nível ${level} de ${MAX_SPELL_LEVEL}`, `Level ${level} of ${MAX_SPELL_LEVEL}`) : t('Ainda não comprada · preço ', 'Not bought yet · price ') + sp.cost}</small>`;
  const rows = SPELL_ROWS[id].map(([k, f]): [string, string, string | null] => [k, f(cur), next ? f(next) : null]);
  const foot = next ? `<small class="up">${t(`Próximo nível (${sp.up[level - 1]} de ouro): o que está à direita`, `Next level (${sp.up[level - 1]} gold): shown on the right`)}</small>` : level >= MAX_SPELL_LEVEL ? `<small>${t('Nível máximo', 'Max level')}</small>` : '';
  return `${demo(id)}${head}<p>${RULES_SHORT[id]}</p>${table(rows)}${foot}<small class="muted">${t('Empurrão: distância que um mago sem dano acumulado desliza.', 'Knockback: distance a wizard with no accumulated damage slides.')}</small>`;
}

// grimório: todos os níveis lado a lado; linha igual em todos os níveis vira uma célula só
function levelsTable(heads: number, rows: [string, string[]][]): string {
  const cells = (vals: string[]) => (vals.every((x) => x === vals[0]) ? `<td colspan="${heads}">${vals[0]}</td>` : vals.map((x) => `<td>${x}</td>`).join(''));
  return `<table class="lv"><tr><th>${t('Nível', 'Level')}</th>${Array.from({ length: heads }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>${rows.map(([k, vals]) => `<tr><th>${k}</th>${cells(vals)}</tr>`).join('')}</table>`;
}
export function spellLevels(id: SpellId): string {
  const sp = SPELLS[id];
  return levelsTable(MAX_SPELL_LEVEL, [[t('Ouro', 'Gold'), [sp.cost, ...sp.up].map(String)], ...SPELL_ROWS[id].map(([k, f]): [string, string[]] => [k, sp.levels.map(f)])]);
}
export function itemLevels(id: ItemId): string {
  const n = ITEMS[id].levels.length;
  const per = Array.from({ length: n }, (_, l) => ITEM_ROWS[id]!(l));
  return levelsTable(n, [[t('Ouro', 'Gold'), per.map(() => String(ITEMS[id].cost))], ...per[0].map(([k], i): [string, string[]] => [k, per.map((r) => r[i][1])])]);
}

const KNOCK_TAKEN = t('Empurrão recebido', 'Knockback taken');
const SLOWS = t('Lentidões', 'Slows');
const WITH_BOOTS_RULE = t('vale a maior velocidade, não soma', 'the highest speed applies, no stacking');

export const ITEM_ROWS: Partial<Record<ItemId, (lvl: number) => [string, string][]>> = {
  ring: (l) => [[t('Vida máxima', 'Max health'), '+' + n1(ITEMS.ring.levels[l].hp!)]],
  cursed_ring: (l) => [[t('Vida máxima', 'Max health'), '+' + n1(ITEMS.cursed_ring.levels[l].hp!)], [KNOCK_TAKEN, `−${n1(ITEMS.cursed_ring.levels[l].kb! * 100)}%`], [SLOWS, t(`+${n1(ITEMS.cursed_ring.levels[l].debuff! * 100)}% de duração`, `+${n1(ITEMS.cursed_ring.levels[l].debuff! * 100)}% duration`)]],
  cape: (l) => [[t('Vida por segundo', 'Health per second'), '+' + n1(ITEMS.cape.levels[l].regen!)]],
  armor: (l) => [[KNOCK_TAKEN, `−${n1(ITEMS.armor.levels[l].kb! * 100)}%`]],
  boots: (l) => [[t('Velocidade', 'Speed'), `+${n1(ITEMS.boots.levels[l].speed! * 100) } cm/s`]],
  watch: (l) => [[SLOWS, t(`−${n1(-ITEMS.watch.levels[l].debuff! * 100)}% de duração`, `−${n1(-ITEMS.watch.levels[l].debuff! * 100)}% duration`)]],
  vampire: (l) => [[t('Vida de volta', 'Health back'), t(`${n1(ITEMS.vampire.levels[l].lifesteal! * 100)}% do dano causado`, `${n1(ITEMS.vampire.levels[l].lifesteal! * 100)}% of damage dealt`)]],
  scourge: (l) => [[t('Dano em volta', 'Damage around you'), n1(SCOURGE.dmg[l])], [RADIUS, m(SCOURGE.radius)], [t('Preparo', 'Windup'), s(SCOURGE.windup)], [CD, s(SCOURGE.cd)]],
  redirector: () => [[CD, s(REDIRECTOR.cd)], [t('Desvia', 'Deflects'), t('todos os seus projéteis voando', 'all your projectiles in flight')], [t('Sem projétil voando', 'No projectile in flight'), t('não gasta a recarga', 'does not use the cooldown')]],
  pact: () => [[t('Próxima magia de dano', 'Next damage spell'), t(`${n1(PACT.mult)}× dano e empurrão`, `${n1(PACT.mult)}× damage and knockback`)], [t('Janela', 'Window'), s(PACT.window)], [CD, s(PACT.cd)]],
  lava_boots: (l) => [[t('Dano da lava', 'Lava damage'), t(`−${n1(ITEMS.lava_boots.levels[l].lava! * 100)}% (${n1(LAVA_DPS * (1 - ITEMS.lava_boots.levels[l].lava!))} por segundo)`, `−${n1(ITEMS.lava_boots.levels[l].lava! * 100)}% (${n1(LAVA_DPS * (1 - ITEMS.lava_boots.levels[l].lava!))} per second)`)]],
  warden: (l) => [[t('Dano por golpe', 'Damage per hit'), t(`−${n1(ITEMS.warden.levels[l].ward!)} (no máximo metade do golpe)`, `−${n1(ITEMS.warden.levels[l].ward!)} (at most half the hit)`)], [KNOCK_TAKEN, `+${n1(-ITEMS.warden.levels[l].kb! * 100)}%`]],
  helmet: () => [[KNOCK_TAKEN, `−${n1(ITEMS.helmet.levels[0].kb! * 100)}%`], [t('Alcance das magias', 'Spell range'), `−${n1(-ITEMS.helmet.levels[0].range! * 100)}%`]],
  wind_boots: () => [[t('5 s sem causar nem levar dano', '5 s without dealing or taking damage'), `+${n1(WIND_BOOTS.speed * 100)} cm/s`], [t('Acaba', 'Ends'), t('ao causar ou levar dano (golpe, lava, fogo)', 'when you deal or take damage (hit, lava, fire)')], [t('Com outras botas', 'With other boots'), WITH_BOOTS_RULE]],
  shock_boots: () => [[t('Ao levar um golpe', 'When you take a hit'), t(`+${n1(SHOCK_BOOTS.speed * 100)} cm/s por ${s(SHOCK_BOOTS.secs)}`, `+${n1(SHOCK_BOOTS.speed * 100)} cm/s for ${s(SHOCK_BOOTS.secs)}`)], [t('Com Botas', 'With Boots'), WITH_BOOTS_RULE]],
  aegis: () => [[t('Quando', 'When'), t(`na lava com ${AEGIS.hp} de vida ou menos`, `in the lava with ${AEGIS.hp} health or less`)], [t('Efeito', 'Effect'), t(`volta parado para ${n1(AEGIS.back * 100)}% do raio da arena`, `brings you back, standing still, to ${n1(AEGIS.back * 100)}% of the arena radius`)], [t('Usos', 'Uses'), t('1: quebra ao salvar você (compre de novo na loja)', '1: breaks when it saves you (buy again in the shop)')]],
};

export function itemTip(id: ItemId, level: number): string {
  const it = ITEMS[id];
  const max = it.levels.length;
  const head = `<b>${itemName(id)}</b>${isActive(id) ? ` <span class="k">${labelOf(id)}</span>` : ''}<br><small>${level ? t(`Nível ${level} de ${max}`, `Level ${level} of ${max}`) : t('Ainda não comprado', 'Not bought yet')} · ${isActive(id) ? t('ativo', 'active') : t('passivo', 'passive')} · ${t(`${it.cost} de ouro por nível`, `${it.cost} gold per level`)}</small>`;
  const rows = ITEM_ROWS[id]!;
  const cur = rows(Math.max(0, level - 1));
  const next = level >= 1 && level < max ? rows(level) : null;
  const body = table(cur.map(([k, v], i): [string, string, string | null] => [k, v, next ? next[i][1] : null]));
  return `${demo(id)}${head}<p>${itemText(id)}</p>${body}${next ? `<small class="up">${t('Próximo nível: o que está à direita', 'Next level: shown on the right')}</small>` : level >= max ? `<small>${t('Nível máximo', 'Max level')}</small>` : ''}`;
}


let tipEl: HTMLDivElement | null = null;
let owner: HTMLElement | null = null; // elemento cuja dica está aberta

// liga a dica a um elemento; o conteúdo é gerado na hora (o nível pode ter mudado)
export function withTip<T extends HTMLElement>(target: T, html: () => string): T {
  const show = () => {
    owner = target;
    tipEl ??= Object.assign(document.createElement('div'), { className: 'tip', role: 'tooltip' });
    if (!tipEl.isConnected) document.body.append(tipEl);
    tipEl.innerHTML = html();
    tipEl.hidden = false; // escondida, a altura medida seria zero e a dica cobriria o botão
    const r = target.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 10 > 8 ? r.top - h - 10 : r.bottom + 10;
    tipEl.style.transform = `translate(${x}px, ${y}px)`;
    // uma demo por vez: a próxima dica troca o innerHTML e desliga o canvas desta; no toque o CSS esconde o canvas (largura 0) e ela nem começa
    const c = tipEl.querySelector<HTMLCanvasElement>('canvas[data-demo]');
    if (c?.clientWidth) runDemo(createDemo(c, c.dataset.demo as DemoId, COLORS.slice(0, 3)).tick, () => c.isConnected && !tipEl!.hidden, matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  const hide = () => tipEl && (tipEl.hidden = true);
  target.addEventListener('mouseenter', show);
  target.addEventListener('mouseleave', hide);
  // focusin/focusout sobem do botão para o cartão: focar "Comprar" pelo teclado mostra a dica do cartão
  target.addEventListener('focusin', show);
  target.addEventListener('focusout', hide);
  return target;
}

// com `within`, só esconde se a dica aberta é de algo dentro dele (ou que já saiu da tela): redesenhar a loja não fecha a dica da barra
export function hideTip(within?: HTMLElement) {
  if (!tipEl || (within && owner?.isConnected && !within.contains(owner))) return;
  tipEl.hidden = true;
}
