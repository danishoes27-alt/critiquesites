import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/imagens.mjs';

let lazy, misto, base;
before(async () => {
  const a = await lerFixture('lazy');
  lazy = { ctx: a.ctx, saida: await medidor.medir(a.ctx) };
  const b = await lerFixture('a-imagens', { caminhos: ['/com-arquivo.html', '/'] });
  misto = { ctx: b.ctx, saida: await medidor.medir(b.ctx) };
  base = b.ctx;
});
const pag = (caminho) => misto.saida.dados.paginas.find((p) => p.caminho === caminho);

test('imagens: contrato do medidor', () => {
  assert.equal(medidor.id, 'imagens');
  assert.equal(lazy.saida.id, 'imagens');
  assert.equal(medidor.DOBRA_PX, 900);
  assert.equal(lazy.saida.dados.dobraPx, 900);
  assert.deepEqual(JSON.parse(JSON.stringify(misto.saida)), misto.saida);
  assert.deepEqual(misto.saida.dados.paginas.map((p) => p.caminho), ['/', '/com-arquivo.html']);
});

test('imagens: fixture lazy tem EXATAMENTE 57 imagens e 45 com loading=lazy (cru e final)', () => {
  const { cru, final } = lazy.saida.dados.paginas[0];
  for (const v of [cru, final]) {
    assert.equal(v.total, 57);
    assert.equal(v.lazy, 45);
    assert.equal(v.semLoading, 12);
    assert.equal(v.eager, 0);
    assert.equal(v.loadingOutro, 0);
    assert.equal(v.semAlt, 0);
    assert.equal(v.altVazio, 0);
    assert.equal(v.comLarguraEAltura, 57);
    assert.equal(v.comSrcset, 0);
    assert.equal(v.visiveis, 57);
    assert.equal(v.clones, 0);
    assert.deepEqual(v.formatos, { 'data:gif': 57 });
  }
  // agregado do site = a única página
  assert.equal(lazy.saida.dados.site.cru.total, 57);
  assert.equal(lazy.saida.dados.site.cru.lazy, 45);
  assert.equal(lazy.saida.dados.site.final.total, 57);
  assert.equal(lazy.saida.dados.site.final.lazy, 45);
});

test('imagens: na fixture lazy, as 45 lazy estão acima da dobra (problema) e nenhuma abaixo sem lazy', () => {
  const { cru, final } = lazy.saida.dados.paginas[0];
  for (const v of [cru, final]) {
    assert.equal(v.acimaDaDobraComLazy, 45);
    assert.equal(v.abaixoDaDobraSemLazy, 0);
  }
});

test('imagens: cada categoria no cru e no final (JS muda loading e acrescenta imagem)', () => {
  const { cru, final } = pag('/');
  assert.deepEqual(cru, {
    total: 12, lazy: 2, semLoading: 8, eager: 1, loadingOutro: 1, semAlt: 1, altVazio: 1, comLarguraEAltura: 11, comSrcset: 2,
    visiveis: 11, clones: 1, visiveisNaoClone: 10, acimaDaDobraComLazy: 1, abaixoDaDobraSemLazy: 1, formatos: { 'data:gif': 12 },
  });
  assert.deepEqual(final, {
    total: 13, lazy: 4, semLoading: 7, eager: 1, loadingOutro: 1, semAlt: 1, altVazio: 1, comLarguraEAltura: 12, comSrcset: 2,
    visiveis: 12, clones: 1, visiveisNaoClone: 11, acimaDaDobraComLazy: 2, abaixoDaDobraSemLazy: 1, formatos: { 'data:gif': 13 },
  });
});

test('imagens: totais do site somam as páginas, nas duas versões', () => {
  const s = misto.saida.dados.site;
  assert.equal(s.cru.total, 13); // 12 + 1
  assert.equal(s.final.total, 14); // 13 + 1
  assert.equal(s.cru.lazy, 2);
  assert.equal(s.final.lazy, 4);
  assert.deepEqual(s.final.formatos, { 'data:gif': 13, svg: 1 });
});

test('imagens: peso vem das requisições; sem Content-Length vira "semBytes" (não inventa tamanho)', () => {
  const p = pag('/com-arquivo.html');
  assert.equal(p.cru.total, 1);
  assert.deepEqual(p.cru.formatos, { svg: 1 });
  assert.equal(p.pesoImagens.requisicoes, 1);
  assert.equal(p.pesoImagens.comBytes, 0);
  assert.equal(p.pesoImagens.semBytes, 1);
  assert.equal(p.pesoImagens.totalBytes, 0);
  assert.deepEqual(p.pesoImagens.maiores, []);
  assert.deepEqual(pag('/').pesoImagens, { requisicoes: 0, comBytes: 0, semBytes: 0, totalBytes: 0, maiores: [] });
});

