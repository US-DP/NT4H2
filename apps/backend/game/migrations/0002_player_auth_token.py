# Generated for D431 — per-player authorization tokens

from django.db import migrations, models

import game.models


def _assign_unique_tokens(apps, schema_editor):
    """Regenerate a unique token per existing row.

    The field default callable is evaluated once by the schema editor
    for all rows.
    """
    Player = apps.get_model("game", "Player")
    for player in Player.objects.all():
        player.auth_token = game.models._generate_player_token()
        player.save(update_fields=["auth_token"])


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="player",
            name="auth_token",
            field=models.CharField(default=game.models._generate_player_token, max_length=128),
        ),
        migrations.RunPython(_assign_unique_tokens, migrations.RunPython.noop),
    ]
