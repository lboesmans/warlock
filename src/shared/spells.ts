import { FRICTION, KB_PER_DMG, UNIT, WIZ_SPEED } from './constants.ts';

export const SPELL_IDS = ['fireball', 'lightning', 'homing', 'shield', 'teleport', 'swap', 'grip', 'meteor', 'rush', 'cluster', 'boomerang', 'thrust', 'gravity', 'rockpillar', 'bouncer',
  'drain', 'snowball', 'illusion', 'magnetize', 'recharge', 'alteration', 'link', 'windwalk', 'splitter', 'warpzone'] as const;
export type SpellId = (typeof SPELL_IDS)[number];
export const isSpell = (x: unknown): x is SpellId => SPELL_IDS.includes(x as SpellId);
// decisão do Fernando (17/10): no máximo 6 magias por mago (a Bola de fogo conta)
export const MAX_SPELLS = 6;

// radius: raio da explosão do Meteoro (e do dano da Gravidade); dmgMin: dano na borda dele; absorb: dano que a Investida converte em velocidade;
// pull: puxão da Gravidade nos magos (m/s²); scale: tempo dos projéteis inimigos na Zona de dobra; dot: dano por segundo da Bola de neve encostada
export type Level = { cd: number; dmg: number; knock: number; speed: number; range: number; duration: number; radius: number; dmgMin: number; absorb: number; pull: number; scale: number; dot: number };
type Spell = { name: string; en: string; cost: number; up: number[]; levels: Level[] };

export const MAX_SPELL_LEVEL = 7;

// os 7 níveis do original (npc_abilities_custom.txt e npc_items_custom.txt); dano na escala de vida 1000 (a do original), distâncias em metros (UNIT)
// kbf = fator de empurrão da magia no original (o raio empurra 0,92 do normal)
const L = ({ kbf = 1, ...l }: Partial<Level> & { kbf?: number }): Level => ({ cd: 0, dmg: 0, speed: 0, range: 0, duration: 0, radius: 0, dmgMin: 0, absorb: 0, pull: 0, scale: 0, dot: 0, ...l, knock: (l.dmg ?? 0) * KB_PER_DMG * kbf });
const zip = (a: number[], b: number[]) => a.map((x, i) => [x, b[i]]);
const steps = (from: number, by: number) => Array.from({ length: MAX_SPELL_LEVEL }, (_, i) => Math.round((from + by * i) * 100) / 100);

