/**
 * cardWorkshop/FxPreview.tsx - vista previa PSCT (estilo Yu-Gi-Oh):
 * traduce los nodos del editor a las frases que leera la carta impresa,
 * en tiempo real. Mismo describeEffect que usa CardZoom en partida, asi
 * que el texto del preview es exactamente el que vera el jugador.
 */

import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { describeEffect } from '../../CardZoom';
import { buildEffects } from './compiler';
import type { EffectNode } from './model';
import { styles } from './editorStyles';
/**
 * FxPreview — vista previa PSCT (estilo Yu-Gi-Oh): traduce los nodos del
 * editor a las frases que leerá la carta impresa, en tiempo real. Mismo
 * describeEffect que usa CardZoom en partida, así que el texto del preview
 * es exactamente el que verá el jugador.
 */
export function FxPreview({ nodes, label }: { nodes: EffectNode[]; label?: string }) {
  const { t } = useTranslation();
  const lines = useMemo(() => {
    const out: string[] = [];
    for (const eff of buildEffects(nodes)) {
      try {
        const d = describeEffect(eff);
        if (d) out.push(d);
      } catch { /* nodo incompleto: el preview lo omite, no rompe el editor */ }
    }
    return out;
  }, [nodes, t]);
  if (lines.length === 0) return null;
  return (
    <View style={styles.previewBox} accessibilityLabel={label ?? t('workshop.generatedTextTitle')}>
      <Text style={styles.previewTitle}>{label ?? t('workshop.generatedTextTitle')}</Text>
      {lines.map((l, i) => (
        <Text key={i} style={styles.previewLine}>{i + 1}. {l}</Text>
      ))}
    </View>
  );
}

// ============================================================================
// Simulador (P1): ejecuta los efectos contra un estado sintético usando el
// MISMO resolver del motor (resolveCard + EffectRegistry + seed fija).
// Muestra la traza de eventos y los deltas de estado — nunca lanza.
// ============================================================================