test('imagens: soma de bytes e as 5 maiores (requisições sintéticas)', async () => {
  const req = (nome, bytes, extra = {}) => ({ url: `http://x.test/${nome}`, status: 200, tipo: 'image', mime: 'image/png', bytes, ...extra });
  const ctx = {
    ...base,
    paginas: [
      { ...base.paginas[0], requisicoes: [
        req('a.png', 5000), req('b.jpg', 120000, { mime: 'image/jpeg' }), req('c.webp', 300), req('d.png', null), req('e.png', 90000),
        req('f.png', 70000), req('g.gif', 10), req('b.jpg', 120000, { mime: 'image/jpeg' }),
        { url: 'http://x.test/app.js', status: 200, tipo: 'script', mime: 'text/javascript', bytes: 999999 },
        { url: 'http://x.test/h.png', falhou: 'net::ERR_FAILED' },
      ] },
      { ...base.paginas[1], requisicoes: [req('b.jpg', 120000, { mime: 'image/jpeg' }), req('z.png', 1)] },
    ],
  };
  const s = await medidor.medir(ctx);
  const p0 = s.dados.paginas.find((p) => p.caminho === base.paginas[0].url.replace(/^https?:\/\/[^/]+/, ''));
  const pesos = s.dados.paginas.map((p) => p.pesoImagens);
  const a = pesos.find((p) => p.requisicoes === 7);
  assert.ok(p0 && a);
  assert.equal(a.comBytes, 6);
  assert.equal(a.semBytes, 1);
  assert.equal(a.totalBytes, 285310);
  assert.deepEqual(a.maiores.map((i) => [i.url.split('/').pop(), i.bytes]), [['b.jpg', 120000], ['e.png', 90000], ['f.png', 70000], ['a.png', 5000], ['c.webp', 300]]);
  assert.equal(a.maiores[0].mime, 'image/jpeg');
  const outra = pesos.find((p) => p.requisicoes === 2);
  assert.equal(outra.totalBytes, 120001);
  // site: soma por página (cada página baixa as suas imagens); maiores por URL distinta, com as páginas que a usam
  const site = s.dados.site.pesoImagens;
  assert.equal(site.totalBytes, 285310 + 120001);
  assert.equal(site.requisicoes, 8); // a b c d e f g z (URLs distintas)
  assert.deepEqual(site.maiores.map((i) => [i.url.split('/').pop(), i.bytes, i.paginas.length]), [['b.jpg', 120000, 2], ['e.png', 90000, 1], ['f.png', 70000, 1], ['a.png', 5000, 1], ['c.webp', 300, 1]]);
});

test('imagens: evidências (contagens recalculáveis por seletor, problemas de dobra)', () => {
  const ev = misto.saida.evidencias.filter((e) => e.pagina === '/');
  const lazyEv = ev.filter((e) => e.seletor === 'img[loading="lazy"]');
  assert.deepEqual(lazyEv.map((e) => [e.versao, e.contagem]), [['cru', 2], ['final', 4]]);
  const totalEv = ev.filter((e) => e.seletor === 'img');
  assert.deepEqual(totalEv.map((e) => [e.versao, e.contagem]), [['cru', 12], ['final', 13]]);
  const acima = ev.filter((e) => /^acima-da-dobra-com-lazy/.test(String(e.valor)));
  assert.deepEqual(acima.map((e) => e.versao), ['cru', 'final', 'final']);
  assert.ok(acima.every((e) => e.visivel === true && e.contagem === 1));
  const abaixo = ev.filter((e) => /^abaixo-da-dobra-sem-lazy/.test(String(e.valor)));
  assert.equal(abaixo.length, 2); // uma por versão
  const lazyFix = lazy.saida.evidencias.filter((e) => e.seletor === 'img[loading="lazy"]');
  assert.deepEqual(lazyFix.map((e) => [e.versao, e.contagem]), [['cru', 45], ['final', 45]]);
  for (const e of misto.saida.evidencias) assert.deepEqual(Object.keys(e).sort(), ['contagem', 'pagina', 'seletor', 'trecho', 'valor', 'versao', 'visivel']);
});

test('imagens: formatoDe', () => {
  assert.equal(medidor.formatoDe('https://x.test/a/b.JPG?v=1'), 'jpg');
  assert.equal(medidor.formatoDe('data:image/svg+xml;base64,AAA…(100 chars)'), 'data:svg+xml');
  assert.equal(medidor.formatoDe('/img/sem-extensao'), 'sem-extensao');
  assert.equal(medidor.formatoDe(''), 'sem-extensao');
});
