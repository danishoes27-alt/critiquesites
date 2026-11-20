import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAchado, criarAchado, reiniciarIds } from '../lib/achado.mjs';

const regra = { id: 'perf-lazy-loading-contagem', categoria: 'performance', titulo: 't', selo: 'fato', severidade: 'P2', peso: 4, correcao: 'c', prompt_correcao: 'p', fonte: [{ nome: 'x', licenca: 'MIT' }] };

test('criarAchado gera id sequencial e herda dados da regra', () => {
  reiniciarIds();
  const a = criarAchado(regra, { mensagem: '45 de 57 imagens usam lazy.', citacoes: [{ tipo: 'contagem', versoes: ['final'], contagem: { fn: 'imagens-lazy', esperado: 45 } }] });
  assert.equal(a.id, 'ach-0001');
  assert.equal(a.selo, 'fato');
  assert.equal(a.severidade, 'P2');
  assert.equal(validarAchado(a).ok, true);
});

test('selo fato sem citação é inválido; severidade fora do padrão é inválida', () => {
  const a = criarAchado(regra, { mensagem: 'mensagem qualquer' });
  assert.equal(validarAchado(a).ok, false);
  const b = { ...a, citacoes: [{ tipo: 'numero', valor: 1 }], severidade: 'urgente' };
  assert.equal(validarAchado(b).ok, false);
});

test('severidade tell/smell vira P2/P3', () => {
  assert.equal(criarAchado({ ...regra, severidade: 'tell' }, { mensagem: 'm m m m m' }).severidade, 'P2');
  assert.equal(criarAchado({ ...regra, severidade: 'smell' }, { mensagem: 'm m m m m' }).severidade, 'P3');
});
