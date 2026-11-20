import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfigCustos, custoUsd, custoDoUso, estimarCusto, textoAviso, formatarReais, rodapeDeCusto } from '../lib/custo.mjs';

const cfg = carregarConfigCustos();

test('config traz fonte e data da cotação e dos preços', () => {
  assert.match(cfg.cotacao.fonte, /Banco Central/);
  assert.match(cfg.cotacao.data_cotacao, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(cfg.precos.url, /^https:\/\/platform\.claude\.com\//);
  assert.ok(cfg.cotacao.valor > 3 && cfg.cotacao.valor < 10);
});

test('custoUsd: 1M de entrada e 1M de saída do Sonnet 5.5 = US$ 12', () => {
  assert.equal(custoUsd(cfg.precos.modelos['sonnet-5-5'], { entrada: 1e6, saida: 1e6 }), 12);
});

test('Haiku 5.5: faixa acima de 100 mil tokens custa mais', () => {
  const h = cfg.precos.modelos['haiku-5-5'];
  assert.equal(custoUsd(h, { entrada: 1e6, saida: 0 }), 0.5); // 1M > 100k: faixa alta
  assert.equal(custoUsd(h, { entrada: 50000, saida: 0 }), 0.005); // abaixo: 0,10/M
});

test('custoDoUso converte para R$ com a cotação do arquivo', () => {
  const r = custoDoUso([{ modelo: 'sonnet-5-5', entrada: 1e6, saida: 0 }], cfg);
  assert.equal(r.usd, 2);
  assert.ok(Math.abs(r.reais - 2 * cfg.cotacao.valor) < 1e-9);
  assert.throws(() => custoDoUso([{ modelo: 'inexistente', entrada: 1 }], cfg), /modelo desconhecido/);
});

test('estimarCusto: completo custa mais que rápido, e o aviso traz R$, fonte e teto', () => {
  const r = estimarCusto({ modo: 'rapido', paginas: 8 }, cfg);
  const c = estimarCusto({ modo: 'completo', paginas: 30 }, cfg);
  assert.ok(c.reais > r.reais);
  const txt = textoAviso(c);
  assert.match(txt, /R\$ \d+,\d{2}/);
  assert.match(txt, /Banco Central/);
  assert.match(txt, /Teto/);
});

test('teto: acima do teto é sinalizado', () => {
  const baixo = { ...cfg, teto_reais: 0.01 };
  const r = estimarCusto({ modo: 'rapido', paginas: 8 }, baixo);
  assert.equal(r.acimaDoTeto, true);
  assert.match(textoAviso(r), /ATENÇÃO/);
});

test('formatarReais e rodapé', () => {
  assert.equal(formatarReais(0.9), 'R$ 0,90');
  assert.equal(formatarReais(1234.567), 'R$ 1234,57');
  const rod = rodapeDeCusto([{ modelo: 'sonnet-5-5', entrada: 10000, saida: 2000 }], cfg);
  assert.equal(rod.tokensEntrada, 10000);
  assert.equal(rod.tokensSaida, 2000);
  assert.ok(rod.reais > 0);
});
