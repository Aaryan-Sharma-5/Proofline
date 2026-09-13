# Deploying Proofline

Production shape, and the exact commands to reproduce it. Nothing here is a status claim about a live deployment; it is the procedure.

## Architecture

```text
Internet
   │
   ▼
gateway container : 4021        ← the only published port
   ├── serves frontend/dist     (/, /app, /history)
   ├── /verify                  x402-protected developer resource
   ├── /demo/verify             hosted judge path, metered
   ├── /docs, /openapi.json     schema authored in the gateway
   ├── /verification[...]       proxied, privacy-safe projection
   └── reference agent          127.0.0.1:4022, same netns, holds the key
   │
   │  (internal bridge network, no published port)
   ▼
analysis container : 8099       ← FastAPI, forensic engine
   └── /data/proofline.db       named volume
```

`analysis` has **no `ports:` entry**. That absence is the isolation control: it is resolvable only as `analysis:8099` on the internal network and is unreachable from the host or the internet. Do not add a port mapping to it.

The reference agent shares the gateway container deliberately. It holds `AGENT_PRIVATE_KEY` and `reference-agent.ts` refuses to bind to anything but loopback, so the gateway must reach it over `127.0.0.1` in the same network namespace. Splitting them would require exposing it on a routable address, which the code correctly forbids.

## Required environment

Copy `.env.example` to `.env` and fill it in. Compose reads `.env` automatically. Never commit it.

| Variable | Required | Purpose |
|---|---|---|
| `GATEWAY_PUBLIC_URL` | **yes** | The real external origin, e.g. `https://proofline.example.com`. The reference agent calls `/verify` at this URL. **Leaving it as loopback after deploy means the agent stops exercising the public path** (CLAUDE.md §17). Compose refuses to start without it. |
| `HEDERA_PAY_TO_ACCOUNT_ID` | **yes** | Account that receives verification fees. |
| `AGENT_ACCOUNT_ID` | **yes** | Reference agent's funded testnet account. |
| `AGENT_PRIVATE_KEY` | **yes** | Server-side only. Never logged, never in a browser bundle. |
| `FACILITATOR_URL` | no | Defaults to `https://api.testnet.blocky402.com`. **Blocky402 is the bounty requirement**; the official facilitator is dev-only. |
| `X402_NETWORK` | no | `hedera:testnet`. |
| `PRICE_VERIFY` / `PRICE_PING` | no | `0.02` / `0.01` HBAR. |
| `DATABASE_URL` | no | `/data/proofline.db` in the image. Must be on the volume. |
| `MAX_UPLOAD_BYTES` | no | `10485760` (10 MB). |
| `PUBLIC_PORT` | no | Host port to publish, default `4021`. |
| `DEMO_RATE_LIMIT_PER_MINUTE` | no | `12`. |
| `DEMO_MAX_CONCURRENT` | no | `2`. |
| `DEMO_TIMEOUT_MS` | no | `120000`. |

`HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` are for the *local developer* client scripts only. Production does not need them.

## Deploy

```bash
cp .env.example .env          # then fill in the four required values
docker compose build
docker compose up -d
docker compose ps             # analysis must show no published ports
```

The build does three things that are easy to miss:

1. Builds the frontend with Vite and copies `dist` into the gateway image.
2. **Generates the judge corpus** (`backend/make_test_docs.py`). The corpus is gitignored, and without it the CLEAR/REVIEW sample buttons return 400. 
3. Installs `tesseract-ocr` in the analysis image. `pytesseract` shells out to that binary, so pip alone is not enough.

### Seeding vendor history

The REVIEW sample depends on `BENEFICIARY_ACCOUNT_NEVER_SEEN`, which needs a known vendor/account pair on record. On a fresh volume:

```bash
docker compose exec analysis python backend/seed_db.py
```

Vendor-history promotion is deliberately manual and out of band (CLAUDE.md §12). No request path can promote an account.

## Deploying to AWS EC2

EC2 is the deployment target. It runs the **unmodified `docker-compose.yml`** on a plain Ubuntu VM, with an EBS volume for the SQLite data — persistent across redeploys and restarts, which a platform without a real disk could not guarantee.

Isolation has two independent halves, and both must hold:

1. `docker-compose.yml` publishes **only** the gateway's port. `analysis` has no `ports:` entry at all, so it is reachable solely as `analysis:8099` on the internal bridge.
2. The EC2 security group opens **only 80/443** to the internet.

FastAPI's unreachability follows from the first alone; the second means nothing routes to it even if the first were misconfigured. Verify both, and verify them from outside the instance — see [Verifying a deployment](#verifying-a-deployment).

### 1. Launch the instance

