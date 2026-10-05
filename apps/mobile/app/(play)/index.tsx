/**
 * Pantalla Jugar — hub de flujos jugables.
 *
 * Reúne lo que antes vivía en Inicio: creación de partida, partida rápida,
 * solitario, salas online y la gestión completa de partidas guardadas
 * (continuar, renombrar, exportar, importar, papelera).
 *
 * Las partidas eliminadas van a la papelera y se conservan
 * TRASH_RETENTION_DAYS días antes de purgarse automáticamente.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Swords,
  Zap,
  User,
  Globe,
  Download,
  Pencil,
  Trash2,
  RotateCcw,
} from 'lucide-react-native';
import {
  useGameStore,
  classifySavedGame,
  TRASH_RETENTION_DAYS,
  type SavedGame,
  type TrashedGame,
} from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { AppNav, useNavSidebarWidth } from '../../components/AppNav';
import { ModeCard } from '../../components/ModeCard';
import { NtBadge } from '../../components/ui/NtBadge';
import { NtButton } from '../../components/ui/NtButton';
import { NtDialog } from '../../components/ui/NtDialog';
import { NtInput } from '../../components/ui/NtInput';
import { compatBadge, modeLabel, savedGameMode, trashDaysLeft } from '../../lib/savedGame';
import { loadHistory, computeStats, type GameHistoryEntry } from '../../lib/gameHistory';
import { pickTextFile } from '../../lib/pickFile';
import { saveRoomSession } from '../../lib/roomSession';
import { toast } from '../../lib/toast';
import { serverErrorText } from '../../lib/serverErrors';
import { API_BASE, fetchWithTimeout } from '../../lib/config';
import { authHeaders } from '../../lib/auth';
import { spacing, radius, fontSize } from '../../lib/theme';
import { useColors, useFs } from '../../lib/useTheme';
import { CATALOG_VERSION, loadCatalog, deckToConfigEntry } from '@nt4h/catalog';
import { useCustomContent, customDecks } from '../../lib/customContent';
import { ENGINE_VERSION } from '@nt4h/engine';

/** Sala pública del listado GET /rooms/ — matchmaking-lite. */
interface PublicRoom {
  roomId: string;
  status: 'WAITING' | 'PLAYING' | string;
  mode: string;
  maxPlayers: number;
  hostId: string;
  players: { playerId: string; name: string; connected: boolean }[];
  createdAt: string;
}

