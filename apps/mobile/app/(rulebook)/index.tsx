/**
 * /(rulebook) — reglamento.
 *
 * La URL canónica de una regla es la ruta anidada
 * /(rulebook)/[rule]; el query ?rule= sigue funcionando.
 */

import { useLocalSearchParams } from 'expo-router';
import { RulebookScreen } from '../../components/RulebookScreen';

export default function RulebookRoute() {
  const { rule } = useLocalSearchParams<{ rule?: string }>();
  return <RulebookScreen initialRule={rule} />;
}
