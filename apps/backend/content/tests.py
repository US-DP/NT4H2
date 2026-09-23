"""Tests for the content app (CardDefinition, CardVersion CRUD)."""
from django.test import TestCase
from rest_framework.test import APIClient

from .models import CardDefinition, CardVersion


class CardDefinitionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.card = CardDefinition.objects.create(
            card_id="explorer.rapid-shot",
            name="Disparo rápido",
            card_type="ABILITY",
            hero_class="EXPLORER",
            copies=6,
            printed_attack=1,
            effects=[{"type": "DRAW_AND_CHECK", "amount": 1}],
            author="official",
            version="1.0.0",
        )

    def test_list_cards(self):
        response = self.client.get("/api/cards/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["card_id"], "explorer.rapid-shot")

    def test_retrieve_card_by_card_id(self):
        response = self.client.get("/api/cards/explorer.rapid-shot/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "Disparo rápido")

    def test_create_card(self):
        response = self.client.post("/api/cards/", {
            "card_id": "warrior.shield",
            "name": "Escudo",
            "card_type": "ABILITY",
            "hero_class": "WARRIOR",
            "copies": 2,
            "printed_attack": 0,
            "effects": [],
            "author": "official",
            "version": "1.0.0",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(CardDefinition.objects.filter(card_id="warrior.shield").exists())

    def test_update_card(self):
        response = self.client.patch("/api/cards/explorer.rapid-shot/", {
            "copies": 8,
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.card.refresh_from_db()
        self.assertEqual(self.card.copies, 8)

    def test_delete_card(self):
        response = self.client.delete("/api/cards/explorer.rapid-shot/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CardDefinition.objects.filter(card_id="explorer.rapid-shot").exists())

    def test_card_by_id_endpoint(self):
        response = self.client.get("/api/cards/by-id/explorer.rapid-shot/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["card_id"], "explorer.rapid-shot")

    def test_card_by_id_not_found(self):
        response = self.client.get("/api/cards/by-id/nonexistent/")
        self.assertEqual(response.status_code, 404)

    def test_import_card_creates(self):
        response = self.client.post("/api/cards/import/", {
            "card_id": "mage.fireball",
            "name": "Bola de Fuego",
            "card_type": "ABILITY",
            "hero_class": "MAGE",
            "copies": 3,
            "printed_attack": 3,
            "effects": [],
            "author": "official",
            "version": "1.0.0",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(CardDefinition.objects.filter(card_id="mage.fireball").exists())

    def test_import_card_updates_existing(self):
        response = self.client.post("/api/cards/import/", {
            "card_id": "explorer.rapid-shot",
            "name": "Disparo rápido v2",
            "card_type": "ABILITY",
            "hero_class": "EXPLORER",
            "copies": 10,
            "printed_attack": 2,
            "effects": [],
            "author": "official",
            "version": "1.1.0",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.card.refresh_from_db()
        self.assertEqual(self.card.copies, 10)
        self.assertEqual(self.card.version, "1.1.0")


class CardVersionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.card = CardDefinition.objects.create(
            card_id="warrior.shield",
            name="Escudo",
            card_type="ABILITY",
            hero_class="WARRIOR",
            copies=2,
            printed_attack=0,
            effects=[],
            author="official",
            version="1.0.0",
        )
        self.version = CardVersion.objects.create(
            card=self.card,
            version="1.0.0",
            data={"printedAttack": 0, "effects": []},
        )

    def test_list_versions(self):
        response = self.client.get("/api/card-versions/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_create_version(self):
        response = self.client.post("/api/card-versions/", {
            "card": self.card.id,
            "version": "1.1.0",
            "data": {"printedAttack": 1, "effects": []},
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(CardVersion.objects.filter(version="1.1.0").exists())

    def test_delete_version(self):
        response = self.client.delete(f"/api/card-versions/{self.version.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CardVersion.objects.filter(id=self.version.id).exists())
