import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/seo.mjs';

const CAMINHOS = ['/', '/conteudo-curto.html', '/duplicado.html', '/privado.html', '/produtos/Lista_Geral.html?cat=1&ordem=2'];
let saida, fechar;
before(async () => {
  // ordem propositalmente embaralhada: o medidor ordena por URL. O servidor fica aberto: o medidor busca /sitemap.xml e /robots.txt.
  const r = await lerFixture('a-seo', { caminhos: [CAMINHOS[3], CAMINHOS[0], CAMINHOS[4], CAMINHOS[2], CAMINHOS[1]], manterAberto: true });
  fechar = r.fechar;
  saida = await medidor.medir(r.ctx);
});
after(async () => { await fechar(); });
const pag = (caminho) => saida.dados.paginas.find((p) => p.caminho === caminho);

test('seo: contrato e ordenação determinística', () => {
  assert.equal(medidor.id, 'seo');
  assert.equal(saida.id, 'seo');
  assert.deepEqual(JSON.parse(JSON.stringify(saida)), saida);
  assert.deepEqual(saida.dados.paginas.map((p) => p.caminho), CAMINHOS);
});

test('seo: status HTTP da resposta, redirecionamento e cabeçalho X-Robots-Tag', () => {
  for (const p of saida.dados.paginas) {
    assert.equal(p.status, 200);
    assert.equal(p.statusNavegador, 200);
    assert.equal(p.redirecionou, false);
    assert.equal(p.xRobotsTag, null);
    assert.equal(p.noindexNoCabecalho, false);
  }
});

test('seo: título e descrição (presença e comprimento)', () => {
  const { cru, final } = pag('/');
  for (const v of [cru, final]) {
    assert.deepEqual(v.titulo, { presente: true, texto: 'Loja Teste', comprimento: 10 });
    assert.deepEqual(v.descricao, { presente: true, quantidade: 1, texto: 'Descrição repetida da loja.', comprimento: 27 });
  }
  const p = pag('/privado.html').final;
  assert.deepEqual(p.titulo, { presente: true, texto: 'Privado', comprimento: 7 });
  assert.deepEqual(p.descricao, { presente: false, quantidade: 0, texto: '', comprimento: 0 });
});

test('seo: título e descrição duplicados entre páginas', () => {
  const d = saida.dados.site.duplicados;
  for (const versao of [d.cru, d.final]) {
    assert.deepEqual(versao.titulos, [{ texto: 'Loja Teste', paginas: ['/', '/duplicado.html'] }]);
    assert.deepEqual(versao.descricoes, [{ texto: 'Descrição repetida da loja.', paginas: ['/', '/duplicado.html'] }]);
  }
});

test('seo: h1 (0, 1, vários), contando só visíveis não-clone', () => {
  assert.deepEqual(pag('/').final.h1.visiveisNaoClone, 1);
  assert.deepEqual(pag('/').final.h1.textos, ['Loja de testes']);
  assert.equal(pag('/duplicado.html').final.h1.visiveisNaoClone, 0);
  assert.equal(pag('/duplicado.html').final.h1.total, 0);
  const priv = pag('/privado.html').final.h1;
  assert.equal(priv.visiveisNaoClone, 2);
  assert.equal(priv.total, 3);
  assert.deepEqual(priv.textos, ['Um', 'Dois']);
  assert.equal(priv.seletores.length, 2);
});

