"""Client for the engine-runner HTTP service."""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

ENGINE_RUNNER_URL = os.environ.get("ENGINE_RUNNER_URL", "http://localhost:3001")
# D433: secreto compartido backend → runner. Vacío solo en dev — el runner
# rechaza arrancar sin token a menos que ENGINE_RUNNER_DEV_OPEN=1.
ENGINE_RUNNER_TOKEN = os.environ.get("ENGINE_RUNNER_TOKEN", "")
if not ENGINE_RUNNER_TOKEN:
    logger.warning(
        "ENGINE_RUNNER_TOKEN vacío — el runner aceptará peticiones sin auth "
        "(solo aceptable en desarrollo local)"
    )


def _url(path: str) -> str:
    return f"{ENGINE_RUNNER_URL}{path}"


def _headers() -> dict:
    if ENGINE_RUNNER_TOKEN:
        return {"X-Engine-Token": ENGINE_RUNNER_TOKEN}
    return {}


class EngineRunnerClient:
    """Thin client that delegates game state execution to engine-runner."""

    @staticmethod
    def create_room(room_id: str, config: dict) -> dict:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(
                _url(f"/rooms/{room_id}/create"),
                json={"config": config},
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def execute_command(room_id: str, cid: str, player_id: str, command: dict) -> dict:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(
                _url(f"/rooms/{room_id}/command"),
                json={"cid": cid, "playerId": player_id, "command": command},
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def get_state(room_id: str, player_id: str | None = None) -> dict:
        with httpx.Client(timeout=5.0) as client:
            params = {"playerId": player_id} if player_id else None
            response = client.get(
                _url(f"/rooms/{room_id}/state"),
                params=params,
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def delete_room(room_id: str) -> dict:
        """Elimina la sala del runner (cleanup de salas abandonadas)."""
        with httpx.Client(timeout=5.0) as client:
            response = client.delete(
                _url(f"/rooms/{room_id}"),
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()
