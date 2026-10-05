/**
 * Estilos de la pantalla de partida. Extraido de app/(game)/index.tsx.
 */

import { StyleSheet } from 'react-native';
import { spacing, type Colors } from '../../../lib/theme';

export const createStyles = (c: Colors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  afkSkip: {
    alignSelf: 'center',
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.warning,
    backgroundColor: 'rgba(243,156,18,0.12)',
  },
  afkSkipText: { color: c.warning, fontWeight: '700', fontSize: 13 },
  scroll: {
    flex: 1,
  },
  // Layout por zonas en pantallas anchas (doc: jugadores | tablero | historial)
  wideRow: {
    flex: 1,
    flexDirection: 'row',
  },
  wideLeft: {
    width: 260,
    borderRightWidth: 1,
    borderRightColor: c.divider,
    justifyContent: 'flex-start',
  },
  wideCenter: {
    flex: 1,
  },
  wideRight: {
    width: 300,
    borderLeftWidth: 1,
    borderLeftColor: c.divider,
  },
  marketInactive: {
    opacity: 0.45,
  },
  marketFocused: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 6,
  },
  battlefieldDimmed: {
    opacity: 0.55,
  },
  marketInactiveLabel: {
    color: c.connectionStale,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: 6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: c.textMuted,
    fontSize: 16,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: c.info,
    padding: 12,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Cabecera tipo wireframe: logo | turno/fase | acciones
  // Zonas del tablero (layout ancho)
  topZone: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 4,
  },
  scenarioSlot: {
    flex: 1,
  },
  boardRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  boardMain: {
    flex: 1.4,
  },
  boardSide: {
    flex: 1,
    minWidth: 260,
  },
  handRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 4,
  },
  handMain: {
    flex: 1,
    minWidth: 0,
  },
  // Pie: recursos + acciones
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
    gap: 8,
  },
  footerResources: {
    flex: 1,
    minWidth: 0,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  header: {
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  activePlayerText: {
    color: c.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 6,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sideTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    marginBottom: 6,
  },
  sideTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sideTabActive: {
    borderBottomColor: c.accent,
  },
  sideTabText: {
    color: c.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  sideTabTextActive: {
    color: c.accent,
  },
  exitSpacer: {
    flex: 1,
    maxWidth: 120,
  },
  finishedContainer: {
    flex: 1,
    backgroundColor: c.background,
  },
  finishedContent: {
    alignItems: 'center',
    padding: 20,
  },
  finishedTitle: {
    color: c.accent,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 20,
  },
  winnerText: {
    color: c.success,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  tieText: {
    color: c.warning,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  rankings: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 24,
  },
  rankingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.surface,
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  rankPosition: {
    color: c.accent,
    fontSize: 16,
    fontWeight: 'bold',
    width: 30,
  },
  rankName: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankMain: {
    flex: 1,
  },
  rankBreakdown: {
    color: c.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  rankGlory: {
    color: c.info,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rankTrophies: {
    color: c.textMuted,
    fontSize: 11,
    marginLeft: 8,
  },
  finishedActions: {
    flexDirection: 'row',
    gap: 12,
  },
  finishedButton: {
    backgroundColor: c.info,
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonSecondary: {
    backgroundColor: c.success,
    padding: 14,
    borderRadius: 8,
    minWidth: 150,
    alignItems: 'center',
  },
  finishedButtonText: {
    color: c.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Layout estrecho: barra de pestanas sobre el pie persistente
  narrowBody: { flex: 1 },
  mobileTabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  mobileTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  mobileTabActive: { borderTopColor: c.accent, backgroundColor: c.surface },
  mobileTabText: { color: c.textMuted, fontSize: 10, fontWeight: '600' },
  mobileTabTextActive: { color: c.accent },
});

