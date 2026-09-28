/**
 * cardWorkshop/SimPanel.tsx - simulador de carta del Taller.
 * Ejecuta los efectos compilados contra un estado sintetico usando el
 * MISMO resolver del motor (resolveCard + EffectRegistry + seed fija),
 * con modo de ejecucion paso a paso. Nunca lanza.
 */

import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NtButton } from '../../ui/NtButton';
import { NtInput } from '../../ui/NtInput';
import { Chip } from './EffectTree';
import { buildEffects } from './compiler';
import {
  simulateEffects, DEFAULT_SIM_OPTIONS, type SimResult, type SimOptions,
} from './simulate';
import type { EffectNode } from './model';
import type { CardDefinition } from '@nt4h/schema';
import type { loadCatalog } from '@nt4h/catalog';
import { styles } from './editorStyles';
export function SimPanel({ nodes, cardDef, catalog }: {
  nodes: EffectNode[];
  cardDef: CardDefinition;
  catalog: ReturnType<typeof loadCatalog>;
}) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<SimOptions>({ ...DEFAULT_SIM_OPTIONS });
  const [result, setResult] = useState<SimResult | null>(null);
  const [open, setOpen] = useState(false);
  // Ejecución paso a paso (§19): revela la traza evento a evento.
  const [stepMode, setStepMode] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  // El resultado pertenece al árbol que lo generó: tras editar los nodos
  // la traza mostrada ya no refleja la carta — descartarla.
  useEffect(() => {
    setResult(null);
    setOpen(false);
    setStepIdx(0);
  }, [nodes]);

  const run = () => {
    const effects = buildEffects(nodes);
    setResult(simulateEffects(cardDef, effects, opts, catalog, t));
    setStepIdx(0);
    setOpen(true);
  };
  const setOpt = (patch: Partial<SimOptions>) => setOpts(o => ({ ...o, ...patch }));

  return (
    <View style={styles.simBox}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <NtButton label={t('workshop.simRun')} variant="secondary" size="sm" onPress={run} />
        <Text style={styles.miniLabel}>{t('workshop.simEnemies')}</Text>
        {[0, 1, 2, 3].map(n => (
          <Chip key={n} label={String(n)} selected={opts.enemies === n}
            onPress={() => setOpt({ enemies: n })} />
        ))}
        <Text style={styles.miniLabel}>{t('workshop.simFort')}</Text>
        {[1, 3, 5, 8].map(n => (
          <Chip key={n} label={String(n)} selected={opts.enemyFortitude === n}
            onPress={() => setOpt({ enemyFortitude: n })} />
        ))}
        <Chip label={t('workshop.simOrc')} selected={opts.enemyIsOrc}
          onPress={() => setOpt({ enemyIsOrc: !opts.enemyIsOrc })} />
        <Chip label={t('workshop.simWounded')} selected={opts.heroWounds > 0}
          onPress={() => setOpt({ heroWounds: opts.heroWounds > 0 ? 0 : 2 })} />
        <Chip label={t('workshop.simStepMode')} selected={stepMode}
          onPress={() => setStepMode(m => !m)} />
      </View>
      {/* Tamaños de zonas + semilla: la mitad de SimOptions existía sin UI. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={styles.miniLabel}>{t('workshop.simHand')}</Text>
        {[0, 2, 4].map(n => (
          <Chip key={n} label={String(n)} selected={opts.handSize === n}
            onPress={() => setOpt({ handSize: n })} />
        ))}
        <Text style={styles.miniLabel}>{t('workshop.simDeck')}</Text>
        {[0, 3, 8].map(n => (
          <Chip key={n} label={String(n)} selected={opts.deckSize === n}
            onPress={() => setOpt({ deckSize: n })} />
        ))}
        <Text style={styles.miniLabel}>{t('workshop.simWear')}</Text>
        {[0, 2, 5].map(n => (
          <Chip key={n} label={String(n)} selected={opts.wearSize === n}
            onPress={() => setOpt({ wearSize: n })} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.miniLabel}>{t('workshop.simSeed')}</Text>
        <NtInput label={t('workshop.simSeed')} value={opts.seed}
          onChangeText={v => setOpt({ seed: v || DEFAULT_SIM_OPTIONS.seed })}
          style={{ flex: 1, maxWidth: 220 }} />
      </View>
      {open && result && (
        <View accessibilityLiveRegion="polite">
          {!result.ok ? (
            <Text style={styles.errorText}>⛔ {t('workshop.simError')}: {result.error}</Text>
          ) : (
            <>
              {result.pendingChoice && (
                <Text style={styles.warnText}>⚠ {t('workshop.simPendingChoice')}: {result.pendingChoice}</Text>
              )}
              {result.trace.length === 0 ? (
                <Text style={styles.infoText}>{t('workshop.simNoEvents')}</Text>
              ) : stepMode ? (
                <>
                  {(stepIdx === 0 ? result.trace.slice(0, 1) : result.trace.slice(0, stepIdx + 1))
                    .map((l, i) => (
                      <Text key={i} style={l.kind === 'damage' ? styles.errorText
                        : l.kind === 'resource' ? styles.okText : styles.infoText}>
                        {i + 1}. {l.text}
                      </Text>
                    ))}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <NtButton label="◀" variant="ghost" size="sm" disabled={stepIdx <= 0}
                      accessibilityLabel={t('workshop.simStepPrev')}
                      onPress={() => setStepIdx(i => Math.max(0, i - 1))} />
                    <NtButton label="▶" variant="ghost" size="sm"
                      disabled={stepIdx >= result.trace.length - 1}
                      accessibilityLabel={t('workshop.simStepNext')}
                      onPress={() => setStepIdx(i => Math.min(result.trace.length - 1, i + 1))} />
                    <NtButton label={t('workshop.simStepAll')} variant="ghost" size="sm"
                      onPress={() => setStepIdx(result.trace.length - 1)} />
                    <Text style={styles.infoText}>
                      {t('workshop.simStepOf', { n: Math.min(stepIdx + 1, result.trace.length), total: result.trace.length })}
                    </Text>
                  </View>
                </>
              ) : (
                result.trace.map((l, i) => (
                  <Text key={i} style={l.kind === 'damage' ? styles.errorText
                    : l.kind === 'resource' ? styles.okText : styles.infoText}>
                    {i + 1}. {l.text}
                  </Text>
                ))
              )}
              {result.deltas.map((d, i) => (
                <Text key={`d${i}`} style={styles.infoText}>{d}</Text>
              ))}
              {result.enemiesDefeated > 0 && (
                <Text style={styles.okText}>{t('workshop.simDefeated', { count: result.enemiesDefeated })}</Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

