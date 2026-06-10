FROM node:22-slim

RUN apt-get update \
    && apt-get install -y git curl procps python3 make g++ cron tini \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --prefer-online && npm cache clean --force

ENV PATH="/app/node_modules/.bin:$PATH"
ENV ALPHACLAW_ROOT_DIR=/data

RUN mkdir -p /data /var/lib/tailscale /var/run/tailscale

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY bin/mcp-socks-proxy.mjs /usr/local/lib/openclaw/mcp-socks-proxy.mjs
COPY bin/start-mcp-proxies.mjs /usr/local/lib/openclaw/start-mcp-proxies.mjs
RUN chmod +x /usr/local/lib/openclaw/mcp-socks-proxy.mjs /usr/local/lib/openclaw/start-mcp-proxies.mjs

COPY mcp-proxies.example.json /usr/local/share/openclaw/mcp-proxies.example.json

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["alphaclaw", "start"]
