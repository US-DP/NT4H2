"""Borra salas muertas: WAITING sin conectados y FINISHED antiguas.

Pensado para cron/Task Scheduler:

    python manage.py reap_rooms

El mismo barrido corre de forma perezosa en list_rooms (acotado a una
pasada por minuto); este comando existe para despliegues donde el
listado es poco frecuente o se quiere un limpiador dedicado.
"""

from django.core.management.base import BaseCommand

from game.views import reap_stale_rooms


class Command(BaseCommand):
    """Elimina salas huérfanas en Django y, mejor esfuerzo, en el runner."""

    help = "Reap stale WAITING/FINISHED game sessions (see game.views.reap_stale_rooms)"  # noqa: A003

    def handle(self, *args, **options):
        """Ejecuta el barrido y reporta las salas eliminadas."""
        reaped = reap_stale_rooms()
        for room_id in reaped:
            self.stdout.write(f"reaped {room_id}")
        self.stdout.write(self.style.SUCCESS(f"{len(reaped)} stale room(s) reaped"))
