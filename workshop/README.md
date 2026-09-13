# CaP-X Workshop WebUI

Implementation of `WORKSHOP_WEBUI_SPEC.md`. Robosuite-only, manual-code,
Colab-style WebUI backed by a FastAPI backend that hosts one Robosuite
session per participant.

## Layout

- `backend/` — FastAPI app + Session Worker (spawns one process per session,
  each holding a `CodeExecutionEnvBase` + Robosuite instance). See
  `WORKSHOP_WEBUI_SPEC.md` sections 3.2/3.3.
- `webui/` — React + Vite frontend (task selection, Monaco cell editor,
  camera view, optional Perception panel). See section 3.1/1.4.
- `docker/` — Cloudflare Tunnel (cloudflared only; backend/webui run
  natively). See section 4.1.

## Running locally

Backend (needs the Robosuite venv: `uv sync --extra robosuite` at repo root):

```bash
cp workshop/backend/.envrc.example workshop/backend/.envrc  # edit if your Perception API host differs
source workshop/backend/.envrc
uv run python -m workshop.backend.main  # http://localhost:8300
```

WebUI (dev server, proxies /api to the backend):

```bash
cd workshop/webui
npm install
npm run dev  # http://localhost:5173
```

## Production build (single origin, for the Cloudflare Tunnel)

```bash
cd workshop/webui && npm install && npm run build
# then run the backend as above — it serves workshop/webui/dist automatically
# once that directory exists (see workshop/backend/app.py).
```

## Exposing it externally

```bash
cd workshop/docker
cp .env.example .env  # fill in CLOUDFLARE_TUNNEL_TOKEN from the Cloudflare dashboard
docker compose -f docker-compose.tunnel.yml up -d
```

Perception API servers (SAM3/GraspNet/PyRoKi) are never part of this tunnel —
only the backend's port is exposed. See `WORKSHOP_ENDPOINT.md` for the
current Perception API host and `workshop/backend/.envrc.example` for how the
backend resolves it.

## Adding/changing tasks

Edit `backend/config.py`'s `TASKS` list — no other file needs to change to
add, remove, or swap out a Robosuite task (see spec section 1.1).
