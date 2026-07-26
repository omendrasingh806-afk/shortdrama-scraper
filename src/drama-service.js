import { assertMicroTvUrl } from './config.js';
import { isAllowedByRobots } from './robots.js';
import { extractDramas } from './scraper.js';

export class ScrapeError extends Error {
  constructor(message, { statusCode = 502, cause } = {}) {
    super(message, { cause });
    this.name = 'ScrapeError';
    this.statusCode = statusCode;
  }
}

function isMicroTvResponseUrl(value) {
  try {
    assertMicroTvUrl(value);
    return true;
  } catch {
    return false;
  }
}

async function readBody(response, maxBytes) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ScrapeError('The source response is larger than the configured limit.');
  }

  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw new ScrapeError('The source response is larger than the configured limit.');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError('Could not read the source response.', { cause: error });
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function requestText(url, config) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': config.userAgent,
      },
    });
  } catch (error) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new ScrapeError(isTimeout ? 'The source request timed out.' : 'Could not reach the source site.', {
      cause: error,
    });
  }

  if (!isMicroTvResponseUrl(response.url)) {
    throw new ScrapeError('The source redirected outside of an approved MicroTV host.');
  }

  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    text: await readBody(response, config.maxHtmlBytes),
  };
}

function robotsUrlFor(sourceUrl) {
  const robotsUrl = new URL(sourceUrl);
  robotsUrl.pathname = '/robots.txt';
  robotsUrl.search = '';
  robotsUrl.hash = '';
  return robotsUrl;
}

async function checkRobots(config) {
  if (!config.respectRobots) return;

  try {
    const robots = await requestText(robotsUrlFor(config.sourceUrl), config);
    // A missing robots.txt means crawling is allowed. For an unavailable robots
    // file we continue, because the homepage request will still report its own
    // concrete failure to the API caller.
    if (robots.status === 404 || robots.status === 410 || !robots.ok) return;

    if (!isAllowedByRobots(robots.text, config.sourceUrl, 'shortdramascraper')) {
      throw new ScrapeError('The source site robots.txt does not allow homepage scraping.', {
        statusCode: 503,
      });
    }
  } catch (error) {
    if (error instanceof ScrapeError && error.statusCode === 503) throw error;
    console.warn('robots.txt could not be checked; continuing with homepage request.', error.message);
  }
}

export class DramaService {
  constructor(config) {
    this.config = config;
    this.cache = null;
    this.inFlight = null;
  }

  async getDramas({ force = false } = {}) {
    const now = Date.now();
    if (this.cache && !force && now - this.cache.fetchedAtMs < this.config.cacheTtlMs) {
      return this.#format(this.cache, 'HIT');
    }

    if (!this.inFlight) {
      this.inFlight = this.#refresh().finally(() => {
        this.inFlight = null;
      });
    }

    try {
      const cache = await this.inFlight;
      return this.#format(cache, 'REFRESHED');
    } catch (error) {
      const staleAge = this.cache ? Date.now() - this.cache.fetchedAtMs : Number.POSITIVE_INFINITY;
      if (this.cache && staleAge <= this.config.staleCacheMs) {
        console.warn('Serving stale drama cache after scrape failure.', error.message);
        return this.#format(this.cache, 'STALE', true);
      }
      throw error;
    }
  }

  getStatus() {
    return {
      cached: Boolean(this.cache),
      fetchedAt: this.cache ? new Date(this.cache.fetchedAtMs).toISOString() : null,
      count: this.cache?.dramas.length ?? 0,
    };
  }

  async #refresh() {
    await checkRobots(this.config);
    const response = await requestText(this.config.sourceUrl, this.config);

    if (!response.ok) {
      throw new ScrapeError(`The source homepage returned HTTP ${response.status}.`);
    }
    if (response.contentType && !/html|xhtml/i.test(response.contentType)) {
      throw new ScrapeError('The source homepage did not return HTML.');
    }

    const dramas = extractDramas(response.text, this.config.sourceUrl);
    if (dramas.length === 0) {
      throw new ScrapeError('No drama title/poster cards were found on the source homepage.');
    }

    this.cache = { dramas, fetchedAtMs: Date.now() };
    return this.cache;
  }

  #format(cache, cacheState, stale = false) {
    return {
      source: this.config.sourceUrl.toString(),
      count: cache.dramas.length,
      fetchedAt: new Date(cache.fetchedAtMs).toISOString(),
      cache: cacheState,
      stale,
      dramas: cache.dramas,
    };
  }
}
