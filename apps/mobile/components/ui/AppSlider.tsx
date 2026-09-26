/**
 * AppSlider (nativo) — envuelve @react-native-community/slider.
 * La variante web (AppSlider.web.tsx) implementa un slider accesible propio.
 */

import Slider from '@react-native-community/slider';
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
  minimumTrackTintColor,
  maximumTrackTintColor,
  style,
  accessibilityLabel,
  accessibilityValueText,
}: AppSliderProps) {
  return (
    <Slider
      style={style}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      value={value}
      onSlidingComplete={onValueChange}
      minimumTrackTintColor={minimumTrackTintColor}
      maximumTrackTintColor={maximumTrackTintColor}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: accessibilityValueText }}
    />
  );
}
