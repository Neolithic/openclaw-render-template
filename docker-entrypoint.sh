#!/bin/sh
set -e

mkdir -p /var/lib/tailscale /var/run/tailscale

tailscaled \
  --state=/var/lib/tailscale/tailscaled.state \
  --socket=/var/run/tailscale/tailscaled.sock \
  --tun=userspace-networking &

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
