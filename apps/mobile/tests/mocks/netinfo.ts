/** Mock de @react-native-community/netinfo — siempre conectado en tests. */

const listeners = new Set<(state: unknown) => void>();

const connectedState = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
};

export default {
  addEventListener: (cb: (state: unknown) => void) => {
    listeners.add(cb);
    cb(connectedState);
    return () => listeners.delete(cb);
  },
  fetch: async () => connectedState,
  __setState: (state: unknown) => listeners.forEach((cb) => cb(state)),
};
