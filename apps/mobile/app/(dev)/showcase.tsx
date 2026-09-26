/**
 * Showcase de componentes — matriz de estados del sistema NT4H.
 *
 * Equivalente ligero a Storybook: permite revisar variantes, estados y
 * temas (incluido alto contraste) sin iniciar una partida. Acceso desde
 * Perfil → "Catálogo de componentes".
 *
 * Solo existe en builds de desarrollo: en producción se muestra un aviso
 * con opción de volver atrás.
 */

import { useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import {
  NtButton,
  NtPanel,
  NtBadge,
  NtBottomSheet,
  NtDialog,
  NtInput,
  NtRadioGroup,
} from '../../components/ui';
import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PhaseIndicator } from '../../components/PhaseIndicator';
import { ErrorMessage } from '../../components/ErrorMessage';
import { EmptyState } from '../../components/EmptyState';
import { CardView } from '../../components/CardView';
import { ContextBanner } from '../../components/game/ContextBanner';
import { ChatPanel } from '../../components/ChatPanel';
import { CardDefinitionSchema } from '@nt4h/schema';
import { toast } from '../../lib/toast';
import { useColors, useFs } from '../../lib/useTheme';
import { spacing, fontSize } from '../../lib/theme';

// Metro/Expo define __DEV__ en runtime; los tipos de RN no lo declaran.
declare const __DEV__: boolean;

export default function ShowcaseScreen() {
  if (!__DEV__) return <DevOnlyNotice />;
  return <ShowcaseContent />;
}

/** Vista de sustitución en builds de producción */
function DevOnlyNotice() {
  const colors = useColors();
  const fs = useFs();
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View style={[styles.devOnly, { backgroundColor: colors.background }]}>
      <Text
        style={{ color: colors.text, fontSize: fs(fontSize.section), fontWeight: '700', textAlign: 'center' }}
        accessibilityRole="header"
      >
        {t('misc.showcase.devOnlyTitle')}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.body), textAlign: 'center' }}>
        {t('misc.showcase.devOnlyDesc')}
      </Text>
      <NtButton
        label={t('misc.back')}
        variant="secondary"
        onPress={() => router.back()}
        accessibilityLabel={t('misc.showcase.backA11y')}
      />
    </View>
  );
}

type DemoMode = 'solitario' | 'local' | 'online';

