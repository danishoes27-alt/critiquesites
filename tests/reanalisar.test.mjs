import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compararAnalises, chaveDoAchado, acharAnaliseAnterior } from '../lib/reanalisar.mjs';

const ach = (regra, pagina, seletor, extra = {}) => ({ id: 'x', regra_id: regra, titulo: regra, pagina, peso_aplicado: 4, evidencias: [{ seletor }], ...extra });
const analise = (hash, tell, achados, extra = {}) => ({
  carimbo: { iso: '2026-11-10T10:00:00-03:00', hash, versaoRegras: 'r1' },
  notas: { tell: { nota: tell }, categorias: [{ id: 'acessibilidade', rotulo: 'Acessibilidade', nota: 60 }, { id: 'seo', rotulo: 'SEO', nota: 70 }], geral: { nota: 65 } },
  achados, ...extra,
});

test('evolução: resolvidos, novos e persistentes por chave estável; delta do Tell Score', () => {
  const antes = analise('h1', 61, [ach('r-a', '/', 'h1'), ach('r-b', '/', 'img'), ach('r-c', '/sobre', 'p')]);
  const depois = analise('h2', 31.2, [ach('r-b', '/', 'img'), ach('r-d', '/', 'a')], { notas: { tell: { nota: 31.2 }, categorias: [{ id: 'acessibilidade', rotulo: 'Acessibilidade', nota: 85 }, { id: 'seo', rotulo: 'SEO', nota: 70 }], geral: { nota: 78 } } });
  const r = compararAnalises(antes, depois);
  assert.deepEqual(r.resolvidos.map((x) => x.regra_id).sort(), ['r-a', 'r-c']);
  assert.deepEqual(r.novos.map((x) => x.regra_id), ['r-d']);
  assert.deepEqual(r.persistentes.map((x) => x.regra_id), ['r-b']);
  assert.equal(r.deltaTell, -29.8);
  assert.equal(r.deltaGeral, 13);
  assert.deepEqual(r.deltaCategorias.find((c) => c.id === 'acessibilidade'), { id: 'acessibilidade', rotulo: 'Acessibilidade', antes: 60, depois: 85, delta: 25 });
  assert.match(r.mensagem, /melhorou: de 61 para 31.2/);
});

test('mesmo hash: avisa que nada mudou', () => {
  const a = analise('igual', 40, []);
  const r = compararAnalises(a, analise('igual', 40, []));
  assert.equal(r.mesmoHash, true);
  assert.match(r.mensagem, /Nada mudou/);
});

test('conjunto de regras diferente: avisa que a comparação não é igual para igual', () => {
  const a = analise('h1', 40, []);
  const b = analise('h2', 45, [], { carimbo: { iso: 'x', hash: 'h2', versaoRegras: 'r2' } });
  const r = compararAnalises(a, b);
  assert.equal(r.regrasDiferentes, true);
  assert.match(r.mensagem, /piorou/);
  assert.match(r.mensagem, /conjunto de regras mudou/);
});

test('achados de peso 0 (informativos) não entram na comparação', () => {
  const a = analise('h1', 40, [ach('ia-llms', '/', 'x', { peso_aplicado: 0 })]);
  const b = analise('h2', 40, []);
  assert.equal(compararAnalises(a, b).resolvidos.length, 0);
});

test('chave estável usa regra, página e âncora', () => {
  assert.equal(chaveDoAchado(ach('r', '/p', 'div>h1')), 'r|/p|div>h1');
});

test('acharAnaliseAnterior pega a mais recente antes da atual', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'cs-re-'));
  for (const nome of ['20261101-0900-aaaaaaaa', '20261105-1000-bbbbbbbb', '20261110-1000-cccccccc']) {
    mkdirSync(join(raiz, nome));
    writeFileSync(join(raiz, nome, 'analise.json'), JSON.stringify({ n: nome }));
  }
  assert.equal(acharAnaliseAnterior(raiz, '20261110-1000-cccccccc').nome, '20261105-1000-bbbbbbbb');
  assert.equal(acharAnaliseAnterior(raiz).nome, '20261110-1000-cccccccc');
  assert.equal(acharAnaliseAnterior(raiz, '20261101-0900-aaaaaaaa'), null);
  assert.equal(acharAnaliseAnterior(join(raiz, 'nao-existe')), null);
});
