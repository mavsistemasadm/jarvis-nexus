# NEXUS — Assistente Xperiun

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
api/chat.js      # função serverless (Vercel) — proxy da Claude API
server.js        # mesmo proxy para rodar local (node server.js)
.env.example     # modelo de configuração local
```

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
