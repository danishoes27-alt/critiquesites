import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as lh from '../lib/medidores/lighthouse.mjs';

// Lento (Chromium + Lighthouse): UMA execução completa por arquivo de teste, reaproveitada pelos asserts.
const LENTO = { timeout: 180000 };
let fixture;
let resultado;

before(async () => {
  fixture = await lerFixture('e-a11y-ruim', { manterAberto: true, buscarAtivos: false });
}, LENTO);
after(async () => { await fixture?.fechar(); });

test('lighthouse: roda na fixture local (modo rápido) e devolve a estrutura esperada', LENTO, async () => {
  assert.equal(lh.id, 'lighthouse');
  resultado = await lh.medir(fixture.ctx);
  assert.equal(resultado.id, 'lighthouse');
  assert.equal(typeof resultado.versao, 'string');
  const d = resultado.dados;
  assert.equal(d.modo, 'rapido');
  assert.equal(d.erro, undefined);
  assert.deepEqual(d.execucoesComErro, [], JSON.stringify(d.execucoesComErro));
  assert.equal(d.execucoes.length, 1, 'modo rápido: só a home');
  assert.match(d.versaoLighthouse, /^13\./);
  assert.ok(d.variacao && /varia/i.test(d.variacao));

  const e = d.execucoes[0];
  assert.equal(e.formFactor, 'mobile');
  assert.equal(e.versaoLighthouse, d.versaoLighthouse);
  assert.ok(e.url.startsWith('http://127.0.0.1:'));
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) {
    assert.equal(typeof e.scores[c], 'number', `score ${c}`);
    assert.ok(e.scores[c] >= 0 && e.scores[c] <= 100, `score ${c} fora de 0-100: ${e.scores[c]}`);
    assert.ok(Number.isInteger(e.scores[c]));
  }
  for (const m of ['fcp', 'lcp', 'cls', 'tbt', 'speedIndex']) {
    assert.ok(e.metricas[m], `métrica ${m} ausente`);
    assert.equal(typeof e.metricas[m].valor, 'number', `métrica ${m}`);
    assert.ok(e.metricas[m].valor >= 0);
  }
  assert.ok(Array.isArray(e.auditoriasReprovadas) && e.auditoriasReprovadas.length <= 30);
  assert.ok(Array.isArray(e.oportunidades));
  assert.equal(e.erroDeExecucao, null);
});

test('lighthouse: auditorias reprovadas trazem id/título e coerência com a fixture (sem valores exatos)', LENTO, async () => {
  assert.ok(resultado, 'depende do teste anterior');
  const e = resultado.dados.execucoes[0];
  for (const a of e.auditoriasReprovadas) {
    assert.equal(typeof a.id, 'string');
    assert.equal(typeof a.titulo, 'string');
    assert.ok('valorDeExibicao' in a);
    assert.ok(a.score < 0.9);
  }
  // A fixture tem acessibilidade ruim de propósito: a nota de acessibilidade não pode ser perfeita
  // e o Lighthouse (que usa o axe) tem de reprovar ao menos image-alt ou color-contrast.
  assert.ok(e.scores.accessibility < 100, `accessibility=${e.scores.accessibility}`);
  const ids = e.auditoriasReprovadas.map((a) => a.id);
  assert.ok(ids.includes('image-alt') || ids.includes('color-contrast'), `reprovadas: ${ids.join(', ')}`);
  assert.ok(resultado.evidencias.length >= 4);
});

test('lighthouse: plano por modo (rápido = home mobile; completo = 3 páginas + home desktop)', () => {
  const pg = (p) => ({ url: `http://127.0.0.1:1${p}` });
  const base = { site: { origem: 'http://127.0.0.1:1', modo: 'rapido' }, paginas: [pg('/sobre'), pg('/'), pg('/contato'), pg('/x')] };
  const r = lh.planoDeExecucoes(base);
  assert.deepEqual(r.plano, [{ url: 'http://127.0.0.1:1/', formFactor: 'mobile' }]);
  const c = lh.planoDeExecucoes({ ...base, site: { ...base.site, modo: 'completo' } });
  assert.equal(c.plano.length, 4);
  assert.deepEqual(c.plano.map((p) => p.formFactor), ['mobile', 'mobile', 'mobile', 'desktop']);
  assert.equal(c.plano[0].url, 'http://127.0.0.1:1/');
  assert.equal(c.plano[3].url, c.plano[0].url);
});

test('lighthouse: URL de rede interna é bloqueada e vira {erro}, sem lançar nem abrir o Chromium', async () => {
  const r = await lh.medir({ site: { modo: 'rapido', origem: 'http://169.254.169.254' }, paginas: [{ url: 'http://169.254.169.254/latest/meta-data/' }], rede: { permitidos: [], permitirLocal: false } });
  assert.equal(r.dados.execucoes.length, 1);
  assert.match(r.dados.execucoes[0].erro, /bloqueada/i);
  assert.equal(r.dados.principal, null);
});

test('lighthouse: sem páginas devolve indisponível', async () => {
  const r = await lh.medir({ site: { modo: 'rapido' }, paginas: [] });
  assert.ok(r.dados.indisponivel);
});

test('lighthouse: estouro do tempo limite vira {erro} sem lançar (e o Chromium é encerrado)', LENTO, async () => {
  const r = await lh.medir(fixture.ctx, { timeoutMs: 1500 });
  assert.equal(r.dados.execucoes.length, 1);
  assert.match(r.dados.execucoes[0].erro, /tempo esgotado/);
  assert.equal(r.dados.principal, null);
  assert.equal(r.dados.execucoesComErro.length, 1);
});
