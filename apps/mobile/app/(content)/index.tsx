/**
 * /(content) — Contenido instalado.
 *
 * Gestión de conjuntos: el juego base oficial + los sets del Taller
 * instalados (locales o importados). Para cada set muestra contenido,
 * versión, estado, tamaño y versiones publicadas; permite exportar,
 * restaurar una versión y desinstalar.
 */

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Package, Download, Trash2, History, ChevronLeft } from 'lucide-react-native';
import { useCustomContent } from '../../lib/customContent';
import { exportTextFile } from '../../lib/exportSave';
import { toast } from '../../lib/toast';
import { loadCatalog } from '@nt4h/catalog';
import { useColors, useFs } from '../../lib/useTheme';
import { fontSize, type Colors } from '../../lib/theme';
import { AppNav, useNavSidebarWidth } from '../../components/AppNav';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InstalledContentScreen() {
  const c = useColors();
  const fs = useFs();
  const styles = makeStyles(c, fs);
  const navWidth = useNavSidebarWidth();
  const router = useRouter();
  const { t } = useTranslation();
  const sets = useCustomContent((s) => s.sets);
  const published = useCustomContent((s) => s.published);
  const exportSet = useCustomContent((s) => s.exportSet);
  const removeSet = useCustomContent((s) => s.removeSet);
  const restoreVersion = useCustomContent((s) => s.restoreVersion);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const catalog = loadCatalog();
  const baseSize = catalog.cards.reduce((a, card) => a + JSON.stringify(card).length, 0);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={[styles.container, { backgroundColor: c.background, marginLeft: navWidth }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('misc.back')}
          style={styles.backBtn}>
          <ChevronLeft size={20} color={c.text} />
        </Pressable>
        <Text style={styles.title}>{t('misc.installedTitle')}</Text>
      </View>

      {/* Juego base — no desinstalable */}
      <View style={[styles.card, { borderColor: c.border }]}>
        <View style={styles.cardHead}>
          <Package size={18} color={c.accent} />
          <Text style={[styles.cardTitle, { color: c.text }]}>{t('misc.baseTitle')}</Text>
        </View>
        <Text style={styles.meta}>
          {t('misc.baseMeta', { count: catalog.cards.length, size: fmtBytes(baseSize) })}
        </Text>
        <Text style={styles.meta}>{t('misc.baseNote')}</Text>
      </View>

      {sets.length === 0 && (
        <Text style={styles.meta}>
          {t('misc.noSets')}
        </Text>
      )}

      {sets.map((set) => {
        const versions = published[set.id] ?? [];
        const latest = versions[versions.length - 1];
        const size = JSON.stringify(set).length;
        return (
          <View key={set.id} style={[styles.card, { borderColor: c.border }]}>
            <View style={styles.cardHead}>
              <Package size={18} color={c.info} />
              <Text style={[styles.cardTitle, { color: c.text }]}>{set.name}</Text>
              <Text style={[styles.status, { color: set.status === 'PUBLISHED' ? c.success : c.warning }]}>
                {t(set.status === 'PUBLISHED' ? 'misc.published' : 'misc.draft')}
              </Text>
            </View>
            <Text style={styles.meta}>
              {t('misc.setMeta', { version: set.version, author: set.author, cards: set.cards.length, decks: set.decks.length, size: fmtBytes(size) })}
            </Text>
            {versions.length > 0 && (
              <Text style={styles.meta}>
                {t('misc.versionsPublished', { count: versions.length })}
                {latest ? ` (${t('misc.versionsLatest', { version: latest.version })})` : ''}
              </Text>
            )}
            <View style={styles.actions}>
              <Pressable
                style={styles.actionBtn}
                accessibilityRole="button"
                accessibilityLabel={t('misc.exportSet', { name: set.name })}
                onPress={() => {
                  const json = exportSet(set.id);
                  if (json) {
                    const name = `${set.id.replace(/\W+/g, '_')}.nt4hpack`;
                    void exportTextFile(name, json).then((ok) =>
                      toast.show(t(ok ? 'misc.exported' : 'misc.exportFailed')));
                  }
                }}
              >
                <Download size={15} color={c.accent} />
                <Text style={[styles.actionText, { color: c.accent }]}>{t('misc.export')}</Text>
              </Pressable>
              {latest && (
                <Pressable
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('misc.restoreSetA11y', { name: set.name, version: latest.version })}
                  onPress={() => {
                    const ok = restoreVersion(set.id, latest.version);
                    toast.show(t(ok ? 'misc.restored' : 'misc.restoreFailed', { version: latest.version }));
                  }}
                >
                  <History size={15} color={c.info} />
                  <Text style={[styles.actionText, { color: c.info }]}>{t('misc.restoreVersion', { version: latest.version })}</Text>
                </Pressable>
              )}
              {confirmDelete === set.id ? (
                <View style={styles.confirmRow}>
                  <Pressable
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('misc.confirmUninstallA11y', { name: set.name })}
                    onPress={() => { removeSet(set.id); setConfirmDelete(null); toast.show(t('misc.uninstalled')); }}
                  >
                    <Trash2 size={15} color={c.danger} />
                    <Text style={[styles.actionText, { color: c.danger }]}>{t('misc.confirm')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('misc.cancel')}
                    onPress={() => setConfirmDelete(null)}
                  >
                    <Text style={styles.actionText}>{t('misc.cancel')}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('misc.uninstallSet', { name: set.name })}
                  onPress={() => setConfirmDelete(set.id)}
                >
                  <Trash2 size={15} color={c.danger} />
                  <Text style={[styles.actionText, { color: c.danger }]}>{t('misc.uninstall')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
    <AppNav />
    </View>
  );
}

const makeStyles = (c: Colors, fs: (n: number) => number) => StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 84 }, // barra inferior de AppNav en móvil
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  backBtn: { padding: 6, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  title: { color: c.accent, fontSize: fs(fontSize.section), fontWeight: 'bold' },
  card: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: fs(fontSize.detail), fontWeight: '700', flex: 1 },
  status: { fontSize: fs(fontSize.micro), fontWeight: '800', letterSpacing: 0.5 },
  meta: { color: c.textMuted, fontSize: fs(fontSize.micro) },
  actions: { flexDirection: 'row', gap: 14, marginTop: 6, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  actionText: { color: c.text, fontSize: fs(fontSize.micro), fontWeight: '600' },
  confirmRow: { flexDirection: 'row', gap: 14 },
});
