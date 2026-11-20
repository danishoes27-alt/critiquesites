import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as medidor from '../lib/medidores/links.mjs';

let rapido, completo, legal;
before(async () => {
  const a = await lerFixture('a-links', { manterAberto: true });
  try { rapido = await medidor.medir(a.ctx); } finally { await a.fechar(); }
  const b = await lerFixture('a-links', { modo: 'completo', manterAberto: true });
  try { completo = await medidor.medir(b.ctx); } finally { await b.fechar(); }
  const c = await lerFixture('legal', { manterAberto: true });
  try { legal = await medidor.medir(c.ctx); } finally { await c.fechar(); }
});

const d = () => rapido.dados;
const hrefDe = (r) => r.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');

test('links: contrato e constantes de limite (rápido 40/100 ms, completo 150/200 ms, timeout 8 s)', () => {
  assert.equal(medidor.id, 'links');
  assert.equal(rapido.id, 'links');
  assert.deepEqual(JSON.parse(JSON.stringify(rapido)), rapido);
  assert.deepEqual(medidor.LIMITES, { rapido: { max: 40, intervaloMs: 100, incluiExternos: false }, completo: { max: 150, intervaloMs: 200, incluiExternos: true } });
  assert.equal(medidor.TIMEOUT_MS, 8000);
});

test('links: lista de todos os links visíveis não-clone (cru x final nos totais)', () => {
  assert.equal(d().links.length, 20);
  assert.deepEqual(d().links[0], { pagina: '/', texto: 'R$ 34,90', href: d().links[0].href, interno: true, tipo: 'interno' });
  assert.match(d().links[0].href, /^http:\/\/127\.0\.0\.1:\d+\/comprar\?p=1$/);
  // oculto (display:none) e clones não entram
  assert.equal(d().links.some((l) => /oculto|clone/.test(l.href)), false);
  // o JS acrescenta o link "Novo": só o final vê
  assert.deepEqual(d().totaisPorVersao, { cru: { links: 22, visiveisNaoClone: 19 }, final: { links: 23, visiveisNaoClone: 20 } });
  assert.deepEqual([d().resumo.internos, d().resumo.externos, d().resumo.outros], [17, 2, 1]);
  assert.equal(d().links.filter((l) => l.tipo === 'externo').length, 2);
});

test('links: agrupamento por texto normalizado, com contagem', () => {
  assert.deepEqual(d().grupos.map((g) => [g.textoNormalizado, g.contagem, g.hrefsDistintos]), [
    ['r$ 34,90', 3, 3],
    ['r$ 49,90', 3, 3],
    ['leia mais', 2, 2],
    ['saiba mais', 2, 2],
  ]);
  assert.deepEqual(d().grupos[0].paginas, ['/']);
  assert.equal(d().grupos[0].internos, 3);
  assert.equal(d().totalTextosDistintos, 12);
});

test('links: "texto repetido sem contexto" = mesmo texto sem aria-label/aria-labelledby/title que diferencie', () => {
  const g = d().textoRepetidoSemContexto;
  assert.deepEqual(g.map((x) => [x.pagina, x.textoNormalizado, x.contagem, x.hrefsDistintos, x.mesmoDestino]), [
    ['/', 'leia mais', 2, 2, false],
    ['/', 'r$ 34,90', 3, 3, false],
  ]);
  const precos = g[1];
  assert.deepEqual(precos.diferenciador, { ariaLabel: '', ariaLabelledby: '', title: '' });
  assert.equal(precos.seletores.length, 3);
  assert.equal(precos.contextoDistinto, true); // o li ao redor difere, mas isso NÃO exclui o grupo (leitor de tela lê só o texto)
  assert.deepEqual(precos.contextos, ['Plano Básico R$ 34,90', 'Plano Pro R$ 34,90', 'Plano Max R$ 34,90']);
  assert.equal(g[0].contextoDistinto, false); // os dois "Leia mais" estão no mesmo parágrafo
  // aria-label / aria-labelledby distintos ("R$ 49,90") e title distintos ("Saiba mais") NÃO viram grupo
  assert.equal(g.some((x) => x.textoNormalizado === 'r$ 49,90'), false);
  assert.equal(g.some((x) => x.textoNormalizado === 'saiba mais'), false);
  // ... mas continuam no agrupamento geral por texto
  assert.equal(d().grupos.find((x) => x.textoNormalizado === 'r$ 49,90').contagem, 3);
});

