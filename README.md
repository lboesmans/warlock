# Warlock Wars

Remake web do mod de arena **Warlock** (Warcraft 3 / Warlock Brawl do Dota 2): magos numa arena que encolhe sobre lava, magias de empurrão, loja entre rodadas e quem sobrar vence. Feito para jogar em salas com os amigos, direto no navegador, em português ou inglês.

**Jogar:** https://warlock.fernandorffdev.com

## O que tem

- 25 magias do Warlock Brawl (números do código original do mod de Dota 2, ajustados pelo simulador): 10 de ataque, 5 de mobilidade, 5 de defesa e 5 de controle
- 16 itens (passivos e ativos), loja em grade no estilo do Dota com venda e desfazer
- Modos Rodadas, Deathmatch e Times; arenas Círculo, Anel, Ilhas e Cruz, que encolhem até a morte súbita
- Bots em 3 dificuldades (escolhida bot a bot), que jogam "como gente": mira com erro, tempo de reação, hesitação
- Aba Aprender: treino com bots, desafios, Sombra (bot que joga como você) e sandbox com vida e ouro sem fim
- Criador de personagem de 7 peças com prévia 3D orbitável (arraste para girar, role para aproximar), grimório (F1), consulta de magias e itens (F2), replay da queda (5), placar (Tab)
- Ilusão: uma cópia visível segue em frente por 2 s enquanto o jogador fica invisível e pode se mover; outra magia revela o jogador, mas a cópia continua até o prazo. Ambos podem ser atingidos; a cópia pode ser empurrada, mas não destruída.
- Telemetria do jeito de jogar e simulador de balanceamento (`scripts/balance-sim.ts`)

## Stack

- **Cliente:** TypeScript, Vite, Three.js (WebGL), interface em HTML/CSS puros, Web Audio
- **Servidor:** Cloudflare Workers + Durable Objects (uma sala por objeto, simulação a 60 passos/s, estado a 30/s por WebSocket)
- A mesma lógica do jogo (`src/shared`) roda no servidor e no navegador (previsão do próprio mago, interpolação dos outros)
- **Testes:** Vitest (lógica) e Playwright (navegador)

## Rodar

```bash
npm ci
npx wrangler dev   # servidor + cliente em http://localhost:8787
npx vitest run     # testes
```

## Contribuir

- Guia completo: [docs/GUIA-COLABORADOR.md](docs/GUIA-COLABORADOR.md) (máquina, Claude Code e skills, fluxo, testes, balanceamento, decisões já tomadas)
- Regras do código para gente e para agentes de IA (Claude Code, Codex, Cursor): [CLAUDE.md](CLAUDE.md), também lido via [AGENTS.md](AGENTS.md); cada pasta principal tem o seu `CLAUDE.md`
- Fluxo de Git: [CONTRIBUTING.md](CONTRIBUTING.md). Fluxo dev do usuário → dev geral (`dev`, https://dev-warlock.fernandorffdev.com) → `master` (jogo no ar, publicado sozinho): branch no próprio repositório (não fork), PR para `dev` com o modelo, CI verde. Todo PR recebe a revisão automática do Claude; comente `@claude` num PR ou issue para pedir ajuda
- Ambiente dev de cada colaborador: push na branch `<usuário do GitHub>-dev` publica em `https://<usuário do GitHub>-dev-warlock.fernandorffdev.com` (lista no `CLAUDE.md`, seção "Ambientes dev")
- O jogo no ar é publicado sozinho quando o PR `dev` → `master` entra

## Créditos

Modelos, texturas, efeitos, sons e música de uso livre (KayKit, Kenney, ambientCG, Poly Haven, OpenGameArt); lista completa em `public/CREDITS.txt`. Baseado no Warlock de Zymoran e Adynathos e no Warlock Brawl (github.com/warlockbrawl/warlock).
