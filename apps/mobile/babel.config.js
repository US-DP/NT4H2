module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Unistyles 3: procesa StyleSheet.create(theme => …) y useVariants.
      // Sin este plugin los estilos quedan vacíos — los NtButton se veían
      // como texto plano sin fondo en web (botones "invisibles" en salas).
      // root = apps/mobile: fuera de la raíz el plugin no transforma.
      ['react-native-unistyles/plugin', { root: 'apps/mobile' }],
      // Reanimated: necesario en builds nativos (web no lo usa, es inocuo)
      'react-native-reanimated/plugin',
    ],
  };
};
