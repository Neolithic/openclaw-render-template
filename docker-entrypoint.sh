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

exec "$@"
