import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { lerFixture, caminhoFixture } from './helpers/ler-fixture.mjs';
import * as js from '../lib/medidores/js.mjs';

const tag = (dados, tipo, id) => dados.tags.find((t) => t.tipo === tipo && t.id === id);

// ctx sintético: só o que o medidor lê (sem navegador).
function paginaSintetica(url, { scripts = [], noscript = [], console = [], requisicoes = [], html = '', folhas = [] } = {}) {
  const extr = { url, scripts, noscript, folhas };
  return { url, cru: { html, extr }, dom250: { html, extr }, final: { html, extr }, console, requisicoes };
}
const ctxSintetico = (paginas, ativos = [], host = 'exemplo.com.br') => ({ site: { urlInicial: `https://${host}/`, origem: `https://${host}`, host, tipoDeSite: null, modo: 'rapido' }, paginas, ativos, rede: { permitidos: [], permitirLocal: false } });
const inline = (codigo, tipo = null) => ({ src: null, tipo, async: false, defer: false, integrity: null, inline: codigo, tamanhoInline: codigo.length });
const externo = (src, extra = {}) => ({ src, tipo: null, async: false, defer: false, integrity: null, inline: '', tamanhoInline: 0, ...extra });

test('js: interface do medidor (id, saída)', async () => {
  assert.equal(js.id, 'js');
  const r = await js.medir(ctxSintetico([]));
  assert.equal(r.id, 'js');
  assert.equal(typeof r.versao, 'string');
  assert.deepEqual(r.dados.tags, []);
  assert.equal(r.dados.scriptsDeRastreamentoPresentes, false);
  assert.ok(Array.isArray(r.evidencias));
});

test('js: classificarId (tabela de formatos, vazio e placeholder)', () => {
  const c = js.classificarId;
  const quase = (o) => ({ valido: o.valido, vazio: o.vazio, problema: o.problema });
  assert.deepEqual(quase(c('ga4', 'G-7H2K9QW4TX')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('ga4', 'G-')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('ga4', '')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('ga4', 'G-XXXXXXXXXX')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('ga4', 'G-SEU-ID-AQUI')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('ga4', 'G-12')), { valido: false, vazio: false, problema: 'formato-invalido' });
  assert.deepEqual(quase(c('gtm', 'GTM-K7M2P9Q')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('gtm', 'GTM-XXXX')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('gtm', 'GTM-')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('ua', 'UA-48276153-2')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('ua', 'UA-XXXXX-Y')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('ads', 'AW-987654321')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('ads', 'AW-')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('meta-pixel', '482910374652918')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('meta-pixel', '')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('meta-pixel', 'SEU_PIXEL_ID')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('meta-pixel', '{{pixel_id}}')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('meta-pixel', '000000000000000')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('meta-pixel', 'abc7k2m')), { valido: false, vazio: false, problema: 'id-nao-numerico' });
  assert.deepEqual(quase(c('meta-pixel', '123')), { valido: false, vazio: false, problema: 'formato-invalido' });
  assert.deepEqual(quase(c('meta-pixel', 'pixelId', { dinamico: true })), { valido: null, vazio: false, problema: 'id-dinamico' });
  assert.deepEqual(quase(c('tiktok', 'CK3M9N2P5Q8R4S7T1U6V')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('tiktok', '')), { valido: false, vazio: true, problema: 'vazio' });
  assert.deepEqual(quase(c('hotjar', '3127845')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('hotjar', 'YOUR_ID')), { valido: false, vazio: true, problema: 'placeholder' });
  assert.deepEqual(quase(c('clarity', 'k4m9x2p7qz')), { valido: true, vazio: false, problema: null });
  assert.deepEqual(quase(c('clarity', '')), { valido: false, vazio: true, problema: 'vazio' });
});

