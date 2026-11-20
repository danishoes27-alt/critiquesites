import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador } from '../lib/navegador.mjs';
import { gerarEntregas, renderizarCard } from '../lib/entrega.mjs';

const d = {
  site: { url: 'https://exemplo.com.br', host: 'exemplo.com.br' },
  carimbo: { iso: '2026-11-18T10:00:00-03:00', hash: 'abcdef0123456789'.repeat(4), versaoSkill: '0.1.0', versaoRegras: 'r1', modo: 'rapido' },
  paginas: [{ url: 'https://exemplo.com.br/', motivo: 'home' }],
  notas: { tell: { nota: 31.2, faixa: { letra: 'C', rotulo: 'x' }, regrasAvaliadas: 1, regrasDisparadas: 1, contribuicoes: [] }, categorias: [{ rotulo: 'Acessibilidade', nota: 72 }, { rotulo: 'Performance', nota: 55 }, { rotulo: 'SEO', nota: 81 }], geral: { nota: 68, nivel: 'Em evolução' } },
  achados: [], descartados: [], julgamento: { versao: 1, tom: 'normal', resumo: 'ok', pontos_fortes: [], pontos_fracos: [], criticas: [], plano: [{ titulo: 'a', porque: 'b', esforco: 'baixo', impacto: 'alto' }] },
};

test('card: placeholders todos resolvidos, valores escapados', () => {
  const h = renderizarCard({ ...d, site: { host: '<b>x</b>.com' } }, 'retrato');
  assert.doesNotMatch(h, /\{\{[A-Z0-9_]+\}\}/);
  assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;.com'));
  assert.ok(h.includes('68'));
  assert.ok(h.includes('Em evolução'));
});

test('card mostra evolução quando há análise anterior', () => {
  const h = renderizarCard({ ...d, anterior: { tellAntes: 61, tellDepois: 31.2, deltaTell: -29.8 } }, 'paisagem');
  assert.match(h, /de 61 para 31.2/);
});

test('gera HTML, PDF e os dois cards PNG', async () => {
  const nav = await abrirNavegador({ timeoutMs: 20000 });
  try {
    const pasta = mkdtempSync(join(tmpdir(), 'cs-entrega-'));
    const s = await gerarEntregas(d, pasta, nav);
    assert.ok(statSync(s.html).size > 1000);
    assert.equal(readFileSync(s.pdf).subarray(0, 5).toString(), '%PDF-');
    assert.ok(statSync(s.pdf).size > 3000);
    for (const k of ['card_retrato', 'card_paisagem']) {
      const b = readFileSync(s[k]);
      assert.equal(b.subarray(1, 4).toString(), 'PNG');
      assert.ok(b.length > 3000);
    }
    const dim = (arq) => { const b = readFileSync(arq); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    assert.deepEqual(dim(s.card_retrato), [1080, 1350]);
    assert.deepEqual(dim(s.card_paisagem), [1200, 630]);
  } finally { await nav.fechar(); }
});