export const SPELLS: Record<SpellId, Spell> = {
  fireball: { name: 'Bola de fogo', en: 'Fireball', cost: 0, up: [7, 7, 7, 7, 7, 7], levels: [70, 77, 84, 91, 98, 105, 112].map((d) => L({ cd: 4.8, dmg: d, speed: 1000 * UNIT, range: 1000 * UNIT })) },
  lightning: { name: 'Raio', en: 'Lightning', cost: 11, up: [8, 9, 10, 11, 12, 13], levels: zip([16.5, 15.5, 15, 14.5, 14, 13.5, 13], [70, 78, 86, 94, 102, 110, 118]).map(([cd, d]) => L({ cd: Math.round(cd * 14) / 10, dmg: d, kbf: 0.92, range: 800 * UNIT })) /* números pelo simulador (18/10, escolha do Fernando): recarga ×1,4 (1,32 → 1,13) */ }, // balanceamento de 17/10: recarga ×0,7 e alcance 600 → 800 (acertava 21%)
  homing: { name: 'Míssil teleguiado', en: 'Homing Missile', cost: 11, up: [8, 9, 10, 11, 12, 13], levels: zip([16.5, 14.5, 13, 12, 11, 10, 9], [70, 80, 90, 100, 110, 120, 130]).map(([cd, d]) => L({ cd, dmg: d * 0.34, speed: 1000 * UNIT, duration: 4.5 })) /* números pelo simulador (18/10): dano ×0,34 e curva 3 → 2,5 rad/s (1,34 → 1,13) */ },
  shield: { name: 'Escudo', en: 'Shield', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: [14, 13, 12, 11, 10, 9, 8].map((cd, i) => L({ cd: (cd * 16) / 14 /* 19/10, escolha do Fernando: 14 → 16 s no nível 1 (Difícil 1,18 → 1,16; Normal 0,96 → 0,97) */, duration: 1.2, radius: (200 + 10 * i) * UNIT })) }, // original (Fernando, 18/10: volta ao original até ter partidas reais; nos bots vence 46% acima do justo, eles reagem melhor que gente) // bolha de 200 a 260 (abil.txt do original)
  teleport: { name: 'Teleporte', en: 'Teleport', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: zip([16, 13.5, 11.5, 10, 9, 8, 7], [770, 840, 910, 980, 1050, 1120, 1190]).map(([cd, r]) => L({ cd: cd * 1.1, range: r * UNIT })) }, // 18/10 com as ilhas de refúgio: recarga ×1,1 (18% acima do justo no Normal)
  // as cinco magias seguintes: npc_abilities_custom.txt, spells/*.lua e shop/warlock_shop_data.js do Warlock Brawl
  // troca: projétil de 1983 u/s que vive 0,4706 s (alcance 933 u)
  swap: { name: 'Troca', en: 'Swap', cost: 11, up: [6, 7, 8, 9, 10, 11], levels: [15.8, 13.3, 11.3, 9.8, 8.8, 7.8, 7].map((cd) => L({ cd: cd * 1.3, speed: 1983 * UNIT, range: 933 * UNIT })) }, // 18/10 bots humanos: recarga ×1,3 (26% / 29% acima do justo no Normal / Difícil)
  // agarrar: projétil de 1000 u/s por 1,1 s; duration = tempo preso
  // Agarrar prende metade do tempo do original (nerf pedido pelo Fernando, 17/10)
  grip: { name: 'Agarrar', en: 'Grip', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: [24, 19, 15, 12, 10, 8.5, 7].map((cd, i) => L({ cd: cd * 0.8, duration: 2.25, speed: 1000 * UNIT, range: 1100 * UNIT, scale: steps(0.3, 0.1)[i] })) /* 18/10: tempo preso fixo, preso sem proteção de empurrão (0,81 → 0,91); Agarrar novo (18/10): scale = empurrão a mais do golpe que solta, +30% a +90% */ },
  // meteoro: dano de 40 na borda (aqui 60) até o máximo no centro; empurrão 0,66
  meteor: { name: 'Meteoro', en: 'Meteor', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: zip([20, 19.5, 19, 18.5, 18, 17.5, 17], [110, 120, 130, 140, 150, 160, 170]).map(([cd, d], i) => L({ cd: cd * 0.9, dmg: d, dmgMin: 60, kbf: 0.66, /* ciclo 1: recarga ×0,9 (0,94×) */ /* borda 40 → 60 em 17/10 */ radius: [225, 240, 255, 269, 282, 294, 304][i] * UNIT, range: 1000 * UNIT })) },
  // investida: absorve até `absorb` de dano (metade de cada golpe) e vira velocidade
  rush: { name: 'Investida', en: 'Rush', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: zip([21, 20, 19, 18, 17, 16, 15], [6, 6.5, 7, 7.5, 8, 8.5, 9]).map(([cd, duration], i) => L({ cd: cd * 1.2, duration, absorb: (50 + 20 * i) * 0.25 })) }, // 18/10: absorve ¼ e recarga ×1,2; avanço 40 → 20 (1,36 → 1,13)
  // rajada: 4 projéteis em leque de 844 u/s e 672 u de alcance; empurrão 0,65
  cluster: { name: 'Rajada', en: 'Cluster', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: zip([15.5, 14.75, 14, 13.25, 12.5, 11.75, 11], [33, 36, 39, 42, 45, 48, 51]).map(([cd, d]) => L({ cd, dmg: d, kbf: 0.65, speed: 844 * UNIT, range: 672 * UNIT })) },
  // as cinco do Warlock Brawl de 17/10 (decisão do Fernando): npc_abilities_custom.txt, base/shop.lua, spells/, projectiles/ e modifiers/
  // bumerangue: curva até o ponto (300 a 800 u) e volta ao dono; empurrão 0,95
  boomerang: { name: 'Bumerangue', en: 'Boomerang', cost: 11, up: [7, 8, 9, 10, 11, 12], levels: zip([16, 13.9, 12.5, 11.7, 11, 10.3, 9.6], [70, 76, 82, 88, 94, 100, 106]).map(([cd, d]) => L({ cd, dmg: d, kbf: 0.95, speed: 1500 * UNIT, range: 800 * UNIT })) },
  // estocada: o mago dispara até 900 u a 1300 u/s; dano cheio só a 89% da velocidade máxima ou mais; empurrão 1,2
  thrust: { name: 'Estocada', en: 'Thrust', cost: 11, up: [6, 7, 8, 9, 10, 11], levels: zip([16.5, 14.5, 13, 12, 11, 10, 9], [50, 55, 60, 65, 70, 75, 80]).map(([cd, d]) => L({ cd: cd * 1.25 /* 18/10: ×1,15 e depois ×1,25 (17% acima com as ilhas) */, dmg: d, kbf: 1.2, speed: 1300 * UNIT, range: 900 * UNIT })) },
  // gravidade: orbe de 450 u/s por 900 u; dmg = dano por segundo em quem está a 250 u; pull = força em 550 u (sem empurrão)
  gravity: { name: 'Gravidade', en: 'Gravity', cost: 12, up: [7, 8, 9, 10, 11, 12], levels: zip([21, 20.5, 20, 19.5, 19, 18.5, 18], [20, 33.33, 46.67, 60, 73.33, 86.67, 100]).map(([cd, d], i) => L({ cd, dmg: d * 2, kbf: 0, speed: 450 * UNIT, range: 900 * UNIT, radius: 250 * UNIT, /* 18/10: dano por segundo ×2 (0,89 → 0,97) */ pull: (500 + 30 * i) * UNIT })) },
  // pilar de pedra: obstáculo de 4 s no original a até 650..1100 u; recarga = AbilityCooldown (o cooldown2 do mesmo arquivo diz 24..12 e só aparece na dica)
  rockpillar: { name: 'Barricada', en: 'Barricade', cost: 13, up: [5, 6, 7, 8, 9, 10], levels: zip([26, 24, 22, 20, 18, 16, 14], [650, 725, 800, 875, 950, 1025, 1100]).map(([cd, r]) => L({ cd: cd * 0.7, duration: 5, range: r * UNIT })) /* 18/10: recarga ×0,7 e 5 s (0,86 → 0,97) */ },
  // ricochete: 900 u/s, vive 1 s e renova a cada mago tocado; perde 30% a cada inimigo acertado; empurrão 1,2
  bouncer: { name: 'Ricochete', en: 'Bouncer', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: zip([19, 18, 17, 16, 15, 14, 13], [54, 62, 70, 78, 86, 94, 102]).map(([cd, d]) => L({ cd, dmg: d, kbf: 1.2, speed: 900 * UNIT, range: 900 * UNIT })) },
  // as dez restantes do Warlock Brawl (dono do jogo, 17/10): npc_abilities_custom.txt, base/shop.lua, spells/, projectiles/ e modifiers/
  // drenar: 700 u/s até o ponto (máx. 850 u), depois vira para o mago mais perto; duration = lentidão no inimigo e pressa no aliado; empurrão 0,2
  drain: { name: 'Drenar', en: 'Drain', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: steps(22, -1).map((cd, i) => L({ cd: cd * 1.2 /* 18/10 bots humanos: 16% acima (×1,1); 19/10 bots do fim de rodada: 16% acima de novo (×1,2) */, dmg: 60 + 10 * i, kbf: 0.2, speed: 700 * UNIT, range: 850 * UNIT, duration: 4 + i })) },
  // bola de neve: 400 u/s por 575 u; dmg = explosão no centro (damage_max; 0 na borda do raio de 200 u; empurrão 0,8); dot = damage, por segundo encostado
  snowball: { name: 'Bola de neve', en: 'Snowball', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: steps(19, -1).map((cd, i) => L({ cd, dmg: (45 + 35 * i) * 1.3, kbf: 0.8, dot: 30 + 10 * i, /* 18/10: explosão ×1,3, +35 e +10 de lentidão por nível (0,91 → 0,96) */ speed: 400 * UNIT, range: 575 * UNIT, radius: 200 * UNIT })) },
  // ilusão (decisão do Fernando, 19/10; não existe no original): a cópia sai do lugar do mago, anda na direção do movimento por 2 s e pode ser empurrada, mas não destruída
  illusion: { name: 'Ilusão', en: 'Illusion', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: steps(14, -0.5).map((cd) => L({ cd, duration: 2, speed: WIZ_SPEED })) },
  // magnetizar: projétil de 800 u/s por 1,2 s (960 u); duration = tempo magnetizado
  magnetize: { name: 'Magnetizar', en: 'Magnetize', cost: 14, up: [5, 6, 7, 8, 9, 10], levels: steps(22, -1).map((cd, i) => L({ cd, duration: (3.5 + 1.5 * i) * 1.25, speed: 800 * UNIT, range: 960 * UNIT })) /* 18/10: +1,5 s por nível (era +0,5; 0,88 → 0,92) */ },
  // recarga: 900 u/s por 1 s; +10 de dano por acerto seguido (RECHARGE)
  recharge: { name: 'Recarga', en: 'Recharge', cost: 13, up: [6, 7, 8, 9, 10, 11], levels: zip([23.5, 22, 21, 20.5, 20, 19.5, 19], [60, 67, 74, 81, 88, 95, 102]).map(([cd, d]) => L({ cd, dmg: d, speed: 900 * UNIT, range: 900 * UNIT })) },
  // alteração: por 2 s, troca de lugar com o primeiro projétil inimigo que entrar na bolha de 120 u indo para o mago
  alteration: { name: 'Alteração', en: 'Alteration', cost: 11, up: [5, 6, 7, 8, 9, 10], levels: steps(19, -1.5).map((cd) => L({ cd, duration: 2, radius: 120 * UNIT })) },
  // elo: 950 u/s por 860 u e volta; preso, puxa a 1550 u/s²; dmg = dano por segundo no inimigo (sem empurrão).
  // AbilityCooldown do original tem só 6 valores (17 a 7): o nível 7 repete o 7, como o Dota faz
  link: { name: 'Elo', en: 'Link', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: zip([17, 15, 13, 11, 9, 7, 7], [12, 20, 28, 36, 44, 52, 60]).map(([cd, d]) => L({ cd: cd * 0.64, dmg: d * 5, kbf: 0, speed: 950 * UNIT, range: 860 * UNIT, pull: 1550 * 1.4 * UNIT })) /* 18/10: dano ×5, puxada ×1,4 e recarga ×0,64 (20% abaixo do justo com bots humanos) */ },
  // caminhada no vento: 2,6 s invisível e +200 u/s; o primeiro inimigo encostado leva o dano (empurrão normal)
  windwalk: { name: 'Caminhada no vento', en: 'Windwalk', cost: 14, up: [6, 7, 8, 9, 10, 11], levels: zip([29, 26, 23.5, 21, 19.5, 18.5, 17.5], [54, 60, 66, 72, 78, 84, 90]).map(([cd, d]) => L({ cd: cd * 1.25, dmg: d, duration: 2.6 })) }, // 18/10 bots humanos: recarga ×1,25 (16% e depois 19% acima no Normal)
  // divisor: 700 u/s por até 1 s (ou até o ponto); dmg = dano de cada um dos 8 filhotes
  splitter: { name: 'Divisor', en: 'Splitter', cost: 15, up: [7, 8, 9, 10, 11, 12], levels: steps(24, -1).map((cd, i) => L({ cd, dmg: 30 + 5 * i, speed: 700 * UNIT, range: 700 * UNIT })) },
  // zona de dobra: esfera de 4,5 s a até 700 u; scale = tempo dos projéteis inimigos dentro dela
  warpzone: { name: 'Zona de dobra', en: 'Warp Zone', cost: 12, up: [6, 7, 8, 9, 10, 11], levels: zip([23, 21, 20, 19, 18, 17, 16], steps(0.4, -0.04)).map(([cd, scale], i) => L({ cd: cd * 0.5, duration: 4.5, scale, /* 18/10: recarga ×0,7 → ×0,6 (19% abaixo com bots humanos) e raio +20 por nível; 19/10: ×0,5 (16% abaixo no Normal) */ radius: (200 + 20 * i) * UNIT, range: 700 * UNIT })) },
};

