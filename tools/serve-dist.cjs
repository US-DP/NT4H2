// Servidor estático mínimo para el build `expo export` (dist/) con
// fallback SPA a index.html — lo usa la suite E2E contra E2E_BASE_URL.
// El bundle lee process.env.EXPO_PUBLIC_* en runtime (sin inlinear), así
// que inyectamos un shim compatible con el guard de producción de
// lib/config.ts (https/wss).
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'apps', 'mobile', 'dist');
const port = Number(process.env.PORT || 8100);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

const ENV_SHIM = '<script>var process={env:{NODE_ENV:"production",EXPO_PUBLIC_API_URL:"https://localhost:8099",EXPO_PUBLIC_WS_URL:"wss://localhost:8099"}};</script>';
let indexHtml;
const getIndex = () => {
  if (!indexHtml) {
    indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('<head>', '<head>' + ENV_SHIM);
  }
  return indexHtml;
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getIndex()); // fallback SPA
    return;
  }
  if (path.basename(file) === 'index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getIndex());
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist en http://localhost:${port}`));
