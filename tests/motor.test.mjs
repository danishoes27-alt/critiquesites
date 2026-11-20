import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarRegras, rodarMotor, executarMedidores } from '../lib/motor.mjs';

const regra = (id, tipo, extra = {}) => ({ id, categoria: 'visual-cor', titulo: id, selo: 'fato', severidade: 'tell', peso: 5, correcao: 'c', prompt_correcao: 'p', fonte: [{ nome: 'x', licenca: 'MIT' }], deteccao: { tipo, medidor: 'css', metodo: 'm', detectavel_por_script: tipo === 'script' ? 'sim' : 'nao' }, ...extra });

test('carregarRegras filtra por modo e tipo de site', () => {
  const todas = carregarRegras({ modo: 'rapido' });
  assert.ok(todas.length > 100);
  const completo = carregarRegras({ modo: 'completo' });
  assert.ok(completo.length >= todas.length);
  const loja = carregarRegras({ modo: 'completo', tipoDeSite: 'loja' });
  assert.ok(loja.every((r) => r.tipos_de_site.includes('*') || r.tipos_de_site.includes('loja')));
});

test('motor: regra disparada gera achado; não disparada não; null = não avaliada; ausente = sem detector; julgamento vira pergunta', () => {
  const regras = [regra('r-dispara', 'script'), regra('r-nao', 'script'), regra('r-nulo', 'script'), regra('r-sem', 'script'), regra('r-erro', 'script'), regra('r-julga', 'julgamento')];
  const detectores = {
    'r-dispara': () => ({ disparou: true, intensidade: 0.5, achados: [{ pagina: '/', mensagem: 'achei algo aqui', evidencias: [], citacoes: [{ tipo: 'numero', valor: 1 }] }] }),
    'r-nao': () => ({ disparou: false }),
    'r-nulo': () => null,
    'r-erro': () => { throw new Error('boom'); },
  };
  const r = rodarMotor({ ctx: {}, med: {}, regras, detectores });
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].regra_id, 'r-dispara');
  assert.deepEqual(r.cobertura.semDetector, ['r-sem']);
  assert.deepEqual(r.cobertura.naoAvaliadas, ['r-nulo']);
  assert.equal(r.cobertura.comErro[0].regra_id, 'r-erro');
  assert.equal(r.cobertura.perguntasAoModelo, 1);
  assert.equal(r.cobertura.avaliadas, 2);
  const t = r.tells.find((x) => x.regra_id === 'r-dispara');
  assert.equal(t.intensidade, 0.5);
  assert.equal(r.tells.find((x) => x.regra_id === 'r-nao').intensidade, 0);
});

test('executarMedidores: erro de um medidor não derruba os outros', async () => {
  const bom = { id: 'bom', medir: async () => ({ id: 'bom', dados: { x: 1 }, evidencias: [] }) };
  const ruim = { id: 'ruim', medir: async () => { throw new Error('falhou'); } };
  const med = await executarMedidores({}, { medidores: [bom, ruim] });
  assert.deepEqual(med.bom.dados, { x: 1 });
  assert.equal(med.ruim.erro, 'falhou');
});

test('ancorarCitacoes: opinião sem trecho e fato sem citação ganham âncora (título da página); quem já cita não muda', async () => {
  const { ancorarCitacoes } = await import('../lib/motor.mjs');
  const ctx = { paginas: [{ url: 'http://x.test/', final: { extr: { titulo: 'Minha loja', url: 'http://x.test/' } } }] };
  const base = { pagina: '/', citacoes: [] };
  const op = ancorarCitacoes({ ...base, selo: 'opiniao' }, ctx);
  assert.equal(op.citacoes[0].valor, 'Minha loja');
  assert.equal(op.citacao_de_ancora, true);
  assert.equal(ancorarCitacoes({ ...base, selo: 'fato' }, ctx).citacoes.length, 1);
  const ja = { ...base, selo: 'opiniao', citacoes: [{ tipo: 'trecho', valor: 'x' }] };
  assert.equal(ancorarCitacoes(ja, ctx), ja);
  assert.equal(ancorarCitacoes({ ...base, selo: 'regra' }, ctx).citacoes.length, 0);
});
