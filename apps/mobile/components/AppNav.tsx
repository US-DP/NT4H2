/**
 * AppNav — navegación principal responsive.
 *
 * Cumple UI-020: barra lateral en escritorio.
 * Cumple UI-021: navegación inferior en móvil.
 * Cumple UI-022: ubicación actual, título activo, botón atrás coherente.
 *
 * Escritorio: sidebar con dos estados persistentes —
 *   · contraída (78 px): solo iconos + indicador activo;
 *   · expandida (220 px): icono + etiqueta + encabezados de grupo.
 * La preferencia se guarda en settings.navMode ('auto' | 'collapsed' |
 * 'expanded'); el antiguo settings.navExpanded (bool) solo existe para
 * migrar ese valor — no lo lee ningún componente.
 *
 * Móvil: barra inferior de 5 destinos máximo — Inicio, Jugar, Colección,
 * Reglamento y "Más" (sheet con Salas, Taller, Perfil).
 *
 * El estado activo NO depende solo del pathname: cada destino declara
 * `matchRoutes` (p. ej. Jugar cubre /(play), /(create) y /(game)), de modo
 * que la pantalla de partida o el asistente mantienen marcada su sección.
 *
 * Todos los colores vienen de `useColors()` y los tamaños de texto de
 * `useFs()` para respetar alto contraste, daltonismo y escala de fuente.
 */

