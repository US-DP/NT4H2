module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated: necesario en builds nativos (web no lo usa, es inocuo)
      'react-native-reanimated/plugin',
    ],
  };
};
