#!/bin/sh
set -e

mkdir -p /var/lib/tailscale /var/run/tailscale

tailscaled_args="
  --state=/var/lib/tailscale/tailscaled.state
  --socket=/var/run/tailscale/tailscaled.sock
  --tun=userspace-networking"

socks5_server="${TAILSCALE_SOCKS5_SERVER:-${TS_SOCKS5_SERVER:-}}"
if [ -n "${socks5_server}" ]; then
  tailscaled_args="${tailscaled_args} --socks5-server=${socks5_server}"
fi

# shellcheck disable=SC2086
tailscaled ${tailscaled_args} &

for _ in $(seq 1 30); do
  if [ -S /var/run/tailscale/tailscaled.sock ]; then
    break
  fi
  sleep 0.5
done

if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  tailscale_args="--authkey=${TAILSCALE_AUTHKEY}"
  if [ -n "${TAILSCALE_HOSTNAME:-}" ]; then
    tailscale_args="${tailscale_args} --hostname=${TAILSCALE_HOSTNAME}"
  fi
  # shellcheck disable=SC2086
  tailscale --socket=/var/run/tailscale/tailscaled.sock up ${tailscale_args}
fi

wait_for_port() {
  host="$1"
  port="$2"
  attempts="${3:-60}"

  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    if node -e "
      const net = require('net');
      const socket = net.connect(${port}, '${host}', () => {
        socket.end();
        process.exit(0);
      });
      socket.on('error', () => process.exit(1));
    " 2>/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  return 1
}

parse_socks_host_port() {
  raw="${1:-:1055}"
  case "${raw}" in
    :*)
      echo "127.0.0.1 ${raw#:}"
      ;;
    *:*)
      host="${raw%%:*}"
      port="${raw##*:}"
      echo "${host:-127.0.0.1} ${port}"
      ;;
    *)
      echo "127.0.0.1 ${raw}"
      ;;
  esac
}

if [ -n "${socks5_server}" ]; then
  set -- $(parse_socks_host_port "${socks5_server}")
  socks_host="$1"
  socks_port="$2"

  if wait_for_port "${socks_host}" "${socks_port}"; then
    echo "docker-entrypoint: Tailscale SOCKS5 ready on ${socks_host}:${socks_port}"
  else
    echo "docker-entrypoint: warning: Tailscale SOCKS5 not listening on ${socks_host}:${socks_port}" >&2
  fi

  if [ -n "${MCP_PROXIES:-}" ] || [ -f /data/.openclaw/mcp-proxies.json ]; then
    NODE_PATH=/app/node_modules node /usr/local/lib/openclaw/start-mcp-proxies.mjs
  fi
fi

exec "$@"
