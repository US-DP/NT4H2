/**
 * GameStatusPanel — vista dedicada a todos los modificadores y reglas
 * temporales activas de la partida.
 *
 * Evita llenar el tablero de insignias y tooltips: el estado global
 * (héroe activo, Horda, escenario, decisiones pendientes) se consulta aquí.
 *
 * Usable como pestaña "Estado" en la mesa (móvil) y en el panel lateral
 * (escritorio).
 */

import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import type { Modifier } from '@nt4h/schema';
import { fontSize, spacing } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';
import { capListLabel } from '../lib/capabilities';

export function GameStatusPanel() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const colors = useColors();
  const fs = useFs();

  if (!gameState) return null;

  const sourceName = (sourceId: string) =>
    catalog?.byId.get(sourceId)?.name ?? sourceId;

  const activePlayer = gameState.players[gameState.activePlayerId];
  // Oyentes del Taller que escucha el héroe activo (REGISTER_LISTENER)
  const activeListeners = (gameState.listeners ?? [])
    .filter(l => l.playerId === gameState.activePlayerId);

  const renderModifier = (m: Modifier) => (
    <View key={m.id} style={[styles.modRow, { borderColor: colors.border }]}>
      <Text style={{ color: colors.text, fontSize: fs(fontSize.detail), flex: 1 }}>
        {t(`hud.layer.${m.layer}`)} {m.amount >= 0 ? '+' : ''}{m.amount}
      </Text>
      <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro) }}>
        {sourceName(m.sourceId)} · {t(`hud.duration.${m.duration}`)}
      </Text>
    </View>
  );

  const globalRules: string[] = [];
  // (orcFortitudeBonus eliminado del schema: ningún productor lo ponía
  //  distinto de 0 — el bonus de Roghkiller viaja como Modifier real y
  //  ya se lista en la sección de modificadores de arriba).
  if (gameState.marketCostModifier !== 0)
    globalRules.push(t('hud.ruleMarketCost', {
      value: `${gameState.marketCostModifier >= 0 ? '+' : ''}${gameState.marketCostModifier}`,
    }));
  if (gameState.ignoreGloryRewards) globalRules.push(t('hud.ruleNoGlory'));
  if (gameState.ignoreCoinRewards) globalRules.push(t('hud.ruleNoCoins'));
  if (gameState.warlordRevealed && !gameState.warlordDefeated)
    globalRules.push(t('hud.ruleWarlordInPlay'));
  if (gameState.warlordsDefeatedCount > 0)
    globalRules.push(t('hud.ruleWarlordsDefeated', { count: gameState.warlordsDefeatedCount }));
  const disabledEnemies = gameState.battlefield.filter((e) => e.damageDisabled).length;
  if (disabledEnemies > 0)
    globalRules.push(t('hud.ruleDisabledEnemies', { count: disabledEnemies }));

  const scenarioDef = gameState.scenario
    ? catalog?.byId.get(gameState.scenario.definitionId)
    : undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Héroe activo */}
      {activePlayer && (
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
            {t('hud.sectionActiveHero')}
          </Text>
          <Text style={{ color: colors.text, fontSize: fs(fontSize.body), fontWeight: '700' }}>
            {catalog?.byId.get(activePlayer.heroId)?.name ?? activePlayer.heroId}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
            {t('hud.heroWounds', { wounds: activePlayer.wounds, max: activePlayer.maxWounds })}
            {activePlayer.shields > 0 ? t('hud.heroShieldsSuffix', { count: activePlayer.shields }) : ''}
            {activePlayer.prevention > 0 ? t('hud.heroPreventionSuffix', { count: activePlayer.prevention }) : ''}
            {(activePlayer.blockNext ?? 0) > 0 ? t('hud.heroBlockSuffix', { count: activePlayer.blockNext }) : ''}
            {(activePlayer.armor ?? 0) > 0 ? t('hud.heroArmorSuffix', { count: activePlayer.armor }) : ''}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
            {t('hud.heroAbilityUses', {
              remaining: activePlayer.heroUsesRemaining,
              max: activePlayer.heroMaxUses,
            })}
            {activePlayer.evasionTokenUsed ? t('hud.heroEvasionUsed') : ''}
            {activePlayer.damageCancellation ? t('hud.heroCancelActive') : ''}
          </Text>
          {activePlayer.capabilities.length > 0 && (
            <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro) }}>
              {t('hud.capabilitiesLabel', { list: capListLabel(t, activePlayer.capabilities) })}
            </Text>
          )}
          {activeListeners.length > 0 && (
            <Text style={{ color: colors.info, fontSize: fs(fontSize.detail) }}>
              {t('hud.listenersActive', {
                count: activeListeners.length,
                list: activeListeners.map(l => l.trigger).join(', '),
              })}
            </Text>
          )}
          {activePlayer.interceptedBy && (
            <Text style={{ color: colors.info, fontSize: fs(fontSize.detail) }}>
              {t('hud.interceptedBy', {
                name: gameState.players[activePlayer.interceptedBy]
                  ? (catalog?.byId.get(gameState.players[activePlayer.interceptedBy].heroId)?.name
                      ?? activePlayer.interceptedBy)
                  : activePlayer.interceptedBy,
              })}
            </Text>
          )}
          {activePlayer.modifiers.map(renderModifier)}
          {activePlayer.modifiers.length === 0 && (
            <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro), fontStyle: 'italic' }}>
              {t('hud.noActiveEffects')}
            </Text>
          )}
        </View>
      )}

      {/* Reglas temporales / Horda */}
      <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
          {t('hud.sectionHordeRules')}
        </Text>
        {globalRules.length === 0 ? (
          <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro), fontStyle: 'italic' }}>
            {t('hud.noGlobalModifiers')}
          </Text>
        ) : (
          globalRules.map((r) => (
            <Text key={r} style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
              • {r}
            </Text>
          ))
        )}
      </View>

      {/* Escenario */}
      <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
          {t('hud.sectionScenario')}
        </Text>
        {scenarioDef ? (
          <>
            <Text style={{ color: colors.text, fontSize: fs(fontSize.body) }}>{scenarioDef.name}</Text>
            <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
              {t('hud.scenarioEffects', { count: scenarioDef.effects?.length ?? 0 })}
              {gameState.scenarioCoins > 0 ? t('hud.scenarioCoinsSuffix', { count: gameState.scenarioCoins }) : ''}
            </Text>
          </>
        ) : (
          <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro), fontStyle: 'italic' }}>
            {t('hud.noScenario')}
          </Text>
        )}
      </View>

      {/* Modificadores de enemigos */}
      {gameState.battlefield.some((e) => e.modifiers.length > 0) && (
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
            {t('hud.sectionEnemies')}
          </Text>
          {gameState.battlefield
            .filter((e) => e.modifiers.length > 0)
            .map((e) => (
              <View key={e.instanceId} style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: colors.text, fontSize: fs(fontSize.detail), fontWeight: '600' }}>
                  {catalog?.byId.get(e.definitionId)?.name ?? e.definitionId}
                </Text>
                {e.modifiers.map(renderModifier)}
              </View>
            ))}
        </View>
      )}

      {/* Variables de partida (SET_VARIABLE scope GAME, Taller) */}
      {gameState.customVars && Object.keys(gameState.customVars).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
            {t('hud.sectionVars')}
          </Text>
          {Object.entries(gameState.customVars).map(([name, value]) => (
            <Text key={name} style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
              • {name} = {value}
            </Text>
          ))}
        </View>
      )}

      {/* Decisiones pendientes */}
      {gameState.pendingChoices.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.accent, fontSize: fs(fontSize.detail) }]}>
            {t('hud.sectionPending')}
          </Text>
          {gameState.pendingChoices.map((c) => (
            <Text key={c.choiceId} style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
              • {c.prompt || c.type} — {c.playerId}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  section: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  heading: {
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modRow: {
    borderLeftWidth: 2,
    paddingLeft: spacing.sm,
    paddingVertical: 2,
    gap: 1,
  },
});
