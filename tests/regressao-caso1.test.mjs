// Regressão do site de exemplo nº 1 (fictício) sobre a fixture local tests/fixtures/exemplo1 (offline e determinística).
// A conferência opcional contra um site real fica em scripts/regressao-caso1.mjs (comando "vivo", resultado só em saidas/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analisar } from '../lib/analisar.mjs';
import { lerJson } from '../lib/util.mjs';
import { conferir } from '../scripts/regressao-caso1.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('exemplo nº 1: NÃO afirma o que não pode e APONTA o que tem que apontar', { timeout: 280000 }, async () => {
  const saidas = mkdtempSync(join(tmpdir(), 'cs-caso1-'));
  const r = await analisar({ entrada: join(fixtures, 'exemplo1'), modo: 'rapido', limitePaginas: 1, intervaloMs: 0, saidas, ignorarMedidores: ['lighthouse'], usarCache: false });
  const analise = lerJson(join(r.pasta, 'analise-parcial.json'));
  const med = {};
  for (const id of ['jsonld', 'imagens', 'lei', 'links', 'js']) med[id] = lerJson(join(r.pasta, 'medicoes', `${id}.json`));
  const checks = conferir(analise, med);
  const falhas = checks.filter((c) => !c.passou);
  assert.deepEqual(falhas.map((c) => `${c.id}: ${c.detalhe}`), []);
  assert.equal(checks.length, 12);
  // o verificador não descartou nada por engano
  assert.equal(analise.descartados.length, 0, JSON.stringify(analise.descartados).slice(0, 400));
});
