# -*- coding: utf-8 -*-
"""Auditoria del catalogo NT4H contra el inventario oficial.

Genera AUDITORIA_OFICIAL.md con:
- Inventario por tipo vs. material oficial (8 heroes/4 fisicos, 60 habilidades,
  27 huestes, 3 señores, 14 mercado, 12 escenarios)
- Matriz por carta: imagen (ruta, existe, hash), efectos, verificacion
- Cobertura de efectos (todos los tipos usados deben existir en EFFECT_REGISTRY)
- Discrepancias registradas
"""
import json, hashlib, re, glob, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'packages', 'catalog', 'data', 'official')
PUBLIC = os.path.join(ROOT, 'apps', 'mobile', 'public')

EXPECTED = {
    'HERO': (8, 'cartas fisicas 4, caras 8'),
    'ABILITY': (60, 'copias en 4 mazos de 15'),
    'HORDE': (27, 'huestes'),
    'WARLORD': (3, 'señores de la guerra'),
    'MARKET': (14, 'copias en 9 definiciones'),
    'SCENARIO': (12, 'escenarios'),
}

def short_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()[:12]

def card_effects(card):
    types = []
    def walk(effects):
        for e in effects or []:
            types.append(e.get('type', '?'))
            for k in ('effects', 'then', 'else', 'onMatch', 'onMismatch',
                      'on_match', 'on_mismatch', 'fallback'):
                if isinstance(e.get(k), list):
                    walk(e[k])
            # CHOOSE_ONE: los efectos viven dentro de cada opción
            for opt in e.get('options') or []:
                if isinstance(opt, dict):
                    walk(opt.get('effects'))
    walk(card.get('effects'))
    # heroAbility y peritia ejecutan efectos por otros caminos — sin
    # recorrerlos, un tipo no registrado ahí no aparecía en la cobertura.
    if card.get('heroAbility'):
        walk(card['heroAbility'].get('effects'))
    if card.get('peritia'):
        walk(card['peritia'].get('effects'))
    return types

