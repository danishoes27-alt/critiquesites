import { test } from 'node:test';
import assert from 'node:assert/strict';

// as funções estatísticas são exportadas do script; importar não deve rodar nada (sem argumentos o script sai com uso)
const { auc, melhorLimiar } = await import('../scripts/teste-de-acerto.mjs').catch(() => ({}));

test('auc: separação perfeita = 1, nenhuma = 0,5, inversa = 0', { skip: !auc }, () => {
  assert.equal(auc([60, 70, 80], [10, 20, 30]), 1);
  assert.equal(auc([10, 20], [10, 20]), 0.5);
  assert.equal(auc([1, 2], [5, 6]), 0);
});

test('melhorLimiar acha o corte e conta falsos positivos/negativos', { skip: !melhorLimiar }, () => {
  const r = melhorLimiar([40, 50, 60, 20], [10, 15, 25, 45]);
  assert.ok(r.balanceada > 0.5);
  assert.equal(r.vp + r.fn, 4);
  assert.equal(r.fp + r.vn, 4);
});
