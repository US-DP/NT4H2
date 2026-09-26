/**
 * audio — gestor de sonido NT4H sobre expo-audio.
 *
 * Canales separados (música / efectos / interfaz), carga diferida para no
 * retrasar el arranque, y respeto a los ajustes de accesibilidad:
 * `volumeMaster`, `volumeMusic`, `volumeEffects` del settingsStore.
 *
 * En web o si el módulo nativo no está disponible, todas las llamadas
 * son no-ops seguros.
 *
 * Uso:
 *   import { playEffect, playUi } from '../lib/audio';
 *   playEffect('attack');
 *   playUi('confirm');
 */

import { Platform } from 'react-native';
import { useSettings } from '../store/settingsStore';
import { hapticError, hapticPlay, hapticSelect } from './haptics';

type Channel = 'music' | 'effects' | 'ui';

interface SoundSlot {
  player: unknown;
  channel: Channel;
  baseVolume: number;
}

const slots = new Map<string, SoundSlot>();
const isNative = Platform.OS !== 'web';

// Carga perezosa del módulo — evita fallos en web/tests donde el nativo
// no existe.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const expoAudio = () => require('expo-audio') as typeof import('expo-audio');

function channelVolume(channel: Channel): number {
  const s = useSettings.getState();
  const master = (s.volumeMaster ?? 100) / 100;
  switch (channel) {
    case 'music': return master * ((s.volumeMusic ?? 50) / 100);
    case 'effects':
    case 'ui': return master * ((s.volumeEffects ?? 100) / 100);
  }
}

/**
 * Registra una fuente de audio bajo una clave. El archivo se carga la
 * primera vez que se reproduce (lazy) para no penalizar el arranque.
 * `source` es un require() de asset o { uri }.
 */
const registry = new Map<string, { source: number | { uri: string }; channel: Channel; baseVolume: number }>();

export function registerSound(
  key: string,
  source: number | { uri: string },
  channel: Channel = 'effects',
  baseVolume = 1,
): void {
  registry.set(key, { source, channel, baseVolume });
}

// ── Efectos sintetizados (web, sin assets) ───────────────────────────────
// Fallback de playSound: en web no hay expo-audio ni ficheros de sonido,
// así que cada clave se traduce a un tono corto generado con WebAudio.
// En nativo se siguen usando los sonidos registrados con registerSound.
const WEB_TONES: Record<string, { freq: number; ms: number; type: OscillatorType }> = {
  'card-play': { freq: 620, ms: 90, type: 'triangle' },
  confirm: { freq: 880, ms: 70, type: 'sine' },
  error: { freq: 180, ms: 160, type: 'sawtooth' },
  attack: { freq: 330, ms: 110, type: 'square' },
  buy: { freq: 990, ms: 80, type: 'sine' },
};

function playWebTone(key: string, channel: Channel): void {
  const tone = WEB_TONES[key];
  if (!tone) return;
  const Ctx = ((globalThis as unknown as { window?: WindowWithAudio }).window
    ?? (globalThis as unknown as WindowWithAudio));
  const AC = Ctx?.AudioContext ?? Ctx?.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.value = tone.freq;
    gain.gain.value = Math.min(0.3, channelVolume(channel) * 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + tone.ms / 1000);
    osc.stop(ctx.currentTime + tone.ms / 1000 + 0.02);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch { /* WebAudio no disponible */ }
}

/** Reproduce un efecto registrado. No-op si no hay módulo o está muteado. */
export function playSound(key: string): void {
  if (!isNative) {
    // Web: tono sintetizado según la clave (canal por prefijo semántico —
    // 'error'/'confirm' suenan por el canal UI, el resto por efectos).
    playWebTone(key, key === 'error' || key === 'confirm' ? 'ui' : 'effects');
    return;
  }
  const reg = registry.get(key);
  if (!reg) {
    // Sin asset registrado: en nativo la respuesta cae a háptica
    // (expo-haptics instalado) para que la acción tenga feedback
    // aunque aún no existan ficheros de sonido reales.
    if (key === 'error') hapticError();
    else if (key === 'confirm' || key === 'card-play' || key === 'attack' || key === 'buy') hapticPlay();
    else hapticSelect();
    return;
  }
  try {
    const { createAudioPlayer } = expoAudio();
    const slot = slots.get(key);
    const player = (slot?.player ?? createAudioPlayer(reg.source)) as {
      volume: number;
      seekTo: (s: number) => void;
      play: () => void;
    };
    if (!slot) slots.set(key, { player, channel: reg.channel, baseVolume: reg.baseVolume });
    player.volume = Math.min(1, channelVolume(reg.channel) * reg.baseVolume);
    player.seekTo(0);
    player.play();
  } catch {
    // Módulo no disponible o fuente inválida — silenciar el fallo
  }
}

/** Atajos semánticos por canal. */
export const playEffect = (key: string) => playSound(key);
export const playUi = (key: string) => playSound(key);

// ── Música ambiental generativa (web) ────────────────────────────────────
// Sin assets licenciados: un pad de 3 osciladores senoidales (Am add9) con
// filtro paso bajo y LFO de "respiración" — sintetizado al vuelo con
// WebAudio. En nativo es no-op hasta disponer de assets de audio reales.

interface AmbientHandle {
  ctx: AudioContext;
  gain: GainNode;
  oscs: OscillatorNode[];
  lfo: OscillatorNode;
  volumeTimer: ReturnType<typeof setInterval>;
}

let ambient: AmbientHandle | null = null;

type WindowWithAudio = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

/** Arranca la música ambiental (web). Respeta `backgroundMusic` + volumen. */
export function startAmbientMusic(): void {
  if (Platform.OS !== 'web' || ambient) return;
  const s = useSettings.getState();
  if (s.backgroundMusic === false) return;
  const Ctx = ((globalThis as unknown as { window?: WindowWithAudio }).window
    ?? (globalThis as unknown as WindowWithAudio));
  const AC = Ctx?.AudioContext ?? Ctx?.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    // Autoplay: el contexto arranca suspendido hasta el primer gesto del usuario
    if (ctx.state === 'suspended') {
      const resume = () => { void ctx.resume(); };
      globalThis.addEventListener?.('pointerdown', resume, { once: true });
      globalThis.addEventListener?.('keydown', resume, { once: true });
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    // Respiración: LFO lento sobre la ganancia del pad
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain);
    const oscs = [110, 164.81, 246.94].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    const target = Math.min(0.25, channelVolume('music') * 0.25);
    lfoGain.connect(gain.gain);
    filter.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, target), ctx.currentTime + 3);
    lfo.start();
    // El volumen del ajuste se re-lee cada pocos segundos (fade suave)
    const volumeTimer = setInterval(() => {
      const v = Math.min(0.25, channelVolume('music') * 0.25);
      gain.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.5);
    }, 3000);
    ambient = { ctx, gain, oscs, lfo, volumeTimer };
  } catch {
    ambient = null; // WebAudio no disponible
  }
}

/** Detiene la música ambiental con fundido de salida. */
export function stopAmbientMusic(): void {
  const h = ambient;
  ambient = null;
  if (!h) return;
  try {
    clearInterval(h.volumeTimer);
    h.gain.gain.setTargetAtTime(0.0001, h.ctx.currentTime, 0.4);
    setTimeout(() => {
      for (const o of h.oscs) { try { o.stop(); } catch { /* noop */ } }
      try { h.lfo.stop(); } catch { /* noop */ }
      void h.ctx.close().catch(() => undefined);
    }, 1200);
  } catch { /* noop */ }
}
