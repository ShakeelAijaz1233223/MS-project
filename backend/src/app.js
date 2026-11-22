import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ENV } from './config/env.js';
import { attachRequestContext } from './middleware/securityMiddleware.js';
import { trackBackendTxRxMiddleware } from './services/trafficEngine.js';
import { publicRouter } from './routes/publicRoutes.js';
import { adminRouter } from './routes/adminRoutes.js';
import { seoSitemapRouter } from './routes/seoSitemapRoutes.js';
import { AppError, sendError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export function isTrustedCorsOrigin(origin) {
  if (!origin) return true;
  if (ENV.CORS_ORIGINS.includes(origin)) return true;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  // Allow Arena / E2B live preview origins over HTTPS
  if (parsed.protocol === 'https:' && (host === 'e2b.app' || host.endsWith('.e2b.app'))) {
    return true;
  }

  // Allow localhost / loopback dev servers only in non-production environments
  if (!ENV.IS_PRODUCTION && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) {
    return true;
  }

  return false;
}

export function createBackendApp() {
  const app = express();
  app.set('trust proxy', ENV.TRUST_PROXY);

  // Measure real-time RX (Receive) & TX (Send) bandwidth + latency on every socket chunk
  app.use(trackBackendTxRxMiddleware);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
      frameguard: ENV.IS_PRODUCTION ? { action: 'sameorigin' } : false,
    })
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        if (isTrustedCorsOrigin(origin)) {
          return cb(null, true);
        }
        return cb(null, false);
      },
      credentials: true,
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
    })
  );

  // Skip gzip on SSE & binary MP4/HLS streams so zero CPU overhead bottlenecks streaming
  app.use(
    compression({
      filter: (req, res) => {
        if (
          req.path.includes('/live-cards/stream') ||
          req.path.includes('/downloads/') ||
          req.path.includes('/stream/') ||
          req.path.includes('/files/download')
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '4mb' }));
  app.use(attachRequestContext);

  // High-Traffic Rate Limiter (1,200 req/min burst safe per IP)
  const publicApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => ENV.NODE_ENV === 'test',
  });
  app.use('/api/v1', publicApiLimiter);

  app.use('/', seoSitemapRouter);
  app.use('/api/v1', publicRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use('/api', (req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', `API endpoint ${req.method} ${req.originalUrl} does not exist.`));
  });

  app.use((err, req, res, _next) => {
    if (!err.statusCode || err.statusCode >= 500) {
      logger.error({ err, path: req.originalUrl }, 'Unhandled server error');
    }
    return sendError(res, err);
  });

  return app;
}
