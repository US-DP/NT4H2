/**
 * /(study)/[tab] — sección concreta del Taller.
 * Renderiza el Taller con la pestaña ya seleccionada.
 */

import { useLocalSearchParams } from 'expo-router';
import { StudyScreen } from '../../components/StudyScreen';

export default function StudyTabRoute() {
  const { tab } = useLocalSearchParams<{ tab: string }>();
  return <StudyScreen initialTab={tab} />;
}
