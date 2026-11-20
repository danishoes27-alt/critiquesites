import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/jsonld.mjs';

let saida;
before(async () => {
  const { ctx } = await lerFixture('a-jsonld', { caminhos: ['/so-final.html', '/', '/sem-dados.html'] });
  saida = await medidor.medir(ctx);
});
const pag = (caminho) => saida.dados.paginas.find((p) => p.caminho === caminho);

const SEIS = ['FAQPage', 'Offer', 'Product', 'VideoObject', 'WebPage', 'WebSite'];

test('jsonld: contrato e ordenação', () => {
  assert.equal(medidor.id, 'jsonld');
  assert.equal(saida.id, 'jsonld');
  assert.deepEqual(JSON.parse(JSON.stringify(saida)), saida);
  assert.deepEqual(saida.dados.paginas.map((p) => p.caminho), ['/', '/sem-dados.html', '/so-final.html']);
  assert.deepEqual(saida.dados.tiposDeInteresse, ['Article', 'FAQPage', 'LocalBusiness', 'Offer', 'Organization', 'Product', 'VideoObject', 'WebPage', 'WebSite']);
});

test('jsonld: WebSite, WebPage, Product, Offer, FAQPage e VideoObject são TODOS listados (cru e final)', () => {
  const { cru, final } = pag('/');
  for (const v of [cru, final]) {
    for (const t of SEIS) assert.ok(v.jsonld.tipos.includes(t), `faltou ${t}`);
    assert.equal(v.jsonld.usaGraph, true);
    assert.equal(v.jsonld.raizesSemTipo, 0);
  }
  // todos os @type, inclusive aninhados (Offer dentro de Product, Question/Answer dentro de FAQPage)
  assert.deepEqual(cru.jsonld.tipos, ['Answer', 'FAQPage', 'Offer', 'Product', 'Question', 'VideoObject', 'WebPage', 'WebSite']);
  assert.deepEqual(cru.jsonld.contagemPorTipo, { Answer: 1, FAQPage: 1, Offer: 1, Product: 1, Question: 1, VideoObject: 1, WebPage: 1, WebSite: 1 });
});

test('jsonld: cru e final são lidos separadamente (o JS injeta Organization)', () => {
  const { cru, final } = pag('/');
  assert.equal(cru.jsonld.blocos, 5);
  assert.equal(cru.jsonld.blocosValidos, 4);
  assert.equal(final.jsonld.blocos, 6);
  assert.equal(final.jsonld.blocosValidos, 5);
  assert.equal(cru.jsonld.interesse.Organization.presente, false);
  assert.equal(final.jsonld.interesse.Organization.presente, true);
  assert.deepEqual(final.jsonld.tipos, ['Answer', 'FAQPage', 'Offer', 'Organization', 'Product', 'Question', 'VideoObject', 'WebPage', 'WebSite']);
  assert.deepEqual(pag('/').tiposSoNoFinal, ['Organization']);
  assert.deepEqual(pag('/').tiposSoNoCru, []);
});

test('jsonld: erro de parse registrado com trecho', () => {
  for (const v of [pag('/').cru, pag('/').final]) {
    assert.equal(v.jsonld.erros.length, 1);
    assert.equal(v.jsonld.erros[0].indice, 4);
    assert.equal(v.jsonld.erros[0].trecho, '{ "@type": "Article", "headline": "quebrado", }');
    assert.equal(v.jsonld.erros[0].possivelTruncamento, false);
    assert.equal(typeof v.jsonld.erros[0].erro, 'string');
    assert.ok(v.jsonld.erros[0].erro.length > 0);
    // o bloco quebrado NÃO conta como Article
    assert.equal(v.jsonld.interesse.Article.presente, false);
  }
});

test('jsonld: chaves de primeiro nível por tipo', () => {
  const i = pag('/').final.jsonld.interesse;
  assert.deepEqual(i.Product, { presente: true, ocorrencias: 1, propriedades: ['name', 'offers', 'sku'] });
  assert.deepEqual(i.Offer, { presente: true, ocorrencias: 1, propriedades: ['availability', 'price', 'priceCurrency'] });
  assert.deepEqual(i.FAQPage, { presente: true, ocorrencias: 1, propriedades: ['mainEntity'] });
  assert.deepEqual(i.VideoObject, { presente: true, ocorrencias: 1, propriedades: ['description', 'name', 'thumbnailUrl', 'uploadDate'] });
  assert.deepEqual(i.WebSite, { presente: true, ocorrencias: 1, propriedades: ['name', 'url'] });
  assert.deepEqual(i.WebPage, { presente: true, ocorrencias: 1, propriedades: ['isPartOf', 'name'] });
  assert.deepEqual(i.Organization, { presente: true, ocorrencias: 1, propriedades: ['logo', 'name', 'url'] });
  assert.deepEqual(i.LocalBusiness, { presente: false, ocorrencias: 0, propriedades: [] });
  assert.deepEqual(pag('/').final.jsonld.propriedadesPorTipo.Question, { ocorrencias: 1, propriedades: ['acceptedAnswer', 'name'] });
});

test('jsonld: microdata e RDFa como formatos adicionais', () => {
  for (const v of [pag('/').cru, pag('/').final]) {
    assert.deepEqual(v.microdata, { quantidade: 1, tipos: ['Person'] });
    assert.deepEqual(v.rdfa, { quantidade: 1, tipos: ['Recipe'] });
    assert.equal(v.temMicrodata, true);
    assert.equal(v.temRdfa, true);
    assert.equal(v.temJsonLd, true);
    assert.equal(v.temDadosEstruturados, true);
  }
});

