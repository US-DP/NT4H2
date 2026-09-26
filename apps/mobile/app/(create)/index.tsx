/**
 * Pantalla de creación de partida.
 */

import { View, StyleSheet } from 'react-native';
import { CreateGameFlow } from '../../components/CreateGameFlow';
import { AppNav, useNavSidebarWidth } from '../../components/AppNav';

export default function CreateGameScreen() {
  const navWidth = useNavSidebarWidth();
  return (
    <View style={styles.container}>
      <View style={[styles.content, { marginLeft: navWidth }]}>
        <CreateGameFlow />
      </View>
      <AppNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
