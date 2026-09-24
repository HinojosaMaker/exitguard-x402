#!/bin/bash
# Crea el web service en Render tirando la imagen del registro propio (por tunel).
# Uso: RENDER_KEY=... ./deploy_render.sh <registry-host-sin-https>
set -e
REG="$1"
OWNER="tea-daadsuhsrm7s73em86j0"
[ -z "$REG" ] && { echo "falta el host del registro"; exit 1; }
[ -z "$RENDER_KEY" ] && { echo "falta RENDER_KEY"; exit 1; }
echo "creando servicio en Render desde imagen: $REG/exitguard:latest"
curl -sS -X POST "https://api.render.com/v1/services" \
  -H "Authorization: Bearer $RENDER_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"web_service\",
    \"name\": \"exitguard-x402\",
    \"ownerId\": \"$OWNER\",
    \"image\": { \"imagePath\": \"$REG/exitguard:latest\", \"ownerId\": \"$OWNER\" },
    \"serviceDetails\": {
      \"runtime\": \"image\",
      \"plan\": \"free\",
      \"region\": \"oregon\",
      \"healthCheckPath\": \"/\",
      \"numInstances\": 1
    }
  }" | python -c "import sys,json; d=json.load(sys.stdin); s=d.get('service',d); print('  service id:', s.get('id')); print('  URL:', s.get('serviceDetails',{}).get('url') or s.get('dashboardUrl')); print('  raw:', json.dumps(d)[:300])"