test('links: fixture legal tem 3 links "R$ 34,90" e eles DEVEM aparecer como grupo sem contexto', () => {
  const g = legal.dados.textoRepetidoSemContexto;
  assert.equal(g.length, 1);
  assert.equal(g[0].texto, 'R$ 34,90');
  assert.equal(g[0].contagem, 3);
  assert.equal(g[0].hrefsDistintos, 3);
  assert.equal(legal.dados.grupos[0].contagem, 3);
  const ev = legal.evidencias.find((e) => e.valor.startsWith('texto repetido sem diferenciador'));
  assert.equal(ev.contagem, 3);
  assert.equal(ev.seletor.split(', ').length, 3);
  assert.equal(ev.visivel, true);
});

test('links: vazios (sem texto nem aria-label), com nome vindo de imagem com alt não contam como vazio', () => {
  assert.equal(d().vazios.length, 1);
  assert.match(d().vazios[0].href, /\/vazio\.html$/);
  assert.equal(d().vazios[0].temTitle, false);
  assert.equal(d().semTextoComNomePorDescendente, 1);
});

test('links: genéricos (clique aqui / saiba mais / leia mais), lista em dados', () => {
  assert.deepEqual(d().genericos.map((g) => g.texto), ['Saiba mais', 'Saiba mais', 'Leia mais', 'Leia mais', 'Clique aqui »']);
  assert.ok(d().genericos.every((g) => g.temRotuloAcessivel === false && g.interno === true));
  assert.ok(d().textosGenericosUsados.includes('clique aqui'));
  assert.ok(d().textosGenericosUsados.includes('saiba mais'));
  assert.ok(d().textosGenericosUsados.includes('leia mais'));
  assert.equal(medidor.textoGenerico('Clique aqui »'), 'clique aqui');
  assert.equal(medidor.textoGenerico('  LEIA MAIS... '), 'leia mais');
  assert.equal(medidor.textoGenerico('Saiba mais sobre os planos'), null);
  assert.equal(medidor.textoGenerico(''), null);
});

test('links: href="#" e javascript:, e target=_blank sem rel noopener/noreferrer', () => {
  assert.deepEqual(d().hrefInvalidos.map((h) => [h.texto, h.hrefAttr, h.motivo]), [['Topo', '#', '#'], ['Abrir', 'javascript:void(0)', 'javascript']]);
  assert.equal(d().targetBlankSemRel.length, 1);
  assert.equal(d().targetBlankSemRel[0].texto, 'Externo sem rel');
  assert.equal(d().targetBlankSemRel[0].rel, null);
  assert.equal(d().targetBlankSemRel[0].interno, false);
});

test('links (modo rápido): só internos, HEAD com fallback GET, 404 listado como quebrado', () => {
  const v = d().verificacao;
  assert.deepEqual([v.modo, v.incluiExternos, v.limite, v.intervaloMs, v.timeoutMs], ['rapido', false, 40, 100, 8000]);
  assert.equal(v.candidatos, 16);
  assert.equal(v.verificados, 16);
  assert.equal(v.naoVerificadosPorLimite, 0);
  assert.equal(v.externosNaoVerificados, 2);
  assert.ok(v.resultados.every((r) => r.interno === true));
  assert.equal(v.resultados.filter((r) => r.status === 200 && r.ok && r.metodo === 'HEAD').length, 15);
  assert.deepEqual(v.quebrados.map((q) => [hrefDe(q), q.status, q.metodo, q.interno, q.paginas, q.textos, q.links]), [
    ['/pagina-que-nao-existe', 404, 'GET', true, ['/'], ['Quebrado'], 1],
  ]);
  assert.deepEqual(v.semResposta, []);
  assert.deepEqual(v.resultados.map((r) => r.url), [...v.resultados.map((r) => r.url)].sort()); // ordenado por URL
});

