// Testes dos detectores de lib/deteccoes/ia-integridade.mjs (categorias ia-visibilidade e integridade).
// Parte 1: casos sintéticos (um positivo e um negativo por detector, valores exatos).
// Parte 2: integração com fixtures reais (contador, carrossel-clone, oculto, lazy, d-robots-ia e fixtures "g-"):
//          todos os achados gerados passam pelo verificador de citações e TODOS precisam ser APROVADOS.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { carregarRegras, carregarMedidores, executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { detectores } from '../lib/deteccoes/ia-integridade.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { validarAchado, criarAchado, reiniciarIds } from '../lib/achado.mjs';

// ---------- construtores sintéticos ----------
const tagDe = (s) => s.split('>').pop().replace(/:nth-of-type\(\d+\)$/, '').replace(/^#.*/, 'span');
const no = (seletor, texto, o = {}) => ({ seletor, tag: o.tag || tagDe(seletor), texto, visivel: o.visivel ?? true, ocultoPor: o.ocultoPor || '', ariaOculto: !!o.ariaOculto, clone: !!o.clone });
const extr = (o = {}) => ({ url: 'http://site.test/', titulo: 'Titulo do site', nos: [], imagens: [], links: [], headings: [], metas: [], linksHead: [], jsonld: [], microdata: [], rdfa: [], scripts: [], folhas: [], noscript: [], ...o });
const htmlDe = (e) => `<html><head><title>${e.titulo}</title></head><body>${(e.nos || []).map((n) => `<p>${n.texto}</p>`).join('')}${(e.links || []).map((l) => `<a href="${l.hrefAttr}">${l.texto}</a>`).join('')}${(e.scripts || []).map((s) => `<script src="${s.src}"></script>`).join('')}${(e.folhas || []).map((f) => `<link rel="stylesheet" href="${f}">`).join('')}</body></html>`;
const pagina = ({ url = 'http://site.test/', cru, dom250, final, html, hash = 'hash-1', cabecalhos = {}, ...resto } = {}) => ({
  url,
  cru: cru && { status: 200, html: html ?? htmlDe(cru), hash, cabecalhos, extr: cru },
  dom250: dom250 && { html: htmlDe(dom250), extr: dom250 },
  final: final && { html: htmlDe(final), extr: final },
  ...resto,
});
const ctxDe = (paginas, extra = {}) => ({ site: { urlInicial: 'http://site.test/', origem: 'http://site.test', host: 'site.test', modo: 'rapido' }, paginas, ativos: [], ...extra });
const rodar = (id, ctx, med = {}, regra = {}) => detectores[id]({ ctx, med, regra });
const imgs = (n, lazy) => Array.from({ length: n }, (_, i) => ({ seletor: `img:nth-of-type(${i + 1})`, alt: `i${i}`, loading: i < lazy ? 'lazy' : null, visivel: true, clone: false, renderW: 40, renderH: 40 }));
const regraDoJson = (arquivo, id) => JSON.parse(readFileSync(new URL(`../regras/${arquivo}.json`, import.meta.url), 'utf8')).find((r) => r.id === id);

// ================================================================== cobertura
test('cada regra de script/misto de ia-visibilidade e integridade tem detector (21 regras)', () => {
  const regras = carregarRegras({ modo: 'completo' }).filter((r) => ['ia-visibilidade', 'integridade'].includes(r.categoria) && r.deteccao.tipo !== 'julgamento');
  assert.equal(regras.length, 21);
  assert.equal(regras.filter((r) => r.categoria === 'ia-visibilidade').length, 8);
  assert.equal(regras.filter((r) => r.categoria === 'integridade').length, 13);
  for (const r of regras) assert.equal(typeof detectores[r.id], 'function', r.id);
});

// ================================================================== ia-visibilidade
const robotsIa = (extra = {}) => ({ 'robots-ia': { id: 'robots-ia', dados: { robots: { presente: true, agentesDeclarados: ['*'] }, rastreadores: [], llms: { presente: false }, ...extra }, evidencias: [] } });
const rast = (userAgent, categoria, o = {}) => ({ id: userAgent.toLowerCase(), nome: userAgent, userAgent, categoria, situacao: 'liberado', parcial: false, grupo: 'sem regra: liberado por omissão', restricoes: { disallow: [], allow: [] }, ...o });

test('ia-llms-txt-informativo: arquivo presente informa (sem recomendar); ausente não dispara; sem medidor = null', () => {
  const ctx = ctxDe([]);
  const com = rodar('ia-llms-txt-informativo', ctx, robotsIa({ llms: { presente: true, linhas: 5, bytes: 142, tituloMarkdown: 'Casa de Teste' } }));
  assert.equal(com.disparou, true);
  assert.equal(com.achados.length, 1);
  assert.match(com.achados[0].mensagem, /llms\.txt/);
  assert.match(com.achados[0].mensagem, /não dá nota e não pede mudança/);
  assert.equal(com.achados[0].evidencias[0].contagem, 5);
  assert.equal(com.achados[0].evidencias[0].valor, '142 bytes');
  assert.deepEqual(com.achados[0].citacoes, []);
  assert.equal(rodar('ia-llms-txt-informativo', ctx, robotsIa({ llms: { presente: false } })).disparou, false);
  assert.equal(rodar('ia-llms-txt-informativo', ctx, {}), null);
  assert.equal(rodar('ia-llms-txt-informativo', ctx, { 'robots-ia': { dados: null, erro: 'falhou' } }), null);
});

test('ia-rastreadores-robots-informativo: estados por rastreador, treino x busca x consulta, sem recomendação', () => {
  const ctx = ctxDe([]);
  const med = robotsIa({
    rastreadores: [
      rast('GPTBot', 'treino', { situacao: 'bloqueado', grupo: 'grupo específico (User-agent: gptbot)', origemDoGrupo: 'especifico' }),
      rast('OAI-SearchBot', 'busca', { grupo: 'grupo específico (User-agent: oai-searchbot)', origemDoGrupo: 'especifico', restricoes: { disallow: [], allow: ['/'] } }),
      rast('PerplexityBot', 'busca', { parcial: true, origemDoGrupo: 'especifico', restricoes: { disallow: ['/privado/'], allow: [] } }),
      rast('Google-Extended', 'treino', { situacao: 'bloqueado', parcial: true, origemDoGrupo: 'especifico', restricoes: { disallow: ['/'], allow: ['/publico/'] } }),
      rast('Claude-User', 'consulta-por-usuario'),
    ],
  });
  const r = rodar('ia-rastreadores-robots-informativo', ctx, med);
  assert.equal(r.disparou, true);
  const m = r.achados[0].mensagem;
  assert.match(m, /GPTBot \(OpenAI\) barrado por completo/);
  assert.match(m, /OAI-SearchBot \(OpenAI\) permitido de forma explícita/);
  assert.match(m, /PerplexityBot \(Perplexity\) barrado em partes \(Disallow: \/privado\/\)/);
  assert.match(m, /Google-Extended \(Google\) barrado na raiz, com exceções liberadas \(Allow: \/publico\/\)/);
  assert.match(m, /Claude-User \(Anthropic\) sem regra própria \(permitido por padrão\)/);
  assert.match(m, /Treino \(conteúdo usado para treinar modelos de IA\)/);
  assert.match(m, /Busca \(ajuda a achar páginas/);
  assert.match(m, /Consulta pedida por uma pessoa/);
  assert.doesNotMatch(m, /recomend|bloqueie|libere|permita|deveria/i);
  assert.equal(r.achados[0].evidencias.length, 5);
  assert.deepEqual(r.achados[0].citacoes, []);
  // sem robots.txt: nada a informar; sem medidor: não avaliável
  assert.equal(rodar('ia-rastreadores-robots-informativo', ctx, robotsIa({ robots: { presente: false }, rastreadores: [rast('GPTBot', 'treino')] })).disparou, false);
  assert.equal(rodar('ia-rastreadores-robots-informativo', ctx, {}), null);
});

test('ia-conteudo-no-html-cru: 1 palavra no cru contra 33 no final dispara; texto igual nas duas versões, não; noscript conta como cru', () => {
  const p10 = 'um dois tres quatro cinco seis sete oito nove dez';
  const finalNos = [no('body>main>h1', 'Bem-vindo'), no('body>main>h2', 'Nossa história'), no('body>main>p:nth-of-type(1)', p10), no('body>main>p:nth-of-type(2)', p10), no('body>main>p:nth-of-type(3)', p10)];
  const cru = extr({ nos: [no('body>main>h1', 'Bem-vindo')] });
  const fin = extr({ nos: finalNos });
  const ctx = ctxDe([pagina({ cru, final: fin })]);
  const r = rodar('ia-conteudo-no-html-cru', ctx);
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.equal(a.evidencias.find((e) => e.versao === 'cru' && e.valor === 'palavras no HTML cru').contagem, 1);
  assert.equal(a.evidencias.find((e) => e.versao === 'final' && e.valor === 'palavras na página final').contagem, 33);
  assert.equal(a.evidencias.find((e) => String(e.valor).startsWith('razão')).valor, 'razão 0,03');
  assert.equal(a.evidencias.find((e) => e.valor === 'títulos e parágrafos só no final').contagem, 4);
  assert.match(a.mensagem, /1 no HTML cru e 33 na página final/);
  assert.ok(a.citacoes.every((c) => c.tipo === 'contagem' && c.contagem.fn === 'ocorrencias-visiveis'));
  assert.ok(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length === 1);

  assert.equal(rodar('ia-conteudo-no-html-cru', ctxDe([pagina({ cru: extr({ nos: finalNos }), final: fin })])).disparou, false);
  const comNoscript = extr({ nos: [no('body>main>h1', 'Bem-vindo')], noscript: [`${p10} ${p10}`] });
  assert.equal(rodar('ia-conteudo-no-html-cru', ctxDe([pagina({ cru: comNoscript, final: fin })])).disparou, false);
  assert.equal(rodar('ia-conteudo-no-html-cru', ctxDe([])), null);
});

test('ia-links-internos-so-com-javascript: 0 links no cru e 6 no final dispara; mínimo de 5 e razão de 50% respeitados', () => {
  const link = (h, texto, o = {}) => ({ hrefAttr: h, href: h, texto, visivel: true, clone: false, interno: false, seletor: `a[href="${h}"]`, ...o });
  const seis = ['/', '/a.html', '/b.html', '/c.html', '/d.html', '/e.html'].map((h, i) => link(h, `L${i}`));
  const finalExtr = extr({ links: seis });
  const r = rodar('ia-links-internos-so-com-javascript', ctxDe([pagina({ cru: extr(), final: finalExtr })]));
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.equal(a.evidencias[0].contagem, 0);
  assert.equal(a.evidencias[1].contagem, 6);
  assert.match(a.mensagem, /0 no HTML cru e 6 na página final/);
  assert.deepEqual(a.citacoes.slice(0, 2).map((c) => [c.contagem.fn, c.contagem.esperado, c.versoes[0]]), [['links', 0, 'cru'], ['links', 6, 'final']]);
  // no cru o extrator lê sem base (interno=false, href cru): o detector resolve pelo endereço da página
  const crua = extr({ links: seis });
  assert.equal(rodar('ia-links-internos-so-com-javascript', ctxDe([pagina({ cru: crua, final: finalExtr })])).disparou, false);
  assert.equal(rodar('ia-links-internos-so-com-javascript', ctxDe([pagina({ cru: extr(), final: extr({ links: seis.slice(0, 4) }) })])).disparou, false);
  // externos e âncoras não contam
  const externos = extr({ links: ['https://outro.com/1', 'https://outro.com/2', 'https://outro.com/3', 'https://outro.com/4', 'https://outro.com/5', '#topo'].map((h) => link(h, 'x')) });
  assert.equal(rodar('ia-links-internos-so-com-javascript', ctxDe([pagina({ cru: extr(), final: externos })])).disparou, false);
});

test('ia-recursos-bloqueados-no-robots-txt: scripts/CSS do mesmo domínio barrados para o Googlebot', () => {
  const med = (disallow, extra = {}) => ({ 'robots-ia': { dados: { robots: { presente: true, agentesDeclarados: ['*'] }, rastreadores: [rast('GPTBot', 'treino', { grupo: 'grupo curinga (User-agent: *)', origemDoGrupo: 'curinga', restricoes: { disallow, allow: [] } })], ...extra } } });
  const fin = extr({ scripts: [{ src: '/assets/app.js' }, { src: '/livre.js' }, { src: 'https://cdn.outro.com/x.js' }, { src: null, inline: 'x' }], folhas: ['/assets/a.css', '/livre.css'] });
  const ctx = ctxDe([pagina({ cru: extr(), final: fin })]);
  const r = rodar('ia-recursos-bloqueados-no-robots-txt', ctx, med(['/assets/']));
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.match(a.mensagem, /2 arquivos que montam a página/);
  assert.match(a.mensagem, /\/assets\/app\.js e \/assets\/a\.css|\/assets\/a\.css e \/assets\/app\.js/);
  assert.doesNotMatch(a.mensagem, /livre|cdn/);
  assert.deepEqual(a.citacoes.map((c) => c.valor).sort(), ['/assets/a.css', '/assets/app.js']);
  assert.equal(a.evidencias[0].contagem, 2);
  assert.equal(a.evidencias[1].trecho, 'Disallow: /assets/');
  assert.equal(rodar('ia-recursos-bloqueados-no-robots-txt', ctx, med([])).disparou, false);
  assert.equal(rodar('ia-recursos-bloqueados-no-robots-txt', ctx, { 'robots-ia': { dados: { robots: { presente: false }, rastreadores: [] } } }).disparou, false);
  // grupo próprio do Googlebot não foi medido: não avaliável (nunca "ok")
  assert.equal(rodar('ia-recursos-bloqueados-no-robots-txt', ctx, med(['/assets/'], { robots: { presente: true, agentesDeclarados: ['*', 'googlebot'] } })), null);
  assert.equal(rodar('ia-recursos-bloqueados-no-robots-txt', ctx, {}), null);
});

test('ia-informacao-chave-so-em-imagem-ou-video (misto): lista candidatas; texto por perto ou alt descritivo as tira', () => {
  const img = (o = {}) => ({ seletor: 'body>main>section>img', alt: null, renderW: 640, renderH: 320, visivel: true, clone: false, src: 'http://x/y.png', ...o });
  const positivo = rodar('ia-informacao-chave-so-em-imagem-ou-video', ctxDe([pagina({ final: extr({ imagens: [img()] }) })]));
  assert.equal(positivo.disparou, true);
  const a = positivo.achados[0];
  assert.match(a.mensagem, /^Para conferir: 1 imagem grande tem quase nenhum texto/);
  assert.match(a.mensagem, /O script não lê texto dentro de imagens/);
  assert.equal(a.evidencias[0].contagem, 1);
  assert.equal(a.evidencias[1].valor, '640x320');
  assert.equal(a.citacoes[0].contagem.fn, 'imagens');
  const comTexto = extr({ imagens: [img()], nos: [no('body>main>section>p', 'Promoção válida somente até domingo para todas as peças')] });
  assert.equal(rodar('ia-informacao-chave-so-em-imagem-ou-video', ctxDe([pagina({ final: comTexto })])).disparou, false);
  assert.equal(rodar('ia-informacao-chave-so-em-imagem-ou-video', ctxDe([pagina({ final: extr({ imagens: [img({ alt: 'Tabela de preços dos planos mensais' })] }) })])).disparou, false);
  assert.equal(rodar('ia-informacao-chave-so-em-imagem-ou-video', ctxDe([pagina({ final: extr({ imagens: [img({ renderW: 40, renderH: 40 })] }) })])).disparou, false);
  assert.equal(rodar('ia-informacao-chave-so-em-imagem-ou-video', ctxDe([])), null);
});

test('ia-limite-de-trechos-informativo: nosnippet, max-snippet, data-nosnippet e X-Robots-Tag', () => {
  const metas = [{ nome: 'robots', conteudo: 'index, nosnippet' }, { nome: 'googlebot', conteudo: 'max-snippet:0' }];
  const cru = extr({ metas });
  const p = pagina({ cru, final: extr({ metas }), html: '<html><head><title>T</title><meta name="robots" content="index, nosnippet"></head><body><p data-nosnippet>oculto</p><script>var data-nosnippet=1</script></body></html>', cabecalhos: { 'x-robots-tag': 'googlebot: max-snippet:20' } });
  const r = rodar('ia-limite-de-trechos-informativo', ctxDe([p]));
  assert.equal(r.disparou, true);
  const m = r.achados[0].mensagem;
  assert.match(m, /nosnippet no meta robots \(no HTML cru e na página final\)/);
  assert.match(m, /max-snippet:0 \(zero: nenhum trecho\) no meta googlebot \(no HTML cru e na página final\)/);
  assert.match(m, /data-nosnippet em trechos do texto \(no HTML cru\)/);
  assert.match(m, /max-snippet:20 no cabeçalho X-Robots-Tag/);
  assert.match(m, /a decisão é sua/);
  // cabeçalho é arquivo externo: só evidência; as citações apontam para o HTML
  assert.ok(r.achados[0].citacoes.every((c) => c.onde === 'html'));
  assert.ok(r.achados[0].evidencias.some((e) => e.seletor === 'X-Robots-Tag' && e.valor === 'max-snippet:20'));
  const sem = pagina({ cru: extr({ metas: [{ nome: 'robots', conteudo: 'index, follow, max-snippet:-1' }] }), html: '<html><body><p>ok</p></body></html>' });
  assert.equal(rodar('ia-limite-de-trechos-informativo', ctxDe([sem])).disparou, true); // max-snippet:-1 (sem limite) também é um controle declarado
  const limpa = pagina({ cru: extr({ metas: [{ nome: 'robots', conteudo: 'index, follow' }] }), html: '<html><body><p>ok</p></body></html>' });
  assert.equal(rodar('ia-limite-de-trechos-informativo', ctxDe([limpa])).disparou, false);
});

test('ia-estrutura-semantica-fraca: só div e span no HTML cru dispara; main/h1 ou role=main não', () => {
  const sem = pagina({ cru: extr(), html: '<html><head><title>T</title><style>.a{}</style></head><body><div><div><span>a</span></div><div><span>b</span></div></div><!-- <h1>comentado</h1> --></body></html>' });
  const r = rodar('ia-estrutura-semantica-fraca', ctxDe([sem]));
  assert.equal(r.disparou, true);
  assert.match(r.achados[0].mensagem, /nenhum título \(h1 a h3\) e nenhuma região principal \(main ou article\), contra 3 div e 2 span/);
  assert.equal(r.achados[0].evidencias.find((e) => e.seletor === 'div').contagem, 3);
  assert.equal(r.achados[0].evidencias.find((e) => e.seletor === 'span').contagem, 2);
  assert.equal(rodar('ia-estrutura-semantica-fraca', ctxDe([pagina({ cru: extr(), html: '<html><body><main><h1>x</h1></main></body></html>' })])).disparou, false);
  assert.equal(rodar('ia-estrutura-semantica-fraca', ctxDe([pagina({ cru: extr(), html: '<html><body><div role="main">x</div></body></html>' })])).disparou, false);
  assert.equal(rodar('ia-estrutura-semantica-fraca', ctxDe([pagina({ cru: extr(), html: '<html><body><h2>x</h2></body></html>' })])).disparou, false);
  assert.equal(rodar('ia-estrutura-semantica-fraca', ctxDe([])), null);
});

// ================================================================== integridade (sintético)
const contadorCtx = (cru, d250, fin, extraNos = []) => ctxDe([pagina({
  cru: extr({ nos: [no('#sites', cru), ...extraNos] }), dom250: extr({ nos: [no('#sites', d250), ...extraNos] }), final: extr({ nos: [no('#sites', fin), ...extraNos] }),
})]);

test('int2-valor-muda-entre-versoes: traz as 3 leituras; preço que cai é valor que muda; "há N min" e valores iguais não', () => {
  const r = rodar('int2-valor-muda-entre-versoes', contadorCtx('R$ 19,90', 'R$ 19,90', 'R$ 9,90'));
  assert.equal(r.disparou, true);
  assert.equal(r.achados.length, 1);
  const a = r.achados[0];
  assert.deepEqual(a.evidencias.map((e) => [e.versao, e.trecho, e.valor]), [['cru', 'R$ 19,90', 19.9], ['dom250', 'R$ 19,90', 19.9], ['final', 'R$ 9,90', 9.9]]);
  assert.match(a.mensagem, /no HTML cru "R\$ 19,90"; aos 250 ms "R\$ 19,90"; na página final "R\$ 9,90"/);
  assert.equal(a.peso_aplicado, undefined); // não é contador: conta normal
  assert.equal(a.instavel, false);
  const ctx = contadorCtx('R$ 19,90', 'R$ 19,90', 'R$ 9,90');
  assert.equal(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-valor-muda-entre-versoes', contadorCtx('9,90', '9.90', 'R$ 9,90')).disparou, false); // 9,90 = 9.90
  assert.equal(rodar('int2-valor-muda-entre-versoes', contadorCtx('há 3 min', 'há 4 min', 'há 5 min')).disparou, false);
  assert.equal(rodar('int2-valor-muda-entre-versoes', contadorCtx('atualizado 10:15', 'atualizado 10:16', 'atualizado 10:17')).disparou, false);
  assert.equal(rodar('int2-valor-muda-entre-versoes', ctxDe([])), null);
});

test('int2-valor-muda-entre-versoes: contador animado sai com peso_aplicado 0 (a nota é de int2-contador); segunda leitura diferente marca instavel', () => {
  const p = pagina({ cru: extr({ nos: [no('#sites', '0')] }), dom250: extr({ nos: [no('#sites', '10')] }), final: extr({ nos: [no('#sites', '54')] }), leitura2: { cru: { hash: 'h1' }, final: { extr: extr({ nos: [no('#sites', '55')] }) } } });
  const r = rodar('int2-valor-muda-entre-versoes', ctxDe([p]));
  assert.equal(r.achados[0].peso_aplicado, 0);
  assert.equal(r.achados[0].instavel, true);
  assert.match(r.achados[0].mensagem, /Este caso também aparece como contador animado/);
});

test('int2-contador-animado-valor-errado: 0 -> 0 -> 54 dispara com as 3 leituras; decrescente, oculto e clone não', () => {
  const ctx = contadorCtx('0', '0', '54');
  const r = rodar('int2-contador-animado-valor-errado', ctx);
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.match(a.mensagem, /^O contador #sites começa em 0 e só chega a 54 depois da animação/);
  assert.deepEqual(a.evidencias.map((e) => [e.versao, e.trecho]), [['cru', '0'], ['dom250', '0'], ['final', '54']]);
  assert.ok(a.citacoes.some((c) => c.tipo === 'numero' && c.valor === 54 && c.versoes[0] === 'final'));
  assert.ok(a.citacoes.some((c) => c.tipo === 'trecho' && c.valor === '0' && c.versoes[0] === 'cru'));
  assert.equal(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-contador-animado-valor-errado', contadorCtx('54', '54', '54')).disparou, false);
  assert.equal(rodar('int2-contador-animado-valor-errado', contadorCtx('54', '30', '10')).disparou, false);
  // clone e oculto são ignorados
  const clone = pagina({ cru: extr({ nos: [no('#c', '0', { clone: true })] }), final: extr({ nos: [no('#c', '54', { clone: true })] }) });
  assert.equal(rodar('int2-contador-animado-valor-errado', ctxDe([clone])).disparou, false);
  const oculto = pagina({ cru: extr({ nos: [no('#o', '0', { visivel: false })] }), final: extr({ nos: [no('#o', '54', { visivel: false })] }) });
  assert.equal(rodar('int2-contador-animado-valor-errado', ctxDe([oculto])).disparou, false);
});

test('int2-clone-carrossel-ignorado: informa a contagem de clones; sem clones não dispara', () => {
  const nos = [no('a>p', 'Depoimento', { clone: true }), no('b>p', 'Outro depoimento', { clone: true }), no('c>p', 'Real')];
  const ctx = ctxDe([pagina({ cru: extr({ nos }), final: extr({ nos }) })]);
  const r = rodar('int2-clone-carrossel-ignorado', ctx);
  assert.equal(r.disparou, true);
  assert.match(r.achados[0].mensagem, /^Blocos de texto de carrossel ignorados: 2 /);
  assert.doesNotMatch(r.achados[0].mensagem, /depoimentos duplicados/i);
  assert.deepEqual(r.achados[0].citacoes, [{ tipo: 'contagem', contagem: { fn: 'nos-clone', esperado: 2 }, versoes: ['cru', 'final'], pagina: 'http://site.test/' }]);
  assert.equal(verificarAchados([{ ...r.achados[0], id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-clone-carrossel-ignorado', ctxDe([pagina({ final: extr({ nos: [no('c>p', 'Real')] }) })])).disparou, false);
});

test('int2-texto-oculto-nao-e-visivel: conta ocultos sem afirmar o conteúdo; sem ocultos não dispara', () => {
  const nos = [no('body>main>p', 'R$ 9,90'), no('body>main>span', '0% OFF', { visivel: false, ocultoPor: 'display:none' }), no('body>main>div', 'Oferta encerrada: de R$ 89', { visivel: false, ocultoPor: 'display:none' })];
  const ctx = ctxDe([pagina({ final: extr({ nos }) })]);
  const r = rodar('int2-texto-oculto-nao-e-visivel', ctx);
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.match(a.mensagem, /^Trechos de texto ocultos .*: 2\./);
  assert.doesNotMatch(a.mensagem, /R\$ 89|OFF/);
  assert.equal(a.evidencias.find((e) => e.valor === 'display:none' && e.contagem === 2).visivel, false);
  assert.equal(a.citacoes[0].contagem.esperado, 2);
  assert.equal(a.citacoes[1].onde, 'html');
  assert.equal(rodar('int2-texto-oculto-nao-e-visivel', ctxDe([pagina({ final: extr({ nos: [no('p', 'visível')] }) })])).disparou, false);
});

test('int2-oculto-diverge-do-visivel: "inconsistência a conferir" só com divergência no mesmo contêiner; "0% OFF" sem visível par não vira achado', () => {
  const visivel = no('body>main>p', 'R$ 9,90');
  const nos = [visivel, no('body>main>div', 'Oferta encerrada: de R$ 89', { visivel: false, ocultoPor: 'display:none' }), no('body>main>span', '0% OFF', { visivel: false, ocultoPor: 'display:none' })];
  const ctx = ctxDe([pagina({ final: extr({ nos }) })]);
  const r = rodar('int2-oculto-diverge-do-visivel', ctx);
  assert.equal(r.disparou, true);
  assert.equal(r.achados.length, 1);
  const a = r.achados[0];
  assert.match(a.mensagem, /^Inconsistência a conferir: o valor visível "R\$ 9,90"/);
  assert.match(a.mensagem, /Não estamos afirmando que algum dos valores esteja errado/);
  assert.doesNotMatch(a.mensagem, /OFF/);
  assert.ok(a.citacoes.some((c) => c.tipo === 'trecho' && c.valor === 'Oferta encerrada: de R$ 89' && c.onde === 'html'));
  assert.ok(a.citacoes.some((c) => c.tipo === 'trecho' && c.valor === 'R$ 9,90' && c.onde === 'visivel'));
  assert.ok(a.citacoes.some((c) => c.tipo === 'numero' && c.valor === 89 && c.onde === 'html'));
  assert.equal(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  // oculto que só repete o visível (texto para leitor de tela): nada a conferir
  const igual = [visivel, no('body>main>span', 'Preço: R$ 9,90', { visivel: false, ocultoPor: 'somente-leitor-de-tela' })];
  assert.equal(rodar('int2-oculto-diverge-do-visivel', ctxDe([pagina({ final: extr({ nos: igual }) })])).disparou, false);
  // contêiner diferente: não há par
  const longe = [visivel, no('body>footer>div>span', 'R$ 89', { visivel: false, ocultoPor: 'display:none' })];
  assert.equal(rodar('int2-oculto-diverge-do-visivel', ctxDe([pagina({ final: extr({ nos: longe }) })])).disparou, false);
});

test('int2-contagem-recalculada: caso do gabarito (cru 31 img e 30 lazy x final 57 img e 45 lazy)', () => {
  const ctx = ctxDe([pagina({ cru: extr({ imagens: imgs(31, 30) }), final: extr({ imagens: imgs(57, 45) }) })]);
  const r = rodar('int2-contagem-recalculada', ctx);
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.match(a.mensagem, /imagens: 31 no HTML cru e 57 na página final; imagens com carregamento lazy: 30 no HTML cru e 45 na página final/);
  assert.doesNotMatch(a.mensagem, /links|JSON-LD/); // só o que diverge
  assert.deepEqual(a.citacoes.map((c) => [c.contagem.fn, c.contagem.esperado, c.versoes[0]]), [['imagens', 31, 'cru'], ['imagens', 57, 'final'], ['imagens-lazy', 30, 'cru'], ['imagens-lazy', 45, 'final']]);
  assert.equal(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-contagem-recalculada', ctxDe([pagina({ cru: extr({ imagens: imgs(5, 2) }), final: extr({ imagens: imgs(5, 2) }) })])).disparou, false);
  assert.equal(rodar('int2-contagem-recalculada', ctxDe([])), null);
});

test('int2-contagem-recalculada: nunca diz "sem dados estruturados"; JSON-LD só no final é mostrado lado a lado', () => {
  const cru = extr({ microdata: ['https://schema.org/Organization'] });
  const fin = extr({ microdata: ['https://schema.org/Organization'], jsonld: ['{"@type":"Organization"}'] });
  const r = rodar('int2-contagem-recalculada', ctxDe([pagina({ cru, final: fin })]));
  assert.equal(r.disparou, true);
  const m = r.achados[0].mensagem;
  assert.match(m, /blocos de JSON-LD \(um tipo de dado estruturado\): 0 no HTML cru e 1 na página final/);
  assert.doesNotMatch(m, /sem dados estruturados|não há dados estruturados|nenhum dado estruturado/i);
  assert.equal(r.achados[0].evidencias.find((e) => e.seletor === '[itemtype], [typeof]' && e.versao === 'cru').contagem, 1);
});

test('int2-preco-divergente-entre-paginas: mesmo item, preços visíveis diferentes; riscado, parcelado e conjuntos que se contêm não', () => {
  const pg = (url, ...precos) => pagina({ url, final: extr({ url, nos: [no('body>main>h2', 'Plano Guia'), ...precos.map((t, i) => no(`body>main>p:nth-of-type(${i + 1})`, t))] }) });
  const ctx = ctxDe([pg('http://site.test/', 'R$ 59'), pg('http://site.test/plano', 'R$ 97')]);
  const r = rodar('int2-preco-divergente-entre-paginas', ctx);
  assert.equal(r.disparou, true);
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].mensagem, 'O item "Plano Guia" aparece com preços diferentes entre páginas: "R$ 59" em / e "R$ 97" em /plano. Pode ser plano diferente ou erro de edição; vale conferir.');
  assert.equal(verificarAchados([{ ...r.achados[0], id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-preco-divergente-entre-paginas', ctxDe([pg('http://site.test/', 'R$ 59'), pg('http://site.test/plano', 'R$ 59')])).disparou, false);
  assert.equal(rodar('int2-preco-divergente-entre-paginas', ctxDe([pg('http://site.test/', 'de R$ 89 por R$ 59'), pg('http://site.test/plano', 'R$ 97')])).disparou, false); // riscado
  assert.equal(rodar('int2-preco-divergente-entre-paginas', ctxDe([pg('http://site.test/', '12x de R$ 9,90'), pg('http://site.test/plano', 'R$ 97')])).disparou, false); // parcelamento
  assert.equal(rodar('int2-preco-divergente-entre-paginas', ctxDe([pg('http://site.test/', 'R$ 59'), pg('http://site.test/plano', 'R$ 59', 'R$ 97')])).disparou, false); // um contém o outro
  assert.equal(rodar('int2-preco-divergente-entre-paginas', ctxDe([pg('http://site.test/', 'R$ 59')])).disparou, false);
});

test('int2-fato-sem-evidencia-descartado: só informa quando o resultado do verificador é injetado; senão não avaliável', () => {
  const p = pagina({ cru: extr(), final: extr() });
  assert.equal(rodar('int2-fato-sem-evidencia-descartado', ctxDe([p])), null);
  assert.equal(rodar('int2-fato-sem-evidencia-descartado', ctxDe([p], { verificacao: { descartados: [] } })).disparou, false);
  const r = rodar('int2-fato-sem-evidencia-descartado', ctxDe([p], { verificacao: { descartados: [{ regra_id: 'x', motivo: 'trecho não encontrado' }, { regra_id: 'y', motivo: 'selo "fato" sem nenhuma citação verificável' }] } }));
  assert.equal(r.disparou, true);
  assert.match(r.achados[0].mensagem, /^Achados descartados por falta de evidência verificável: 2 /);
  assert.equal(r.achados[0].evidencias[0].contagem, 2);
  assert.equal(r.achados[0].citacoes.length, 1);
});

test('int2-link-interno-quebrado: só internos com 404/410/5xx; 403, externos e sem medidor', () => {
  const l = { href: 'http://site.test/x.html', hrefAttr: '/x.html', texto: 'Página X', visivel: true, clone: false, seletor: 'a', interno: true };
  const ctx = ctxDe([pagina({ cru: extr(), final: extr({ links: [l] }) })]);
  const med = (quebrados, semResposta = []) => ({ links: { dados: { verificacao: { quebrados, semResposta, verificados: 3 } } } });
  const q = (status, extra = {}) => ({ url: 'http://site.test/x.html', status, interno: true, paginas: ['/'], textos: ['Página X'], links: 1, ...extra });
  const r = rodar('int2-link-interno-quebrado', ctx, med([q(404)]));
  assert.equal(r.disparou, true);
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].mensagem, 'O link interno "Página X" leva a /x.html, que responde com o erro 404. O visitante cai em uma página que não existe ou que falha.');
  assert.deepEqual(r.achados[0].citacoes.map((c) => c.tipo), ['trecho', 'contagem']);
  assert.equal(verificarAchados([{ ...r.achados[0], id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, med([q(500)])).disparou, true);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, med([q(403)])).disparou, false);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, med([q(404, { interno: false })])).disparou, false);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, med([], [q(null, { motivo: 'excesso de redirecionamentos' })])).disparou, true);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, med([])).disparou, false);
  assert.equal(rodar('int2-link-interno-quebrado', ctx, {}), null);
});

test('int2-canonical-divergente: aponta para outra, relativo, fragmento e cru x final; canonical igual à página ou página filtrada, não', () => {
  const can = (href) => extr({ linksHead: [{ rel: 'canonical', href }] });
  const p = pagina({ cru: can('/outra#topo'), final: can('/outra-final') });
  const r = rodar('int2-canonical-divergente', ctxDe([p]));
  assert.equal(r.disparou, true);
  const m = r.achados[0].mensagem;
  assert.match(m, /canonical em formato relativo/);
  assert.match(m, /canonical com fragmento \(#\) \(\/outra#topo\)/);
  assert.match(m, /canonical aponta para outra página/);
  assert.match(m, /canonical diferente entre o HTML cru e a página final \(\/outra#topo -> \/outra-final\)/);
  assert.ok(r.achados[0].citacoes.every((c) => c.tipo === 'trecho' && c.onde === 'html'));
  const igual = can('http://site.test/');
  assert.equal(rodar('int2-canonical-divergente', ctxDe([pagina({ cru: igual, final: igual })])).disparou, false);
  assert.equal(rodar('int2-canonical-divergente', ctxDe([pagina({ cru: extr(), final: extr() })])).disparou, false); // sem canonical: outra regra (SEO) cuida
  const filtrada = can('http://site.test/lista');
  assert.equal(rodar('int2-canonical-divergente', ctxDe([pagina({ url: 'http://site.test/lista?page=2', cru: filtrada, final: filtrada })])).disparou, false);
  const dois = extr({ linksHead: [{ rel: 'canonical', href: 'http://site.test/' }, { rel: 'canonical', href: 'http://site.test/b' }] });
  assert.match(rodar('int2-canonical-divergente', ctxDe([pagina({ cru: dois, final: dois })])).achados[0].mensagem, /mais de um canonical com valores diferentes/);
});

test('int2-conteudo-depende-de-js: razão abaixo de 0,3 com mais de 500 caracteres dispara; formulários e textos curtos não contam', () => {
  const texto = 'x'.repeat(120);
  const finalNos = [no('body>main>p:nth-of-type(1)', `a ${texto}`), no('body>main>p:nth-of-type(2)', `b ${texto}`), no('body>main>p:nth-of-type(3)', `c ${texto}`), no('body>main>p:nth-of-type(4)', `d ${texto}`), no('body>main>p:nth-of-type(5)', `e ${texto}`)]; // 5 x 122 = 610
  const cru = extr({ nos: [no('body>main>p:nth-of-type(1)', `a ${texto}`)] }); // 122
  const ctx = ctxDe([pagina({ cru, final: extr({ nos: finalNos }) })]);
  const r = rodar('int2-conteudo-depende-de-js', ctx);
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.equal(a.evidencias[0].contagem, 122);
  assert.equal(a.evidencias[1].contagem, 610);
  assert.equal(a.evidencias[2].valor, 'razão 0,2');
  assert.match(a.mensagem, /122 no HTML cru e 610 na página final \(razão 0,2\)/);
  assert.equal(verificarAchados([{ ...a, id: 'x', regra_id: 'r', selo: 'fato' }], ctx).aprovados.length, 1);
  const metade = extr({ nos: finalNos.slice(0, 3) }); // 366 de 610 = 0,6
  assert.equal(rodar('int2-conteudo-depende-de-js', ctxDe([pagina({ cru: metade, final: extr({ nos: finalNos }) })])).disparou, false);
  assert.equal(rodar('int2-conteudo-depende-de-js', ctxDe([pagina({ cru: extr(), final: extr({ nos: finalNos.slice(0, 3) }) })])).disparou, false); // final com só 366 caracteres
  const form = finalNos.map((n) => ({ ...n, seletor: n.seletor.replace('main>', 'main>form>') }));
  assert.equal(rodar('int2-conteudo-depende-de-js', ctxDe([pagina({ cru: extr(), final: extr({ nos: form }) })])).disparou, false); // área de formulário ignorada
});

test('int2-hash-versao-estavel: hash diferente em duas leituras marca instável; igual não; sem segunda leitura = null', () => {
  const base = { cru: extr(), final: extr() };
  const igual = pagina({ ...base, hash: 'aaa', leitura2: { cru: { hash: 'aaa' } } });
  assert.equal(rodar('int2-hash-versao-estavel', ctxDe([igual])).disparou, false);
  assert.equal(rodar('int2-hash-versao-estavel', ctxDe([pagina(base)])), null);
  const dif = pagina({ ...base, hash: 'aaa', html: '<html><body><p>fixo</p><p>token 1</p></body></html>', leitura2: { cru: { hash: 'bbb', html: '<html><body><p>fixo</p><p>token 2</p></body></html>' } } });
  const r = rodar('int2-hash-versao-estavel', ctxDe([dif]));
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.equal(a.instavel, true);
  assert.match(a.mensagem, /mudou entre duas leituras seguidas/);
  assert.deepEqual(a.evidencias.filter((e) => e.trecho).map((e) => [e.valor, e.trecho]), [['primeira leitura', '<p>token 1</p>'], ['segunda leitura', '<p>token 2</p>']]);
  assert.equal(a.evidencias[0].valor, 'primeira leitura: aaa');
  assert.equal(a.citacoes.length, 1);
});

test('int2-conteudo-instavel-fora-da-nota: elemento que muda entre duas leituras do DOM final; sem segunda leitura = null', () => {
  const mk = (t) => extr({ nos: [no('#relogio', t), no('#fixo', 'texto fixo')] });
  const p = (t2) => pagina({ cru: extr(), final: mk('10:15'), leitura2: { final: { extr: mk(t2) } } });
  const r = rodar('int2-conteudo-instavel-fora-da-nota', ctxDe([p('10:16')]));
  assert.equal(r.disparou, true);
  const a = r.achados[0];
  assert.equal(a.instavel, true);
  assert.match(a.mensagem, /^Elementos que mudam sozinhos entre duas leituras seguidas do DOM final: 1 /);
  assert.deepEqual(a.evidencias.slice(1).map((e) => [e.valor, e.trecho]), [['primeira leitura', '10:15'], ['segunda leitura', '10:16']]);
  assert.equal(rodar('int2-conteudo-instavel-fora-da-nota', ctxDe([p('10:15')])).disparou, false);
  assert.equal(rodar('int2-conteudo-instavel-fora-da-nota', ctxDe([pagina({ cru: extr(), final: mk('10:15') })])), null);
});

// ================================================================== integração com fixtures reais
const todasAsRegras = carregarRegras({ modo: 'completo' }).filter((r) => ['ia-visibilidade', 'integridade'].includes(r.categoria));
const CORREDOR = {};
async function analisarFixture(nome, caminhos = ['/']) {
  const { ctx, fechar } = await lerFixture(nome, { caminhos, manterAberto: true, buscarAtivos: false });
  try {
    const medidores = (await carregarMedidores()).filter((m) => ['robots-ia', 'links', 'jsonld', 'html', 'seo'].includes(m.id));
    const med = await executarMedidores(ctx, { medidores });
    reiniciarIds();
    const motor = rodarMotor({ ctx, med, regras: todasAsRegras, detectores });
    const verif = verificarAchados(motor.achados, ctx);
    return { ctx, med, motor, verif, achados: motor.achados, por: (id) => motor.achados.filter((a) => a.regra_id === id) };
  } finally { await fechar(); }
}
before(async () => {
  for (const nome of ['contador', 'carrossel-clone', 'oculto', 'lazy', 'd-robots-ia', 'd-sem-robots', 'g-js-dependente', 'g-canonical', 'g-snippets', 'g-sem-estrutura', 'g-recursos-bloqueados', 'g-imagem-grande']) CORREDOR[nome] = await analisarFixture(nome);
  CORREDOR['g-preco-pags'] = await analisarFixture('g-preco-pags', ['/', '/produto.html']);
});

test('integração: TODOS os achados gerados nas fixtures passam pelo verificador e pelo schema; nenhuma regra sem detector nem com erro', () => {
  let total = 0;
  for (const [nome, r] of Object.entries(CORREDOR)) {
    assert.deepEqual(r.verif.descartados.map((d) => `${d.regra_id}: ${d.motivo}`), [], `${nome}: achados descartados`);
    assert.equal(r.verif.aprovados.length, r.achados.length, nome);
    assert.deepEqual(r.motor.cobertura.semDetector, [], nome);
    assert.deepEqual(r.motor.cobertura.comErro, [], nome);
    for (const a of r.achados) assert.deepEqual(validarAchado(a), { ok: true, erros: [] }, `${nome} ${a.regra_id}`);
    // só as regras que dependem de dado que o ctx ainda não traz ficam "não avaliadas"
    assert.deepEqual(r.motor.cobertura.naoAvaliadas, ['int2-fato-sem-evidencia-descartado', 'int2-hash-versao-estavel', 'int2-conteudo-instavel-fora-da-nota'], nome);
    total += r.achados.length;
  }
  assert.ok(total > 25, `achados gerados: ${total}`);
});

test('gabarito (1): fixture contador traz as 3 leituras (cru, dom250, final) em evidências e citações verificáveis', () => {
  const r = CORREDOR.contador;
  const contadores = r.por('int2-contador-animado-valor-errado');
  assert.equal(contadores.length, 2);
  const [sites, alunos] = contadores;
  assert.equal(sites.mensagem, 'O contador #sites começa em 0 e só chega a 54 depois da animação (no HTML cru "0"; aos 250 ms "0"; na página final "54"). Quem olha uma captura rápida ou uma pré-visualização pode ver o número errado.');
  assert.deepEqual(sites.evidencias.map((e) => [e.versao, e.seletor, e.trecho, e.valor, e.visivel]), [['cru', '#sites', '0', 0, true], ['dom250', '#sites', '0', 0, true], ['final', '#sites', '54', 54, true]]);
  assert.deepEqual(alunos.evidencias.map((e) => [e.versao, e.trecho, e.valor]), [['cru', '0', 0], ['dom250', '0', 0], ['final', '1200', 1200]]);
  assert.deepEqual(sites.citacoes.map((c) => [c.tipo, c.valor, c.versoes[0], c.onde]), [['trecho', '0', 'cru', 'visivel'], ['numero', 0, 'cru', 'visivel'], ['trecho', '0', 'dom250', 'visivel'], ['numero', 0, 'dom250', 'visivel'], ['trecho', '54', 'final', 'visivel'], ['numero', 54, 'final', 'visivel']]);
  assert.equal(sites.peso_aplicado, 6);
  assert.equal(sites.severidade, 'P2');
  // a regra geral também traz as 3 leituras, mas com peso 0 para não contar duas vezes
  const gerais = r.por('int2-valor-muda-entre-versoes');
  assert.equal(gerais.length, 2);
  assert.deepEqual(gerais[0].evidencias.map((e) => e.trecho), ['0', '0', '54']);
  assert.ok(gerais.every((a) => a.peso_aplicado === 0));
  assert.deepEqual(r.achados.map((a) => a.regra_id).sort(), ['int2-contador-animado-valor-errado', 'int2-contador-animado-valor-errado', 'int2-valor-muda-entre-versoes', 'int2-valor-muda-entre-versoes']);
  assert.equal(r.verif.aprovados.length, 4);
});

test('gabarito (3): clones aria-hidden viram informativo de método, nunca "depoimentos duplicados"', () => {
  const r = CORREDOR['carrossel-clone'];
  assert.equal(r.achados.length, 1);
  const a = r.achados[0];
  assert.equal(a.regra_id, 'int2-clone-carrossel-ignorado');
  assert.equal(a.peso_aplicado, 0);
  assert.equal(a.severidade, 'P3'); // severidade "info" da regra
  assert.match(a.mensagem, /^Blocos de texto de carrossel ignorados: 6 /);
  assert.deepEqual(a.citacoes, [{ tipo: 'contagem', contagem: { fn: 'nos-clone', esperado: 6 }, versoes: ['cru', 'dom250', 'final'], pagina: r.ctx.paginas[0].url }]);
  assert.ok(r.achados.every((x) => !/duplicad/i.test(x.mensagem)));
  assert.equal(r.verif.aprovados.length, 1);
});

test('gabarito (4): textos ocultos nunca viram afirmação de preço; só "inconsistência a conferir" citando onde:html', () => {
  const r = CORREDOR.oculto;
  assert.deepEqual(r.achados.map((a) => a.regra_id).sort(), ['int2-oculto-diverge-do-visivel', 'int2-texto-oculto-nao-e-visivel']);
  const [metodo] = r.por('int2-texto-oculto-nao-e-visivel');
  assert.equal(metodo.peso_aplicado, 0);
  assert.match(metodo.mensagem, /: 4\./); // 4 nós ocultos
  assert.doesNotMatch(metodo.mensagem, /OFF|R\$ 89|R\$ 59/);
  const [diverge] = r.por('int2-oculto-diverge-do-visivel');
  assert.match(diverge.mensagem, /^Inconsistência a conferir: o valor visível "R\$ 39" convive com texto oculto/);
  assert.match(diverge.mensagem, /"Oferta encerrada: de R\$ 89"; "Guia R\$ 59 e 200\+ receitas"; "Preço antigo R\$ 59"/);
  assert.doesNotMatch(diverge.mensagem, /0% OFF/);
  assert.match(diverge.mensagem, /Não estamos afirmando que algum dos valores esteja errado/);
  const ocultosCitados = diverge.citacoes.filter((c) => c.tipo === 'trecho' && c.valor !== 'R$ 39');
  assert.equal(ocultosCitados.length, 3);
  assert.ok(ocultosCitados.every((c) => c.onde === 'html'));
  assert.deepEqual(diverge.citacoes.filter((c) => c.tipo === 'trecho' && c.onde === 'visivel').map((c) => c.valor), ['R$ 39']);
  // nenhum achado afirma o oculto como preço ou oferta visível
  for (const a of r.achados) assert.doesNotMatch(a.mensagem, /oferta encerrada.*(custa|vale|preço atual)/i);
  assert.equal(r.verif.aprovados.length, 2);
});

test('lazy: seis links internos quebrados (404), contagens iguais no cru e no final (sem informativo)', () => {
  const r = CORREDOR.lazy;
  const q = r.por('int2-link-interno-quebrado');
  assert.deepEqual(q.map((a) => a.mensagem.match(/leva a (\S+),/)[1]).sort(), ['/blog/', '/contato.html', '/privacidade.html', '/produtos.html', '/sobre.html', '/termos.html']);
  assert.ok(q.every((a) => /responde com o erro 404/.test(a.mensagem) && a.peso_aplicado === 5 && a.severidade === 'P2'));
  assert.equal(r.por('int2-contagem-recalculada').length, 0);
  assert.equal(r.achados.length, 6);
  assert.equal(r.verif.aprovados.length, 6);
});

test('gabarito (5) e (6): llms.txt peso 0 só informa; rastreadores só informam liberado/bloqueado e treino x busca, sem mandar bloquear/liberar', () => {
  const r = CORREDOR['d-robots-ia'];
  assert.deepEqual(r.achados.map((a) => a.regra_id).sort(), ['ia-llms-txt-informativo', 'ia-rastreadores-robots-informativo']);
  const [llms] = r.por('ia-llms-txt-informativo');
  assert.equal(llms.peso_aplicado, 0);
  assert.equal(llms.selo, 'regra');
  assert.match(llms.mensagem, /\(5 linhas com texto, 142 bytes\)/);
  assert.match(llms.mensagem, /não dá nota e não pede mudança/);
  assert.match(llms.correcao, /^Nada a corrigir/);
  const [rast] = r.por('ia-rastreadores-robots-informativo');
  assert.equal(rast.peso_aplicado, 0);
  assert.match(rast.mensagem, /Treino \(conteúdo usado para treinar modelos de IA\): GPTBot \(OpenAI\) barrado por completo; ClaudeBot \(Anthropic\) barrado por completo; Google-Extended \(Google\) barrado na raiz, com exceções liberadas \(Allow: \/publico\/\)/);
  assert.match(rast.mensagem, /Busca \(ajuda a achar páginas para mostrar em respostas de IA\): OAI-SearchBot \(OpenAI\) permitido de forma explícita; Claude-SearchBot \(Anthropic\) barrado em partes \(Disallow: \/segredo\); PerplexityBot \(Perplexity\) barrado em partes \(Disallow: \/privado\/\)/);
  assert.match(rast.mensagem, /Consulta pedida por uma pessoa/);
  for (const texto of [rast.mensagem, rast.correcao, rast.prompt_correcao, llms.mensagem, llms.correcao, llms.prompt_correcao]) assert.doesNotMatch(texto, /recomend|bloqueie|bloquear o|libere|liberar o|permita|deveria/i);
  assert.equal(rast.evidencias.length, 9);
  assert.equal(r.por('ia-recursos-bloqueados-no-robots-txt').length, 0);
  assert.equal(r.verif.aprovados.length, 2);
  // sem robots.txt nem llms.txt: nada a informar
  assert.equal(CORREDOR['d-sem-robots'].achados.length, 0);
});

test('g-js-dependente: conteúdo, links e contagens só no JavaScript; nunca afirma "sem dados estruturados"', () => {
  const r = CORREDOR['g-js-dependente'];
  const ids = [...new Set(r.achados.map((a) => a.regra_id))].sort();
  assert.deepEqual(ids, ['ia-conteudo-no-html-cru', 'ia-estrutura-semantica-fraca', 'ia-links-internos-so-com-javascript', 'int2-contagem-recalculada', 'int2-conteudo-depende-de-js', 'int2-link-interno-quebrado']);
  const [conteudo] = r.por('ia-conteudo-no-html-cru');
  assert.match(conteudo.mensagem, /Palavras do texto principal: 7 no HTML cru e 111 na página final \(razão 0,06\)\. Títulos e parágrafos que só aparecem depois do JavaScript: 9\./); // as 7 do cru vêm do noscript
  assert.equal(conteudo.peso_aplicado, 5);
  const [links] = r.por('ia-links-internos-so-com-javascript');
  assert.match(links.mensagem, /^Links internos únicos: 0 no HTML cru e 6 na página final\./);
  const [contagem] = r.por('int2-contagem-recalculada');
  assert.match(contagem.mensagem, /imagens: 1 no HTML cru e 4 na página final; imagens com carregamento lazy: 0 no HTML cru e 3 na página final; links: 0 no HTML cru e 6 na página final; blocos de JSON-LD \(um tipo de dado estruturado\): 0 no HTML cru e 1 na página final/);
  assert.equal(contagem.peso_aplicado, 0);
  const [dep] = r.por('int2-conteudo-depende-de-js');
  assert.match(dep.mensagem, /Caracteres de texto visível: 0 no HTML cru e 667 na página final \(razão 0\)/);
  const [semantica] = r.por('ia-estrutura-semantica-fraca');
  assert.match(semantica.mensagem, /contra 1 div e 1 span/);
  assert.equal(r.por('int2-link-interno-quebrado').length, 5); // o menu aponta para páginas que não existem na fixture
  for (const todas of Object.values(CORREDOR)) for (const a of todas.achados) assert.doesNotMatch(a.mensagem, /sem dados estruturados|não há dados estruturados|nenhum dado estruturado|sem json-ld/i, a.regra_id);
  assert.equal(r.verif.descartados.length, 0);
});

test('g-canonical: relativo, com fragmento, para outra página e diferente entre cru e final', () => {
  const r = CORREDOR['g-canonical'];
  assert.deepEqual(r.achados.map((a) => a.regra_id), ['int2-canonical-divergente']);
  const m = r.achados[0].mensagem;
  for (const parte of ['canonical em formato relativo', 'canonical com fragmento (#)', 'canonical aponta para outra página', 'canonical diferente entre o HTML cru e a página final (/outra.html#topo -> /outra-final.html)']) assert.ok(m.includes(parte), parte);
  assert.equal(r.achados[0].peso_aplicado, 3);
});

test('g-snippets: nosnippet, max-snippet e data-nosnippet nas duas versões (peso 0)', () => {
  const r = CORREDOR['g-snippets'];
  assert.deepEqual(r.achados.map((a) => a.regra_id), ['ia-limite-de-trechos-informativo']);
  const a = r.achados[0];
  assert.equal(a.peso_aplicado, 0);
  assert.match(a.mensagem, /nosnippet no meta robots \(no HTML cru e na página final\), max-snippet:20 no meta googlebot \(no HTML cru e na página final\) e data-nosnippet em trechos do texto \(no HTML cru e na página final\)/);
  assert.equal(a.evidencias.filter((e) => e.seletor === '[data-nosnippet]').every((e) => e.contagem === 1), true);
});

test('g-sem-estrutura: HTML cru só com div e span', () => {
  const r = CORREDOR['g-sem-estrutura'];
  assert.deepEqual(r.achados.map((a) => a.regra_id), ['ia-estrutura-semantica-fraca']);
  assert.match(r.achados[0].mensagem, /contra 4 div e 3 span/);
  assert.equal(r.achados[0].selo, 'opiniao');
  assert.equal(r.achados[0].peso_aplicado, 1);
});

test('g-recursos-bloqueados: Googlebot barrado em /assets/ (script e CSS do mesmo domínio); /livre.* liberados', () => {
  const r = CORREDOR['g-recursos-bloqueados'];
  const [a] = r.por('ia-recursos-bloqueados-no-robots-txt');
  assert.match(a.mensagem, /impede o Googlebot de ler 2 arquivos que montam a página \(scripts ou estilos do próprio site\): \/assets\/app\.js e \/assets\/estilo\.css\./);
  assert.doesNotMatch(a.mensagem, /livre/);
  assert.equal(a.peso_aplicado, 4);
  assert.deepEqual(a.citacoes.map((c) => c.valor).sort(), ['/assets/app.js', '/assets/estilo.css']);
  assert.equal(r.por('ia-rastreadores-robots-informativo').length, 1);
  assert.equal(r.verif.descartados.length, 0);
});

test('g-imagem-grande (misto): candidata para o modelo, marcada como "para conferir"', () => {
  const r = CORREDOR['g-imagem-grande'];
  assert.deepEqual(r.achados.map((a) => a.regra_id), ['ia-informacao-chave-so-em-imagem-ou-video']);
  const a = r.achados[0];
  assert.match(a.mensagem, /^Para conferir: 1 imagem grande tem quase nenhum texto por perto/);
  assert.equal(a.selo, 'opiniao');
  assert.equal(a.evidencias[1].valor, '640x320');
  assert.ok(a.citacoes.some((c) => c.tipo === 'trecho'));
  // a fixture lazy tem só imagens pequenas (40x40): nenhuma candidata
  assert.equal(CORREDOR.lazy.por('ia-informacao-chave-so-em-imagem-ou-video').length, 0);
});

test('g-preco-pags: mesmo item com R$ 59 na home e R$ 97 em /produto.html', () => {
  const r = CORREDOR['g-preco-pags'];
  assert.deepEqual(r.achados.map((a) => a.regra_id), ['int2-preco-divergente-entre-paginas']);
  assert.equal(r.achados[0].mensagem, 'O item "Plano Guia" aparece com preços diferentes entre páginas: "R$ 59" em / e "R$ 97" em /produto.html. Pode ser plano diferente ou erro de edição; vale conferir.');
  assert.equal(r.achados[0].peso_aplicado, 5);
  assert.equal(r.verif.aprovados.length, 1);
});

test('severidade e peso saem da regra (info vira P3 e peso 0); nenhum achado de método soma nota', () => {
  const metodo = ['int2-clone-carrossel-ignorado', 'int2-texto-oculto-nao-e-visivel', 'int2-contagem-recalculada', 'ia-llms-txt-informativo', 'ia-rastreadores-robots-informativo', 'ia-limite-de-trechos-informativo'];
  for (const r of Object.values(CORREDOR)) {
    for (const a of r.achados.filter((x) => metodo.includes(x.regra_id))) { assert.equal(a.peso_aplicado, 0, a.regra_id); assert.equal(a.severidade, 'P3', a.regra_id); }
  }
  // criarAchado respeita peso_aplicado do detector (usado em int2-valor-muda para contadores)
  reiniciarIds();
  const regra = regraDoJson('integridade', 'int2-valor-muda-entre-versoes');
  assert.equal(criarAchado(regra, { pagina: '/', mensagem: 'mensagem de teste', peso_aplicado: 0 }).peso_aplicado, 0);
});
