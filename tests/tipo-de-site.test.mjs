import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';
import { lerPagina } from '../lib/ler-pagina.mjs';
import { montarContexto } from '../lib/contexto.mjs';
import { detectarTipoDeSite, TIPOS } from '../lib/tipo-de-site.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let nav;
const resultados = {};

async function detectar(tipo) {
  const s = await servirPasta(`${fixtures}e-tipo-${tipo}`);
  try {
    const hp = `127.0.0.1:${s.porta}`;
    nav.permitirHost(hp);
    const pagina = await lerPagina(s.url, { nav, permitidos: [hp] });
    assert.deepEqual(pagina.erros, [], `${tipo}: erros de leitura`);
    const ctx = await montarContexto({ urlInicial: s.url, paginas: [pagina], permitidos: [hp], navegador: nav, buscarAtivos: false });
    return detectarTipoDeSite(ctx);
  } finally { await s.fechar(); }
}

before(async () => { nav = await abrirNavegador({ timeoutMs: 20000 }); });
after(async () => { await nav.fechar(); });

// Tipos ambíguos por natureza: aceita confiança 'media', mas exige o tipo certo em 1º lugar do ranking.
const AMBIGUOS = new Set(['landing-page', 'catalogo', 'site-institucional']);

for (const tipo of TIPOS) {
  test(`tipo-de-site: fixture e-tipo-${tipo} é detectada como "${tipo}"`, async () => {
    const r = await detectar(tipo);
    resultados[tipo] = r;
    assert.equal(r.heuristica, true);
    assert.equal(r.ranking[0].tipo, tipo, `ranking: ${JSON.stringify(r.ranking.slice(0, 4))}`);
    assert.equal(r.tipo, tipo);
    assert.ok(['alta', 'media'].includes(r.confianca), `confiança ${r.confianca}; ranking ${JSON.stringify(r.ranking.slice(0, 3))}`);
    if (!AMBIGUOS.has(tipo)) assert.equal(r.confianca, 'alta', `confiança ${r.confianca}; ranking ${JSON.stringify(r.ranking.slice(0, 3))}`);
    assert.equal(Object.keys(r.pontos).length, 11);
    assert.deepEqual(Object.keys(r.pontos).sort(), [...TIPOS].sort());
    assert.ok(r.pontos[tipo] > 0);
    assert.ok(r.sinais.length > 0);
    for (const sn of r.sinais) assert.ok(sn.tipo && sn.sinal && typeof sn.pontos === 'number' && sn.evidencia, JSON.stringify(sn));
  });
}

test('tipo-de-site: a pontuação é determinística (mesma entrada, mesma saída)', async () => {
  const a = await detectar('loja');
  const b = await detectar('loja');
  assert.deepEqual(a.pontos, b.pontos);
  assert.equal(a.confianca, b.confianca);
});

test('tipo-de-site: sem páginas devolve tipo nulo e confiança baixa, sem lançar', () => {
  const r = detectarTipoDeSite({ site: {}, paginas: [] });
  assert.equal(r.tipo, null);
  assert.equal(r.confianca, 'baixa');
  assert.ok(r.indisponivel);
  assert.equal(Object.keys(r.pontos).length, 11);
});

test('tipo-de-site: texto em carrossel clonado e texto oculto não contam como sinal', () => {
  const nos = [
    { tag: 'p', texto: 'Adicionar ao carrinho', visivel: false, clone: false, seletor: 'p' },
    { tag: 'p', texto: 'Adicionar ao carrinho R$ 10,00', visivel: true, clone: true, seletor: 'p' },
    { tag: 'h1', texto: 'Olá', visivel: true, clone: false, seletor: 'h1' },
  ];
  const ctx = { site: { origem: 'http://x.test' }, paginas: [{ url: 'http://x.test/', final: { extr: { nos, links: [], imagens: [], formularios: [], headings: [], jsonld: [], microdata: [], alturaDocumento: 800, titulo: 'x' } } }] };
  const r = detectarTipoDeSite(ctx);
  assert.equal(r.pontos.loja, 0);
});

test('tipo-de-site: a fixture genérica site-12 (menu Sobre/Produtos/Blog/Contato, "desde 2009") cai em site-institucional', async () => {
  const s = await servirPasta(`${fixtures}site-12`);
  try {
    const hp = `127.0.0.1:${s.porta}`;
    nav.permitirHost(hp);
    const pagina = await lerPagina(s.url, { nav, permitidos: [hp] });
    const ctx = await montarContexto({ urlInicial: s.url, paginas: [pagina], permitidos: [hp], navegador: nav, buscarAtivos: false });
    const r = detectarTipoDeSite(ctx);
    assert.equal(r.ranking[0].tipo, 'site-institucional', JSON.stringify(r.ranking.slice(0, 4)));
  } finally { await s.fechar(); }
});
