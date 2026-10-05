# -*- coding: utf-8 -*-
"""
Genera docs/rules-traceability.json.

Dos capas:
  - 'rules': las 20 reglas verificadas manualmente (se conservan si existen).
  - 'cards': una entrada POR CARTA del catálogo oficial, con su estado de
    verificación derivado de la cobertura real (efectos soportados por el
    registro, test de jugabilidad global, tests específicos conocidos).

Uso:  python scripts/gen_traceability.py
"""
import json
import io
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'packages', 'catalog', 'data', 'official')
ENGINE_TESTS = os.path.join(ROOT, 'packages', 'engine', 'tests')
OUT = os.path.join(ROOT, 'docs', 'rules-traceability.json')

FILES = [
    ('abilities/explorer.json', 'Mazo Explorador'),
    ('abilities/warrior.json', 'Mazo Guerrero'),
    ('abilities/mage.json', 'Mazo Mago'),
    ('abilities/rogue.json', 'Mazo Pícaro'),
    ('horde.json', 'Horda'),
    ('warlords.json', 'Señores de la Guerra'),
    ('market.json', 'Mercado'),
    ('heroes.json', 'Héroes'),
    ('scenarios.json', 'Escenarios'),
]

# Tests específicos conocidos por carta (se amplía a medida que se añaden)
CARD_TESTS = {
    'warlord.roghkiller': ['heroes/heroes.test.ts', 'projection-replay-modifiers.test.ts'],
    'warlord.gurdrug': ['heroes/heroes.test.ts'],
    'warlord.shriekknifer': ['heroes/heroes.test.ts'],
    'rogue.elf-dagger': ['unit/effects.test.ts', 'resolver.test.ts'],
    'hero.valerys': ['heroes/heroes.test.ts'],
    'hero.lisavette': ['heroes/heroes.test.ts'],
    'hero.feldon': ['heroes/heroes.test.ts'],
    'hero.aranel': ['heroes/heroes.test.ts'],
    'scenario.brunmar-ruins': ['scenarios/scenarios.test.ts'],
    'scenario.eque-port': ['scenarios/scenarios.test.ts'],
}

# Efectos manejados por el registro de efectos (packages/catalog/src/effects +
# engine/resolver.ts). Un efecto sin handler baja el estado a REVIEW.
KNOWN_EFFECT_KINDS = None  # se rellena leyendo EFFECT_REGISTRY


def load_catalog_effects_registry():
    """Tipos de efecto con handler REAL en el motor.

    Lee los `register('X')` de packages/engine/src/effects/**/*.ts — antes
    leía los literales del schema Zod, así que un tipo declarado pero sin
    handler salía como "soportado" y la carta se marcaba VERIFIED aunque
    en partida el efecto fuese un no-op.
    """
    import glob
    import re
    registered = set()
    for src_file in glob.glob(
        os.path.join(ROOT, 'packages', 'engine', 'src', 'effects', '**', '*.ts'),
        recursive=True,
    ):
        src = io.open(src_file, encoding='utf-8').read()
        registered.update(re.findall(r"\.register\('([A-Z_]+)'", src))
    return registered


def read_cards():
    cards = []
    for rel, section in FILES:
        path = os.path.join(CATALOG, rel)
        data = json.load(io.open(path, encoding='utf-8'))
        items = data if isinstance(data, list) else data.get('cards', [])
        for c in items:
            c['_file'] = f'data/official/{rel}'
            c['_section'] = section
            cards.append(c)
    return cards


def card_effects(card):
    """Todos los tipos de efecto que usa la carta.

    Recursivo: efectos raíz + heroAbility + peritia + anidados
    (then/else/options/fallback/onMatch…). Sin recursión, un tipo sin
    handler escondido en una rama no bajaba el estado a REVIEW.
    """
    kinds = set()

    def walk(effects):
        for eff in effects or []:
            if not isinstance(eff, dict):
                continue
            if 'type' in eff:
                kinds.add(eff['type'])
            for k in ('effects', 'then', 'else', 'onMatch', 'onMismatch',
                      'on_match', 'on_mismatch', 'fallback'):
                if isinstance(eff.get(k), list):
                    walk(eff[k])
            for opt in eff.get('options') or []:
                if isinstance(opt, dict):
                    walk(opt.get('effects'))

    walk(card.get('effects'))
    for extra in ('heroAbility', 'peritia'):
        sub = card.get(extra) or {}
        if isinstance(sub, dict):
            walk(sub.get('effects'))
    return kinds


def status_for(card, kinds, known_kinds):
    unknown = kinds - known_kinds
    if unknown:
        return 'REVIEW', f'efectos sin handler en schema: {sorted(unknown)}'
    if card.get('verificationStatus') in ('OCR', 'INFERRED', 'REVISAR'):
        return 'PENDING_SOURCE', f"verificationStatus={card['verificationStatus']}"
    return 'VERIFIED', 'catálogo validado + efectos soportados + usable en motor'


def main():
    known_kinds = load_catalog_effects_registry()
    cards = read_cards()

    entries = []
    for c in cards:
        kinds = card_effects(c)
        status, note = status_for(c, kinds, known_kinds)
        tests = ['all-cards-usable.test.ts'] if os.path.exists(
            os.path.join(ENGINE_TESTS, 'all-cards-usable.test.ts')
        ) else []
        tests = CARD_TESTS.get(c['id'], []) + tests
        entries.append({
            'id': f"CARD-{c['id']}",
            'cardId': c['id'],
            'name': c.get('name', c['id']),
            'type': c.get('type'),
            'copies': c.get('copies', 1),
            'source': {
                'document': 'official-rulebook-es',
                'section': c['_section'],
                'catalogFile': c['_file'],
            },
            'rule': (c.get('textOverride')
                     or ', '.join(sorted(kinds))
                     or 'carta con valores impresos'),
            'engine': {
                'modules': ['resolver.ts', 'effects/registry.ts'],
                'effectTypes': sorted(kinds),
            },
            'tests': sorted(set(tests)),
            'status': status,
            'note': note,
        })

    # Conservar las reglas manuales existentes
    existing = {}
    if os.path.exists(OUT):
        existing = json.load(io.open(OUT, encoding='utf-8'))

    doc = {
        '$schema': 'rules-traceability/v2',
        'description': (
            'Matriz de trazabilidad: cada regla/carta → fuente oficial → '
            'módulo del motor → pruebas. Generado por scripts/gen_traceability.py; '
            'la sección rules se conserva manualmente.'
        ),
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'rules': existing.get('rules', []),
        'cards': entries,
        'summary': {
            'cards': len(entries),
            'verified': sum(1 for e in entries if e['status'] == 'VERIFIED'),
            'pendingSource': sum(1 for e in entries if e['status'] == 'PENDING_SOURCE'),
            'review': sum(1 for e in entries if e['status'] == 'REVIEW'),
        },
    }
    io.open(OUT, 'w', encoding='utf-8', newline='').write(
        json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    s = doc['summary']
    print(f"cards={s['cards']} verified={s['verified']} "
          f"pending={s['pendingSource']} review={s['review']}")


if __name__ == '__main__':
    main()
