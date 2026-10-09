#!/usr/bin/env bash
# BrickXBrick — one Clique validator node per EC2 instance (3 instances, 1 AWS account).
#
#   sudo bash setup-node.sh init                       # on EACH node: docker, swap, signer key, nodekey
#   sudo bash setup-node.sh start <N> <ADDRS> <ENODES> # on EACH node: genesis, peers, run geth
#   sudo bash setup-node.sh status                     # block number, peers, signers
#   sudo bash setup-node.sh url                        # node 1 only: print the backend's GETH_RPC_URL
#
# <N>      1, 2 or 3. Node 1 is the gateway: it also runs Caddy (HTTPS + secret URL path)
#          so the backend on Cloud Run and teammates' laptops can reach it.
# <ADDRS>  the 3 signer addresses printed by `init`, comma-separated, any order
# <ENODES> the 3 enode URLs printed by `init`, comma-separated, any order (own one is skipped)
#
# Geth is pinned to v1.13.15: Clique PoA was removed in geth 1.14. Do not bump it.
set -euo pipefail

GETH_IMAGE="ethereum/client-go:v1.13.15"
TOOLS_IMAGE="ethereum/client-go:alltools-v1.13.15"
BASE=/opt/bxb
DATA=$BASE/data
CHAIN_ID=31337
CLIQUE_PERIOD=15

die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run with sudo"

imds() {
  local t
  t=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -fsS -H "X-aws-ec2-metadata-token: $t" "http://169.254.169.254/latest/meta-data/$1"
}

cmd_init() {
  mkdir -p "$DATA/geth"

  if ! command -v docker >/dev/null; then
    echo ">> installing docker"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  fi

  # t3.micro has 1 GB RAM; geth is happier with swap.
  if ! swapon --show | grep -q /swapfile; then
    echo ">> adding 2G swap"
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi

  docker pull -q "$GETH_IMAGE" >/dev/null
  docker pull -q "$TOOLS_IMAGE" >/dev/null

  # Signer account. The key never leaves this machine.
  if [ ! -f "$DATA/password.txt" ]; then
    openssl rand -hex 24 > "$DATA/password.txt"
    chmod 600 "$DATA/password.txt"
  fi
  if ! ls "$DATA/keystore"/UTC--* >/dev/null 2>&1; then
    docker run --rm -v "$DATA:/data" "$GETH_IMAGE" account new --datadir /data --password /data/password.txt >/dev/null
  fi
  local addr
  addr=$(ls "$DATA/keystore"/UTC--* | head -1 | grep -oE '[0-9a-fA-F]{40}$')
  echo "0x$addr" > "$BASE/address"

  # P2P identity, so peers can be wired up before geth ever starts.
  if [ ! -f "$DATA/geth/nodekey" ]; then
    docker run --rm -v "$DATA:/data" --entrypoint bootnode "$TOOLS_IMAGE" -genkey /data/geth/nodekey
  fi
  local pub ip
  pub=$(docker run --rm -v "$DATA:/data" --entrypoint bootnode "$TOOLS_IMAGE" -nodekey /data/geth/nodekey -writeaddress)
  ip=$(imds local-ipv4)

  echo
  echo "================ COPY THESE TWO LINES ================"
  echo "ADDRESS 0x$addr"
  echo "ENODE   enode://$pub@$ip:30303"
  echo "======================================================"
}

write_genesis() {
  python3 - "$1" "$CHAIN_ID" "$CLIQUE_PERIOD" > "$DATA/genesis.json" <<'PY'
import json, sys
addrs = sorted(a.strip().lower().removeprefix("0x") for a in sys.argv[1].split(",") if a.strip())
if len(addrs) != 3 or any(len(a) != 40 for a in addrs):
    sys.exit("need exactly 3 addresses")
extradata = "0x" + "00" * 32 + "".join(addrs) + "00" * 65
bal = "0x200000000000000000000000000000000000000000000000000000000000000"
print(json.dumps({
    "config": {
        "chainId": int(sys.argv[2]),
        "homesteadBlock": 0, "eip150Block": 0, "eip155Block": 0, "eip158Block": 0,
        "byzantiumBlock": 0, "constantinopleBlock": 0, "petersburgBlock": 0,
        "istanbulBlock": 0, "berlinBlock": 0, "londonBlock": 0,
        "clique": {"period": int(sys.argv[3]), "epoch": 30000},
    },
    "difficulty": "1", "gasLimit": "8000000", "extradata": extradata,
    "alloc": {a: {"balance": bal} for a in addrs},
}, indent=2))
PY
}

