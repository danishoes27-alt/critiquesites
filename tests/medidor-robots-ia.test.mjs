import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/robots-ia.mjs';

async function medirFixture(nome) {
  const { ctx, fechar } = await lerFixture(nome, { manterAberto: true, buscarAtivos: false });
  try { return await medidor.medir(ctx); } finally { await fechar(); }
}
const por = (dados, id) => dados.rastreadores.find((r) => r.id === id);

let com, sem, sitemapFixture;
before(async () => {
  com = await medirFixture('d-robots-ia');
  sem = await medirFixture('d-sem-robots');
  sitemapFixture = await medirFixture('site-12');
});

test('interface do medidor', () => {
  assert.equal(medidor.id, 'robots-ia');
  assert.equal(com.id, 'robots-ia');
  assert.ok(com.dados && Array.isArray(com.evidencias));
});

test('lista de rastreadores: mínimo exigido, com categoria e documentação oficial', () => {
  const ids = medidor.RASTREADORES.map((r) => r.id);
  for (const esperado of ['gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-searchbot', 'claude-user', 'google-extended', 'perplexitybot', 'perplexity-user', 'applebot-extended', 'ccbot', 'meta-externalagent', 'amazonbot']) assert.ok(ids.includes(esperado), esperado);
  for (const r of medidor.RASTREADORES) {
    assert.ok(['treino', 'busca', 'consulta-por-usuario'].includes(r.categoria), r.id);
    assert.match(r.documentacao, /^https:\/\//, r.id);
  }
});

test('robots.txt da fixture: GPTBot e ClaudeBot bloqueados (treino), OAI-SearchBot liberado (busca)', () => {
  const d = com.dados;
  assert.equal(d.robots.presente, true);
  assert.equal(d.robots.status, 200);
  assert.equal(d.robots.grupos, 6);
  assert.deepEqual(d.robots.sitemaps, ['/sitemap.xml']);

  const gpt = por(d, 'gptbot');
  assert.equal(gpt.situacao, 'bloqueado');
  assert.equal(gpt.categoria, 'treino');
  assert.equal(gpt.parcial, false);
  assert.equal(gpt.grupo, 'grupo específico (User-agent: gptbot)');
  assert.equal(por(d, 'claudebot').situacao, 'bloqueado');

  const oai = por(d, 'oai-searchbot');
  assert.equal(oai.situacao, 'liberado');
  assert.equal(oai.categoria, 'busca');
  assert.equal(oai.parcial, false);
});

test('bloqueio parcial e grupo curinga', () => {
  const d = com.dados;
  const perp = por(d, 'perplexitybot');
  assert.equal(perp.situacao, 'liberado');
  assert.equal(perp.parcial, true);
  assert.deepEqual(perp.restricoes.disallow, ['/privado/']);

  const goog = por(d, 'google-extended');
  assert.equal(goog.situacao, 'bloqueado');
  assert.equal(goog.parcial, true); // raiz bloqueada, mas /publico/ liberado
  assert.deepEqual(goog.restricoes.allow, ['/publico/']);

  const ccbot = por(d, 'ccbot');
  assert.equal(ccbot.situacao, 'liberado');
  assert.equal(ccbot.parcial, true);
  assert.equal(ccbot.grupo, 'grupo curinga (User-agent: *)');
});

test('resumo: contagens exatas por categoria', () => {
  assert.deepEqual(com.dados.resumo, {
    treinoLiberado: 4, treinoBloqueado: 3,
    buscaLiberado: 3, buscaBloqueado: 0,
    consultaPorUsuarioLiberado: 4, consultaPorUsuarioBloqueado: 0,
    indeterminado: 0, total: 14,
  });
});

test('llms.txt e sitemap.xml presentes', () => {
  const { llms, sitemap } = com.dados;
  assert.equal(llms.presente, true);
  assert.equal(llms.status, 200);
  assert.equal(llms.tituloMarkdown, 'Casa de Teste');
  assert.equal(llms.linhas, 5); // linhas não vazias do llms.txt da fixture
  assert.match(llms.nota, /não é necessário/);
  assert.equal(sitemap.presente, true);
  assert.equal(sitemap.tipo, 'urlset');
  assert.equal(sitemap.entradas, 2);
});

test('sem robots.txt: tudo liberado por omissão, llms.txt e sitemap ausentes (404)', () => {
  const d = sem.dados;
  assert.equal(d.robots.presente, false);
  assert.equal(d.robots.status, 404);
  assert.deepEqual(d.resumo, { treinoLiberado: 7, treinoBloqueado: 0, buscaLiberado: 3, buscaBloqueado: 0, consultaPorUsuarioLiberado: 4, consultaPorUsuarioBloqueado: 0, indeterminado: 0, total: 14 });
  for (const r of d.rastreadores) {
    assert.equal(r.situacao, 'liberado');
    assert.equal(r.parcial, false);
    assert.equal(r.grupo, 'sem robots.txt: liberado por omissão');
  }
  assert.equal(d.llms.presente, false);
  assert.equal(d.llms.status, 404);
  assert.equal(d.sitemap.presente, false);
});

test('site-12: robots.txt só com grupo "*" e sem regra para IA -> liberado, grupo curinga', () => {
  const d = sitemapFixture.dados;
  assert.equal(d.robots.presente, true);
  assert.equal(por(d, 'gptbot').situacao, 'liberado');
  assert.equal(por(d, 'gptbot').grupo, 'grupo curinga (User-agent: *)');
  assert.equal(d.llms.presente, false);
  assert.equal(d.sitemap.presente, true);
});

test('nunca emite recomendação: nenhuma chave de recomendação e situação só liberado/bloqueado', () => {
  const chaves = new Set();
  const andar = (o) => { if (Array.isArray(o)) o.forEach(andar); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { chaves.add(k); andar(v); } };
  andar(com.dados);
  for (const k of chaves) assert.doesNotMatch(k, /recomenda|sugest|deveria/i, k);
  for (const r of com.dados.rastreadores) assert.ok(['liberado', 'bloqueado'].includes(r.situacao));
});

test('soft 404 (robots.txt devolve HTML) é tratado como ausente', async () => {
  const http = await import('node:http');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><body>Página inicial</body></html>'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const porta = srv.address().port;
  try {
    const ctx = { site: { origem: `http://127.0.0.1:${porta}` }, rede: { permitidos: [`127.0.0.1:${porta}`], permitirLocal: true }, paginas: [] };
    const r = await medidor.medir(ctx);
    assert.equal(r.dados.robots.presente, false);
    assert.match(r.dados.robots.motivoAusencia, /soft 404/);
    assert.equal(r.dados.llms.presente, false);
    assert.equal(r.dados.sitemap.presente, false);
    assert.equal(por(r.dados, 'gptbot').situacao, 'liberado');
  } finally { srv.closeAllConnections?.(); await new Promise((ok) => srv.close(ok)); }
});
