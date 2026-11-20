// Testes dos detectores de acessibilidade, interação/estados e responsividade (lib/deteccoes/a11y-interacao-resp.mjs).
// Parte 1: contrato e cobertura das 62 regras. Parte 2: cada detector com entrada sintética (positivo, negativo, nulo).
// Parte 3: fixtures reais (medidores de verdade) e integração: TODO achado gerado precisa ser APROVADO pelo verificador.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { executarMedidores, carregarRegras, rodarMotor } from '../lib/motor.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { criarAchado, validarAchado } from '../lib/achado.mjs';
import * as medCss from '../lib/medidores/css.mjs';
import * as medHtml from '../lib/medidores/html.mjs';
import { detectores } from '../lib/deteccoes/a11y-interacao-resp.mjs';

const CATEGORIAS = ['acessibilidade', 'interacao-estados', 'responsividade'];
const REGRAS = carregarRegras({ modo: 'completo' }).filter((r) => CATEGORIAS.includes(r.categoria));
const POR_ID = Object.fromEntries(REGRAS.map((r) => [r.id, r]));

const SEM_MEDICAO = [
  'a11y-contraste-componentes-ui', 'int-foco-invisivel-no-teclado', 'int-contraste-do-anel-de-foco', 'int-foco-coberto-por-elemento-fixo',
  'int-hover-sem-efeito', 'int-controle-pula-ao-focar', 'resp-conteudo-cortado-por-overflow', 'resp-campo-com-fonte-menor-que-16',
  'resp-menu-transborda-no-celular', 'resp-texto-colado-na-borda', 'resp-conteudo-sem-limite-em-tela-ultralarga', 'resp-espacamento-de-texto-corta-conteudo',
];

// ---------- ajudantes ----------
const URL0 = 'http://site.test/';
function ctxDe(html, extra = {}, { ativos = [], pagina = {} } = {}) {
  const extr = { url: URL0, nos: [], links: [], imagens: [], headings: [], formularios: [], scripts: [], estilosInline: [], jsonld: [], ...extra };
  return { site: { urlInicial: URL0, modo: 'rapido' }, paginas: [{ url: URL0, cru: { html, extr, status: 200 }, final: { html, extr }, ...pagina }], ativos };
}
const docDe = (corpo) => `<!DOCTYPE html><html><head></head><body>${corpo}</body></html>`;
const axeMed = (violacoes, extra = {}) => ({ axe: { id: 'axe', dados: { porPagina: [{ url: URL0, violacoes, incompletos: [], ignoradasPorClone: [], ...extra }] } } });
const viol = (id, nos, op = {}) => ({ id, impacto: 'serious', ajuda: 'x', nosTotal: nos.length, nosIgnoradosPorClone: 0, nos: nos.map((h) => ({ seletor: 'alvo', html: h, resumoDeFalha: '' })), ...op });
function gerar(id, ctx, med) {
  const r = detectores[id]({ ctx, med, regra: POR_ID[id] });
  if (r === null) return { r, achados: [] };
  return { r, achados: (r.achados || []).map((a) => criarAchado(POR_ID[id], a)) };
}
function aprovados(achados, ctx) {
  const v = verificarAchados(achados, ctx);
  assert.deepEqual(v.descartados, [], JSON.stringify(v.descartados));
  return v.aprovados;
}
const cssComMedidor = async (ctx) => ({ css: await medCss.medir(ctx) });
const comCss = (corpo, css) => ctxDe(docDe(corpo), {}, { ativos: [{ tipo: 'css', url: URL0 + 'a.css', texto: css, hash: String(css.length) + css.slice(0, 8) }] });

// ---------------------------------------------------------------------------------------------------------------------
// 1. contrato e cobertura
// ---------------------------------------------------------------------------------------------------------------------
test('cobertura: as 62 regras de script/misto das três categorias têm detector (função)', () => {
  assert.equal(REGRAS.length, 62);
  assert.equal(REGRAS.filter((r) => r.categoria === 'acessibilidade').length, 29);
  assert.equal(REGRAS.filter((r) => r.categoria === 'interacao-estados').length, 18);
  assert.equal(REGRAS.filter((r) => r.categoria === 'responsividade').length, 15);
  for (const r of REGRAS) {
    assert.ok(['script', 'misto'].includes(r.deteccao.tipo), r.id);
    assert.equal(typeof detectores[r.id], 'function', `sem detector: ${r.id}`);
  }
});

test('cobertura: 12 regras sem medidor devolvem null (nunca "ok"), mesmo com todos os medidores presentes', async () => {
  const ctx = ctxDe(docDe('<p>oi</p>'));
  const med = { ...axeMed([]), ...(await cssComMedidor(ctx)) };
  for (const id of SEM_MEDICAO) {
    assert.equal(detectores[id]({ ctx, med, regra: POR_ID[id] }), null, id);
  }
  assert.equal(SEM_MEDICAO.length, 12);
});

