"""Owns the sandboxed Session Worker containers for all active WebUI sessions.

Participant code executes via `EnvRuntime.run_cell()` -> `exec()` (see
workshop/backend/env_runtime.py) — so each session's worker runs in its own
Docker container, on its own private Docker network, instead of a plain OS
process or a shared network. Every worker container has exactly two
networks, attached in this order (order matters — see below):

1. A private, per-session network (`capx-ws-net-<session_id>`), created with
   `internal: true` (no route anywhere at all) and attached as the
   container's *primary* network at `docker run` time. The three
   `perception-proxy-*` containers from `workshop/docker/docker-compose.yml`
   (dumb, fixed-destination TCP relays to the real SAM3/GraspNet/PyRoKi
   hosts) are connected onto it before the worker container starts, so the
   worker can resolve and reach them by name from its first request onward.
   This is the *only* network path to the Perception API.

2. `IO_NETWORK` (shared, created once, connected *after* the container
   starts). A plain bridge network with `enable_ip_masquerade=false` and
   `enable_icc=false`. Its only purpose is letting the backend publish and
   reach the container's port — `internal: true` networks refuse to publish
   ports at all (verified on this host: Docker silently drops the `-p`
   mapping), but a masquerade-disabled *non*-internal bridge still lets
   published-port inbound (DNAT) traffic through while fully blocking the
   container's own outbound connectivity (verified on this host: both LAN
   and internet destinations time out).

   Attaching (1) first and (2) second (rather than the other way around)
   matters: whichever network is primary at `docker run` time becomes the
   container's default route. With IO_NETWORK primary, that default route
   let the host forward unmatched traffic onto IO_NETWORK's gateway — and
   from there, verified on this host, the kernel would happily forward it
   again onto a *different* session's private network, since Docker's
   per-bridge isolation rules didn't cover that hop. With the per-session
   network primary instead, there is no default route at all — only
   directly-connected-subnet routes to (1) and (2) — so unmatched
   destinations are simply unreachable, no forwarding possible. This closes
   the internet/LAN-egress path completely; residual worker-to-worker
   reachability was not chased further, per product decision (isolating
   sandboxed code from the internet/LAN/host was the priority, not
   perfecting inter-session isolation).

The backend talks to each container over plain HTTP
(workshop/backend/worker_server.py) through the `127.0.0.1`-bound published
port from (2) — never on the LAN-facing interface. HTTP's own
request/response pairing also removes the need for the request-id
correlation the old in-process (multiprocessing.Queue-based) design needed
to guard against timeout/response desync.

None of this requires root or iptables: `docker network create/connect/run`
are all plain Docker CLI calls, usable by anyone in the `docker` group.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_SECONDS = 30 * 60
READY_TIMEOUT_SECONDS = 180
HEALTH_POLL_INTERVAL_SECONDS = 1.0

WORKER_IMAGE = "capx-workshop-worker:latest"
CONTAINER_PORT = 8500

# Shared network every worker container is created on, solely so its port can
# be published to the backend. See the module docstring for why this needs
# to be a masquerade-disabled *non*-internal bridge rather than `internal:
# true`.
IO_NETWORK = "capx-workshop-io"

# Fixed container names from workshop/docker/docker-compose.yml. Each is a
# dumb TCP relay to a real Perception API host — connecting one onto a
# session's network only ever grants reachability to that one fixed
# destination, regardless of anything sandboxed code sends it.
PROXY_CONTAINERS: dict[str, tuple[str, int]] = {
    "SAM3_SERVICE_URL": ("capx-workshop-proxy-sam3", 8114),
    "GRASPNET_SERVICE_URL": ("capx-workshop-proxy-graspnet", 8115),
    "PYROKI_SERVICE_URL": ("capx-workshop-proxy-pyroki", 8116),
}

# Host port range published (127.0.0.1-only) for session containers.
_PORT_RANGE_START = 18500
_PORT_RANGE_END = 18999


class PortAllocator:
    def __init__(self, start: int = _PORT_RANGE_START, end: int = _PORT_RANGE_END) -> None:
        self._start = start
        self._end = end
        self._used: set[int] = set()

    def acquire(self) -> int:
        for port in range(self._start, self._end):
            if port not in self._used:
                self._used.add(port)
                return port
        raise RuntimeError("No free ports left for sandbox containers")

    def release(self, port: int) -> None:
        self._used.discard(port)


@dataclass
class Session:
    session_id: str
    task_id: str
    container_name: str
    network_name: str
    host_port: int
    video_dir: Path
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_active: float = field(default_factory=time.monotonic)


async def _run(cmd: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")


class SessionManager:
    def __init__(self, video_root: Path, repo_root: Path, gpu_uuids: list[str] | None = None) -> None:
        self._sessions: dict[str, Session] = {}
        self._ports = PortAllocator()
        self._video_root = video_root
        self._repo_root = repo_root
        self._io_network_ready = False
        self._gpu_uuids = gpu_uuids or []
        self._gpu_index = 0

    def _next_nvidia_visible_devices(self) -> str:
        """Which GPU(s) the next session container may use.

        Round-robins across `self._gpu_uuids` if any were configured
        (`--gpu-uuids` in main.py — a UUID from `nvidia-smi -L`), so sessions
        spread across a multi-GPU host instead of piling onto one. With none
        configured, every session sees every GPU (`all`) — fine for a
        single-GPU host."""
        if not self._gpu_uuids:
            return "all"
        uuid_str = self._gpu_uuids[self._gpu_index % len(self._gpu_uuids)]
        self._gpu_index += 1
        return uuid_str

    async def _ensure_io_network(self) -> None:
        if self._io_network_ready:
            return
        rc, _out, _err = await _run(["docker", "network", "inspect", IO_NETWORK])
        if rc != 0:
            rc, _out, err = await _run(
                [
                    "docker",
                    "network",
                    "create",
                    "-o",
                    "com.docker.network.bridge.enable_ip_masquerade=false",
                    "-o",
                    "com.docker.network.bridge.enable_icc=false",
                    IO_NETWORK,
                ]
            )
            if rc != 0:
                raise RuntimeError(f"docker network create ({IO_NETWORK}) failed: {err.strip()}")
        self._io_network_ready = True

    async def create_session(self, task_id: str, config_path: str) -> Session:
        session_id = uuid.uuid4().hex[:12]
        container_name = f"capx-ws-{session_id}"
        network_name = f"capx-ws-net-{session_id}"
        host_port = self._ports.acquire()
        video_dir = self._video_root / session_id
        video_dir.mkdir(parents=True, exist_ok=True)
        # World-writable: the container runs as root but --cap-drop ALL
        # removes CAP_DAC_OVERRIDE, so without this it can't write into a
        # bind-mounted host directory it doesn't own (verified on this host —
        # ffmpeg failed with "Permission denied" on the default 0o755 dir).
        # Scoped to only this one session's own replay-video scratch dir.
        video_dir.chmod(0o777)

        session = Session(
            session_id=session_id,
            task_id=task_id,
            container_name=container_name,
            network_name=network_name,
            host_port=host_port,
            video_dir=video_dir,
        )
        # Registered before we're done starting it so close_session() can
        # always clean up partial state if a later step fails.
        self._sessions[session_id] = session

        try:
            await self._ensure_io_network()

            # Created (and attached as the container's *primary* network)
            # before `docker run`, so the container has no default route out
            # at all — only directly-connected-subnet routes. Attaching
            # IO_NETWORK afterward via `docker network connect` (below) adds
            # a route to *that* subnet only, without installing it as a
            # default gateway. Verified on this host: doing it in the
            # opposite order (IO_NETWORK primary, session network attached
            # later) left a default route through IO_NETWORK's gateway that
            # the host then forwarded onward to *other* sessions' private
            # networks — i.e. session-to-session traffic leaked. This order
            # closes that path (residual risk, not exhaustively hardened
            # further per product decision — the priority is blocking
            # internet/LAN/host access, not perfect inter-session isolation).
            rc, _out, err = await _run(["docker", "network", "create", "--internal", network_name])
            if rc != 0:
                raise RuntimeError(f"docker network create failed: {err.strip()}")

            for proxy_name, _proxy_port in PROXY_CONTAINERS.values():
                rc, _out, err = await _run(["docker", "network", "connect", network_name, proxy_name])
                if rc != 0:
                    raise RuntimeError(f"docker network connect ({proxy_name}) failed: {err.strip()}")

            container_config_path = "/workspace/" + str(
                Path(config_path).resolve().relative_to(self._repo_root)
            )

            cmd = [
                "docker",
                "run",
                "-d",
                "--name",
                container_name,
                "--network",
                network_name,
                # Not --read-only: capx's visual-tier API (control.py's
                # get_object_pose/sample_grasp_pose) writes ad-hoc debug
                # images (e.g. depth_image.jpg) to the current working
                # directory, which is under the image's own rootfs — that's
                # shared library behavior, not something this sandbox should
                # patch around. The tradeoff is fine: this only lets code
                # write into *this one container's own throwaway layer*
                # (destroyed on `docker rm`, never the host, `/workspace`
                # -- mounted read-only below -- or any other session); the
                # network/capability/resource limits below are what actually
                # contain a malicious payload.
                "--tmpfs",
                "/tmp:rw,size=1g",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--pids-limit",
                "512",
                "--memory",
                "4g",
                "--cpus",
                "2",
                # Legacy hook-based GPU passthrough, not `--gpus` (CDI mode
                # hits an unrelated Vulkan-ICD toolkit bug on hosts without
                # libnvidia-gl installed — verified on the deployment host).
                "--runtime",
                "nvidia",
                "-e",
                f"NVIDIA_VISIBLE_DEVICES={self._next_nvidia_visible_devices()}",
                "-e",
                "NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics",
                "-v",
                f"{self._repo_root}:/workspace:ro",
                "-v",
                f"{video_dir}:/output:rw",
                "-p",
                f"127.0.0.1:{host_port}:{CONTAINER_PORT}",
            ]
            # Fixed proxy hostnames, already reachable: the proxies were
            # connected onto network_name above, before this container joins
            # the same network as its primary interface.
            for env_var, (proxy_name, proxy_port) in PROXY_CONTAINERS.items():
                cmd += ["-e", f"{env_var}=http://{proxy_name}:{proxy_port}"]
            cmd += [
                WORKER_IMAGE,
                "--config-path",
                container_config_path,
                "--video-dir",
                "/output",
                "--port",
                str(CONTAINER_PORT),
            ]

            rc, _out, err = await _run(cmd)
            if rc != 0:
                raise RuntimeError(f"docker run failed: {err.strip()}")

            # IO_NETWORK joins second (not as the primary/creation-time
            # network) purely so the backend's published port activates —
            # see the comment above network_name's creation for why this
            # ordering matters.
            rc, _out, err = await _run(["docker", "network", "connect", IO_NETWORK, container_name])
            if rc != 0:
                raise RuntimeError(f"docker network connect (io) failed: {err.strip()}")

            await self._wait_until_healthy(session)
        except Exception:
            await self.close_session(session_id)
            raise

        logger.info(
            "Session %s ready (container=%s network=%s port=%s)",
            session_id,
            container_name,
            network_name,
            host_port,
        )
        return session

    async def _wait_until_healthy(self, session: Session) -> None:
        base_url = f"http://127.0.0.1:{session.host_port}"
        deadline = time.monotonic() + READY_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                resp = await asyncio.to_thread(requests.get, f"{base_url}/health", timeout=2)
                if resp.status_code == 200:
                    return
            except requests.RequestException:
                pass

            # Bail out early (instead of waiting the full timeout) if the
            # container already died — e.g. a bad config path or a GPU error.
            rc, stdout, _stderr = await _run(
                ["docker", "inspect", "-f", "{{.State.Running}}", session.container_name]
            )
            if rc != 0 or stdout.strip() != "true":
                _rc, logs, _ = await _run(["docker", "logs", "--tail", "100", session.container_name])
                raise RuntimeError(f"Worker container exited during startup:\n{logs}")

            await asyncio.sleep(HEALTH_POLL_INTERVAL_SECONDS)

        raise RuntimeError(f"Worker did not become healthy within {READY_TIMEOUT_SECONDS}s")

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def list_sessions(self) -> list[str]:
        return list(self._sessions.keys())

    async def _request(
        self, session: Session, method: str, path: str, json: dict[str, Any] | None = None, timeout: float = 180
    ) -> dict[str, Any]:
        url = f"http://127.0.0.1:{session.host_port}{path}"

        def _do() -> dict[str, Any]:
            resp = requests.request(method, url, json=json, timeout=timeout)
            resp.raise_for_status()
            return resp.json()

        return await asyncio.to_thread(_do)

    def _require(self, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return session

    async def reset(self, session_id: str) -> dict[str, Any]:
        session = self._require(session_id)
        async with session.lock:
            session.last_active = time.monotonic()
            return await self._request(session, "POST", "/reset")

    async def run_cell(self, session_id: str, cell_id: str, code: str, timeout: float = 180) -> dict[str, Any]:
        session = self._require(session_id)
        async with session.lock:
            session.last_active = time.monotonic()
            return await self._request(
                session, "POST", "/run_cell", json={"cell_id": cell_id, "code": code}, timeout=timeout
            )

    async def observation(self, session_id: str) -> dict[str, Any]:
        session = self._require(session_id)
        async with session.lock:
            session.last_active = time.monotonic()
            return await self._request(session, "GET", "/observation")

    async def replay(self, session_id: str, suffix: str = "combined", timeout: float = 60) -> dict[str, Any]:
        session = self._require(session_id)
        async with session.lock:
            session.last_active = time.monotonic()
            result = await self._request(
                session, "POST", "/replay", json={"suffix": suffix}, timeout=timeout
            )
        # The container reports its own path (e.g. "/output/video_combined.mp4"),
        # which is meaningless on the host — translate to the host-side path
        # under session.video_dir (the same directory, bind-mounted as
        # /output) instead of returning the container's string as-is.
        if result.get("path"):
            result["path"] = str(session.video_dir / f"video_{suffix}.mp4")
        return result

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        self._ports.release(session.host_port)

        await _run(["docker", "rm", "-f", session.container_name])
        for proxy_name, _port in PROXY_CONTAINERS.values():
            await _run(["docker", "network", "disconnect", "-f", session.network_name, proxy_name])
        await _run(["docker", "network", "rm", session.network_name])

    async def close_all(self) -> None:
        await asyncio.gather(
            *(self.close_session(sid) for sid in list(self._sessions.keys())),
            return_exceptions=True,
        )

    async def reap_idle(self) -> None:
        now = time.monotonic()
        stale = [sid for sid, s in self._sessions.items() if now - s.last_active > IDLE_TIMEOUT_SECONDS]
        for session_id in stale:
            logger.info("Reaping idle session %s", session_id)
            await self.close_session(session_id)
