/**
 * HelpButton — acceso contextual a ayuda.
 *
 * Cumple UI-223: botón de ayuda visible desde cualquier pantalla de juego/creación.
 */

import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

interface HelpButtonProps {
  onPress: () => void;
}

export function HelpButton({ onPress }: HelpButtonProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={t('panels.help')}
    >
      <Text style={styles.text}>?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#2980b9',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
