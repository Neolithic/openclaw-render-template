#!/usr/bin/env node
/**
 * Local HTTP proxy for MCP servers reachable only via Tailscale tailnet addresses.
 * Outbound connections use Tailscale's SOCKS5 proxy (userspace-networking mode).
 *
 * Usage:
 *   node mcp-socks-proxy.mjs \
 *     --listen=127.0.0.1:8788 \
 *     --target=https://host.tailnet.ts.net/mcp \
 *     --socks=127.0.0.1:1055 \
 *     [--auth-env=LINKEDIN_BRIDGE_TOKEN]
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { SocksProxyAgent } from "socks-proxy-agent";

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      opts[arg.slice(2)] = true;
    } else {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return opts;
}

function parseHostPort(value, fallbackHost, fallbackPort) {
  if (!value) return { host: fallbackHost, port: fallbackPort };
  if (value.startsWith(":")) {
    return { host: fallbackHost, port: Number(value.slice(1)) };
  }
  const idx = value.lastIndexOf(":");
  if (idx === -1) return { host: value, port: fallbackPort };
  return {
    host: value.slice(0, idx) || fallbackHost,
    port: Number(value.slice(idx + 1)),
  };
}

const cli = parseArgs(process.argv.slice(2));
const listen = parseHostPort(
  cli.listen || process.env.MCP_PROXY_LISTEN,
  "127.0.0.1",
  8788,
);
const target = new URL(cli.target || process.env.MCP_PROXY_TARGET);
const socks = parseHostPort(
  cli.socks || process.env.MCP_PROXY_SOCKS,
  "127.0.0.1",
  1055,
);
const authEnv = cli["auth-env"] || process.env.MCP_PROXY_AUTH_ENV || "";
const proxyName = cli.name || process.env.MCP_PROXY_NAME || "mcp-socks-proxy";

if (!target.href) {
  console.error(`${proxyName}: --target is required`);
  process.exit(1);
}

const agent = new SocksProxyAgent(`socks5://${socks.host}:${socks.port}`);
const isHttps = target.protocol === "https:";
const outbound = isHttps ? https : http;

function buildUpstreamHeaders(incoming) {
  const headers = { ...incoming.headers, host: target.host };
  delete headers["proxy-connection"];
  delete headers["connection"];

  if (authEnv && process.env[authEnv] && !headers.authorization) {
    headers.authorization = `Bearer ${process.env[authEnv]}`;
  }

  return headers;
}

function forwardRequest(clientReq, clientRes) {
  const incomingUrl = new URL(clientReq.url || "/", `http://${listen.host}:${listen.port}`);
  const upstreamPath = `${incomingUrl.pathname}${incomingUrl.search}`;

  const upstreamReq = outbound.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: upstreamPath,
      method: clientReq.method,
      headers: buildUpstreamHeaders(clientReq),
      agent,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on("error", (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "content-type": "text/plain" });
    }
    clientRes.end(`${proxyName}: upstream error: ${err.message}\n`);
  });

  clientReq.pipe(upstreamReq);
}

const server = http.createServer(forwardRequest);

server.on("upgrade", (clientReq, clientSocket, head) => {
  const incomingUrl = new URL(clientReq.url || "/", `http://${listen.host}:${listen.port}`);
  const upstreamPath = `${incomingUrl.pathname}${incomingUrl.search}`;

  const upstreamReq = outbound.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: upstreamPath,
      method: clientReq.method,
      headers: buildUpstreamHeaders(clientReq),
      agent,
    },
  );

  upstreamReq.on("upgrade", (_res, upstreamSocket, upstreamHead) => {
    upstreamSocket.write(head);
    clientSocket.write(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamReq.on("response", (res) => {
    if (res.statusCode !== 101) {
      clientSocket.end(`HTTP/${clientReq.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n\r\n`);
    }
  });

  upstreamReq.on("error", (err) => {
    clientSocket.destroy(err);
  });

  upstreamReq.end();
});

server.listen(listen.port, listen.host, () => {
  console.log(
    `${proxyName}: listening on http://${listen.host}:${listen.port} -> ${target.origin}${target.pathname} via socks5://${socks.host}:${socks.port}`,
  );
});

server.on("error", (err) => {
  console.error(`${proxyName}: failed to start: ${err.message}`);
  process.exit(1);
});
