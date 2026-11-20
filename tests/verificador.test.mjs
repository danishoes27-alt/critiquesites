import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { montarCorpus, verificarCitacao, verificarAchados, numerosSemRespaldo } from '../lib/verificador.mjs';

let oculto, lazy, carrossel;
before(async () => {
  oculto = (await lerFixture('oculto')).ctx;
  lazy = (await lerFixture('lazy')).ctx;
  carrossel = (await lerFixture('carrossel-clone')).ctx;
});

const achado = (extra) => ({ id: 'a1', regra_id: 'x', selo: 'fato', mensagem: 'teste', evidencias: [], citacoes: [], ...extra });

test('trecho visível existente passa; trecho oculto NÃO vale como visível', () => {
  const corpus = montarCorpus(oculto);
  assert.equal(verificarCitacao({ tipo: 'trecho', valor: 'R$ 39', onde: 'visivel' }, corpus).ok, true);
  assert.equal(verificarCitacao({ tipo: 'trecho', valor: '0% OFF', onde: 'visivel' }, corpus).ok, false);
  assert.equal(verificarCitacao({ tipo: 'trecho', valor: 'Oferta encerrada', onde: 'visivel' }, corpus).ok, false);
  // mas o trecho oculto existe no código (HTML): vale como "existe no html"
  assert.equal(verificarCitacao({ tipo: 'trecho', valor: '0% OFF', onde: 'html' }, corpus).ok, true);
});

test('gabarito: "Guia R$ 59 e 200+ receitas" (texto fora da tela) não é afirmação visível; "R$ 39" e "54" são', () => {
  const corpus = montarCorpus(oculto);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '59', onde: 'visivel' }, corpus).ok, false);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '200', onde: 'visivel' }, corpus).ok, false);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '89', onde: 'visivel' }, corpus).ok, false);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '39', onde: 'visivel' }, corpus).ok, true);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '39,00', onde: 'visivel' }, corpus).ok, true);
  assert.equal(verificarCitacao({ tipo: 'numero', valor: '54', onde: 'visivel' }, corpus).ok, true);
});

test('contagem é RECALCULADA: 57 imagens e 45 lazy passam; 56 ou 12 lazy falham', () => {
  const corpus = montarCorpus(lazy);
  const ok = (fn, esperado, versao = 'final') => verificarCitacao({ tipo: 'contagem', versoes: [versao], contagem: { fn, esperado } }, corpus).ok;
  assert.equal(ok('imagens', 57), true);
  assert.equal(ok('imagens-lazy', 45), true);
  assert.equal(ok('imagens-lazy', 45, 'cru'), true);
  assert.equal(ok('imagens-sem-lazy', 12), true);
  assert.equal(ok('imagens', 56), false);
  assert.equal(ok('imagens-lazy', 12), false);
});

test('gabarito: "depoimentos duplicados" é falso — clones aria-hidden não contam', () => {
  const corpus = montarCorpus(carrossel);
  const c = (esperado) => verificarCitacao({ tipo: 'contagem', contagem: { fn: 'ocorrencias-visiveis', texto: 'Ficou perfeito, entrega rápida.', esperado } }, corpus);
  assert.equal(c(1).ok, true);
  assert.equal(c(2).ok, false); // alegar "aparece 2 vezes" é descartado
  assert.equal(verificarCitacao({ tipo: 'contagem', contagem: { fn: 'nos-clone', esperado: 6 } }, corpus).ok, true);
});

test('verificarAchados: descarta achado com número inventado (mutação) e mantém o verdadeiro', () => {
  const bom = achado({ id: 'bom', mensagem: 'O preço visível é R$ 39.', citacoes: [{ tipo: 'trecho', valor: 'R$ 39', onde: 'visivel' }] });
  const mutante = { ...bom, id: 'mutante', mensagem: 'O preço visível é R$ 59.', citacoes: [{ tipo: 'trecho', valor: 'R$ 59', onde: 'visivel' }] };
  const r = verificarAchados([bom, mutante], oculto);
  assert.deepEqual(r.aprovados.map((a) => a.id), ['bom']);
  assert.equal(r.descartados.length, 1);
  assert.match(r.descartados[0].motivo, /não encontrado/);
});

test('achado "fato" sem citação é descartado; "opinião" sem trecho existente também', () => {
  const r = verificarAchados([achado({ id: 'f' }), achado({ id: 'o', selo: 'opiniao', citacoes: [{ tipo: 'numero', valor: '54', onde: 'visivel' }] })], oculto);
  assert.equal(r.aprovados.length, 0);
  assert.match(r.descartados.find((d) => d.id === 'f').motivo, /sem nenhuma citação/);
  assert.match(r.descartados.find((d) => d.id === 'o').motivo, /ao menos um trecho/);
});

test('números na mensagem sem respaldo (gabarito: "Guia R$ 59 e 200+ receitas") são pegos mesmo com citação válida', () => {
  const a = achado({ id: 'n', mensagem: 'A página vende o Guia por R$ 59 com 200 receitas.', citacoes: [{ tipo: 'trecho', valor: 'Inclui 54 receitas prontas', onde: 'visivel' }] });
  const corpus = montarCorpus(oculto);
  assert.deepEqual(numerosSemRespaldo(a, corpus), [59, 200]);
  const r = verificarAchados([a], oculto);
  assert.equal(r.aprovados.length, 0);
  assert.match(r.descartados[0].motivo, /sem respaldo/);
});

test('números de norma (WCAG 1.4.3, art. 37) e contagens pequenas não são tratados como alegação', () => {
  const a = achado({ id: 'w', selo: 'regra', mensagem: 'Contraste insuficiente (WCAG 1.4.3, art. 37) em 3 trechos.', citacoes: [{ tipo: 'trecho', valor: 'Guia de Receitas Caseiras', onde: 'visivel' }] });
  assert.deepEqual(numerosSemRespaldo(a, montarCorpus(oculto)), []);
});

test('citação com tipo ou função desconhecidos falha de forma segura', () => {
  const corpus = montarCorpus(oculto);
  assert.equal(verificarCitacao({ tipo: 'magia', valor: 'x' }, corpus).ok, false);
  assert.equal(verificarCitacao({ tipo: 'contagem', contagem: { fn: 'nao-existe', esperado: 1 } }, corpus).ok, false);
});

test('valor com milhar e centavos ("22.987,16") não é confundido com id de norma e passa quando citado', () => {
  const a = { id: 'm', regra_id: 'x', selo: 'fato', mensagem: 'O simulador mostra R$ 22.987,16 ao final.', evidencias: [{ valor: '22987.16' }], citacoes: [{ tipo: 'numero', valor: '22987.16', onde: 'qualquer' }] };
  assert.deepEqual(numerosSemRespaldo(a, new Map()), []);
  const sem = { ...a, evidencias: [], citacoes: [] };
  assert.deepEqual(numerosSemRespaldo(sem, new Map()), [22987.16]);
});
