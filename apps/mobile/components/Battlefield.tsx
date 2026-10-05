/**
 * Battlefield — muestra los enemigos en el campo de batalla.
 *
 * Cumple UI-GAME-004: Huestes se muestran con PNG frontal.
 * Cumple UI-GAME-006: Señores de la Guerra con tratamiento diferenciado.
 * Cumple UI-090: zona central claramente separada.
 * Cumple UI-091: nombre, fortaleza efectiva, heridas acumuladas, resistencia restante, estados, modificadores, jefe.
 * Cumple UI-092: si Fortaleza modificada, mostrar base → efectivo.
 * Cumple UI-093: Heridas numéricamente.
 * Cumple UI-094: contribución prevista al ataque de la Horda (daño aportado).
 * Cumple UI-095: enemigos válidos como objetivo destacados.
 * Cumple UI-096: enemigos inválidos atenuados.
 * Cumple UI-097: al pulsar, mostrar efectos completos.
 * Cumple UI-098: recompensa oculta hasta derrota.
 * Cumple UI-099: no incluir recompensa en estado accesible.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming, Easing, FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import '../lib/i18n';
import { useGameStore } from '../store/gameStore';
import { useSettingsSafe, useColors, useFs } from '../lib/useTheme';
import { touchTarget } from '../lib/theme';
import type { Colors } from '../lib/theme';
import { Crosshair } from 'lucide-react-native';
import { CardView } from './CardView';
import { getCardTargeting, isValidEnemyTarget } from '../lib/targeting';
import { getEffectiveFortitude } from '@nt4h/engine';
import type { EnemyState } from '@nt4h/schema';

/** Halo sobre un objetivo válido: dos pulsos breves y luego borde
 *  estable — llamar la atención sin una animación infinita.
 *  Con reducir movimiento: borde estático, sin animación. */
function TargetPulse() {
  const reduceMotion = useSettingsSafe((s) => s.reduceMotion);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);
  const opacity = useSharedValue(0.4);
  if (!reduceMotion) {
    opacity.value = withSequence(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.85, { duration: 300 }),
    );
  } else {
    opacity.value = 0.85;
  }
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.targetPulse, style, { borderColor: c.success ?? c.accent }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Icono de objetivo: el pulso no depende solo de color/animación */}
      <Crosshair size={22} color={c.accent} />
    </Animated.View>
  );
}

