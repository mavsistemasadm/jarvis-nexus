#!/bin/sh
# Troca a chave do ElevenLabs do Jarvis. Abre uma janela do Mac para colar a
# chave (campo oculto), confere se parece uma chave (sk_...) e só então troca
# na Vercel e publica.
cd "$(dirname "$0")/.." || exit 1
CHAVE=$(osascript -e 'text returned of (display dialog "Cole aqui a chave da API do ElevenLabs (começa com sk_):" default answer "" with hidden answer with title "Jarvis · voz")' 2>/dev/null | tr -d '\n\r ')
[ -z "$CHAVE" ] && { echo "Cancelado: nenhuma chave colada."; exit 1; }
case "$CHAVE" in
  sk_*) ;;
  *) echo "Isso não parece a chave (começa com: $(printf %s "$CHAVE" | cut -c1-3)). Nada foi alterado."; exit 1;;
esac
echo "Chave conferida (sk_..., ${#CHAVE} caracteres). Trocando..."
vercel env rm ELEVENLABS_API_KEY production -y >/dev/null 2>&1
printf %s "$CHAVE" | vercel env add ELEVENLABS_API_KEY production --yes >/dev/null 2>&1 || { echo "Falhou ao salvar na Vercel."; exit 1; }
echo "Salva. Publicando..."
vercel deploy --prod --yes >/dev/null 2>&1 && echo PRONTO || echo "Falhou ao publicar."
