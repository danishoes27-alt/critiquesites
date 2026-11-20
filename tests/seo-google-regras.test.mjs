import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { carregarRegras, carregarDetectores, carregarMedidores } from '../lib/motor.mjs';
import { carregarConfigSeo } from '../lib/seo-nota.mjs';
import { acharInstrucaoDeCopia, mencionaReferencia, acharPromessaDePosicao } from '../lib/avisos.mjs';

const novas = JSON.parse(readFileSync(new URL('../regras/seo-google.json', import.meta.url), 'utf8'));
const todas = carregarRegras({ modo: 'completo' });

test('regras novas: ids com prefixo seo-, categoria seo-google, sem repetir nenhum id das outras regras', () => {
  assert.ok(novas.length >= 15);
  const ids = todas.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'id repetido');
  for (const r of novas) { assert.match(r.id, /^seo-/); assert.equal(r.categoria, 'seo-google'); }
  const antigas = JSON.parse(readFileSync(new URL('../regras/seo.json', import.meta.url), 'utf8')).map((r) => r.id);
  for (const r of novas) assert.ok(!antigas.includes(r.id), `repete regra antiga ${r.id}`);
});

test('toda regra nova tem fonte com URL https e data, confiança, selo e peso; heurística é dita como heurística', () => {
  for (const r of novas) {
    assert.ok(r.fonte.length >= 1, r.id);
    for (const f of r.fonte) { assert.match(f.url, /^https:\/\//, r.id); assert.match(f.data_consulta, /^2026-11-20$/); assert.ok(f.licenca, r.id); }
    assert.ok(['alta', 'media', 'baixa'].includes(r.confianca));
    assert.ok(['regra', 'opiniao', 'nao-verificavel'].includes(r.selo), `${r.id}: selo ${r.selo} (nenhuma regra nova é "fato")`);
    if (r.selo === 'opiniao') assert.ok(r.confianca !== 'alta', `${r.id}: opinião com confiança alta`);
  }
  // todo E-E-A-T, termo e local de conveniência é opinião/heurística
  for (const r of novas.filter((x) => /^seo-eeat-|^seo-termo-/.test(x.id))) assert.equal(r.selo, 'opiniao', r.id);
});

test('módulo só no modo completo: nenhuma regra nova carrega no modo rápido', () => {
  assert.equal(carregarRegras({ modo: 'rapido' }).filter((r) => r.categoria === 'seo-google').length, 0);
  assert.equal(carregarRegras({ modo: 'completo' }).filter((r) => r.categoria === 'seo-google').length, novas.length);
});

test('todas as regras novas têm detector e o medidor seo-google existe', async () => {
  const det = await carregarDetectores();
  for (const r of novas) assert.equal(typeof det[r.id], 'function', `sem detector: ${r.id}`);
  assert.ok((await carregarMedidores()).some((m) => m.id === 'seo-google'));
});

test('config: regras reaproveitadas existem de verdade (não são recriadas) e a FAQPage NÃO é recomendada', () => {
  const cfg = carregarConfigSeo();
  const ids = new Set(todas.map((r) => r.id));
  for (const id of cfg.regras_reaproveitadas_de_outras_areas) assert.ok(ids.has(id), `não existe: ${id}`);
  for (const id of cfg.regras_reaproveitadas_de_outras_areas) assert.ok(!novas.some((r) => r.id === id));
  const texto = JSON.stringify(novas);
  assert.doesNotMatch(texto, /FAQPage/);
  assert.ok(ids.has('seg-fonte-google-servidores'), 'regra antiga preservada');
});

test('prompts de correção das regras novas: sem ordem de copiar e sem promessa de posição', () => {
  for (const r of novas) {
    assert.deepEqual(acharInstrucaoDeCopia(r.prompt_correcao), [], r.id);
    assert.deepEqual(acharPromessaDePosicao(`${r.titulo} ${r.descricao} ${r.correcao} ${r.prompt_correcao} ${r.notas || ''}`), [], r.id);
    if (mencionaReferencia(r.prompt_correcao)) assert.fail(`${r.id} fala de referência: precisa do aviso`);
  }
  assert.ok(readdirSync(new URL('../regras/', import.meta.url)).includes('seo-google.json'));
});
