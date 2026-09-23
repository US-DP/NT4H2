/**
 * Pantalla de creación de partida.
 */

import { View, StyleSheet } from 'react-native';
import { CreateGameFlow } from '../../components/CreateGameFlow';
import { AppNav } from '../../components/AppNav';

export default function CreateGameScreen() {
  return (
    <View style={styles.container}>
      <CreateGameFlow />
      <AppNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
