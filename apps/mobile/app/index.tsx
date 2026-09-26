/**
 * Pantalla de inicio — portada del juego.
 *
 * Cumple UI-030: priorizar Continuar sobre el resto de acciones.
 * Cumple UI-031: si hay partida activa, "Continuar" tiene mayor prioridad visual.
 * Cumple UI-035: acceso offline a partidas, colección, estudio, tutorial, reglas.
 *
 * Diseño de portada (auditoría UX):
 * - Dos zonas en escritorio: abanico de cartas (identidad visual) + panel con
 *   título y acción principal única. En pantallas estrechas se apilan.
 * - Los flujos jugables (modos, salas, gestión de partidas) viven en Jugar —
 *   Inicio solo orienta: continuar, empezar o aprender.
 * - "Partidas recientes" muestra como mucho las 3 últimas, con aviso de
 *   compatibilidad y enlace a la gestión completa.
 */

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Layers } from 'lucide-react-native';
import { ENGINE_VERSION, SNAPSHOT_VERSION } from '@nt4h/engine';
import { CATALOG_VERSION } from '@nt4h/catalog';
import { useGameStore, classifySavedGame, type SavedGame } from '../store/gameStore';
import { ConnectionStatus, type ConnectionState } from '../components/ConnectionStatus';
import { Button } from '../components/ui/Button';
import { NtBadge } from '../components/ui/NtBadge';
import { NtDialog } from '../components/ui/NtDialog';
import { AppNav, useNavSidebarWidth } from '../components/AppNav';
import { compatBadge, modeLabel, savedGameMode } from '../lib/savedGame';
import { spacing, radius, fontSize } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';
import { useSettings } from '../store/settingsStore';
import { cardImage } from '../store/cardImage';

/** Cartas del abanico del hero (arte real del juego) */
const HERO_FAN_CARDS = [
  { id: 'warrior.brutal-attack', rotate: '-10deg', z: 1 },
  { id: 'mage.fireball', rotate: '-3deg', z: 2 },
  { id: 'explorer.precise-shot', rotate: '4deg', z: 3 },
  { id: 'rogue.sneak-attack', rotate: '11deg', z: 4 },
] as const;

