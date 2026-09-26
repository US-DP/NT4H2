/**
 * GameHeader — cabecera persistente de la mesa de juego.
 *
 * Logo | chip turno/fase | píldora de turno | estado de conexión | Salir.
 * Los colores son reactivos (alto contraste / daltonismo) via useColors.
 */

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Menu } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import '../../lib/i18n';
import { Button } from '../ui/Button';
import { ConnectionStatus, type ConnectionState } from '../ConnectionStatus';
import { useColors } from '../../lib/useTheme';
import type { Colors } from '../../lib/theme';

interface GameHeaderProps {
  turnNumber: number;
  /** Etiqueta ya traducida de la fase actual */
  phaseLabel: string;
  isMyTurn: boolean;
  /** Nombre del héroe en turno (para "Turno de X") */
  activeHeroName: string;
  /** Espectador online: la píldora muestra "Espectando" */
  isSpectator?: boolean;
  /** Segundos transcurridos del turno actual (reloj anti-AFK) */
  turnSeconds?: number;
  connectionState: ConnectionState;
  onExit: () => void;
  /** Rewind local (estilo Tabletop Playground): deshace el último comando.
   *  Solo se muestra en partidas locales con historial. */
  onUndo?: () => void;
  canUndo?: boolean;
  /** Estrecho: el botón Salir pasa a ser ☰ Pausa (abre el diálogo con
   *  guardar/salir — agrupa acciones de pausa en un menú). */
  compact?: boolean;
}

export function GameHeader({
  turnNumber,
  phaseLabel,
  isMyTurn,
  activeHeroName,
  isSpectator = false,
  turnSeconds,
  connectionState,
  onExit,
  onUndo,
  canUndo = false,
  compact = false,
}: GameHeaderProps) {
  const { t } = useTranslation();
  const colors = useColors();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(colors);

  return (
    <View style={styles.topBar}>
      <Text style={styles.topLogo} accessibilityLabel="No Time for Heroes">⚔ NT4H</Text>
      <View style={styles.topCenter}>
        <View style={styles.turnChip}>
          <Text style={styles.turnChipText}>
            {t('hud.turnChip', { number: turnNumber, phase: phaseLabel })}
          </Text>
        </View>
        <View style={[styles.turnPill, (!isMyTurn || isSpectator) && styles.turnPillOther]}>
          <Text style={[styles.turnPillText, (!isMyTurn || isSpectator) && styles.turnPillTextOther]}>
            {isSpectator ? t('hud.spectating') : isMyTurn ? t('hud.yourTurn') : t('hud.turnOf', { name: activeHeroName })}
          </Text>
        </View>
        {/* Reloj de turno: anti-AFK visible para todos (ámbar 90s, rojo 180s) */}
        {typeof turnSeconds === 'number' && (
          <Text
            style={[
              styles.turnClock,
              { color: turnSeconds >= 180 ? colors.danger : turnSeconds >= 90 ? colors.warning : colors.textMuted },
            ]}
            accessibilityLabel={t('hud.turnClockA11y', {
              time: `${Math.floor(turnSeconds / 60)}:${String(turnSeconds % 60).padStart(2, '0')}`,
            })}
          >
            ⏱ {Math.floor(turnSeconds / 60)}:{String(turnSeconds % 60).padStart(2, '0')}
          </Text>
        )}
        <ConnectionStatus state={connectionState} />
      </View>
      <View style={styles.topRight}>
        {onUndo && canUndo && (
          <Button
            variant="secondary"
            label={t('gm.undo')}
            onPress={onUndo}
            accessibilityLabel={t('gm.undoA11y')}
          />
        )}
        {compact ? (
          <Pressable
            onPress={onExit}
            style={styles.pauseBtn}
            accessibilityRole="button"
            accessibilityLabel={t('hud.pauseA11y')}
          >
            <Menu size={22} color={colors.text} />
          </Pressable>
        ) : (
          <Button variant="danger" label={t('hud.exit')} onPress={onExit} />
        )}
      </View>
    </View>
  );
}

const createStyles = (c: Colors) => StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  topLogo: {
    color: c.accent,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  topCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  turnChip: {
    backgroundColor: c.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: c.border,
  },
  turnChipText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600',
  },
  turnPill: {
    backgroundColor: c.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  turnPillOther: {
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: c.border,
  },
  turnPillText: {
    color: c.textOnAccent,
    fontSize: 13,
    fontWeight: '800',
  },
  turnPillTextOther: {
    color: c.textMuted,
  },
  turnClock: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pauseBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
});
