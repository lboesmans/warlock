# Warlock Wars: guia do colaborador

Tudo para contribuir com o jogo usando um agente de IA (Claude Code, Codex, Cursor…) no mesmo fluxo do dono do projeto, sem quebrar o que já funciona. Regras de código e comandos: [CLAUDE.md](../CLAUDE.md). Fluxo de Git: [CONTRIBUTING.md](../CONTRIBUTING.md).

## Comece aqui

Warlock Wars é um remake web do mod **Warlock** (Warcraft 3 / Warlock Brawl do Dota 2): magos numa arena de pedra cercada de lava que encolhe. Ninguém morre de dano: você empurra os outros para a lava com magias. O último de pé vence a rodada; entre rodadas, uma loja vende magias e itens. O público são jogadores de Dota, então a interface segue o jeito do Dota.

- Jogar: https://warlock.fernandorffdev.com (jogue algumas partidas antes de mexer no código)
- Código: https://github.com/fernandorff/warlock; tarefas saem de `dev` (dev geral), o jogo no ar é o `master`

Primeiro dia:

1. Aceite o convite de colaborador (e-mail ou https://github.com/fernandorff/warlock/invitations). Trabalhe em branches deste repositório, não num fork: em fork o CI precisa de aprovação manual, a revisão automática não roda e o ambiente dev não publica.
2. Prepare a máquina e rode o jogo localmente.
3. Instale o Claude Code e as skills.
4. Jogue e abra o grimório (<kbd>F1</kbd>) e a biblioteca de magias e itens (<kbd>F2</kbd>).
5. Escolha algo pequeno (etiqueta `bom primeiro PR`, ou abra uma issue de Ideia) e combine antes de codar.
6. Branch, gates, PR pelo modelo.

## Preparar a máquina

| Ferramenta | Versão | Para quê |
|---|---|---|
| Node.js | 24 ou mais novo | jogo, testes e simulador (o CI usa 24) |
| Git | recente | branches e commits |
| GitHub CLI (`gh`) | recente | PR e CI pelo terminal (o agente usa) |
| Google Chrome | instalado | scripts de teste no navegador |

```bash
git clone https://github.com/fernandorff/warlock.git
cd warlock
npm ci
npx wrangler dev            # servidor + jogo em http://localhost:8787
```

Não precisa de conta Cloudflare para desenvolver: o `wrangler dev` roda Workers + Durable Objects localmente. Para jogar com outra pessoa no mesmo PC, abra outra aba com `?as=outro` no endereço.

Gates (todos verdes antes de cada commit; o CI roda os mesmos):

```bash
npx tsc --noEmit -p .
npx tsc --noEmit -p src/worker
npx vitest run
npx vite build
```

## Ambiente dev próprio

Push na branch `<usuário do GitHub>-dev` publica em `https://<usuário do GitHub>-dev-warlock.fernandorffdev.com`, com salas separadas do jogo no ar. Branches de hoje: `lboesmans-dev`, `breakie33-dev`, `lucascvalle-dev`, `arthurbaquit-dev` e `fernandorff-dev`; o dev geral é a branch `dev` (https://dev-warlock.fernandorffdev.com). Serve para testar com outras pessoas antes do PR. Só funciona com branch neste repositório (não em fork).

```bash
git push --force origin HEAD:lboesmans-dev   # publica o estado da sua branch de tarefa
```

A branch `-dev` é sua (pode substituir à vontade); o PR sai sempre da branch da tarefa.

## Pipelines

| Pipeline | Arquivo | Quando roda | O que faz | Se der errado |
|---|---|---|---|---|
| CI | `ci.yml` | todo PR e todo push no `dev` e no `master` | os dois `tsc`, `vitest run`, `vite build` | o PR não entra; abra o log em Actions e corrija na mesma branch |
| Título do PR | `pr-title.yml` | ao abrir ou editar o PR | confere o formato `tipo: o que muda` | edite o título; roda de novo sozinho |
| Revisão do Claude | `claude-review.yml` | PR aberto, commit novo, saiu de rascunho | comenta veredito, checagens e pontos (não aprova nem mescla) | não bloqueia; não roda em fork nem no PR que altera o próprio workflow |
| `@claude` | `claude.yml` | comentário com `@claude` num PR ou issue | responde e ajuda no próprio PR/issue | — |
| Ambiente dev | `dev-deploy.yml` | push na branch `<usuário do GitHub>-dev` ou `dev` (dev geral) | build, publica um Worker só seu, espera o domínio responder e roda o teste rápido | build quebrado: nada é publicado e o site anterior continua; teste rápido falhou: a versão nova já foi publicada e está com problema, veja o log |
| Produção | `deploy.yml` | push no `master` (merge do PR `dev` → `master`) | gates, publica o jogo no ar, confere se o site serve o build novo e roda o teste rápido | falhou antes do deploy: nada muda no ar; falhou depois: o jogo no ar está com a versão nova, veja o log |

Logs: https://github.com/fernandorff/warlock/actions.

## Claude Code e as skills

Dentro do Claude Code:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install superpowers@claude-plugins-official
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
# opcionais
/plugin install frontend-design@claude-plugins-official
/plugin install playwright@claude-plugins-official
```

| Skill | Quando |
|---|---|
| `superpowers:brainstorming` | antes de funcionalidade nova: perguntas até entender o que se quer |
| `superpowers:writing-plans` | tarefa de vários passos: plano com arquivos, funções e testes |
| `superpowers:test-driven-development` | lógica nova em `src/shared`: teste que falha primeiro |
| `superpowers:systematic-debugging` | qualquer bug, antes de propor conserto |
| `superpowers:verification-before-completion` | antes de dizer "pronto": rodar a checagem que prova |
| `ponytail` | ao implementar: precisa existir? já existe no projeto? a biblioteca padrão faz? cabe em uma linha? |
| `/ponytail-review` | no diff, antes de abrir o PR |

Os padrões do projeto (`CLAUDE.md`) vencem as skills.

### Fluxo com IA

1. **Entender:** o agente lê o `CLAUDE.md` e os arquivos da área antes de tudo.
2. **Combinar:** coisa nova vira issue (diga também o que *não* quer).
3. **Planejar:** mais de um arquivo → plano; leia antes de deixar implementar.
4. **Branch:** `git checkout -b feat/minha-ideia` a partir do `dev` atualizado.
5. **Implementar com teste:** lógica em `src/shared` com teste em `tests/`; tela conferida no navegador.
6. **Gates** verdes; mudou tela → prints PC e celular, português e inglês.
7. **Revisar:** `/ponytail-review` e uma segunda leitura tentando derrubar a mudança.
8. **PR** pelo modelo, título `tipo: o que muda`. A revisão automática comenta no PR; o dono aprova e mescla.

### Prompts que funcionam

```text
Leia o CLAUDE.md e o CONTRIBUTING.md. Quero [ideia]. Antes de codar, use o brainstorming
e me faça as perguntas que faltam. Não mude números de magia sem medir no simulador.
```

```text
Bug: [o que acontece] quando [passo a passo]. Use systematic-debugging: reproduza com um
teste que falha, ache a causa e só então corrija. Rode os 4 gates no fim.
```

```text
Faça a mudança numa branch feat/..., commits em português com o tipo na frente, e abra o PR
pelo modelo de .github/ (para a branch dev) com prints antes e depois. Não dê push em dev nem no master.
```

## Fluxo do Git e PR

Fluxo: **dev do usuário → dev geral (`dev`) → `master`**. O PR da tarefa vai para `dev` (o merge publica em https://dev-warlock.fernandorffdev.com); logo em seguida o agente do dono abre o PR `dev` → `master`, que publica o jogo no ar (decisão de 20/10: toda mescla em `dev` vai ao ar na hora). `dev` e `master` são protegidos: só entram por PR com o CI verde (`checks`) e a checagem do título (`titulo`). Sem force push.

| Item | Padrão | Exemplo |
|---|---|---|
| Branch | `tipo/assunto` a partir de `dev` | `feat/runa-de-gelo`, `fix/loja-celular`, `balance/raio` |
| Commit | português, tipo na frente | `fix: loja não trava mais no celular` |
| Tipos | `feat` · `fix` · `balance` · `style` · `refactor` · `docs` · `ci` · `test` | |
| Título do PR | igual a um commit (vira o commit em `dev`) | `feat: runa de gelo que deixa lento por 3 s` |
| Merge | squash and merge pelo dono | a branch é apagada depois |

Um PR, um assunto. Mantenha a branch em dia (`git pull --rebase origin dev`) antes de pedir revisão; depois que a revisão começou, responda com commits novos.

Issues: modelos **Bug** e **Ideia**. Etiquetas: `bug`, `ideia`, `balanceamento`, `visual`, `bom primeiro PR`, `precisa de decisão`.

## Como o jogo funciona por dentro

- **Navegador (`src/client`):** cena 3D (Three.js), teclado/mouse/controle, sons, interface em HTML/CSS, previsão do próprio mago.
- **Servidor (`src/worker`):** Cloudflare Workers; cada sala é um Durable Object que roda a partida de verdade.
- **Lógica comum (`src/shared`):** o mesmo código nos dois lados. O servidor decide; o navegador só prevê.
- **Ritmo:** simulação a 60 passos/s, estado enviado 30 vezes/s por WebSocket, interpolação dos outros magos.

```text
navegador ──WebSocket──▶ Durable Object (uma sala)
   │  comandos validados        │ tickMatch → stepWorld (60/s)
   │  (protocol.ts)             │ bots pensam (bots.ts)
   ◀── snapshot 30/s ───────────┘ snapshot.ts
```

## Mapa do código

`src/shared`: `sim.ts` (simulação), `spells.ts` (25 magias), `items.ts` (16 itens), `constants.ts` (arena, lava, baús, runas), `match.ts` (fases, loja, ouro, votações), `bots.ts` (`BOT_SKILL` por dificuldade), `protocol.ts` (mensagens e validação), `arena.ts`, `snapshot.ts`, `characters.ts` (9 bonecos e o look de 7 peças), `telemetry.ts`.

`src/client`: `main.ts` (laço), `ui.ts` (menus, sala, loja, barra da partida, placar), `scene.ts` (3D), `style.css`, `i18n.ts`, `rules-text.ts`, `grimoire.ts` e `demo.ts` (grimório e demonstrações), `tips.ts`, `sheet.ts`, `settings.ts`, `keys.ts`, `gamepad.ts`, `avatar.ts` (criador de personagem), `train.ts`, `challenges.ts`, `mimic.ts`, `coach.ts`, `predict.ts`, `interp.ts`, `net.ts`.

`src/worker`: `room-do.ts` (sala), `lobby.ts` e `index.ts` (lista de salas, telemetria, `/api/…`).

`scripts`: `balance-sim.ts`, `build-tournament.ts`, `*-headless.mjs`, `smoke.mjs`. `tests`: Vitest (simulação, bots, partida, protocolo, loja, idioma…).

## Regras para não quebrar nada

1. Os 4 gates verdes.
2. Duas línguas: todo texto visível com `t('português', 'English')`; nomes por `spellName`/`itemName`/`arenaName`; números com `LOCALE`.
3. Determinismo: `tests/style.test.ts` guarda o hash de uma partida com semente. Mudou = você mudou o jogo; regrave só se for de propósito e explique no PR.
4. Nada de `Math.random` solto na simulação: use o `rand` recebido.
5. Mensagem nova do navegador validada em `parseClientMessage`.
6. Celular usável: 390×844 e toque (`pointer: coarse`).
7. Número de magia, item ou bot só com medição do simulador no PR.
8. Menos código: reaproveite `el()`, `choice()`, `withTip`, `store`, `t()`; mudança cirúrgica.
9. Sem segredo: o repositório é público.
10. Asset só com licença livre e crédito em `public/CREDITS.txt`.

Estilo: comentários curtos em português onde ajudam a entender o porquê; imports no topo; siga o estilo do arquivo. O `ui.ts` não carrega no Vitest: decisão de tela testável vai para função pura.

## Testar

```bash
npx vitest run                         # todos
npx vitest run tests/bots.test.ts      # um arquivo
npx vitest run -t "Ilusão"             # pelo nome

npx wrangler dev
node scripts/play-headless.mjs http://localhost:8787 prints/          # rodada com prints
node scripts/play-headless.mjs http://localhost:8787 prints/ 390 844  # celular
node scripts/multi-headless.mjs http://localhost:8787 prints/         # 3 pessoas
node scripts/smoke.mjs http://localhost:8787                          # teste rápido
```

Os scripts usam o Chrome instalado e um perfil temporário. `PW_CHANNEL=chromium` usa o Chromium do Playwright (`npx playwright-core install chromium` antes); `PW_PROFILE=<pasta>` usa um perfil fixo.

Atalhos: aba **Aprender** (treino com bots, desafios, Sombra e a sandbox com ouro e vida infinitos), `?as=nome` no endereço, `localStorage['warlock:lang'] = 'pt' | 'en'`. Mudança de tela: PC 1280×720 e 1920×1080, celular 390×844, português e inglês, sem erro no console.

## Balanceamento

O simulador joga partidas só de bots e mede quanto **ter** cada magia ou item aumenta a chance de vencer.

- **Vitória ajustada pelo ouro:** 1,00 = vence o justo; 1,15 = 15% acima do justo. Faixa aceita **0,85 a 1,15 no Normal e no Difícil**. A Bola de fogo é a referência (todos têm).
- **Metas de diversão:** rodada de 60 a 120 s; ≥ 60% das mortes por golpe; toda magia e item comprado por ≥ 4% dos bots.

```bash
node scripts/balance-sim.ts --minutes 20 --seed 1 --difficulty normal --out balance/x/p1
node scripts/balance-sim.ts --minutes 20 --seed 2 --difficulty normal --out balance/x/p2
node scripts/balance-sim.ts --merge --difficulty normal --out balance/x/total balance/x/p1 balance/x/p2
# relatório em balance/x/total/report.md (balance/ fica fora do git)
```

Conclusão precisa de dezenas de milhares de rodadas por dificuldade (com pouco dado a variação é de ±0,02 a 0,03).

Lições: quando o número não responde, desconfie do bot (o Redirecionador vencia 18% acima do justo por reação perfeita do bot, não pela recarga); o que mata é o empurrão para a lava, não o dano; `build-tournament.ts` acha builds dominantes — relate, não ajuste sozinho.

Estado em 19/10/2026 (~25 mil rodadas no Normal, ~20 mil no Difícil): todas as magias e itens entre 0,85 e 1,15; rodada média 96 s no Normal e 78 s no Difícil; ~90% das mortes por golpe.

## Decisões que já foram tomadas

Não desfaça sem combinar numa issue.

| Assunto | Decisão |
|---|---|
| Público e estilo | jogadores de Dota; menus, loja e barra no jeito do Dota; menus enxutos |
| Menu principal | 5 abas: Jogar · Magias e itens · Aprender · Personagem · Configurações |
| Loja | grade de ícones com nome dentro, preço com moeda, busca; itens prateados numa coluna à esquerda; Ataque em 2 fileiras de 5, os outros grupos em 1 |
| Cores por grupo | Ataque vermelho-laranja, Mobilidade verde, Defesa azul, Controle roxo, Itens prateado |
| Grupos de magia | 10 ataque, 5 mobilidade, 5 defesa, 5 controle |
| Sala | sem opção de ritmo (sempre Normal) nem de morte súbita (sempre ligada); dificuldade bot a bot |
| Baús | no máximo metade dos magos + 1 por rodada, nunca mais que 3 |
| Escudo | o do Warlock original, recarga 16 s no nível 1 |
| Drenar | domina combinações no Normal, mas espera partidas reais antes de mexer |
| Ataques | Bola de fogo frequente; as outras são golpes fortes e raros (não encurtar recargas) |
| Bots | jogam "como gente": mira com erro, reação de 0,25 a 0,6 s, hesitação; no duelo final vão atrás do inimigo |
| Personagem | criador de 7 peças com os 9 bonecos originais como atalho; prévia 3D orbitável (arraste para girar e role para aproximar) |
| Recusados | ranking; itens que só ajudam uma magia específica |
| Publicação | automática: merge em `dev` → dev geral; merge `dev` → `master` → jogo no ar |

## Magias e itens

- **Ataque (10):** Bola de fogo, Raio, Míssil teleguiado, Meteoro, Rajada, Bumerangue, Ricochete, Recarga, Divisor, Bola de neve
- **Mobilidade (5):** Teleporte, Troca, Investida, Estocada, Caminhada no vento
- **Defesa (5):** Escudo, Alteração, Zona de dobra, Barricada, Ilusão
- **Controle (5):** Agarrar, Gravidade, Elo, Magnetizar, Drenar
- **Itens (16):** Anel de vida, Anel amaldiçoado, Capa, Armadura, Botas, Relógio de bolso, Roubo de vida, Botas de lava, Guardião, Elmo, Botas de choque, Égide, Botas de vento, Flagelo (ativo), Redirecionador (ativo), Pacto (ativo)

**Ilusão:** cria uma cópia visível que segue reto na direção do movimento por 2 s. O jogador pode se mover livremente enquanto fica invisível; usar outra magia o revela, sem encerrar a cópia. Jogador e cópia podem ser atingidos; a cópia pode ser empurrada, mas não destruída antes do fim do prazo.

Modos: Rodadas (vence quem fizer 5), Deathmatch (volta em 10 s), Times (Azul × Vermelho). Arenas: Círculo, Anel, Ilhas, Cruz. Atalhos: <kbd>F1</kbd> grimório, <kbd>F2</kbd> biblioteca, <kbd>Tab</kbd> placar, <kbd>4</kbd> loja, <kbd>5</kbd> replay da queda, <kbd>Esc</kbd> configurações.

## Problemas comuns

| Sintoma | Causa e saída |
|---|---|
| Página branca ou 404 no `wrangler dev` depois de um build | o `vite build` trocou o `dist/`: pare e suba o `wrangler dev` de novo |
| `tests/style.test.ts` falha no hash | a jogabilidade mudou; se foi de propósito, regrave e explique no PR |
| Teste de bot falha às vezes | amostra pequena: aumente a duração da partida do teste em vez de afrouxar a conta |
| "Título fora do padrão" no CI | edite o título do PR para `tipo: o que muda` |
| Push em `dev` ou no `master` recusado | é a proteção: branch + PR para `dev` |
| CI parado em "aguardando aprovação" | PR veio de fork: use branch neste repositório |
| Aviso LF/CRLF no Windows | normal |
| Texto em português com o jogo em inglês | faltou `t('pt', 'en')` |

## Checklist do PR

- Branch `tipo/assunto`, título `tipo: o que muda`, `Fecha #n` se houver issue.
- Os 4 gates verdes.
- Teste novo para lógica nova, falhando sem a mudança.
- Tela mexida: prints antes e depois, PC e celular, português e inglês.
- Número mexido: medição do simulador (antes → depois, Normal e Difícil).
- Todo texto com `t()`; sem segredo; asset com licença e crédito.
- `/ponytail-review` no diff.
- Hash do `style.test.ts` igual, ou mudança explicada.

Dúvida sobre o que o jogo deve fazer: issue com a etiqueta `precisa de decisão`.