test('js: detectarTagsEmTexto reconhece os formatos de instalação', () => {
  const d = js.detectarTagsEmTexto;
  assert.deepEqual(d("gtag('config', 'G-ABCDE12345', {anonymize_ip:true})").map((x) => [x.tipo, x.id]), [['ga4', 'G-ABCDE12345']]);
  assert.deepEqual(d('gtag("config","UA-12345678-1")').map((x) => [x.tipo, x.id]), [['ua', 'UA-12345678-1']]);
  assert.deepEqual(d("gtag('config','')").map((x) => [x.tipo, x.id]), [['ga4', '']]);
  assert.deepEqual(d("})(window,document,'script','dataLayer','GTM-ABC1234');").map((x) => [x.tipo, x.id]).sort(), [['gtm', 'GTM-ABC1234'], ['gtm', 'GTM-ABC1234']]);
  assert.deepEqual(d("fbq('init', 482910374652918);").map((x) => [x.tipo, x.id]), [['meta-pixel', '482910374652918']]);
  assert.deepEqual(d('fbq("init","");').map((x) => [x.tipo, x.id]), [['meta-pixel', '']]);
  assert.deepEqual(d("ttq.load('ABCDEFGHIJ0123456789')").map((x) => [x.tipo, x.id]), [['tiktok', 'ABCDEFGHIJ0123456789']]);
  assert.deepEqual(d('h._hjSettings={hjid:3127845,hjsv:6};').map((x) => [x.tipo, x.id]), [['hotjar', '3127845']]);
  assert.deepEqual(d('h._hjSettings={hjid:,hjsv:6};').map((x) => [x.tipo, x.id]), [['hotjar', '']]);
  assert.deepEqual(d('(window, document, "clarity", "script", "k4m9x2p7qz");').map((x) => [x.tipo, x.id]), [['clarity', 'k4m9x2p7qz']]);
  assert.deepEqual(d("ga('create', 'UA-48276153-2', 'auto');").map((x) => [x.tipo, x.id]), [['ua', 'UA-48276153-2']]);
  // src: gtag/js sem id, gtm.js e pixel no noscript
  assert.deepEqual(d('https://www.googletagmanager.com/gtag/js?id=', 'src').map((x) => [x.tipo, x.id]), [['ga4', '']]);
  assert.deepEqual(d('https://www.googletagmanager.com/gtm.js?id=GTM-K7M2P9Q&l=dataLayer', 'src').map((x) => [x.tipo, x.id]), [['gtm', 'GTM-K7M2P9Q']]);
  assert.deepEqual(d('<img src="https://www.facebook.com/tr?id=&ev=PageView&noscript=1">', 'src').map((x) => [x.tipo, x.id]), [['meta-pixel', '']]);
  // o snippet padrão do GTM monta a URL por concatenação: o `id=` dinâmico NÃO pode virar "ID vazio"
  assert.deepEqual(d("j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;"), []);
});

test('js: fixture legal tem GA4 e Meta Pixel VAZIOS (exemplo nº 1)', async () => {
  const { ctx } = await lerFixture('legal');
  const r = await js.medir(ctx);
  const d = r.dados;
  assert.equal(d.tags.length, 2);
  const ga4 = tag(d, 'ga4', 'G-');
  assert.ok(ga4, 'GA4 com id "G-"');
  assert.equal(ga4.vazio, true);
  assert.equal(ga4.valido, false);
  assert.equal(ga4.problema, 'vazio');
  assert.deepEqual(ga4.vistas.map((v) => v.origem).sort(), ['inline', 'src']);
  assert.ok(ga4.vistas.every((v) => v.pagina === '/' && v.executavel === true));
  assert.ok(ga4.vistas.find((v) => v.origem === 'src').trecho.endsWith('/gtag/js?id=G-'));
  assert.equal(ga4.vistas.find((v) => v.origem === 'inline').trecho, "gtag('config','G-'");
  const meta = tag(d, 'meta-pixel', '');
  assert.ok(meta, 'Meta Pixel com id vazio');
  assert.equal(meta.vazio, true);
  assert.equal(meta.vistas[0].trecho, "fbq('init',''");
  assert.deepEqual(d.analytics.vazias.map((t) => `${t.tipo}:${t.id}`), ['ga4:G-', 'meta-pixel:']);
  assert.equal(d.analytics.temTagVazia, true);
  assert.deepEqual(d.analytics.validas, []);
  assert.deepEqual(d.rastreadores, ['ga4', 'meta-pixel']);
  assert.equal(d.scriptsDeRastreamentoPresentes, true);
  assert.deepEqual(d.dominiosTerceiros.map((x) => [x.host, x.scripts, x.categoria]), [['www.googletagmanager.com', 1, 'analytics']]);
  // 3 scripts executáveis: 1 externo de terceiro (async) + 2 inline
  assert.deepEqual(d.scripts.porPagina[0], { pagina: '/', total: 3, inline: 2, externos: 1, proprios: 0, terceiros: 1, async: 1, defer: 0, bloqueantes: 0, modulos: 0, naoExecutaveis: 0 });
  assert.ok(r.evidencias.some((e) => e.valor === 'ga4:G-' && e.pagina === '/'));
});

