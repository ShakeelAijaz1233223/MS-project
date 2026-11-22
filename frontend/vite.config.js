import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendEntry = path.resolve(__dirname, '../backend/src/server.js');
const backendCwd = path.resolve(__dirname, '../backend');
const backendTarget = process.env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:4000';

// Clean custom Vite logger that suppresses noisy red ECONNREFUSED stack dumps during warm-up
const baseLogger = createLogger();
const cleanViteLogger = {
  ...baseLogger,
  error(msg, options) {
    if (typeof msg === 'string' && msg.includes('http proxy error:')) {
      return;
    }
    baseLogger.error(msg, options);
  },
};

function checkTcpOpen(host, port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.connect(port, host);
  });
}

// Companion backend auto-start is OPT-IN ONLY (V10.0).
// It runs ONLY when ULTRA_AUTO_BACKEND=1 (or VITE_AUTO_BACKEND=1) is set, e.g.:
//   ULTRA_AUTO_BACKEND=1 npm run dev
// By default the Vite dev server does NOT touch the backend: start it yourself with
// `npm run dev` in backend/. This plugin NEVER runs `npm install` — install
// dependencies explicitly with `npm install` in backend/ and frontend/ first.
const AUTO_BACKEND_ENABLED =
  process.env.ULTRA_AUTO_BACKEND === '1' || process.env.VITE_AUTO_BACKEND === '1';

function autoStartBackendCompanionPlugin() {
  let companionProc = null;
  let shuttingDown = false;

  const launchBackendProcess = () => {
    if (shuttingDown) return;
    companionProc = spawn(process.execPath, [backendEntry], {
      cwd: backendCwd,
      stdio: 'inherit',
      windowsHide: true,
    });
    companionProc.once('exit', (code) => {
      companionProc = null;
      if (!shuttingDown && code !== 0) {
        setTimeout(launchBackendProcess, 1500);
      }
    });
  };

  return {
    name: 'ultradownloader-auto-backend-companion',
    async configureServer(server) {
      if (!AUTO_BACKEND_ENABLED) {
        console.log(
          '[UltraDownloader] Auto-backend disabled — start backend separately with npm run dev in backend/'
        );
        return;
      }
      const targetUrl = new URL(backendTarget);
      const port = Number(targetUrl.port || 4000);
      const host = targetUrl.hostname || '127.0.0.1';

      const alreadyUp = await checkTcpOpen(host, port);
      if (!alreadyUp) {
        console.log(
          `[UltraDownloader] Auto-starting companion Backend API on http://${host}:${port} ...`
        );
        launchBackendProcess();
        for (let i = 0; i < 40; i++) {
          if (await checkTcpOpen(host, port, 300)) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      const cleanup = () => {
        shuttingDown = true;
        if (companionProc && !companionProc.killed) {
          companionProc.kill('SIGTERM');
          companionProc = null;
        }
      };
      server.httpServer?.once('close', cleanup);
    },
  };
}

function attachQuietProxyGuard(proxy) {
  proxy.on('error', (_err, _req, res) => {
    if (res && !res.headersSent && typeof res.writeHead === 'function') {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'BACKEND_STARTING',
            message: 'Backend API on port 4000 is warming up — please retry in 1 second.',
          },
        })
      );
    }
  });
}

export default defineConfig({
  customLogger: cleanViteLogger,
  plugins: [react(), autoStartBackendCompanionPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        configure: attachQuietProxyGuard,
      },
      '/sitemap.xml': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        configure: attachQuietProxyGuard,
      },
      '/robots.txt': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
        configure: attachQuietProxyGuard,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-router-dom', 'react-dom'],
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion', 'lucide-react'],
          'vendor-player': ['hls.js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.js'],
    testTimeout: 30000,
  },
});
