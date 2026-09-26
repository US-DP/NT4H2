/**
 * turnNotify — aviso de "te toca" en partida online.
 *
 * Dos canales, ambos degradables en silencio:
 *  - Notification API (web): solo si el documento está oculto — pedir
 *    permiso la primera vez que ocurre la transición.
 *  - Beep corto sintetizado con WebAudio: sin assets, suena aunque la
 *    pestaña esté visible. En nativo es no-op (ya hay haptics).
 *
 * Respeta `reduceMotion`/ajustes: si el usuario silenció efectos de sonido
 * (volumeEffects=0), el beep no suena.
 */

import { Platform } from 'react-native';
import { useSettings } from '../store/settingsStore';
import i18n from './i18n';

let notifiedOnce = false;

function beep(): void {
  if (Platform.OS !== 'web') return;
  try {
    const s = useSettings.getState();
    const master = (s.volumeMaster ?? 100) / 100;
    const fx = (s.volumeEffects ?? 100) / 100;
    if (master * fx <= 0.01) return;
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12 * master * fx, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch { /* WebAudio bloqueado: silenciar */ }
}

/** Avisa al jugador de que es su turno. Idempotente por pestaña. */
export function notifyYourTurn(): void {
  beep();
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    if (!('Notification' in window)) return;
    const visible = document.visibilityState === 'visible';
    if (visible) return; // pestaña activa: el beep basta
    const fire = () => {
      // Una notificación por turno; se cierra sola al volver a la pestaña
      const n = new Notification(i18n.t('common.msg.notify.turnTitle'), {
        body: i18n.t('common.msg.notify.turnBody'),
        tag: 'nt4h-your-turn', // mismo tag → no se apilan
        silent: true, // el beep ya sonó
      });
      n.onclick = () => { window.focus(); n.close(); };
    };
    if (Notification.permission === 'granted') {
      fire();
    } else if (Notification.permission !== 'denied' && !notifiedOnce) {
      notifiedOnce = true;
      void Notification.requestPermission().then((p) => {
        if (p === 'granted') fire();
      });
    }
  } catch { /* permisos/iframe: ignorar */ }
}