test('js: fixture c-analytics-ok tem IDs válidos e NENHUM vazio', async () => {
  const { ctx } = await lerFixture('c-analytics-ok');
  const r = await js.medir(ctx);
  const d = r.dados;
  assert.deepEqual(d.analytics.vazias, []);
  assert.deepEqual(d.analytics.invalidas, []);
  assert.equal(d.analytics.temTagVazia, false);
  assert.deepEqual(d.analytics.validas.map((t) => `${t.tipo}:${t.id}`), [
    'ads:AW-987654321', 'clarity:k4m9x2p7qz', 'ga4:G-7H2K9QW4TX', 'gtm:GTM-K7M2P9Q', 'hotjar:3127845', 'meta-pixel:482910374652918', 'tiktok:CK3M9N2P5Q8R4S7T1U6V', 'ua:UA-48276153-2',
  ]);
  assert.equal(d.tags.length, 8);
  assert.ok(d.tags.every((t) => t.valido === true && t.vazio === false && t.problema === null));
  // onde cada uma foi vista
  const origens = (t) => t.vistas.map((v) => v.origem).sort();
  assert.deepEqual(origens(tag(d, 'ga4', 'G-7H2K9QW4TX')), ['inline', 'src']);
  assert.deepEqual(origens(tag(d, 'gtm', 'GTM-K7M2P9Q')), ['noscript', 'src']);
  assert.deepEqual(origens(tag(d, 'meta-pixel', '482910374652918')), ['inline', 'noscript']);
  // scripts externos com type="text/plain" (bloqueados até consentimento) são marcados como não executáveis
  assert.equal(tag(d, 'ga4', 'G-7H2K9QW4TX').vistas.find((v) => v.origem === 'src').executavel, false);
  assert.equal(tag(d, 'ga4', 'G-7H2K9QW4TX').vistas.find((v) => v.origem === 'inline').executavel, true);
  // bibliotecas
  assert.deepEqual(d.bibliotecas.map((b) => `${b.id}${b.versao ? '@' + b.versao : ''}`), ['aos', 'bootstrap@5.3.3', 'gsap', 'jquery@3.7.1', 'tailwind-cdn']);
  // scripts: 6 inline + app.js próprio com defer; 5 externos text/plain não contam como executáveis
  assert.deepEqual(d.scripts.porPagina[0], { pagina: '/', total: 7, inline: 6, externos: 1, proprios: 1, terceiros: 0, async: 0, defer: 1, bloqueantes: 0, modulos: 0, naoExecutaveis: 5 });
  assert.equal(d.scripts.externosUnicos, 1);
  assert.equal(d.scripts.propriosUnicos, 1);
  assert.equal(d.scripts.terceirosUnicos, 0);
  assert.equal(d.scripts.inlineUnicos, 6);
  // JS próprio baixado: app.js, tamanho conferido no disco
  const bytesAppJs = statSync(caminhoFixture('c-analytics-ok') + '/app.js').size;
  assert.equal(d.jsProprio.quantidade, 1);
  assert.equal(d.jsProprio.bytesTotal, bytesAppJs);
  assert.ok(d.jsProprio.arquivos[0].url.endsWith('/app.js'));
  assert.deepEqual(d.jsProprio.naoBaixados, []);
  // terceiros que carregam scripts (para a regra de cookies/consentimento)
  assert.deepEqual(d.dominiosTerceiros.map((x) => [x.host, x.scripts, x.rastreador]), [
    ['cdn.jsdelivr.net', 1, false], ['cdn.tailwindcss.com', 1, false], ['code.jquery.com', 1, false], ['www.googletagmanager.com', 2, true],
  ]);
  assert.equal(d.scriptsDeRastreamentoPresentes, true);
  // console: 1 console.error de app.js
  assert.equal(d.console.erros, 1);
  assert.equal(d.console.pageErros, 0);
  assert.deepEqual(d.console.amostra.map((a) => a.texto), ['c-analytics-ok: erro proposital de console']);
  assert.deepEqual(d.requisicoesFalhadas, []);
});

