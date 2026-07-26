import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedByRobots } from '../src/robots.js';
import { extractDramas } from '../src/scraper.js';

const source = 'https://microtv.st/';

test('extractDramas returns unique homepage drama title/poster pairs in document order', () => {
  const html = `
    <header><a href="/"><img src="/assets/logo.png" alt="MicroTV logo"></a></header>
    <main>
      <article class="drama-card">
        <a href="/the-dna-that-broke-everything"><img data-src="/posters/dna.webp" alt="The DNA That Broke Everything Full Episode"></a>
      </article>
      <article class="movie-card">
        <a href="/the-hidden-boss"><img src="/posters/hidden-small.jpg" srcset="/posters/hidden-small.jpg 320w, /posters/hidden-large.jpg 800w" alt="Poster"></a>
        <h2>The Hidden Boss Full Episode</h2>
      </article>
      <div class="show-card" style="background-image: url('/posters/ceo.jpg')">
        <a href="/ceo-nikla-mafia" aria-label="CEO Nikla Mafia Full Episode"></a>
      </div>
      <article class="drama-card">
        <a href="/the-dna-that-broke-everything"><img data-src="/posters/dna.webp" alt="The DNA That Broke Everything Full Episode"></a>
      </article>
      <a href="/category/latest"><img src="/posters/not-a-drama.jpg" alt="Latest dramas"></a>
      <a href="https://example.com/other"><img src="/posters/external.jpg" alt="External show"></a>
    </main>
  `;

  const dramas = extractDramas(html, source);

  assert.deepEqual(
    dramas.map(({ title, poster, url }) => ({ title, poster, url })),
    [
      {
        title: 'The DNA That Broke Everything Full Episode',
        poster: 'https://microtv.st/posters/dna.webp',
        url: 'https://microtv.st/the-dna-that-broke-everything',
      },
      {
        title: 'The Hidden Boss Full Episode',
        poster: 'https://microtv.st/posters/hidden-large.jpg',
        url: 'https://microtv.st/the-hidden-boss',
      },
      {
        title: 'CEO Nikla Mafia Full Episode',
        poster: 'https://microtv.st/posters/ceo.jpg',
        url: 'https://microtv.st/ceo-nikla-mafia',
      },
    ],
  );
  assert.match(dramas[0].id, /^[a-f0-9]{16}$/);
});

test('robots policy honours the most-specific matching rule', () => {
  const robots = `
    User-agent: *
    Disallow: /private
    Disallow: /shows
    Allow: /shows/featured

    User-agent: ShortDramaScraper
    Allow: /
    Disallow: /admin
  `;

  assert.equal(isAllowedByRobots(robots, 'https://microtv.st/', 'ShortDramaScraper'), true);
  assert.equal(isAllowedByRobots(robots, 'https://microtv.st/admin', 'ShortDramaScraper'), false);
  assert.equal(isAllowedByRobots(robots, 'https://microtv.st/shows/new', 'OtherBot'), false);
  assert.equal(isAllowedByRobots(robots, 'https://microtv.st/shows/featured', 'OtherBot'), true);
});