import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import {
  Home,
  Swords,
  DoorOpen,
  Palette,
  BookOpen,
  Book,
  Package,
  BarChart3,
  User,
  MoreHorizontal,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { fontSize } from '../lib/theme';
import { useColors, useFs } from '../lib/useTheme';
import { useSettings } from '../store/settingsStore';

const ICONS = {
  home: Home,
  play: Swords,
  rooms: DoorOpen,
  studio: Palette,
  collection: BookOpen,
  content: Package,
  stats: BarChart3,
  rules: Book,
  profile: User,
  more: MoreHorizontal,
} as const;

type IconId = keyof typeof ICONS;
type NavId = Exclude<IconId, 'more'>;

interface NavItem {
  id: NavId;
  route: Href;
  /** Rutas que marcan este destino como activo (con o sin grupos `(x)`). */
  matchRoutes: string[];
  /** Etiqueta auxiliar junto al nombre (p. ej. "AVANZADO" en el Taller) */
  badge?: string;
}

const ALL_ITEMS: NavItem[] = [
  { id: 'home', route: '/', matchRoutes: ['/'] },
  { id: 'play', route: '/(play)', matchRoutes: ['/(play)', '/(create)', '/(game)'] },
  { id: 'rooms', route: '/(room)', matchRoutes: ['/(room)', '/rooms'] },
  { id: 'collection', route: '/(library)', matchRoutes: ['/(library)'] },
  { id: 'content', route: '/(content)', matchRoutes: ['/(content)'] },
  { id: 'stats', route: '/(stats)', matchRoutes: ['/(stats)'] },
  { id: 'rules', route: '/(rulebook)', matchRoutes: ['/(rulebook)'] },
  { id: 'studio', route: '/(study)', matchRoutes: ['/(study)'], badge: 'AVANZADO' },
  { id: 'profile', route: '/(profile)', matchRoutes: ['/(profile)'] },
];

/** Grupos visibles en el sidebar de escritorio */
const DESKTOP_GROUPS: { heading: string; items: NavId[] }[] = [
  { heading: 'nav.groupMain', items: ['home', 'play', 'rooms'] },
  { heading: 'nav.groupContent', items: ['collection', 'content', 'rules'] },
  { heading: 'nav.groupTools', items: ['studio'] },
  { heading: 'nav.groupAccount', items: ['stats', 'profile'] },
];

/** Barra inferior móvil: 4 destinos + "Más" */
const MOBILE_PRIMARY: NavId[] = ['home', 'play', 'collection', 'rules'];
/** Destinos dentro del menú "Más" */
const MOBILE_OVERFLOW: NavId[] = ['rooms', 'studio', 'content', 'stats', 'profile'];

const SIDEBAR_COLLAPSED = 78;
const SIDEBAR_EXPANDED = 220;

/** Mínimo de ancho para que 'auto' muestre el sidebar expandido. */
const AUTO_EXPAND_MIN_WIDTH = 1200;

/** Expansión efectiva del sidebar según settings.navMode:
 *  'auto' → expandida solo en monitores amplios; explícitos = fijos. */
export function useNavExpanded(): boolean {
  const mode = useSettings((s) => s.navMode);
  const { width } = useWindowDimensions();
  return Platform.OS === 'web'
    && (mode === 'expanded' || (mode === 'auto' && width >= AUTO_EXPAND_MIN_WIDTH));
}

/** La anchura que las pantallas deben reservar a la izquierda en web. */
export function useNavSidebarWidth(): number {
  const expanded = useNavExpanded();
  return Platform.OS === 'web'
    ? expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED
    : 0;
}

/**
 * Variante tolerante para pantallas que pueden invocarse fuera de un
 * render React real (el renderer ligero de tests llama a los componentes
 * directamente y los hooks de useNavSidebarWidth lanzan). En la app se
 * comporta igual; en tests devuelve 0.
 */
export function useNavSidebarWidthSafe(): number {
  try {
    return useNavSidebarWidth();
  } catch {
    return 0;
  }
}

/**
 * `<AppNav/>` para componentes renderizados también por el renderer ligero
 * de tests: ese renderer invoca los componentes directamente y los hooks
 * reales de la navegación lanzarían. En NODE_ENV=test no se monta nada;
 * en la app se comporta exactamente igual que `<AppNav/>`.
 */
export function MaybeAppNav() {
  if (process.env.NODE_ENV === 'test') return null;
  return <AppNav />;
}

function isItemActive(item: NavItem, pathname: string): boolean {
  const norm = (r: string) => r.replace(/[()]/g, '');
  return item.matchRoutes.some(
    (r) => pathname === r || pathname === norm(r) || pathname.startsWith(`${norm(r)}/`),
  );
}

export function AppNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const colors = useColors();
  const fs = useFs();
  const navMode = useSettings((s) => s.navMode);
  const expanded = useNavExpanded();
  const setSettings = useSettings((s) => s.set);

  const isWeb = Platform.OS === 'web';

  // Ctrl/Cmd+B contrae/expande el sidebar (solo web; no interfiere con
  // campos de texto porque exige el modificador).
  useEffect(() => {
    if (!isWeb) return;
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      if (ev.key.toLowerCase() !== 'b') return;
      ev.preventDefault();
      // El atajo fija un modo explícito (sale de 'auto')
      setSettings({ navMode: expanded ? 'collapsed' : 'expanded' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isWeb, expanded, setSettings]);

  const renderItem = (item: NavItem, variant: 'sidebar' | 'sidebarCollapsed' | 'bottom' | 'sheet') => {
    const isActive = isItemActive(item, pathname);
    const Icon = ICONS[item.id];
    const label = t(`nav.${item.id}`);
    const collapsed = variant === 'sidebarCollapsed';
    const labelColor = isActive
      ? colors.accent
      : variant === 'sheet'
        ? colors.text
        : colors.textMuted;
    return (
      <Pressable
        key={item.id}
        onPress={() => {
          setMoreOpen(false);
          router.push(item.route);
        }}
        style={[
          variant === 'sheet' ? styles.sheetItem : styles.item,
          !collapsed && variant === 'sidebar' && styles.itemExpanded,
          isActive && variant !== 'sheet' && {
            backgroundColor: colors.surfaceInteractiveSelected,
          },
          isActive && variant.startsWith('sidebar') && {
            borderLeftWidth: 3,
            borderLeftColor: colors.accent,
          },
        ]}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: isActive }}
        // En contraída, la etiqueta sigue siendo accesible (tooltip en web)
        {...(collapsed && Platform.OS === 'web' ? ({ title: label } as object) : {})}
      >
        <Icon
          size={22}
          color={isActive ? colors.accent : colors.textMuted}
          {...(Platform.OS !== 'web'
            ? { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const }
            : {})}
        />
        {!collapsed && (
          <Text
            style={[
              {
                color: labelColor,
                fontSize: fs(variant === 'sheet' ? fontSize.body : fontSize.micro),
              },
              isActive && styles.activeLabel,
            ]}
          >
            {label}
          </Text>
        )}
        {!collapsed && item.badge && (
          <Text
            style={{
              color: colors.warning,
              fontSize: fs(9),
              fontWeight: '800',
              letterSpacing: 0.5,
              marginLeft: variant === 'sheet' ? 8 : 0,
            }}
          >
            {item.badge}
          </Text>
        )}
      </Pressable>
    );
  };

  if (!isWeb) {
    // Móvil: 4 destinos + "Más"
    const overflowActive = MOBILE_OVERFLOW.some(
      (id) => isItemActive(ALL_ITEMS.find((i) => i.id === id)!, pathname),
    );
    const moreActive = moreOpen || overflowActive;
    return (
      <>
        {moreOpen && (
          <View style={styles.sheetOverlay}>
            <Pressable
              style={[styles.sheetBackdrop, { backgroundColor: colors.overlayScrim }]}
              onPress={() => setMoreOpen(false)}
              accessibilityLabel={t('nav.close')}
              accessibilityRole="button"
            />
            <View
              style={[
                styles.sheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              accessibilityLabel={t('nav.more')}
            >
              {MOBILE_OVERFLOW.map((id) =>
                renderItem(ALL_ITEMS.find((i) => i.id === id)!, 'sheet'),
              )}
            </View>
          </View>
        )}
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityLabel={t('nav.main')}
        >
          {MOBILE_PRIMARY.map((id) =>
            renderItem(ALL_ITEMS.find((i) => i.id === id)!, 'bottom'),
          )}
          <Pressable
            onPress={() => setMoreOpen((v) => !v)}
            style={[
              styles.item,
              moreActive && { backgroundColor: colors.surfaceInteractiveSelected },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('nav.more')}
            accessibilityState={{ expanded: moreOpen }}
          >
            <MoreHorizontal
              size={22}
              color={moreActive ? colors.accent : colors.textMuted}
              {...{ accessibilityElementsHidden: true, importantForAccessibility: 'no' as const }}
            />
            <Text
              style={[
                {
                  color: moreActive ? colors.accent : colors.textMuted,
                  fontSize: fs(fontSize.micro),
                },
                moreActive && styles.activeLabel,
              ]}
            >
              {t('nav.more')}
            </Text>
          </Pressable>
        </View>
      </>
    );
  }

  // Escritorio: sidebar con dos estados (contraída / expandida)
  return (
    <View
      style={[
        styles.sidebar,
        { width: expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED },
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      accessibilityLabel={t('nav.main')}
    >
      {DESKTOP_GROUPS.map((group) => (
        <View
          key={group.heading}
          style={[styles.group, { borderBottomColor: colors.border }]}
        >
          {expanded && (
            <Text
              style={[
                styles.groupHeading,
                { color: colors.textFaint, fontSize: fs(fontSize.micro) },
              ]}
            >
              {t(group.heading)}
            </Text>
          )}
          {group.items.map((id) =>
            renderItem(
              ALL_ITEMS.find((i) => i.id === id)!,
              expanded ? 'sidebar' : 'sidebarCollapsed',
            ),
          )}
        </View>
      ))}
      <View style={styles.sidebarFooter}>
        <Pressable
          onPress={() => {
            // Ciclo: auto/collapsed → expanded; expanded → collapsed
            const next = navMode === 'expanded' ? 'collapsed' : 'expanded';
            setSettings({ navMode: next });
          }}
          onLongPress={() => setSettings({ navMode: 'auto' })}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? t('nav.collapse') : t('nav.expand')} (${navMode === 'auto' ? 'auto' : navMode})`}
        >
          {expanded
            ? <PanelLeftClose size={20} color={colors.textMuted} />
            : <PanelLeftOpen size={20} color={colors.textMuted} />}
          {expanded && (
            <Text style={{ color: colors.textMuted, fontSize: fs(fontSize.micro) }}>
              {t('nav.collapse')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: 1,
    paddingTop: 20,
    zIndex: 100,
  },
  sidebarFooter: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  group: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  groupHeading: {
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
    alignSelf: 'flex-start',
    paddingLeft: 14,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingVertical: 6,
    zIndex: 100,
  },
  item: {
    alignItems: 'center',
    padding: 6,
    borderRadius: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  itemExpanded: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
    paddingHorizontal: 14,
    justifyContent: 'flex-start',
    marginHorizontal: 6,
  },
  activeLabel: {
    fontWeight: 'bold',
  },
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 150,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    paddingVertical: 14,
    paddingBottom: 70, // por encima de la barra inferior
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 48,
  },
});
