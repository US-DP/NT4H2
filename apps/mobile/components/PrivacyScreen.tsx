/**
 * PrivacyScreen — pantalla de privacidad para modo hot-seat.
 *
 * En hot-seat, al cambiar de jugador activo, se muestra esta pantalla
 * para que el nuevo jugador tome el dispositivo sin ver la mano del anterior.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { useColors, useFs } from '../lib/useTheme';
import type { Colors } from '../lib/theme';

export function PrivacyScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const fs = useFs();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(c, fs);
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const passPrivacy = useGameStore((s) => s.passPrivacy);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState || !catalog) return null;

  // El que toma el dispositivo es el VIEWER actual (siguiente jugador con
  // decisión o turno): un hand-over por pendingChoice ajena (M-6) pone
  // viewerId al decisor — si se etiquetara por activePlayerId la pantalla
  // pediría pasar el dispositivo al jugador equivocado.
  const player = (viewerId ? gameState.players[viewerId] : undefined)
    ?? gameState.players[gameState.activePlayerId];
  const heroDef = player ? catalog.byId.get(player.heroId) : undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('common.privacy.passDevice')}</Text>
      <Text style={styles.subtitle}>{t('common.privacy.turnOf')}</Text>
      <View style={styles.heroBadge}>
        <Text style={styles.heroName}>{heroDef?.name ?? t('common.privacy.nextPlayer')}</Text>
        {heroDef?.heroClass && <Text style={styles.heroClass}>{heroDef.heroClass}</Text>}
      </View>
      <Text style={styles.warning}>
        {t('common.privacy.warning')}
      </Text>
      <Pressable style={styles.button} onPress={passPrivacy}>
        <Text style={styles.buttonText}>{t('common.privacy.ready')}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: c.background,
  },
  title: {
    color: c.accent,
    fontSize: fs(28),
    fontWeight: 'bold',
    marginBottom: 16,
  },
  subtitle: {
    color: c.textMuted,
    fontSize: fs(16),
    marginBottom: 24,
  },
  heroBadge: {
    backgroundColor: c.surface,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: c.info,
  },
  heroName: {
    color: c.text,
    fontSize: fs(22),
    fontWeight: 'bold',
  },
  heroClass: {
    color: c.info,
    fontSize: fs(14),
    marginTop: 4,
  },
  warning: {
    color: c.danger,
    fontSize: fs(12),
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    backgroundColor: c.success,
    padding: 16,
    borderRadius: 8,
    minWidth: 200,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: c.text,
    fontSize: fs(16),
    fontWeight: 'bold',
  },
});
