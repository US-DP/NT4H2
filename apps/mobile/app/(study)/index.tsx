/**
 * /(study) — Taller de contenido.
 *
 * La URL canónica de una sección es /(study)/[tab]
 * (p. ej. "decks", "create", "sets"); el query ?tab= sigue.
 */

import { useLocalSearchParams } from 'expo-router';
import { StudyScreen } from '../../components/StudyScreen';

export default function StudyRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <StudyScreen initialTab={tab} />;
}
