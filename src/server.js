import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { DramaService, ScrapeError } from './drama-service.js';

function hasValidRefreshToken(request, expectedToken) {
  if (!expectedToken) return true;
  const suppliedToken = request.get('x-refresh-token') || '';
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function corsMiddleware(corsOrigins) {
  return (request, response, next) => {
    const origin = request.get('origin');
    if (corsOrigins.includes('*')) {
      response.set('Access-Control-Allow-Origin', '*');
    } else if (origin && corsOrigins.includes(origin)) {
      response.set('Access-Control-Allow-Origin', origin);
      response.append('Vary', 'Origin');
    }

    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, X-Refresh-Token');
    response.set('Access-Control-Max-Age', '86400');

    if (request.method === 'OPTIONS') return response.status(204).end();
    return next();
  };
}

export function createApp({ appConfig = config, dramaService = new DramaService(appConfig) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware(appConfig.corsOrigins));
  app.use((_, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  app.get('/', (_, response) => {
    response.json({
      service: 'shortdrama-scraper',
      description: 'MicroTV homepage title and poster URL API',
      endpoints: {
        dramas: 'GET /api/dramas',
        refresh: 'POST /api/dramas/refresh',
        health: 'GET /api/health',
      },
    });
  });

  app.get('/api/health', (_, response) => {
    response.json({
      ok: true,
      source: appConfig.sourceUrl.toString(),
      cache: dramaService.getStatus(),
    });
  });

  app.get('/api/dramas', async (_, response, next) => {
    try {
      const result = await dramaService.getDramas();
      response.set('X-Data-Cache', result.cache);
      response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/dramas/refresh', async (request, response, next) => {
    if (!hasValidRefreshToken(request, appConfig.refreshToken)) {
      return response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid X-Refresh-Token header is required.',
        },
      });
    }

    try {
      const result = await dramaService.getDramas({ force: true });
      response.set('X-Data-Cache', result.cache);
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.use((_, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });

  app.use((error, _, response, __) => {
    const isScrapeError = error instanceof ScrapeError;
    const status = isScrapeError ? error.statusCode : 500;
    if (status >= 500) console.error(error);

    response.status(status).json({
      error: {
        code: isScrapeError ? 'SCRAPE_FAILED' : 'INTERNAL_ERROR',
        message: isScrapeError ? error.message : 'Unexpected server error.',
      },
    });
  });

  return app;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Short drama scraper API listening on port ${config.port}`);
  });
}