export function Battlefield() {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const catalog = useGameStore((s) => s.catalog);
  const selectedEnemy = useGameStore((s) => s.ui.selectedEnemyInstanceId);
  const selectEnemy = useGameStore((s) => s.selectEnemy);
  const setMessage = useGameStore((s) => s.setMessage);
  const selectedCard = useGameStore((s) => s.ui.selectedCardInstanceId);
  const viewerId = useGameStore((s) => s.viewerId);
  const reduceMotion = useSettingsSafe((s) => s.reduceMotion);
  const autoPlayAnimations = useSettingsSafe((s) => s.autoPlayAnimations);
  const c = useColors();
  const fs = useFs();
  const styles = createStyles(c, fs);

  if (!gameState || !catalog) return null;

  // ¿La carta seleccionada necesita elegir enemigo? Derivar el requisito
  // de sus efectos (con filtros), no asumir que todo enemigo vale.
  const playerId = viewerId ?? gameState.activePlayerId;
  const selectedInstance = selectedCard
    ? gameState.players[playerId]?.hand.find(c => c.instanceId === selectedCard)
    : undefined;
  const selectedDef = selectedInstance
    ? catalog.byId.get(selectedInstance.definitionId)
    : undefined;
  const targeting = getCardTargeting(selectedDef);
  const pickingEnemy = targeting.mode === 'enemy';

  const handleEnemyPress = (enemy: EnemyState, isDefeated: boolean) => {
    if (isDefeated) return;
    if (pickingEnemy) {
      const check = isValidEnemyTarget(targeting, enemy, gameState);
      if (!check.ok) {
        const name = catalog.byId.get(enemy.definitionId)?.name ?? t('hud.enemyThis');
        setMessage?.(t('hud.targetError', { name, reason: check.reason ?? '' }));
        return;
      }
      // Elegir/deselegir objetivo — la carta se confirma en HandView
      selectEnemy(enemy.instanceId === selectedEnemy ? null : enemy.instanceId);
    } else {
      selectEnemy(enemy.instanceId === selectedEnemy ? null : enemy.instanceId);
    }
  };

  // Daño aportado por la Horda este turno (UI-094, spec 3.4):
  // Σ máx(0, fortaleza efectiva − heridas) de enemigos que dañan.
  const hordeDamageContribution = gameState.battlefield
    .filter((e) => !e.damageDisabled)
    .reduce(
      (sum, e) => sum + Math.max(0, getEffectiveFortitude(e, gameState) - e.wounds),
      0,
    );

  return (
    <View style={styles.container} accessibilityLabel={t('hud.battlefieldA11y', { count: gameState.battlefield.length })}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('hud.battlefieldTitle', { count: gameState.battlefield.length })}</Text>
        <Text style={styles.hordeDamage}>{t('hud.damageContributed', { count: hordeDamageContribution })}</Text>
      </View>
      {pickingEnemy && (
        <Text style={styles.pickingHint} accessibilityLiveRegion="polite">
          🎯 {targeting.description}
        </Text>
      )}
      <View style={styles.enemies}>
        {gameState.battlefield.map((enemy: EnemyState) => {
          const enemyDef = catalog.byId.get(enemy.definitionId);
          const baseFortitude = enemy.baseFortitude;
          const effectiveFortitude = getEffectiveFortitude(enemy, gameState);
          const wounds = enemy.wounds;
          const isDefeated = wounds >= effectiveFortitude;
          const isSelected = selectedEnemy === enemy.instanceId;
          // Solo destacar como objetivo si la carta lo admite (filtros incluidos)
          const targetCheck = pickingEnemy && !isDefeated
            ? isValidEnemyTarget(targeting, enemy, gameState)
            : { ok: false };
          const isValidTarget = targetCheck.ok;

          return (
            <Animated.View
              key={enemy.instanceId}
              style={styles.enemyWrapper}
              // Entrada al campo: fundido breve al aparecer el enemigo
              // (feedback de jugada); desactivado con reducir movimiento
              entering={reduceMotion || !autoPlayAnimations ? undefined : FadeIn.duration(320)}
            >
              {isValidTarget && <TargetPulse />}
              {enemyDef ? (
                <CardView
                  card={enemyDef}
                  onPress={() => handleEnemyPress(enemy, isDefeated)}
                  selected={isSelected}
                  validTarget={isValidTarget}
                  blocked={isDefeated || (pickingEnemy && !isValidTarget)}
                  blockedReason={isDefeated ? t('hud.defeated') : (pickingEnemy && !isValidTarget ? targetCheck.reason : undefined)}
                  compact
                />
              ) : (
                <Pressable
                  onPress={() => handleEnemyPress(enemy, isDefeated)}
                  style={[
                    styles.enemyFallback,
                    isSelected && styles.selected,
                    isDefeated && styles.defeated,
                    enemy.isWarlord && styles.warlord,
                  ]}
                >
                  <Text style={styles.enemyName}>???</Text>
                </Pressable>
              )}

              {/* Capas dinámicas (UI-PNG-020): info fuera del PNG */}
              <View style={styles.enemyInfo}>
                <Text style={styles.enemyName}>{enemyDef?.name ?? '???'}</Text>
                <Text style={styles.fortitude}>
                  {t('hud.enemyStat', { fortitude: effectiveFortitude, wounds })}
                  {effectiveFortitude !== baseFortitude && t('hud.enemyStatBase', { base: baseFortitude })}
                </Text>
                <Text style={styles.resistance}>
                  {t('hud.resistance', { count: Math.max(0, effectiveFortitude - wounds) })}
                </Text>
                {enemy.isWarlord && <Text style={styles.warlordBadge}>{t('hud.warlordBadge')}</Text>}
                {enemy.damageDisabled && <Text style={styles.disabled}>{t('hud.noDamage')}</Text>}
                {enemy.specialIcons?.includes('ANTI_MAGIC') && (
                  <Text style={styles.iconBadge}>
                    {t('hud.antiMagic', { value: enemyDef?.antiMagicValue ?? 1 })}
                  </Text>
                )}
                {enemy.specialIcons?.includes('TEMPORARY_WOUNDS') && (
                  <Text style={styles.iconBadge}>{t('hud.tempWounds')}</Text>
                )}
                {enemy.specialIcons?.includes('IMPROVED_LOOT') && (
                  <Text style={styles.iconBadge}>{t('hud.improvedLoot')}</Text>
                )}
                {(enemy.statuses ?? []).length > 0 && (
                  <Text style={styles.iconBadge}>
                    {t('hud.statusesList', {
                      list: (enemy.statuses ?? [])
                        .map((s) => `${s.id}${s.stacks > 1 ? ` ×${s.stacks}` : ''}`)
                        .join(', '),
                    })}
                  </Text>
                )}
                {enemy.modifiers.length > 0 && (
                  <Text style={styles.modifiers}>
                    {t('hud.modifiersList', {
                      list: enemy.modifiers
                        .map((m) => `${t(`hud.layer.${m.layer}`)} ${m.amount}`)
                        .join(', '),
                    })}
                  </Text>
                )}
              </View>
            </Animated.View>
          );
        })}
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: c.text,
    fontSize: fs(14),
    fontWeight: 'bold',
  },
  hordeDamage: {
    color: c.gameDamage,
    fontSize: fs(12),
    fontWeight: 'bold',
  },
  pickingHint: {
    color: c.accent,
    fontSize: fs(11),
    marginBottom: 6,
    fontWeight: 'bold',
  },
  enemies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  enemyWrapper: {
    alignItems: 'center',
    maxWidth: 160,
  },
  targetPulse: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 10,
    borderWidth: 2,
    // borderColor se fija por tema en el componente (era '#2ecc71' fijo)
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    pointerEvents: 'none',
  },
  enemyFallback: {
    backgroundColor: c.surface,
    padding: 8,
    borderRadius: 6,
    minWidth: 100,
    minHeight: touchTarget,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.border,
  },
  selected: {
    borderColor: c.danger,
    borderWidth: 3,
  },
  defeated: {
    opacity: 0.4,
  },
  warlord: {
    backgroundColor: c.dangerSurface,
    borderColor: c.dangerPressed,
  },
  enemyInfo: {
    alignItems: 'center',
    marginTop: 2,
  },
  enemyName: {
    color: c.text,
    fontSize: fs(12),
    fontWeight: 'bold',
    textAlign: 'center',
  },
  fortitude: {
    color: c.textMuted,
    fontSize: fs(11),
  },
  wounds: {
    color: c.gameDamage,
    fontSize: fs(11),
  },
  resistance: {
    color: c.gameShield,
    fontSize: fs(10),
  },
  warlordBadge: {
    color: c.accent,
    fontSize: fs(10),
    fontWeight: 'bold',
    marginTop: 2,
  },
  disabled: {
    color: c.info,
    fontSize: fs(10),
    marginTop: 2,
  },
  iconBadge: {
    color: c.info,
    fontSize: fs(10),
    marginTop: 2,
    fontStyle: 'italic',
  },
  modifiers: {
    color: c.textMuted,
    fontSize: fs(9),
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 2,
  },
});