test('jsonld: temDadosEstruturados por versão e temEmQualquerVersao', () => {
  const sf = pag('/so-final.html');
  assert.equal(sf.cru.temDadosEstruturados, false);
  assert.equal(sf.cru.jsonld.blocos, 0);
  assert.equal(sf.final.temDadosEstruturados, true);
  assert.equal(sf.temEmQualquerVersao, true);
  assert.deepEqual(sf.final.jsonld.tipos, ['LocalBusiness', 'PostalAddress']);
  assert.deepEqual(sf.final.jsonld.interesse.LocalBusiness, { presente: true, ocorrencias: 1, propriedades: ['address', 'name', 'telephone'] });
  assert.deepEqual(sf.tiposSoNoFinal, ['LocalBusiness', 'PostalAddress']);
  const sd = pag('/sem-dados.html');
  assert.equal(sd.cru.temDadosEstruturados, false);
  assert.equal(sd.final.temDadosEstruturados, false);
  assert.equal(sd.temEmQualquerVersao, false);
  assert.deepEqual(sd.final.jsonld.tipos, []);
});

test('jsonld: agregado do site', () => {
  const s = saida.dados.site;
  assert.deepEqual(s.cru.tipos, ['Answer', 'FAQPage', 'Offer', 'Person', 'Product', 'Question', 'Recipe', 'VideoObject', 'WebPage', 'WebSite']);
  assert.deepEqual(s.final.tipos, ['Answer', 'FAQPage', 'LocalBusiness', 'Offer', 'Organization', 'Person', 'PostalAddress', 'Product', 'Question', 'Recipe', 'VideoObject', 'WebPage', 'WebSite']);
  assert.deepEqual(s.cru.paginasComDados, ['/']);
  assert.deepEqual(s.final.paginasComDados, ['/', '/so-final.html']);
  assert.deepEqual(s.paginasSoNoFinal, ['/so-final.html']);
  assert.deepEqual(s.tiposSoNoFinal, ['LocalBusiness', 'Organization', 'PostalAddress']);
  assert.deepEqual(s.tiposSoNoCru, []);
  assert.equal(s.temEmQualquerVersao, true);
  assert.deepEqual(s.interesse.Product, { cru: true, final: true });
  assert.deepEqual(s.interesse.Organization, { cru: false, final: true });
  assert.deepEqual(s.interesse.Article, { cru: false, final: false });
});

test('jsonld: site sem nenhum dado estruturado (fixture ia-ruim)', async () => {
  const { ctx } = await lerFixture('ia-ruim');
  const s = await medidor.medir(ctx);
  assert.equal(s.dados.site.temEmQualquerVersao, false);
  assert.equal(s.dados.site.cru.temDadosEstruturados, false);
  assert.equal(s.dados.site.final.temDadosEstruturados, false);
  assert.deepEqual(s.dados.site.final.tipos, []);
});

test('jsonld: analisarBlocosJsonLd (aninhado, @type em lista, URL de tipo, truncamento)', () => {
  const r = medidor.analisarBlocosJsonLd([
    JSON.stringify({ '@context': 'https://schema.org', '@type': ['Product', 'https://schema.org/Thing'], name: 'x', brand: { '@type': 'schema:Brand', name: 'y' } }),
    JSON.stringify({ nome: 'sem tipo' }),
    '{"@type":"Product","name":"' + 'a'.repeat(60000),
  ]);
  assert.deepEqual(r.tipos, ['Brand', 'Product', 'Thing']);
  assert.equal(r.blocos, 3);
  assert.equal(r.blocosValidos, 2);
  assert.equal(r.raizesSemTipo, 1);
  assert.equal(r.erros.length, 1);
  assert.equal(r.erros[0].indice, 2);
  assert.equal(r.erros[0].possivelTruncamento, true);
  assert.deepEqual(r.propriedadesPorTipo.Product.propriedades, ['brand', 'name']);
  assert.equal(medidor.normalizarTipo('https://schema.org/Product'), 'Product');
});

test('jsonld: evidências (seletor, contagem de blocos, erro com trecho)', () => {
  const ev = saida.evidencias.filter((e) => e.pagina === '/');
  const blocos = ev.filter((e) => e.seletor === 'script[type="application/ld+json"]' && e.trecho === '' );
  assert.deepEqual(blocos.map((e) => [e.versao, e.contagem]), [['cru', 5], ['final', 6]]);
  const erro = ev.filter((e) => /^erro de parse no bloco 4/.test(String(e.valor)));
  assert.deepEqual(erro.map((e) => e.versao), ['cru', 'final']);
  assert.ok(erro.every((e) => e.trecho.includes('"headline": "quebrado"')));
  const prod = ev.find((e) => e.versao === 'cru' && e.trecho === '@type=Product');
  assert.equal(prod.valor, 'name,offers,sku');
  assert.equal(prod.contagem, 1);
  assert.ok(ev.some((e) => e.seletor === '[itemtype]' && e.valor === 'Person' && e.contagem === 1));
  assert.ok(ev.some((e) => e.seletor === '[typeof]' && e.valor === 'Recipe' && e.contagem === 1));
  for (const e of saida.evidencias) assert.deepEqual(Object.keys(e).sort(), ['contagem', 'pagina', 'seletor', 'trecho', 'valor', 'versao', 'visivel']);
});