test('links (modo completo): internos + externos; bloqueio de segurança vira status null + motivo, sem exceção', () => {
  const v = completo.dados.verificacao;
  assert.deepEqual([v.modo, v.incluiExternos, v.limite, v.intervaloMs], ['completo', true, 150, 200]);
  assert.equal(v.candidatos, 18);
  assert.equal(v.verificados, 18);
  assert.equal(v.externosNaoVerificados, 0);
  assert.equal(v.quebrados.length, 1);
  assert.equal(v.semResposta.length, 2);
  for (const s of v.semResposta) {
    assert.equal(s.interno, false);
    assert.equal(s.bloqueado, true);
    assert.match(s.motivo, /bloqueado/);
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:1\/[xy]$/);
  }
  const r = v.resultados.find((x) => x.url === 'http://127.0.0.1:1/x');
  assert.equal(r.status, null);
  assert.equal(r.ok, false);
  assert.deepEqual(completo.dados.resumo.verificados, 18);
  assert.equal(completo.dados.resumo.semResposta, 2);
});

test('links: verificarLinks (HEAD, fallback GET, erro sem exceção, cache por URL, intervalo)', async () => {
  const chamadas = [];
  const esperas = [];
  const buscar = async (url, opc) => {
    chamadas.push(`${opc.metodo} ${url}`);
    assert.equal(opc.timeoutMs, 8000);
    assert.deepEqual(opc.permitidos, ['h:1']);
    const caminho = new URL(url).pathname;
    if (caminho === '/ok') return { status: 200, url };
    if (caminho === '/head405') { if (opc.metodo === 'HEAD') return { status: 405, url }; return { status: 200, url }; }
    if (caminho === '/morto') return { status: 404, url };
    if (caminho === '/bloq') { const e = new Error('bloqueado: host interno'); e.bloqueado = true; throw e; }
    if (caminho === '/lento') { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; }
    throw new Error('fetch failed');
  };
  const itens = ['/ok', '/head405', '/morto', '/bloq', '/lento', '/rede', '/ok'].map((c) => ({ url: `http://a.test${c}`, interno: true }));
  const res = await medidor.verificarLinks(itens, { intervaloMs: 123, permitidos: ['h:1'], buscar, esperar: async (ms) => { esperas.push(ms); } });
  assert.deepEqual(res.map((r) => [new URL(r.url).pathname, r.status, r.ok, r.metodo, r.motivo]), [
    ['/ok', 200, true, 'HEAD', null],
    ['/head405', 200, true, 'GET', null],
    ['/morto', 404, false, 'GET', null],
    ['/bloq', null, false, 'HEAD', 'bloqueado: host interno'],
    ['/lento', null, false, 'HEAD', 'tempo esgotado (8 s)'],
    ['/rede', null, false, 'GET', 'fetch failed'],
    ['/ok', 200, true, 'HEAD', null],
  ]);
  assert.equal(res[3].bloqueado, true);
  assert.equal(res[4].bloqueado, false);
  // bloqueio e tempo esgotado não tentam GET; o "/ok" repetido veio do cache (1 só chamada)
  assert.deepEqual(chamadas.map((c) => c.replace('http://a.test', '')), ['HEAD /ok', 'HEAD /head405', 'GET /head405', 'HEAD /morto', 'GET /morto', 'HEAD /bloq', 'HEAD /lento', 'HEAD /rede', 'GET /rede']);
  // espera entre requisições reais (6 URLs distintas => 5 esperas); cache não espera
  assert.deepEqual(esperas, [123, 123, 123, 123, 123]);
});

function ctxSintetico(internos, externos, modo) {
  const mk = (url, interno, i) => ({ seletor: `a:nth-of-type(${i})`, hrefAttr: url, href: url, texto: `l${i}`, ariaLabel: null, ariaLabelledbyTexto: '', title: null, rel: null, target: null, interno, contexto: '', visivel: true, clone: false });
  const links = [];
  for (let i = 0; i < internos; i++) links.push(mk(`http://site.test/p${i}`, true, links.length + 1));
  for (let i = 0; i < externos; i++) links.push(mk(`http://fora.test/e${i}`, false, links.length + 1));
  return { site: { modo, origem: 'http://site.test' }, rede: { permitidos: [], permitirLocal: false }, paginas: [{ url: 'http://site.test/', cru: { extr: { links: [] } }, final: { extr: { links, atributos: [] } } }] };
}

