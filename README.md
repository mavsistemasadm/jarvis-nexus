# NEXUS — Assistente Nexus

Assistente de voz estilo Jarvis com visual de supernova 3D (Three.js + shaders + bloom),
ativação por palavra ("Nexus"), respostas por voz em pt-BR, busca na web e fontes de
dados de negócio via Claude API + MCP.

## Como rodar

Pré-requisito: Node 18 ou superior. **Zero dependências — nada de npm install.**

```bash
cp .env.example .env      # e edite o .env
node server.js            # abre em http://localhost:3000
```

No `.env`, o único campo obrigatório é `ANTHROPIC_API_KEY`
(crie a sua em https://console.anthropic.com/settings/keys).

Abra `http://localhost:3000` no **Chrome ou Edge** (o reconhecimento de voz
contínuo do Safari/Firefox é limitado), toque na tela para ativar, permita o
microfone, e diga **"Nexus"**.

## Estrutura

```
index.html       # casca da interface
css/style.css    # estilos do HUD
js/app.js        # cena 3D, som, voz (wake word), cérebro
api/chat.js      # proxy da Claude API + loop de tool use + ações por tag
api/negocios.js  # camada de leitura das três bases de negócio
server.js        # mesmo proxy para rodar local (node server.js)
.env.example     # modelo de configuração local
```

## Dados do negócio — como o NEXUS responde perguntas

O `chat.js` tem **duas engrenagens distintas**, e confundi-las causa retrabalho:

- **Ações** usam tags invisíveis (`<lancamento_criar>`, `<spotify_play>`…). São de
  mão única: rodam *depois* que o modelo respondeu. Servem para mandar, não para
  perguntar.
- **Perguntas** usam **tool use** de verdade: o modelo pede o dado, o servidor
  busca em `api/negocios.js`, o modelo responde. É isso que permite "quanto tenho
  atrasado?" em vez de só "lança 200 reais".

`api/negocios.js` fala com três bases, cada uma com um isolamento diferente:

| Fonte | Base | Isolamento |
|---|---|---|
| Financeiro | `grupo-mh-financeiro` | RPC com `p_email` (SaaS multi-tenant) |
| Opera | `mh-gestao` | `usuario_id` **fixo no ambiente**, nunca do request |
| Peritos | `nexus-peritosacademy` | é o próprio negócio, sem tenant |
| Produtos | `academy`, `ponto`, `galacticos`, `acheumperito` | só contagens agregadas |

Nos quatro produtos o Marlos é **dono, não usuário**: a pergunta é "como está o
produto", não "o que preciso fazer". Por isso só leitura agregada, sem dado de
cliente individual — exceto os vencimentos da Academy, que só são úteis com
nome.

Uma ferramenta só é oferecida ao modelo se a fonte dela estiver configurada —
prometer um dado que o servidor não consegue buscar rende resposta inventada.

Duas armadilhas já pagas, documentadas no código:

- **A agenda do Opera é derivada.** A tela sintetiza prazos de processo e
  follow-ups que não existem na tabela `eventos`. Ler só a tabela responde
  "1 compromisso" quando a tela mostra 7. `opera.agenda()` replica a derivação.
- **O NEXUS não fala MRR.** `lib/metricas-negocio.ts` do nexus-peritosacademy
  documenta um erro ainda não corrigido (tier `infinity` entra com preço 0,
  ~R$1.278/mês fora da conta). Enquanto não for decidido, a ferramenta devolve
  um aviso em vez do número.
- **Campo não alimentado não é medição de zero.** Três campos que pareciam
  úteis não servem, e foram conferidos contra a base antes de virar código:
  `ponto.profiles.ultimo_acesso_em` está vazio nos 125 registros;
  `academy.perfis.xp_semana` tem valor em 1 de 502; o AcheUmPerito não tem
  nenhuma transação. Cada produto devolve um campo `sem_sinal` dizendo o que
  **não** pode ser afirmado — dizer "zero usuários ativos" a partir de coluna
  vazia parece medição e é ausência de medição.

## O cérebro dos projetos (17/10/2026)

O Jarvis lê os documentos de orientação de todos os repositórios (CLAUDE.md,
AGENTS.md, docs/*.md) por `cerebro_buscar`, `cerebro_ler` e `cerebro_indice`
(`lib/cerebro.js`). Eles ficam indexados por título na tabela
`cerebro_secoes` (`sql/cerebro.sql`), com busca em português sem acento.

Quem enche o índice é `scripts/sincronizar-cerebros.mjs`, lendo a branch
`main` no GitHub:

```bash
GITHUB_TOKEN=$(gh auth token) SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  node scripts/sincronizar-cerebros.mjs
```

O cron `/api/cerebro-sync` (6h de Brasília) faz o mesmo todo dia, de forma
incremental (só baixa o documento cujo sha mudou), quando existir
`GITHUB_TOKEN_LEITURA`: token fine-grained com "Contents: Read-only" nos
repositórios e nada mais. Sem ele o cron responde 503 e não faz nada.

⚠️ **O banco do Jarvis é fechado** (`sql/seguranca.sql`): RLS em todas as
tabelas e nenhuma policy. Só a `SUPABASE_SERVICE_KEY` lê e escreve.

⚠️ O token do GitHub fica na máquina de quem roda. O Jarvis não recebe
credencial do GitHub. Ficam fora do índice: backup, histórico e
`conversas-vendas-mh.md` (conversa real de cliente).

## O que o Jarvis alcança (17/10/2026)

| Ferramenta | De onde lê ou onde escreve |
|---|---|
| `nexus_panorama` | função `jarvis_nexus_panorama` no banco do Nexus |
| `academy_panorama` | função `jarvis_academy_panorama` no banco da Academy |
| `trafego_meta` | `/api/admin/ads/meta-desempenho` do Nexus (`x-jarvis-key`) |
| `email_*` | compositor do Nexus `/api/admin/comunicacao/*`, como operador |
| `academy_*` | `/api/integracoes/jarvis` da Academy (`JARVIS_ACADEMY_KEY`) |
| `financeiro_*` (conferência) | `/api/jarvis` do Financeiro (`JARVIS_FINANCEIRO_KEY`) |
| `cerebro_*` | índice `cerebro_secoes` dos documentos de todos os repositórios |
| `abrir_tarefa_codigo` | issues no GitHub, só com `GITHUB_TOKEN_TAREFAS` |

⚠️ **Regra de todas:** o Jarvis lê e escreve pela porta de cada produto, nunca
direto no banco dos outros, e toda escrita propõe e espera o sim
(`lib/acoes.js`). As definições (o que é venda, o que é aluno ativo) moram no
produto, não aqui.

O vigia (`api/rotina.js`) avisa por três canais: celular (🟡 Jarvis, pela
central de notificações do Nexus), WhatsApp e email.

## Escrita por voz

Escrita **não** é tool use — passa pelas tags, sempre em duas etapas: o NEXUS
resume, pergunta "Confirma?", e só grava depois do sim explícito.

| Tag | O que grava | Onde |
|---|---|---|
| `<lancamento_criar>` | despesa ou receita | financeiro |
| `<pagamento_confirmar>` | baixa de conta | financeiro |
| `<agenda_criar>` | compromisso | Opera |
| `<processo_criar>` | cálculo judicial | Opera |

Três travas, todas deliberadas:

- **`usuario_id` é fixo no ambiente.** Nunca vem da fala. Se viesse, uma
  resposta mal formada gravaria na conta de outro perito.
- **`status` do processo é derivado da atuação**, nunca perguntado:
  `perito_juizo` nasce `em_andamento`, `perito_contratado` nasce
  `calculo_fechado`. É a convenção do Opera — quebrá-la tira o processo do
  kanban certo.
- **A baixa exige correspondência única.** Voz é ambígua e a baixa é difícil
  de desfazer, então o RPC só grava quando exatamente uma conta em aberto bate
  com a descrição. Duas ou nenhuma → erro, e nada é tocado.

Não há update nem delete por voz, de propósito: erram feio e são caros de
desfazer.

⚠️ **`<pagamento_confirmar>` só funciona depois de rodar
`sql/confirmar_pagamento.sql`** no Supabase do grupo-mh-financeiro. Até lá ele
responde dizendo exatamente isso, em vez de tentar um PATCH sem isolamento.

## Rotina proativa — o vigia

`api/vigia.js` varre as três bases e devolve o que precisa de atenção agora:
conta em atraso, conta vencendo em ≤2 dias, prazo fatal ou audiência em ≤3
dias, cliente sem resposta há mais de um dia, conversa escalada e sem retorno,
negociação parada há uma semana, cancelamento de assinatura.

Ele chega ao Marlos por dois caminhos:

- **`api/rotina.js`** — cron da Vercel (`vercel.json`), 8h e 16h de Brasília
  em dias úteis. Manda e-mail via Resend.
- **Na abertura da conversa** — o mordomo já entra sabendo, e cita o urgente
  em uma frase antes de você perguntar.

Três decisões que sustentam isso:

- **Limiares apertados de propósito.** Melhor avisar três coisas que importam
  do que quinze que ele vai ignorar. Follow-up só vira alerta com 7 dias
  parado, não 5.
- **Dedupe por impressão digital do resumo.** Se nada mudou desde o último
  aviso, o cron roda e fica calado — alerta repetido é alerta que se aprende a
  ignorar. Precisa de `sql/alertas.sql` no Supabase do próprio NEXUS; sem ele
  a rotina funciona, só perde o silêncio.
- **Só marca como avisado se a entrega saiu.** Senão o silêncio da rodada
  seguinte esconderia um alerta que ninguém recebeu.

Sem `CRON_SECRET` o endpoint responde 503 e não roda: ele fica numa URL
pública e dispara e-mail.

Uma armadilha já paga: `agent_conversations.escalar_humano` continua `true`
depois do caso resolver — é o `status` que diz se ainda espera alguém. Sem
filtrar `convertido`, venda já fechada aparecia como urgente.

## WhatsApp

⚠️ **Leia antes de apontar qualquer webhook.** Na Evolution cada instância tem
**uma** URL de webhook. As instâncias de atendimento apontam para o Opera — é
por lá que o agente comercial recebe os clientes. Repontar uma delas para cá
não divide o tráfego: o Opera para de receber e o cliente fica sem resposta,
sem erro nenhum aparecer.

Por isso o canal tem duas metades independentes:

| | Como funciona | O que exige |
|---|---|---|
| **Saída** | O vigia manda os alertas no WhatsApp | Qualquer instância conectada. Enviar não mexe em webhook. |
| **Entrada** | Conversar com o NEXUS pelo celular | Uma instância **dedicada**, com número próprio |

Só `WHATSAPP_DONO` conversa com ele: o NEXUS lê o financeiro inteiro e escreve
na agenda, então número desconhecido aqui não é "usuário novo", é vazamento.

Duas coisas descobertas no caminho:

- **A Evolution não envia para o próprio número.** Uma instância cujo dono é o
  mesmo destino falha com `Connection Closed`. Alerta precisa sair de uma
  instância diferente da de destino.
- **`whatsapp_instancias.status_conexao` no Opera fica desatualizado.** Uma
  instância marcada `conectado` na tabela estava `close` na Evolution. Para
  saber o estado real, pergunte à Evolution (`/instance/connectionState/…`),
  não ao banco.

O histórico do WhatsApp vem do mesmo Supabase onde o `chat.js` grava, então a
conversa do celular e a da tela são a **mesma** conversa — e na Vercel, onde
cada requisição é um processo novo, é o que dá continuidade.

## Publicar na Vercel (usar do celular!)

```bash
git init && git add . && git commit -m "NEXUS v1"
git remote add origin https://github.com/SEU-USUARIO/nexus.git
git push -u origin main
```

Na Vercel: **Add New → Project → importe o repositório** (framework: Other,
sem build). Em **Settings → Environment Variables**, adicione
`ANTHROPIC_API_KEY` (e os tokens MCP quando for integrar). Deploy.

Como a Vercel serve em **https**, o microfone funciona inclusive no
celular — abra a URL no Chrome do Android, toque para ativar, e diga
"Nexus" de onde estiver. Dica: a URL é pública; se quiser proteger,
ative a proteção por senha da Vercel ou adicione um token simples no front.

## Supabase (próximo passo natural)

Ainda não é usado. Encaixa perfeito para: histórico de conversas
persistente, memória do NEXUS entre sessões, e logs de uso. Bom
primeiro cartão depois do deploy.

## Fontes de dados (MCP) — leia antes de esperar mágica

Dentro do claude.ai, os conectores (Windsor, Drive, Make, Facebook, Canva)
usam a autenticação da sua conta claude.ai. **Essa autenticação NÃO se
transfere** para um projeto local. Aqui, cada fonte só funciona se você
preencher o token dela no `.env` (`WINDSOR_MCP_TOKEN` etc.), obtido no
fluxo de autorização do servidor MCP de cada serviço. Sem token, a fonte é
ignorada silenciosamente (aparece aviso no log do servidor) e o NEXUS segue
funcionando com conhecimento geral + busca na web.

Caminho recomendado para começar: deixe só a **busca na web** ligada, valide
o fluxo completo de voz, e vá integrando uma fonte por vez. O Make costuma
ser a ponte mais versátil (agenda, financeiro, CRM etc. via cenários).

## Segurança

**Desde 17/10/2026 o Jarvis exige login pelo Nexus** (`lib/sessao.js`). Antes
disso a página e a API estavam abertas: quem achasse o endereço lia o
financeiro e podia confirmar lançamento. A entrada é
`nexuspericial.com.br/abrir/jarvis`, que manda o token do Nexus para
`/api/nexus-sso`; só passa quem está em `JARVIS_DONOS` (ids de usuário do
Nexus), e a sessão é um cookie assinado com `JARVIS_SESSAO_SEGREDO`. Sem as
duas envs, ninguém entra. O WhatsApp e o cron seguem com segredo próprio.

⚠️ Abrir para alunos NÃO é só pôr ids em `JARVIS_DONOS`: o Financeiro e o
Opera são lidos por um dono fixo no ambiente (`FINANCEIRO_USER_EMAIL`,
`OPERA_USER_ID`). Cada aluno veria os dados do dono.


- A chave da API vive **apenas** no `.env` (que está no `.gitignore`) e nunca
  chega ao navegador.
- O front-end só conversa com `/api/chat` do seu próprio servidor.

## Ideias de próximos passos

- Modularizar `app.js` (scene / voice / sound / brain) — bom primeiro cartão.
- Streaming da resposta (API suporta) para o NEXUS começar a falar antes do fim.
- Vozes neurais (ElevenLabs/Azure) no lugar do speechSynthesis do navegador.
- Histórico persistente (SQLite no server) e comandos de rotina ("Nexus, resumo do dia").
- Modo quiosque: monitor dedicado no escritório, sempre ouvindo.
- Empacotar como app de desktop (Electron/Tauri) para escuta fora do navegador.
