/**
 * AppSlider (web) — slider accesible sin dependencias nativas.
 *
 * Toca la pista para fijar el valor; los botones −/+ ajustan en pasos
 * (también sirven de alternativa de teclado, WCAG 2.1.1).
 */

import { View, Pressable, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export interface AppSliderProps {
  value: number;
  onValueChange: (v: number) => void;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityValueText?: string;
}

export function AppSlider({
  value,
  onValueChange,
  minimumValue = 0,
  maximumValue = 100,
  step = 5,
  minimumTrackTintColor = '#f1c40f',
  maximumTrackTintColor = '#2e2e4a',
  style,
  accessibilityLabel,
  accessibilityValueText,
}: AppSliderProps) {
  const clamp = (v: number) => Math.min(maximumValue, Math.max(minimumValue, v));
  const range = maximumValue - minimumValue;
  const pct = range > 0 ? ((value - minimumValue) / range) * 100 : 0;

  return (
    <View style={[styles.row, style]}>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onValueChange(clamp(value - step))}
        accessibilityRole="button"
        accessibilityLabel={`Reducir ${accessibilityLabel ?? 'valor'}`}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Pressable
        style={[styles.track, { backgroundColor: maximumTrackTintColor }]}
        onPress={(e) => {
          // Posición del toque sobre la pista → valor
          const target = e.target as unknown as HTMLElement;
          const rect = target.getBoundingClientRect();
          const x = (e.nativeEvent as unknown as { clientX: number }).clientX;
          const ratio = rect.width > 0 ? (x - rect.left) / rect.width : 0;
          const raw = minimumValue + ratio * range;
          onValueChange(clamp(Math.round(raw / step) * step));
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: accessibilityValueText }}
      >
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: minimumTrackTintColor }]} />
        <View style={[styles.thumb, { left: `${pct}%` }]} />
      </Pressable>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onValueChange(clamp(value + step))}
        accessibilityRole="button"
        accessibilityLabel={`Aumentar ${accessibilityLabel ?? 'valor'}`}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  track: { flex: 1, height: 6, borderRadius: 3, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginLeft: -8,
    top: -5,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#232340',
  },
  stepText: { color: '#f0f2f5', fontSize: 18, fontWeight: 'bold' },
});