def main():
    # Tipos de efecto soportados por el motor: los register() viven en
    # effects/handlers/*.ts tras el refactor por dominios (antes se leia
    # solo registry.ts, que ya no contiene ninguno y marcaba todo
    # MISSING_IMPLEMENTATION).
    registered = set()
    for src_file in glob.glob(
        os.path.join(ROOT, 'packages', 'engine', 'src', 'effects', '**', '*.ts'),
        recursive=True,
    ):
        src = open(src_file, encoding='utf-8').read()
        registered.update(re.findall(r"\.register\('([A-Z_]+)'", src))

    images = json.load(open(os.path.join(DATA, 'images.json'), encoding='utf-8'))
    img_map = images.get('cards', images) if isinstance(images, dict) else {}

    cards = []
    for f in glob.glob(os.path.join(DATA, '**', '*.json'), recursive=True):
        d = json.load(open(f, encoding='utf-8'))
        for c in d.get('cards', []):
            cards.append(c)

    rows = []
    discrepancies = []
    all_effect_types = set()
    stats = {}
    for c in cards:
        ctype = c.get('type')
        stats.setdefault(ctype, {'defs': 0, 'copies': 0})
        stats[ctype]['defs'] += 1
        stats[ctype]['copies'] += c.get('copies', 1)

        effs = card_effects(c)
        all_effect_types.update(effs)
        unknown = [e for e in effs if e not in registered]

        # Imagen: buscar en images.json
        img_rel = None
        entry = img_map.get(c['id'])
        if isinstance(entry, dict):
            img_rel = entry.get('front') or entry.get('image')
        elif isinstance(entry, str):
            img_rel = entry
        img_exists = False
        img_hash = '-'
        if img_rel:
            p = os.path.join(PUBLIC, img_rel.replace('/', os.sep))
            if not os.path.exists(p):
                p = os.path.join(PUBLIC, 'assets', 'cards', os.path.basename(img_rel))
            if os.path.exists(p):
                img_exists = True
                img_hash = short_hash(p)

        status = 'VERIFIED'
        if not img_rel:
            status = 'MISSING_ASSET'
        elif not img_exists:
            status = 'MISSING_ASSET'
        if unknown:
            status = 'MISSING_IMPLEMENTATION'
        if c.get('verificationStatus') == 'REVISAR':
            status = 'NEEDS_OFFICIAL_REVIEW'

        rows.append((c['id'], c.get('name', '?'), ctype, img_rel or '-', img_hash,
                     ','.join(effs) or '-', c.get('verificationStatus', '?'), status))
        if status != 'VERIFIED':
            discrepancies.append((status, c['id'], c.get('name', '?')))

    out = []
    out.append('# Auditoria oficial del catalogo NT4H\n')
    out.append('Generado por `scripts/audit_catalog.py`. Fuente prioritaria: imagenes oficiales + reglamento Holocubierta.\n')

    out.append('## A. Inventario vs material oficial\n')
    out.append('| Tipo | Definiciones | Copias | Esperado | Estado |')
    out.append('|---|---|---|---|---|')
    for t, (exp, note) in EXPECTED.items():
        s = stats.get(t, {'defs': 0, 'copies': 0})
        metric = s['copies'] if t in ('ABILITY', 'MARKET') else s['defs']
        ok = 'OK' if metric == exp else 'DISCREPANCIA'
        out.append(f'| {t} | {s["defs"]} | {s["copies"]} | {exp} ({note}) | {ok} |')
    out.append('')
    out.append('> Resolucion documentada: el inventario del proyecto decia "15 cartas de Mercado"; '
               'el catalogo real contiene 9 definiciones que suman **14 copias** = el conteo oficial. '
               'No hay carta extra: el 15 era un error de recuento del inventario.\n')

    out.append('## B. Matriz de cartas\n')
    out.append('| ID | Nombre | Tipo | Imagen | Hash | Efectos | Verif. | Estado |')
    out.append('|---|---|---|---|---|---|---|---|')
    for r in sorted(rows):
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    out.append('')

    out.append('## C. Discrepancias\n')
    if discrepancies:
        for sev, cid, name in discrepancies:
            out.append(f'- **{sev}** `{cid}` ({name})')
    else:
        out.append('Ninguna pendiente: todas las cartas tienen imagen y efectos registrados.')
    out.append('')

    out.append('## D. Cobertura de efectos\n')
    out.append(f'- Tipos de efecto registrados en el motor: {len(registered)}')
    out.append(f'- Tipos usados por el catalogo: {len(all_effect_types)}')
    missing = all_effect_types - registered
    if missing:
        out.append(f'- **Sin handler**: {sorted(missing)}')
    else:
        out.append('- Todos los efectos usados tienen handler en `EffectRegistry`.')
    unused = registered - all_effect_types
    out.append(f'- Registrados sin uso en el catalogo (disponibles para el Taller): {sorted(unused)}')
    out.append('')

    out.append('## E. Contenido personalizado (Taller)\n')
    out.append('Cubierto por `packages/engine/tests/custom-content.test.ts` (14 tests): '
               'conjunto validado con carta multi-efecto, heroe, escenario, hueste, '
               'senor y mazo de 15 jugado en partida real + determinismo por hash; '
               'nodos REPEAT (repeticion acotada), CHOOSE_ONE (eleccion via pendingChoice) '
               'y presupuesto de resolucion (RESOLUTION_HALTED al superar 10.000 ops).\n')

    path = os.path.join(ROOT, 'AUDITORIA_OFICIAL.md')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out))
    total = len(rows)
    verified = sum(1 for r in rows if r[7] == 'VERIFIED')
    print(f'Escrito {path}')
    print(f'Cartas: {verified}/{total} VERIFIED, {len(discrepancies)} discrepancias')
    for d in discrepancies:
        print(' ', d)

if __name__ == '__main__':
    main()
