# -*- coding: utf-8 -*-
"""
Promociona a CONFIRMED las cartas verificadas en card-verification-report.json.
Solo se tocan las que el verificador marcó verified=true o las 6 revisadas
visualmente contra la imagen oficial (frontal del P&P).
"""
import json
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_DIR = os.path.join(ROOT, 'packages', 'catalog', 'data', 'official')
REPORT = os.path.join(ROOT, 'docs', 'card-verification-report.json')

# Revisión visual directa sobre las imágenes frontal_*.png del P&P:
# las 6 restantes tienen el ataque en icono (la OCR no lo lee).
VISUAL_CONFIRMED = {
    'warrior.double-slash',   # frontal_p3_r1c1: gota roja "2", "Pierdes 1 carta"
    'mage.fireball',          # frontal_p4_r2c2: "2", todos los enemigos + 1 daño héroes
    'mage.fire-bolt',         # frontal_p5_r2c2: "2", +1 Gloria
    'mage.light-torrent',     # frontal_p5_r3c3: "2", resto recupera 2 + Gloria
    'rogue.sneak-attack',     # frontal_p6_r1c3: "2", moneda al derrotar 1/turno
    'rogue.precise-crossbow', # frontal_p6_r2c1+: condicional daño 3
}

report = json.load(io.open(REPORT, encoding='utf-8'))
verified_ids = {e['cardId'] for e in report['entries'] if e.get('verified')}
verified_ids |= VISUAL_CONFIRMED

FILES = [
    'abilities/explorer.json', 'abilities/warrior.json', 'abilities/mage.json',
    'abilities/rogue.json', 'horde.json', 'warlords.json', 'market.json',
    'heroes.json', 'scenarios.json',
]

changed = 0
for rel in FILES:
    path = os.path.join(CATALOG_DIR, rel)
    data = json.load(io.open(path, encoding='utf-8'))
    cards = data if isinstance(data, list) else data.get('cards', [])
    dirty = False
    for c in cards:
        if c.get('id') in verified_ids and c.get('verificationStatus') != 'CONFIRMED':
            c['verificationStatus'] = 'CONFIRMED'
            changed += 1
            dirty = True
    if dirty:
        io.open(path, 'w', encoding='utf-8', newline='').write(
            json.dumps(data, ensure_ascii=False, indent=2) + '\n')

print(f'promoted={changed}')
