import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

const SOURCE_HOSTS = new Set(['microtv.st', 'www.microtv.st']);
const CARD_CLASS_WORDS = ['card', 'item', 'movie', 'drama', 'post', 'film', 'show', 'series', 'grid'];
const GENERIC_TITLES = new Set([
  'image',
  'poster',
  'thumbnail',
  'logo',
  'avatar',
  'watch',
  'watch now',
  'play',
  'play now',
  'read more',
  'learn more',
  'view more',
  'menu',
]);
const EXCLUDED_PATH_PREFIXES = [
  '/wp-admin',
  '/wp-content',
  '/wp-includes',
  '/tag/',
  '/category/',
  '/author/',
  '/feed',
  '/search',
  '/page/',
];

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulTitle(value) {
  const title = cleanText(value);
  if (title.length < 2 || title.length > 250) return false;
  if (GENERIC_TITLES.has(title.toLowerCase())) return false;
  if (/^(\d+[,.]?\d*\s*(views?|likes?))$/i.test(title)) return false;
  return true;
}

function toHttpUrl(rawValue, baseUrl) {
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue.trim(), baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pickFromSrcset(value, baseUrl) {
  if (!value) return null;

  // The last source in a normal srcset is usually the highest-resolution poster.
  const entries = value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);

  for (const entry of entries.reverse()) {
    const url = toHttpUrl(entry, baseUrl);
    if (url) return url;
  }
  return null;
}

function posterFromAttributes($element, baseUrl) {
  const lazyAttributes = ['data-lazy-src', 'data-src', 'data-original', 'data-image', 'data-poster'];
  const srcsets = ['data-lazy-srcset', 'data-srcset', 'srcset'];

  for (const attribute of lazyAttributes) {
    const value = $element.attr(attribute);
    // Many lazy-loaders leave a base64 placeholder in src, so keep looking.
    if (value && !value.trim().toLowerCase().startsWith('data:')) {
      const url = toHttpUrl(value, baseUrl);
      if (url) return url;
    }
  }

  for (const attribute of srcsets) {
    const url = pickFromSrcset($element.attr(attribute), baseUrl);
    if (url) return url;
  }

  const src = $element.attr('src');
  return src && !src.trim().toLowerCase().startsWith('data:') ? toHttpUrl(src, baseUrl) : null;
}

function posterFromStyle(style, baseUrl) {
  if (!style) return null;
  const match = style.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  return match ? toHttpUrl(match[2], baseUrl) : null;
}

function isLikelyPoster(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return !/\/(?:logo|icon|avatar|emoji|sprite)(?:[._/-]|$)/.test(lower);
}

function getPoster($, $root, baseUrl) {
  let poster = posterFromAttributes($root, baseUrl) || posterFromStyle($root.attr('style'), baseUrl);
  if (isLikelyPoster(poster)) return poster;

  const media = $root.find('img, source, [data-poster], [data-src], [data-lazy-src]');
  for (const element of media.toArray()) {
    const $element = $(element);
    poster = posterFromAttributes($element, baseUrl) || posterFromStyle($element.attr('style'), baseUrl);
    if (isLikelyPoster(poster)) return poster;
  }

  const styled = $root.find('[style]');
  for (const element of styled.toArray()) {
    poster = posterFromStyle($(element).attr('style'), baseUrl);
    if (isLikelyPoster(poster)) return poster;
  }

  return null;
}

function isDramaLink(value, baseUrl) {
  const url = toHttpUrl(value, baseUrl);
  if (!url) return null;

  const parsed = new URL(url);
  if (!SOURCE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (parsed.pathname === '/' || parsed.pathname === '') return null;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => parsed.pathname.toLowerCase().startsWith(prefix))) {
    return null;
  }

  parsed.hash = '';
  return parsed.toString();
}

function titleValues($, $root, $link) {
  const values = [];
  const addAttributes = ($element) => {
    if (!$element || !$element.length) return;
    values.push(
      $element.attr('data-title'),
      $element.attr('data-name'),
      $element.attr('aria-label'),
      $element.attr('title'),
    );
  };

  addAttributes($root);

  // Visible headings are preferred over image metadata when both exist.
  $root.find('h1, h2, h3, h4, h5, h6, [data-title], [data-name], [class*="title"], [class*="name"]').each(
    (_, element) => {
      const $element = $(element);
      addAttributes($element);
      values.push($element.text());
    },
  );

  $root.find('img, source').each((_, element) => {
    const $element = $(element);
    values.push($element.attr('alt'), $element.attr('data-title'), $element.attr('title'));
  });

  addAttributes($link);
  if ($link?.length) values.push($link.text());
  values.push($root.text());

  return values.map(cleanText).find(isUsefulTitle) || null;
}

function findDramaLink($, $root, baseUrl) {
  const links = $root.is('a[href]') ? [$root] : $root.find('a[href]').toArray().map((element) => $(element));
  let best = null;

  for (const $link of links) {
    const url = isDramaLink($link.attr('href'), baseUrl);
    if (!url) continue;

    let score = 1;
    if ($link.find('img, source, [data-poster], [data-src], [data-lazy-src]').length) score += 10;
    if ($link.find('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"]').length) score += 5;
    if ($link.attr('title') || $link.attr('aria-label')) score += 2;

    if (!best || score > best.score) best = { $link, url, score };
  }

  return best;
}

function hasCardClass($root) {
  const className = ($root.attr('class') || '').toLowerCase();
  return CARD_CLASS_WORDS.some((word) => className.includes(word));
}

function isCandidateRoot($root) {
  if ($root.is('a[href]')) return true;
  if ($root.is('article, li')) return true;
  return hasCardClass($root);
}

function createDramaCandidate($, element, baseUrl) {
  const $root = $(element);
  if (!isCandidateRoot($root)) return null;

  const link = findDramaLink($, $root, baseUrl);
  if (!link) return null;

  const poster = getPoster($, $root, baseUrl);
  if (!poster) return null;

  const title = titleValues($, $root, link.$link);
  if (!title) return null;

  const id = createHash('sha256').update(`${link.url}\n${poster}`).digest('hex').slice(0, 16);
  return { id, title, poster, url: link.url };
}

/**
 * Extracts only title, remote poster URL, and source detail-page URL from the
 * supplied homepage HTML. It never downloads or republishes poster files.
 */
export function extractDramas(html, sourceUrl) {
  const baseUrl = sourceUrl instanceof URL ? sourceUrl : new URL(sourceUrl);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // A single document-order pass keeps homepage ordering and supports both
  // anchor-wrapped images and CSS-background card layouts.
  $('a[href], article, li, [class]').each((_, element) => {
    const drama = createDramaCandidate($, element, baseUrl);
    if (!drama) return;

    const key = `${drama.url}|${drama.title.toLocaleLowerCase()}|${drama.poster}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(drama);
  });

  return results;
}
