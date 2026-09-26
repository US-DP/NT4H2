/**
 * cardWorkshop/editorStyles.ts — estilos compartidos del editor del Taller.
 * Los usan CreateCardTab, EffectTree, FxPreview y SimPanel: una sola
 * StyleSheet evita duplicar el objeto en cada archivo extraido.
 */

import { StyleSheet } from 'react-native';
import { colors, spacing, radius, fontSize } from '../../../lib/theme';
export const styles = StyleSheet.create({
  scroll: { flex: 1 },
  sectionTitle: { color: colors.text, fontSize: fontSize.section, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { color: colors.textMuted, fontSize: fontSize.detail, marginBottom: spacing.md },
  miniLabel: { color: colors.text, fontSize: fontSize.detail, fontWeight: '600', marginTop: spacing.sm, marginBottom: spacing.xs },
  previewBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    borderLeftWidth: 3, borderLeftColor: colors.accent,
    backgroundColor: colors.surface, padding: spacing.sm, marginBottom: spacing.sm,
  },
  previewTitle: { color: colors.accent, fontSize: fontSize.micro, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  previewLine: { color: colors.textMuted, fontSize: fontSize.detail, lineHeight: fontSize.detail * 1.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  chipText: { color: colors.text, fontSize: fontSize.detail },
  twoCol: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  nested: {
    borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: spacing.sm,
    marginTop: spacing.xs, marginBottom: spacing.xs,
  },
  node: {
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs,
  },
  nodeError: { borderColor: colors.danger, borderWidth: 1.5 },
  nodeWarn: { borderColor: colors.warning, borderWidth: 1.5 },
  nodeFocused: { borderColor: colors.accent, borderWidth: 2.5 },
  nodeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nodeText: { color: colors.textMuted, fontSize: fontSize.detail, flex: 1, fontStyle: 'italic' },
  ctrlRow: { flexDirection: 'row', gap: 2 },
  ctrl: { padding: spacing.xs, minWidth: 30, alignItems: 'center' },
  ctrlOff: { opacity: 0.3 },
  ctrlTxt: { color: colors.text, fontSize: fontSize.body },
  optionBox: {
    borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md,
    padding: spacing.xs, marginTop: spacing.xs,
  },
  picker: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface, marginTop: spacing.sm, maxHeight: 360,
  },
  pickerRow: { padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerName: { color: colors.text, fontWeight: '600', fontSize: fontSize.detail },
  pickerDesc: { color: colors.textMuted, fontSize: fontSize.micro },
  errorBox: {
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md,
    padding: spacing.sm, marginVertical: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: fontSize.detail },
  warnText: { color: colors.warning, fontSize: fontSize.detail },
  okText: { color: colors.success, fontSize: fontSize.detail },
  infoText: { color: colors.info, fontSize: fontSize.detail },
  simBox: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, gap: 6, marginTop: spacing.xs, marginBottom: spacing.sm,
  },
  diagBox: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
    padding: spacing.sm, gap: 2, marginBottom: spacing.sm,
  },
  complexityText: {
    color: colors.textFaint, fontSize: fontSize.detail,
    fontStyle: 'italic',
  },
  jsonBox: {
    color: colors.textMuted, fontSize: fontSize.micro, fontFamily: 'monospace',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, marginVertical: spacing.sm, maxHeight: 240,
  },
  customList: { marginTop: spacing.lg, marginBottom: spacing.xxl },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cardInfo: { flex: 1 },
  cardName: { color: colors.text, fontWeight: '600' },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.micro },
});
