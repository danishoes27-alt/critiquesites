import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';
import { lerPagina } from '../lib/ler-pagina.mjs';
import { medir, id, coresDeValor, PALETA_PADRAO } from '../lib/medidores/css.mjs';

const lido = {};
const medidos = {};
before(async () => {
  for (const nome of ['ia-ruim', 'b-boa', 'b-contraste']) {
    const { ctx } = await lerFixture(nome);
    lido[nome] = ctx;
    medidos[nome] = await medir(ctx);
  }
});
after(() => {});

const pag = (nome) => medidos[nome].dados.paginas[0];
const est = (nome) => medidos[nome].dados.site.estatico;
const ev = (nome, tipo) => medidos[nome].evidencias.filter((e) => e.tipo === tipo);

// contraste WCAG calculado "à mão", independente do extrator
const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lumHex = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const razao = (a, b) => { const [x, y] = [lumHex(a), lumHex(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---------------------------------------------------------------------------------------------------------------------
test('contrato: id, versão e formato da saída', () => {
  const r = medidos['ia-ruim'];
  assert.equal(id, 'css');
  assert.equal(r.id, 'css');
  assert.equal(typeof r.versao, 'string');
  assert.ok(Array.isArray(r.evidencias) && r.evidencias.length > 0);
  for (const e of r.evidencias) for (const k of ['pagina', 'versao', 'seletor', 'trecho', 'valor', 'contagem', 'visivel']) assert.ok(k in e, `evidência sem ${k}`);
  assert.equal(r.dados.paginas.length, 1);
  assert.deepEqual(r.dados.paletaPadrao.hexExatos.length, 17);
});

test('ia-ruim: tipografia (Inter/system-ui, h1 48px, escala curta, sem tracking)', () => {
  const es = pag('ia-ruim').computado;
  assert.equal(es.tipografia.familias.body, 'Inter');
  assert.equal(es.tipografia.familias.h1, 'Inter');
  assert.equal(es.tipografia.familias.pilhaBody, 'Inter, system-ui, sans-serif');
  assert.equal(es.tipografia.fontes.temFonteCustom, false);
  assert.deepEqual(es.tipografia.fontes.declaradas, []);
  assert.equal(es.tipografia.h1.tamanhoPx, 48);
  assert.equal(es.tipografia.h1.letterSpacingPx, 0);
  assert.deepEqual(es.tipografia.tamanhos.lista, [13.33, 16, 18.72, 48]);
  assert.equal(es.tipografia.tamanhos.nDistintos, 4);
  assert.equal(es.tipografia.tamanhos.abaixo12.tamanhos.length, 0);
  assert.equal(es.tipografia.titulosGrandes.total, 1);
  assert.equal(es.tipografia.titulosGrandes.comTrackingNegativo, 0);
  const d = pag('ia-ruim').derivados;
  assert.equal(d.fonte.bodyGenerica, true);
  assert.equal(d.fonte.h1Generica, true);
  assert.equal(d.tipografia.titulosGrandesSemTrackingNegativo, 1);
  const s = est('ia-ruim').tipografia;
  assert.deepEqual(s.familiasDeclaradas, { Inter: 1 });
  assert.equal(s.temFontFacePropria, false);
  assert.deepEqual(s.familiasNaoGenericas, []);
});

test('ia-ruim: gradiente 6366f1→a855f7 em texto, cor índigo e botão primário', () => {
  const es = pag('ia-ruim').computado;
  assert.equal(es.gradientes.elementos, 1);
  assert.equal(es.gradientes.texto.elementos, 1);
  assert.equal(es.gradientes.texto.itens[0].tag, 'h1');
  const g = es.gradientes.itens[0];
  assert.equal(g.tipo, 'linear');
  assert.equal(g.angulo, 90);
  assert.deepEqual(g.paradas.map((p) => p.hex), ['#6366f1', '#a855f7']);
  assert.equal(g.aplicadoAoTexto, true);
  assert.equal(g.matizInicial, 239);
  assert.equal(g.matizFinal, 271);
  const d = pag('ia-ruim').derivados;
  assert.equal(d.gradiente.azulParaRoxo, 1);
  assert.equal(d.gradiente.textoComGradiente, 1);
  assert.equal(d.cor.botaoPrimarioNaRampa, true);
  assert.equal(d.cor.botaoPrimarioFundo, '#6366f1');
  assert.deepEqual(d.cor.rampaPadrao.hex, ['#6366f1']);
  // estático: o hex aparece 2x (gradiente + .btn) e #a855f7 1x
  const e = est('ia-ruim');
  assert.deepEqual(e.cores.rampaPadrao.valores, { '#6366f1': 2, '#a855f7': 1 });
  assert.equal(e.gradientes.total, 1);
  assert.equal(e.gradientes.azulParaRoxo, 1);
  assert.equal(e.gradientes.comHexPadrao, 1);
  assert.equal(e.efeitos.backgroundClipText, 1);
  assert.ok(ev('ia-ruim', 'gradiente-azul-roxo').length >= 1);
  assert.equal(ev('ia-ruim', 'texto-com-gradiente')[0].valor, 'background-clip:text');
});

test('ia-ruim: grid de 3 colunas com 3 cards, hero centralizado (hero + 3 cards)', () => {
  const es = pag('ia-ruim').computado;
  assert.equal(es.layout.grades.length, 1);
  assert.equal(es.layout.grades[0].colunas, 3);
  assert.equal(es.layout.grades[0].filhos, 3);
  assert.equal(es.layout.heroes[0].classe, 'hero');
  assert.equal(es.layout.heroes[0].textAlign, 'center');
  const h = pag('ia-ruim').derivados.heroTresCards;
  assert.deepEqual({ hero: h.hero, c: h.heroCentralizado, g: h.grade3Colunas, f: h.filhosDaGrade }, { hero: true, c: true, g: true, f: 3 });
  assert.equal(es.layout.centralizacao.blocos, 15);
  assert.equal(es.layout.centralizacao.centralizados, 4);
  assert.equal(es.layout.centralizacao.porProfundidade['1'].centralizados, 1);
});

test('ia-ruim: border-radius 16px repetido, sombra difusa, padding 24px e card aninhado', () => {
  const es = pag('ia-ruim').computado;
  assert.deepEqual(es.raios.valores, { '16px': 5 });
  assert.equal(es.raios.nDistintos, 1);
  assert.equal(es.raios.dominante, '16px');
  assert.equal(es.raios.fracaoDominante, 1);
  assert.deepEqual(es.raios.porTipo.botao, { '16px': 1 });
  assert.deepEqual(es.raios.porTipo.card, { '16px': 4 });
  assert.equal(es.sombras.elementos, 4);
  assert.deepEqual(es.sombras.valores, { 'rgba(0, 0, 0, 0.15) 0px 10px 15px 0px': 4 });
  const sd = es.sombras.detalhes[0];
  assert.deepEqual({ x: sd.x, y: sd.y, blur: sd.blur, spread: sd.spread, alfa: sd.alfa, cor: sd.cor, dif: sd.difusaGenerica, glow: sd.glow }, { x: 0, y: 10, blur: 15, spread: 0, alfa: 0.15, cor: '#000000', dif: true, glow: false });
  assert.equal(es.sombras.elementosComDifusaGenerica, 4);
  assert.equal(es.sombras.elementosComGlow, 0);
  assert.equal(es.cards.total, 4);
  assert.deepEqual(es.cards.padding, { '24px': 4 });
  assert.equal(es.cards.fracaoPaddingDominante, 1);
  assert.equal(es.cards.aninhados.total, 1);
  assert.equal(es.cards.aninhados.pares.length, 1);
  assert.equal(es.cards.aninhados.raioFilhoMaiorQuePai, 0);
  assert.equal(es.secoes.n, 2);
  assert.equal(es.secoes.uniforme, false);
});

test('ia-ruim: 3 emojis em títulos', () => {
  const es = pag('ia-ruim').computado;
  assert.equal(es.emojis.contagem, 3);
  assert.deepEqual(es.emojis.unicos.sort(), ['✨', '🔒', '🚀'].sort());
  assert.equal(es.emojis.porTipo.titulo, 3);
  assert.equal(pag('ia-ruim').derivados.emojis.total, 3);
});

test('ia-ruim: animação "entrar" em 3 cards, sem :hover/:focus e sem prefers-reduced-motion', () => {
  const es = pag('ia-ruim').computado;
  assert.equal(es.movimento.animacoes.elementos, 3);
  assert.equal(es.movimento.animacoes.porNome.length, 1);
  const a = es.movimento.animacoes.porNome[0];
  assert.deepEqual({ nome: a.nome, el: a.elementos, ms: a.duracaoMs, ease: a.easing, ent: a.ehEntrada, an: a.anima }, { nome: 'entrar', el: 3, ms: 600, ease: 'ease', ent: true, an: ['opacity'] });
  assert.equal(es.movimento.transicoes.elementos, 0);
  assert.deepEqual(pag('ia-ruim').derivados.movimento.animacaoMaisRepetida, { nome: 'entrar', elementos: 3, ehEntrada: true });
  const e = est('ia-ruim');
  assert.equal(e.estados.hover, 0);
  assert.equal(e.estados.focus, 0);
  assert.equal(e.estados.focusVisible, 0);
  assert.equal(e.estados.active, 0);
  assert.equal(e.estados.regraGlobalDeFoco, false);
  assert.deepEqual(e.estados.gruposSemNenhumEstado, ['button', 'a', 'input', 'select', 'textarea']);
  assert.equal(e.mediaQueries.prefersReducedMotion, 0);
  assert.equal(e.mediaQueries.total, 0);
  assert.deepEqual(e.movimento.keyframes, ['entrar']);
  assert.equal(e.movimento.animacoes, 1);
  assert.equal(e.movimento.temMovimento, true);
  assert.equal(ev('ia-ruim', 'css-sem-reduced-motion').length, 1);
  assert.equal(ev('ia-ruim', 'css-sem-foco').length, 1);
});

test('ia-ruim: CSS estático inline (bytes, regras, fonte, sem @font-face)', () => {
  const e = est('ia-ruim');
  const inline = lido['ia-ruim'].paginas[0].final.extr.estilosInline;
  assert.equal(inline.length, 1);
  assert.equal(e.arquivos.inline, 1);
  assert.equal(e.arquivos.css, 0);
  assert.equal(e.bytes, inline[0].length);
  assert.equal(e.regras, 8);
  assert.equal(e.fontFace.total, 0);
  assert.equal(e.imports.length, 0);
  assert.equal(e.important, 0);
  assert.equal(e.propriedadesCustom.total, 0);
  assert.equal(e.propriedadesCustom.temTokensSemanticos, false);
  assert.equal(pag('ia-ruim').estatico.blocosInline, 1);
});

test('ia-ruim: contraste do botão branco sobre #6366f1 (≈4,47) e texto transparente ignorado', () => {
  const c = pag('ia-ruim').computado.contraste;
  assert.equal(c.falhas, 1);
  assert.equal(c.textoTransparente, 1); // o h1 com gradiente
  const f = c.itens[0];
  assert.equal(f.corTexto, '#ffffff');
  assert.equal(f.corFundo, '#6366f1');
  assert.ok(Math.abs(f.razao - razao('#ffffff', '#6366f1')) < 0.01);
});

test('ia-ruim: mobile lido (overflow por causa do grid, meta viewport presente)', () => {
  const p = lido['ia-ruim'].paginas[0];
  assert.ok(p.mobile, 'resultado.mobile ausente');
  assert.equal(p.mobile.viewportMeta, 'width=device-width,initial-scale=1');
  assert.equal(p.mobile.overflowHorizontal, true);
  assert.equal(p.mobile.estilos.overflowHorizontal.ativo, true);
  assert.equal(p.mobile.estilos.overflowHorizontal.larguraReferencia, 390);
  assert.ok(p.mobile.estilos.overflowHorizontal.larguraDocumento > 390);
  assert.ok(p.mobile.extr.nos.length > 3);
  assert.equal(p.final.estilos.overflowHorizontal.ativo, false);
  assert.equal(pag('ia-ruim').derivadosMobile.overflowHorizontal, true);
  assert.equal(medidos['ia-ruim'].dados.site.computado.paginasComOverflowMobile, 1);
  assert.ok(ev('ia-ruim', 'mobile-overflow-horizontal').length >= 1);
});

// ---------------------------------------------------------------------------------------------------------------------
test('b-boa: fonte própria via @font-face, tokens, raios variados, foco, reduced-motion (o oposto do ia-ruim)', () => {
  const p = pag('b-boa');
  const es = p.computado;
  const e = est('b-boa');
  // fonte
  assert.equal(es.tipografia.familias.body, 'Fonte Boa');
  assert.equal(es.tipografia.fontes.temFonteCustom, true);
  assert.equal(es.tipografia.fontes.declaradas[0].familia, 'Fonte Boa');
  assert.equal(es.tipografia.fontes.declaradas[0].status, 'loaded');
  assert.equal(es.tipografia.fontes.bodyUsaFonteCustom, true);
  assert.equal(p.derivados.fonte.bodyGenerica, false);
  assert.equal(e.fontFace.total, 1);
  assert.deepEqual(e.fontFace.fontDisplay, { swap: 1 });
  assert.equal(e.tipografia.temFontFacePropria, true);
  assert.deepEqual(e.tipografia.fontFaceComFamiliaNaoGenerica, ['Fonte Boa']);
  assert.equal(e.arquivos.css, 1);
  assert.equal(e.arquivos.inline, 0);
  // tipografia: tracking negativo, escala rica, unidades rem
  assert.equal(es.tipografia.h1.tamanhoPx, 56);
  assert.equal(es.tipografia.h1.letterSpacingEm, -0.03);
  assert.equal(es.tipografia.titulosGrandes.comTrackingNegativo, 1);
  assert.equal(p.derivados.tipografia.titulosGrandesSemTrackingNegativo, 0);
  assert.equal(es.tipografia.tamanhos.nDistintos, 7);
  assert.deepEqual(e.tipografia.fontSizeUnidades, { rem: 7 });
  // tokens
  assert.equal(e.propriedadesCustom.temTokensSemanticos, true);
  assert.ok(e.propriedadesCustom.semanticos.includes('--cor-acento'));
  assert.equal(e.propriedadesCustom.total, 12);
  // raios por papel
  assert.equal(es.raios.nDistintos, 3);
  assert.deepEqual(es.raios.porTipo.campo, { '6px': 1 });
  assert.deepEqual(es.raios.porTipo.card, { '12px': 2 });
  assert.deepEqual(es.raios.porTipo.botao, { '999px': 2 });
  assert.equal(p.derivados.raios.nDistintos, 3);
  // estados
  assert.equal(e.estados.hover, 1);
  assert.equal(e.estados.active, 1);
  assert.equal(e.estados.focusVisible, 3);
  assert.equal(e.estados.focusVisibleComIndicador, true);
  assert.equal(e.estados.outlineNone.total, 0);
  assert.equal(e.estados.porGrupo.button.hover, 1);
  assert.equal(e.estados.porGrupo.button.foco, 1);
  assert.equal(e.estados.porGrupo.button.active, 1);
  assert.ok(!e.estados.gruposSemNenhumEstado.includes('button'));
  // movimento
  assert.equal(e.mediaQueries.prefersReducedMotion, 1);
  assert.equal(e.mediaQueries.prefersColorScheme, 1);
  assert.equal(e.mediaQueries.reducedMotionAnulaMovimento, 2);
  assert.deepEqual(e.mediaQueries.breakpointsPx, [640, 1024]);
  assert.equal(e.movimento.temCubicBezier, true);
  assert.deepEqual(e.movimento.cubicBeziers, { 'cubic-bezier(.2,.7,.2,1)': 2 });
  assert.equal(e.movimento.transicaoAll, 0);
  assert.equal(es.movimento.transicoes.temEasingCustom, true);
  assert.equal(es.movimento.animacoes.elementos, 0);
  assert.equal(ev('b-boa', 'css-sem-reduced-motion').length, 0);
  assert.equal(ev('b-boa', 'css-sem-foco').length, 0);
  // o que o ia-ruim tem e esta não
  assert.equal(es.gradientes.elementos, 0);
  assert.equal(es.emojis.contagem, 0);
  assert.equal(es.sombras.elementos, 0);
  assert.equal(es.cards.aninhados.total, 0);
  assert.equal(es.layout.centralizacao.centralizados, 0);
  assert.equal(p.derivados.cor.rampaPadrao.elementos, 0);
  assert.equal(p.derivados.cor.botaoPrimarioNaRampa, false);
  assert.equal(e.cores.rampaPadrao.ocorrencias, 0);
  assert.equal(e.gradientes.total, 0);
  assert.equal(es.contraste.falhas, 0);
  assert.equal(es.alvosToque.abaixo44, 0);
  assert.equal(p.mobile.overflowHorizontal, false);
  assert.equal(p.derivados.heroTresCards.grade3Colunas, false);
  assert.equal(p.derivados.secoes.uniforme, false);
});

test('b-contraste: cinza claro sobre branco falha com a razão calculada à mão', () => {
  const c = pag('b-contraste').computado.contraste;
  assert.equal(c.avaliados, 5);
  assert.equal(c.indeterminados, 1); // texto sobre gradiente: não conta como falha
  assert.equal(c.falhas, 3);
  const por = (cor) => c.itens.find((i) => i.corTexto === cor);
  const a = por('#aaaaaa');
  assert.equal(a.corFundo, '#ffffff');
  assert.equal(a.minimo, 4.5);
  assert.ok(Math.abs(a.razao - razao('#aaaaaa', '#ffffff')) < 0.01);
  assert.equal(a.razao, 2.32);
  // texto grande (28px, negrito do h2) usa o limite 3
  const g = por('#999999');
  assert.equal(g.grande, true);
  assert.equal(g.minimo, 3);
  assert.equal(g.razao, 2.85);
  // #777 falha por pouco (4,48), #767676 passa (4,54), branco sobre azul escuro passa
  assert.equal(por('#777777').razao, 4.48);
  assert.equal(por('#767676'), undefined);
  assert.ok(!c.itens.some((i) => i.corTexto === '#ffffff'));
  assert.equal(c.razaoMinima, 2.32);
  assert.equal(ev('b-contraste', 'contraste-falha')[0].valor, 2.32);
});

// ---------------------------------------------------------------------------------------------------------------------
// CSS estático em isolamento (sem navegador): ctx sintético
const ctxCss = (...textos) => ({ site: {}, paginas: [], ativos: textos.map((t, i) => ({ url: `http://x/${i}.css`, tipo: 'css', texto: t, bytes: t.length, hash: null })) });

test('estático: outline:none sem substituto, transition:all, !important, @import, unidades e breakpoints em em/rem', async () => {
  const css = `@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
:root{--primary:222.2 47.4% 11.2%;--color-brand:rgb(99,102,241);--espaco:8px}
a{outline:none}
button:focus{outline:0;box-shadow:0 0 0 3px #123456}
.x{transition:all .3s;font-size:14px;color:hsl(262,83%,58%)}
.y{font-size:1.25rem!important;transition:opacity .2s ease-in-out,transform 150ms linear}
.z{font-size:clamp(1rem,2vw,2rem);will-change:transform;backdrop-filter:blur(8px)}
@media (min-width:48em){.x{color:red}}
@media (width >= 1280px){.y{margin:0}}
@media (prefers-contrast:more){.x{color:#000}}
.btn:hover,.btn:active{opacity:.9}
@keyframes sobe{from{opacity:0}to{opacity:1}}
.k{animation:sobe .4s cubic-bezier(.2,.8,.2,1) both}`;
  const r = await medir(ctxCss(css));
  const e = r.dados.site.estatico;
  assert.equal(e.estados.outlineNone.total, 2);
  assert.equal(e.estados.outlineNone.semSubstituto, 1); // `a{outline:none}`; o do button:focus tem box-shadow
  assert.equal(e.estados.outlineNone.itensSemSubstituto[0].seletor, 'a');
  assert.equal(e.movimento.transicaoAll, 1);
  assert.equal(e.movimento.transicoes, 3);
  assert.deepEqual(e.movimento.easing, { 'ease (implícito)': 1, 'ease-in-out': 1, linear: 1, 'cubic-bezier': 1 });
  assert.equal(e.important, 1);
  assert.equal(e.imports.length, 1);
  assert.equal(e.fontesExternas[0].host, 'fonts.googleapis.com');
  assert.deepEqual(e.tipografia.fontSizeUnidades, { px: 1, rem: 1, clamp: 1 });
  assert.deepEqual(e.mediaQueries.breakpointsPx, [768, 1280]);
  assert.equal(e.mediaQueries.prefersContrast, 1);
  assert.equal(e.propriedadesCustom.temTokensSemanticos, true);
  assert.equal(e.movimento.willChange, 1);
  assert.equal(e.efeitos.backdropFilter, 1);
  assert.deepEqual(e.movimento.animacaoNomes, { sobe: 1 });
  assert.equal(e.estados.porGrupo.button.hover, 1);
  assert.equal(e.estados.porGrupo.button.active, 1);
  // cor da rampa índigo escrita como rgb() e roxo "de marca" (hsl) fora da lista
  assert.deepEqual(e.cores.rampaPadrao.valores, { '#6366f1': 1 });
  assert.equal(Object.keys(e.cores.matizRoxoForaDaLista).length, 1);
  assert.ok(r.evidencias.some((x) => x.tipo === 'css-outline-none' && x.seletor === 'a'));
});

test('estático: CSS com erro de sintaxe não derruba o medidor e conteúdo repetido não é contado 2x', async () => {
  const ok = 'body{color:#6366f1}';
  const r = await medir(ctxCss(ok, ok, 'a{color:red'));
  const e = r.dados.site.estatico;
  assert.equal(e.arquivos.css, 2); // o duplicado é descartado; o malformado entra com erro de parse
  assert.equal(e.cores.rampaPadrao.valores['#6366f1'], 1);
});

test('coresDeValor: hex curto, rgb com %, hsl, tripla shadcn e url() ignorada', () => {
  assert.deepEqual(coresDeValor('#FFF').map((c) => c.hex), ['#ffffff']);
  assert.deepEqual(coresDeValor('#6366f180').map((c) => c.hex), ['#6366f1']);
  assert.deepEqual(coresDeValor('rgb(100% 0% 0%)').map((c) => c.hex), ['#ff0000']);
  assert.deepEqual(coresDeValor('hsl(0, 100%, 50%)').map((c) => c.hex), ['#ff0000']);
  assert.deepEqual(coresDeValor('0 100% 50%', { propriedadeCustom: true }).map((c) => c.hex), ['#ff0000']);
  assert.deepEqual(coresDeValor('0 100% 50%').map((c) => c.hex), []);
  assert.deepEqual(coresDeValor('url(data:font/ttf;base64,#abcdef) #000').map((c) => c.hex), ['#000000']);
  assert.ok(PALETA_PADRAO.hexExatos.includes('#a855f7'));
});

// ---------------------------------------------------------------------------------------------------------------------
test('lerPagina: opção mobile:false desliga a leitura mobile; estilos do desktop continuam', async () => {
  const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const s = await servirPasta(fixtures + 'b-contraste');
  const hp = `127.0.0.1:${s.porta}`;
  const nav = await abrirNavegador({ permitidos: [hp], timeoutMs: 15000 });
  try {
    const r = await lerPagina(s.url, { nav, permitidos: [hp], mobile: false });
    assert.deepEqual(r.erros, []);
    assert.equal(r.mobile, undefined);
    assert.equal(r.final.estilos.versao, 1);
    assert.equal(r.final.estilos.contraste.falhas, 3);
  } finally {
    await nav.fechar();
    await s.fechar();
  }
});
