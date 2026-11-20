import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerFixture, caminhoFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/html.mjs';

let saida;
before(async () => {
  const { ctx } = await lerFixture('a-estrutura', { caminhos: ['/', '/sem-lang.html'] });
  saida = await medidor.medir(ctx);
});
const pag = (caminho) => saida.dados.paginas.find((p) => p.caminho === caminho);

test('html: contrato do medidor', () => {
  assert.equal(medidor.id, 'html');
  assert.equal(saida.id, 'html');
  assert.equal(typeof saida.versao, 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(saida)), saida); // serializável
  assert.deepEqual(saida.dados.paginas.map((p) => p.caminho), ['/', '/sem-lang.html']);
});

test('html: title, description, lang, viewport, charset, doctype', () => {
  const { cru, final } = pag('/');
  assert.deepEqual(cru.titulo, { presente: true, tagsNoHead: 1, texto: 'Padaria Sol Nascente', comprimento: 20 });
  // o JS troca o title: só o DOM final enxerga
  assert.deepEqual(final.titulo, { presente: true, tagsNoHead: 1, texto: 'Padaria Sol Nascente | Pães artesanais', comprimento: 38 });
  for (const v of [cru, final]) {
    assert.deepEqual(v.descricao, { presente: true, quantidade: 1, texto: 'Pães de fermentação natural feitos todo dia.', comprimento: 44 });
    assert.deepEqual(v.lang, { presente: true, valor: 'pt-BR', vazio: false });
    assert.deepEqual(v.viewport, { presente: true, valor: 'width=device-width, initial-scale=1' });
    assert.equal(v.charset.meta, 'utf-8');
    assert.equal(v.doctype, 'html');
  }
  assert.match(cru.charset.cabecalhoHttp, /utf-8/i);
});

