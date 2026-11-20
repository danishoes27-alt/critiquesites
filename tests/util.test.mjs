import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, normalizarTexto, extrairNumeros, paraNumero, numerosIguais, slugDe, normalizarUrl, jsonEstavel } from '../lib/util.mjs';

test('sha256 é estável', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('normalizarTexto: entidades, NBSP, espaços e caixa', () => {
  assert.equal(normalizarTexto('  R$&nbsp;9,90 \n  AGORA  '), 'r$ 9,90 agora');
  assert.equal(normalizarTexto('Ação', { caixa: false }), 'Ação');
});

test('números: 9,90 ≡ 9.90 e milhares', () => {
  assert.equal(paraNumero('9,90'), 9.9);
  assert.equal(paraNumero('1.234,50'), 1234.5);
  assert.ok(numerosIguais('9,90', '9.90'));
  assert.deepEqual(extrairNumeros('de R$ 197 por R$ 9,90 em 54 sites'), [197, 9.9, 54]);
  assert.deepEqual(extrairNumeros('+R$ 3.000 por mês'), [3000]);
});

test('slugDe', () => {
  assert.equal(slugDe('https://exemplo.com/'), 'exemplo-com');
  assert.equal(slugDe('Minha Pasta Ação'), 'minha-pasta-acao');
});

test('normalizarUrl: remove hash, utm e barra final', () => {
  assert.equal(normalizarUrl('https://Ex.com/a/?utm_source=x&b=2#topo'), 'https://ex.com/a?b=2');
  assert.equal(normalizarUrl('/sobre/', 'https://ex.com'), 'https://ex.com/sobre');
  assert.equal(normalizarUrl('mailto:a@b.com'), null);
  assert.equal(normalizarUrl('https://ex.com/'), 'https://ex.com/');
  assert.equal(normalizarUrl('https://ex.com/index.html'), 'https://ex.com/');
  assert.equal(normalizarUrl('https://ex.com/blog/index.html'), 'https://ex.com/blog');
});

test('jsonEstavel ordena chaves', () => {
  assert.equal(jsonEstavel({ b: 1, a: { d: 1, c: 2 } }, 0), '{"a":{"c":2,"d":1},"b":1}');
});
