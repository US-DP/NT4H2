/**
 * KeywordTooltip — explicación emergente de palabras clave.
 *
 * Cumple UI-224: al pulsar una palabra clave aparece una explicación breve.
 */

import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';

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

const styles = StyleSheet.create({
  inline: {
    alignSelf: 'flex-start',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  tooltip: {
    backgroundColor: '#1a1a2e',
    padding: 16,
    borderRadius: 8,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#f1c40f',
  },
  title: {
    color: '#f1c40f',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: '#ecf0f1',
    fontSize: 13,
  },
});
