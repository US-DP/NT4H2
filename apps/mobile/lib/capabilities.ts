/**
 * capabilities.ts — nombre visible de las capacidades de héroe/carta.
 *
 * El catálogo las declara como enums en inglés (MELEE, RANGED, EXPERTISE,
 * MAGIC); la UI nunca las pinta en crudo: todas las vistas usan
 * `capLabel`/`capListLabel`, que resuelven `cardui.anatomy.caps.<CAP>`
 * con fallback al valor original si el catálogo introduce una nueva.
 */

import type { TFunction } from 'i18next';

/** Nombre localizado de una capacidad (MELEE → "Cuerpo a cuerpo"). */
export const capLabel = (t: TFunction, cap: string): string =>
  t(`cardui.anatomy.caps.${cap}`, { defaultValue: cap });

/** Lista localizada de capacidades unida por `sep`. */
export const capListLabel = (t: TFunction, caps: readonly string[], sep = ', '): string =>
  caps.map((c) => capLabel(t, c)).join(sep);

/** Nombre localizado de una clase de héroe (EXPLORER → "Explorador").
 *  Las clases custom del Taller caen al valor original. */
export const classLabel = (t: TFunction, cls: string): string =>
  t(`create.classes.${cls.toUpperCase()}`, { defaultValue: cls });
