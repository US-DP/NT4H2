/**
 * Pantalla de perfil y accesibilidad.
 *
 * Cumple UI-014 (densidad configurable) y UI-007 (tamaño mínimo 14px).
 * Centro de preferencias con secciones, vista previa en tiempo real
 * y efecto inmediato de cada ajuste (persistido en settingsStore).
 */

import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Switch, useWindowDimensions } from 'react-native';
import { AppSlider } from '../../components/ui/AppSlider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../../store/gameStore';
import { useCustomContent } from '../../lib/customContent';
import { storageGet } from '../../lib/storage';
import { useSettings, type Density, type ColorMode, type ControlSize, type DragSensitivity, type HapticIntensity, type GameOrientation, type HordeSummaryMode } from '../../store/settingsStore';
import { NtDialog } from '../../components/ui/NtDialog';
import { pickTextFile } from '../../lib/pickFile';
import { exportTextFile } from '../../lib/exportSave';
import { exportSettingsJson, parseSettingsJson } from '../../lib/settingsTransfer';
import { toast } from '../../lib/toast';
import { ENGINE_VERSION, RULESET_VERSION } from '@nt4h/engine';
import * as Clipboard from 'expo-clipboard';
import { CATALOG_VERSION } from '@nt4h/catalog';
import { Platform } from 'react-native';

// Metro/Expo define __DEV__ en runtime; los tipos de RN no lo declaran.
declare const __DEV__: boolean;
import { useColors, useFontScale, useFontFamily, useFontWeight } from '../../lib/useTheme';
import { hapticPlay } from '../../lib/haptics';

/* ---------- Controles reutilizables ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  // Acordeón: en estrecho las secciones nacen plegadas (el Perfil es una
  // columna larga); en ancho permanecen abiertas pero siguen siendo plegables.
  const [open, setOpen] = useState(width >= 720);
  return (
    <View style={[s.section, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={s.sectionHeader}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.sectionTitle, { color: c.accent, marginBottom: 0 }]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: 14 }} accessibilityElementsHidden>
          {open ? '▾' : '▸'}
        </Text>
      </Pressable>
      {open && children}
    </View>
  );
}

function ToggleRow({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  const c = useColors();
  const fs = useFontScale();
  return (
    <View style={[s.row, { borderBottomColor: c.divider }]}>
      <View style={s.rowText}>
        <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>{label}</Text>
        {hint && <Text style={[s.hint, { color: c.textMuted, fontSize: 11 * fs }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: c.border, true: c.accentDim }}
        thumbColor={value ? c.accent : c.textFaint}
      />
    </View>
  );
}

function OptionGroup<T extends string | number>({ label, hint, options, value, onChange }: {
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useColors();
  const fs = useFontScale();
  return (
    <View style={[s.optionGroup, { borderBottomColor: c.divider }]}>
      <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>{label}</Text>
      {hint && <Text style={[s.hint, { color: c.textMuted, fontSize: 11 * fs }]}>{hint}</Text>}
      <View style={s.optionButtons}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              style={[
                s.optionButton,
                { borderColor: c.border, backgroundColor: c.surfaceRaised },
                active && { backgroundColor: c.accent, borderColor: c.accent },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${o.label}`}
            >
              <Text style={[
                s.optionButtonText,
                { color: c.textMuted, fontSize: 12 * fs },
                active && { color: '#1a1a2e' },
              ]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SliderRow({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  const c = useColors();
  const fs = useFontScale();
  const { t } = useTranslation();
  return (
    <View style={[s.row, { borderBottomColor: c.divider }]}>
      <View style={s.rowText}>
        <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>{label}</Text>
      </View>
      <AppSlider
        style={s.slider}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={c.accent}
        maximumTrackTintColor={c.border}
        accessibilityLabel={label}
        accessibilityValueText={t('profile.percentA11y', { value })}
      />
      <Text style={[s.sliderValue, { color: c.textMuted, fontSize: 12 * fs }]}>{value} %</Text>
    </View>
  );
}

/* ---------- Vista previa ---------- */

