import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analisar } from '../lib/analisar.mjs';
import { lerJson } from '../lib/util.mjs';
import { renderizarRelatorio } from '../lib/relatorio.mjs';
import { renderizarCard } from '../lib/entrega.mjs';
import { compararAnalises } from '../lib/reanalisar.mjs';
import { acharPromessaDePosicao } from '../lib/avisos.mjs';
import { conferir } from '../scripts/regressao-caso1.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const csv = join(fixtures, 'search-console', 'consultas-pt.csv');
const base = { limitePaginas: 3, intervaloMs: 0, ignorarMedidores: ['lighthouse', 'axe'], usarCache: false };
const R = {};

before(async () => {
  const saidas = mkdtempSync(join(tmpdir(), 'cs-seo-'));
  const ler = async (nome, extra) => { const r = await analisar({ entrada: join(fixtures, nome), saidas, ...base, ...extra }); return { pasta: r.pasta, parcial: lerJson(join(r.pasta, 'analise-parcial.json')) }; };
  R.rapido = await ler('seo-ruim', { modo: 'rapido' });
  R.seo = await ler('seo-ruim', { modo: 'rapido', seo: true, csv: [csv] });
  R.exemplo = await ler('exemplo1', { modo: 'completo', tipoInformado: 'loja', limitePaginas: 1 });
}, { timeout: 280000 });

test('modo rápido sem pedido de SEO: módulo não carrega (sem medidor, sem regra nova, sem nota)', () => {
  const { pasta, parcial } = R.rapido;
  assert.equal(parcial.seoGoogle, null);
  assert.equal(existsSync(join(pasta, 'medicoes', 'seo-google.json')), false);
  const tells = lerJson(join(pasta, 'tells.json'));
  assert.equal(tells.filter((t) => t.categoria === 'seo-google').length, 0);
});

test('pedido explícito de SEO (e CSV): módulo carrega mesmo no modo rápido, com nota e Search Console', () => {
  const { pasta, parcial } = R.seo;
  const s = parcial.seoGoogle;
  assert.equal(s.ativo, true);
  assert.equal(typeof s.nota.nota, 'number');
  assert.ok(s.nota.nota < 60);
  assert.ok(existsSync(join(pasta, 'medicoes', 'seo-google.json')));
  assert.equal(s.searchConsole.disponivel, true);
  assert.ok(s.searchConsole.posicao4a20.length > 0);
  assert.deepEqual(s.naoVerificavel.slice(0, 3), ['volume de busca', 'dificuldade da palavra-chave', 'posição real no Google']);
  // o arquivo CSV nunca é copiado para a pasta da análise nem seu caminho gravado
  const todo = JSON.stringify(parcial);
  assert.ok(!todo.includes('consultas-pt.csv') || todo.includes('"arquivo":"consultas-pt.csv"'));
  assert.ok(!todo.includes(csv.replace(/\\/g, '\\\\')));
  assert.equal(existsSync(join(pasta, 'consultas-pt.csv')), false);
  assert.equal(parcial.notas.geral.nota, R.rapido.parcial.notas.geral.nota, 'a nota geral não muda por causa do módulo');
});