// agarrar (ideia do Fernando, 18/10): o preso fica no lugar até o primeiro golpe com dano (ou o fim do tempo), e esse golpe
// o solta empurrando mais (o scale do nível: +30% no 1 até +90% no 7); cada magia lançada preso soma 5 ao dano acumulado (gripmodifier.lua)
// Zona de dobra: inimigo de quem a criou anda mais devagar dentro dela (pedido do Fernando, 18/10; não existe no original)
export const WARPZONE = { wizMult: 0.5 }; // 0,6 → 0,5 em 18/10 (16% abaixo do justo com bots humanos)
export const GRIP = { castPenalty: 5 };
// meteoro: 0,55 s parado no ar + 0,60 s caindo (meteor.lua)
export const METEOR_DELAY = 1.15;
// investida: +35 u/s ao ativar; cada ponto absorvido soma 1,5 u/s (rushmodifier.lua)
// avanço: 3 m em 0,2 s na direção do mouse (não existe no original; pedido do Fernando, 17/10: "dash não funciona")
export const RUSH = { bonus: 35 * UNIT, perHp: 1.5 * UNIT, share: 0.5, dash: 3, dashTime: 0.2, dashDmg: 20 }; // ciclo 1 (18/10): dano do avanço 60 → 40 (Investida 1,30×) // dashDmg: dano em quem o avanço encostar (pedido do Fernando, 17/10)
// rajada: ângulos do leque em radianos (cluster.lua)
export const CLUSTER_FAN = [-0.18, -0.06, 0.06, 0.18];

