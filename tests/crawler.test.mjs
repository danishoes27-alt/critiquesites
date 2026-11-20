import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRobots, podeRastrear } from '../lib/robots.mjs';
import { descobrirPaginas, padraoDeUrl, extrairLinksDoHtml } from '../lib/crawler.mjs';
import { criarCache, hashDaVersao } from '../lib/cache.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('robots: grupos, Allow/Disallow, curingas e mais específico vence', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /privado/\nAllow: /privado/publico\nDisallow: /*.pdf$\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://x.com/s.xml`);
  assert.equal(r.sitemaps[0], 'https://x.com/s.xml');
  assert.equal(podeRastrear(r, 'critiquesites', '/'), true);
  assert.equal(podeRastrear(r, 'critiquesites', '/privado/a'), false);
  assert.equal(podeRastrear(r, 'critiquesites', '/privado/publico'), true);
  assert.equal(podeRastrear(r, 'critiquesites', '/doc.pdf'), false);
  assert.equal(podeRastrear(r, 'GPTBot', '/qualquer'), false);
  assert.equal(podeRastrear(r, 'ClaudeBot', '/qualquer'), true);
});

test('padraoDeUrl agrupa iguais', () => {
  assert.equal(padraoDeUrl('https://a.com/blog/post-1.html'), '/blog/post-#');
  assert.equal(padraoDeUrl('https://a.com/blog/como-escolher-uma-mesa'), '/blog/:slug');
  assert.equal(padraoDeUrl('https://a.com/'), '/');
});

test('extrairLinksDoHtml normaliza e deduplica', () => {
  const l = extrairLinksDoHtml('<a href="/a/">x</a><a href=\'/a\'>y</a><a href="mailto:x@y.com">m</a><a href="#t">t</a>', 'https://s.com/');
  assert.deepEqual(l, ['https://s.com/a']);
});

test('crawler: site-12 em modo rápido respeita limite, robots, inclui home e páginas legais', async () => {
  const s = await servirPasta(fixtures + 'site-12');
  try {
    const r = await descobrirPaginas(s.url, { modo: 'rapido', intervaloMs: 0, permitidos: [`127.0.0.1:${s.porta}`] });
    const urls = r.paginas.map((p) => new URL(p.url).pathname);
    assert.ok(r.paginas.length <= 8, `páginas: ${r.paginas.length}`);
    assert.equal(urls[0], '/');
    for (const legal of ['/privacidade.html', '/termos.html', '/contato.html', '/sobre.html']) assert.ok(urls.includes(legal), legal);
    assert.ok(!urls.includes('/segredo.html'), 'segredo.html é Disallow no robots');
    assert.ok(r.bloqueadasPorRobots.some((u) => u.endsWith('/segredo.html')));
    assert.equal(r.candidatas, 12);
    assert.equal(r.truncado, true);
    // não escolhe dois posts do mesmo modelo antes de cobrir outros
    assert.equal(urls.filter((u) => /produto-\d/.test(u)).length, 1);
  } finally { await s.fechar(); }
});

test('crawler: modo completo pega as 12 páginas permitidas', async () => {
  const s = await servirPasta(fixtures + 'site-12');
  try {
    const r = await descobrirPaginas(s.url, { modo: 'completo', intervaloMs: 0, permitidos: [`127.0.0.1:${s.porta}`] });
    assert.equal(r.paginas.length, 12);
    assert.equal(r.truncado, false);
  } finally { await s.fechar(); }
});

test('crawler: tempo total curto interrompe a descoberta sem estourar', async () => {
  const s = await servirPasta(fixtures + 'site-12');
  try {
    const t0 = Date.now();
    const r = await descobrirPaginas(s.url, { modo: 'completo', intervaloMs: 0, tempoTotalMs: 1, permitidos: [`127.0.0.1:${s.porta}`] });
    assert.ok(Date.now() - t0 < 5000);
    assert.ok(r.paginas.length >= 1);
  } finally { await s.fechar(); }
});

test('cache: grava, lê e conta acertos; hash da versão é estável e muda com 1 página', () => {
  const c = criarCache(mkdtempSync(join(tmpdir(), 'cs-cache-')));
  const k = c.chave('abc123');
  assert.equal(c.obter(k), null);
  c.gravar(k, { ok: 1 });
  assert.deepEqual(c.obter(k), { ok: 1 });
  assert.deepEqual(c.stats, { acertos: 1, falhas: 1, gravados: 1 });
  const p = [{ url: 'https://a.com/b', hashCru: '2' }, { url: 'https://a.com/', hashCru: '1' }];
  const h1 = hashDaVersao(p), h2 = hashDaVersao([...p].reverse());
  assert.equal(h1, h2);
  assert.notEqual(h1, hashDaVersao([p[0], { url: 'https://a.com/', hashCru: '9' }]));
  assert.notEqual(h1, hashDaVersao(p, [{ url: 'https://a.com/x.css', hash: 'z' }]));
});

test('ReDoS: robots com muitos curingas e HTML/sitemap patológicos terminam rápido', () => {
  const t0 = Date.now();
  const r = parseRobots('User-agent: *\nDisallow: /*a*a*a*a*a*a*a*b');
  assert.equal(podeRastrear(r, 'critiquesites', '/' + 'a'.repeat(5000)), true);
  assert.equal(extrairLinksDoHtml('<a '.repeat(300000), 'https://x.com/').length, 0);
  assert.equal(extrairLinksDoHtml('<a href="/ok">x</a>' + '<a '.repeat(1000), 'https://x.com/').length, 1);
  assert.ok(Date.now() - t0 < 3000, `demorou ${Date.now() - t0} ms`);
});

test('robots: semântica dos curingas preservada (* no meio, $ no fim)', () => {
  const r = parseRobots('User-agent: *\nDisallow: /a*/b$\nDisallow: /privado*');
  assert.equal(podeRastrear(r, 'x', '/a123/b'), false);
  assert.equal(podeRastrear(r, 'x', '/a123/bc'), true);
  assert.equal(podeRastrear(r, 'x', '/privado-2'), false);
  assert.equal(podeRastrear(r, 'x', '/publico'), true);
});
