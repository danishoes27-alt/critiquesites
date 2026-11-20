import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';

test('contexto: monta ctx com páginas lidas e ativos', async () => {
  const { ctx } = await lerFixture('ia-ruim');
  assert.equal(ctx.paginas.length, 1);
  assert.equal(ctx.site.host.startsWith('127.0.0.1:'), true);
  assert.ok(ctx.paginas[0].final.extr.nos.length > 3);
  assert.deepEqual(ctx.ativos, []); // CSS é inline nesta fixture
  assert.deepEqual(ctx.paginasComErro, []);
});
