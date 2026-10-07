/**
 * Dev-only proxy for previewing the app in a desktop browser.
 *
 * expo-sqlite compiles to WebAssembly on web and needs SharedArrayBuffer, which
 * browsers only expose on cross-origin-isolated pages. Expo's dev server wraps
 * Metro with its own middleware stack, so `config.server.enhanceMiddleware` in
 * metro.config.js never reaches the response — this proxy adds the two required
 * headers in front of it, keeping hot reload intact.
 *
 * Usage: `npm run web` in one terminal, `npm run web:preview` in another,
 * then open http://localhost:8082. Not part of any build.
 */
import http from 'node:http';

const TARGET_PORT = Number(process.env.EXPO_PORT ?? 8081);
const PORT = Number(process.env.PREVIEW_PORT ?? 8082);

const ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: 'localhost', port: TARGET_PORT, path: req.url, method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, {
        ...upstreamRes.headers,
        ...ISOLATION_HEADERS,
      });
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'text/plain', ...ISOLATION_HEADERS });
    res.end(`Metro nu raspunde pe :${TARGET_PORT}. Porneste "npm run web" intai.\n${error.message}`);
  });

  req.pipe(upstream);
});

// Metro pushes hot reload over websockets; the upgrade has to be forwarded too.
server.on('upgrade', (req, socket, head) => {
  const upstream = http.request({
    host: 'localhost',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });

  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = Object.entries(upstreamRes.headers).map(([k, v]) => `${k}: ${v}`);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead?.length) socket.unshift(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstream.on('error', () => socket.destroy());
  if (head?.length) upstream.write(head);
  upstream.end();
});

server.listen(PORT, () => {
  console.log(`Cerebro web preview: http://localhost:${PORT}  (proxy -> :${TARGET_PORT})`);
});
