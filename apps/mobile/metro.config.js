/**
 * Metro config — resuelve extensiones .js a .ts para compatibilidad
 * con paquetes TypeScript ESM del monorepo que usan `from './x.js'`.
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Asegurar que .ts y .tsx se resuelven antes que .js
config.resolver.sourceExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs'];

// Resolver personalizado: cuando un import relativo termina en .js
// y el archivo .js no existe, reescribirlo sin extension para que
// Metro lo resuelva via sourceExts (.ts, .tsx, etc.)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Solo reescribir imports relativos con extension .js
  if (
    (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
    (moduleName.endsWith('.js') || moduleName.endsWith('.mjs'))
  ) {
    const stripped = moduleName.replace(/\.(js|mjs)$/, '');
    // Intentar resolver sin la extension .js
    const newContext = {
      ...context,
      // Evitar recursion infinita
      unstable_enablePackageExports: context.unstable_enablePackageExports,
    };
    try {
      const result = context.resolveRequest(newContext, stripped, platform);
      if (result) return result;
    } catch {
      // continuar con resolucion normal
    }
  }
  // Resolucion normal
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
