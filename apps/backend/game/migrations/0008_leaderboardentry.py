# Generated manually — clasificación pública opt-in (LeaderboardEntry)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0007_communitystat"),
    ]

    operations = [
        migrations.CreateModel(
            name="LeaderboardEntry",
            fields=[
                (
                    "name",
                    models.CharField(max_length=40, primary_key=True, serialize=False),
                ),
                ("wins", models.PositiveIntegerField(default=0)),
                ("games", models.PositiveIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
