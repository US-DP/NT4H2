# Generated for NT4H — ready state in lobby
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0003_player_connection_count_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="player",
            name="is_ready",
            field=models.BooleanField(default=False),
        ),
    ]