test('seo: canonical presente e para onde aponta', () => {
  const ind = pag('/').final.canonical;
  assert.equal(ind.presente, true);
  assert.equal(ind.href, '/');
  assert.match(ind.absoluto, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(ind.apontaPara, 'si');
  assert.equal(pag('/duplicado.html').final.canonical.apontaPara, 'outra');
  assert.deepEqual(pag('/privado.html').final.canonical, { presente: false, quantidade: 0, href: null, absoluto: null, apontaPara: null });
});

test('seo: robots meta (noindex) e diferença entre cru e final', () => {
  const priv = pag('/privado.html').final.robotsMeta;
  assert.deepEqual(priv, { presente: true, metas: [{ nome: 'robots', conteudo: 'noindex, nofollow' }], noindex: true, nofollow: true });
  const dup = pag('/duplicado.html').final.robotsMeta;
  assert.equal(dup.presente, true);
  assert.equal(dup.noindex, false);
  assert.equal(dup.nofollow, false);
  // o JS injeta noindex: o cru não tem, o final tem
  const curto = pag('/conteudo-curto.html');
  assert.equal(curto.cru.robotsMeta.presente, false);
  assert.equal(curto.cru.robotsMeta.noindex, false);
  assert.equal(curto.final.robotsMeta.noindex, true);
});

test('seo: hreflang', () => {
  const v = pag('/').final;
  assert.deepEqual(v.hreflang, [
    { hreflang: 'en', href: '/en/' },
    { hreflang: 'pt-BR', href: '/' },
    { hreflang: 'x-default', href: '/' },
  ]);
  assert.equal(v.hreflangXDefault, true);
  assert.deepEqual(pag('/privado.html').final.hreflang, []);
  assert.equal(pag('/privado.html').final.hreflangXDefault, false);
});

test('seo: imagens sem alt (conta) no cru e no final', () => {
  for (const v of [pag('/').cru, pag('/').final]) assert.deepEqual(v.imagens, { total: 3, semAlt: 1, altVazio: 1, semAltVisiveisNaoClone: 1 });
  assert.deepEqual(pag('/privado.html').final.imagens, { total: 2, semAlt: 2, altVazio: 0, semAltVisiveisNaoClone: 2 });
});

test('seo: links internos e externos (únicos, sem hash; mailto fica em "outros")', () => {
  assert.deepEqual(pag('/').final.links, { visiveisNaoClone: 6, internos: 4, externos: 1, outros: 1, internosUnicos: 3, externosUnicos: 1 });
  assert.deepEqual(pag('/privado.html').final.links, { visiveisNaoClone: 0, internos: 0, externos: 0, outros: 0, internosUnicos: 0, externosUnicos: 0 });
});

test('seo: conteúdo visível (palavras) ignora oculto e clone', () => {
  assert.equal(pag('/').final.palavrasVisiveis, 16);
  assert.equal(pag('/conteudo-curto.html').final.palavrasVisiveis, 5);
  assert.equal(pag('/conteudo-curto.html').cru.palavrasVisiveis, 5);
  assert.equal(pag('/duplicado.html').final.palavrasVisiveis, 3);
  assert.equal(pag('/privado.html').final.palavrasVisiveis, 2);
  assert.equal(pag('/produtos/Lista_Geral.html?cat=1&ordem=2').final.palavrasVisiveis, 2);
  assert.equal(pag('/').final.nosTruncados, 0);
  assert.equal(pag('/').final.nosNoLimite, false);
});

test('seo: URL amigável (profundidade, parâmetros)', () => {
  const u = pag('/produtos/Lista_Geral.html?cat=1&ordem=2').urlAmigavel;
  assert.equal(u.profundidade, 2);
  assert.deepEqual(u.segmentos, ['produtos', 'Lista_Geral.html']);
  assert.deepEqual(u.parametros, ['cat', 'ordem']);
  assert.equal(u.quantidadeParametros, 2);
  assert.equal(u.temMaiusculas, true);
  assert.equal(u.temUnderscore, true);
  assert.equal(u.extensao, 'html');
  assert.equal(pag('/').urlAmigavel.profundidade, 0);
  assert.equal(pag('/').urlAmigavel.extensao, null);
  assert.deepEqual(medidor.analisarUrlAmigavel('http://exemplo.test/a/b-c/d?x=1&x=2&y=3'), {
    profundidade: 3, segmentos: ['a', 'b-c', 'd'], parametros: ['x', 'y'], quantidadeParametros: 3, comprimento: 39,
    temMaiusculas: false, temUnderscore: false, temEspacoCodificado: false, extensao: null,
  });
});

test('seo: sitemap.xml e robots.txt presentes (HTTP seguro)', () => {
  const { sitemap, robotsTxt } = saida.dados.site;
  assert.equal(sitemap.presente, true);
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.tipo, 'urlset');
  assert.equal(sitemap.quantidade, 4);
  assert.deepEqual(sitemap.locsAmostra, ['/', '/duplicado.html', '/privado.html', '/nao-amostrada.html']);
  assert.deepEqual(sitemap.paginasAmostradas, [
    { caminho: '/', listadaNoSitemap: true },
    { caminho: '/conteudo-curto.html', listadaNoSitemap: false },
    { caminho: '/duplicado.html', listadaNoSitemap: true },
    { caminho: '/privado.html', listadaNoSitemap: true },
    { caminho: '/produtos/Lista_Geral.html?cat=1&ordem=2', listadaNoSitemap: false },
  ]);
  assert.equal(robotsTxt.presente, true);
  assert.equal(robotsTxt.status, 200);
  assert.equal(robotsTxt.reconhecido, true);
  assert.equal(robotsTxt.linhas, 3);
  assert.deepEqual(robotsTxt.sitemapsDeclarados, ['/sitemap.xml']);
});

