import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as axe from '../lib/medidores/axe.mjs';

let ruim, clone;

before(async () => {
  ruim = await lerFixture('e-a11y-ruim', { manterAberto: true, buscarAtivos: false });
  clone = await lerFixture('e-a11y-clone', { manterAberto: true, buscarAtivos: false });
});
after(async () => {
  await ruim?.fechar();
  await clone?.fechar();
});

test('axe: interface do medidor (id e formato da saída)', async () => {
  assert.equal(axe.id, 'axe');
  const r = await axe.medir(ruim.ctx);
  assert.equal(r.id, 'axe');
  assert.equal(typeof r.versao, 'string');
  assert.ok(r.dados && Array.isArray(r.evidencias));
  assert.match(r.dados.versaoAxe, /^4\./);
});

test('axe: fixture com violações conhecidas devolve exatamente os ids esperados', async () => {
  const r = await axe.medir(ruim.ctx);
  const pag = r.dados.porPagina;
  assert.equal(pag.length, 1);
  assert.equal(pag[0].erro, undefined);
  const ids = pag[0].violacoes.map((v) => v.id).sort();
  assert.deepEqual(ids, ['button-name', 'color-contrast', 'heading-order', 'html-has-lang', 'image-alt', 'label', 'page-has-heading-one']);
  const por = Object.fromEntries(pag[0].violacoes.map((v) => [v.id, v]));
  assert.equal(por['image-alt'].impacto, 'critical');
  assert.equal(por['button-name'].impacto, 'critical');
  assert.equal(por['label'].impacto, 'critical');
  assert.equal(por['color-contrast'].impacto, 'serious');
  assert.equal(por['html-has-lang'].impacto, 'serious');
  for (const v of pag[0].violacoes) {
    assert.equal(v.nosTotal, 1, v.id);
    assert.equal(v.nos.length, 1);
    assert.ok(v.helpUrl.startsWith('https://dequeuniversity.com/'), v.id);
    assert.ok(v.nos[0].seletor && v.nos[0].html.length <= 200);
    assert.ok(Array.isArray(v.tags) && v.tags.length > 0);
  }
  assert.match(por['image-alt'].nos[0].html, /foto-pao\.png/);
  assert.equal(por['button-name'].nos[0].seletor, 'button');
  assert.match(por['color-contrast'].nos[0].html, /contraste muito baixo/);
});

test('axe: contagens de passes/incompletos/inaplicáveis e agregado', async () => {
  const r = await axe.medir(ruim.ctx);
  const c = r.dados.porPagina[0].contagens;
  assert.equal(c.violacoes, 7);
  assert.ok(c.passes > 0 && c.inaplicaveis > 0);
  assert.equal(typeof c.incompletos, 'number');
  const ag = r.dados.agregado;
  assert.equal(ag.violacoes.length, 7);
  assert.equal(ag.contagens.violacoes, 7);
  assert.equal(ag.violacoesPorImpacto.critical, 3);
  assert.equal(ag.violacoesPorImpacto.serious, 2);
  assert.equal(ag.violacoesPorImpacto.moderate, 2);
  assert.equal(ag.violacoes[0].impacto, 'critical'); // ordenado por impacto
  assert.ok(ag.violacoes.every((v) => v.paginas.length === 1));
});

test('axe: evidências apontam seletor e trecho', async () => {
  const r = await axe.medir(ruim.ctx);
  assert.ok(r.evidencias.length >= 7);
  const ev = r.evidencias.find((e) => e.valor.startsWith('image-alt'));
  assert.equal(ev.versao, 'final');
  assert.match(ev.trecho, /<img/);
  assert.ok(ev.pagina.startsWith('http://127.0.0.1:'));
});

test('axe: nós sob clone de carrossel são ignorados e a violação some se só havia clones', async () => {
  const r = await axe.medir(clone.ctx);
  const p = r.dados.porPagina[0];
  assert.equal(p.erro, undefined);
  assert.deepEqual(p.violacoes.filter((v) => v.id === 'aria-hidden-focus'), []);
  const ign = p.ignoradasPorClone.find((v) => v.id === 'aria-hidden-focus');
  assert.ok(ign, 'aria-hidden-focus nos clones deveria estar registrado como ignorado');
  assert.equal(ign.nosIgnoradosPorClone, 2);
});

test('axe: erro numa página não derruba as demais', async () => {
  const ctx = { ...ruim.ctx, paginas: [{ url: 'http://127.0.0.1:1/nao-existe', final: null }, ...ruim.ctx.paginas] };
  const r = await axe.medir(ctx);
  assert.equal(r.dados.porPagina.length, 2);
  assert.ok(r.dados.porPagina[0].erro, 'primeira página deve ter {erro}');
  assert.equal(r.dados.porPagina[1].erro, undefined);
  assert.equal(r.dados.paginasMedidas, 1);
  assert.equal(r.dados.paginasComErro.length, 1);
  assert.equal(r.dados.agregado.violacoes.length, 7);
});

test('axe: sem navegador no contexto devolve indisponível, sem lançar', async () => {
  const r = await axe.medir({ paginas: [], navegador: null });
  assert.ok(r.dados.indisponivel);
});
