#!/usr/bin/env node
/**
 * Start configured MCP SOCKS proxies from MCP_PROXIES env or /data/.openclaw/mcp-proxies.json.
 *
 * Each entry:
 *   { "id": "linkedin", "listen": "127.0.0.1:8788", "target": "https://host.ts.net/mcp", "authEnv": "LINKEDIN_BRIDGE_TOKEN" }
 *
 * Optional per-entry "socks" overrides the global Tailscale SOCKS5 address.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const PROXY_SCRIPT = "/usr/local/lib/openclaw/mcp-socks-proxy.mjs";
const BIN_DIR = "/data/.openclaw/bin";
const RUN_DIR = "/data/.openclaw/run";
const LOG_DIR = "/data/.openclaw/logs";
const CONFIG_FILE = "/data/.openclaw/mcp-proxies.json";

function parseSocksDefault() {
  const raw =
    process.env.TAILSCALE_SOCKS5_SERVER ||
    process.env.TS_SOCKS5_SERVER ||
    ":1055";
  if (raw.startsWith(":")) {
    return `127.0.0.1${raw}`;
  }
  return raw;
}

function loadConfig() {
  if (process.env.MCP_PROXIES) {
    return JSON.parse(process.env.MCP_PROXIES);
  }
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  }
  return [];
}

function ensureProxyScript(id) {
  mkdirSync(BIN_DIR, { recursive: true });
  const linkedName = join(BIN_DIR, `${id}-mcp-socks-proxy.mjs`);
  if (!existsSync(linkedName)) {
    symlinkSync(PROXY_SCRIPT, linkedName);
  }
  chmodSync(linkedName, 0o755);
  chmodSync(PROXY_SCRIPT, 0o755);
  return linkedName;
}

function startProxy(entry, defaultSocks) {
  const { id, listen, target, authEnv, socks } = entry;
  if (!id || !listen || !target) {
    console.error("start-mcp-proxies: skipping invalid entry (requires id, listen, target)");
    return;
  }

  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  const scriptPath = ensureProxyScript(id);
  const pidFile = join(RUN_DIR, `${id}-mcp-socks-proxy.pid`);
  const logFile = join(LOG_DIR, `${id}-mcp-socks-proxy.log`);

  const args = [
    scriptPath,
    `--listen=${listen}`,
    `--target=${target}`,
    `--socks=${socks || defaultSocks}`,
    `--name=${id}-mcp-socks-proxy`,
  ];
  if (authEnv) {
    args.push(`--auth-env=${authEnv}`);
  }

  const logFd = openSync(logFile, "a");

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      NODE_PATH: "/app/node_modules",
    },
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(
    `start-mcp-proxies: started ${id} (pid ${child.pid}) on ${listen} -> ${target}`,
  );
}

const config = loadConfig();
if (!Array.isArray(config) || config.length === 0) {
  process.exit(0);
}

const defaultSocks = parseSocksDefault();
for (const entry of config) {
  startProxy(entry, defaultSocks);
}
