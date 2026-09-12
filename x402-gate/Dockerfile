# Public origin: Express gateway + the loopback-only reference agent.
# --- stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- stage 2: build the corpus ---------------------------------------------
# The judge samples are gitignored and generated. Without this the CLEAR and REVIEW buttons would 400 on a fresh deploy.
FROM python:3.13-slim AS corpus
WORKDIR /build
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir reportlab==4.4.10 pikepdf==10.13.0.post1 \
    pymupdf==1.28.2 pillow==12.3.0 numpy==2.4.0
COPY backend/ ./backend/
RUN python backend/make_test_docs.py

# --- stage 3: runtime ------------------------------------------------------
FROM node:22-slim
WORKDIR /srv/x402-gate

COPY x402-gate/package.json x402-gate/package-lock.json* ./

RUN npm ci --omit=dev \
    && npm install --no-save tsx@4.19.2 \
    && npm cache clean --force

COPY x402-gate/ ./
COPY --from=frontend /build/dist /srv/frontend/dist
COPY --from=corpus /build/backend/test_docs /srv/backend/test_docs

ENV NODE_ENV=production \
    PORT=4021 \
    AGENT_HOST=127.0.0.1 \
    AGENT_PORT=4022 \
    AGENT_SERVICE_URL=http://127.0.0.1:4022 \
    CORPUS_DIR=/srv/backend/test_docs

EXPOSE 4021

# Both processes, agent first so the gateway never proxies to a dead socket.
CMD ["sh", "-c", "npx tsx src/reference-agent.ts & exec npx tsx src/server.ts"]
