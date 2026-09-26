from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0004_player_is_ready"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesession",
            name="kicked_ids",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