test('js: placeholders, ID inválido e ID dinâmico (ctx sintético)', async () => {
  const p = paginaSintetica('https://exemplo.com.br/', {
    scripts: [
      externo('https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX', { async: true }),
      inline("window.dataLayer=[];function gtag(){}gtag('config','G-XXXXXXXXXX');"),
      inline("fbq('init','SEU_PIXEL_ID');"),
      inline("fbq('init','abc7k2m');"),
      inline("fbq('init', pixelId);"),
      inline("gtag('config','UA-XXXXX-Y');"),
      inline("ttq.load('');"),
      inline('h._hjSettings={hjid:YOUR_ID,hjsv:6};'),
    ],
  });
  const d = (await js.medir(ctxSintetico([p]))).dados;
  assert.equal(tag(d, 'ga4', 'G-XXXXXXXXXX').problema, 'placeholder');
  assert.equal(tag(d, 'ga4', 'G-XXXXXXXXXX').vazio, true);
  assert.equal(tag(d, 'ga4', 'G-XXXXXXXXXX').vistas.length, 2);
  assert.equal(tag(d, 'meta-pixel', 'SEU_PIXEL_ID').problema, 'placeholder');
  assert.equal(tag(d, 'meta-pixel', 'abc7k2m').problema, 'id-nao-numerico');
  assert.equal(tag(d, 'meta-pixel', 'abc7k2m').vazio, false);
  assert.equal(tag(d, 'meta-pixel', 'pixelId').problema, 'id-dinamico');
  assert.equal(tag(d, 'meta-pixel', 'pixelId').valido, null);
  assert.equal(tag(d, 'ua', 'UA-XXXXX-Y').vazio, true);
  assert.equal(tag(d, 'tiktok', '').vazio, true);
  assert.equal(tag(d, 'hotjar', 'YOUR_ID').vazio, true);
  assert.deepEqual(d.analytics.vazias.map((t) => `${t.tipo}:${t.id}`), ['ga4:G-XXXXXXXXXX', 'hotjar:YOUR_ID', 'meta-pixel:SEU_PIXEL_ID', 'tiktok:', 'ua:UA-XXXXX-Y']);
  assert.deepEqual(d.analytics.invalidas.map((t) => `${t.tipo}:${t.id}`), ['meta-pixel:abc7k2m']);
  assert.equal(d.analytics.porTipo['meta-pixel'].encontradas, 3);
  assert.equal(d.analytics.porTipo['meta-pixel'].vazias, 1);
  assert.equal(d.analytics.porTipo['meta-pixel'].invalidas, 1);
  assert.equal(d.analytics.porTipo['meta-pixel'].naoVerificaveis, 1);
});

test('js: só scripts de rastreamento bloqueados por consentimento => scriptsDeRastreamentoPresentes=false', async () => {
  const p = paginaSintetica('https://exemplo.com.br/', {
    scripts: [externo('https://www.googletagmanager.com/gtm.js?id=GTM-K7M2P9Q', { tipo: 'text/plain' }), externo('https://connect.facebook.net/pt_BR/fbevents.js', { tipo: 'text/plain' })],
  });
  const d = (await js.medir(ctxSintetico([p]))).dados;
  assert.equal(d.scriptsDeRastreamentoPresentes, false);
  assert.equal(tag(d, 'gtm', 'GTM-K7M2P9Q').vistas[0].executavel, false);
  assert.deepEqual(d.dominiosTerceiros.map((x) => [x.host, x.categoria]), [['connect.facebook.net', 'publicidade'], ['www.googletagmanager.com', 'analytics']]);
  assert.equal(d.scripts.porPagina[0].total, 0);
  assert.equal(d.scripts.porPagina[0].naoExecutaveis, 2);
});

