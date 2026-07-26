# Short Drama Scraper API

**Backend-only** Node.js API for the `https://microtv.st/` homepage. It finds the drama cards currently present on that homepage and returns:

- drama title
- remote poster URL
- original MicroTV detail-page URL

The service does **not** download, host, stream, or expose video files. Poster URLs point to the source site's existing image files.

## API

### `GET /api/dramas`

Fetches the MicroTV homepage on the first request, extracts its title/poster cards, and keeps the result in memory for 15 minutes by default.

```bash
curl https://YOUR-RENDER-SERVICE.onrender.com/api/dramas
```

Example response:

```json
{
  "source": "https://microtv.st/",
  "count": 2,
  "fetchedAt": "2026-07-26T12:00:00.000Z",
  "cache": "REFRESHED",
  "stale": false,
  "dramas": [
    {
      "id": "6eac5279a5741d2b",
      "title": "The DNA That Broke Everything Full Episode",
      "poster": "https://microtv.st/path/to/poster.webp",
      "url": "https://microtv.st/the-dna-that-broke-everything"
    }
  ]
}
```

`cache` is one of:

- `REFRESHED` — a new homepage scrape succeeded.
- `HIT` — data came from the fresh in-memory cache.
- `STALE` — the source could not be refreshed, so the most recent successful result is returned (up to `STALE_CACHE_SECONDS`).

### `POST /api/dramas/refresh`

Forces a fresh homepage scrape:

```bash
curl -X POST https://YOUR-RENDER-SERVICE.onrender.com/api/dramas/refresh \
  -H 'X-Refresh-Token: YOUR_REFRESH_TOKEN'
```

When `REFRESH_TOKEN` is not configured, this route is open. On Render, the included blueprint creates a token automatically, so send it in `X-Refresh-Token`.

### `GET /api/health`

Render health-check endpoint. It does not make a source-site request, so it remains fast and reliable:

```bash
curl https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

## Local setup

```bash
cp .env.example .env
npm install
npm start
```

Then use `http://localhost:3000/api/dramas`.

Run the parser and robots-policy tests:

```bash
npm test
```

## Render deployment

1. Push this repository to GitHub.
2. In Render, choose **New +** → **Blueprint** and select this repository.
3. Render reads [`render.yaml`](./render.yaml), installs dependencies with `npm ci`, and starts the API with `npm start`.
4. After deployment, open `https://YOUR-SERVICE.onrender.com/api/health`, then `https://YOUR-SERVICE.onrender.com/api/dramas`.
5. Copy the generated `REFRESH_TOKEN` from Render's Environment page if you want to call the forced-refresh endpoint.

Render supplies the `PORT` environment variable automatically. No frontend or static site is required.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port; Render overrides it. |
| `SOURCE_URL` | `https://microtv.st/` | Homepage to scrape. For safety, only `microtv.st` and `www.microtv.st` are accepted. |
| `CACHE_TTL_SECONDS` | `900` | Fresh in-memory cache period. |
| `STALE_CACHE_SECONDS` | `86400` | How long the last successful list can be used after a scrape failure. |
| `REQUEST_TIMEOUT_MS` | `20000` | Source request timeout. |
| `MAX_HTML_BYTES` | `5242880` | Maximum homepage response size accepted. |
| `RESPECT_ROBOTS` | `true` | Refuse scraping when `robots.txt` disallows this scraper. |
| `CORS_ORIGIN` | `*` | `*` or a comma-separated list of allowed browser origins. |
| `REFRESH_TOKEN` | empty | Optional secret for `POST /api/dramas/refresh`. |

## Notes

- The API follows only the public homepage and only returns cards found there; it does not crawl pagination or individual drama pages.
- It checks `robots.txt` by default. A disallow rule produces a clear `503` response rather than bypassing the rule.
- The parser supports normal image cards, lazy-loaded images (`data-src` / `data-lazy-src`), responsive `srcset` images, and CSS background-image posters. If MicroTV changes its homepage markup, adjust `src/scraper.js` and add a fixture to `test/scraper.test.js`.
- The source server can rate-limit or block a Render IP. In that case the API returns `SCRAPE_FAILED` (or serves its last stale successful cache) instead of fabricated data.