export default function PlayScreen() {
  const router = useRouter();
  const colors = useColors();
  const fs = useFs();
  const navWidth = useNavSidebarWidth();
  const { t } = useTranslation();

  const newGame = useGameStore((s) => s.newGame);
  const loadSavedGames = useGameStore((s) => s.loadSavedGames);
  const savedGames = useGameStore((s) => s.savedGames);
  const trashedGames = useGameStore((s) => s.trashedGames);
  const loadTrashedGames = useGameStore((s) => s.loadTrashedGames);
  const loadGame = useGameStore((s) => s.loadGame);
  const deleteSavedGame = useGameStore((s) => s.deleteSavedGame);
  const restoreTrashedGame = useGameStore((s) => s.restoreTrashedGame);
  const customSets = useCustomContent((s) => s.sets);
  const deleteTrashedGame = useGameStore((s) => s.deleteTrashedGame);
  const emptyTrash = useGameStore((s) => s.emptyTrash);
  const renameSavedGame = useGameStore((s) => s.renameSavedGame);
  const exportSavedGame = useGameStore((s) => s.exportSavedGame);
  const importSavedGame = useGameStore((s) => s.importSavedGame);
  const setConnectionMode = useGameStore((s) => s.setConnectionMode);
  const lastGameConfig = useSettings((s) => s.lastGameConfig);

  const [onlineLoading, setOnlineLoading] = useState(false);
  const [renaming, setRenaming] = useState<SavedGame | null>(null);
  const [blockedGame, setBlockedGame] = useState<SavedGame | null>(null);
  const [pendingLoad, setPendingLoad] = useState<SavedGame | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingForever, setDeletingForever] = useState<TrashedGame | null>(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  // Salas públicas (matchmaking-lite): WAITING se pueden unir, PLAYING se
  // pueden espectar en vivo.
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const connectSpectator = useGameStore((s) => s.connectSpectator);

  const loadPublicRooms = async () => {
    setRoomsLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/list/`);
      if (res.ok) {
        const data = await res.json();
        setPublicRooms(Array.isArray(data.rooms) ? data.rooms : []);
      }
    } catch {
      // Servidor caído: la lista queda vacía — no bloquea el resto
    } finally {
      setRoomsLoading(false);
    }
  };

  useEffect(() => {
    loadSavedGames();
    void loadHistory().then(setHistory);
    loadTrashedGames();
    void loadPublicRooms();
  }, [loadSavedGames, loadTrashedGames]);

  const spectateRoom = (roomId: string) => {
    connectSpectator(roomId);
    router.push('/(game)');
  };

  // Más reciente primero
  const sortedGames = [...savedGames].sort((a, b) => b.savedAt - a.savedAt);
  const sortedTrash = [...trashedGames].sort((a, b) => b.deletedAt - a.deletedAt);

  const lastGameSummary = lastGameConfig
    ? `${modeLabel(lastGameConfig.mode)} · ${lastGameConfig.playerCount} ${t('play.players')}`
    : null;

  const startStandardGame = () => {
    const base = lastGameConfig ?? {
      mode: 'STANDARD' as const,
      playerCount: 2,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE' as const, deckId: 'explorer.default' },
        { playerId: 'p2', heroId: 'hero.feldon', heroFace: 'MALE' as const, deckId: 'warrior.default' },
      ],
      useScenarios: true,
    };
    // Si el motor rechaza la config (pool vacío, héroe inexistente,
    // contenido custom sin hidratar) no navegar — la partida quedaría
    // colgada en la pantalla de selección.
    if (newGame({ ...base, seed: `game-${Date.now()}` }).ok) {
      router.push('/(game)');
    }
  };

  const startSoloGame = () => {
    const res = newGame({
      mode: 'SOLO',
      playerCount: 1,
      seed: `solo-${Date.now()}`,
      heroes: [
        { playerId: 'p1', heroId: 'hero.aranel', heroFace: 'FEMALE', deckId: 'explorer.default' },
      ],
      useScenarios: true,
      soloSupportHeroIds: ['hero.feldon'],
    });
    if (res.ok) router.push('/(game)');
  };

  const createOnlineRoom = async () => {
    setOnlineLoading(true);
    const hostId = `p-${Date.now()}`;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/rooms/`, {
        method: 'POST',
        // Con sesión activa el backend vincula el Player a la cuenta.
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          mode: 'STANDARD',
          maxPlayers: 4,
          hostId,
          hostName: t('playhub.hostName'),
          heroes: [{
            playerId: hostId,
            heroId: 'hero.aranel',
            heroFace: 'FEMALE',
            deckId: 'explorer.default',
          }],
          config: {
            catalogVersion: CATALOG_VERSION,
            engineVersion: ENGINE_VERSION,
            // Manifiesto de contenido: los invitados comparan con sus sets
            // instalados y reciben aviso estructurado si les falta alguno.
            contentManifest: customSets
              .filter((s) => s.cards.length + s.decks.length > 0)
              .map((s) => ({ id: s.id, name: s.name, version: s.version })),
            // Los sets del host viajan como snapshot: el runner los valida
            // y los fusiona solo para esta sala (el oficial no se toca).
            customSets: customSets.length > 0 ? customSets : undefined,
            // Pools EXPLÍCITOS solo-oficiales: sin esto los mazos por
            // defecto incluían cualquier carta custom instalada de tipo
            // HORDE/WARLORD/MARKET/SCENARIO y el host no podía crear una
            // partida vainilla. Las cartas custom siguen entrando por
            // customDecks (mazos del Taller de cada jugador).
            ...(customSets.length > 0 ? (() => {
              const baseCat = loadCatalog();
              const officialIds = (tp: string) => (baseCat.byType.get(tp) ?? []).map((c) => c.id);
              return {
                hordeCardIds: officialIds('HORDE'),
                warlordIds: officialIds('WARLORD'),
                marketCardIds: officialIds('MARKET'),
                scenarioIds: officialIds('SCENARIO'),
              };
            })() : {}),
            // Mazos del Taller instalados: el invitado puede elegirlos y el
            // runner los resuelve por customDeckId.
            ...(customDecks().length > 0
              ? { customDecks: customDecks().map(deckToConfigEntry) }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConnectionMode('online', data.roomId, hostId, data.hostToken);
        // Sesión en almacenamiento seguro: el token no viaja en la URL
        void saveRoomSession({ roomId: data.roomId, playerId: hostId, playerToken: data.hostToken });
        router.push({
          pathname: '/(room)',
          params: { roomId: data.roomId, playerId: hostId },
        });
      } else {
        toast.show(data?.error ? serverErrorText(data.error, t) : t('play.createRoomError'));
        router.push('/(room)');
      }
    } catch {
      router.push('/(room)');
    } finally {
      setOnlineLoading(false);
    }
  };

  const handleLoad = (id: string) => {
    // Comprobación previa: incompatible no se abre; versión distinta pide
    // confirmación (la partida no se modifica hasta que el usuario decide)
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

  const handleImport = async () => {
    const text = await pickTextFile();
    if (text === null) return;
    const err = await importSavedGame(text);
    toast.show(err ?? t('play.imported'));
  };

  const openRename = (game: SavedGame) => {
    setRenaming(game);
    setRenameText(game.name);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.content, { marginLeft: navWidth }]}
      >
        <Text
          style={[styles.title, { color: colors.accent, fontSize: fs(fontSize.title) }]}
          accessibilityRole="header"
        >
          {t('nav.play')}
        </Text>

        {/* Empezar */}
        <Text
          style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
          accessibilityRole="header"
        >
          {t('play.start')}
        </Text>
        <View style={styles.modesRow}>
          <ModeCard
            icon={<Swords size={26} color={colors.accent} />}
            title={t('play.newGame')}
            meta={t('play.newGameMeta')}
            description={t('play.newGameDesc')}
            onPress={() => router.push('/(create)')}
          />
          <ModeCard
            icon={<Zap size={26} color={colors.accent} />}
            title={t('home.modeQuick')}
            meta={lastGameSummary ?? t('home.modeQuickMeta')}
            description={lastGameSummary ? t('home.modeQuickRepeat') : t('home.modeQuickDesc')}
            onPress={startStandardGame}
          />
          <ModeCard
            icon={<User size={26} color={colors.accent} />}
            title={t('home.modeSolo')}
            meta={t('home.modeSoloMeta')}
            description={t('home.modeSoloDesc')}
            onPress={startSoloGame}
          />
          <ModeCard
            icon={<Globe size={26} color={colors.accent} />}
            title={t('home.modeOnline')}
            meta={t('home.modeOnlineMeta')}
            description={t('home.modeOnlineDesc')}
            onPress={createOnlineRoom}
            loading={onlineLoading}
          />
        </View>
        <View style={styles.secondaryRow}>
          <NtButton
            variant="secondary"
            size="sm"
            label={t('play.joinRoom')}
            onPress={() => router.push('/(room)')}
            accessibilityHint={t('play.joinRoomHint')}
          />
          <NtButton
            variant="secondary"
            size="sm"
            label={t('play.importGame')}
            onPress={() => void handleImport()}
            accessibilityHint={t('play.importGameHint')}
          />
          <NtButton
            variant="secondary"
            size="sm"
            label={t('play.refreshRooms')}
            onPress={() => void loadPublicRooms()}
            accessibilityHint={t('play.refreshRoomsHint')}
          />
        </View>

        {/* Salas públicas: unirse (en espera) o espectar (en curso) */}
        {publicRooms.length > 0 && (
          <View>
            <Text
              style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
              accessibilityRole="header"
            >
              {t('play.publicRooms')}
            </Text>
            {publicRooms.map((r) => (
              <View key={r.roomId} style={styles.roomRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: fs(fontSize.body), fontWeight: '600' }}>
                    {r.players.find(p => p.playerId === r.hostId)?.name ?? r.roomId}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.micro) }}>
                    {r.status === 'WAITING' ? t('play.roomWaiting') : t('play.roomPlaying')}
                    {' · '}{r.players.length}/{r.maxPlayers} {t('play.players')}
                  </Text>
                </View>
                {r.status === 'WAITING' ? (
                  <NtButton
                    variant="secondary" size="sm"
                    label={t('play.join')}
                    onPress={() => router.push({ pathname: '/(room)', params: { roomId: r.roomId } })}
                    accessibilityHint={t('play.joinRoomHint')}
                  />
                ) : (
                  <NtButton
                    variant="secondary" size="sm"
                    label={t('play.spectate')}
                    onPress={() => spectateRoom(r.roomId)}
                    accessibilityHint={t('play.spectateHint')}
                  />
                )}
              </View>
            ))}
          </View>
        )}
        {roomsLoading && publicRooms.length === 0 && (
          <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
            {t('play.loadingRooms')}
          </Text>
        )}

        {/* Partidas guardadas */}
        <View style={styles.sectionHeader}>
          <Text
            style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
            accessibilityRole="header"
          >
            {t('play.saved')}
          </Text>
        </View>
        {sortedGames.length === 0 ? (
          <View style={[styles.emptyState, { borderColor: colors.border }]}>
            <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.detail) }}>
              {t('home.noSavedGamesHint')}
            </Text>
          </View>
        ) : (
          sortedGames.map((game) => {
            const badge = compatBadge(classifySavedGame(game));
            return (
              <View
                key={game.id}
                style={[styles.savedItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Pressable
                  style={styles.savedMain}
                  onPress={() => handleLoad(game.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('play.continue')} ${game.name}`}
                >
                  <View style={styles.savedTitleRow}>
                    <Text style={[styles.savedName, { color: colors.text, fontSize: fs(fontSize.body) }]}>
                      {game.name}
                    </Text>
                    {badge && <NtBadge label={badge.label} tone={badge.tone} />}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.micro) }}>
                    {new Date(game.savedAt).toLocaleString()} · {modeLabel(savedGameMode(game))}
                  </Text>
                </Pressable>
                <View style={styles.savedActions}>
                  <IconAction
                    label={`${t('play.replay')} ${game.name}`}
                    icon={<RotateCcw size={16} color={colors.info} />}
                    onPress={() => router.push({ pathname: '/(replay)', params: { id: game.id } } as never)}
                    colors={colors}
                  />
                  <IconAction
                    label={`${t('play.rename')} ${game.name}`}
                    icon={<Pencil size={16} color={colors.textMuted} />}
                    onPress={() => openRename(game)}
                    colors={colors}
                  />
                  <IconAction
                    label={`${t('play.export')} ${game.name}`}
                    icon={<Download size={16} color={colors.textMuted} />}
                    onPress={() => exportSavedGame(game.id)}
                    colors={colors}
                  />
                  <IconAction
                    label={`${t('play.toTrash')} ${game.name}`}
                    icon={<Trash2 size={16} color={colors.danger} />}
                    onPress={() => {
                      deleteSavedGame(game.id);
                      // Deshacer: devuelve la partida de la papelera
                      // (la escritura va encolada tras el delete).
                      toast.show(t('play.trashedUndo', { name: game.name }), {
                        action: { label: t('play.undo'), onPress: () => restoreTrashedGame(game.id) },
                      });
                    }}
                    colors={colors}
                  />
                </View>
              </View>
            );
          })
        )}

        {/* Historial + estadísticas (oficial/custom separados) */}
        {history.length > 0 && (() => {
          const stats = computeStats(history);
          return (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
                  accessibilityRole="header"
                >
                  {t('play.history')}
                </Text>
                <Pressable
                  onPress={() => router.push('/(stats)')}
                  accessibilityRole="link"
                  accessibilityLabel={t('playhub.statsLinkA11y')}
                >
                  <Text style={{ color: colors.info, fontSize: fs(fontSize.detail), fontWeight: '600' }}>
                    {t('playhub.statsLink')}
                  </Text>
                </Pressable>
                <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro) }}>
                  {t('play.historySummary', {
                    total: stats.total, official: stats.official, custom: stats.custom, best: stats.bestScore,
                  })}
                </Text>
              </View>
              {history.slice(0, 10).map((h) => (
                <View
                  key={h.id}
                  style={[styles.savedItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.savedMain}>
                    <Text style={[styles.savedName, { color: colors.text, fontSize: fs(fontSize.body) }]}>
                      {t('play.historyWin', { winners: h.winners.join(', '), score: h.topScore })}
                    </Text>
                    <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro) }}>
                      {new Date(h.endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}{modeLabel(h.mode)}{' · '}{t('playhub.playersShort', { n: h.playerCount })}
                      {h.contentScope === 'custom' ? t('playhub.customSuffix') : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          );
        })()}

        {/* Papelera */}
        {sortedTrash.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text
                style={[styles.sectionLabel, { color: colors.textMuted, fontSize: fs(fontSize.detail) }]}
                accessibilityRole="header"
              >
                {t('play.trash')}
              </Text>
              <Pressable
                onPress={() => setConfirmEmptyTrash(true)}
                accessibilityRole="button"
                accessibilityLabel={t('play.emptyTrash')}
              >
                <Text style={{ color: colors.danger, fontSize: fs(fontSize.detail), fontWeight: '600' }}>
                  {t('play.emptyTrash')}
                </Text>
              </Pressable>
            </View>
            <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro), marginBottom: spacing.sm }}>
              {t('play.trashHint', { days: TRASH_RETENTION_DAYS })}
            </Text>
            {sortedTrash.map((game) => (
              <View
                key={game.id}
                style={[styles.savedItem, styles.trashItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.savedMain}>
                  <Text style={[styles.savedName, { color: colors.textMuted, fontSize: fs(fontSize.body) }]}>
                    {game.name}
                  </Text>
                  <Text style={{ color: colors.textFaint, fontSize: fs(fontSize.micro) }}>
                    {t('play.trashPurgeDate', {
                      days: trashDaysLeft(game.deletedAt, TRASH_RETENTION_DAYS),
                      date: new Date(game.deletedAt + TRASH_RETENTION_DAYS * 86_400_000)
                        .toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
                    })}
                  </Text>
                </View>
                <View style={styles.savedActions}>
                  <IconAction
                    label={`${t('play.restore')} ${game.name}`}
                    icon={<RotateCcw size={16} color={colors.info} />}
                    onPress={() => restoreTrashedGame(game.id)}
                    colors={colors}
                  />
                  <IconAction
                    label={`${t('play.deleteForever')} ${game.name}`}
                    icon={<Trash2 size={16} color={colors.danger} />}
                    onPress={() => setDeletingForever(game)}
                    colors={colors}
                  />
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Renombrar */}
      <NtDialog
        visible={renaming !== null}
        title={t('play.renameTitle')}
        onDismiss={() => setRenaming(null)}
        actions={[
          { label: t('play.cancel'), variant: 'ghost', onPress: () => setRenaming(null) },
          {
            label: t('play.save'),
            variant: 'primary',
            onPress: () => {
              if (renaming) renameSavedGame(renaming.id, renameText);
              setRenaming(null);
            },
          },
        ]}
      >
        <NtInput
          label={t('play.renameLabel')}
          value={renameText}
          onChangeText={setRenameText}
          maxLength={60}
          autoFocus
        />
      </NtDialog>

      {/* Eliminar definitivamente */}
      <NtDialog
        visible={deletingForever !== null}
        title={t('play.deleteForeverTitle')}
        description={t('play.deleteForeverDesc', {
          name: deletingForever?.name ?? '',
          date: deletingForever
            ? new Date(deletingForever.deletedAt + TRASH_RETENTION_DAYS * 86_400_000)
                .toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
            : '',
        })}
        onDismiss={() => setDeletingForever(null)}
        actions={[
          { label: t('play.cancel'), variant: 'ghost', onPress: () => setDeletingForever(null) },
          // Ofrecer exportar antes de eliminar la última copia
          {
            label: t('play.exportBeforeDelete'),
            variant: 'secondary',
            onPress: () => {
              if (deletingForever) exportSavedGame(deletingForever.id);
              setDeletingForever(null);
            },
          },
          {
            label: t('play.deleteForever'),
            variant: 'danger',
            onPress: () => {
              if (deletingForever) deleteTrashedGame(deletingForever.id);
              setDeletingForever(null);
            },
          },
        ]}
      />

      {/* Vaciar papelera */}
      <NtDialog
        visible={confirmEmptyTrash}
        title={t('play.emptyTrashTitle')}
        description={t('play.emptyTrashDesc', { count: sortedTrash.length })}
        onDismiss={() => setConfirmEmptyTrash(false)}
        actions={[
          { label: t('play.cancel'), variant: 'ghost', onPress: () => setConfirmEmptyTrash(false) },
          {
            label: t('play.emptyTrash'),
            variant: 'danger',
            onPress: () => {
              emptyTrash();
              setConfirmEmptyTrash(false);
            },
          },
        ]}
      />

      {/* Partida incompatible: no se abre ni se modifica — muestra las
          versiones en conflicto y permite exportarla antes de decidir */}
      <NtDialog
        visible={blockedGame !== null}
        title={t('play.incompatibleTitle')}
        description={t('play.incompatibleDesc', {
          name: blockedGame?.name ?? '',
          saved: blockedGame?.meta?.engineVersion ?? blockedGame?.envelope?.engineVersion ?? '?',
          installed: ENGINE_VERSION,
        })}
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

function IconAction({ label, icon, onPress, colors }: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl + 60,
    maxWidth: Platform.OS === 'web' ? 1100 : 900,
    width: '100%',
    alignSelf: 'center',
    // En web el margen se aplica inline con la anchura real de AppNav
  },
  title: {
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  modesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  secondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  emptyState: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  trashItem: {
    opacity: 0.8,
  },
  savedMain: {
    flex: 1,
    padding: spacing.lg,
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
  savedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
