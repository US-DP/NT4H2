# Auditoria oficial del catalogo NT4H

Generado por `scripts/audit_catalog.py`. Fuente prioritaria: imagenes oficiales + reglamento Holocubierta.

## A. Inventario vs material oficial

| Tipo | Definiciones | Copias | Esperado | Estado |
|---|---|---|---|---|
| HERO | 8 | 8 | 8 (cartas fisicas 4, caras 8) | OK |
| ABILITY | 33 | 60 | 60 (copias en 4 mazos de 15) | OK |
| HORDE | 27 | 27 | 27 (huestes) | OK |
| WARLORD | 3 | 3 | 3 (señores de la guerra) | OK |
| MARKET | 9 | 14 | 14 (copias en 9 definiciones) | OK |
| SCENARIO | 12 | 12 | 12 (escenarios) | OK |

> Resolucion documentada: el inventario del proyecto decia "15 cartas de Mercado"; el catalogo real contiene 9 definiciones que suman **14 copias** = el conteo oficial. No hay carta extra: el 15 era un error de recuento del inventario.

## B. Matriz de cartas

| ID | Nombre | Tipo | Imagen | Hash | Efectos | Verif. | Estado |
|---|---|---|---|---|---|---|---|
| explorer.arrow-volley | Lluvia de Flechas | ABILITY | assets/cards/abilities/explorer.arrow-volley-front.png | 957596a94a0c | DEAL_DAMAGE_SPLIT,DEAL_DAMAGE_TO_HERO | CONFIRMED | VERIFIED |
| explorer.bullseye | En la Diana | ABILITY | assets/cards/abilities/explorer.bullseye-front.png | d07699a8927d | GAIN_GLORY,LOSE_CARDS | CONFIRMED | VERIFIED |
| explorer.collect-arrows | Recoger Flechas | ABILITY | assets/cards/abilities/explorer.collect-arrows-front.png | 1dcd21d348d4 | RECOVER_CARD_BY_NAME,SHUFFLE_DECK,GAIN_COINS | CONFIRMED | VERIFIED |
| explorer.companion-wolf | Compañero Lobo | ABILITY | assets/cards/abilities/explorer.companion-wolf-front.png | a52873325172 | PREVENT_DAMAGE | CONFIRMED | VERIFIED |
| explorer.precise-shot | Disparo Certero | ABILITY | assets/cards/abilities/explorer.precise-shot-front.png | 89d58764b8f2 | LOSE_CARDS,END_ATTACK | CONFIRMED | VERIFIED |
| explorer.rapid-shot | Disparo Rápido | ABILITY | assets/cards/abilities/explorer.rapid-shot-front.png | 6733271cce7a | DRAW_AND_CHECK,PLAY_IMMEDIATELY | CONFIRMED | VERIFIED |
| explorer.survival | Supervivencia | ABILITY | assets/cards/abilities/explorer.survival-front.png | d782a453cf72 | SWAP_ENEMY | CONFIRMED | VERIFIED |
| hero.aranel | Aranel | HERO | assets/cards/heroes/hero.aranel-front.png | 63ebd29ee5eb | SEARCH_DECK,SHUFFLE_DECK | CONFIRMED | VERIFIED |
| hero.beleth-il | Beleth-Il | HERO | assets/cards/heroes/hero.beleth-il-front.png | 0bbabb2fc9f9 | - | CONFIRMED | VERIFIED |
| hero.feldon | Feldon | HERO | assets/cards/heroes/hero.feldon-front.png | ea9d9f7b3066 | - | CONFIRMED | VERIFIED |
| hero.idril | Idril | HERO | assets/cards/heroes/hero.idril-front.png | 33267b061c83 | LOOK_AT_CARDS | CONFIRMED | VERIFIED |
| hero.lisavette | Lisavette | HERO | assets/cards/heroes/hero.lisavette-front.png | 76308a69fa22 | - | CONFIRMED | VERIFIED |
| hero.neddia | Neddia | HERO | assets/cards/heroes/hero.neddia-front.png | 947d35d6ee90 | SEARCH_DECK,SHUFFLE_DECK | CONFIRMED | VERIFIED |
| hero.taheral | Taheral | HERO | assets/cards/heroes/hero.taheral-front.png | 9e60c7b7bd55 | GAIN_COINS | CONFIRMED | VERIFIED |
| hero.valerys | Valèrys | HERO | assets/cards/heroes/hero.valerys-front.png | 49793b99922b | INTERCEPT_DAMAGE,GAIN_GLORY | CONFIRMED | VERIFIED |
| horde.001 | Hueste 1 | HORDE | assets/cards/horde/horde.001-front.png | 97fda6e8f6ac | - | CONFIRMED | VERIFIED |
| horde.002 | Hueste 2 | HORDE | assets/cards/horde/horde.002-front.png | 279771c31dd0 | - | CONFIRMED | VERIFIED |
| horde.003 | Hueste 3 | HORDE | assets/cards/horde/horde.003-front.png | 8e3b8f22530e | - | CONFIRMED | VERIFIED |
| horde.004 | Hueste 4 | HORDE | assets/cards/horde/horde.004-front.png | 98c5bd9811cd | - | CONFIRMED | VERIFIED |
| horde.005 | Hueste 5 | HORDE | assets/cards/horde/horde.005-front.png | f868c058f67a | - | CONFIRMED | VERIFIED |
| horde.006 | Hueste 6 | HORDE | assets/cards/horde/horde.006-front.png | 4def3d54d6bc | - | CONFIRMED | VERIFIED |
| horde.007 | Hueste 7 | HORDE | assets/cards/horde/horde.007-front.png | bb33c8128373 | - | CONFIRMED | VERIFIED |
| horde.008 | Hueste 8 | HORDE | assets/cards/horde/horde.008-front.png | c3bfc2ebe2b9 | - | CONFIRMED | VERIFIED |
| horde.009 | Hueste 9 | HORDE | assets/cards/horde/horde.009-front.png | 3ea7bea5173b | - | CONFIRMED | VERIFIED |
| horde.010 | Hueste 10 | HORDE | assets/cards/horde/horde.010-front.png | 40631a6046db | - | CONFIRMED | VERIFIED |
| horde.011 | Hueste 11 | HORDE | assets/cards/horde/horde.011-front.png | 82b393efb3ba | - | CONFIRMED | VERIFIED |
| horde.012 | Hueste 12 | HORDE | assets/cards/horde/horde.012-front.png | caf18ec03cdb | - | CONFIRMED | VERIFIED |
| horde.013 | Hueste 13 | HORDE | assets/cards/horde/horde.013-front.png | dd49b3bd6675 | - | CONFIRMED | VERIFIED |
| horde.014 | Hueste 14 | HORDE | assets/cards/horde/horde.014-front.png | ebea89b57697 | - | CONFIRMED | VERIFIED |
| horde.015 | Hueste 15 | HORDE | assets/cards/horde/horde.015-front.png | 8fc373d82ab8 | - | CONFIRMED | VERIFIED |
| horde.016 | Hueste 16 | HORDE | assets/cards/horde/horde.016-front.png | 5736f5a6d365 | - | CONFIRMED | VERIFIED |
| horde.017 | Hueste 17 | HORDE | assets/cards/horde/horde.017-front.png | e9b404e2f056 | - | CONFIRMED | VERIFIED |
| horde.018 | Hueste 18 | HORDE | assets/cards/horde/horde.018-front.png | 174fc679eadd | - | CONFIRMED | VERIFIED |
| horde.019 | Hueste 19 | HORDE | assets/cards/horde/horde.019-front.png | 26f8945fd762 | - | CONFIRMED | VERIFIED |
| horde.020 | Hueste 20 | HORDE | assets/cards/horde/horde.020-front.png | 2ade01a95814 | - | CONFIRMED | VERIFIED |
| horde.021 | Hueste 21 | HORDE | assets/cards/horde/horde.021-front.png | 653c870112b7 | - | CONFIRMED | VERIFIED |
| horde.022 | Hueste 22 | HORDE | assets/cards/horde/horde.022-front.png | 10088415cf20 | - | CONFIRMED | VERIFIED |
| horde.023 | Hueste 23 | HORDE | assets/cards/horde/horde.023-front.png | 50b7f545a5bf | - | CONFIRMED | VERIFIED |
| horde.024 | Hueste 24 | HORDE | assets/cards/horde/horde.024-front.png | 443ec5492a4c | - | CONFIRMED | VERIFIED |
| horde.025 | Hueste 25 | HORDE | assets/cards/horde/horde.025-front.png | 8a57e260e14b | - | CONFIRMED | VERIFIED |
| horde.026 | Hueste 26 | HORDE | assets/cards/horde/horde.026-front.png | 907065f2f965 | - | CONFIRMED | VERIFIED |
| horde.027 | Hueste 27 | HORDE | assets/cards/horde/horde.027-front.png | 7836748a1c10 | - | CONFIRMED | VERIFIED |
| mage.corrosive-arrow | Flecha Corrosiva | ABILITY | assets/cards/abilities/mage.corrosive-arrow-front.png | 35a245d9e937 | APPLY_VULNERABILITY,LOSE_CARDS | CONFIRMED | VERIFIED |
| mage.fire-bolt | Proyectil Ígneo | ABILITY | assets/cards/abilities/mage.fire-bolt-front.png | f611a8a7c141 | GAIN_GLORY | CONFIRMED | VERIFIED |
| mage.fireball | Bola de Fuego | ABILITY | assets/cards/abilities/mage.fireball-front.png | a03ed8cc0e3b | DEAL_DAMAGE_ALL_ENEMIES,DEAL_DAMAGE_TO_OTHER_HEROES | CONFIRMED | VERIFIED |
| mage.healing-orb | Orbe Curativo | ABILITY | assets/cards/abilities/mage.healing-orb-front.png | 67de80c4edf8 | ALL_HEROES_RECOVER,HEAL_WOUNDS | CONFIRMED | VERIFIED |
| mage.ice-shot | Disparo Gélido | ABILITY | assets/cards/abilities/mage.ice-shot-front.png | d4bf7327e9c7 | DISABLE_ENEMY_DAMAGE,DRAW_CARDS | CONFIRMED | VERIFIED |
| mage.light-torrent | Torrente de Luz | ABILITY | assets/cards/abilities/mage.light-torrent-front.png | 7fa4a0f45eed | OTHER_HEROES_RECOVER,GAIN_GLORY | CONFIRMED | VERIFIED |
| mage.protective-aura | Aura Protectora | ABILITY | assets/cards/abilities/mage.protective-aura-front.png | 389fced090d8 | CANCEL_ALL_DAMAGE,LOSE_CARDS | CONFIRMED | VERIFIED |
| mage.reconstitution | Reconstitución | ABILITY | assets/cards/abilities/mage.reconstitution-front.png | e77870b98608 | DRAW_CARDS,RECOVER_CARDS | CONFIRMED | VERIFIED |
| mage.staff-strike | Golpe de Bastón | ABILITY | assets/cards/abilities/mage.staff-strike-front.png | 5d67751b20e7 | CONDITIONAL | CONFIRMED | VERIFIED |
| market.composite-bow | Arco Compuesto | MARKET | assets/cards/market/market.composite-bow-front.png | 1f82ec1e67cb | - | CONFIRMED | VERIFIED |
| market.concentration-elixir | Elixir de Concentración | MARKET | assets/cards/market/market.concentration-elixir-front.png | 1b0c0d4d6f4e | DRAW_CARDS | CONFIRMED | VERIFIED |
| market.conjuration-vial | Vial de Conjuración | MARKET | assets/cards/market/market.conjuration-vial-front.png | a8821d7e6ff5 | SEARCH_WEAR_PILE_PUT_IN_HAND | CONFIRMED | VERIFIED |
| market.elven-cloak | Capa Élfica | MARKET | assets/cards/market/market.elven-cloak-front.png | 3cb7a3e60cb6 | DISABLE_ENEMY_DAMAGE | CONFIRMED | VERIFIED |
| market.elven-dagger | Daga Élfica | MARKET | assets/cards/market/market.elven-dagger-front.png | 6f84c926bfdf | CONDITIONAL,RECOVER_THIS_CARD | CONFIRMED | VERIFIED |
| market.healing-potion | Poción Curativa | MARKET | assets/cards/market/market.healing-potion-front.png | 50bccc44de54 | HEAL_WOUNDS | CONFIRMED | VERIFIED |
| market.orc-halberd | Alabarda Orca | MARKET | assets/cards/market/market.orc-halberd-front.png | 40550d880846 | - | CONFIRMED | VERIFIED |
| market.plate-armor | Armadura de Placas | MARKET | assets/cards/market/market.plate-armor-front.png | ed1593fc02b5 | RECOVER_CARDS | CONFIRMED | VERIFIED |
| market.whetstone | Piedra de Amolar | MARKET | assets/cards/market/market.whetstone-front.png | eab56ea24a67 | MODIFY_DAMAGE | CONFIRMED | VERIFIED |
| rogue.deceive | Engañar | ABILITY | assets/cards/abilities/rogue.deceive-front.png | 175aaab4aa02 | COST,DISABLE_ENEMY_DAMAGE | CONFIRMED | VERIFIED |
| rogue.in-the-shadows | En las Sombras | ABILITY | assets/cards/abilities/rogue.in-the-shadows-front.png | 063772bc52ad | PREVENT_DAMAGE | CONFIRMED | VERIFIED |
| rogue.pickpocket | Robar Bolsillos | ABILITY | assets/cards/abilities/rogue.pickpocket-front.png | bd31885bd8f1 | STEAL_COINS | CONFIRMED | VERIFIED |
| rogue.plunder-a | Saqueo | ABILITY | assets/cards/abilities/rogue.plunder-a-front.png | 77636b2cddea | GAIN_COINS | CONFIRMED | VERIFIED |
| rogue.plunder-b | Saqueo | ABILITY | assets/cards/abilities/rogue.plunder-b-front.png | bbf9b0184e9b | GAIN_COINS,GAIN_GLORY | CONFIRMED | VERIFIED |
| rogue.precise-crossbow | Ballesta Precisa | ABILITY | assets/cards/abilities/rogue.precise-crossbow-front.png | f1ed900e9750 | CONDITIONAL | CONFIRMED | VERIFIED |
| rogue.sneak-attack | Ataque Furtivo | ABILITY | assets/cards/abilities/rogue.sneak-attack-front.png | 81236217fb9e | ON_DEFEAT,CONDITIONAL,GAIN_COINS | CONFIRMED | VERIFIED |
| rogue.to-the-heart | Al Corazón | ABILITY | assets/cards/abilities/rogue.to-the-heart-front.png | 5e0fe4d1090a | ON_DEFEAT,CONDITIONAL,GAIN_COINS,LOSE_CARDS | CONFIRMED | VERIFIED |
| rogue.trap | Trampa | ABILITY | assets/cards/abilities/rogue.trap-front.png | 794812f20a93 | PLACE_PERSISTENT,DEFEAT_ENEMY | CONFIRMED | VERIFIED |
| scenario.battlefield | Campo de Batalla | SCENARIO | assets/cards/scenarios/scenario.battlefield-front.png | 94134bf7744f | ON_ENEMY_DEFEATED,GAIN_COINS | CONFIRMED | VERIFIED |
| scenario.brunmar-ruins | Ruinas de Brunmar | SCENARIO | assets/cards/scenarios/scenario.brunmar-ruins-front.png | 0c60cdf2682d | MODIFY_FORTITUDE,IGNORE_GLORY_REWARDS | CONFIRMED | VERIFIED |
| scenario.cemenmar-wastes | Yermo de Cemenmar | SCENARIO | assets/cards/scenarios/scenario.cemenmar-wastes-front.png | 945ba6de095c | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.eque-port | Puerto de Eque | SCENARIO | assets/cards/scenarios/scenario.eque-port-front.png | 154d59a80765 | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.jade-deposits | Yacimientos de Jade | SCENARIO | assets/cards/scenarios/scenario.jade-deposits-front.png | 8bbb2ee2ba96 | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.kalern-mud | Lodazal de Kalern | SCENARIO | assets/cards/scenarios/scenario.kalern-mud-front.png | 35ddf2645d3a | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.lotharion-market | Mercado de Lötharion | SCENARIO | assets/cards/scenarios/scenario.lotharion-market-front.png | eef4cb4cddb9 | MODIFY_MARKET_COST | CONFIRMED | VERIFIED |
| scenario.skaarg-plains | Planicie de Skaàrg | SCENARIO | assets/cards/scenarios/scenario.skaarg-plains-front.png | 12652eb06354 | IGNORE_COIN_REWARDS | CONFIRMED | VERIFIED |
| scenario.tears-of-aradiel | Lágrimas de Aradiel | SCENARIO | assets/cards/scenarios/scenario.tears-of-aradiel-front.png | 3f8b806ca5c8 | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.ulthar-portal | Portal de Ulthar | SCENARIO | assets/cards/scenarios/scenario.ulthar-portal-front.png | a18f1bbafe07 | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| scenario.umbrous-swamp | Pantano Umbrío | SCENARIO | assets/cards/scenarios/scenario.umbrous-swamp-front.png | 0930574ecb21 | ON_ENEMY_DEFEATED,GAIN_COINS | CONFIRMED | VERIFIED |
| scenario.ur-mountains | Montañas de Ur | SCENARIO | assets/cards/scenarios/scenario.ur-mountains-front.png | f87ffd7a7f80 | CUSTOM_SCENARIO | CONFIRMED | VERIFIED |
| warlord.gurdrug | Gurdrug | WARLORD | assets/cards/warlords/warlord.gurdrug-front.png | ced77a188ecd | LOSE_CARDS | CONFIRMED | VERIFIED |
| warlord.roghkiller | Roghkiller | WARLORD | assets/cards/warlords/warlord.roghkiller-front.png | a8939ad50dba | MODIFY_FORTITUDE | CONFIRMED | VERIFIED |
| warlord.shriekknifer | Shriekknifer | WARLORD | assets/cards/warlords/warlord.shriekknifer-front.png | 9d3a4a8ddf80 | RECOVER_CARDS | CONFIRMED | VERIFIED |
| warrior.all-or-nothing | Todo o Nada | ABILITY | assets/cards/abilities/warrior.all-or-nothing-front.png | 2b54cd5d036e | DRAW_AND_ADD_ATTACK | CONFIRMED | VERIFIED |
| warrior.brutal-attack | Ataque Brutal | ABILITY | assets/cards/abilities/warrior.brutal-attack-front.png | 38e5b19fce1e | LOSE_CARDS | CONFIRMED | VERIFIED |
| warrior.double-slash | Doble Espadazo | ABILITY | assets/cards/abilities/warrior.double-slash-front.png | d799ab3200a5 | LOSE_CARDS | CONFIRMED | VERIFIED |
| warrior.shield | Escudo | ABILITY | assets/cards/abilities/warrior.shield-front.png | 9363769a6b6a | PREVENT_ENEMY_DAMAGE,END_ATTACK | CONFIRMED | VERIFIED |
| warrior.shield-charge | Carga con Escudo | ABILITY | assets/cards/abilities/warrior.shield-charge-front.png | ed5766487c5c | PREVENT_DAMAGE | CONFIRMED | VERIFIED |
| warrior.step-back | Paso Atrás | ABILITY | assets/cards/abilities/warrior.step-back-front.png | 1e16f02223b2 | DRAW_CARDS | CONFIRMED | VERIFIED |
| warrior.sword-strike | Espadazo | ABILITY | assets/cards/abilities/warrior.sword-strike-front.png | 491aa242ba86 | CONDITIONAL,DRAW_CARDS | CONFIRMED | VERIFIED |
| warrior.voice-of-encouragement | Voz de Aliento | ABILITY | assets/cards/abilities/warrior.voice-of-encouragement-front.png | 65bc2fa8ae4e | ALL_HEROES_RECOVER,DRAW_CARDS,GAIN_GLORY | CONFIRMED | VERIFIED |

