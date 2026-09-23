/**
 * Layout principal de la app.
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useGameStore } from '../store/gameStore';

export default function RootLayout() {
  const initCatalog = useGameStore((s) => s.initCatalog);

  useEffect(() => {
    initCatalog();
  }, [initCatalog]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0f0f23' },
        headerTintColor: '#ecf0f1',
        contentStyle: { backgroundColor: '#0f0f23' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'No Time for Heroes' }} />
      <Stack.Screen name="(create)" options={{ title: 'Nueva partida' }} />
      <Stack.Screen name="(game)" options={{ title: 'Partida' }} />
      <Stack.Screen name="(settings)" options={{ title: 'Configuracion' }} />
      <Stack.Screen name="(rulebook)" options={{ title: 'Reglamento' }} />
      <Stack.Screen name="(library)" options={{ title: 'Coleccion' }} />
      <Stack.Screen name="(profile)" options={{ title: 'Perfil' }} />
      <Stack.Screen name="(room)" options={{ title: 'Sala' }} />
      <Stack.Screen name="(study)" options={{ title: 'Estudio' }} />
    </Stack>
  );
}