export const HOMING_TURN = 2.5; // rad/s

// bumerangue (boomerangprojectile.lua): sai a 1500 u/s com 300 u/s de lado, volta mirando o dono a 1000 u/s (virando 1000 u/s²);
// ao bater em mago quica a 500 u/s (750 em obstáculo); some perto do dono; life: teto de segurança (não existe no original)
export const BOOMERANG = { side: 300 * UNIT, minDist: 300 * UNIT, back: 1000 * UNIT, turn: 1000 * UNIT, bounce: 500 * UNIT, bounceWall: 750 * UNIT, gap: 10 * UNIT, life: 6 };
// estocada (thrust.lua, thrustmodifier.lua): sai a 77% da velocidade e acelera até ela (aceleração que empata com o atrito);
// dura o caminho + 0,09 s; sem acertar, freia para 20%; reach: a bolha da estocada tem 30 u a mais que o mago
export const THRUST = { start: 0.77, accel: FRICTION, extra: 0.09, endSlow: 0.2, reach: 30 * UNIT, full: 0.8 };
// gravidade (gravity.lua, gravityprojectile.lua): puxa magos inimigos até 550 u e projéteis até 600 u (1650 u/s², de qualquer dono)
export const GRAVITY = { wizR: 550 * UNIT, projR: 600 * UNIT, projPull: 1650 * UNIT, tick: 0.2 };
// ricochete (bouncerprojectile.lua): cada inimigo acertado tira 30% do dano; abaixo de 10 some
export const BOUNCER = { decay: 0.7, minDmg: 10 };
// drenar (drain.lua, drainprojectile.lua, drainhealprojectile.lua): depois do ponto voa mais 1,2 s a 600 u/s rumo ao mago mais perto
// (aliado ou inimigo); no inimigo −50 u/s, no aliado +50 u/s; a cura volta a 650 u/s e chega a 64 u de quem lançou; life: teto da volta
export const DRAIN = { extra: 1.2, turnSpeed: 600 * UNIT, slow: 50 * UNIT, haste: 50 * UNIT, back: 650 * UNIT, reach: 64 * UNIT, life: 10 };
// bola de neve (snowballprojectile.lua, snowballmodifier.lua): rola atravessando magos e os arrasta a 425 u/s; quem encosta fica −100 u/s
// por 0,5 s e leva dot × 0,5 no fim (sem empurrão); bolha de 75 u + 2 u por nível
export const SNOWBALL = { drag: 425 * UNIT, slow: 100 * UNIT, period: 0.5, coll: 75 * UNIT, perLevel: 2 * UNIT };
// magnetizar (magnetizemodifier.lua): projéteis inimigos do magnetizado até 300 u viram 20%·(1 − d²/300²) por tique de 0,035 s
export const MAGNETIZE = { r: 300 * UNIT, f: 0.2, tick: 0.035 };
// recarga (recharge.lua, rechargerefreshprojectile.lua): +10 por acerto seguido; a volta anda 400 u/s e zera a recarga a 64 u
export const RECHARGE = { perHit: 10, back: 400 * UNIT, reach: 64 * UNIT, life: 10 };
// elo (link.lua, linkprojectile.lua, linkmodifier.lua): recolhe e some a 75 u do dono; preso, solta a 100 u entre os centros (40 u além
// do contato de 60 u) ou a 120 u do obstáculo (30 u além); dano a cada 0,2 s; life: teto de segurança do voo
export const LINK = { gone: 75 * UNIT, wizGap: 40 * UNIT, pillarGap: 30 * UNIT, tick: 0.2, life: 6 };
// caminhada no vento (windwalkmodifier.lua): +200 u/s; bolha de 60 u em volta do mago de 30 u: encosta 30 u antes do contato
export const WINDWALK = { speed: 200 * UNIT, reach: 30 * UNIT };
// divisor (splitter.lua, splitterspawnerprojectile.lua, splitterchildprojectile.lua): o lançador anda 250 u/s por 0,48 s e solta 4 ondas
// de 2 filhotes; filhotes a 600 u/s por 1,2 s
export const SPLITTER = { spawnSpeed: 250 * UNIT, spawnLife: 0.48, waves: 4, childSpeed: 600 * UNIT, childLife: 1.2 };