test('html: canonical, Open Graph, Twitter, favicons', () => {
  const { final } = pag('/');
  assert.equal(final.canonical.presente, true);
  assert.equal(final.canonical.quantidade, 1);
  assert.equal(final.canonical.href, '/');
  assert.match(final.canonical.hrefAbsoluto, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(final.og, { 'og:description': ['Pães artesanais.'], 'og:image': ['/og.png'], 'og:title': ['Padaria Sol Nascente'] });
  assert.deepEqual(final.twitter, { 'twitter:card': ['summary'] });
  assert.deepEqual(final.favicons.map((f) => f.href), ['/apple.png', '/favicon.svg']);
  assert.deepEqual(final.favicons.map((f) => f.rel), ['apple-touch-icon', 'icon']);
});

test('html: headings contam só visíveis não-clone; saltos de nível', () => {
  const { cru, final } = pag('/');
  // cru: h1, h3, h2, h2(hidden), h1(clone), h4  -> visíveis não-clone: h1 h3 h2 h4
  assert.deepEqual(cru.headings.total, { h1: 2, h2: 2, h3: 1, h4: 1, h5: 0, h6: 0 });
  assert.deepEqual(cru.headings.visiveisNaoClone, { h1: 1, h2: 1, h3: 1, h4: 1, h5: 0, h6: 0 });
  assert.deepEqual(cru.headings.sequenciaNiveis, [1, 3, 2, 4]);
  assert.equal(cru.headings.h1Total, 2);
  assert.equal(cru.headings.h1Clones, 1);
  assert.equal(cru.headings.h1Ocultos, 0);
  assert.deepEqual(cru.headings.h1VisiveisNaoClone.map((h) => h.texto), ['Pães de verdade']);
  assert.equal(cru.headings.primeiroNivel, 1);
  assert.deepEqual(cru.headings.saltos.map((s) => [s.de, s.para, s.texto]), [[1, 3, 'Do h1 direto ao h3'], [2, 4, 'Detalhes']]);
  // final: o JS acrescenta um h2 no fim
  assert.deepEqual(final.headings.visiveisNaoClone, { h1: 1, h2: 2, h3: 1, h4: 1, h5: 0, h6: 0 });
  assert.deepEqual(final.headings.sequenciaNiveis, [1, 3, 2, 4, 2]);
  assert.equal(final.headings.saltos.length, 2);
  assert.equal(final.headings.vazios, 0);
});

test('html: landmarks pelo HTML', () => {
  const { cru, final } = pag('/');
  for (const v of [cru, final]) {
    assert.deepEqual(v.landmarks.tags, { header: 1, nav: 1, main: 1, footer: 1, aside: 1 });
    assert.deepEqual(v.landmarks.roles, { banner: 0, navigation: 0, main: 0, contentinfo: 0, complementary: 0, search: 1 });
  }
});

test('html: tamanho do HTML cru, número de elementos e nós', () => {
  const { cru, final } = pag('/');
  const bytesArquivo = readFileSync(caminhoFixture('a-estrutura') + '/index.html').length;
  assert.equal(cru.bytesHtml, bytesArquivo);
  assert.ok(final.bytesHtml > 0);
  assert.equal(cru.totalElementos, 32);
  assert.equal(final.totalElementos, 33);
  assert.deepEqual(cru.nos, { total: 10, visiveisNaoClone: 8, ocultos: 1, clones: 1 });
  assert.deepEqual(final.nos, { total: 11, visiveisNaoClone: 9, ocultos: 1, clones: 1 });
  assert.equal(pag('/').status, 200);
});

test('html: página sem nada devolve ausências explícitas (lang ausente etc.)', () => {
  const { cru, final } = pag('/sem-lang.html');
  for (const v of [cru, final]) {
    assert.equal(v.titulo.presente, false);
    assert.equal(v.titulo.tagsNoHead, 0);
    assert.equal(v.titulo.comprimento, 0);
    assert.equal(v.descricao.presente, false);
    assert.deepEqual(v.lang, { presente: false, valor: null, vazio: false });
    assert.equal(v.viewport.presente, false);
    assert.equal(v.canonical.presente, false);
    assert.equal(v.headings.h1VisiveisNaoClone.length, 0);
    assert.equal(v.headings.primeiroNivel, null);
    assert.deepEqual(v.landmarks.tags, { header: 0, nav: 0, main: 0, footer: 0, aside: 0 });
    assert.equal(v.totalElementos, 5);
  }
});

test('html: resumo do site (DOM final)', () => {
  assert.deepEqual(saida.dados.resumo, { paginas: 2, semTitle: 1, semDescription: 1, semLang: 1, semViewport: 1, semCanonical: 1, semH1: 1, variosH1: 0, semMain: 1 });
});

test('html: evidências reproduzíveis (cru e final)', () => {
  const ev = saida.evidencias;
  const titulos = ev.filter((e) => e.pagina === '/' && e.seletor === 'title');
  assert.deepEqual(titulos.map((e) => [e.versao, e.trecho, e.valor, e.contagem]), [
    ['cru', 'Padaria Sol Nascente', 20, 1],
    ['final', 'Padaria Sol Nascente | Pães artesanais', 38, 1],
  ]);
  const h1 = ev.filter((e) => e.pagina === '/' && e.valor === 'h1 visível');
  assert.equal(h1.length, 2); // um por versão
  assert.ok(h1.every((e) => e.visivel === true && e.trecho === 'Pães de verdade'));
  for (const e of ev) assert.deepEqual(Object.keys(e).sort(), ['contagem', 'pagina', 'seletor', 'trecho', 'valor', 'versao', 'visivel']);
});

test('html: determinístico (mesma entrada, mesma saída)', async () => {
  const { ctx } = await lerFixture('a-estrutura', { caminhos: ['/sem-lang.html', '/'] });
  const outra = await medidor.medir(ctx);
  assert.deepEqual(outra.dados.paginas.map((p) => p.caminho), ['/', '/sem-lang.html']);
  assert.deepEqual(outra.dados.resumo, saida.dados.resumo);
});
