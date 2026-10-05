"""Django app configuration for game."""

import os
import sys

from django.apps import AppConfig


class GameConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "game"

    def ready(self) -> None:
        """Resetea is_connected/connection_count al arrancar.

        Si el proceso muere de golpe (kill, crash, deploy), disconnect()
        nunca corre y los flags quedan en True para siempre: las salas
        WAITING "conectadas" quedaban excluidas del reaper y un
        transfer_host posterior creía que el host seguía vivo. Al
        arrancar no hay sockets abiertos — todo contador es residual.
        """
        # Solo en el proceso servidor real: ni autoreload (RUN_MAIN
        # ausente = proceso watcher), ni migraciones/tests/shell, que no
        # levantan sockets y tocar la tabla puede antes de que exista.
        argv = sys.argv
        if not ("runserver" in argv or "daphne" in argv or "uvicorn" in argv or "gunicorn" in argv):
            return
        if os.environ.get("RUN_MAIN") == "false":
            return
        from .models import Player

        Player.objects.filter(is_connected=True).update(is_connected=False, connection_count=0)
