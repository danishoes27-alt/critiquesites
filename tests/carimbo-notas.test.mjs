import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoLocal, criarCarimbo, nomeDaPasta, versaoDasRegras } from '../lib/carimbo.mjs';
import { calcularNotas } from '../lib/notas.mjs';

test('isoLocal: data/hora de Brasília com deslocamento -03:00', () => {
  assert.equal(isoLocal(new Date('2026-11-18T13:00:00Z')), '2026-11-18T10:00:00-03:00');
  assert.equal(isoLocal(new Date('2026-11-18T02:30:00Z')), '2026-11-17T23:30:00-03:00');
});

test('carimbo e nome de pasta ordenável', () => {
  const c = criarCarimbo({ hashVersao: 'abcdef0123456789'.repeat(4), modo: 'rapido', agora: new Date('2026-11-18T13:07:00Z'), versaoRegras: 'r1' });
  assert.equal(nomeDaPasta(c), '20261118-1007-abcdef01');
  assert.equal(c.modo, 'rapido');
  assert.match(c.versaoSkill, /^\d+\.\d+\.\d+$/);
});

test('versaoDasRegras é estável e tem 12 caracteres hex', () => {
  const a = versaoDasRegras(), b = versaoDasRegras();
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

const t = (categoria, peso, disparou, severidade = 'P2', intensidade = 1) => ({ regra_id: categoria + peso + disparou, categoria, peso, severidade, disparou, intensidade: disparou ? intensidade : 0 });

test('notas: sem nada disparado = 100; mais problemas = nota menor; sem dados é sinalizado', () => {
  const limpo = calcularNotas({ tells: [t('acessibilidade', 6, false), t('seo', 4, false)], tellScore: { nota: 10 } });
  assert.equal(limpo.categorias.find((c) => c.id === 'acessibilidade').nota, 100);
  assert.equal(limpo.categorias.find((c) => c.id === 'performance').semDados, true);
  const sujo = calcularNotas({ tells: [t('acessibilidade', 6, true, 'P1'), t('acessibilidade', 6, true, 'P1'), t('seo', 4, false)], tellScore: { nota: 10 } });
  assert.ok(sujo.categorias.find((c) => c.id === 'acessibilidade').nota < 100);
  assert.ok(sujo.geral.nota < limpo.geral.nota);
});

test('notas: Lighthouse e regras viram média; estrutura = 100 − Tell Score; nível geral por faixa', () => {
  const r = calcularNotas({ tells: [t('performance', 4, false)], tellScore: { nota: 20 }, lighthouse: { scores: { performance: 60 } } });
  assert.equal(r.categorias.find((c) => c.id === 'performance').nota, 80);
  assert.equal(r.categorias.find((c) => c.id === 'estrutura-visual').nota, 80);
  assert.equal(r.geral.nota, 80);
  assert.equal(r.geral.nivel, 'Sólido');
  assert.equal(calcularNotas({ tells: [], tellScore: { nota: 90 } }).geral.nivel, 'Iniciante');
});

test('informativos (severidade info / peso 0) não derrubam a nota', () => {
  const r = calcularNotas({ tells: [t('seo', 4, true, 'info'), t('ia-visibilidade', 0, true, 'info')], tellScore: null });
  assert.equal(r.categorias.find((c) => c.id === 'seo').nota, 100);
});
