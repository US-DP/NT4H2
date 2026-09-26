/**
 * GuidedSetup — asistente interactivo de preparación (rulebook `setup-checklist`).
 *
 * El usuario elige modo y número de jugadores y obtiene una lista verificable
 * de pasos; las cantidades dependen de la configuración real del juego.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CheckCircle, Circle, RotateCcw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useColors, useFs } from '../lib/useTheme';
import { spacing, radius, fontSize } from '../lib/theme';

type SetupMode = 'BASE' | 'SOLO' | 'MULTICLASS';
type Players = 2 | 3 | 4;
type TFn = (key: string, opts?: Record<string, unknown>) => string;

const HORDE_COUNTS: Record<Players, number> = { 2: 19, 3: 23, 4: 27 };
const MODE_KEYS: Record<SetupMode, string> = {
  BASE: 'panels.setupModeStandard',
  SOLO: 'panels.setupModeSolo',
  MULTICLASS: 'panels.setupModeMulticlass',
};

function buildSteps(mode: SetupMode, players: Players, t: TFn): string[] {
  const hordes =
    mode === 'SOLO' ? 23 : HORDE_COUNTS[players];

  const steps = [
    t('panels.setupStepWarlord'),
    t('panels.setupStepHorde', { hordes }),
    t('panels.setupStepMarket'),
    ...(mode === 'SOLO'
      ? [
          t('panels.setupStepSoloHero'),
          t('panels.setupStepSoloScenarios'),
        ]
      : mode === 'MULTICLASS'
        ? [
            t('panels.setupStepMulticlassHero'),
          ]
        : [
            t('panels.setupStepBaseHero'),
          ]),
    t('panels.setupStepDraw'),
    t('panels.setupStepShields'),
    t('panels.setupStepTokens'),
    t('panels.setupStepCoins'),
  ];
  return steps;
}

export function GuidedSetup() {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  const [mode, setMode] = useState<SetupMode>('BASE');
  const [players, setPlayers] = useState<Players>(4);
  const [done, setDone] = useState<Set<number>>(new Set());

  const steps = buildSteps(mode, players, t);
  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i); else next.add(i);
    setDone(next);
  };
  const completed = [...done].filter((i) => i < steps.length).length;

  const chip = (label: string, active: boolean, onPress: () => void, accessibilityLabel?: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: c.surfaceRaised, borderColor: c.border },
        active && { backgroundColor: c.accent, borderColor: c.accent },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={{ color: active ? '#1a1a2e' : c.text, fontSize: fs(fontSize.detail), fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View>
      <Text style={[styles.label, { color: c.textMuted, fontSize: fs(fontSize.detail) }]}>{t('panels.setupMode')}</Text>
      <View style={styles.row}>
        {(['BASE', 'SOLO', 'MULTICLASS'] as SetupMode[]).map((m) =>
          chip(t(MODE_KEYS[m]), mode === m, () => { setMode(m); setDone(new Set()); }))
        }
      </View>

      {mode !== 'SOLO' && (
        <>
          <Text style={[styles.label, { color: c.textMuted, fontSize: fs(fontSize.detail) }]}>{t('panels.setupPlayers')}</Text>
          <View style={styles.row}>
            {([2, 3, 4] as Players[]).map((p) =>
              chip(`${p}`, players === p, () => { setPlayers(p); setDone(new Set()); }))
            }
          </View>
        </>
      )}

      <View style={styles.progressRow}>
        <Text style={{ color: c.accent, fontSize: fs(fontSize.detail), fontWeight: '700' }}>
          {t('panels.setupProgress', { done: completed, total: steps.length })}
        </Text>
        <Pressable
          onPress={() => setDone(new Set())}
          style={styles.reset}
          accessibilityRole="button"
          accessibilityLabel={t('panels.setupResetA11y')}
        >
          <RotateCcw size={12} color={c.textMuted} />
          <Text style={{ color: c.textMuted, fontSize: fs(fontSize.micro) }}>{t('panels.setupReset')}</Text>
        </Pressable>
      </View>

      {steps.map((s, i) => (
        <Pressable
          key={i}
          onPress={() => toggle(i)}
          style={styles.stepRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done.has(i) }}
          accessibilityLabel={t('panels.setupStepA11y', { n: i + 1, step: s })}
        >
          {done.has(i)
            ? <CheckCircle size={18} color={c.success} />
            : <Circle size={18} color={c.textFaint} />}
          <Text style={{
            color: done.has(i) ? c.textFaint : c.text,
            fontSize: fs(fontSize.detail),
            flex: 1,
            textDecorationLine: done.has(i) ? 'line-through' : 'none',
          }}>
            {s}
          </Text>
        </Pressable>
      ))}

      <Text style={{ color: c.textMuted, fontSize: fs(fontSize.micro), fontStyle: 'italic', marginTop: spacing.md }}>
        {t('panels.setupAutoNote')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontWeight: '700',
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.xs,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 7,
    minHeight: 40,
  },
});