## C. Discrepancias

Ninguna pendiente: todas las cartas tienen imagen y efectos registrados.

## D. Cobertura de efectos

- Tipos de efecto registrados en el motor: 72
- Tipos usados por el catalogo: 42
- Todos los efectos usados tienen handler en `EffectRegistry`.
- Registrados sin uso en el catalogo (disponibles para el Taller): ['APPLY_STATUS', 'BLOCK_NEXT_DAMAGE', 'CHOOSE_ONE', 'DEAL_DAMAGE', 'DEAL_DAMAGE_HITS', 'DISCARD_FROM_HAND', 'DISCARD_HORDE_CARD', 'DRAW_FROM_BOTTOM', 'DRAW_UP_TO', 'EXECUTE_ENEMY', 'FOR_EACH', 'GRANT_ARMOR', 'INCREASE_STATUS', 'MOVE_CARD', 'MOVE_HORDE_CARDS', 'ON_HORDE_ATTACK', 'OVERKILL_DAMAGE', 'PLAY_RANDOM_CARD_FROM_OTHER_HERO', 'REGISTER_LISTENER', 'REMOVE_FROM_GAME', 'REMOVE_LISTENER', 'REMOVE_STATUS', 'REPEAT', 'RETURN_TO_HORDE', 'SET_VARIABLE', 'SHIELD', 'SPAWN_ENEMY', 'STEAL_COINS_MULTIPLE', 'TAKE_WOUNDS', 'TRY_EFFECT']

## E. Contenido personalizado (Taller)

Cubierto por `packages/engine/tests/custom-content.test.ts` (12 tests): conjunto validado con carta multi-efecto, heroe, escenario, hueste, senor y mazo de 15 jugado en partida real + determinismo por hash; nodos REPEAT (repeticion acotada), CHOOSE_ONE (eleccion via pendingChoice) y presupuesto de resolucion (RESOLUTION_HALTED al superar 10.000 ops).