test('js: scripts próprios x terceiros, async/defer/bloqueantes, módulos (ctx sintético, 2 páginas)', async () => {
  const comuns = [
    externo('https://exemplo.com.br/assets/app.js', { defer: true }),
    externo('https://www.exemplo.com.br/assets/vendor.js'),
    externo('https://cdn.exemplo.com.br/chunk.js', { async: true }),
    externo('https://cdn.jsdelivr.net/npm/swiper@11.1.4/swiper-bundle.min.js'),
    externo('/modulo.mjs', { tipo: 'module' }),
    inline('console.log(1)'),
  ];
  const a = paginaSintetica('https://exemplo.com.br/', { scripts: comuns });
  const b = paginaSintetica('https://exemplo.com.br/sobre', { scripts: [...comuns, externo('https://unpkg.com/alpinejs@3.14.1/dist/cdn.min.js', { defer: true })] });
  const d = (await js.medir(ctxSintetico([a, b]))).dados;
  assert.deepEqual(d.scripts.porPagina[0], { pagina: '/', total: 6, inline: 1, externos: 5, proprios: 4, terceiros: 1, async: 1, defer: 1, bloqueantes: 2, modulos: 1, naoExecutaveis: 0 });
  assert.deepEqual(d.scripts.porPagina[1], { pagina: '/sobre', total: 7, inline: 1, externos: 6, proprios: 4, terceiros: 2, async: 1, defer: 2, bloqueantes: 2, modulos: 1, naoExecutaveis: 0 });
  assert.equal(d.scripts.externosUnicos, 6);
  assert.equal(d.scripts.propriosUnicos, 4); // app, vendor (www), chunk (subdomínio), módulo
  assert.equal(d.scripts.terceirosUnicos, 2);
  assert.equal(d.scripts.inlineUnicos, 1);
  assert.deepEqual(d.dominiosTerceiros.map((x) => [x.host, x.scripts]), [['cdn.jsdelivr.net', 1], ['unpkg.com', 1]]);
  assert.deepEqual(d.bibliotecas.map((x) => `${x.id}@${x.versao}`), ['alpine@3.14.1', 'swiper@11.1.4']);
  assert.equal(d.scriptsDeRastreamentoPresentes, false);
});

test('js: detecta frameworks por URL e por marcadores do HTML (ctx sintético)', async () => {
  const html = '<div id="__next"></div><div data-v-7ba5bd90 class="x"></div><div ng-version="17.3.0"></div><div class="swiper-wrapper"></div><div data-aos="fade-up"></div><link href="/wp-content/themes/x/style.css">';
  const p = paginaSintetica('https://exemplo.com.br/', {
    html,
    scripts: [externo('/_next/static/chunks/main-abc123.js'), externo('https://unpkg.com/react@18.3.1/umd/react.production.min.js'), externo('/js/jquery.min.js'), inline('gsap.registerPlugin(ScrollTrigger);')],
    folhas: ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'],
  });
  const d = (await js.medir(ctxSintetico([p]))).dados;
  const ids = d.bibliotecas.map((b) => b.id);
  assert.deepEqual(ids, ['angular', 'aos', 'bootstrap', 'gsap', 'jquery', 'next', 'react', 'swiper', 'vue', 'wordpress']);
  const versao = (i) => d.bibliotecas.find((b) => b.id === i).versao;
  assert.equal(versao('angular'), '17.3.0');
  assert.equal(versao('react'), '18.3.1');
  assert.equal(versao('bootstrap'), '5.3.3');
  assert.equal(versao('jquery'), null);
  assert.deepEqual(d.bibliotecas.find((b) => b.id === 'bootstrap').deteccoes.map((x) => x.origem), ['css']);
});

