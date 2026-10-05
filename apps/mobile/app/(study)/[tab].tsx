/**
 * /(study)/[tab] — sección concreta del Taller.
 * Renderiza el Taller con la pestaña ya seleccionada.
 */

import { useLocalSearchParams } from 'expo-router';
import { StudyScreen } from '../../components/StudyScreen';

export default function StudyTabRoute() {
  const { tab, deckId } = useLocalSearchParams<{ tab: string; deckId?: string }>();
  return <StudyScreen initialTab={tab} editDeckId={deckId} />;
}
