/**
 * ContextBanner — zona de avisos contextuales sobre la mesa.
 *
 * Antes había hasta 4 bandas apiladas (sala online, mensaje, instrucción,
 * previsión de la Horda) compitiendo por atención. Ahora se muestra la
 * de mayor prioridad (Horda > mensaje > instrucción > sala) y el resto
 * queda accesible tras "N avisos más" — nunca oculta información,
 * solo la ordena.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import '../../lib/i18n';
import { useColors } from '../../lib/useTheme';
import type { Colors } from '../../lib/theme';

interface ContextBannerProps {
  /** Desgaste previsto de la Horda (max prioridad) */
  horde?: {
    incoming: number;
    shields: number;
    /** Bloqueo armado del héroe (BLOCK_NEXT_DAMAGE) — se consume en el asalto */
    block?: number;
    afterDefense: number;
    /** true si agotará el mazo (reconstruir = 1 herida) */
    willExhaust: boolean;
    /** Botón "Ver desglose" durante HORDE_ATTACK */
    onShowBreakdown?: () => void;
  } | null;
  /** Mensaje efímero del store (acción inválida, confirmaciones…) */
  message?: string | null;
  /** Instrucción concreta de la fase (UI-073) */
  instruction?: string | null;
  /** Etiqueta de sala online (min prioridad — informativa) */
  onlineRoomId?: string | null;
}

export function ContextBanner({ horde, message, instruction, onlineRoomId }: ContextBannerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  // Sin useMemo: el renderer ligero de tests invoca los componentes
  // directamente y los hooks de React lanzan fuera de un render real.
  const styles = createStyles(colors);
  const [expanded, setExpanded] = useState(false);

  // Construir la lista ordenada por prioridad.
  const banners: { key: string; node: React.ReactNode }[] = [];

  if (horde && horde.incoming > 0) {
    banners.push({
      key: 'horde',
      node: (
        <View style={styles.hordePreview} accessibilityRole="alert">
          <Text style={styles.hordePreviewText}>
            {t('hud.hordeWearForecast', { count: horde.incoming })}
            {horde.shields > 0 && t('hud.hordeShields', { count: horde.shields })}
            {(horde.block ?? 0) > 0 && t('hud.hordeBlock', { count: horde.block })}
            {t('hud.hordeAfter', { count: horde.afterDefense })}
          </Text>
          {horde.onShowBreakdown && (
            <Pressable
              onPress={horde.onShowBreakdown}
              accessibilityRole="button"
              accessibilityLabel={t('hud.showBreakdownA11y')}
              style={styles.hordeBreakdownBtn}
            >
              <Text style={styles.hordeBreakdownBtnText}>{t('hud.showBreakdown')}</Text>
            </Pressable>
          )}
          {horde.willExhaust && (
            <Text style={styles.hordePreviewWarn}>
              {t('hud.hordeExhaustWarn')}
            </Text>
          )}
        </View>
      ),
    });
  }

  if (message) {
    banners.push({
      key: 'message',
      node: (
        <View style={styles.messageBar}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      ),
    });
  }

  if (instruction) {
    banners.push({
      key: 'instruction',
      node: (
        <Text style={styles.instruction} accessibilityRole="alert">
          {instruction}
        </Text>
      ),
    });
  }

  if (onlineRoomId) {
    banners.push({
      key: 'room',
      node: (
        <View style={styles.onlineBadge}>
          <Text style={styles.onlineText}>{t('hud.onlineRoom', { room: onlineRoomId })}</Text>
        </View>
      ),
    });
  }

  if (banners.length === 0) return null;

  const hidden = banners.length - 1;
  return (
    <View>
      {expanded ? banners.map((b) => <View key={b.key}>{b.node}</View>) : banners[0].node}
      {!expanded && hidden > 0 && (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={t('hud.moreBannersA11y', { count: hidden })}
          style={styles.moreRow}
        >
          <Text style={styles.moreText}>
            {t('hud.moreBanners', { count: hidden })}
          </Text>
        </Pressable>
      )}
      {expanded && hidden > 0 && (
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel={t('hud.hideBannersA11y')}
          style={styles.moreRow}
        >
          <Text style={styles.moreText}>{t('hud.showMainOnly')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (c: Colors) => StyleSheet.create({
  hordePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: c.dangerSurface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  hordePreviewText: {
    color: c.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  hordeBreakdownBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.danger,
    backgroundColor: c.surfaceRaised,
  },
  hordeBreakdownBtnText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
  },
  hordePreviewWarn: {
    color: c.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  messageBar: {
    backgroundColor: c.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    alignItems: 'center',
  },
  messageText: {
    color: c.text,
    fontSize: 13,
  },
  instruction: {
    color: c.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  onlineBadge: {
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: c.surface,
  },
  onlineText: {
    color: c.textMuted,
    fontSize: 11,
  },
  moreRow: {
    alignItems: 'center',
    paddingVertical: 3,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  moreText: {
    color: c.textFaint,
    fontSize: 10,
    fontWeight: '600',
  },
});
