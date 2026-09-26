# Generated manually — reloj de turno autoritativo (turn_player_id/turn_started_at)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0008_leaderboardentry"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesession",
            name="turn_player_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="gamesession",
            name="turn_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
