# CaP-X Workshop WebUI

Implementation of `WORKSHOP_WEBUI_SPEC.md`. Robosuite-only, manual-code,
Colab-style WebUI backed by a FastAPI backend that hosts one sandboxed
Robosuite session per participant.

**Security note**: participant code executes via `exec()` (see
`workshop/backend/env_runtime.py`), so it must never run directly in the
backend process. Every session runs inside its own locked-down, non-root,
network-isolated Docker container — see "Sandboxing" below before deploying
this anywhere reachable from the internet.

## Layout

- `backend/` — FastAPI orchestrator (`app.py`, `session_manager.py`,
  `config.py`). Thin: it never imports capx and doesn't need the Robosuite
  venv — it only starts Docker containers and talks to them over HTTP.
- `backend/env_runtime.py`, `backend/worker_server.py`,
  `backend/docker/Dockerfile` — the sandboxed Session Worker. This is where
  capx + Robosuite actually run, and the only place participant code
  executes. Built into its own Docker image, one container per session.
- `webui/` — React + Vite frontend (task selection, Monaco cell editor,
  camera view, optional Perception panel, API docs panel).
- `docker/` — always-on infra: Cloudflare Tunnel + the Perception API
  proxies the sandbox containers are allowed to reach. See "Sandboxing".

## One-time setup

```bash
# 1. Submodules the worker image needs (sam3 is an unconditional capx
#    dependency; robosuite is the extra this image installs).
git submodule update --init capx/third_party/sam3 capx/third_party/robosuite

# 2. Build the sandboxed worker image (from the repo root).
docker build -f workshop/backend/docker/Dockerfile -t capx-workshop-worker:latest .

# 3. Start the always-on infra: Cloudflare Tunnel + Perception API proxies.
cd workshop/docker
cp .env.example .env   # fill in CLOUDFLARE_TUNNEL_TOKEN from the Cloudflare dashboard
docker compose up -d
cd ../..
```

Requirements on the host: Docker with `nvidia-container-toolkit` installed
(legacy hook mode — `--runtime=nvidia`, not the modern `--gpus` flag; see
"Sandboxing"), and the user running the backend must be able to run `docker`
without `sudo` (i.e. be in the `docker` group), since `session_manager.py`
shells out to the `docker` CLI directly.

## Running locally (dev)

Backend (no Robosuite venv needed — see Layout above):

```bash
uv sync   # base deps only, no --extra
uv run python -m workshop.backend.main  # http://localhost:8200 (matches the Cloudflare Tunnel origin)
```

This runs in the foreground and dies with your shell/session — fine for
iterating, not for the actual workshop. See "Running as a service" below for
that.

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

## Running as a service

The backend itself is **not** containerized (see Layout above — it only
needs to shell out to `docker` to manage session containers, and doing that
from inside another container adds Docker-in-Docker complexity for no
benefit here). For the actual workshop, run it under systemd instead of a
bare `uv run` in a terminal, so it survives logout and restarts on crash.

A unit file is provided at `workshop/backend/capx-workshop-backend.service`.
Install it system-wide (needs sudo once; runs at boot, independent of any
user session — this is the one to use for the real event):

```bash
sudo cp workshop/backend/capx-workshop-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now capx-workshop-backend.service
sudo systemctl status capx-workshop-backend.service
journalctl -u capx-workshop-backend.service -f   # logs
```

(If you'd rather not use sudo, the same unit works as a per-user service —
copy it to `~/.config/systemd/user/` instead and use `systemctl --user
enable --now ...`; just note that without `loginctl enable-linger <user>`
(also needs sudo) it stops when that user logs out, which defeats the
point for an unattended workshop machine.)

Either way, `docker compose up -d` in `workshop/docker/` (cloudflared +
Perception API proxies) should already be running independently — the
systemd unit only manages the backend process, not those containers.

## Sandboxing

Every session's worker runs in its own Docker container, started by
`session_manager.py` with:

- `--cap-drop ALL --security-opt no-new-privileges` (no privilege escalation,
  no raw sockets/mount/admin capabilities — the usual container escape
  vectors)
- `--memory 4g --cpus 2 --pids-limit 512`
- `/workspace` (the capx source) mounted **read-only**; a `/tmp` tmpfs for
  scratch/cache writes
- its own private Docker network, created with `--internal` (no route to the
  internet or LAN at all — enforced by Docker itself, no iptables needed),
  attached as the container's *primary* network so there's no default route
  out at all (see session_manager.py's module docstring for why the
  attach *order* between this and the publish-port network matters)

The container's own root filesystem is **not** read-only — capx's
visual-tier API (`get_object_pose`/`sample_grasp_pose`) writes ad-hoc debug
images to the current working directory, which lives on that layer. That
layer belongs solely to one ephemeral container (destroyed with it on
session end); it's never the host, `/workspace`, or another session.

The private network has no access to the Perception API by default.
Instead, `session_manager.py` connects the three `perception-proxy-*`
containers from `workshop/docker/docker-compose.yml` onto it before the
worker container starts. Each proxy is a dumb `socat` relay to one fixed,
hardcoded upstream (SAM3/GraspNet/PyRoKi — see `WORKSHOP_ENDPOINT.md`), so a
sandboxed session can reach the Perception API and nothing else on the
internet or LAN — verified on this host (see session_manager.py's module
docstring). Inter-session reachability was not hardened further (a lower
priority than internet/LAN/host isolation per product decision); each
session's worker can currently still be reached by another session's worker
container.

GPU passthrough uses the legacy `--runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=...
-e NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics` invocation, not the
modern `--gpus` flag — on this deployment host, `--gpus` goes through
nvidia-container-toolkit's CDI mode, which fails trying to bind-mount a
Vulkan ICD file (`/usr/share/vulkan/icd.d/nvidia_icd.json`) that isn't
present because `libnvidia-gl-*` isn't installed. The legacy hook mode
doesn't hit that path and was verified working (including EGL, which
`MUJOCO_GL=egl` needs) on this host.

## Adding/changing tasks

Edit `backend/config.py`'s `TASKS` list — no other file needs to change to
add, remove, or swap out a Robosuite task (see spec section 1.1).
