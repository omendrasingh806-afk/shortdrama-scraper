import 'dotenv/config';

const SOURCE_HOSTS = new Set(['microtv.st', 'www.microtv.st']);

function readInteger(name, fallback, { min, max }) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

export function assertMicroTvUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SOURCE_URL must be an absolute URL.');
  }

  if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('SOURCE_URL must use HTTPS and point to microtv.st or www.microtv.st.');
  }

  return url;
}

function parseOrigins(value) {
  if (!value || value.trim() === '*') return ['*'];

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
      }
    });
}

const sourceUrl = assertMicroTvUrl(process.env.SOURCE_URL || 'https://microtv.st/');

export const config = Object.freeze({
  port: readInteger('PORT', 3000, { min: 1, max: 65535 }),
  sourceUrl,
  cacheTtlMs: readInteger('CACHE_TTL_SECONDS', 900, { min: 1, max: 86400 }) * 1000,
  staleCacheMs: readInteger('STALE_CACHE_SECONDS', 86400, { min: 1, max: 604800 }) * 1000,
  timeoutMs: readInteger('REQUEST_TIMEOUT_MS', 20000, { min: 1000, max: 60000 }),
  maxHtmlBytes: readInteger('MAX_HTML_BYTES', 5 * 1024 * 1024, {
    min: 1024,
    max: 25 * 1024 * 1024,
  }),
  respectRobots: readBoolean('RESPECT_ROBOTS', true),
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN || '*'),
  refreshToken: process.env.REFRESH_TOKEN || '',
  userAgent:
    process.env.SCRAPER_USER_AGENT ||
    'ShortDramaScraper/1.0 (+https://github.com/omendrasingh806-afk/shortdrama-scraper)',
});