test('contrato: sem medidor (med vazio), os detectores que dependem dele devolvem null e nenhum lança', () => {
  const ctxVazio = { site: { urlInicial: URL0 }, paginas: [], ativos: [] };
  for (const r of REGRAS) {
    const x = detectores[r.id]({ ctx: ctxVazio, med: {}, regra: r });
    assert.equal(x, null, `${r.id} deveria ser null sem medidores nem páginas`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. regras baseadas em axe (tabela): positivo, negativo, nulo, clones e suspeitos
// ---------------------------------------------------------------------------------------------------------------------
const AXE_CASOS = [
  ['a11y-imagem-sem-alt', 'image-alt', '<img src="a.png">', /^1 imagem sem texto alternativo \(alt\)\. Quem usa leitor de tela não fica sabendo o que ela mostra\.$/],
  ['a11y-botao-sem-nome', 'button-name', '<button class="x"></button>', /^1 botão sem nome acessível: o leitor de tela anuncia só "botão"/],
  ['a11y-link-sem-nome', 'link-name', '<a href="/x"></a>', /^1 link sem texto nem nome acessível: o leitor de tela não consegue dizer para onde ele leva\.$/],
  ['a11y-link-so-por-cor', 'link-in-text-block', '<a href="/y">veja</a>', /^1 link dentro de texto se distingue do texto ao redor só pela cor/],
  ['a11y-titulo-da-pagina-ausente', 'document-title', '<html>', /^1 página sem título \(title\) ou com o título vazio\./],
  ['a11y-campo-sem-rotulo', 'label', '<input type="text" name="q">', /^1 campo de formulário sem rótulo ligado a ele/],
  ['a11y-nome-acessivel-difere-do-texto', 'label-content-name-mismatch', '<a href="/z" aria-label="Outro">Comprar</a>', /^1 controle tem nome acessível que não inclui o texto que aparece na tela/],
  ['a11y-autocomplete-incorreto', 'autocomplete-valid', '<input autocomplete="foo" name="n">', /^1 campo tem um valor de autocomplete inválido/],
  ['a11y-sem-regiao-principal', 'landmark-one-main', '<html>', /^A página não tem uma única região principal \(main\)/],
  ['a11y-sem-forma-de-pular-o-menu', 'bypass', '<html>', /^Falta um jeito de pular o menu/],
  ['a11y-alvo-de-toque-pequeno', 'target-size', '<a href="/m" class="mini">x</a>', /^1 alvo de clique ou toque menor que 24 por 24 pixels/],
  ['a11y-video-sem-legenda', 'video-caption', '<video src="v.mp4"></video>', /^1 vídeo sem legenda\./],
  ['a11y-aria-uso-invalido', 'aria-roles', '<div role="foo"></div>', /^1 uso inválido de ARIA/],
  ['a11y-aria-hidden-em-elemento-focavel', 'aria-hidden-focus', '<div aria-hidden="true"><a href="/h">h</a></div>', /^1 elemento que recebe foco do teclado está dentro de uma área escondida/],
  ['a11y-componente-aria-sem-nome', 'aria-tab-name', '<div role="tab"></div>', /^1 componente interativo sem nome acessível/],
  ['a11y-iframe-sem-titulo', 'frame-title', '<iframe src="/f"></iframe>', /^1 quadro incorporado \(iframe\) sem título/],
  ['a11y-svg-ou-role-img-sem-nome', 'svg-img-alt', '<svg role="img"></svg>', /^1 imagem vetorial ou objeto sem nome acessível/],
  ['a11y-lista-ou-tabela-mal-estruturada', 'listitem', '<li>solto</li>', /^1 lista ou tabela mal montada/],
  ['a11y-espacamento-de-texto-travado', 'avoid-inline-spacing', '<p style="line-height:1 !important">t</p>', /^1 elemento trava o espaçamento do texto/],
];

for (const [id, axeId, no, re] of AXE_CASOS) {
  test(`${id}: dispara com a violação do axe, cita o nó e é aprovado pelo verificador`, () => {
    const ctx = ctxDe(docDe(no));
    const { r, achados } = gerar(id, ctx, axeMed([viol(axeId, [no])]));
    assert.equal(r.disparou, true);
    assert.equal(r.intensidade, 1);
    assert.equal(achados.length, 1);
    const a = achados[0];
    assert.match(a.mensagem, re);
    assert.equal(a.pagina, '/');
    assert.equal(a.severidade, POR_ID[id].severidade);
    assert.equal(a.selo, POR_ID[id].selo);
    assert.equal(a.evidencias[0].trecho, no);
    assert.equal(a.evidencias[0].valor, `${axeId} (serious)`);
    assert.ok(a.citacoes.some((c) => c.tipo === 'trecho' && c.onde === 'html' && c.versoes[0] === 'final'), 'cita o nó do axe');
    assert.equal(validarAchado(a).ok, true, JSON.stringify(validarAchado(a).erros));
    aprovados(achados, ctx);
  });

  test(`${id}: não dispara sem violação (nem com outra regra do axe) e devolve null sem axe`, () => {
    const ctx = ctxDe(docDe(no));
    assert.equal(gerar(id, ctx, axeMed([])).r.disparou, false);
    assert.equal(gerar(id, ctx, axeMed([viol('regra-que-nao-tem-nada-a-ver', ['<p>x</p>'])])).r.disparou, false);
    assert.equal(gerar(id, ctx, {}).r, null);
    assert.equal(gerar(id, ctx, { axe: { id: 'axe', dados: null, erro: 'falhou' } }).r, null);
    assert.equal(gerar(id, ctx, { axe: { id: 'axe', dados: { porPagina: [{ url: URL0, erro: 'tempo esgotado' }] } } }).r, null);
  });
}

test('axe: nós suspeitos de clone não contam (exceto em aria-hidden-focus, que conta clones de propósito)', () => {
  const no = '<img src="b.png">';
  const ctx = ctxDe(docDe(no));
  const med = axeMed([viol('image-alt', [no])]);
  med.axe.dados.porPagina[0].violacoes[0].nos[0].suspeitoDeClone = true;
  assert.equal(gerar('a11y-imagem-sem-alt', ctx, med).r.disparou, false);
  // aria-hidden-focus: o nó restante conta, e clones ignorados pelo medidor entram na conta
  const ctx2 = ctxDe(docDe('<div aria-hidden="true"><a href="/h">h</a></div>'));
  const med2 = axeMed([], { ignoradasPorClone: [{ id: 'aria-hidden-focus', nosIgnoradosPorClone: 2 }] });
  const { r, achados } = gerar('a11y-aria-hidden-em-elemento-focavel', ctx2, med2);
  assert.equal(r.disparou, true);
  assert.match(achados[0].mensagem, /^2 elementos que recebem foco do teclado estão dentro de uma área escondida do leitor de tela \(aria-hidden\), incluindo 2 dentro de cópias de carrossel\./);
  aprovados(achados, ctx2);
});

test('axe: vários nós e páginas viram UM achado agregado, com a contagem exata e a página mais afetada', () => {
  const nos = ['<img src="1.png">', '<img src="2.png">', '<img src="3.png">'];
  const ctx = ctxDe(docDe(nos.join('')));
  const med = { axe: { dados: { porPagina: [
    { url: URL0, violacoes: [viol('image-alt', nos)], incompletos: [], ignoradasPorClone: [] },
    { url: URL0 + 'outra', violacoes: [viol('image-alt', ['<img src="9.png">'])], incompletos: [], ignoradasPorClone: [] },
  ] } } };
  const { r, achados } = gerar('a11y-imagem-sem-alt', ctx, med);
  assert.equal(r.achados.length, 1);
  assert.equal(achados[0].mensagem, '4 imagens sem texto alternativo (alt) (em 2 páginas). Quem usa leitor de tela não fica sabendo o que elas mostram.');
  assert.equal(achados[0].pagina, '/');
  assert.deepEqual(achados[0].numeros_permitidos.slice(0, 2), [4, 2]);
  assert.equal(achados[0].citacoes.length, 3);
});

test('a11y-contraste-texto-baixo: usa a razão do axe, cita 4,5 e 3, e incompletos viram "não verificável" (nunca falha)', () => {
  const no = '<p class="claro">Texto fraco</p>';
  const ctx = ctxDe(docDe(no));
  const med = axeMed([viol('color-contrast', [no])], { incompletos: [{ id: 'color-contrast', nosTotal: 2 }] });
  med.axe.dados.porPagina[0].violacoes[0].nos[0].resumoDeFalha = 'Fix any of the following: Element has insufficient color contrast of 2.35 (foreground color: #aaaaaa, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1';
  const { r, achados } = gerar('a11y-contraste-texto-baixo', ctx, med);
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, '1 trecho de texto tem contraste abaixo do mínimo: o mínimo é 4,5 para 1 no texto normal e 3 para 1 no texto grande. O pior mede 2,35 para 1. Há também 2 trechos com fundo de imagem ou degradê que não deu para medir (não verificável).');
  assert.ok(achados[0].numeros_permitidos.includes(2.35));
  aprovados(achados, ctx);
  // só "incomplete": não é falha
  const soInc = axeMed([], { incompletos: [{ id: 'color-contrast', nosTotal: 3 }] });
  assert.equal(gerar('a11y-contraste-texto-baixo', ctx, soInc).r.disparou, false);
});

test('a11y-titulos-vazios-ou-fora-de-ordem: separa títulos que pulam nível dos vazios', () => {
  const nos = ['<h4>Salto</h4>', '<h2></h2>'];
  const ctx = ctxDe(docDe(nos.join('')));
  const med = axeMed([viol('heading-order', [nos[0]], { impacto: 'moderate' }), viol('empty-heading', [nos[1]])]);
  const { r, achados } = gerar('a11y-titulos-vazios-ou-fora-de-ordem', ctx, med);
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'Estrutura de títulos com problema: 1 título pula nível (por exemplo de h2 direto para h4) e 1 título está vazio. Quem usa leitor de tela navega pelos títulos e se perde.');
  aprovados(achados, ctx);
  assert.equal(gerar('a11y-titulos-vazios-ou-fora-de-ordem', ctx, axeMed([])).r.disparou, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// idioma, zoom, meta viewport (axe + medidor html)
// ---------------------------------------------------------------------------------------------------------------------
async function medHtmlDe(cru, final, { viewportCru = null, viewportFinal = null, langCru = null, langFinal = null } = {}) {
  const base = { nos: [], links: [], imagens: [], headings: [], formularios: [], metas: [], linksHead: [], scripts: [], estilosInline: [], titulo: 'T', jsonld: [] };
  const ctx = {
    site: { urlInicial: URL0 }, ativos: [],
    paginas: [{
      url: URL0, cru: { html: cru, status: 200, extr: { ...base, viewportMeta: viewportCru, lang: langCru } },
      final: { html: final, extr: { ...base, viewportMeta: viewportFinal, lang: langFinal } },
    }],
  };
  return { ctx, med: { html: await medHtml.medir(ctx) } };
}

test('a11y-idioma-da-pagina: axe + lang do HTML cru diferente do DOM final', async () => {
  const no = '<html>';
  const { ctx, med } = await medHtmlDe('<html lang="pt-BR"><head></head><body></body></html>', '<html lang="en"><head></head><body></body></html>', { langCru: 'pt-BR', langFinal: 'en' });
  // só a comparação (axe sem violações)
  const m1 = { ...med, ...axeMed([]) };
  const r1 = gerar('a11y-idioma-da-pagina', ctx, m1);
  assert.equal(r1.r.disparou, true);
  assert.equal(r1.achados[0].mensagem, 'O idioma do HTML original (pt-BR) é diferente do idioma depois que o JavaScript roda (en). O leitor de tela escolhe a voz pelo idioma da página e lê com sotaque errado.');
  aprovados(r1.achados, ctx);
  // axe sem lang
  const ctx2 = ctxDe(docDe(''));
  const r2 = gerar('a11y-idioma-da-pagina', ctx2, axeMed([viol('html-has-lang', [no])]));
  assert.equal(r2.r.disparou, true);
  assert.match(r2.achados[0].mensagem, /^1 problema de idioma apontado pelo verificador/);
  aprovados(r2.achados, ctx2);
  // igual nas duas versões e sem violação: não dispara
  const igual = await medHtmlDe('<html lang="pt-BR"></html>', '<html lang="pt-BR"></html>', { langCru: 'pt-BR', langFinal: 'pt-BR' });
  assert.equal(gerar('a11y-idioma-da-pagina', igual.ctx, { ...igual.med, ...axeMed([]) }).r.disparou, false);
  assert.equal(gerar('a11y-idioma-da-pagina', ctx2, {}).r, null);
});

test('a11y-zoom-bloqueado e resp-zoom-bloqueado: user-scalable=no e maximum-scale baixo, cru e final', async () => {
  const meta = (c) => `<meta name="viewport" content="${c}">`;
  const bloqueado = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
  const html = (c) => `<!DOCTYPE html><html><head>${meta(c)}</head><body></body></html>`;
  const { ctx, med } = await medHtmlDe(html(bloqueado), html(bloqueado), { viewportCru: bloqueado, viewportFinal: bloqueado });
  const a = gerar('a11y-zoom-bloqueado', ctx, { ...med, ...axeMed([]) });
  assert.equal(a.r.disparou, true);
  assert.equal(a.achados[0].mensagem, 'A meta viewport (maximum-scale=1 e user-scalable=no) bloqueia ou limita o zoom. Quem enxerga pouco precisa ampliar a página no celular e não consegue.');
  assert.deepEqual(a.achados[0].citacoes[0].versoes, ['cru', 'final']);
  aprovados(a.achados, ctx);
  const b = gerar('resp-zoom-bloqueado', ctx, med);
  assert.equal(b.r.disparou, true);
  assert.equal(b.achados[0].mensagem, 'A meta viewport trava o zoom (user-scalable=no e maximum-scale=1). Quem enxerga pouco precisa ampliar a página no celular e não consegue.');
  aprovados(b.achados, ctx);
  // maximum-scale=1.5 (< 2) também trava; 2 não
  const m15 = 'width=device-width, maximum-scale=1.5';
  const x = await medHtmlDe(html(m15), html(m15), { viewportCru: m15, viewportFinal: m15 });
  assert.equal(gerar('resp-zoom-bloqueado', x.ctx, x.med).r.disparou, true);
  const m2 = 'width=device-width, initial-scale=1, maximum-scale=2';
  const y = await medHtmlDe(html(m2), html(m2), { viewportCru: m2, viewportFinal: m2 });
  assert.equal(gerar('resp-zoom-bloqueado', y.ctx, y.med).r.disparou, false);
  assert.equal(gerar('a11y-zoom-bloqueado', y.ctx, { ...y.med, ...axeMed([]) }).r.disparou, false);
  // só o axe (sem medidor html)
  const noMeta = meta(bloqueado);
  const c3 = ctxDe(html(bloqueado));
  const z = gerar('a11y-zoom-bloqueado', c3, axeMed([viol('meta-viewport', [noMeta])]));
  assert.equal(z.r.disparou, true);
  aprovados(z.achados, c3);
  assert.equal(gerar('resp-zoom-bloqueado', c3, {}).r, null);
  assert.equal(gerar('a11y-zoom-bloqueado', c3, {}).r, null);
});

test('resp-sem-meta-viewport: ausente ou sem width=device-width; cita o HTML; null sem medidor html', async () => {
  const sem = '<!DOCTYPE html><html><head><title>T</title></head><body></body></html>';
  const a = await medHtmlDe(sem, sem);
  const r = gerar('resp-sem-meta-viewport', a.ctx, a.med);
  assert.equal(r.r.disparou, true);
  assert.equal(r.achados[0].mensagem, 'A página não tem a meta viewport com width=device-width. No celular ela aparece como a versão de computador encolhida, com texto miúdo.');
  assert.equal(r.achados[0].selo, 'fato');
  assert.ok(r.achados[0].citacoes.length >= 1);
  aprovados(r.achados, a.ctx);
  const incompleta = '<!DOCTYPE html><html><head><meta name="viewport" content="initial-scale=1"></head><body></body></html>';
  const b = await medHtmlDe(incompleta, incompleta, { viewportCru: 'initial-scale=1', viewportFinal: 'initial-scale=1' });
  const rb = gerar('resp-sem-meta-viewport', b.ctx, b.med);
  assert.equal(rb.r.disparou, true);
  assert.equal(rb.achados[0].mensagem, 'A meta viewport existe, mas não tem width=device-width (valor atual: "initial-scale=1"). No celular a página aparece encolhida, com texto miúdo.');
  aprovados(rb.achados, b.ctx);
  const boa = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';
  const c = await medHtmlDe(boa, boa, { viewportCru: 'width=device-width, initial-scale=1', viewportFinal: 'width=device-width, initial-scale=1' });
  assert.equal(gerar('resp-sem-meta-viewport', c.ctx, c.med).r.disparou, false);
  assert.equal(gerar('resp-sem-meta-viewport', c.ctx, {}).r, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// links com o mesmo texto (medidor links)
// ---------------------------------------------------------------------------------------------------------------------
test('a11y-link-texto-repetido-sem-contexto: entrada sintética do medidor links (positivo, negativo, nulo)', () => {
  const html = docDe('<ul><li>A <a href="/a">R$ 34,90</a></li><li>B <a href="/b">R$ 34,90</a></li></ul>');
  const ctx = ctxDe(html, { links: [
    { seletor: 'a1', texto: 'R$ 34,90', visivel: true, clone: false },
    { seletor: 'a2', texto: 'R$ 34,90', visivel: true, clone: false },
  ] });
  const grupo = { pagina: '/', texto: 'R$ 34,90', textoNormalizado: 'r$ 34,90', contagem: 2, hrefs: [URL0 + 'a', URL0 + 'b'], hrefsDistintos: 2, mesmoDestino: false, seletores: ['a1', 'a2'], contextos: ['A R$ 34,90', 'B R$ 34,90'], contextoDistinto: true, diferenciador: { ariaLabel: '', ariaLabelledby: '', title: '' } };
  const med = { links: { dados: { textoRepetidoSemContexto: [grupo] } } };
  const { r, achados } = gerar('a11y-link-texto-repetido-sem-contexto', ctx, med);
  assert.equal(r.disparou, true);
  assert.equal(achados.length, 1);
  assert.ok(achados[0].mensagem.startsWith('Para quem usa leitor de tela, a lista de links da página repete o mesmo texto: 2 links dizem só "R$ 34,90"'));
  assert.deepEqual(achados[0].citacoes.filter((c) => c.tipo === 'contagem')[0].contagem, { fn: 'links-com-texto', texto: 'R$ 34,90', esperado: 2 });
  assert.equal(achados[0].citacoes.filter((c) => c.tipo === 'trecho' && c.onde === 'html').length, 2);
  aprovados(achados, ctx);
  // mesmo destino
  const g2 = { ...grupo, mesmoDestino: true, hrefsDistintos: 1, contextoDistinto: false };
  const r2 = gerar('a11y-link-texto-repetido-sem-contexto', ctx, { links: { dados: { textoRepetidoSemContexto: [g2] } } });
  assert.match(r2.achados[0].mensagem, /dizem só "R\$ 34,90", sem aria-label nem outro nome que os diferencie, e todos levam ao mesmo lugar\. Quem navega/);
  assert.doesNotMatch(r2.achados[0].mensagem, /texto ao redor/);
  // negativo e nulo
  assert.equal(gerar('a11y-link-texto-repetido-sem-contexto', ctx, { links: { dados: { textoRepetidoSemContexto: [] } } }).r.disparou, false);
  assert.equal(gerar('a11y-link-texto-repetido-sem-contexto', ctx, {}).r, null);
  assert.equal(gerar('a11y-link-texto-repetido-sem-contexto', ctx, { links: { erro: 'x', dados: null } }).r, null);
});

test('a11y-link-texto-repetido-sem-contexto: se o total na página difere do grupo, não cita a contagem (só trechos)', () => {
  const html = docDe('<a href="/a">Ver</a><a href="/b">Ver</a><a href="/c" aria-label="Ver três">Ver</a>');
  const ctx = ctxDe(html, { links: ['a', 'b', 'c'].map((x) => ({ seletor: x, texto: 'Ver', visivel: true, clone: false })) });
  const grupo = { pagina: '/', texto: 'Ver', textoNormalizado: 'ver', contagem: 2, hrefs: [URL0 + 'a', URL0 + 'b'], hrefsDistintos: 2, mesmoDestino: false, seletores: ['a', 'b'], contextos: ['', ''], contextoDistinto: false, diferenciador: { ariaLabel: '', ariaLabelledby: '', title: '' } };
  const { achados } = gerar('a11y-link-texto-repetido-sem-contexto', ctx, { links: { dados: { textoRepetidoSemContexto: [grupo] } } });
  assert.equal(achados[0].citacoes.filter((c) => c.tipo === 'contagem').length, 0);
  aprovados(achados, ctx);
});

// ---------------------------------------------------------------------------------------------------------------------
// movimento automático
// ---------------------------------------------------------------------------------------------------------------------
test('a11y-movimento-automatico-sem-pausa: vídeo com autoplay sem muted (HTML) + regras do axe', () => {
  const v = '<video autoplay src="v.mp4"></video>';
  const ctx = ctxDe(docDe(v));
  const r = gerar('a11y-movimento-automatico-sem-pausa', ctx, axeMed([]));
  assert.equal(r.r.disparou, true);
  assert.match(r.achados[0].mensagem, /^1 vídeo ou áudio começa sozinho e sem estar mudo\. Quem se distrai com movimento/);
  aprovados(r.achados, ctx);
  const mudo = ctxDe(docDe('<video autoplay muted loop src="v.mp4"></video>'));
  assert.equal(gerar('a11y-movimento-automatico-sem-pausa', mudo, axeMed([])).r.disparou, false);
  // só o axe (marquee)
  const m = '<marquee>oi</marquee>';
  const c2 = ctxDe(docDe(m));
  const r2 = gerar('a11y-movimento-automatico-sem-pausa', c2, axeMed([viol('marquee', [m])]));
  assert.match(r2.achados[0].mensagem, /^1 elemento com movimento ou som automático apontado pelo verificador/);
  aprovados(r2.achados, c2);
  // sem axe e sem mídia: não avaliável
  assert.equal(gerar('a11y-movimento-automatico-sem-pausa', mudo, {}).r, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// CSS estático (medidor css real sobre ctx sintético)
// ---------------------------------------------------------------------------------------------------------------------
test('a11y-foco-do-teclado-invisivel e int-contorno-de-foco-removido: outline removido sem substituto', async () => {
  const ctx = comCss('<a href="/a">x</a>', 'a:focus { outline: none; }\nbody { color: #111; }');
  const med = await cssComMedidor(ctx);
  const a = gerar('a11y-foco-do-teclado-invisivel', ctx, med);
  assert.equal(a.r.disparou, true);
  assert.equal(a.achados[0].mensagem, 'O CSS tira o contorno de foco (1 regra, por exemplo a:focus) sem colocar outro sinal visível no lugar. Quem navega pelo teclado perde a noção de onde está. (Só o CSS foi examinado; a navegação por Tab não foi testada.)');
  assert.ok(a.achados[0].citacoes.some((c) => c.onde === 'css' && /outline/.test(c.valor)));
  aprovados(a.achados, ctx);
  const b = gerar('int-contorno-de-foco-removido', ctx, med);
  assert.equal(b.r.disparou, true);
  assert.match(b.achados[0].mensagem, /^O CSS remove o contorno de foco \(1 regra, por exemplo a:focus\)/);
  assert.doesNotMatch(b.achados[0].mensagem, /nenhuma regra :focus/);
  aprovados(b.achados, ctx);
  // com substituto: nenhum dos dois
  const ok = comCss('<a href="/a">x</a>', 'a:focus { outline: none; box-shadow: 0 0 0 3px #36c; }');
  const medOk = await cssComMedidor(ok);
  assert.equal(gerar('a11y-foco-do-teclado-invisivel', ok, medOk).r.disparou, false);
  assert.equal(gerar('int-contorno-de-foco-removido', ok, medOk).r.disparou, false);
  assert.equal(gerar('a11y-foco-do-teclado-invisivel', ok, {}).r, null);
  assert.equal(gerar('int-contorno-de-foco-removido', ok, {}).r, null);
});

test('int-contorno-de-foco-removido: CSS sem nenhuma regra de foco dispara; CSS com :focus-visible não; sem CSS não dispara', async () => {
  const semFoco = comCss('<a href="/a">x</a>', 'p { color: #111; }');
  const r = gerar('int-contorno-de-foco-removido', semFoco, await cssComMedidor(semFoco));
  assert.equal(r.r.disparou, true);
  assert.equal(r.achados[0].mensagem, 'O CSS inteiro não tem nenhuma regra :focus nem :focus-visible, então ninguém desenhou o foco do teclado. Quem navega pelo teclado precisa ver onde está o foco.');
  aprovados(r.achados, semFoco);
  const comFoco = comCss('<a href="/a">x</a>', 'a:focus-visible { outline: 2px solid #36c; }');
  assert.equal(gerar('int-contorno-de-foco-removido', comFoco, await cssComMedidor(comFoco)).r.disparou, false);
  const semCss = ctxDe(docDe('<a href="/a">x</a>'));
  assert.equal(gerar('int-contorno-de-foco-removido', semCss, await cssComMedidor(semCss)).r.disparou, false);
});

test('a11y-animacao-sem-reduced-motion: movimento sem @media (prefers-reduced-motion); opinião cita trecho do CSS', async () => {
  const css = '@keyframes gira { to { transform: rotate(360deg); } }\n.x { animation: gira 2s infinite; }\n.y { transition: color 0.2s; }';
  const ctx = comCss('<p class="x">oi</p>', css);
  const { r, achados } = gerar('a11y-animacao-sem-reduced-motion', ctx, await cssComMedidor(ctx));
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'O CSS tem 1 @keyframes, 1 animação e 1 transição, mas nenhum bloco @media (prefers-reduced-motion: reduce) para desligar ou reduzir o movimento. Quem sente enjoo ou tontura com animação não tem como pedir menos movimento.');
  assert.equal(achados[0].selo, 'opiniao');
  assert.ok(achados[0].citacoes.some((c) => c.tipo === 'trecho' && c.onde === 'css'));
  aprovados(achados, ctx);
  const com = comCss('<p class="x">oi</p>', css + '\n@media (prefers-reduced-motion: reduce) { .x { animation: none; } }');
  assert.equal(gerar('a11y-animacao-sem-reduced-motion', com, await cssComMedidor(com)).r.disparou, false);
  const parado = comCss('<p>oi</p>', 'p { color: red; }');
  assert.equal(gerar('a11y-animacao-sem-reduced-motion', parado, await cssComMedidor(parado)).r.disparou, false);
  assert.equal(gerar('a11y-animacao-sem-reduced-motion', parado, {}).r, null);
});

test('int-micro-estados-ausentes: 2 ou mais grupos presentes sem hover/foco/ativo; intensidade = grupos sem estado / presentes', async () => {
  const corpo = '<button>a</button><a href="/x">b</a><input type="text" name="q">';
  const ctx = comCss(corpo, 'input:hover { color: red; } input:focus { color: red; } input:active { color: red; }');
  const { r, achados } = gerar('int-micro-estados-ausentes', ctx, await cssComMedidor(ctx));
  assert.equal(r.disparou, true);
  assert.equal(Number(r.intensidade.toFixed(4)), 0.6667);
  assert.equal(achados[0].mensagem, 'No CSS, 2 grupos de elementos não têm nenhum estado definido (nem hover, nem foco, nem ativo): botões, links. A pessoa clica ou passa o mouse e não recebe resposta visual.');
  assert.equal(achados[0].selo, 'opiniao');
  aprovados(achados, ctx);
  // um grupo só sem estado: não dispara
  const um = comCss(corpo, 'a:hover { color: red; } a:active { color: red; } input:hover { color: red; }');
  assert.equal(gerar('int-micro-estados-ausentes', um, await cssComMedidor(um)).r.disparou, false);
  // só existe um grupo na página: não dispara
  const so = comCss('<button>a</button>', 'p { color: red; }');
  assert.equal(gerar('int-micro-estados-ausentes', so, await cssComMedidor(so)).r.disparou, false);
  assert.equal(gerar('int-micro-estados-ausentes', ctx, {}).r, null);
});

test('int-anel-de-foco-com-fade: transição na mesma propriedade do :focus-visible', async () => {
  const css = '.btn { transition: box-shadow 0.3s ease; }\n.btn:focus-visible { box-shadow: 0 0 0 3px #36c; }';
  const ctx = comCss('<button class="btn">x</button>', css);
  const { r, achados } = gerar('int-anel-de-foco-com-fade', ctx, await cssComMedidor(ctx));
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'O anel de foco aparece com transição (fade): 1 seletor com transição na mesma propriedade que o :focus-visible usa, como .btn. Quem navega pelo teclado vê o foco chegar atrasado.');
  assert.ok(achados[0].citacoes.some((c) => c.onde === 'css' && /transition/.test(c.valor)));
  aprovados(achados, ctx);
  const outra = comCss('<button class="btn">x</button>', '.btn { transition: color 0.3s ease; }\n.btn:focus-visible { box-shadow: 0 0 0 3px #36c; }');
  assert.equal(gerar('int-anel-de-foco-com-fade', outra, await cssComMedidor(outra)).r.disparou, false);
  const zero = comCss('<button class="btn">x</button>', '.btn { transition: box-shadow 0s; }\n.btn:focus-visible { box-shadow: 0 0 0 3px #36c; }');
  assert.equal(gerar('int-anel-de-foco-com-fade', zero, await cssComMedidor(zero)).r.disparou, false);
  assert.equal(gerar('int-anel-de-foco-com-fade', ctx, {}).r, null);
});

test('int-menu-so-com-hover: :hover revela filho sem :focus-within nem aria-expanded', async () => {
  const css = '.sub { display: none; }\n.menu li:hover > .sub { display: block; }';
  const ctx = comCss('<ul class="menu"><li>a<ul class="sub"><li>b</li></ul></li></ul>', css);
  const { r, achados } = gerar('int-menu-so-com-hover', ctx, await cssComMedidor(ctx));
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'O CSS revela conteúdo só quando o mouse passa por cima (1 regra, por exemplo .menu li:hover > .sub), e não há regra equivalente com :focus-within, aria-expanded ou classe de aberto para o teclado ou o toque. Quem usa só o teclado pode não alcançar esse conteúdo.');
  aprovados(achados, ctx);
  const com = comCss('<ul class="menu"></ul>', css + '\n.menu li:focus-within > .sub { display: block; }');
  assert.equal(gerar('int-menu-so-com-hover', com, await cssComMedidor(com)).r.disparou, false);
  const cor = comCss('<ul class="menu"></ul>', 'a:hover { color: red; }');
  assert.equal(gerar('int-menu-so-com-hover', cor, await cssComMedidor(cor)).r.disparou, false);
  assert.equal(gerar('int-menu-so-com-hover', ctx, {}).r, null);
});

test('int-desabilitado-so-por-opacidade: só opacity, sem cursor not-allowed nem cor', async () => {
  const ctx = comCss('<button disabled>x</button>', 'button:disabled { opacity: 0.5; }');
  const { r, achados } = gerar('int-desabilitado-so-por-opacidade', ctx, await cssComMedidor(ctx));
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'O estado desabilitado usa só a opacidade (1 seletor, por exemplo button:disabled): não há cursor not-allowed nem mudança de cor ou fundo. Quem enxerga pouco, ou vê a tela com brilho alto, pode não notar que o controle está desligado.');
  assert.equal(achados[0].selo, 'opiniao');
  aprovados(achados, ctx);
  const cursor = comCss('<button disabled>x</button>', 'button:disabled { opacity: 0.5; cursor: not-allowed; }');
  assert.equal(gerar('int-desabilitado-so-por-opacidade', cursor, await cssComMedidor(cursor)).r.disparou, false);
  const cor = comCss('<button disabled>x</button>', 'button:disabled { opacity: 0.5; background: #ccc; }');
  assert.equal(gerar('int-desabilitado-so-por-opacidade', cor, await cssComMedidor(cor)).r.disparou, false);
  assert.equal(gerar('int-desabilitado-so-por-opacidade', ctx, {}).r, null);
});

test('resp-altura-em-vh: abertura em vh sem dvh/svh no mesmo seletor (fato, cita o CSS)', async () => {
  const hero = { seletor: 'body>header', tag: 'header', classe: 'hero', textAlign: 'start', alturaPx: 900, temH1: true, topoPx: 0 };
  const monta = async (css, comHero = true) => {
    const ctx = comCss('<header class="hero"><h1>Oi</h1></header>', css);
    const med = await cssComMedidor(ctx);
    if (comHero) med.css.dados.paginas[0].computado = { layout: { heroes: [hero] } };
    return { ctx, med };
  };
  const a = await monta('.hero { min-height: 100vh; }');
  const r = gerar('resp-altura-em-vh', a.ctx, a.med);
  assert.equal(r.r.disparou, true);
  assert.equal(r.achados[0].mensagem, 'A altura da abertura da página usa vh (min-height: 100vh em .hero) sem a versão dvh ou svh no mesmo seletor. No celular, a barra do navegador faz a abertura passar da área realmente visível.');
  assert.equal(r.achados[0].selo, 'fato');
  assert.ok(r.achados[0].citacoes.length >= 1);
  aprovados(r.achados, a.ctx);
  const b = await monta('.hero { min-height: 100vh; min-height: 100dvh; }');
  assert.equal(gerar('resp-altura-em-vh', b.ctx, b.med).r.disparou, false);
  const c = await monta('.outro { min-height: 100vh; }');
  assert.equal(gerar('resp-altura-em-vh', c.ctx, c.med).r.disparou, false);
  const d = await monta('.hero { min-height: 100vh; }', false);
  assert.equal(gerar('resp-altura-em-vh', d.ctx, d.med).r, null, 'sem abertura detectada: não aplicável');
  assert.equal(gerar('resp-altura-em-vh', a.ctx, {}).r, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// HTML: formulários, links falsos, cliques, avisos, carrossel, JS
// ---------------------------------------------------------------------------------------------------------------------
test('int-placeholder-no-lugar-do-rotulo: só placeholder (opinião); com label, aria-label ou title não conta', () => {
  const ruim = '<form><input type="text" name="nome" placeholder="Seu nome"><input type="email" name="e" placeholder="E-mail"></form>';
  const ctx = ctxDe(docDe(ruim));
  const { r, achados } = gerar('int-placeholder-no-lugar-do-rotulo', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(r.intensidade, 1);
  assert.equal(achados[0].mensagem, '2 campos têm só o texto de exemplo (placeholder) no lugar do rótulo, sem label, aria-label nem título. O exemplo some assim que a pessoa começa a digitar, e quem usa leitor de tela fica sem saber o que preencher.');
  assert.ok(achados[0].citacoes.some((c) => c.tipo === 'trecho' && c.onde === 'html'));
  aprovados(achados, ctx);
  const bom = '<form><label for="n">Nome</label><input id="n" type="text" placeholder="Maria"><input type="text" aria-label="Cidade" placeholder="Recife"><label>CPF <input type="text" placeholder="000"></label><input type="text" title="Bairro" placeholder="Centro"></form>';
  assert.equal(gerar('int-placeholder-no-lugar-do-rotulo', ctxDe(docDe(bom)), {}).r.disparou, false);
  const meio = ctxDe(docDe('<form><input type="text" name="a" placeholder="x"><label for="b">B</label><input id="b" type="text" placeholder="y"></form>'));
  assert.equal(gerar('int-placeholder-no-lugar-do-rotulo', meio, {}).r.intensidade, 0.5);
  assert.equal(gerar('int-placeholder-no-lugar-do-rotulo', { paginas: [], ativos: [] }, {}).r, null);
});

test('int-campo-sem-tipo-ou-autocomplete: e-mail/telefone com type text e dado pessoal sem autocomplete', () => {
  const html = docDe('<form><input type="text" name="email"><input type="tel" name="telefone" autocomplete="tel"><input type="text" name="cep"><input type="email" name="email2" autocomplete="email"><input type="text" name="cidade_x"></form>');
  const ctx = ctxDe(html);
  const { r, achados } = gerar('int-campo-sem-tipo-ou-autocomplete', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, '1 campo de e-mail ou telefone com type de texto comum e 2 campos de dado pessoal sem autocomplete. Sem o type e o autocomplete certos, o celular não abre o teclado adequado e o navegador não preenche os dados sozinho.');
  // 4 campos de dado pessoal (email, telefone, cep, email2); 2 com problema (email e cep): 2/4
  assert.equal(r.intensidade, 0.5);
  aprovados(achados, ctx);
  const certo = ctxDe(docDe('<form><input type="email" name="email" autocomplete="email"><input type="tel" name="telefone" autocomplete="tel"><input type="text" name="nome" autocomplete="name"></form>'));
  assert.equal(gerar('int-campo-sem-tipo-ou-autocomplete', certo, {}).r.disparou, false);
  // "username" e "hotel" não são nome nem telefone
  const quase = ctxDe(docDe('<form><input type="text" name="username"><input type="text" name="hotel"></form>'));
  assert.equal(gerar('int-campo-sem-tipo-ou-autocomplete', quase, {}).r.disparou, false);
});

test('int-link-falso: href="#", vazio, javascript: e <a> sem href; exceções: voltar ao topo e #id', () => {
  const html = docDe('<a href="#">Fazer pedido</a><a href="">Vazio</a><a href="javascript:void(0)">Abrir</a><a onclick="x()">Sair</a><a href="#">Voltar ao topo</a><a href="#sobre">Sobre</a>');
  const link = (texto, hrefAttr) => ({ seletor: 'a', texto, hrefAttr, href: URL0 + (hrefAttr || ''), visivel: true, clone: false });
  const ctx = ctxDe(html, { links: [link('Fazer pedido', '#'), link('Vazio', ''), link('Abrir', 'javascript:void(0)'), link('Voltar ao topo', '#'), link('Sobre', '#sobre')] });
  const { r, achados } = gerar('int-link-falso', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].selo, 'fato');
  assert.equal(achados[0].mensagem, '4 links fingem ser links mas não levam a lugar nenhum (1 com href="#", 1 com href vazio, 1 com href="javascript:", 1 sem href). Para quem usa leitor de tela, são anunciados como link e o clique não vai a lugar nenhum; se for uma ação, deveria ser um botão.');
  assert.ok(achados[0].citacoes.length >= 1);
  aprovados(achados, ctx);
  // clone e oculto não contam
  const so = ctxDe(docDe('<a href="#">x</a>'), { links: [{ ...link('x', '#'), clone: true }, { ...link('y', '#'), visivel: false }] });
  assert.equal(gerar('int-link-falso', so, {}).r.disparou, false);
  assert.equal(gerar('int-link-falso', { paginas: [] }, {}).r, null);
});

test('a11y-clique-sem-teclado e int-clicavel-sem-semantica: onclick em elemento que não é botão/link', () => {
  const html = docDe('<div onclick="a()">Abrir</div><span onclick="b()" role="button" tabindex="0">Ok</span><li onclick="c()">Item</li><div role="button" onclick="d()">So role</div><button onclick="e()">Certo</button><a href="/x" onclick="f()">Link</a><p onclick="g()"><a href="/y">dentro</a></p>');
  const ctx = ctxDe(html);
  const a = gerar('a11y-clique-sem-teclado', ctx, {});
  assert.equal(a.r.disparou, true);
  // div (sem nada) e li; o div com role=button conta como "tem role" (regra: sem role NEM tabindex); o p tem filho interativo
  assert.equal(a.achados[0].mensagem, '2 elementos respondem ao clique (atributo onclick) mas não são link nem botão, e não têm papel de controle nem tabindex. Quem usa só o teclado não consegue chegar a eles nem ativá-los. (Cliques ligados por JavaScript não foram lidos; só o atributo onclick.)');
  aprovados(a.achados, ctx);
  const b = gerar('int-clicavel-sem-semantica', ctx, {});
  assert.equal(b.r.disparou, true);
  // div, li e div role=button sem tabindex (role sem foco) e p (sem exceção de filho nesta regra) = 4
  assert.match(b.achados[0].mensagem, /^4 blocos clicáveis não são um botão nem um link/);
  aprovados(b.achados, ctx);
  const limpo = ctxDe(docDe('<button onclick="a()">ok</button><a href="/x" onclick="b()">ok</a><div tabindex="0" role="button" onclick="c()">ok</div>'));
  assert.equal(gerar('a11y-clique-sem-teclado', limpo, {}).r.disparou, false);
  assert.equal(gerar('int-clicavel-sem-semantica', limpo, {}).r.disparou, false);
  assert.equal(gerar('a11y-clique-sem-teclado', { paginas: [] }, {}).r, null);
});

test('int-aviso-sem-aria-live: contêiner de aviso vazio ou escondido sem role/aria-live', () => {
  const html = docDe('<div class="toast"></div><div id="erro-nome" hidden></div><div class="alert">Mensagem fixa visível</div><div class="snackbar" role="status"></div><div class="success-box" aria-live="polite"></div><div role="alert"><div class="error-text"></div></div>');
  const ctx = ctxDe(html);
  const { r, achados } = gerar('int-aviso-sem-aria-live', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, '2 contêineres de aviso (toast, alerta, erro ou sucesso) estão vazios ou escondidos e sem role="alert", role="status" nem aria-live. Quando a mensagem aparecer, o leitor de tela não vai anunciá-la.');
  aprovados(achados, ctx);
  const bom = ctxDe(docDe('<div class="toast" role="status"></div><div class="alert">visível</div>'));
  assert.equal(gerar('int-aviso-sem-aria-live', bom, {}).r.disparou, false);
});

test('int-carrossel-so-por-arraste: carrossel sem botões/marcadores focáveis; com controles não dispara', () => {
  const ruim = '<div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide">A</div><div class="swiper-slide">B</div></div></div>';
  const ctx = ctxDe(docDe(ruim));
  const { r, achados } = gerar('int-carrossel-so-por-arraste', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, '1 carrossel parece depender só do gesto de arrastar: não achei botão anterior/próximo nem marcadores que o teclado alcance dentro ou ao lado dele. Quem não consegue arrastar (teclado, leitor de tela, tremor nas mãos) fica sem ver os outros itens.');
  aprovados(achados, ctx);
  const bom = ctxDe(docDe('<div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide">A</div></div><button class="swiper-button-prev" aria-label="Anterior"></button><button class="swiper-button-next" aria-label="Próximo"></button></div>'));
  assert.equal(gerar('int-carrossel-so-por-arraste', bom, {}).r.disparou, false);
  const nenhum = ctxDe(docDe('<p>sem carrossel</p>'));
  assert.equal(gerar('int-carrossel-so-por-arraste', nenhum, {}).r.disparou, false);
});

test('int-formulario-sem-destino: action vazio/# sem nenhuma chamada de envio no JS; com fetch não dispara', () => {
  const html = docDe('<form><input name="a"></form>');
  const forms = [{ seletor: 'form', action: null, metodo: 'get', campos: [], textoAoRedor: 'Envie', visivel: true, clone: false }];
  const ctx = ctxDe(html, { formularios: forms });
  const { r, achados } = gerar('int-formulario-sem-destino', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, '1 formulário não tem destino (action vazio, "#" ou ausente) e não achei nenhuma chamada de envio (fetch, XMLHttpRequest, axios, sendBeacon ou serviço de formulário) no JavaScript carregado. Pode ser um formulário de enfeite que não envia nada.');
  assert.equal(achados[0].selo, 'opiniao');
  aprovados(achados, ctx);
  const comFetch = ctxDe(html, { formularios: forms, scripts: [{ src: null, inline: 'document.forms[0].onsubmit = function(){ fetch("/api", {method:"POST"}); }' }] });
  assert.equal(gerar('int-formulario-sem-destino', comFetch, {}).r.disparou, false);
  const comAction = ctxDe(docDe('<form action="/enviar"></form>'), { formularios: [{ ...forms[0], action: '/enviar' }] });
  assert.equal(gerar('int-formulario-sem-destino', comAction, {}).r.disparou, false);
  // script próprio que não foi baixado: o resultado vale, mas fica instável
  const instavel = ctxDe(html, { formularios: forms }, { ativos: [{ tipo: 'js', url: URL0 + 'app.js', texto: null, erro: 'status 500' }] });
  assert.equal(gerar('int-formulario-sem-destino', instavel, {}).achados[0].instavel, true);
});

test('int-bloqueia-colar: onpaste que cancela e addEventListener("paste") com preventDefault', () => {
  const html = docDe('<input type="password" onpaste="return false"><input type="text" onpaste="log()">');
  const ctx = ctxDe(html, { scripts: [{ src: null, inline: 'campo.addEventListener("paste", function (e) { e.preventDefault(); });' }] });
  const { r, achados } = gerar('int-bloqueia-colar', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'Há 2 bloqueios do evento de colar (paste), por atributo onpaste ou por script. Quem usa gerenciador de senhas, leitor de tela ou precisa colar um dado longo não consegue. (Não foi possível confirmar em quais campos o bloqueio vale.)');
  assert.equal(achados[0].selo, 'opiniao');
  aprovados(achados, ctx);
  const limpo = ctxDe(docDe('<input type="text" onpaste="log()">'), { scripts: [{ src: null, inline: 'campo.addEventListener("paste", function (e) { validar(e); });' }] });
  assert.equal(gerar('int-bloqueia-colar', limpo, {}).r.disparou, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// responsividade com leitura mobile
// ---------------------------------------------------------------------------------------------------------------------
function medMobile(estilos) {
  const es = {
    overflowHorizontal: { ativo: false, larguraDocumento: 390, larguraViewport: 390, larguraReferencia: 390, culpados: [] },
    alvosToque: { total: 0, abaixo24: 0, abaixo44: 0, abaixo24SemInline: 0, exemplos: [] },
    tipografia: { tamanhos: { abaixo12: { tamanhos: [], elementos: 0, exemplos: [] } }, lineHeightCorpo: { amostras: 0, medianaRazao: null, normal: 0 } },
    amostra: { comTexto: 10 },
    ...estilos,
  };
  return { css: { id: 'css', dados: { paginas: [{ url: URL0, computado: null, mobile: { overflowHorizontal: false, viewportMeta: 'width=device-width', estilos: es } }], site: { estatico: {} } } } };
}

test('resp-rolagem-horizontal: documento mais largo que a tela (tolerância de 1 px); lista os culpados', () => {
  const o = (larg) => ({ ativo: larg > 390, larguraDocumento: larg, larguraViewport: 390, larguraReferencia: 390, culpados: larg > 390 ? [{ seletor: 'body>div', direitaPx: larg }] : [] });
  const ctx = ctxDe(docDe('<div>x</div>'));
  const { r, achados } = gerar('resp-rolagem-horizontal', ctx, medMobile({ overflowHorizontal: o(500) }));
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, 'No celular a página fica mais larga que a tela: o conteúdo mede 500 px para uma tela de 390 px. Quem usa o celular precisa rolar para o lado. Os elementos que mais passam da borda são body>div (até 500 px).');
  assert.equal(achados[0].severidade, 'P1');
  aprovados(achados, ctx);
  assert.equal(gerar('resp-rolagem-horizontal', ctx, medMobile({ overflowHorizontal: o(391) })).r.disparou, false, '1 px de diferença é tolerado');
  assert.equal(gerar('resp-rolagem-horizontal', ctx, medMobile({ overflowHorizontal: o(392) })).r.disparou, true);
  assert.equal(gerar('resp-rolagem-horizontal', ctx, {}).r, null);
  assert.equal(gerar('resp-rolagem-horizontal', ctx, { css: { dados: { paginas: [{ url: URL0, mobile: null }] } } }).r, null);
});

test('resp-alvo-menor-que-24px e resp-alvo-menor-que-44px: contagens do medidor css (mobile)', () => {
  const ctx = ctxDe(docDe('<a href="/x">ir</a>'));
  const alvos = { total: 10, abaixo24: 3, abaixo24SemInline: 2, abaixo44: 8, exemplos: [{ seletor: 'a', tag: 'a', larguraPx: 16, alturaPx: 16, inline: false, texto: 'ir' }] };
  const a = gerar('resp-alvo-menor-que-24px', ctx, medMobile({ alvosToque: alvos }));
  assert.equal(a.r.disparou, true);
  assert.equal(a.r.intensidade, 0.2);
  assert.equal(a.achados[0].mensagem, 'No celular, 2 alvos de toque medem menos de 24 por 24 pixels (de 10 medidos, sem contar links dentro de frases). Fica difícil acertar com o dedo, principalmente para quem tem tremor ou dedos grandes. (A exceção de espaçamento da norma não foi medida.)');
  aprovados(a.achados, ctx);
  assert.equal(gerar('resp-alvo-menor-que-24px', ctx, medMobile({ alvosToque: { ...alvos, abaixo24SemInline: 0 } })).r.disparou, false);
  const b = gerar('resp-alvo-menor-que-44px', ctx, medMobile({ alvosToque: alvos }));
  assert.equal(b.r.disparou, true);
  assert.equal(b.r.intensidade, 5 / 7);
  assert.equal(b.achados[0].mensagem, 'No celular, 5 alvos de toque têm entre 24 e 44 pixels de lado: 71% dos 7 alvos que passam do mínimo de 24 pixels. O recomendado para botões e links principais é pelo menos 44 por 44 pixels.');
  aprovados(b.achados, ctx);
  // 30% exatos não passam ("mais de 30%"): 3 de 10 alvos acima de 24 (total 13, abaixo24 3, abaixo44 6)
  assert.equal(gerar('resp-alvo-menor-que-44px', ctx, medMobile({ alvosToque: { total: 13, abaixo24: 3, abaixo44: 6, abaixo24SemInline: 3, exemplos: [] } })).r.disparou, false);
  assert.equal(gerar('resp-alvo-menor-que-44px', ctx, { css: { dados: { paginas: [] } } }).r, null);
});

test('resp-texto-pequeno-no-celular: texto abaixo de 11 px e entrelinha mediana abaixo de 1,3 (opinião, cita o texto)', () => {
  const ctx = ctxDe(docDe('<p>Texto miúdo demais</p>'), { nos: [{ seletor: 'p', tag: 'p', texto: 'Texto miúdo demais', visivel: true, clone: false }] });
  const med = medMobile({ tipografia: { tamanhos: { abaixo12: { tamanhos: [9], elementos: 2, exemplos: [{ seletor: 'p', tamanhoPx: 9, texto: 'Texto miúdo demais' }] } }, lineHeightCorpo: { amostras: 4, medianaRazao: 1.1, normal: 0 } } });
  const { r, achados } = gerar('resp-texto-pequeno-no-celular', ctx, med);
  assert.equal(r.disparou, true);
  assert.equal(r.intensidade, 0.2);
  assert.equal(achados[0].mensagem, 'Há texto com menos de 11 px no celular (o menor mede 9 px, por exemplo "Texto miúdo demais"); a entrelinha mediana dos parágrafos é 1,1 vez o tamanho da letra, abaixo de 1,3. Texto miúdo ou apertado cansa a leitura numa tela pequena. (A mediana do tamanho do texto corrido não foi medida.)');
  assert.ok(achados[0].citacoes.some((c) => c.tipo === 'trecho' && c.valor === 'Texto miúdo demais'));
  aprovados(achados, ctx);
  const bom = medMobile({ tipografia: { tamanhos: { abaixo12: { tamanhos: [11.5], elementos: 1, exemplos: [{ seletor: 'p', tamanhoPx: 11.5, texto: 'ok' }] } }, lineHeightCorpo: { amostras: 4, medianaRazao: 1.5, normal: 0 } } });
  assert.equal(gerar('resp-texto-pequeno-no-celular', ctx, bom).r.disparou, false);
  assert.equal(gerar('resp-texto-pequeno-no-celular', ctx, {}).r, null);
});

test('resp-imagem-sem-srcset: 3 ou mais imagens com largura natural acima do dobro da exibida e sem srcset', () => {
  const img = (n, nat, rend, extra = {}) => ({ seletor: `img${n}`, src: `${URL0}img/f${n}.png`, naturalW: nat, renderW: rend, temSrcset: false, visivel: true, clone: false, ...extra });
  const tags = [1, 2, 3].map((n) => `<img src="img/f${n}.png" alt="f${n}">`).join('');
  const mk = (imgs) => ctxDe(docDe(tags), {}, { pagina: { mobile: { extr: { imagens: imgs } } } });
  const ctx = mk([img(1, 800, 358), img(2, 800, 358), img(3, 800, 358), img(4, 800, 358, { temSrcset: true })]);
  const { r, achados } = gerar('resp-imagem-sem-srcset', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(Number(r.intensidade.toFixed(2)), 0.75);
  assert.equal(achados[0].mensagem, '3 imagens são muito maiores do que o espaço em que aparecem no celular (por exemplo 800 px de largura num espaço de 358 px) e sem srcset nem picture. O celular baixa a imagem grande à toa, gastando dados e demorando mais.');
  assert.equal(achados[0].selo, 'opiniao');
  aprovados(achados, ctx);
  assert.equal(gerar('resp-imagem-sem-srcset', mk([img(1, 800, 358), img(2, 800, 358)]), {}).r.disparou, false, 'com 2 imagens não dispara');
  assert.equal(gerar('resp-imagem-sem-srcset', mk([img(1, 700, 358), img(2, 700, 358), img(3, 700, 358)]), {}).r.disparou, false, 'natural 700 não passa do dobro de 358 (716)');
  assert.equal(gerar('resp-imagem-sem-srcset', mk([img(1, 800, 90), img(2, 800, 90), img(3, 800, 90)]), {}).r.disparou, false, 'imagens exibidas com menos de 100 px são ignoradas');
  assert.equal(gerar('resp-imagem-sem-srcset', ctxDe(docDe(tags)), {}).r, null, 'sem leitura mobile: não avaliável');
});

test('resp-conteudo-some-no-celular: soma palavras visíveis no desktop e escondidas no celular (40 ou mais)', () => {
  const longo = Array.from({ length: 45 }, (_, i) => `palavra${i}`).join(' ');
  const curto = Array.from({ length: 10 }, (_, i) => `termo${i}`).join(' ');
  const desk = (texto) => ({ nos: [{ seletor: 'div#a', tag: 'div', texto, visivel: true, clone: false }, { seletor: 'p', tag: 'p', texto: 'sempre aqui', visivel: true, clone: false }] });
  const mob = (visivelA, extra = []) => ({ extr: { nos: [{ seletor: 'div#a', tag: 'div', texto: longo, visivel: visivelA, clone: false }, { seletor: 'p', tag: 'p', texto: 'sempre aqui', visivel: true, clone: false }, ...extra] } });
  const mk = (texto, m) => ctxDe(docDe(`<div id="a">${texto}</div><p>sempre aqui</p>`), desk(texto), { pagina: { mobile: m } });
  const ctx = mk(longo, mob(false));
  const { r, achados } = gerar('resp-conteudo-some-no-celular', ctx, {});
  assert.equal(r.disparou, true);
  assert.equal(achados[0].mensagem, `45 palavras aparecem no computador e ficam escondidas no celular, sem aparecer em outro ponto da página (por exemplo "${longo.slice(0, 60).trim()}"). Quem usa o celular recebe menos informação que quem usa o computador. (Só o texto foi comparado; tabelas largas não foram medidas.)`);
  aprovados(achados, ctx);
  assert.equal(gerar('resp-conteudo-some-no-celular', mk(curto, { extr: { nos: [{ seletor: 'div#a', tag: 'div', texto: curto, visivel: false, clone: false }] } }), {}).r.disparou, false, '10 palavras não bastam');
  assert.equal(gerar('resp-conteudo-some-no-celular', mk(longo, mob(true)), {}).r.disparou, false, 'visível nos dois');
  // o mesmo texto aparece em outro ponto no celular: não conta como sumido
  const repetido = mk(longo, mob(false, [{ seletor: 'section>p', tag: 'p', texto: longo, visivel: true, clone: false }]));
  assert.equal(gerar('resp-conteudo-some-no-celular', repetido, {}).r.disparou, false);
  assert.equal(gerar('resp-conteudo-some-no-celular', ctxDe(docDe('x')), {}).r, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. fixtures reais: medidores de verdade + detectores + verificador
// ---------------------------------------------------------------------------------------------------------------------
const FIXTURES = ['e-a11y-ruim', 'e-a11y-clone', 'legal', 'ia-ruim', 'b-boa', 'a-links', 'carrossel-clone', 'i-interacao-ruim', 'i-resp-ruim'];
const real = {};

before(async () => {
  for (const nome of FIXTURES) {
    const { ctx, fechar } = await lerFixture(nome, { manterAberto: true });
    try {
      const med = await executarMedidores(ctx, { ignorar: ['lighthouse'] });
      real[nome] = { ctx, med };
    } finally {
      await fechar();
    }
  }
});

function motorReal(nome) {
  const { ctx, med } = real[nome];
  const m = rodarMotor({ ctx, med, regras: REGRAS, detectores });
  return { ctx, med, m };
}
const idsDe = (m) => [...new Set(m.achados.map((a) => a.regra_id))].sort();

test('fixtures: nenhum medidor com erro e todas as 62 regras têm detector (cobertura.semDetector vazio, sem exceção)', () => {
  for (const nome of FIXTURES) {
    const { med, m } = motorReal(nome);
    for (const [id, x] of Object.entries(med)) assert.equal(x.erro, undefined, `${nome}: medidor ${id} com erro`);
    assert.deepEqual(m.cobertura.semDetector, [], nome);
    assert.deepEqual(m.cobertura.comErro, [], nome);
    for (const id of SEM_MEDICAO) assert.ok(m.cobertura.naoAvaliadas.includes(id), `${nome}: ${id} deveria ficar não avaliada`);
  }
});

test('INTEGRAÇÃO: todos os achados gerados nas fixtures reais são APROVADOS pelo verificador (nenhum descartado)', () => {
  let total = 0;
  for (const nome of FIXTURES) {
    const { ctx, m } = motorReal(nome);
    const v = verificarAchados(m.achados, ctx);
    assert.deepEqual(v.descartados, [], `${nome}: ${JSON.stringify(v.descartados)}`);
    assert.equal(v.aprovados.length, m.achados.length, nome);
    for (const a of m.achados) {
      const val = validarAchado(a);
      assert.equal(val.ok, true, `${nome} ${a.regra_id}: ${val.erros.join('; ')}`);
      assert.ok(!/\bIA\b|inteligência artificial|ChatGPT|Claude/i.test(a.mensagem), `${nome} ${a.regra_id}: mensagem não pode citar autoria por IA`);
    }
    total += m.achados.length;
  }
  assert.ok(total > 40, `esperava dezenas de achados nas fixtures, vieram ${total}`);
});

test('EXEMPLO 1 (legal): 3 links "R$ 34,90" disparam a11y-link-texto-repetido-sem-contexto, com selo e severidade da regra', () => {
  const { ctx, m } = motorReal('legal');
  const achados = m.achados.filter((a) => a.regra_id === 'a11y-link-texto-repetido-sem-contexto');
  assert.equal(achados.length, 1);
  const a = achados[0];
  assert.equal(a.severidade, POR_ID['a11y-link-texto-repetido-sem-contexto'].severidade);
  assert.equal(a.selo, POR_ID['a11y-link-texto-repetido-sem-contexto'].selo);
  assert.equal(a.pagina, '/');
  assert.equal(a.mensagem, 'Para quem usa leitor de tela, a lista de links da página repete o mesmo texto: 3 links dizem só "R$ 34,90", sem aria-label nem outro nome que os diferencie, e levam a 3 destinos diferentes. Quem navega por essa lista não sabe qual é qual. O texto ao redor de cada link (como o nome do item) ajuda quem enxerga a tela, mas não aparece quando o leitor de tela lista só os links.');
  const contagem = a.citacoes.find((c) => c.tipo === 'contagem');
  assert.deepEqual(contagem.contagem, { fn: 'links-com-texto', texto: 'R$ 34,90', esperado: 3 });
  assert.equal(a.citacoes.find((c) => c.tipo === 'trecho' && c.onde === 'visivel').valor, 'R$ 34,90');
  const trechosA = a.citacoes.filter((c) => c.tipo === 'trecho' && c.onde === 'html').map((c) => c.valor);
  assert.deepEqual(trechosA, ['<a href="/comprar?p=1">', '<a href="/comprar?p=2">', '<a href="/comprar?p=3">']);
  assert.equal(a.evidencias[0].contagem, 3);
  const v = verificarAchados([a], ctx);
  assert.equal(v.aprovados.length, 1, JSON.stringify(v.descartados));
  // contagem errada é recusada pelo verificador (prova de que a citação é real)
  const falsa = { ...a, citacoes: [{ ...contagem, contagem: { ...contagem.contagem, esperado: 4 } }] };
  assert.equal(verificarAchados([falsa], ctx).descartados.length, 1);
});

test('EXEMPLO 1 (a-links): "R$ 34,90" e "Leia mais" disparam; aria-label, aria-labelledby e title distintos NÃO disparam; clone nunca conta', () => {
  const { m } = motorReal('a-links');
  const textos = m.achados.filter((a) => a.regra_id === 'a11y-link-texto-repetido-sem-contexto').map((a) => /dizem só "([^"]+)"/.exec(a.mensagem)[1]).sort();
  assert.deepEqual(textos, ['Leia mais', 'R$ 34,90']);
  const nenhum = m.achados.filter((a) => a.regra_id === 'a11y-link-texto-repetido-sem-contexto' && /R\$ 49,90|Saiba mais|Clonado/.test(a.mensagem));
  assert.deepEqual(nenhum, []);
  const leia = m.achados.find((a) => a.mensagem.includes('"Leia mais"'));
  assert.equal(leia.citacoes.find((c) => c.tipo === 'contagem').contagem.esperado, 2);
  assert.ok(!/texto ao redor/.test(leia.mensagem), 'contexto igual nos dois: não afirma que o texto ao redor ajuda');
});

test('EXEMPLO 1: links de clones de carrossel (aria-hidden) nunca contam, nem na contagem nem nas citações', async () => {
  const dois = '<p><a href="/a">Ver</a> <a href="/b">Ver</a></p><div class="slide-clone" aria-hidden="true"><a href="/a">Ver</a><a href="/b">Ver</a></div>';
  const ctx = ctxDe(docDe(dois), { links: [
    { seletor: 'p>a1', texto: 'Ver', visivel: true, clone: false }, { seletor: 'p>a2', texto: 'Ver', visivel: true, clone: false },
    { seletor: 'clone>a1', texto: 'Ver', visivel: true, clone: true }, { seletor: 'clone>a2', texto: 'Ver', visivel: true, clone: true },
  ] });
  const medLinks = await (await import('../lib/medidores/links.mjs')).medirComOpcoes(ctx, { buscar: async () => ({ status: 200, url: URL0 }), esperar: async () => {} });
  const { r, achados } = gerar('a11y-link-texto-repetido-sem-contexto', ctx, { links: medLinks });
  assert.equal(r.disparou, true);
  assert.match(achados[0].mensagem, /: 2 links dizem só "Ver"/);
  assert.equal(achados[0].citacoes.find((c) => c.tipo === 'contagem').contagem.esperado, 2);
  assert.equal(achados[0].citacoes.filter((c) => c.tipo === 'trecho' && c.onde === 'html').length, 2);
  aprovados(achados, ctx);
});

test('fixture e-a11y-ruim: conjunto exato de regras disparadas e valores do axe', () => {
  const { med, m } = motorReal('e-a11y-ruim');
  assert.deepEqual(idsDe(m), [
    'a11y-botao-sem-nome', 'a11y-campo-sem-rotulo', 'a11y-contraste-texto-baixo', 'a11y-idioma-da-pagina', 'a11y-imagem-sem-alt',
    'a11y-titulos-vazios-ou-fora-de-ordem', 'int-campo-sem-tipo-ou-autocomplete', 'int-contorno-de-foco-removido', 'int-formulario-sem-destino',
    'int-micro-estados-ausentes', 'resp-alvo-menor-que-24px',
  ]);
  const por = Object.fromEntries(m.achados.map((a) => [a.regra_id, a]));
  assert.equal(por['a11y-imagem-sem-alt'].mensagem, '1 imagem sem texto alternativo (alt). Quem usa leitor de tela não fica sabendo o que ela mostra.');
  assert.equal(por['a11y-imagem-sem-alt'].citacoes[0].valor, '<img src="foto-pao.png" width="200" height="120">');
  assert.equal(por['a11y-botao-sem-nome'].evidencias[0].seletor, 'button');
  assert.equal(por['a11y-contraste-texto-baixo'].mensagem, '1 trecho de texto tem contraste abaixo do mínimo: o mínimo é 4,5 para 1 no texto normal e 3 para 1 no texto grande. O pior mede 1,91 para 1.');
  assert.equal(por['a11y-titulos-vazios-ou-fora-de-ordem'].mensagem, 'Estrutura de títulos com problema: 1 título pula nível (por exemplo de h2 direto para h4). Quem usa leitor de tela navega pelos títulos e se perde.');
  assert.equal(por['int-micro-estados-ausentes'].mensagem, 'No CSS, 2 grupos de elementos não têm nenhum estado definido (nem hover, nem foco, nem ativo): botões, campos de texto. A pessoa clica ou passa o mouse e não recebe resposta visual.');
  assert.equal(por['int-campo-sem-tipo-ou-autocomplete'].mensagem, '1 campo de e-mail ou telefone com type de texto comum e 1 campo de dado pessoal sem autocomplete. Sem o type e o autocomplete certos, o celular não abre o teclado adequado e o navegador não preenche os dados sozinho.');
  // o que o detector disse bate com o que o axe mediu
  const violacoes = Object.fromEntries(med.axe.dados.agregado.violacoes.map((v) => [v.id, v.nosTotal]));
  assert.equal(violacoes['image-alt'], 1);
  assert.equal(violacoes['button-name'], 1);
  assert.equal(violacoes['label'], 1);
});

test('fixture e-a11y-clone: clones de carrossel não geram achados de conteúdo, mas aria-hidden-focus conta os clones', () => {
  const { m } = motorReal('e-a11y-clone');
  const ids = idsDe(m);
  assert.ok(!ids.includes('a11y-imagem-sem-alt') && !ids.includes('a11y-link-sem-nome') && !ids.includes('a11y-botao-sem-nome'));
  const a = m.achados.find((x) => x.regra_id === 'a11y-aria-hidden-em-elemento-focavel');
  assert.equal(a.mensagem, '2 elementos que recebem foco do teclado estão dentro de uma área escondida do leitor de tela (aria-hidden), incluindo 2 dentro de cópias de carrossel. O teclado chega lá, mas o leitor de tela não anuncia nada.');
  assert.ok(!ids.includes('a11y-link-texto-repetido-sem-contexto'));
});

test('fixture b-boa (site bem feito): sem nenhum achado de acessibilidade ou responsividade', () => {
  const { m } = motorReal('b-boa');
  assert.deepEqual(idsDe(m), ['int-campo-sem-tipo-ou-autocomplete', 'int-formulario-sem-destino']);
  assert.equal(m.achados.find((a) => a.regra_id === 'int-campo-sem-tipo-ou-autocomplete').mensagem, '1 campo de dado pessoal sem autocomplete. Sem o type e o autocomplete certos, o celular não abre o teclado adequado e o navegador não preenche os dados sozinho.');
  for (const id of ['a11y-imagem-sem-alt', 'a11y-contraste-texto-baixo', 'a11y-zoom-bloqueado', 'resp-rolagem-horizontal', 'resp-sem-meta-viewport', 'int-contorno-de-foco-removido']) {
    const t = m.tells.find((x) => x.regra_id === id);
    assert.equal(t.disparou, false, id);
  }
});

test('fixture ia-ruim: contraste do axe com valor exato, rolagem horizontal no celular e sem foco desenhado', () => {
  const { m } = motorReal('ia-ruim');
  assert.deepEqual(idsDe(m), ['a11y-animacao-sem-reduced-motion', 'a11y-contraste-texto-baixo', 'a11y-sem-regiao-principal', 'a11y-titulos-vazios-ou-fora-de-ordem', 'int-contorno-de-foco-removido', 'resp-alvo-menor-que-44px', 'resp-rolagem-horizontal']);
  const c = m.achados.find((a) => a.regra_id === 'a11y-contraste-texto-baixo');
  assert.match(c.mensagem, /O pior mede 4,46 para 1\./);
  const rolagem = m.achados.find((a) => a.regra_id === 'resp-rolagem-horizontal');
  assert.match(rolagem.mensagem, /^No celular a página fica mais larga que a tela: o conteúdo mede 482 px para uma tela de 390 px\./);
});

test('fixture a-links: link vazio, href falso, alvo pequeno, clone com foco e sem meta viewport', () => {
  const { m } = motorReal('a-links');
  const por = Object.fromEntries(m.achados.filter((a) => a.regra_id !== 'a11y-link-texto-repetido-sem-contexto').map((a) => [a.regra_id, a]));
  assert.equal(por['a11y-link-sem-nome'].mensagem, '1 link sem texto nem nome acessível: o leitor de tela não consegue dizer para onde ele leva.');
  assert.equal(por['int-link-falso'].mensagem, '1 link finge ser link mas não leva a lugar nenhum (1 com href="javascript:"). Para quem usa leitor de tela, é anunciado como link e o clique não vai a lugar nenhum; se for uma ação, deveria ser um botão.');
  assert.equal(por['resp-sem-meta-viewport'].mensagem, 'A página não tem a meta viewport com width=device-width. No celular ela aparece como a versão de computador encolhida, com texto miúdo.');
  assert.match(por['a11y-aria-hidden-em-elemento-focavel'].mensagem, /^1 elemento que recebe foco do teclado está dentro de uma área escondida do leitor de tela \(aria-hidden\), incluindo 1 dentro de cópia de carrossel\./);
  assert.ok(por['a11y-alvo-de-toque-pequeno']);
});

test('fixture carrossel-clone: animação sem reduced-motion; nenhum achado de link ou conteúdo por causa dos clones', () => {
  const { m } = motorReal('carrossel-clone');
  assert.deepEqual(idsDe(m), ['a11y-animacao-sem-reduced-motion', 'int-contorno-de-foco-removido', 'resp-rolagem-horizontal']);
  assert.equal(m.achados.find((a) => a.regra_id === 'a11y-animacao-sem-reduced-motion').mensagem, 'O CSS tem 1 @keyframes e 1 animação, mas nenhum bloco @media (prefers-reduced-motion: reduce) para desligar ou reduzir o movimento. Quem sente enjoo ou tontura com animação não tem como pedir menos movimento.');
});

test('fixture i-interacao-ruim: todas as regras de interação que a fixture exercita disparam, com valores exatos', () => {
  const { m } = motorReal('i-interacao-ruim');
  const por = Object.fromEntries(m.achados.map((a) => [a.regra_id, a]));
  const esperados = [
    'a11y-zoom-bloqueado', 'a11y-foco-do-teclado-invisivel', 'a11y-clique-sem-teclado', 'a11y-movimento-automatico-sem-pausa', 'a11y-animacao-sem-reduced-motion',
    'int-contorno-de-foco-removido', 'int-anel-de-foco-com-fade', 'int-clicavel-sem-semantica', 'int-link-falso', 'int-menu-so-com-hover', 'int-carrossel-so-por-arraste',
    'int-desabilitado-so-por-opacidade', 'int-placeholder-no-lugar-do-rotulo', 'int-campo-sem-tipo-ou-autocomplete', 'int-aviso-sem-aria-live', 'int-formulario-sem-destino',
    'int-bloqueia-colar', 'resp-zoom-bloqueado', 'resp-altura-em-vh',
  ];
  for (const id of esperados) assert.ok(por[id], `faltou ${id}`);
  assert.equal(por['a11y-zoom-bloqueado'].mensagem, 'A meta viewport (maximum-scale=1 e user-scalable=no) bloqueia ou limita o zoom. Quem enxerga pouco precisa ampliar a página no celular e não consegue.');
  assert.equal(por['resp-zoom-bloqueado'].mensagem, 'A meta viewport trava o zoom (user-scalable=no e maximum-scale=1). Quem enxerga pouco precisa ampliar a página no celular e não consegue.');
  assert.match(por['a11y-clique-sem-teclado'].mensagem, /^2 elementos respondem ao clique/);
  assert.equal(por['int-link-falso'].mensagem, '3 links fingem ser links mas não levam a lugar nenhum (1 com href="#", 1 com href vazio, 1 sem href). Para quem usa leitor de tela, são anunciados como link e o clique não vai a lugar nenhum; se for uma ação, deveria ser um botão.');
  assert.match(por['int-clicavel-sem-semantica'].mensagem, /^2 blocos clicáveis/);
  assert.match(por['int-placeholder-no-lugar-do-rotulo'].mensagem, /^2 campos têm só o texto de exemplo/);
  assert.match(por['int-aviso-sem-aria-live'].mensagem, /^2 contêineres de aviso/);
  assert.match(por['int-bloqueia-colar'].mensagem, /^Há 2 bloqueios do evento de colar/);
  assert.equal(por['int-menu-so-com-hover'].mensagem, 'O CSS revela conteúdo só quando o mouse passa por cima (1 regra, por exemplo .menu li:hover > .submenu), e não há regra equivalente com :focus-within, aria-expanded ou classe de aberto para o teclado ou o toque. Quem usa só o teclado pode não alcançar esse conteúdo.');
  assert.equal(por['resp-altura-em-vh'].mensagem, 'A altura da abertura da página usa vh (min-height: 100vh em .hero) sem a versão dvh ou svh no mesmo seletor. No celular, a barra do navegador faz a abertura passar da área realmente visível.');
  assert.equal(por['int-anel-de-foco-com-fade'].mensagem, 'O anel de foco aparece com transição (fade): 1 seletor com transição na mesma propriedade que o :focus-visible usa, como .btn. Quem navega pelo teclado vê o foco chegar atrasado.');
  assert.equal(por['int-desabilitado-so-por-opacidade'].mensagem, 'O estado desabilitado usa só a opacidade (1 seletor, por exemplo button:disabled): não há cursor not-allowed nem mudança de cor ou fundo. Quem enxerga pouco, ou vê a tela com brilho alto, pode não notar que o controle está desligado.');
});

test('fixture i-resp-ruim: rolagem horizontal, alvos pequenos, texto miúdo, imagens grandes, conteúdo que some e altura em vh', () => {
  const { m } = motorReal('i-resp-ruim');
  const por = Object.fromEntries(m.achados.map((a) => [a.regra_id, a]));
  for (const id of ['resp-rolagem-horizontal', 'resp-alvo-menor-que-24px', 'resp-alvo-menor-que-44px', 'resp-texto-pequeno-no-celular', 'resp-imagem-sem-srcset', 'resp-conteudo-some-no-celular', 'resp-altura-em-vh']) assert.ok(por[id], `faltou ${id}`);
  assert.match(por['resp-rolagem-horizontal'].mensagem, /^No celular a página fica mais larga que a tela: o conteúdo mede 916 px para uma tela de 390 px\./);
  assert.equal(por['resp-alvo-menor-que-24px'].mensagem, 'No celular, 3 alvos de toque medem menos de 24 por 24 pixels (de 6 medidos, sem contar links dentro de frases). Fica difícil acertar com o dedo, principalmente para quem tem tremor ou dedos grandes. (A exceção de espaçamento da norma não foi medida.)');
  assert.equal(por['resp-alvo-menor-que-44px'].mensagem, 'No celular, 3 alvos de toque têm entre 24 e 44 pixels de lado: 100% dos 3 alvos que passam do mínimo de 24 pixels. O recomendado para botões e links principais é pelo menos 44 por 44 pixels.');
  assert.match(por['resp-texto-pequeno-no-celular'].mensagem, /^Há texto com menos de 11 px no celular \(o menor mede 9 px/);
  assert.equal(por['resp-imagem-sem-srcset'].mensagem, '3 imagens são muito maiores do que o espaço em que aparecem no celular (por exemplo 800 px de largura num espaço de 358 px) e sem srcset nem picture. O celular baixa a imagem grande à toa, gastando dados e demorando mais.');
  assert.match(por['resp-conteudo-some-no-celular'].mensagem, /^73 palavras aparecem no computador e ficam escondidas no celular/);
  assert.match(por['resp-altura-em-vh'].mensagem, /^A altura da abertura da página usa vh \(height: 100vh em \.hero\)/);
  // meta viewport correta: não dispara zoom nem sem-viewport
  assert.ok(!por['resp-zoom-bloqueado'] && !por['resp-sem-meta-viewport']);
});

test('motor: intensidade em 0..1, severidade/selo vêm da regra e disparou coerente com os achados', () => {
  for (const nome of FIXTURES) {
    const { m } = motorReal(nome);
    for (const t of m.tells) {
      assert.ok(t.intensidade >= 0 && t.intensidade <= 1, `${nome} ${t.regra_id}`);
      assert.equal(t.disparou, m.achados.some((a) => a.regra_id === t.regra_id), `${nome} ${t.regra_id}`);
    }
    for (const a of m.achados) {
      assert.equal(a.selo, POR_ID[a.regra_id].selo);
      assert.ok(/^P[0-3]$/.test(a.severidade), a.regra_id);
      assert.ok(a.mensagem.length >= 5 && a.mensagem.length < 700, `${nome} ${a.regra_id}`);
    }
  }
});
