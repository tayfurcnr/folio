FROM node:22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl pkg-config libssl-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/root/.rustup CARGO_HOME=/root/.cargo PATH=/root/.cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustup target add wasm32-unknown-unknown \
  && cargo install wasm-bindgen-cli --version 0.2.129 --locked
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/editor/package.json apps/editor/package.json
COPY packages/engine-adapter/package.json packages/engine-adapter/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS collaboration
ENV NODE_ENV=production FOLIO_COLLAB_HOST=0.0.0.0 FOLIO_COLLAB_PORT=4175 FOLIO_COLLAB_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --workspaces=false
COPY apps/collab-server/server.mjs ./server.mjs
EXPOSE 4175
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4175/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]

FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/editor/dist /srv
