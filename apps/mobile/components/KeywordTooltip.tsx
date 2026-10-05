/**
 * KeywordTooltip — explicación emergente de palabras clave.
 *
 * Cumple UI-224: al pulsar una palabra clave aparece una explicación breve.
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

interface KeywordTooltipProps {
  keyword: string;
  description: string;
  children: React.ReactNode;
  /** Controlado desde el exterior */
  visible?: boolean;
  onToggle?: (visible: boolean) => void;
}

export function KeywordTooltip({ keyword, description, children, visible = false, onToggle }: KeywordTooltipProps) {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  return (
    <View style={styles.inline}>
      <Pressable onPress={() => onToggle?.(!visible)} accessibilityLabel={t('panels.keywordA11y', { keyword })}>
        {children}
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onToggle?.(false)}>
        <Pressable style={styles.overlay} onPress={() => onToggle?.(false)}>
          <View style={styles.tooltip}>
            <Text style={styles.title}>{keyword}</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  inline: {
    alignSelf: 'flex-start',
  },
  overlay: {
    flex: 1,
    backgroundColor: c.overlayScrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  tooltip: {
    backgroundColor: c.surface,
    padding: 16,
    borderRadius: 8,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: c.accent,
  },
  title: {
    color: c.accent,
    fontSize: fs(16),
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: c.text,
    fontSize: fs(13),
  },
});
