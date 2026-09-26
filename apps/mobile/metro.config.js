/**
 * Metro config — resuelve extensiones .js a .ts para compatibilidad
 * con paquetes TypeScript ESM del monorepo que usan `from './x.js'`.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

// Servir apps/mobile/public/ en desarrollo (Expo solo lo copia en export).
// Así las imágenes de cartas viven en public/assets/cards y la URL
// /assets/cards/... funciona igual en dev y en producción.
const publicDir = path.join(__dirname, 'public');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };

config.server = config.server || {};
const prevEnhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const inner = prevEnhance ? prevEnhance(middleware, server) : middleware;
  return (req, res, next) => {
    if (req.url && !req.url.startsWith('/assets/__') && req.method === 'GET') {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(publicDir, path.normalize(urlPath).replace(/^(\.\.[\\/])+/, ''));
      if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
        return fs.createReadStream(filePath).pipe(res);
      }
    }
    return inner(req, res, next);
  };
};

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