test('js: console (erros, pageerrors, avisos) e requisições falhadas (ctx sintético)', async () => {
  const p = paginaSintetica('https://exemplo.com.br/', {
    console: [
      { tipo: 'error', texto: 'Failed to load resource: the server responded with a status of 404 ()' },
      { tipo: 'pageerror', texto: 'fbq is not defined' },
      { tipo: 'warning', texto: 'aviso qualquer' },
      { tipo: 'error', texto: 'segundo erro' },
    ],
    requisicoes: [
      { url: 'https://exemplo.com.br/img/sumiu.png', status: 404, tipo: 'image', mime: 'text/html', bytes: null },
      { url: 'https://exemplo.com.br/img/ok.png', status: 200, tipo: 'image', mime: 'image/png', bytes: 100 },
      { url: 'https://api.exemplo.com.br/x', falhou: 'net::ERR_CONNECTION_REFUSED' },
      { url: 'http://169.254.169.254/latest', falhou: 'net::ERR_BLOCKED_BY_CLIENT' },
      { url: 'https://exemplo.com.br/img/sumiu.png', status: 404, tipo: 'image', mime: 'text/html', bytes: null },
    ],
  });
  const r = await js.medir(ctxSintetico([p]));
  const d = r.dados;
  assert.deepEqual({ e: d.console.erros, p: d.console.pageErros, a: d.console.avisos }, { e: 2, p: 1, a: 1 });
  assert.deepEqual(d.console.porPagina, [{ pagina: '/', erros: 2, pageErros: 1, avisos: 1 }]);
  assert.deepEqual(d.console.amostra.map((x) => x.tipo), ['error', 'pageerror', 'error']);
  assert.deepEqual(d.requisicoesFalhadas, [
    { pagina: '/', url: 'https://exemplo.com.br/img/sumiu.png', motivo: 'status 404' },
    { pagina: '/', url: 'https://api.exemplo.com.br/x', motivo: 'net::ERR_CONNECTION_REFUSED' },
  ]);
  assert.equal(d.requisicoesBloqueadasPeloAnalisador, 1); // bloqueio do próprio analisador não é culpa do site
  assert.ok(r.evidencias.some((e) => e.seletor === 'console' && e.trecho === 'fbq is not defined'));
});

test('js: arquivo JS próprio baixado (ctx.ativos) soma bytes e também é varrido atrás de IDs', async () => {
  const ativos = [
    { url: 'https://exemplo.com.br/app.js', tipo: 'js', terceiro: false, status: 200, bytes: 1500, hash: 'x', texto: "var _=1;fbq('init','');gtag('config','G-ABCDE12345');", erro: null },
    { url: 'https://exemplo.com.br/outro.js', tipo: 'js', terceiro: false, status: 200, bytes: 500, hash: 'y', texto: 'x=1', erro: null },
    { url: 'https://exemplo.com.br/grande.js', tipo: 'js', terceiro: false, status: null, bytes: 0, hash: null, texto: null, erro: 'resposta maior que 3145728 bytes' },
    { url: 'https://cdn.exemplo.net/lib.js', tipo: 'js', terceiro: true, status: null, bytes: 0, hash: null, texto: null, erro: 'terceiro: não baixado' },
    { url: 'https://exemplo.com.br/style.css', tipo: 'css', terceiro: false, status: 200, bytes: 999, hash: 'z', texto: 'a{}', erro: null },
  ];
  const d = (await js.medir(ctxSintetico([paginaSintetica('https://exemplo.com.br/')], ativos))).dados;
  assert.equal(d.jsProprio.quantidade, 2);
  assert.equal(d.jsProprio.bytesTotal, 2000);
  assert.deepEqual(d.jsProprio.naoBaixados, [{ url: 'https://exemplo.com.br/grande.js', motivo: 'resposta maior que 3145728 bytes' }]);
  assert.equal(tag(d, 'meta-pixel', '').vistas[0].origem, 'ativo');
  assert.equal(tag(d, 'meta-pixel', '').vistas[0].ativo, 'https://exemplo.com.br/app.js');
  assert.equal(tag(d, 'ga4', 'G-ABCDE12345').valido, true);
});

test('js: determinismo (duas execuções, mesmo resultado)', async () => {
  const { ctx } = await lerFixture('legal');
  const a = await js.medir(ctx);
  const b = await js.medir(ctx);
  assert.deepEqual(a, b);
});
