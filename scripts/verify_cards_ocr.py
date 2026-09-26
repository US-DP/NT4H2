# -*- coding: utf-8 -*-
"""
Verifica cartas del catálogo contra el OCR de la fuente oficial
(nt4h-cartas-personajes.pdf → ocr_results.json en el repo NT4H).

Criterio de verificación:
  - El nombre de la carta aparece en el texto OCR (normalizado).
  - Si la carta tiene printedAttack, ese número aparece en el texto OCR.
Genera docs/card-verification-report.json con el resultado por carta.
"""
import json
import io
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_DIR = os.path.join(ROOT, 'packages', 'catalog', 'data', 'official')
OCR_PATH = os.path.join(ROOT, '..', 'NT4H', 'ocr_results.json')
OUT = os.path.join(ROOT, 'docs', 'card-verification-report.json')

FILES = [
    'abilities/explorer.json', 'abilities/warrior.json', 'abilities/mage.json',
    'abilities/rogue.json', 'horde.json', 'warlords.json', 'market.json',
    'heroes.json', 'scenarios.json',
]


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9 ]', ' ', s.lower()).strip()


def load_ocr_corpus():
    """Todos los fragmentos OCR como un solo corpus normalizado."""
    d = json.load(io.open(OCR_PATH, encoding='utf-8'))
    frags = []
    def walk(x):
        if isinstance(x, dict):
            t = x.get('text')
            if isinstance(t, str) and t.strip():
                frags.append(t)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(d)
    return [(f, norm(f)) for f in frags]


def main():
    corpus = load_ocr_corpus()
    report = []

    for rel in FILES:
        data = json.load(io.open(os.path.join(CATALOG_DIR, rel), encoding='utf-8'))
        cards = data if isinstance(data, list) else data.get('cards', [])
        for card in cards:
            if card.get('verificationStatus') == 'CONFIRMED':
                continue  # ya verificada en una ronda anterior
            name_norm = norm(card.get('name', ''))
            if not name_norm:
                continue
            attack = card.get('printedAttack')
            # Buscar fragmentos OCR que contengan el nombre
            matches = [f for f, n in corpus if name_norm in n]
            entry = {
                'cardId': card['id'],
                'name': card['name'],
                'type': card.get('type'),
                'verificationStatus': card.get('verificationStatus'),
                'ocrMatches': matches[:3],
                'nameFound': bool(matches),
                'attackFound': None,
            }
            if attack and matches:
                # El ataque impreso debe aparecer como número en el fragmento
                pat = re.compile(rf'\b{attack}\b')
                entry['attackFound'] = any(pat.search(m) for m in matches)
            elif attack:
                entry['attackFound'] = False
            entry['verified'] = bool(matches) and (
                attack is None or attack == 0 or entry['attackFound'] is True
            )
            report.append(entry)

    verified = [e for e in report if e['verified']]
    partial = [e for e in report if e['nameFound'] and not e['verified']]
    missing = [e for e in report if not e['nameFound']]

    doc = {
        'description': 'Verificación de cartas contra OCR de nt4h-cartas-personajes.pdf',
        'corpusSize': len(corpus),
        'totals': {
            'checked': len(report),
            'nameFound': sum(1 for e in report if e['nameFound']),
            'verified': len(verified),
            'partialNameOnly': len(partial),
            'notFoundInOcr': len(missing),
        },
        'entries': report,
    }
    io.open(OUT, 'w', encoding='utf-8', newline='').write(
        json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(doc['totals'], ensure_ascii=False))
    print('\nNo encontradas en OCR:')
    for e in missing:
        print(' -', e['cardId'], e['name'])
    print('\nNombre sí, ataque no confirmado:')
    for e in partial:
        print(' -', e['cardId'], e['name'], '→', (e['ocrMatches'] or [''])[:1])


if __name__ == '__main__':
    main()
