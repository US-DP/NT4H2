/**
 * Layout principal de la app.
 */

// Unistyles DEBE configurarse antes que cualquier StyleSheet.create —
// este import va el primero intencionadamente.
import { syncUnistylesTheme } from '../lib/unistyles';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { useGameStore } from '../store/gameStore';
import { useAuth } from '../store/authStore';
import { useSettings } from '../store/settingsStore';
import { NtToastHost } from '../components/ui/NtToast';
import { initMonitoring } from '../lib/monitoring';
import { startAmbientMusic, stopAmbientMusic } from '../lib/audio';
import i18n from '../lib/i18n';


initMonitoring();

// Mantener el splash hasta que el catálogo esté cargado
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { t } = useTranslation();
  const initCatalog = useGameStore((s) => s.initCatalog);
  const hydrateSettings = useSettings((s) => s.hydrate);
  const language = useSettings((s) => s.language);
  const highContrast = useSettings((s) => s.highContrast);
  // QueryClient por instancia del árbol — caché de llamadas REST (salas, estado)
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
  }));

  // Inicialización resiliente: un fallo de catálogo/ajustes nunca debe
  // dejar la app en splash — timeout de 8s y continuación con valores
  // por defecto (la app sigue usable aunque la hidratación falle).
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        await Promise.race([
          (async () => {
            initCatalog();
            await hydrateSettings();
            await useAuth.getState().hydrate();
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch {
        // catálogo/ajustes corruptos — la app arranca con defaults
      } finally {
        if (mounted) void SplashScreen.hideAsync().catch(() => {});
      }
    };
    void init();
    return () => { mounted = false; };
  }, [initCatalog, hydrateSettings]);

  // Idioma elegido en el perfil (si no es "sistema")
  useEffect(() => {
    if (language !== 'system') void i18n.changeLanguage(language);
  }, [language]);

  // Tema Unistyles sincronizado con el ajuste de alto contraste
  useEffect(() => {
    syncUnistylesTheme(highContrast);
  }, [highContrast]);

  // Música ambiental sintetizada (web): sigue el ajuste backgroundMusic.
  // startAmbientMusic ya es no-op en nativo y respeta volumen/autoplay.
  const backgroundMusic = useSettings((s) => s.backgroundMusic);
  useEffect(() => {
    if (backgroundMusic) startAmbientMusic();
    else stopAmbientMusic();
    return () => stopAmbientMusic();
  }, [backgroundMusic]);

  return (
    <SafeAreaProvider>
    <QueryClientProvider client={queryClient}>
    <GestureHandlerRootView style={styles.root}>
    <BottomSheetModalProvider>
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0f0f23' },
        headerTintColor: '#ecf0f1',
        contentStyle: { backgroundColor: '#0f0f23' },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('misc.screen.index') }} />
      <Stack.Screen name="(play)/index" options={{ title: t('misc.screen.play') }} />
      <Stack.Screen name="(create)/index" options={{ title: t('misc.screen.create') }} />
      <Stack.Screen name="(game)/index" options={{ title: t('misc.screen.game') }} />
      <Stack.Screen name="(rulebook)/index" options={{ title: t('misc.screen.rulebook') }} />
      <Stack.Screen name="(content)/index" options={{ title: t('misc.screen.content') }} />
      <Stack.Screen name="(stats)/index" options={{ title: t('misc.screen.stats') }} />
        <Stack.Screen name="(library)/index" options={{ title: t('misc.screen.library') }} />
      <Stack.Screen name="(profile)/index" options={{ title: t('misc.screen.profile') }} />
      <Stack.Screen name="(auth)/index" options={{ title: t('auth.title') }} />
      <Stack.Screen name="(room)/index" options={{ title: t('misc.screen.room') }} />
      <Stack.Screen name="(study)/index" options={{ title: t('misc.screen.study') }} />
      <Stack.Screen name="(dev)/showcase" options={{ title: t('misc.screen.showcase') }} />
    </Stack>
    <NtToastHost />
    </BottomSheetModalProvider>
    </GestureHandlerRootView>
    </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
