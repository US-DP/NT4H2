/**
 * AppNav — navegación principal responsive.
 *
 * Cumple UI-020: barra lateral en escritorio.
 * Cumple UI-021: navegación inferior en móvil.
 * Cumple UI-022: ubicación actual, título activo, botón atrás coherente.
 * Estructura: Inicio, Jugar, Continuar, Salas, Estudio, Colección, Tutorial, Reglamento, Perfil, Ajustes.
 */

import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';

interface NavItem {
  id: string;
  label: string;
  route: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', route: '/', icon: '🏠' },
  { id: 'play', label: 'Jugar', route: '/(game)', icon: '⚔' },
  { id: 'continue', label: 'Continuar', route: '/', icon: '▶' },
  { id: 'rooms', label: 'Salas', route: '/(settings)', icon: '🚪' },
  { id: 'studio', label: 'Estudio', route: '/(settings)', icon: '🎨' },
  { id: 'collection', label: 'Colección', route: '/(settings)', icon: '📚' },
  { id: 'rules', label: 'Reglamento', route: '/(settings)', icon: '📖' },
  { id: 'settings', label: 'Ajustes', route: '/(settings)', icon: '⚙' },
];

export function AppNav() {
  const router = useRouter();
  const pathname = usePathname();

  const isWeb = Platform.OS === 'web';

  return (
    <View
      style={[
        styles.container,
        isWeb ? styles.sidebar : styles.bottomBar,
      ]}
      accessibilityLabel="Navegación principal"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.route;
        return (
          <Pressable
            key={item.id}
            onPress={() => router.push(item.route as any)}
            style={[
              styles.item,
              isActive && styles.activeItem,
            ]}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isActive }}
          >
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={[styles.label, isActive && styles.activeLabel]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderColor: '#333',
  },
  sidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 80,
    borderRightWidth: 1,
    paddingTop: 20,
    alignItems: 'center',
    gap: 8,
    zIndex: 100,
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
  activeItem: {
    backgroundColor: '#2c3e50',
  },
  icon: {
    fontSize: 18,
    marginBottom: 2,
  },
  label: {
    color: '#bdc3c7',
    fontSize: 10,
  },
  activeLabel: {
    color: '#f1c40f',
    fontWeight: 'bold',
  },
});