test('seo: resumo do site (DOM final)', () => {
  assert.deepEqual(saida.dados.site.resumo, {
    paginas: 5,
    status: { 200: 5 },
    redirecionadas: 0,
    semTitle: 0,
    semDescription: 2,
    semH1: 1,
    variosH1: 1,
    comNoindex: 2,
    semCanonical: 3,
    canonicalApontaParaOutra: 1,
    imagensSemAlt: 3,
    palavrasVisiveis: { min: 2, max: 16, total: 28 },
  });
});

test('seo: evidências (h1, imagens sem alt, duplicados, sitemap)', () => {
  const ev = saida.evidencias;
  const imgs = ev.filter((e) => e.pagina === '/' && e.seletor === 'img:not([alt])');
  assert.deepEqual(imgs.map((e) => [e.versao, e.contagem]), [['cru', 1], ['final', 1]]);
  const h1 = ev.find((e) => e.pagina === '/privado.html' && e.versao === 'final' && e.valor === 2 && e.seletor.includes(','));
  assert.equal(h1.contagem, 2);
  assert.equal(h1.visivel, true);
  const dup = ev.filter((e) => e.valor === 'duplicado' && e.seletor === 'title');
  assert.deepEqual(dup.map((e) => [e.pagina, e.trecho, e.contagem]), [['/', 'Loja Teste', 2], ['/duplicado.html', 'Loja Teste', 2]]);
  assert.ok(ev.some((e) => e.seletor === '/sitemap.xml' && e.valor === 200 && e.contagem === 4));
  for (const e of ev) assert.deepEqual(Object.keys(e).sort(), ['contagem', 'pagina', 'seletor', 'trecho', 'valor', 'versao', 'visivel']);
});

test('seo: sem sitemap/robots (404) e origem bloqueada não lançam exceção', async () => {
  const r = await lerFixture('legal', { manterAberto: true });
  const s = await medidor.medir(r.ctx).finally(() => r.fechar());
  assert.equal(s.dados.site.sitemap.presente, false);
  assert.equal(s.dados.site.sitemap.status, 404);
  assert.equal(s.dados.site.sitemap.tipo, null);
  assert.equal(s.dados.site.sitemap.quantidade, 0);
  assert.equal(s.dados.site.robotsTxt.presente, false);
  assert.equal(s.dados.site.robotsTxt.status, 404);
  assert.equal(s.dados.site.robotsTxt.reconhecido, false);
  assert.deepEqual(s.dados.paginas[0].final.titulo, { presente: true, texto: 'Curso Renda Extra', comprimento: 17 });

  const bloqueado = await medidor.medir({ site: { origem: 'http://169.254.169.254' }, paginas: [], rede: { permitidos: [], permitirLocal: false } });
  assert.equal(bloqueado.dados.site.sitemap.presente, false);
  assert.equal(bloqueado.dados.site.sitemap.status, null);
  assert.match(bloqueado.dados.site.sitemap.erro, /bloqueado/);
  assert.match(bloqueado.dados.site.robotsTxt.erro, /bloqueado/);
});

test('seo: analisarSitemapXml (urlset, sitemapindex, entidades)', () => {
  assert.deepEqual(medidor.analisarSitemapXml('<urlset><url><loc> http://a.test/x?a=1&amp;b=2 </loc></url><url><loc>http://a.test/y</loc></url></urlset>'),
    { tipo: 'urlset', locs: ['http://a.test/x?a=1&b=2', 'http://a.test/y'] });
  assert.equal(medidor.analisarSitemapXml('<sitemapindex><sitemap><loc>http://a.test/s1.xml</loc></sitemap></sitemapindex>').tipo, 'sitemapindex');
  assert.deepEqual(medidor.analisarSitemapXml('<html>não é sitemap</html>'), { tipo: 'desconhecido', locs: [] });
});