test('links: limites por modo (rápido 40 internos / 100 ms; completo 150 / 200 ms)', async () => {
  for (const [modo, internos, externos, max, intervalo, incluiExternos] of [['rapido', 60, 5, 40, 100, false], ['completo', 100, 100, 150, 200, true]]) {
    const chamadas = [], esperas = [];
    const s = await medidor.medirComOpcoes(ctxSintetico(internos, externos, modo), {
      buscar: async (url, opc) => { chamadas.push({ url, metodo: opc.metodo }); return { status: 200, url }; },
      esperar: async (ms) => { esperas.push(ms); },
    });
    const v = s.dados.verificacao;
    assert.equal(v.modo, modo);
    assert.equal(v.limite, max);
    assert.equal(v.verificados, max);
    assert.equal(chamadas.length, max);
    assert.ok(chamadas.every((c) => c.metodo === 'HEAD'));
    assert.equal(esperas.length, max - 1);
    assert.ok(esperas.every((ms) => ms === intervalo));
    assert.equal(v.incluiExternos, incluiExternos);
    if (modo === 'rapido') {
      assert.ok(chamadas.every((c) => c.url.startsWith('http://site.test/p')));
      assert.equal(v.candidatos, 60);
      assert.equal(v.naoVerificadosPorLimite, 20);
      assert.equal(v.externosNaoVerificados, 5);
    } else {
      assert.equal(v.candidatos, 200);
      assert.equal(v.naoVerificadosPorLimite, 50);
      assert.equal(v.externosNaoVerificados, 0);
      assert.equal(chamadas.filter((c) => c.url.startsWith('http://fora.test/')).length, 50);
    }
  }
});

test('links: resumo e evidências reproduzíveis', () => {
  assert.deepEqual(d().resumo, {
    paginas: 1, linksVisiveisNaoClone: 20, internos: 17, externos: 2, outros: 1,
    gruposTextoRepetido: 4, gruposTextoRepetidoSemContexto: 2, vazios: 1, genericos: 5, hrefInvalidos: 2, targetBlankSemRel: 1,
    verificados: 16, quebrados: 1, semResposta: 0,
  });
  const ev = rapido.evidencias;
  const quebrado = ev.find((e) => /nao-existe -> 404$/.test(String(e.valor)));
  assert.equal(quebrado.pagina, '/');
  assert.equal(quebrado.versao, 'final');
  assert.equal(quebrado.trecho, 'Quebrado');
  assert.equal(quebrado.contagem, 1);
  assert.equal(quebrado.visivel, true);
  const generico = ev.find((e) => e.valor === 'texto genérico');
  assert.equal(generico.contagem, 5);
  assert.equal(generico.trecho, 'Clique aqui » | Leia mais | Saiba mais');
  assert.ok(ev.some((e) => e.valor === 'link vazio' && e.contagem === 1));
  assert.ok(ev.some((e) => e.valor === 'href inválido (#)' && e.contagem === 1));
  assert.ok(ev.some((e) => e.valor === 'href inválido (javascript)' && e.contagem === 1));
  assert.ok(ev.some((e) => e.valor === 'target=_blank sem rel noopener/noreferrer' && e.contagem === 1));
  for (const e of ev) assert.deepEqual(Object.keys(e).sort(), ['contagem', 'pagina', 'seletor', 'trecho', 'valor', 'versao', 'visivel']);
});

test('links: sem páginas, não lança exceção', async () => {
  const s = await medidor.medir({ site: { modo: 'rapido', origem: 'http://x.test' }, paginas: [], rede: { permitidos: [], permitirLocal: false } });
  assert.equal(s.dados.links.length, 0);
  assert.equal(s.dados.verificacao.verificados, 0);
});
