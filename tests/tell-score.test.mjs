import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTellScore, faixaDoTell, PARAMETROS } from '../lib/tell-score.mjs';

const t = (regra_id, peso, disparou, intensidade = 1, categoria = 'visual-cor') => ({ regra_id, categoria, peso, disparou, intensidade: disparou ? intensidade : 0 });

test('sem nenhum tell disparado a nota é 0 (faixa A)', () => {
  const r = calcularTellScore([t('a', 9, false), t('b', 5, false)]);
  assert.equal(r.nota, 0);
  assert.equal(r.faixa.letra, 'A');
});

test('determinismo: mesma entrada, mesma nota, em qualquer ordem', () => {
  const lista = [t('a', 9, true), t('b', 5, true, 0.5), t('c', 3, false), t('d', 4, true)];
  const r1 = calcularTellScore(lista), r2 = calcularTellScore([...lista].reverse()), r3 = calcularTellScore(lista);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1, r3);
});

test('fórmula: S = C dá exatamente 50', () => {
  const r = calcularTellScore([t('a', PARAMETROS.C, true)]);
  assert.equal(r.nota, 50);
});

test('monotonia e saturação: mais tells nunca baixam a nota e ela nunca passa de 100', () => {
  let ant = -1;
  for (let n = 0; n <= 60; n += 5) {
    const lista = Array.from({ length: n }, (_, i) => t('r' + i, 9, true));
    const r = calcularTellScore(lista);
    assert.ok(r.nota >= ant);
    assert.ok(r.nota <= 100);
    ant = r.nota;
  }
});

test('intensidade parcial pesa proporcionalmente', () => {
  assert.equal(calcularTellScore([t('a', 40, true, 0.5)]).somaPontos, 20);
});

test('categorias fora do Tell Score e peso 0 são ignorados', () => {
  const r = calcularTellScore([t('x', 9, true, 1, 'acessibilidade'), t('y', 0, true), t('z', 4, true)]);
  assert.equal(r.regrasDisparadas, 1);
  assert.equal(r.somaPontos, 4);
});

test('crédito de craft: 3+ sinais de cuidado atenuam os tells ambíguos pela metade', () => {
  const craft = [t('tipo-fonte-padrao', 9, false, 1, 'visual-tipografia'), t('tipo-titulo-sem-tracking', 3, false, 1, 'visual-tipografia'), t('sup-raio-unico-em-tudo', 4, false, 1, 'visual-superficie')];
  const sem = calcularTellScore([t('cor-roxo-indigo-padrao', 9, true)]);
  const com = calcularTellScore([...craft, t('cor-roxo-indigo-padrao', 9, true)]);
  assert.equal(sem.somaPontos, 9);
  assert.equal(com.somaPontos, 4.5);
  assert.equal(com.creditoDeCraft.aplicado, true);
  const poucos = calcularTellScore([craft[0], t('cor-roxo-indigo-padrao', 9, true)]);
  assert.equal(poucos.somaPontos, 9);
});

test('ajuste do modelo é limitado a ±10, marcado como opinião, e a nota objetiva fica separada', () => {
  const base = calcularTellScore([t('a', PARAMETROS.C, true)]);
  const mais = calcularTellScore([t('a', PARAMETROS.C, true)], { ajusteModelo: { delta: 30, motivo: 'm' } });
  assert.equal(mais.objetiva, base.objetiva);
  assert.equal(mais.nota, 60);
  assert.equal(mais.ajusteModelo.aplicado, 10);
  assert.equal(mais.ajusteModelo.selo, 'opiniao');
  const menos = calcularTellScore([t('a', 4, true)], { ajusteModelo: { delta: -50 } });
  assert.equal(menos.nota, 0);
});

test('regras instáveis ficam fora da nota', () => {
  const r = calcularTellScore([t('a', 40, true), t('b', 40, true)], { instaveis: ['b'] });
  assert.equal(r.somaPontos, 40);
});

test('faixas', () => {
  assert.equal(faixaDoTell(11.9).letra, 'A');
  assert.equal(faixaDoTell(12).letra, 'B');
  assert.equal(faixaDoTell(44.9).letra, 'C');
  assert.equal(faixaDoTell(64.9).letra, 'D');
  assert.equal(faixaDoTell(65).letra, 'F');
});

test('multiplicador por categoria (calibração) escala os pontos da categoria', () => {
  const lista = [t('a', 10, true, 1, 'visual-cor'), t('b', 10, true, 1, 'visual-tipografia')];
  const base = calcularTellScore(lista);
  const calib = calcularTellScore(lista, { parametros: { ...PARAMETROS, multiplicadores: { 'visual-cor': 2, 'visual-tipografia': 0 } } });
  assert.equal(base.somaPontos, 20);
  assert.equal(calib.somaPontos, 20); // 10×2 + 10×0
  assert.equal(calib.porCategoria['visual-cor'], 20);
  assert.equal(calib.porCategoria['visual-tipografia'], 0);
});
