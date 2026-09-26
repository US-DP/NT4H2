/**
 * Mock de expo-audio para tests: players inertes.
 */

export const createAudioPlayer = () => ({
  volume: 1,
  seekTo: () => {},
  play: () => {},
  pause: () => {},
  remove: () => {},
});
export const setAudioModeAsync = async () => {};
export const useAudioPlayer = () => createAudioPlayer();