cmd_start() {
  local n="${1:-}" addrs="${2:-}" enodes="${3:-}"
  [[ "$n" =~ ^[123]$ ]] || die "node number must be 1, 2 or 3"
  [ -n "$addrs" ] && [ -n "$enodes" ] || die "usage: start <N> <ADDR1,ADDR2,ADDR3> <ENODE1,ENODE2,ENODE3>"
  [ -f "$BASE/address" ] || die "run 'init' first"

  local me myip mypub
  me=$(cat "$BASE/address")
  myip=$(imds local-ipv4)
  echo "$addrs" | tr 'A-F' 'a-f' | grep -q "$(echo "${me#0x}" | tr 'A-F' 'a-f')" \
    || die "this node's address $me is not in <ADDRS> — wrong list?"

  write_genesis "$addrs"

  if [ ! -d "$DATA/geth/chaindata" ]; then
    docker run --rm -v "$DATA:/data" "$GETH_IMAGE" init --datadir /data /data/genesis.json
  fi

  # Static peers = the other two nodes (private VPC IPs).
  mypub=$(docker run --rm -v "$DATA:/data" --entrypoint bootnode "$TOOLS_IMAGE" -nodekey /data/geth/nodekey -writeaddress)
  local peers=""
  IFS=',' read -ra list <<< "$enodes"
  for e in "${list[@]}"; do
    e=$(echo "$e" | xargs)
    [ -z "$e" ] && continue
    [[ "$e" == *"$mypub"* ]] && continue
    peers+="${peers:+, }\"$e\""
  done
  printf '[Node.P2P]\nStaticNodes = [%s]\n' "$peers" > "$DATA/config.toml"

  local caddy_svc="" caddy_vol=""
  if [ "$n" = "1" ]; then
    [ -f "$BASE/rpc-token" ] || openssl rand -hex 20 > "$BASE/rpc-token"
    local pubip domain token
    pubip=$(imds public-ipv4) || die "node 1 needs a public IP (attach the Elastic IP first)"
    domain="${pubip//./-}.sslip.io"
    token=$(cat "$BASE/rpc-token")
    echo "$domain" > "$BASE/domain"
    cat > "$BASE/Caddyfile" <<EOF
$domain {
	@rpc path /$token
	handle @rpc {
		rewrite * /
		reverse_proxy 127.0.0.1:8545
	}
	handle {
		respond 404
	}
}
EOF
    caddy_svc=$(cat <<'EOF'
  caddy:
    image: caddy:2
    container_name: bxb-caddy
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
EOF
)
    caddy_vol=$'volumes:\n  caddy-data:'
  fi

  cat > "$BASE/docker-compose.yml" <<EOF
services:
  geth:
    image: $GETH_IMAGE
    container_name: bxb-geth
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./data:/data
    command:
      - --datadir=/data
      - --config=/data/config.toml
      - --networkid=$CHAIN_ID
      - --port=30303
      - --nodiscover
      - --nat=extip:$myip
      - --http
      - --http.addr=127.0.0.1
      - --http.port=8545
      - --http.api=eth,net,web3,admin,clique
      - --http.vhosts=*
      - --unlock=$me
      - --password=/data/password.txt
      - --allow-insecure-unlock
      - --mine
      - --miner.etherbase=$me
      - --syncmode=full
      - --verbosity=3
$caddy_svc
$caddy_vol
EOF

  cd "$BASE" && docker compose up -d
  echo
  echo ">> node $n started. Check with: sudo bash setup-node.sh status"
  [ "$n" = "1" ] && echo ">> backend URL: sudo bash setup-node.sh url"
  return 0
}

cmd_status() {
  docker exec bxb-geth geth attach --exec \
    'JSON.stringify({block: eth.blockNumber, peers: net.peerCount, signers: clique.getSigners()})' \
    /data/geth.ipc
}

cmd_url() {
  [ -f "$BASE/rpc-token" ] || die "only node 1 has a public URL"
  echo "GETH_RPC_URL=https://$(cat "$BASE/domain")/$(cat "$BASE/rpc-token")"
}

case "${1:-}" in
  init)   cmd_init ;;
  start)  shift; cmd_start "$@" ;;
  status) cmd_status ;;
  url)    cmd_url ;;
  *) sed -n 2,14p "$0"; exit 1 ;;
esac