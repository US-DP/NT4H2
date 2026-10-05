# Columna revision de GameSnapshot: write-only, el valor ya viaja
# dentro del JSON `state` y la revisión viva es GameSession.revision.
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0016_player_player_age_player_second_deck_id"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="gamesnapshot",
            name="revision",
        ),
    ]
