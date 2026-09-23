# syntax=docker/dockerfile:1.7
#
# Image for the workshop's per-session sandbox container. This is the ONLY
# place participant-submitted Python code executes (see
# workshop/backend/worker_server.py / env_runtime.py). It is run by
# workshop/backend/session_manager.py with a locked-down `docker run`
# (--cap-drop=ALL, --security-opt=no-new-privileges, pids/memory/cpu limits,
# and a network with no route to anything but the Perception API — see
# session_manager.py's module docstring). Not --read-only or non-root: the
# visual-tier capx API writes ad-hoc debug images to the cwd (see
# session_manager.py's comment next to the `docker run` invocation), and the
# container's own filesystem layer is thrown away with it on session end
# regardless. This Dockerfile only needs to produce a working, minimal
# *image*; the hardening happens at `docker run` time, not here.
#
# `capx/third_party/robosuite` is a git submodule (see .gitmodules) — check
# it out before building, from the repo root:
#   git submodule update --init capx/third_party/robosuite
#
# Build from the repo root (this Dockerfile's own .dockerignore excludes
# everything not needed for the `robosuite` extra):
#   docker build -f workshop/backend/docker/Dockerfile -t capx-workshop-worker .
FROM python:3.10-slim-bookworm

# libgl1/libglib2.0-0/libsm6/libxext6: same baseline as docker/Dockerfile.
# libegl1/libopengl0/libglvnd0: MuJoCo's EGL offscreen renderer (MUJOCO_GL=egl)
# needs the generic GLVND/EGL loader libraries; the actual NVIDIA vendor
# implementation (libEGL_nvidia.so) is bind-mounted in by nvidia-container-
# toolkit at `docker run` time based on --runtime=nvidia + DRIVER_CAPABILITIES
# (verified working on this host; note the modern `--gpus` flag's CDI path
# hits an unrelated Vulkan-ICD toolkit bug on hosts without libnvidia-gl
# installed — use the legacy `--runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=...`
# invocation instead, which session_manager.py does).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    curl \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libegl1 \
    libopengl0 \
    libglvnd0 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# pyproject.toml declares `capx` itself as the installable project, so the
# full (dockerignore-filtered) source tree must be present before `uv sync`
# runs -- it installs capx as an editable package, not just its dependencies.
COPY pyproject.toml uv.lock README.md ./
COPY capx ./capx
COPY env_configs ./env_configs
COPY workshop/backend ./workshop/backend
COPY workshop/__init__.py ./workshop/__init__.py

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra robosuite

# capx/integrations/motion/pyroki_context.py resolves the Panda arm's URDF
# via `robot_descriptions.loaders.yourdfpy.load_robot_description
# ("panda_description")`, which on a cache miss `git clone`s
# github.com/Gepetto/example-robot-data (see robot_descriptions/_cache.py's
# `clone_to_cache()`) into `$ROBOT_DESCRIPTIONS_CACHE` (default
# `~/.cache/robot_descriptions`). Any API call that goes through pyroki
# (goto_pose, sample_grasp_pose, ...) touches this — i.e. effectively every
# task — so it needs to be a cache *hit* by the time a session container
# runs: that container's network is `internal: true` with a route to
# nothing but the three fixed Perception API proxies (session_manager.py's
# module docstring), so a clone attempted at runtime would just hang/fail.
# Fixed the same way as Dockerfile.libero's LIBERO config bootstrap: warm
# the cache once here, at build time (when this image still has ordinary
# internet access), into a path outside the container's `/tmp` (which
# `docker run --tmpfs /tmp` in session_manager.py replaces with an empty
# mount on every session, wiping anything cached under the default
# `~/.cache` once HOME is repointed there below).
ENV ROBOT_DESCRIPTIONS_CACHE=/app/.cache/robot_descriptions
RUN .venv/bin/python -c "from robot_descriptions.loaders.yourdfpy import load_robot_description; load_robot_description('panda_description')" \
 && test -d /app/.cache/robot_descriptions/example-robot-data

# Everything that might try to write a cache/config file under "~" (mujoco,
# fontconfig, matplotlib, robosuite's private macros, etc.) should land in
# the container's tmpfs (see `docker run --tmpfs /tmp` in session_manager.py)
# rather than accumulate in the image's own writable layer for no reason.
# Pointing HOME at /tmp covers all of them without enumerating each
# library's own env var. ROBOT_DESCRIPTIONS_CACHE (set above) and
# LIBERO_CONFIG_PATH (Dockerfile.libero) are deliberately *not* HOME-relative
# for exactly this reason — they need to survive HOME being replaced.
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib

EXPOSE 8500

ENTRYPOINT ["python", "-m", "workshop.backend.worker_server"]