/** Abanico de cartas del hero — puramente decorativo */
function CardFan() {
  return (
    <View style={styles.fan} accessibilityElementsHidden importantForAccessibility="no">
      {HERO_FAN_CARDS.map((c) => {
        const img = cardImage(c.id);
        if (!img.path) return null;
        return (
          <Image
            key={c.id}
            source={{ uri: img.path }}
            style={[styles.fanCard, { transform: [{ rotate: c.rotate }], zIndex: c.z }]}
            contentFit="cover"
            accessible={false}
          />
        );
      })}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  // Deep link de invitación: /?room=CODIGO → sala
  const { room: invitedRoom } = useLocalSearchParams<{ room?: string }>();
  useEffect(() => {
    if (invitedRoom) {
      router.push({ pathname: '/(room)', params: { roomId: invitedRoom } });
    }
  }, [invitedRoom, router]);

  const colors = useColors();
  const fs = useFs();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const navWidth = useNavSidebarWidth();

  const loadSavedGames = useGameStore((s) => s.loadSavedGames);
  const savedGames = useGameStore((s) => s.savedGames);
  const loadGame = useGameStore((s) => s.loadGame);
  const exportSavedGame = useGameStore((s) => s.exportSavedGame);

  useEffect(() => {
    loadSavedGames();
  }, [loadSavedGames]);

  // Solo mostramos el estado "local" cuando existe una partida abierta en
  // memoria; en la portada sin partida la etiqueta no aporta información.
  const hasActiveGame = useGameStore((s) => s.gameState !== null);
  const connectionState: ConnectionState = 'LOCAL';
  // Más reciente primero: "Continuar" debe reanudar la última partida,
  // no la primera guardada (el array está en orden cronológico)
  const recent = [...savedGames].sort((a, b) => b.savedAt - a.savedAt).slice(0, 3);
  const hasSavedGames = recent.length > 0;

  const reduceMotion = useSettings((s) => s.reduceMotion);
  const autoPlayAnimations = useSettings((s) => s.autoPlayAnimations);
  // Anims autoplay: omitidas con reduceMotion o con autoPlayAnimations off.
  const noAutoAnim = reduceMotion || !autoPlayAnimations;

  // Fade-in del panel de portada (moti rompía el SSR web: tslib interop).
  const fade = useRef(new Animated.Value(noAutoAnim ? 1 : 0)).current;
  useEffect(() => {
    if (noAutoAnim) {
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: false }).start();
  }, [fade, noAutoAnim]);
  const heroAnim = {
    opacity: fade,
    transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  const [blockedGame, setBlockedGame] = useState<SavedGame | null>(null);
  const [pendingLoad, setPendingLoad] = useState<SavedGame | null>(null);

  const handleLoad = (id: string) => {
    // Comprobación previa: la partida no se toca hasta que el usuario decide
    const game = savedGames.find((g) => g.id === id);
    if (!game) return;
    const compat = classifySavedGame(game);
    if (compat === 'incompatible') {
      setBlockedGame(game);
      return;
    }
    if (compat === 'version-mismatch') {
      setPendingLoad(game);
      return;
    }
    loadGame(id);
    router.push('/(game)');
  };

  const { t } = useTranslation();

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ backgroundColor: colors.background, ...(Platform.OS === 'web' ? { marginLeft: navWidth } : {}) }}
      contentContainerStyle={styles.content}
    >
      {/* Portada: abanico de cartas + panel principal */}
      <View style={[styles.hero, !wide && styles.heroNarrow]}>
        <CardFan />
        <Animated.View style={[styles.heroPanel, heroAnim]}>
          <Text
            style={[styles.title, { color: colors.accent, fontSize: fs(fontSize.hero + 8) }]}
            accessibilityRole="header"
          >
            {t('home.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: fs(fontSize.body + 1) }]}>
            {t('home.subtitle')}
          </Text>

          {hasActiveGame && <ConnectionStatus state={connectionState} />}

          {/* Acción principal única (UI-030/031) */}
          <View style={styles.primaryActions}>
            {hasSavedGames ? (
              <>
                <Button
                  variant="primary"
                  label={t('home.continueGame')}
                  sublabel={recent[0].name}
                  onPress={() => handleLoad(recent[0].id)}
                />
                <Button
                  variant="secondary"
                  label={t('home.newGame')}
                  onPress={() => router.push('/(play)')}
                />
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  label={t('home.newGame')}
                  onPress={() => router.push('/(play)')}
                />
                <Button
                  variant="secondary"
                  label={t('home.learnToPlay')}
                  onPress={() => router.push('/(rulebook)')}
                />
              </>
            )}
          </View>
        </Animated.View>
      </View>

      {/* Partidas recientes (máx. 3) — gestión completa en Jugar */}
      <View style={styles.savedSection}>
        <View style={styles.savedHeaderRow}>
          <Text
            style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
            accessibilityRole="header"
          >
            {t('home.recentGames')}
          </Text>
          {savedGames.length > 3 && (
            <Pressable
              onPress={() => router.push('/(play)')}
              accessibilityRole="link"
              accessibilityLabel={t('home.viewAll')}
            >
              <Text style={{ color: colors.info, fontSize: fs(fontSize.detail), fontWeight: '600' }}>
                {t('home.viewAll')}
              </Text>
            </Pressable>
          )}
        </View>
        {recent.map((game) => {
          const badge = compatBadge(classifySavedGame(game));
          return (
            <Pressable
              key={game.id}
              style={({ pressed }) => [
                styles.savedButton,
                { backgroundColor: pressed ? colors.surfaceRaised : colors.surface },
              ]}
              onPress={() => handleLoad(game.id)}
              accessibilityRole="button"
              accessibilityLabel={t('misc.loadGameA11y', { name: game.name })}
            >
              <View style={styles.savedTitleRow}>
                <Text style={[styles.savedName, { color: colors.text, fontSize: fs(fontSize.body) }]}>
                  {game.name}
                </Text>
                {badge && <NtBadge label={badge.label} tone={badge.tone} />}
              </View>
              <Text style={[styles.savedDate, { color: colors.textMuted, fontSize: fs(fontSize.micro) }]}>
                {new Date(game.savedAt).toLocaleString()} · {modeLabel(savedGameMode(game))}
              </Text>
            </Pressable>
          );
        })}
        {!hasSavedGames && (
          /* Estado vacío compacto — sin repetir la acción principal */
          <View style={[styles.emptyState, { borderColor: colors.border }]}>
            <Layers size={28} color={colors.textFaint} />
            <Text style={[styles.emptyTitle, { color: colors.text, fontSize: fs(fontSize.body) }]}>
              {t('home.noSavedGames')}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}>
              {t('home.noSavedGamesHint')}
            </Text>
            <Pressable
              onPress={() => router.push('/(rulebook)')}
              accessibilityRole="link"
              accessibilityLabel={t('home.viewRulebook')}
              style={({ pressed }) => [styles.emptyLink, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.emptyLinkText, { color: colors.info, fontSize: fs(fontSize.detail) }]}>
                {t('home.viewRulebook')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>

      {/* Partida incompatible: versiones explícitas + exportar antes de decidir */}
      <NtDialog
        visible={blockedGame !== null}
        title={t('play.incompatibleTitle')}
        description={
          t('play.incompatibleDesc', {
            name: blockedGame?.name ?? '',
            saved: blockedGame?.meta?.engineVersion ?? blockedGame?.envelope?.engineVersion ?? '?',
            installed: ENGINE_VERSION,
          })
          // Detalles de incompatibilidad: versiones explícitas de los
          // tres componentes que gobiernan la compatibilidad.
          + (blockedGame ? `\n\n${[
            t('misc.compatSnapshot', { from: blockedGame.envelope?.initialState?.version ?? '?', to: SNAPSHOT_VERSION }),
            t('misc.compatEngine', { from: blockedGame.meta?.engineVersion ?? blockedGame.envelope?.engineVersion ?? '?', to: ENGINE_VERSION }),
            t('misc.compatCatalog', { from: blockedGame.meta?.catalogVersion ?? '?', to: CATALOG_VERSION }),
          ].join('\n')}` : '')
        }
        onDismiss={() => setBlockedGame(null)}
        actions={[
          { label: t('play.cancel'), variant: 'primary', onPress: () => setBlockedGame(null) },
          {
            label: t('play.export'),
            variant: 'secondary',
            onPress: () => {
              if (blockedGame) exportSavedGame(blockedGame.id);
              setBlockedGame(null);
            },
          },
        ]}
      />

      {/* Versión distinta: cargar bajo responsabilidad del usuario */}
      <NtDialog
        visible={pendingLoad !== null}
        title={t('play.mismatchTitle')}
        description={t('play.mismatchDesc', {
          name: pendingLoad?.name ?? '',
          version: pendingLoad?.meta?.engineVersion ?? '?',
        })}
        onDismiss={() => setPendingLoad(null)}
        actions={[
          { label: t('play.cancel'), variant: 'ghost', onPress: () => setPendingLoad(null) },
          {
            label: t('play.continue'),
            variant: 'primary',
            onPress: () => {
              if (pendingLoad) {
                loadGame(pendingLoad.id);
                router.push('/(game)');
              }
              setPendingLoad(null);
            },
          },
        ]}
      />

      <AppNav />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.xxxl + 60, // barra inferior de AppNav en móvil
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  /* Portada */
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: spacing.xxxl,
    marginTop: spacing.xxl,
    marginBottom: spacing.xxxl,
  },
  heroNarrow: {
    flexDirection: 'column',
    gap: spacing.xl,
  },
  fan: {
    flex: 4,
    minHeight: 320,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fanCard: {
    width: 180,
    height: 275,
    borderRadius: radius.lg,
    marginHorizontal: -34,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  heroPanel: {
    flex: 6,
    maxWidth: 460,
    width: '100%',
    gap: spacing.md,
  },
  title: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    marginBottom: spacing.sm,
  },
  primaryActions: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  /* Partidas guardadas */
  savedSection: {
    width: '100%',
    marginTop: spacing.xxxl,
  },
  savedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  savedButton: {
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  savedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  savedName: {
    fontWeight: 'bold',
  },
  savedDate: {},
  emptyState: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontWeight: '600',
  },
  emptyDesc: {
    textAlign: 'center',
  },
  emptyLink: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyLinkText: {
    fontWeight: '600',
  },
});
