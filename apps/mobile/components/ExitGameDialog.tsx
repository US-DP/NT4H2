/**
 * ExitGameDialog — confirma salir de la partida sin perder progreso.
 *
 * Cumple UI-024: distinguir entre salir (guardar y salir) y abandonar (perder progreso).
 * Construido sobre NtDialog (sistema de componentes NT4H / Unistyles).
 */

import { View, Text, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NtDialog } from './ui/NtDialog';

interface ExitGameDialogProps {
  visible: boolean;
  hasUnsavedChanges: boolean;
  onSaveAndExit: () => void;
  onExitWithoutSaving: () => void;
  onAbandon: () => void;
  onCancel: () => void;
  /** Línea de diagnóstico opcional (modo, sala, revisión, eventos…) */
  diagnostics?: string;
}

export function ExitGameDialog({
  visible,
  hasUnsavedChanges,
  onSaveAndExit,
  onExitWithoutSaving,
  onAbandon,
  onCancel,
  diagnostics,
}: ExitGameDialogProps) {
  const { t } = useTranslation();
  const SHORTCUTS: [string, string][] = [
    ['1-5', t('panels.exitShortcutZone')],
    ['H / E / C', t('panels.exitShortcutPanels')],
    ['Esc', t('panels.exitShortcutClose')],
  ];
  return (
    <NtDialog
      visible={visible}
      title={t('panels.exitTitle')}
      description={
        hasUnsavedChanges
          ? t('panels.exitUnsaved')
          : t('panels.exitSure')
      }
      children={
        <View>
          {Platform.OS === 'web' && (
            <View accessibilityLabel={t('panels.exitShortcuts')} style={{ marginBottom: 8 }}>
              <Text style={{ color: '#a8b0bc', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                {t('panels.exitShortcuts')}
              </Text>
              {SHORTCUTS.map(([keys, desc]) => (
                <View key={keys} style={{ flexDirection: 'row', gap: 12, marginBottom: 2 }}>
                  <Text style={{ color: '#f1c40f', fontSize: 11, fontFamily: 'monospace', minWidth: 64 }}>
                    {keys}
                  </Text>
                  <Text style={{ color: '#a8b0bc', fontSize: 11 }}>{desc}</Text>
                </View>
              ))}
            </View>
          )}
          {diagnostics && (
            <Text style={{ color: '#8a8fa3', fontSize: 10, fontFamily: 'monospace' }}>
              {diagnostics}
            </Text>
          )}
        </View>
      }
      onDismiss={onCancel}
      actions={[
        ...(hasUnsavedChanges
          ? [{ label: t('panels.exitSaveAndExit'), onPress: onSaveAndExit, variant: 'primary' as const }]
          : []),
        {
          label: hasUnsavedChanges ? t('panels.exitWithoutSaving') : t('panels.exitPlain'),
          onPress: hasUnsavedChanges ? onExitWithoutSaving : onSaveAndExit,
          variant: 'secondary' as const,
          // "Salir sin guardar" descarta la partida — irreversible.
          hold: hasUnsavedChanges,
        },
        { label: t('panels.exitAbandon'), onPress: onAbandon, variant: 'danger' as const },
        { label: t('panels.cancel'), onPress: onCancel, variant: 'ghost' as const },
      ]}
    />
  );
}
