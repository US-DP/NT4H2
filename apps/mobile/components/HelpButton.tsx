/**
 * HelpButton — acceso contextual a ayuda.
 *
 * Cumple UI-223: botón de ayuda visible desde cualquier pantalla de juego/creación.
 */

import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { touchTarget, fontSize, type Colors } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';

interface HelpButtonProps {
  onPress: () => void;
}

export function HelpButton({ onPress }: HelpButtonProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={t('panels.help')}
    >
      <Text style={styles.text}>?</Text>
    </Pressable>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  button: {
    backgroundColor: c.info,
    minWidth: touchTarget,
    minHeight: touchTarget,
    borderRadius: touchTarget / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: fs(fontSize.section),
    fontWeight: 'bold',
  },
});