function Preview() {
  const c = useColors();
  const fs = useFontScale();
  const { t } = useTranslation();
  const density = useSettings((s) => s.density);
  const bold = useSettings((s) => s.boldText);
  const fontFamily = useFontFamily();
  const weight = useFontWeight('normal');
  const pad = { compact: 8, standard: 14, comfortable: 20, wide: 26 }[density];
  return (
    <View style={[s.preview, { backgroundColor: c.surfaceRaised, borderColor: c.border, padding: pad }]}>
      <Text style={[s.previewTitle, { color: c.accent, fontSize: 15 * fs, fontFamily }]}>{t('profile.previewCardTitle')}</Text>
      <Text style={{ color: c.text, fontSize: 14 * fs, fontWeight: weight, fontFamily, lineHeight: 14 * fs * 1.4 }}>
        {t('profile.previewCardBody')}
      </Text>
      <View style={[s.previewButton, { backgroundColor: c.primary }]}>
        <Text style={{ color: '#fff', fontWeight: bold ? 'bold' : '600', fontSize: 13 * fs, fontFamily }}>
          {t('profile.previewButton')}
        </Text>
      </View>
      <Text style={{ color: c.textMuted, fontSize: 11 * fs, fontFamily }}>{t('profile.previewSecondary')}</Text>
    </View>
  );
}

