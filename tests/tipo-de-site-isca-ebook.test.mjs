import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';
import { lerPagina } from '../lib/ler-pagina.mjs';
import { montarContexto } from '../lib/contexto.mjs';
import { detectarTipoDeSite } from '../lib/tipo-de-site.mjs';

// Tarefa 0 (D-027): "ebook" e "e-book" são termos de mercado que o detector precisa reconhecer.
// A página é gerada aqui, numa pasta temporária, para o termo existir só dentro deste teste.
let nav;
const dirs = [];
before(async () => { nav = await abrirNavegador({ timeoutMs: 20000 }); });
after(async () => { await nav.fechar(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function pontosDaPagina(palavra) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-isca-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Casa Exemplo</title></head><body><main><h1>Receitas da vovó Exemplo</h1><p>Aqui você encontra um ${palavra} com receitas simples para o dia a dia. Peça o seu agora.</p><a href="https://exemplo.test/pedido">Peça agora</a></main></body></html>`);
  const s = await servirPasta(dir);
  try {
    const hp = `127.0.0.1:${s.porta}`;
    nav.permitirHost(hp);
    const pagina = await lerPagina(s.url, { nav, permitidos: [hp] });
    const ctx = await montarContexto({ urlInicial: s.url, paginas: [pagina], permitidos: [hp], navegador: nav, buscarAtivos: false });
    return detectarTipoDeSite(ctx);
  } finally { await s.fechar(); }
}

test('isca digital: página que só usa "ebook" volta a somar o ponto de isca (landing-page)', async () => {
  const sem = await pontosDaPagina('caderno impresso');
  for (const palavra of ['ebook', 'e-book']) {
    const com = await pontosDaPagina(palavra);
    assert.equal(+(com.pontos['landing-page'] - sem.pontos['landing-page']).toFixed(1), 1, `"${palavra}" soma 1 ponto de verbo de isca`);
    assert.ok(com.ranking.find((r) => r.tipo === 'landing-page'), 'landing-page está no ranking');
  }
});
