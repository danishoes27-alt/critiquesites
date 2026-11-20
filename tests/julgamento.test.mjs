import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { validarJulgamento } from '../lib/julgamento.mjs';

let ctx;
before(async () => { ctx = (await lerFixture('oculto')).ctx; });

const achados = [{ id: 'ach-0001', regra_id: 'x', selo: 'fato', citacoes: [{ tipo: 'trecho', valor: 'R$ 9,90', onde: 'visivel' }], evidencias: [{ valor: '54', trecho: 'Inclui 54 receitas prontas' }] }];
const base = () => ({
  versao: 1, tom: 'normal', resumo: 'A página vende o Guia por R$ 9,90 e entrega 54 receitas prontas.',
  pontos_fortes: [{ titulo: 'Preço claro', texto: 'O valor R$ 9,90 está visível.', achados: ['ach-0001'] }],
  pontos_fracos: [], criticas: [{ achado_id: 'ach-0001', texto: 'O preço aparece sem as condições de pagamento.' }],
  plano: [{ titulo: 'Mostrar condições do preço', porque: 'Evita dúvida na hora de comprar.', esforco: 'baixo', impacto: 'alto', achados: ['ach-0001'] }],
});
const v = (j, extra = {}) => validarJulgamento(j, { achadosVerificados: achados, ctx, numerosDoRelatorio: [], ...extra });

test('julgamento válido passa', () => {
  assert.deepEqual(v(base()), { ok: true, erros: [] });
});

test('schema: campo obrigatório ausente e valor fora do enum são rejeitados', () => {
  const j = base(); delete j.plano;
  assert.equal(v(j).ok, false);
  const k = base(); k.plano[0].esforco = 'enorme';
  assert.equal(v(k).ok, false);
});

test('referência a achado inexistente (ou descartado) é rejeitada', () => {
  const j = base(); j.criticas[0].achado_id = 'ach-9999';
  const r = v(j);
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /ach-9999/);
});

test('gabarito: número inventado ("Guia R$ 59 e 200+ receitas") é rejeitado; número real passa', () => {
  const j = base(); j.resumo = 'O Guia custa R$ 59 e traz 200 receitas.';
  const r = v(j);
  assert.equal(r.ok, false);
  assert.match(r.erros.join(' '), /sem respaldo/);
});

test('nota e contagens do relatório podem ser citadas quando informadas em numerosDoRelatorio', () => {
  const j = base(); j.resumo = 'O Tell Score ficou em 38 pontos e há 17 achados.';
  assert.equal(v(j).ok, false);
  assert.equal(v(j, { numerosDoRelatorio: [38, 17] }).ok, true);
});

test('afirmar autoria por IA, ilegalidade, 100% de acerto ou ofensa é rejeitado', () => {
  for (const frase of ['Este texto foi escrito por IA com certeza.', 'O site é ilegal.', 'Nossa nota tem 100% de acerto.', 'Quem fez isso é um idiota.', 'Bloqueie o GPTBot no robots.txt.']) {
    const j = base(); j.resumo = frase;
    assert.equal(v(j).ok, false, frase);
  }
  const ok = base(); ok.resumo = 'O texto é genérico e batido: serviria para qualquer concorrente.';
  assert.equal(v(ok).ok, true);
});

test('crítica duplicada e heurística desconhecida são rejeitadas', () => {
  const j = base(); j.criticas.push({ achado_id: 'ach-0001', texto: 'de novo' });
  assert.equal(v(j).ok, false);
  const k = base(); k.heuristicas = [{ regra_id: 'ux-inexistente', nota: 3, motivo: 'm' }];
  assert.equal(v(k, { regrasHeuristica: ['ux-heuristica-1'] }).ok, false);
});

test('ajuste do Tell Score precisa ficar entre -10 e +10', () => {
  const j = base(); j.ajuste_tell = { delta: 25, motivo: 'm' };
  assert.equal(v(j).ok, false);
  j.ajuste_tell.delta = 6;
  assert.equal(v(j).ok, true);
});
