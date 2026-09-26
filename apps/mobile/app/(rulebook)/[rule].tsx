/**
 * /(rulebook)/[rule] — ruta canónica de una regla concreta.
 * Renderiza la misma pantalla con la regla ya abierta.
 */

import { useLocalSearchParams } from 'expo-router';
import { RulebookScreen } from '../../components/RulebookScreen';

export default function RuleDeepLink() {
  const { rule } = useLocalSearchParams<{ rule: string }>();
  return <RulebookScreen initialRule={rule} />;
}