// tempo de conjuração: a magia sai esse tempo depois da tecla (AbilityCastPoint do original era 0,2 s)
export const CAST_POINT: Record<SpellId, number> = { fireball: 0.1, lightning: 0.1, homing: 0.1, shield: 0, teleport: 0, swap: 0, grip: 0.1, meteor: 0.1, rush: 0, cluster: 0.1, boomerang: 0.1, thrust: 0, gravity: 0.1, rockpillar: 0, bouncer: 0.1,
  drain: 0.1, snowball: 0.1, illusion: 0, magnetize: 0.1, recharge: 0.1, alteration: 0, link: 0.1, windwalk: 0, splitter: 0, warpzone: 0.1 }; // Alteração, Caminhada e Divisor: 0 no original; Ilusão 0 (defesa, como o Escudo) // original 0,2 s (Estocada 0); 0,1 s a pedido do Fernando (17/10)

export const spellLevel = (id: SpellId, level: number): Level => SPELLS[id].levels[Math.max(1, Math.min(MAX_SPELL_LEVEL, level)) - 1];

// preço para subir do nível atual para o próximo; null = já no máximo
export function priceOf(id: SpellId, level: number): number | null {
  if (level >= MAX_SPELL_LEVEL) return null;
  return level === 0 ? SPELLS[id].cost : SPELLS[id].up[level - 1];
}

export const noSpells = (): Record<SpellId, number> => ({ ...Object.fromEntries(SPELL_IDS.map((s) => [s, 0])), fireball: 1 }) as Record<SpellId, number>;

export const spellCount = (spells: Record<SpellId, number>) => SPELL_IDS.filter((s) => spells[s] > 0).length;
