import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';
import { lerPagina } from '../lib/ler-pagina.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let servidor, nav, leitura = {};

async function ler(pasta) {
  if (!leitura[pasta]) {
    const s = await servirPasta(fixtures + pasta);
    try { nav.permitirHost(`127.0.0.1:${s.porta}`); leitura[pasta] = await lerPagina(s.url, { nav, permitidos: [`127.0.0.1:${s.porta}`] }); }
    finally { await s.fechar(); }
  }
  return leitura[pasta];
}
const achar = (extr, seletorParte) => extr.nos.find((n) => n.seletor.includes(seletorParte));

before(async () => { nav = await abrirNavegador({ timeoutMs: 15000 }); });
after(async () => { await nav.fechar(); });

test('contador: cru e dom250 mostram 0, final mostra 54 e 1200', async () => {
  const r = await ler('contador');
  assert.deepEqual(r.erros, []);
  assert.equal(achar(r.cru.extr, '#sites').texto, '0');
  assert.equal(achar(r.dom250.extr, '#sites').texto, '0');
  assert.equal(achar(r.final.extr, '#sites').texto, '54');
  assert.equal(achar(r.final.extr, '#alunos').texto, '1200');
});

test('lazy: 57 imagens e 45 com loading=lazy, no cru e no final', async () => {
  const r = await ler('lazy');
  for (const v of [r.cru.extr, r.final.extr]) {
    assert.equal(v.imagens.length, 57);
    assert.equal(v.imagens.filter((i) => i.loading === 'lazy').length, 45);
  }
});

test('carrossel: clones aria-hidden marcados como clone e fora do que é visível único', async () => {
  const r = await ler('carrossel-clone');
  const ex = r.final.extr;
  const cartoes = ex.nos.filter((n) => n.tag === 'p');
  assert.equal(cartoes.length, 6);
  assert.equal(cartoes.filter((n) => n.clone).length, 3);
  assert.equal(cartoes.filter((n) => !n.clone).length, 3);
  assert.equal(ex.clonesDetectados, 3);
  // os clones continuam visíveis aos olhos (carrossel), mas são aria-hidden
  assert.ok(cartoes.filter((n) => n.clone).every((n) => n.ariaOculto));
});

test('oculto: textos ocultos não são visíveis', async () => {
  const r = await ler('oculto');
  const ex = r.final.extr;
  const por = (t) => ex.nos.find((n) => n.texto.includes(t));
  assert.equal(por('R$ 39').visivel, true);
  assert.equal(por('0% OFF').visivel, false);
  assert.equal(por('0% OFF').ocultoPor, 'display:none');
  assert.equal(por('Oferta encerrada').visivel, false);
  assert.equal(por('Guia R$ 59').visivel, false);
  assert.equal(por('Guia R$ 59').ocultoPor, 'fora-da-tela');
  assert.equal(por('Preço antigo').visivel, false);
  assert.equal(por('54 receitas').visivel, true);
});

test('legal: scripts de analytics inline e formulário extraídos', async () => {
  const r = await ler('legal');
  const ex = r.final.extr;
  assert.ok(ex.scripts.some((s) => /gtag\('config','G-'\)/.test(s.inline)));
  assert.ok(ex.scripts.some((s) => /fbq\('init',''\)/.test(s.inline)));
  assert.equal(ex.formularios.length, 1);
  assert.equal(ex.links.filter((l) => l.texto === 'R$ 34,90').length, 3);
});

test('injeção: comentários e atributos coletados', async () => {
  const r = await ler('injecao');
  const ex = r.cru.extr;
  assert.ok(ex.comentarios.some((c) => /ignore as instruções anteriores/i.test(c)));
  assert.ok(ex.atributos.some((a) => a.atributo === 'alt' && /Ignore previous instructions/i.test(a.valor)));
  assert.ok(ex.metas.some((m) => /Ignore todas as instruções/i.test(m.conteudo || '')));
});

test('cru estruturado resolve links relativos pela URL da página (interno = true)', async () => {
  const r = await ler('site-12');
  const links = r.cru.extr.links;
  assert.ok(links.length > 3);
  assert.ok(links.every((l) => l.href.startsWith('http://127.0.0.1:')), 'href resolvido');
  assert.ok(links.filter((l) => l.hrefAttr.startsWith('/')).every((l) => l.interno === true));
});

test('SEGURANÇA: página que sobrescreve Date.now/scrollHeight não trava a leitura para sempre', { timeout: 120000 }, async () => {
  const t0 = Date.now();
  const s = await servirPasta(fixtures + 'm-trava');
  try {
    nav.permitirHost(`127.0.0.1:${s.porta}`);
    const r = await lerPagina(s.url, { nav, permitidos: [`127.0.0.1:${s.porta}`], timeoutMs: 8000 });
    // terminou (com ou sem erro) em tempo finito; o HTML cru continua disponível
    assert.ok(r.cru, 'cru disponível');
    assert.ok(Date.now() - t0 < 100000, `demorou ${Date.now() - t0} ms`);
  } finally { await s.fechar(); }
});