- AMI: **Ubuntu 24.04 LTS**, `t3.small` (2 vCPU / 2 GB — tesseract + PyMuPDF + Node together made `t3.micro`'s 1 GB a real OOM risk, not tested further)
- Storage: 20 GB gp3 (default 8 GB is tight once Docker images are pulled)
- Security group: inbound **22** (your IP only), **80**, **443**. Nothing else. Do not open 4021, 8099, or 4022 — those must never be reachable from the internet; the compose file's own port list is the last line of defense if a security-group rule is ever added by mistake.
- Paste `deploy/ec2/cloud-init.yaml` into "User data" at launch. It installs Docker, the Compose plugin, and Caddy, but deliberately does **not** clone the repo or start anything — secrets must never sit in EC2 user-data, which is readable via the instance metadata service by anything running on the box.

### 2. Push the code and secrets

```bash
# from your machine, once the instance has a public IP/DNS
scp -r . ubuntu@<ec2-host>:/opt/proofline/          # or git clone on the box
scp .env ubuntu@<ec2-host>:/opt/proofline/.env      # separately, never via git
```

Edit `.env` on the box first: set `GATEWAY_PUBLIC_URL` to the real domain (`https://your-domain.example.com`), matching what you put in the Caddyfile. Loopback here would fail the same way Section 17 already warns about.

### 3. Point a domain at the instance, configure Caddy

```bash
sudo cp /opt/proofline/deploy/ec2/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/your-domain.example.com/<your real domain>/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy requests and renews the TLS certificate automatically the first time it reloads with a real domain pointed at the instance; no manual Let's Encrypt step is required.

### 4. Bring the stack up

```bash
cd /opt/proofline
docker compose up -d
docker compose exec analysis python backend/seed_db.py   # fresh volume only
docker compose ps      # analysis must show no published ports
```

### 5. Verify from outside the instance, not from the box itself

```bash
curl -s https://your-domain.example.com/health
curl -s -o /dev/null -w '%{http_code}\n' http://<ec2-public-ip>:8099/health   # must fail/timeout
```

The second command is the isolation proof: it must time out or refuse. Run both — the first is the positive control. A refusal on its own could equally mean the host is unreachable, so "analysis refused" only proves isolation when the gateway answers 200 on that same public address.

### Deployment status

Proofline runs in production at **https://proofline.duckdns.org** on Docker Compose behind Caddy. CLAUDE.md's *Current Verified State* section is the sole status authority; this file documents the procedure, not the status.

The steps above describe the EC2 path. If you deploy to a fresh instance, run Step 5's isolation check and the verification block below against the new host rather than assuming they carry over — the security group and the domain are per-instance.

## Verifying a deployment

Run these against the public origin, not localhost.

```bash
BASE=https://your-host

# Routes
for r in / /app /history /docs /health; do
  printf '%s -> %s\n' "$r" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$r")"
done

# Facilitator must report Blocky402
curl -s "$BASE/health"

# FastAPI must NOT be reachable from outside
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "$BASE:8099/analyze"   # expect failure
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/analyze"                     # expect 404

# Payment gate: unpaid request is refused and performs no analysis
before=$(curl -s "$BASE/verification?limit=100" | python -c "import sys,json;print(json.load(sys.stdin)['count'])")
curl -s -o /dev/null -w 'unpaid -> %{http_code}\n' -X POST "$BASE/verify" \
  --data-binary @some.pdf -H 'Content-Type: application/pdf'
after=$(curl -s "$BASE/verification?limit=100" | python -c "import sys,json;print(json.load(sys.stdin)['count'])")
echo "delta: $((after-before))   # must be 0"
```

Browser regression, against the deployed verifier. **Do not modify `capture.ts`**; point it at the deployed `/app`:

```bash
cd x402-gate
GATEWAY_URL=https://your-host/app npx tsx src/capture.ts
```

All four paths must pass: `clear-sample`, `review-sample`, `upload-valid`, `upload-malformed`.

## Persistence

SQLite lives on the named volume `proofline-data` at `/data/proofline.db`, so history survives container replacement. `docker compose down` keeps it; `docker compose down -v` destroys it.

Uploaded documents remain transient: they are analysed and deleted, and are never written to the database.

## Abuse controls

Applied to `/demo/verify` only, because that path spends the service's own HBAR. `/verify` is unmetered by design — that caller pays for themselves.

- **12 requests/minute per client IP** → `429 RATE_LIMITED`
- **2 concurrent verifications** → `503`
- **120 s upstream timeout** → `503`, and the SSE stream is closed rather than left hanging
- **10 MB upload cap** (`MAX_UPLOAD_BYTES`)

State is in-memory and process-local, the same category as the SSE event store (CLAUDE.md §11). A second gateway instance would need a shared store.

## Behind a TLS terminator

The gateway sets `trust proxy` to 1 hop so the rate limit keys on the real client rather than the proxy. If you front it with more than one proxy layer, raise that value or the limit becomes global.

SSE needs buffering disabled on `/verification/:id/events`. The gateway already sets `x-accel-buffering: no` and omits `Content-Length`; verify your terminator does not re-buffer it (CLAUDE.md §11).