function ShowcaseContent() {
  const colors = useColors();
  const fs = useFs();
  const { t } = useTranslation();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [heroName, setHeroName] = useState('');
  const [mode, setMode] = useState<DemoMode>('solitario');

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.accent, fontSize: fs(fontSize.section) }]}>
        {title}
      </Text>
      {children}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text, fontSize: fs(fontSize.title) }]} accessibilityRole="header">
        {t('misc.showcase.title')}
      </Text>

      <Section title="NtButton">
        <View style={styles.row}>
          <NtButton label={t('misc.showcase.btnPrimary')} />
          <NtButton label={t('misc.showcase.btnSecondary')} variant="secondary" />
          <NtButton label={t('misc.showcase.btnDanger')} variant="danger" />
          <NtButton label={t('misc.showcase.btnGhost')} variant="ghost" />
        </View>
        <View style={styles.row}>
          <NtButton label={t('misc.showcase.btnSmall')} size="sm" />
          <NtButton label={t('misc.showcase.btnLarge')} size="lg" />
          <NtButton label={t('misc.showcase.btnDisabled')} disabled />
        </View>
      </Section>

      <Section title="NtBadge">
        <View style={styles.row}>
          <NtBadge label={t('misc.showcase.badgeNeutral')} />
          <NtBadge label={t('misc.showcase.badgeSuccess')} tone="success" />
          <NtBadge label={t('misc.showcase.badgeWarning')} tone="warning" />
          <NtBadge label={t('misc.showcase.badgeDanger')} tone="danger" />
          <NtBadge label={t('misc.showcase.badgeInfo')} tone="info" />
          <NtBadge label={t('misc.showcase.badgeAccent')} tone="accent" />
        </View>
      </Section>

      <Section title="NtPanel">
        <NtPanel level="surface" bordered>
          <Text style={{ color: colors.text }}>{t('misc.showcase.panelSurface')}</Text>
        </NtPanel>
        <View style={{ height: spacing.sm }} />
        <NtPanel level="modal">
          <Text style={{ color: colors.text }}>{t('misc.showcase.panelModal')}</Text>
        </NtPanel>
      </Section>

      <Section title="NtInput">
        <NtInput
          label={t('misc.showcase.inputHero')}
          placeholder={t('misc.showcase.inputHeroPlaceholder')}
          value={heroName}
          onChangeText={setHeroName}
        />
        <NtInput
          label={t('misc.showcase.inputErrorLabel')}
          value={t('misc.showcase.inputErrorValue')}
          error={t('misc.showcase.inputErrorMsg')}
        />
      </Section>

      <Section title="NtRadioGroup">
        <NtRadioGroup<DemoMode>
          label={t('misc.showcase.radioLabel')}
          options={[
            { value: 'solitario', label: t('misc.showcase.modeSolo'), description: t('misc.showcase.modeSoloDesc') },
            { value: 'local', label: t('misc.showcase.modeLocal'), description: t('misc.showcase.modeLocalDesc') },
            { value: 'online', label: t('misc.showcase.modeOnline'), description: t('misc.showcase.modeOnlineDesc') },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Section>

      <Section title="NtDialog">
        <NtButton
          label={t('misc.showcase.openDialog')}
          variant="secondary"
          onPress={() => setDialogOpen(true)}
          accessibilityLabel={t('misc.showcase.openDialogA11y')}
        />
        <NtDialog
          visible={dialogOpen}
          title={t('misc.showcase.dialogTitle')}
          description={t('misc.showcase.dialogDesc')}
          onDismiss={() => setDialogOpen(false)}
          actions={[
            { label: t('misc.cancel'), onPress: () => setDialogOpen(false) },
            { label: t('misc.showcase.dialogLeave'), variant: 'danger', onPress: () => setDialogOpen(false) },
          ]}
        />
      </Section>

      <Section title="NtBottomSheet">
        <NtButton
          label={t('misc.showcase.openSheet')}
          variant="secondary"
          onPress={() => sheetRef.current?.present()}
          accessibilityLabel={t('misc.showcase.openSheetA11y')}
        />
        <NtBottomSheet ref={sheetRef} title={t('misc.showcase.sheetTitle')} onDismiss={() => {}}>
          <Text style={{ color: colors.text }}>
            {t('misc.showcase.sheetBody')}
          </Text>
        </NtBottomSheet>
      </Section>

      <Section title="Toast">
        <NtButton
          label={t('misc.showcase.showToast')}
          variant="secondary"
          onPress={() =>
            toast.show(t('misc.showcase.toastMsg'), {
              action: { label: t('misc.showcase.toastUndo'), onPress: () => {} },
            })
          }
          accessibilityLabel={t('misc.showcase.showToastA11y')}
        />
      </Section>

      <Section title="ConnectionStatus">
        <ConnectionStatus state="CONNECTED" />
        <ConnectionStatus state="RECONNECTING" />
        <ConnectionStatus state="OFFLINE" />
        <ConnectionStatus state="LOCAL" />
      </Section>

      <Section title="PhaseIndicator">
        <PhaseIndicator phase="PLAYER_ATTACK" turnNumber={3} />
        <PhaseIndicator phase="MARKET" turnNumber={3} />
        <PhaseIndicator phase="HORDE_ATTACK" />
      </Section>

      <Section title="ErrorMessage">
        <ErrorMessage
          category="connection"
          action={t('misc.showcase.errSendAction')}
          reason={t('misc.showcase.errSendReason')}
          fix={t('misc.showcase.errSendFix')}
          actions={[{ label: t('misc.showcase.retry'), onPress: () => {} }]}
        />
        <ErrorMessage
          category="compatibility"
          action={t('misc.showcase.errJoinAction')}
          reason={t('misc.showcase.errJoinReason')}
          fix={t('misc.showcase.errJoinFix')}
        />
      </Section>

      <Section title="EmptyState">
        <EmptyState
          title={t('misc.showcase.emptyTitle')}
          description={t('misc.showcase.emptyDesc')}
          primaryAction={{ label: t('misc.showcase.emptyNew'), onPress: () => {} }}
          helpAction={{ label: t('misc.showcase.emptyRules'), onPress: () => {} }}
        />
      </Section>

      <Section title="CardView">
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {([
            {
              id: 'demo.attack', name: t('misc.showcase.cardAttack'), type: 'ABILITY',
              heroClass: 'WARRIOR', printedAttack: 2, copies: 3,
            },
            {
              id: 'demo.market', name: t('misc.showcase.cardArmor'), type: 'MARKET',
              printedCost: 3, copies: 1,
            },
            {
              id: 'demo.horde', name: t('misc.showcase.cardOrc'), type: 'HORDE',
              printedFortitude: 4, copies: 2,
            },
            // parse() aplica los defaults del schema (destinationAfterUse,
            // verificationStatus, author, version, officialStatus, setId…)
          ].map((c) => CardDefinitionSchema.parse(c))).map((card) => (
            <CardView key={card.id} card={card} compact />
          ))}
        </View>
      </Section>

      <Section title="ContextBanner">
        <ContextBanner
          horde={{
            incoming: 6,
            shields: 2,
            afterDefense: 4,
            willExhaust: true,
            onShowBreakdown: () => {},
          }}
          message={t('misc.showcase.bannerMessage')}
          instruction={t('misc.showcase.bannerInstruction')}
          onlineRoomId="DEMO42"
        />
      </Section>

      <Section title="ChatPanel">
        <ChatPanel
          messages={[
            { id: 'm1', sender: 'Ana', text: t('misc.showcase.chatMsg1'), type: 'USER', timestamp: 1 },
            { id: 'm2', sender: t('misc.showcase.chatSenderSystem'), text: t('misc.showcase.chatSystem'), type: 'SYSTEM', timestamp: 2 },
            { id: 'm3', sender: t('misc.showcase.chatYou'), text: t('misc.showcase.chatFail'), type: 'USER', timestamp: 3, status: 'failed' },
          ]}
          currentUser={t('misc.showcase.chatYou')}
          onSend={() => {}}
          onRetry={() => {}}
          onDiscard={() => {}}
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { fontWeight: '800', marginBottom: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  devOnly: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
});