test('relatório e card mostram a nota de SEO, o aviso de posição e a evolução; sem promessa', () => {
  const dados = { site: { url: 'http://x.test/', host: 'x.test' }, carimbo: { iso: '2026-11-20T10:00:00-03:00', hash: 'a'.repeat(64), versaoSkill: '0.1.0', versaoRegras: 'r', modo: 'completo' }, paginas: [], notas: R.seo.parcial.notas, achados: R.seo.parcial.achados, descartados: [], seoGoogle: R.seo.parcial.seoGoogle,
    julgamento: { versao: 1, tom: 'normal', resumo: 'ok', pontos_fortes: [], pontos_fracos: [], criticas: [], plano: [{ titulo: 'a', porque: 'b', esforco: 'baixo', impacto: 'baixo' }] },
    anterior: { mensagem: 'm', deltaTell: 0, tellAntes: 10, tellDepois: 10, deltaSeo: 12.5, seoAntes: 40, seoDepois: 52.5, resolvidos: [], novos: [], persistentes: [] } };
  const html = renderizarRelatorio(dados);
  assert.match(html, /Subir no Google/);
  assert.match(html, /Ninguém garante o primeiro lugar no Google/);
  assert.match(html, /Nota de SEO: de <strong>40<\/strong> para <strong>52.5<\/strong>/);
  assert.match(html, /Posição média entre 4 e 20/);
  const card = renderizarCard(dados, 'paisagem');
  assert.match(card, /Nota de SEO \(maior é melhor\): \d+\/100 \(\+12.5 desde a última análise\)/);
  assert.deepEqual(acharPromessaDePosicao(html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')), []);
  // sem o módulo, o relatório não ganha bloco nem linha no card
  const sem = renderizarRelatorio({ ...dados, seoGoogle: null });
  assert.doesNotMatch(sem, /Subir no Google/);
  assert.doesNotMatch(renderizarCard({ ...dados, seoGoogle: null, anterior: null }, 'paisagem'), /Nota de SEO/);
});

test('reanalisar: a evolução da nota de SEO entra no comparativo', () => {
  const analise = (nota, hash) => ({ carimbo: { iso: '2026-11-20T10:00:00-03:00', hash, versaoRegras: 'r' }, notas: { tell: { nota: 20 }, categorias: [], geral: { nota: 70 } }, achados: [], seoGoogle: { nota: { nota } } });
  const c = compararAnalises(analise(42.9, 'a'), analise(96.8, 'b'));
  assert.equal(c.deltaSeo, 53.9);
  assert.equal(c.seoAntes, 42.9);
  assert.match(c.mensagem, /A nota de SEO subiu de 42.9 para 96.8/);
  const sem = compararAnalises({ ...analise(1, 'a'), seoGoogle: null }, analise(2, 'b'));
  assert.equal(sem.deltaSeo, null);
});

// ---- Regressão "exemplo nº 1": a skill não nega o que o código tem (contagem em código x o que a skill diz) ----
test('exemplo nº 1 (fictício): tipos de dados estruturados e imagens lazy contados em código batem com a skill', () => {
  const html = readFileSync(join(fixtures, 'exemplo1', 'index.html'), 'utf8');
  const tipos = new Set();
  const colher = (o) => { if (Array.isArray(o)) o.forEach(colher); else if (o && typeof o === 'object') { if (o['@type']) [].concat(o['@type']).forEach((t) => tipos.add(t)); Object.values(o).forEach(colher); } };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) colher(JSON.parse(m[1]));
  const lazyCodigo = (html.match(/<img\b[^>]*\bloading="lazy"/g) || []).length;
  const imgCodigo = (html.match(/<img\b/g) || []).length;
  assert.deepEqual([...tipos].sort(), ['FAQPage', 'Offer', 'Product', 'Question', 'Answer', 'VideoObject', 'WebPage', 'WebSite'].sort());
  assert.equal(lazyCodigo, 45);
  assert.equal(imgCodigo, 57);
  const { pasta, parcial } = R.exemplo;
  const jl = lerJson(join(pasta, 'medicoes', 'jsonld.json')).dados.site;
  assert.deepEqual([...jl.final.tipos].sort(), [...tipos].sort(), 'tipos medidos pela skill = tipos contados em código');
  const im = lerJson(join(pasta, 'medicoes', 'imagens.json')).dados;
  const f = im.site?.final ?? im.paginas?.[0]?.final;
  assert.equal(f.lazy, lazyCodigo);
  assert.equal(f.total, imgCodigo);
  // o que a skill diz: nunca "sem dados estruturados" nem "sem lazy loading"
  const checks = conferir(parcial, { jsonld: lerJson(join(pasta, 'medicoes', 'jsonld.json')), imagens: lerJson(join(pasta, 'medicoes', 'imagens.json')) });
  for (const id of ['N1', 'N2']) assert.equal(checks.find((c) => c.id === id).passou, true, id);
  const texto = JSON.stringify(parcial.achados.map((a) => [a.mensagem, a.interpretacao?.texto || '']));
  assert.doesNotMatch(texto, /sem dados estruturados|sem lazy loading|nenhuma imagem usa/i);
  // site de venda com Product: a regra de produto ausente NÃO dispara
  assert.ok(!parcial.achados.some((a) => a.regra_id === 'seo-produto-sem-dado-estruturado'));
  assert.ok(parcial.seoGoogle.ativo);
});
