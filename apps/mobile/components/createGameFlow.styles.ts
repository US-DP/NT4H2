/**
 * Estilos del asistente CreateGameFlow. Extraido de CreateGameFlow.tsx.
 */

import { StyleSheet } from 'react-native';
import { spacing, radius, fontSize, type Colors } from '../lib/theme';

export const makeStyles = (c: Colors, fs: (size: number) => number) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: spacing.lg,
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  // Cabecera del asistente
  wizardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  cancelText: {
    color: c.info,
    fontSize: fs(fontSize.body),
    width: 70,
  },
  wizardTitle: {
    color: c.text,
    fontSize: fs(fontSize.section),
    fontWeight: '800',
  },
  // Stepper de círculos (escritorio)
  stepper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  stepperItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stepperLine: {
    flex: 1,
    height: 2,
    backgroundColor: c.border,
    marginHorizontal: 4,
    marginTop: -18,
  },
  stepperLineDone: {
    backgroundColor: c.accent,
  },
  stepperDotWrap: {
    alignItems: 'center',
    minWidth: 80,
  },
  stepperDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepperDotCurrent: {
    borderColor: c.accent,
    backgroundColor: c.accent,
  },
  stepperDotDone: {
    borderColor: c.accent,
    backgroundColor: c.surfaceRaised,
  },
  stepperDotText: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    fontWeight: '700',
  },
  stepperDotTextActive: {
    color: c.surface,
  },
  stepperLabel: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    textAlign: 'center',
  },
  stepperLabelActive: {
    color: c.accent,
    fontWeight: '700',
  },
  // Stepper compacto (móvil)
  stepperCompact: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  stepperCompactText: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginBottom: 6,
  },
  stepperBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.surfaceRaised,
    overflow: 'hidden',
  },
  stepperBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.accent,
  },
  scroll: {
    flex: 1,
  },
  step: {
    marginBottom: spacing.lg,
  },
  stepTitle: {
    color: c.text,
    fontSize: fs(fontSize.section),
    fontWeight: '800',
    marginBottom: 4,
  },
  stepSubtitle: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginBottom: spacing.lg,
    maxWidth: 640,
  },
  // Tarjetas de modo
  modes: {
    gap: spacing.md,
  },
  modesWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  modeCard: {
    backgroundColor: c.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: c.border,
    minHeight: 44,
  },
  modeCardWide: {
    flex: 1,
    maxWidth: 340,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: c.accent,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  modeBadgeText: {
    color: c.surface,
    fontSize: fs(fontSize.micro),
    fontWeight: '800',
    letterSpacing: 1,
  },
  modeIconWrap: {
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  modeMetaBlock: {
    marginTop: spacing.sm,
    gap: 3,
  },
  modeHint: {
    color: c.info,
    fontSize: fs(fontSize.micro),
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  modeSelect: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border,
    alignItems: 'center',
  },
  modeSelectText: {
    color: c.textFaint,
    fontSize: fs(fontSize.detail),
    fontWeight: '600',
  },
  modeSelectTextActive: {
    color: c.accent,
    fontWeight: '800',
  },
  modeCardSelected: {
    borderColor: c.accent,
    backgroundColor: c.surfaceRaised,
  },
  modeCardDisabled: {
    opacity: 0.5,
  },
  modeName: {
    color: c.text,
    fontSize: fs(fontSize.body),
    fontWeight: 'bold',
  },
  modeDesc: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginTop: spacing.xs,
  },
  modeMeta: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginTop: 2,
  },
  modeDisabled: {
    color: c.danger,
    fontSize: fs(fontSize.detail),
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  label: {
    color: c.text,
    fontSize: fs(fontSize.body),
    marginBottom: spacing.sm,
  },
  countControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  countButton: {
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.md,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countButtonDisabled: {
    opacity: 0.4,
  },
  countText: {
    color: c.text,
    fontSize: fs(fontSize.section),
    fontWeight: 'bold',
  },
  countValue: {
    color: c.text,
    fontSize: fs(fontSize.section),
    fontWeight: 'bold',
    minWidth: 30,
    textAlign: 'center',
  },
  heroRow: {
    marginBottom: spacing.lg,
  },
  heroPlayer: {
    color: c.accent,
    fontSize: fs(fontSize.body),
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  heroList: {
    flexDirection: 'row',
  },
  heroOption: {
    marginRight: spacing.sm,
    borderRadius: radius.md,
  },
  heroOptionSelected: {
    borderWidth: 2,
    borderColor: c.accent,
  },
  subPickers: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  subPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  subLabel: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    width: 64,
  },
  chip: {
    backgroundColor: c.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipSelected: {
    borderColor: c.accent,
    backgroundColor: c.surfaceRaised,
  },
  chipDisabled: {
    opacity: 0.35,
  },
  chipText: {
    color: c.text,
    fontSize: fs(fontSize.detail),
  },
  addSupport: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addSupportText: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.surface,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  toggle: {
    backgroundColor: c.border,
    padding: spacing.sm,
    borderRadius: radius.sm,
    minWidth: 60,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: c.success,
  },
  toggleText: {
    color: c.text,
    fontSize: fs(fontSize.detail),
    fontWeight: 'bold',
  },
  scenarioHint: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  scenarioOption: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  scenarioChosen: {
    borderColor: c.accent,
  },
  scenarioBlocked: {
    opacity: 0.35,
  },
  scenarioBlockedText: {
    color: c.danger,
    fontSize: fs(fontSize.micro),
    textAlign: 'center',
    marginTop: 2,
  },
  scenarioActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  linkText: {
    color: c.info,
    fontSize: fs(fontSize.detail),
    textDecorationLine: 'underline',
  },
  summary: {
    backgroundColor: c.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  summaryItem: {
    color: c.text,
    fontSize: fs(fontSize.detail),
    marginBottom: spacing.sm,
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  editButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.info,
    minHeight: 28,
  },
  editButtonText: {
    color: c.info,
    fontSize: fs(fontSize.micro),
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    maxWidth: 420,
    width: '100%',
  },
  modalTitle: {
    color: c.text,
    fontSize: fs(fontSize.section),
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  modalBody: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
    marginBottom: spacing.lg,
  },
  errors: {
    marginBottom: spacing.lg,
  },
  stepError: {
    color: c.warning,
    fontSize: fs(fontSize.detail),
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  // Barra inferior fija
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.surface,
    gap: spacing.sm,
  },
  footerStep: {
    color: c.textMuted,
    fontSize: fs(fontSize.detail),
  },
  footerActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  primaryButton: {
    backgroundColor: c.accent,
    padding: spacing.lg,
    borderRadius: radius.md,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  secondaryButton: {
    backgroundColor: c.surfaceRaised,
    padding: spacing.lg,
    borderRadius: radius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonText: {
    color: c.surface,
    fontSize: fs(fontSize.body),
    fontWeight: 'bold',
  },
  secondaryButtonText: {
    color: c.text,
    fontSize: fs(fontSize.body),
    fontWeight: 'bold',
  },
});

