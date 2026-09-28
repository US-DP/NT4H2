/**
 * Pantalla de cuenta (Fase 1: identidad persistente).
 *
 * Tres modos: ver perfil propio si hay sesión, login y registro.
 * La sesión persiste en expo-secure-store; tras entrar se vuelve atrás.
 */

import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../store/authStore';
import { useColors, useFontScale, useFontFamily } from '../../lib/useTheme';
import { toast } from '../../lib/toast';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const c = useColors();
  const fs = useFontScale();
  const fontFamily = useFontFamily();
  const { status, user, error, login, register, logout } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = mode === 'login' ? await login(email, password) : await register(email, password, displayName);
    setBusy(false);
    if (ok) {
      toast.show(t('auth.welcomeBack', { name: useAuth.getState().user?.display_name ?? '' }));
      router.back();
    }
  };

  const inputStyle = [
    s.input,
    { color: c.text, borderColor: c.border, backgroundColor: c.surfaceRaised, fontSize: 15 * fs, fontFamily },
  ];
  const btnStyle = [s.primaryBtn, { backgroundColor: c.primary }];
  const btnTextStyle = [s.primaryBtnText, { fontSize: 15 * fs, fontFamily }];

  if (status === 'authed' && user) {
    return (
      <ScrollView style={[s.container, { backgroundColor: c.background }]}>
        <Text style={[s.title, { color: c.accent, fontSize: 24 * fs, fontFamily }]}>{t('auth.title')}</Text>
        <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[s.name, { color: c.text, fontSize: 18 * fs, fontFamily }]}>{user.display_name}</Text>
          <Text style={[s.email, { color: c.textMuted, fontSize: 13 * fs, fontFamily }]}>{user.email}</Text>
          <Text style={[s.hint, { color: c.textFaint, fontSize: 12 * fs, fontFamily }]}>{t('auth.linkedHint')}</Text>
          <Pressable
            style={[s.secondaryBtn, { borderColor: c.border }]}
            accessibilityRole="button"
            onPress={() => void logout().then(() => toast.show(t('auth.loggedOut')))}
          >
            <Text style={[s.secondaryBtnText, { color: c.text, fontSize: 14 * fs, fontFamily }]}>
              {t('auth.logout')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[s.container, { backgroundColor: c.background }]}>
      <Text style={[s.title, { color: c.accent, fontSize: 24 * fs, fontFamily }]}>{t('auth.title')}</Text>
      <Text style={[s.subtitle, { color: c.textMuted, fontSize: 13 * fs, fontFamily }]}>{t('auth.subtitle')}</Text>

      <View style={s.tabs}>
        {(['login', 'register'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[s.tab, mode === m && { backgroundColor: c.primary }]}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
          >
            <Text style={[s.tabText, { color: mode === m ? c.textOnAccent : c.text, fontSize: 14 * fs, fontFamily }]}>
              {m === 'login' ? t('auth.login') : t('auth.register')}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        {mode === 'register' && (
          <TextInput
            style={inputStyle}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('auth.displayName')}
            placeholderTextColor={c.textFaint}
            accessibilityLabel={t('auth.displayName')}
            maxLength={32}
            autoCapitalize="none"
          />
        )}
        <TextInput
          style={inputStyle}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.email')}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={t('auth.email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextInput
          style={inputStyle}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.password')}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={t('auth.password')}
          secureTextEntry
          autoCapitalize="none"
        />
        {error ? (
          <Text style={[s.error, { color: c.danger, fontSize: 12 * fs, fontFamily }]} accessibilityLiveRegion="polite">
            {t(error.startsWith('auth.') ? error : 'auth.registerFailed')}
          </Text>
        ) : null}
        <Pressable
          style={[btnStyle, busy && s.disabled]}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit()}
        >
          {busy ? (
            <ActivityIndicator color={c.textOnAccent} />
          ) : (
            <Text style={[btnTextStyle, { color: c.textOnAccent }]}>
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </Text>
          )}
        </Pressable>
        <Text style={[s.hint, { color: c.textFaint, fontSize: 12 * fs, fontFamily }]}>{t('auth.optionalHint')}</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontWeight: '700', marginBottom: 8 },
  subtitle: { marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  name: { fontWeight: '700' },
  email: {},
  hint: {},
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabText: { fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  primaryBtn: { borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontWeight: '600' },
  error: {},
  disabled: { opacity: 0.6 },
});
