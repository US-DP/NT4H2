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

export function PrivacyScreen() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const passPrivacy = useGameStore((s) => s.passPrivacy);
  const viewerId = useGameStore((s) => s.viewerId);

  if (!gameState || !catalog) return null;

  // Durante la puja de Líder no hay activePlayerId — el que toma el
  // dispositivo es el viewer (siguiente jugador con decisión pendiente)
  const player = gameState.players[gameState.activePlayerId]
    ?? (viewerId ? gameState.players[viewerId] : undefined);
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#f1c40f',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  subtitle: {
    color: '#bdc3c7',
    fontSize: 16,
    marginBottom: 24,
  },
  heroBadge: {
    backgroundColor: '#2c3e50',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#3498db',
  },
  heroName: {
    color: '#ecf0f1',
    fontSize: 22,
    fontWeight: 'bold',
  },
  heroClass: {
    color: '#3498db',
    fontSize: 14,
    marginTop: 4,
  },
  warning: {
    color: '#e74c3c',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#27ae60',
    padding: 16,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
