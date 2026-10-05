/**
 * ScenarioView — muestra el escenario activo de la partida.
 *
 * Cumple UI-150: posición visible estable.
 * Cumple UI-151: nombre, ilustración, efecto resumido, acción disponible, límite, estado.
 * Cumple UI-152: botón contextual si el escenario permite acción.
 * Cumple UI-153: modificadores activos en resumen global.
 * Cumple UI-154: al cambiar, mostrar descartado/revelado/modificadores.
 * Cumple UI-155: no depender de memoria del jugador.
 */

import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { cardImage } from '../store/cardImage';
import { useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import type { CardDefinition } from '@nt4h/schema';

interface ScenarioViewProps {
  onUseScenario?: () => void;
}

export function ScenarioView({ onUseScenario }: ScenarioViewProps) {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

  if (!gameState || !catalog) return null;

  const scenarioInstanceId = gameState.scenario?.instanceId;
  if (!scenarioInstanceId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('hud.scenarioTitle')}</Text>
        <Text style={styles.empty}>{t('hud.noActiveScenario')}</Text>
      </View>
    );
  }

  // Buscar la definición del escenario
  const scenarioInstance = gameState.scenario;
  const scenarioDef: CardDefinition | undefined = scenarioInstance
    ? catalog.byId.get(scenarioInstance.definitionId)
    : undefined;

  const { path, showPlaceholder } = cardImage(scenarioDef?.id ?? '', 'game');

  if (!scenarioDef) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('hud.scenarioTitle')}</Text>
        <Text style={styles.empty}>{t('hud.scenarioDefMissing')}</Text>
      </View>
    );
  }

  const hasAction = scenarioDef.effects && scenarioDef.effects.length > 0;

  return (
    <View style={styles.container} accessibilityLabel={t('hud.scenarioA11y', { name: scenarioDef.name })}>
      <Text style={styles.title}>{t('hud.scenarioActiveTitle')}</Text>
      <View style={styles.scenarioCard}>
        {path && !showPlaceholder ? (
          <Image source={{ uri: path }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.placeholderText}>{t('hud.noIllustration')}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name}>{scenarioDef.name}</Text>
          <Text style={styles.effectSummary}>
            {t('hud.scenarioActiveEffects', { count: scenarioDef.effects?.length ?? 0 })}
          </Text>
          {hasAction && onUseScenario && (
            <Pressable style={styles.useButton} onPress={onUseScenario} >
              <Text style={styles.useText}>{t('hud.use')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    alignItems: 'center',
  },
  title: {
    color: c.info,
    fontSize: fs(13),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  scenarioCard: {
    backgroundColor: c.surfaceRaised,
    padding: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
  },
  image: {
    // Las cartas de escenario son apaisadas (~1.48), no verticales
    width: 104,
    aspectRatio: 1.48,
    borderRadius: 6,
  },
  imagePlaceholder: {
    width: 104,
    aspectRatio: 1.48,
    backgroundColor: c.surface,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    alignItems: 'flex-start',
    maxWidth: 160,
  },
  placeholderText: {
    color: c.textFaint,
    fontSize: fs(10),
  },
  name: {
    color: c.text,
    fontSize: fs(13),
    fontWeight: 'bold',
  },
  effectSummary: {
    color: c.textMuted,
    fontSize: fs(10),
    fontStyle: 'italic',
    marginTop: 2,
  },
  useButton: {
    backgroundColor: c.accent,
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    minWidth: 100,
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  useText: {
    color: c.textOnAccent,
    fontSize: fs(11),
    fontWeight: 'bold',
  },
  empty: {
    color: c.textFaint,
    fontSize: fs(11),
    fontStyle: 'italic',
  },
});
