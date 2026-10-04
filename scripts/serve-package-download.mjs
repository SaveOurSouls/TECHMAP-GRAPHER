import { createReadStream, lstatSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, resolve } from 'node:path';

const usage = 'Usage: node scripts/serve-package-download.mjs <archive.zip> [port]';
const archiveNamePattern = /^TECHMAP-GRAPHER-\d+\.\d+\.\d+(?:-[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)?(?:\+[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)?-win-x64\.zip$/;

function fail(message) {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode = 1;
}

const [, , archiveArgument, portArgument] = process.argv;

if (!archiveArgument || process.argv.length > 4) {
  fail('Expected one archive path and an optional port.');
} else {
  const portIsDecimal = portArgument === undefined || /^(?:0|[1-9]\d*)$/.test(portArgument);
  const requestedPort = portArgument === undefined ? 0 : Number(portArgument);

  if (!portIsDecimal || !Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    fail('Port must be an integer from 0 to 65535.');
  } else {
    const archivePath = resolve(archiveArgument);
    const archiveName = basename(archivePath);
    let archiveStat;

    try {
      archiveStat = lstatSync(archivePath, { bigint: true });
    } catch {
      fail('The archive could not be found or read.');
    }

    if (!archiveStat) {
      // Validation already reported the archive lookup error.
    } else if (!archiveStat.isFile() || !archiveNamePattern.test(archiveName)) {
      fail('The archive must be a regular file named TECHMAP-GRAPHER-<version>-win-x64.zip.');
    } else {
      const byteCount = archiveStat.size;
      const formattedByteCount = new Intl.NumberFormat('ru-RU').format(byteCount);
      const downloadPath = `/download/${encodeURIComponent(archiveName)}`;
      const page = Buffer.from(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Скачать TECHMAP-GRAPHER</title>
  <style>
    body { margin: 0; padding: 2rem; color: #202522; background: #f2f4f2; font: 16px/1.5 system-ui, sans-serif; }
    main { max-width: 42rem; margin: 8vh auto; padding: 1.5rem; background: #fff; border: 1px solid #d7ddd8; border-radius: 6px; }
    h1 { margin-top: 0; font-size: 1.4rem; }
    code { overflow-wrap: anywhere; }
    a { display: inline-block; margin-top: .75rem; padding: .65rem 1rem; color: #fff; background: #176b50; border-radius: 4px; text-decoration: none; }
    a:focus-visible { outline: 3px solid #1464a5; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Скачать TECHMAP-GRAPHER</h1>
    <p><code>${escapeHtml(archiveName)}</code></p>
    <p>Размер: ${formattedByteCount} байт</p>
    <a href="${escapeHtml(downloadPath)}" download="${escapeHtml(archiveName)}">Скачать ZIP</a>
  </main>
</body>
</html>`);

      const server = createServer((request, response) => {
        let pathname;

        try {
          pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        } catch {
          response.writeHead(400, { 'Content-Length': '0', 'X-Content-Type-Options': 'nosniff' });
          response.end();
          return;
        }

        const method = request.method;
        if (method !== 'GET' && method !== 'HEAD') {
          response.writeHead(405, {
            Allow: 'GET, HEAD',
            'Content-Length': '0',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end();
          return;
        }

        if (pathname === '/') {
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': String(page.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(method === 'HEAD' ? undefined : page);
          return;
        }

        if (pathname === downloadPath) {
          response.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': String(byteCount),
            'Content-Disposition': `attachment; filename="${archiveName}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });

          if (method === 'HEAD') {
            response.end();
            return;
          }

          const archiveStream = createReadStream(archivePath);
          archiveStream.on('error', () => {
            if (!response.headersSent) {
              response.writeHead(500, {
                'Content-Length': '0',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              });
              response.end();
            } else {
              response.destroy();
            }
          });
          response.on('close', () => archiveStream.destroy());
          archiveStream.pipe(response);
          return;
        }

        response.writeHead(404, {
          'Content-Length': '0',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end();
      });

      server.on('error', () => {
        process.stderr.write('The download server could not start.\n');
        process.exitCode = 1;
      });

      server.listen(requestedPort, '127.0.0.1', () => {
        const address = server.address();
        process.stdout.write(`Serving ${archiveName}\nhttp://127.0.0.1:${address.port}/\nPress Ctrl+C to stop.\n`);
      });

      process.once('SIGINT', () => {
        server.close(() => process.exit(0));
      });
    }
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}
