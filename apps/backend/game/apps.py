"""Django app configuration for game."""

import os
import sys

from django.apps import AppConfig


class GameConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "game"

    def ready(self) -> None:
        """Activa WAL en SQLite y resetea la presencia residual.

        SQLite + Channels: con journal DELETE un lector con transacción
        abierta (SHARED) bloquea el COMMIT del escritor (EXCLUSIVE) y el
        escritor bloquea el upgrade del lector → «database is locked»
        inmediato (p. ej. start_room vs consumers). WAL separa lectores
        de escritores; el busy_timeout de settings cubre escritor↔escritor.

        Si el proceso muere de golpe (kill, crash, deploy), disconnect()
        nunca corre y los flags quedan en True para siempre: las salas
        WAITING "conectadas" quedaban excluidas del reaper y un
        transfer_host posterior creía que el host seguía vivo. Al
        arrancar no hay sockets abiertos — todo contador es residual.
        """
        from django.db.backends.signals import connection_created

        def _enable_wal(sender, connection, **kwargs):
            if connection.vendor == "sqlite":
                with connection.cursor() as cur:
                    cur.execute("PRAGMA journal_mode=WAL")

        connection_created.connect(_enable_wal, dispatch_uid="game.sqlite_wal")
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