/* ---------- Pantalla ---------- */

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { i18n } = useTranslation();
  const settings = useSettings();
  const set = settings.set;
  const c = useColors();
  const fs = useFontScale();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmClearSaves, setConfirmClearSaves] = useState(false);
  const [importPreview, setImportPreview] = useState<{ values: Partial<import('../../store/settingsStore').Settings>; changes: string[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const exportSettings = async () => {
    const ok = await exportTextFile('nt4h-ajustes.json', exportSettingsJson(settings));
    toast.show(ok ? t('profile.exported') : t('profile.exportFailed'));
  };

  const importSettings = async () => {
    const text = await pickTextFile();
    if (!text) return;
    const res = parseSettingsJson(text, settings);
    if (!res.ok) { setImportError(res.error ?? t('profile.importInvalid')); return; }
    setImportPreview({ values: res.values!, changes: res.changes ?? [] });
  };

  const savedGames = useGameStore((st) => st.savedGames);
  const trashedGames = useGameStore((st) => st.trashedGames);
  const emptyTrash = useGameStore((st) => st.emptyTrash);
  const deleteSavedGame = useGameStore((st) => st.deleteSavedGame);
  const customSets = useCustomContent((st) => st.sets);

  // Tamaños aproximados por categoría de datos locales
  const [storageSizes, setStorageSizes] = useState<{ label: string; bytes: number }[]>([]);
  useEffect(() => {
    const KEYS: [string, string][] = [
      [t('profile.szSavedGames'), 'nt4h-saved-games'],
      [t('profile.szTrash'), 'nt4h-trashed-games'],
      [t('profile.szWorkshop'), 'nt4h.customSets'],
      [t('profile.szWorkshopHistory'), 'nt4h.setMeta'],
      [t('profile.szDrafts'), 'nt4h.cardDraft'],
      [t('profile.szCollection'), 'nt4h.collection.v1'],
      [t('profile.szSettings'), 'nt4h:settings:v1'],
      [t('profile.szHistory'), 'nt4h-game-history'],
      [t('profile.szRoomSession'), 'nt4h.room.session'],
    ];
    void (async () => {
      const out: { label: string; bytes: number }[] = [];
      for (const [label, key] of KEYS) {
        const raw = await storageGet(key);
        if (raw) out.push({ label, bytes: raw.length });
      }
      setStorageSizes(out);
    })();
  }, [t]);
  const connectionMode = useGameStore((st) => st.connectionMode);
  const onlineRoomId = useGameStore((st) => st.online?.roomId);
  const [saved, setSaved] = useState(false);
  const markSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const change = (partial: Parameters<typeof set>[0]) => { set(partial); markSaved(); };

  const setLanguage = (lang: 'system' | 'es' | 'en') => {
    change({ language: lang });
    void i18n.changeLanguage(lang === 'system' ? undefined : lang);
  };

  return (
    <ScrollView style={[s.container, { backgroundColor: c.background }]}>
      <Text style={[s.title, { color: c.accent, fontSize: 24 * fs }]}>{t('profile.title')}</Text>
      {saved && (
        <Text style={[s.savedMsg, { color: c.success }]} accessibilityLiveRegion="polite">
          {t('profile.saved')}
        </Text>
      )}

      {/* ================= PERFIL ================= */}
      <Section title={t('profile.secProfile')}>
        <View style={[s.row, { borderBottomColor: c.divider }]}>
          <View style={s.rowText}>
            <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>{t('profile.displayName')}</Text>
            <Text style={[s.hint, { color: c.textMuted, fontSize: 11 * fs }]}>
              {t('profile.displayNameHint')}
            </Text>
          </View>
          <TextInput
            style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceRaised, fontSize: 14 * fs }]}
            value={settings.displayName}
            onChangeText={(v) => change({ displayName: v })}
            placeholder={t('profile.namePlaceholder')}
            placeholderTextColor={c.textFaint}
            accessibilityLabel={t('profile.displayName')}
            maxLength={24}
          />
        </View>
        <OptionGroup
          label={t('profile.language')}
          options={[
            { value: 'system' as const, label: t('profile.langSystem') },
            { value: 'es' as const, label: t('profile.langEs') },
            { value: 'en' as const, label: t('profile.langEn') },
          ]}
          value={settings.language}
          onChange={setLanguage}
        />
      </Section>

      {/* ================= TEXTO Y VISUALIZACIÓN ================= */}
      <Section title={t('profile.secText')}>
        <ToggleRow
          label={t('profile.useSystemTextSize')}
          hint={t('profile.useSystemTextSizeHint')}
          value={settings.useSystemTextSize}
          onChange={(v) => change({ useSystemTextSize: v })}
        />
        <OptionGroup<number>
          label={t('profile.fontSize')}
          hint={settings.useSystemTextSize ? t('profile.systemSizeOverride') : undefined}
          options={[
            { value: 1, label: t('profile.fsDefault') },
            { value: 1.15, label: t('profile.fsLarge') },
            { value: 1.3, label: t('profile.fsXlarge') },
            { value: 1.5, label: t('profile.fsXxlarge') },
            { value: 2, label: t('profile.fsMax') },
          ]}
          value={settings.fontScale}
          onChange={(v) => change({ fontScale: v })}
        />
        <OptionGroup<Density>
          label={t('profile.density')}
          hint={t('profile.densityHint')}
          options={[
            { value: 'compact', label: t('profile.densityCompact') },
            { value: 'standard', label: t('profile.densityStandard') },
            { value: 'comfortable', label: t('profile.densityComfortable') },
            { value: 'wide', label: t('profile.densityWide') },
          ]}
          value={settings.density}
          onChange={(v) => change({ density: v })}
        />
        <ToggleRow
          label={t('profile.boldText')}
          hint={t('profile.boldTextHint')}
          value={settings.boldText}
          onChange={(v) => change({ boldText: v })}
        />
        <ToggleRow
          label={t('profile.legibleFont')}
          hint={t('profile.legibleFontHint')}
          value={settings.highLegibilityFont}
          onChange={(v) => change({ highLegibilityFont: v })}
        />
        <ToggleRow
          label={t('profile.extraSpacing')}
          hint={t('profile.extraSpacingHint')}
          value={settings.extraTextSpacing}
          onChange={(v) => change({ extraTextSpacing: v })}
        />
        <Text style={[s.previewLabel, { color: c.textMuted, fontSize: 12 * fs }]}>{t('profile.previewLabel')}</Text>
        <Preview />
      </Section>

      {/* ================= COLOR Y CONTRASTE ================= */}
      <Section title={t('profile.secColor')}>
        <ToggleRow
          label={t('profile.highContrast')}
          hint={t('profile.highContrastHint')}
          value={settings.highContrast}
          onChange={(v) => change({ highContrast: v })}
        />
        {/* Comportamiento estructural obligatorio: no es una preferencia */}
        <View style={s.infoRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>
              {t('profile.notColorOnly')}
            </Text>
            <Text style={[s.hint, { color: c.textMuted, fontSize: 11 * fs }]}>
              {t('profile.notColorOnlyHint')}
            </Text>
          </View>
          <Text style={{ color: c.success, fontSize: 12 * fs, fontWeight: '700' }}>{t('profile.always')}</Text>
        </View>
        <OptionGroup<ColorMode>
          label={t('profile.colorMode')}
          hint={t('profile.colorModeHint')}
          options={[
            { value: 'default', label: t('profile.cmDefault') },
            { value: 'protanopia', label: t('profile.cmProtanopia') },
            { value: 'deuteranopia', label: t('profile.cmDeuteranopia') },
            { value: 'tritanopia', label: t('profile.cmTritanopia') },
            { value: 'monochrome', label: t('profile.cmMonochrome') },
          ]}
          value={settings.colorMode}
          onChange={(v) => change({ colorMode: v })}
        />
      </Section>

      {/* ================= MOVIMIENTO ================= */}
      <Section title={t('profile.secMotion')}>
        <ToggleRow
          label={t('profile.reduceMotion')}
          hint={t('profile.reduceMotionHint')}
          value={settings.reduceMotion}
          onChange={(v) => change({ reduceMotion: v })}
        />
        {/* La interfaz no genera flashes peligrosos: comportamiento por defecto */}
        <View style={s.infoRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.optionLabel, { color: c.text, fontSize: 14 * fs }]}>
              {t('profile.noFlashes')}
            </Text>
            <Text style={[s.hint, { color: c.textMuted, fontSize: 11 * fs }]}>
              {t('profile.noFlashesHint')}
            </Text>
          </View>
          <Text style={{ color: c.success, fontSize: 12 * fs, fontWeight: '700' }}>{t('profile.always')}</Text>
        </View>
        <ToggleRow
          label={t('profile.autoPlay')}
          hint={t('profile.autoPlayHint')}
          value={settings.autoPlayAnimations}
          onChange={(v) => change({ autoPlayAnimations: v })}
        />
      </Section>

      {/* ================= SONIDO Y RESPUESTA ================= */}
      <Section title={t('profile.secSound')}>
        <SliderRow label={t('profile.volMaster')} value={settings.volumeMaster} onChange={(v) => change({ volumeMaster: v })} />
        <SliderRow label={t('profile.volMusic')} value={settings.volumeMusic} onChange={(v) => change({ volumeMusic: v })} />
        <SliderRow label={t('profile.volEffects')} value={settings.volumeEffects} onChange={(v) => change({ volumeEffects: v })} />
        <ToggleRow
          label={t('profile.vibration')}
          hint={t('profile.vibrationHint')}
          value={settings.vibration}
          onChange={(v) => change({ vibration: v })}
        />
        <ToggleRow
          label={t('profile.haptics')}
          hint={t('profile.hapticsHint')}
          value={settings.hapticFeedback}
          onChange={(v) => change({ hapticFeedback: v })}
        />
        <OptionGroup<HapticIntensity>
          label={t('profile.hapticIntensity')}
          options={[
            { value: 'off', label: t('profile.hiOff') },
            { value: 'light', label: t('profile.hiLight') },
            { value: 'medium', label: t('profile.hiMedium') },
            { value: 'strong', label: t('profile.hiStrong') },
          ]}
          value={settings.hapticIntensity}
          onChange={(v) => change({ hapticIntensity: v })}
        />
        <Pressable
          style={[s.testButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={hapticPlay}
          accessibilityRole="button"
          accessibilityLabel={t('profile.testHaptics')}
        >
          <Text style={{ color: c.text, fontSize: 13 * fs }}>{t('profile.testHaptics')}</Text>
        </Pressable>
      </Section>

      {/* ================= INTERACCIÓN ================= */}
      <Section title={t('profile.secInteraction')}>
        <OptionGroup<ControlSize>
          label={t('profile.controlSize')}
          hint={t('profile.controlSizeHint')}
          options={[
            { value: 'normal', label: t('profile.csNormal') },
            { value: 'large', label: t('profile.csLarge') },
            { value: 'xlarge', label: t('profile.csXlarge') },
          ]}
          value={settings.controlSize}
          onChange={(v) => change({ controlSize: v })}
        />
        <OptionGroup<DragSensitivity>
          label={t('profile.dragSensitivity')}
          hint={t('profile.dragSensitivityHint')}
          options={[
            { value: 'low', label: t('profile.dsLow') },
            { value: 'medium', label: t('profile.dsMedium') },
            { value: 'high', label: t('profile.dsHigh') },
          ]}
          value={settings.dragSensitivity}
          onChange={(v) => change({ dragSensitivity: v })}
        />
        <ToggleRow
          label={t('profile.holdToConfirm')}
          hint={t('profile.holdToConfirmHint')}
          value={settings.holdToConfirm}
          onChange={(v) => change({ holdToConfirm: v })}
        />
        <ToggleRow
          label={t('profile.gestureAlt')}
          hint={t('profile.gestureAltHint')}
          value={settings.gestureAlternatives}
          onChange={(v) => change({ gestureAlternatives: v })}
        />
      </Section>

      {/* ================= PARTIDA ================= */}
      <Section title={t('profile.secGame')}>
        <OptionGroup<GameOrientation>
          label={t('profile.orientation')}
          hint={t('profile.orientationHint')}
          options={[
            { value: 'landscape', label: t('profile.orLandscape') },
            { value: 'portrait', label: t('profile.orPortrait') },
            { value: 'auto', label: t('profile.orAuto') },
          ]}
          value={settings.gameOrientation}
          onChange={(v) => change({ gameOrientation: v })}
        />
        <ToggleRow
          label={t('profile.followPhase')}
          hint={t('profile.followPhaseHint')}
          value={settings.autoFollowPhaseTabs}
          onChange={(v) => change({ autoFollowPhaseTabs: v })}
        />
        <OptionGroup<HordeSummaryMode>
          label={t('profile.hordeSummary')}
          hint={t('profile.hordeSummaryHint')}
          options={[
            { value: 'always', label: t('profile.hsAlways') },
            { value: 'modifiers', label: t('profile.hsModifiers') },
            { value: 'never', label: t('profile.hsNever') },
          ]}
          value={settings.hordeSummaryMode}
          onChange={(v) => change({ hordeSummaryMode: v })}
        />
        <ToggleRow
          label={t('profile.shortcuts')}
          hint={t('profile.shortcutsHint')}
          value={settings.shortcutsEnabled}
          onChange={(v) => change({ shortcutsEnabled: v })}
        />
      </Section>

      {/* ================= LECTOR DE PANTALLA ================= */}
      <Section title={t('profile.secScreenReader')}>
        <ToggleRow
          label={t('profile.srAnnounce')}
          hint={t('profile.srAnnounceHint')}
          value={settings.srAnnounceState}
          onChange={(v) => change({ srAnnounceState: v })}
        />
        <ToggleRow
          label={t('profile.srExpanded')}
          hint={t('profile.srExpandedHint')}
          value={settings.srExpandedLabels}
          onChange={(v) => change({ srExpandedLabels: v })}
        />
        <ToggleRow
          label={t('profile.srPositions')}
          hint={t('profile.srPositionsHint')}
          value={settings.srListPositions}
          onChange={(v) => change({ srListPositions: v })}
        />
      </Section>

      {/* ================= ACCIONES ================= */}
      <Section title={t('profile.secActions')}>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.primary }]}
          onPress={() => { settings.applyRecommended(); markSaved(); }}
          accessibilityRole="button"
        >
          <Text style={s.actionButtonText}>{t('profile.applyRecommended')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('profile.applyRecommendedHint')}
          </Text>
        </Pressable>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={() => setConfirmReset(true)}
          accessibilityRole="button"
        >
          <Text style={s.actionButtonText}>{t('profile.resetA11y')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('profile.resetA11yHint')}
          </Text>
        </Pressable>
      </Section>

      <Section title={t('profile.secPortability')}>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={() => void exportSettings()}
          accessibilityRole="button"
        >
          <Text style={s.actionButtonText}>{t('profile.exportSettings')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('profile.exportSettingsHint')}
          </Text>
        </Pressable>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={() => void importSettings()}
          accessibilityRole="button"
        >
          <Text style={s.actionButtonText}>{t('profile.importSettings')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('profile.importSettingsHint')}
          </Text>
        </Pressable>
      </Section>

      <Section title={t('storage.title')}>
        <Text style={[s.actionHint, { color: c.textMuted }]}>
          {t('storage.summary', { saved: savedGames.length, trashed: trashedGames.length, sets: customSets.length })}
            {storageSizes.length > 0 && (
              <View style={{ marginTop: 6 }}>
                {storageSizes.map((row) => (
                  <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={[s.actionHint, { color: c.textMuted }]}>{row.label}</Text>
                    <Text style={[s.actionHint, { color: c.textFaint ?? c.textMuted }]}>
                      {row.bytes < 1024 ? `${row.bytes} B`
                        : row.bytes < 1048576 ? `${(row.bytes / 1024).toFixed(1)} KB`
                        : `${(row.bytes / 1048576).toFixed(1)} MB`}
                    </Text>
                  </View>
                ))}
              </View>
            )}
        </Text>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={() => setConfirmEmptyTrash(true)}
          disabled={trashedGames.length === 0}
          accessibilityRole="button"
          accessibilityLabel={t('profile.trashCountA11y', { n: trashedGames.length })}
        >
          <Text style={s.actionButtonText}>{t('storage.emptyTrash')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('storage.emptyTrashDesc', { n: trashedGames.length })}
          </Text>
        </Pressable>
        <Pressable
          style={[s.actionButton, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          onPress={() => setConfirmClearSaves(true)}
          disabled={savedGames.length === 0}
          accessibilityRole="button"
          accessibilityLabel={t('profile.clearSavesA11y', { n: savedGames.length })}
        >
          <Text style={[s.actionButtonText, { color: c.danger ?? '#e74c3c' }]}>{t('storage.clearSaves')}</Text>
          <Text style={[s.actionHint, { color: c.textMuted }]}>
            {t('storage.clearSavesDesc', { n: savedGames.length })}
          </Text>
        </Pressable>
      </Section>

      <Section title={t('profile.secDiagnostics')}>
        {[
          [t('profile.diagEngine'), ENGINE_VERSION],
          [t('profile.diagRuleset'), RULESET_VERSION],
          [t('profile.diagCatalog'), CATALOG_VERSION],
          [t('profile.diagPlatform'), Platform.OS],
          [t('profile.diagConnection'), connectionMode === 'online' ? t('profile.diagOnline', { room: onlineRoomId ?? t('profile.diagRoom') }) : t('profile.diagLocal')],
          [t('profile.diagSaved'), String(savedGames.length)],
          [t('profile.diagSets'), String(customSets.length)],
        ].map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={[s.actionHint, { color: c.textMuted }]}>{k}</Text>
            <Text style={{ color: c.text, fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}>
              {v}
            </Text>
          </View>
        ))}
        <Pressable
          style={[s.actionButton, { marginTop: 6 }]}
          accessibilityRole="button"
          accessibilityLabel={t('profile.copyDiagA11y')}
          onPress={() => {
            const diag = [
              `NT4H diag`, `engine=${ENGINE_VERSION}`, `ruleset=${RULESET_VERSION}`,
              `catalog=${CATALOG_VERSION}`, `platform=${Platform.OS}`,
              `mode=${connectionMode}`, `saved=${savedGames.length}`,
              `customSets=${customSets.length}`,
            ].join(' | ');
            void Clipboard.setStringAsync(diag).then(() => toast.show(t('profile.diagCopied')));
          }}
        >
          <Text style={[s.actionButtonText, { color: c.info }]}>{t('profile.copyDiag')}</Text>
        </Pressable>
      </Section>

      {__DEV__ && (
        <Pressable
          style={[s.backButton, { backgroundColor: c.surfaceRaised }]}
          onPress={() => router.push('/(dev)/showcase')}
          accessibilityRole="link"
          accessibilityLabel={t('profile.showcaseA11y')}
        >
          <Text style={s.backText}>{t('profile.showcase')}</Text>
        </Pressable>
      )}

      <Pressable style={[s.backButton, { backgroundColor: c.surfaceRaised }]} onPress={() => router.push('/')}>
        <Text style={s.backText}>{t('profile.back')}</Text>
      </Pressable>

      {/* Confirmación clara de restablecer (doble pulsación no es descubrible) */}
      <NtDialog
        visible={confirmEmptyTrash}
        title={t('storage.confirmTrashTitle')}
        description={t('storage.confirmTrashDesc', { n: trashedGames.length })}
        onDismiss={() => setConfirmEmptyTrash(false)}
        actions={[
          { label: t('profile.cancel'), variant: 'ghost', onPress: () => setConfirmEmptyTrash(false) },
          {
            label: t('storage.confirmTrash'),
            variant: 'danger',
            onPress: () => { setConfirmEmptyTrash(false); emptyTrash(); },
          },
        ]}
      />
      <NtDialog
        visible={confirmClearSaves}
        title={t('storage.confirmClearTitle')}
        description={t('storage.confirmClearDesc', { n: savedGames.length })}
        onDismiss={() => setConfirmClearSaves(false)}
        actions={[
          { label: t('profile.cancel'), variant: 'ghost', onPress: () => setConfirmClearSaves(false) },
          {
            label: t('storage.confirmClear'),
            variant: 'danger',
            onPress: () => {
              setConfirmClearSaves(false);
              for (const g of [...savedGames]) deleteSavedGame(g.id);
            },
          },
        ]}
      />
      <NtDialog
        visible={confirmReset}
        title={t('profile.resetA11y')}
        description={t('profile.resetDesc')}
        onDismiss={() => setConfirmReset(false)}
        actions={[
          { label: t('profile.cancel'), variant: 'ghost', onPress: () => setConfirmReset(false) },
          {
            label: t('profile.reset'),
            variant: 'danger',
            onPress: () => {
              settings.resetAccessibility();
              setConfirmReset(false);
              markSaved();
            },
          },
        ]}
      />
      {/* Resumen previo de importación de ajustes */}
      <NtDialog
        visible={importPreview !== null}
        title={t('profile.importSettings')}
        description={importPreview ? `${t('profile.importSummary', { count: Object.keys(importPreview.values).length })}\n\n${importPreview.changes.slice(0, 8).join('\n')}${importPreview.changes.length > 8 ? t('profile.importMore', { count: importPreview.changes.length - 8 }) : ''}` : ''}
        onDismiss={() => setImportPreview(null)}
        actions={[
          { label: t('profile.cancel'), variant: 'ghost', onPress: () => setImportPreview(null) },
          {
            label: t('profile.import'),
            variant: 'primary',
            onPress: () => {
              if (importPreview) set(importPreview.values);
              setImportPreview(null);
              markSaved();
            },
          },
        ]}
      />
      <NtDialog
        visible={importError !== null}
        title={t('profile.importErrorTitle')}
        description={importError ?? ''}
        onDismiss={() => setImportError(null)}
        actions={[
          { label: t('profile.accept'), variant: 'primary', onPress: () => setImportError(null) },
        ]}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontWeight: 'bold', marginBottom: 8 },
  savedMsg: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  section: { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: { flex: 1 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  optionLabel: { fontWeight: '600' },
  hint: { marginTop: 3, lineHeight: 15 },
  optionGroup: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  optionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  optionButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  optionButtonText: { fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minWidth: 160 },
  slider: { flex: 1, maxWidth: 220, height: 36 },
  sliderValue: { width: 46, textAlign: 'right' },
  previewLabel: { marginTop: 12, marginBottom: 6, fontWeight: '600' },
  preview: { borderRadius: 10, borderWidth: 1, gap: 8 },
  previewTitle: { fontWeight: 'bold' },
  previewButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  testButton: { marginTop: 10, padding: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  actionButton: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 10 },
  actionButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  actionHint: { fontSize: 11, marginTop: 4 },
  backButton: { padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 32 },
  backText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
