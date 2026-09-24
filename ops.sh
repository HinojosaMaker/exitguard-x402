#!/bin/bash
# MAQUINA DE OPERACIONES ExitGuard. Un comando, todo el ciclo. Lee las llaves del
# ENTORNO (GH_TOKEN, RENDER_KEY) — nunca literales aqui. Es CI/CD propio: tu
# autorizas una vez (env + allowlist), y esto corre solo.
#   ops.sh deploy    -> commit+push+deploy Render+espera live
#   ops.sh register  -> registra todos los endpoints en 402index
#   ops.sh verify    -> comprueba 402 + saldo wallet
#   ops.sh warm      -> despierta el servicio
#   ops.sh all       -> deploy && register && verify
set -e
REPO="HinojosaMaker/exitguard-x402"
SRV="srv-daq9k3p42hec738s4mj0"
BASE="https://exitguard-oracle.onrender.com"
PAY="0xb7584544F07c5f172718E029Afd3F1C9a50A513C"

warm(){ for i in 1 2 3 4 5; do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "$BASE/health"); [ "$c" = 200 ] && return 0; done; }

deploy(){
  : "${GH_TOKEN:?falta GH_TOKEN en el entorno}"; : "${RENDER_KEY:?falta RENDER_KEY}"
  git -c user.email=deploy@local -c user.name=deploy add -A
  git -c user.email=deploy@local -c user.name=deploy commit -qm "ops: $(date -u +%FT%TZ)" || echo "(nada que comitear)"
  git push "https://HinojosaMaker:$GH_TOKEN@github.com/$REPO.git" main -q 2>&1 | grep -viE "remote:|^To |warning:" | tail -1 || true
  curl -s --max-time 30 -X POST -H "Authorization: Bearer $RENDER_KEY" -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$SRV/deploys" -d '{"clearCache":"do_not_clear"}' >/dev/null
  echo "deploy disparado; esperando live..."
  for i in $(seq 1 12); do
    sleep 22
    st=$(curl -s --max-time 20 -H "Authorization: Bearer $RENDER_KEY" "https://api.render.com/v1/services/$SRV/deploys?limit=1" | python -c "import sys,json;print(json.load(sys.stdin)[0].get('deploy',{}).get('status'))" 2>/dev/null)
    echo "  [$i] $st"; [ "$st" = live ] && break
  done
}

register(){
  warm
  # descubre los nodos del servicio vivo y registra cada uno
  curl -s --max-time 30 "$BASE/" | python3 -c "
import sys,json,urllib.request
base='$BASE'
d=json.load(sys.stdin); eps=d.get('endpoints',{})
def reg(path,price,name,desc):
    body=json.dumps({'url':base+path,'name':name,'protocol':'x402','description':desc,
      'price_usd':price,'payment_asset':'USDC','payment_network':'base','http_method':'GET',
      'category':'crypto-security','provider':'ExitGuard'}).encode()
    r=urllib.request.Request('https://402index.io/api/v1/register',data=body,
      headers={'content-type':'application/json'})
    try: print(' ',path,'->',json.load(urllib.request.urlopen(r,timeout=40)).get('message','ok'))
    except Exception as e: print(' ',path,'ERR',str(e)[:60])
for k,v in eps.items():
    path=k.split('?')[0].replace('GET ','').strip()
    price=float(v.split('\$')[1].split(' ')[0]) if '\$' in v else 0.01
    reg(path,price,path.strip('/').replace('-',' ').title(),v.split(' — ')[-1][:180])
"
}

verify(){
  warm
  echo "402 en escape-curve:"; curl -s -D - -o /dev/null --max-time 30 "$BASE/escape-curve?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263&sol_usd=200" | grep -iE "HTTP/|payment-required" | head -2
  echo "wallet:"; curl -s --max-time 30 "$BASE/stats" | python -c "import sys,json;d=json.load(sys.stdin);print('  USDC:',d['usdc_balance'],'| pagos:',d['paid'],'| nodos:',d['nodes'])"
}

case "${1:-all}" in
  deploy) deploy;; register) register;; verify) verify;; warm) warm && echo warm;;
  all) deploy; register; verify;;
  *) echo "uso: ops.sh {deploy|register|verify|warm|all}";;
esac
