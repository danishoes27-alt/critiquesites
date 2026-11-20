// Testes dos detectores de movimento, layout/espaçamento e estrutura padrão (lib/deteccoes/movimento-layout-estrutura.mjs).
// Unitários: `med` e `ctx` sintéticos escritos à mão, com valores exatos (positivo e negativo por detector).
// Integração: medidores reais + detectores em fixtures (ia-ruim, b-boa, k-padrao-completo, k-esqueleto) e verificarAchados.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { criarAchado, validarAchado } from '../lib/achado.mjs';
import { calcularTellScore } from '../lib/tell-score.mjs';
import { detectores, LIMIARES, NAO_AVALIAVEIS } from '../lib/deteccoes/movimento-layout-estrutura.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// regras reais e utilitários de teste
// ---------------------------------------------------------------------------------------------------------------------
const DIR_REGRAS = new URL('../regras/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REGRAS_LISTA = ['visual-movimento', 'layout-espacamento', 'estrutura-padrao'].flatMap((f) => JSON.parse(readFileSync(`${DIR_REGRAS}${f}.json`, 'utf8')));
const REGRAS = Object.fromEntries(REGRAS_LISTA.map((r) => [r.id, r]));

const URL_T = 'http://t.test/';
const perto = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} deveria ser ${b}`);

function mescla(base, extra) {
  if (extra === undefined) return base;
  if (Array.isArray(extra) || extra === null || typeof extra !== 'object') return extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = mescla(base?.[k], v);
  return out;
}
// estilos computados mínimos (formato de extrator-estilos.mjs), com sobrescritas
const es = (extra = {}) => mescla({
  tipografia: { paragrafos: { amostras: 0, caracteresPorLinhaMediana: null, caracteresPorLinhaMax: null, exemplosLongos: [] } },
  cards: { total: 0, padding: {}, paddingDominante: null, fracaoPaddingDominante: 0, nPaddingDistintos: 0, exemplos: [], aninhados: { total: 0, raioFilhoMaiorQuePai: 0, pares: [] } },
  secoes: { itens: [], n: 0, pares: {}, nParesDistintos: 0, uniforme: false, valorDominante: null, fracaoDominante: 0 },
  layout: { centralizacao: { profundidadeMax: 3, blocos: 0, centralizados: 0, fracao: 0, porProfundidade: {}, exemplos: [] }, grades: [], flexLinhas: [], heroes: [] },
  movimento: {
    animacoes: { elementos: 0, porNome: [], easing: {}, infinitas: 0 },
    transicoes: { elementos: 0, propriedades: {}, easing: {}, duracoesMs: {}, all: 0, temCubicBezier: false, temEasingCustom: false, soEasingPadrao: false },
  },
}, extra);
// CSS estático resumido (formato de medidores/css.mjs > site.estatico)
const estatico = (extra = {}) => mescla({
  arquivos: { css: 0, inline: 1, comErroParse: [], baixadosSemTexto: [] },
  mediaQueries: { total: 0, prefersReducedMotion: 0 },
  movimento: { transicoes: 0, transicaoAll: 0, propriedadesTransicao: {}, easing: {}, cubicBeziers: {}, duracoesMs: {}, temCubicBezier: false, animacoes: 0, animacaoNomes: {}, keyframes: [], willChange: 0, temMovimento: false },
}, extra);
const medSint = ({ es: e = es(), estatico: est = estatico(), url = URL_T } = {}) => ({ css: { id: 'css', dados: { paginas: [{ url, computado: e }], site: { estatico: est } }, evidencias: [] } });
const medSemComputado = ({ estatico: est = estatico() } = {}) => ({ css: { id: 'css', dados: { paginas: [{ url: URL_T, computado: null }], site: { estatico: est } }, evidencias: [] } });

const no = (seletor, tag, texto, extra = {}) => ({ seletor, tag, texto, visivel: true, ocultoPor: '', ariaOculto: false, clone: false, ...extra });
function ctxSint({ html = '', css = '', nos = [], imagens = [], links = [], formularios = [], scripts = [], atributos = [], headings = [], cruNos = null, requisicoes = [], ativos = [], estilos = null } = {}) {
  return {
    site: { urlInicial: URL_T, origem: 'http://t.test', host: 't.test', tipoDeSite: null, modo: 'rapido' },
    paginas: [{
      url: URL_T,
      cru: { html: '', extr: cruNos ? { nos: cruNos, estilosInline: [], scripts: [] } : undefined },
      final: { html, extr: { url: URL_T, nos, imagens, links, formularios, headings, scripts, atributos, estilosInline: css ? [css] : [] }, estilos },
      requisicoes,
    }],
    ativos,
  };
}
const rodar = (id, ctx, med) => detectores[id]({ ctx, med, regra: REGRAS[id] });
// Passa os achados pelo verificador: cada citação e cada número da mensagem precisam ter respaldo; também valida o schema.
function aprovar(id, r, ctx) {
  assert.ok(r && r.achados.length > 0, `${id}: sem achados`);
  const achados = r.achados.map((a) => criarAchado(REGRAS[id], a));
  for (const a of achados) { const v = validarAchado(a); assert.ok(v.ok, `${id}: schema inválido: ${v.erros.join('; ')}`); }
  const v = verificarAchados(achados, ctx);
  assert.deepEqual(v.descartados.map((d) => d.motivo), [], `${id}: achados descartados pelo verificador`);
  assert.equal(v.aprovados.length, achados.length);
  return achados;
}
// verifica positivo: dispara, intensidade exata, achados aprovados
function positivo(id, ctx, med, intensidade) {
  const r = rodar(id, ctx, med);
  assert.ok(r, `${id}: devolveu null`);
  assert.equal(r.disparou, true, `${id}: deveria disparar`);
  perto(r.intensidade, intensidade, 1e-6);
  aprovar(id, r, ctx);
  return r;
}
function negativo(id, ctx, med) {
  const r = rodar(id, ctx, med);
  assert.ok(r, `${id}: devolveu null`);
  assert.equal(r.disparou, false, `${id}: não deveria disparar`);
  assert.equal(r.intensidade, 0);
  assert.deepEqual(r.achados, []);
}
const anim = (o) => ({ nome: 'x', elementos: 1, duracaoMs: 600, easing: 'ease', iteracoes: '1', anima: ['opacity'], ehEntrada: true, ...o });
const sec = (seletor, tag, pt, pb, alturaPx = 400) => ({ seletor, tag, paddingTopPx: pt, paddingBottomPx: pb, alturaPx });
// cartões (h3 + p) sob um contêiner: gera os nós de texto
function nosCartoes(base, n, { tag = 'div', titulo = 'h3', texto = 'p', prefixo = 'Item' } = {}) {
  return Array.from({ length: n }, (_, i) => [no(`${base}>${tag}:nth-of-type(${i + 1})>${titulo}`, titulo, `${prefixo} ${i + 1}`), no(`${base}>${tag}:nth-of-type(${i + 1})>${texto}`, texto, `Frase curta do ${prefixo.toLowerCase()} ${i + 1}.`)]).flat();
}

// ---------------------------------------------------------------------------------------------------------------------
// contrato geral
// ---------------------------------------------------------------------------------------------------------------------
test('cobertura: um detector para cada regra de script/misto das 3 categorias (julgamento fica de fora)', () => {
  const deScript = REGRAS_LISTA.filter((r) => r.deteccao.tipo !== 'julgamento');
  assert.equal(deScript.length, 45);
  for (const r of deScript) assert.equal(typeof detectores[r.id], 'function', `sem detector: ${r.id}`);
  for (const r of REGRAS_LISTA.filter((x) => x.deteccao.tipo === 'julgamento')) assert.equal(detectores[r.id], undefined);
  for (const id of Object.keys(detectores)) assert.ok(REGRAS[id], `detector de regra inexistente: ${id}`);
  assert.equal(Object.keys(detectores).length, 45);
});

test('LIMIARES: constantes da regra batem com o JSON das regras', () => {
  const p = (id) => REGRAS[id].deteccao.parametros;
  assert.equal(LIMIARES.movimento.entradaMinElementos, p('mov-mesma-entrada-em-tudo').minimo_de_elementos_com_a_mesma_entrada);
  assert.equal(LIMIARES.movimento.coreografiasMaxPadroes, p('mov-varias-coreografias-de-rolagem').maximo_de_padroes_distintos);
  assert.equal(LIMIARES.movimento.duracaoEstadoMaxMs, p('mov-duracao-fora-da-faixa').duracao_maxima_de_estado_ms);
  assert.equal(LIMIARES.movimento.duracaoEntradaMaxMs, p('mov-duracao-fora-da-faixa').duracao_maxima_de_entrada_ms);
  assert.equal(LIMIARES.movimento.cascataMaxItens, p('mov-cascata-de-atrasos-longa').maximo_de_itens_em_cascata);
  assert.equal(LIMIARES.movimento.cascataAtrasoTotalMaxMs, p('mov-cascata-de-atrasos-longa').atraso_total_maximo_ms);
  assert.equal(LIMIARES.layout.paddingFracaoMin, p('lay-padding-unico-em-tudo').fracao_minima_do_valor_dominante);
  assert.equal(LIMIARES.layout.assimetriaRazaoMax, p('lay-espaco-assimetrico-de-secao').razao_maxima);
  assert.equal(LIMIARES.layout.textoEspremidoMinCaracteres, p('lay-bloco-de-texto-espremido').minimo_de_caracteres_por_linha);
  assert.equal(LIMIARES.estrutura.centralizarFracaoMin, p('estr-centralizar-tudo').fracao_minima_centralizada);
  assert.equal(LIMIARES.estrutura.esqueletoMaxSecoes, p('estr-esqueleto-hero-beneficios-chamada').maximo_de_secoes);
  assert.equal(LIMIARES.estrutura.botoesAberturaMin, p('estr-abertura-com-botoes-demais').minimo_de_botoes);
});

test('detectores sem dado hoje devolvem null (nunca "ok") e têm motivo documentado', () => {
  const ids = Object.keys(NAO_AVALIAVEIS);
  assert.equal(ids.length, 8);
  const med = medSint();
  const ctx = ctxSint({ nos: [no('body>h1', 'h1', 'Titulo')] });
  for (const id of ids) {
    assert.ok(NAO_AVALIAVEIS[id].length > 20, `motivo curto demais: ${id}`);
    assert.equal(rodar(id, ctx, med), null, `${id} deveria devolver null`);
  }
});

test('sem o medidor css (ou com erro), os detectores que dependem dele devolvem null', () => {
  const ctx = ctxSint({ nos: [no('body>h1', 'h1', 'Titulo')] });
  for (const med of [{}, { css: { id: 'css', dados: null, evidencias: [], erro: 'falhou' } }, medSemComputado()]) {
    for (const id of ['mov-mesma-entrada-em-tudo', 'mov-loop-infinito-sem-funcao', 'lay-padding-unico-em-tudo', 'lay-respiro-curto-entre-secoes', 'estr-hero-tres-cards', 'estr-card-dentro-de-card', 'estr-centralizar-tudo', 'estr-ritmo-uniforme-de-secoes']) {
      assert.equal(rodar(id, ctx, med), null, `${id} deveria ser null`);
    }
  }
  assert.equal(rodar('mov-transicao-em-tudo', ctx, {}), null);
  assert.equal(rodar('mov-sem-reduced-motion', ctx, {}), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// MOVIMENTO
// ---------------------------------------------------------------------------------------------------------------------
test('mov-mesma-entrada-em-tudo: 6 elementos com a mesma entrada = 0,5; 3 elementos não dispara', () => {
  const css = '.fade{animation:entrar .6s both}@keyframes entrar{from{opacity:0}to{opacity:1}}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')], html: '<div class="fade">a</div>' });
  const r = positivo('mov-mesma-entrada-em-tudo', ctx, medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'entrar', elementos: 6 })] } } }) }), 0.5);
  assert.match(r.achados[0].mensagem, /6 elementos visíveis/);
  assert.equal(r.achados[0].citacoes[0].valor, '@keyframes entrar');
  negativo('mov-mesma-entrada-em-tudo', ctx, medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'entrar', elementos: 3 })] } } }) }));
  // animação infinita não é entrada
  negativo('mov-mesma-entrada-em-tudo', ctx, medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'girar', elementos: 9, iteracoes: 'infinite' })] } } }) }));
});

test('mov-mesma-entrada-em-tudo: marcadores de biblioteca (data-aos) contam como a mesma entrada', () => {
  const html = Array.from({ length: 5 }, () => '<div data-aos="fade-up">x</div>').join('');
  const ctx = ctxSint({ html, nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-mesma-entrada-em-tudo', ctx, medSint(), 5 / 12);
  assert.match(r.achados[0].mensagem, /5 elementos visíveis \(atributo data-aos\)/);
  assert.equal(r.achados[0].citacoes[0].valor, 'data-aos');
});

test('mov-varias-coreografias-de-rolagem: 4 padrões = 0,5; 2 padrões não dispara', () => {
  const nomes = ['a1', 'a2', 'a3', 'a4'];
  const css = nomes.map((n) => `@keyframes ${n}{from{opacity:0}to{opacity:1}}`).join('');
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const mk = (ns) => medSint({ es: es({ movimento: { animacoes: { porNome: ns.map((n) => anim({ nome: n })) } } }) });
  const r = positivo('mov-varias-coreografias-de-rolagem', ctx, mk(nomes), 0.5);
  assert.match(r.achados[0].mensagem, /4 padrões diferentes/);
  negativo('mov-varias-coreografias-de-rolagem', ctx, mk(nomes.slice(0, 2)));
  // 6 padrões = (6-2)/4 limitado a 1
  const css6 = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `@keyframes ${n}{from{opacity:0}to{opacity:1}}`).join('');
  positivo('mov-varias-coreografias-de-rolagem', ctxSint({ css: css6, nos: [no('body>h1', 'h1', 'Olá')] }), mk(['a', 'b', 'c', 'd', 'e', 'f']), 1);
});

test('mov-transicao-em-tudo: 3 declarações com all = 0,6; classe transition-all conta; sem all não dispara', () => {
  const ctx = ctxSint({ css: '.a{transition:all .3s ease}.b{transition:all 1s}.c{transition-property:all}', nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-transicao-em-tudo', ctx, medSint({ estatico: estatico({ movimento: { transicaoAll: 3 } }) }), 0.6);
  assert.match(r.achados[0].mensagem, /3 ocorrências/);
  assert.ok(r.achados[0].citacoes.some((c) => c.valor === 'transition:all .3s ease'));
  const ctxClasse = ctxSint({ html: '<div class="transition-all">a</div><div class="hover:transition-all">b</div>', nos: [no('body>h1', 'h1', 'Olá')] });
  positivo('mov-transicao-em-tudo', ctxClasse, medSint(), 0.4);
  negativo('mov-transicao-em-tudo', ctxSint({ css: '.a{transition:opacity .3s}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
});

test('mov-animar-propriedades-de-layout: transição de height + keyframes de width = 0,4; só opacity/transform não dispara', () => {
  const css = '.x{transition:height .3s}@keyframes abrir{from{width:0}to{width:100%}}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const med = medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'abrir', anima: ['width'] })] } } }), estatico: estatico({ movimento: { propriedadesTransicao: { height: 1, opacity: 2 } } }) });
  const r = positivo('mov-animar-propriedades-de-layout', ctx, med, 0.4);
  assert.match(r.achados[0].mensagem, /2 transições ou animações/);
  assert.ok(r.achados[0].citacoes.some((c) => c.valor === 'transition:height .3s'));
  negativo('mov-animar-propriedades-de-layout', ctxSint({ css: '.x{transition:opacity .3s}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint({ estatico: estatico({ movimento: { propriedadesTransicao: { opacity: 1, transform: 1 } } }) }));
});

test('mov-sem-reduced-motion: animação sem proteção dispara (1); com media query, matchMedia ou sem animação não dispara', () => {
  const css = '@keyframes pulso{from{opacity:0}to{opacity:1}}.a{animation:pulso 1s}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const est = estatico({ movimento: { keyframes: ['pulso'], animacoes: 1 } });
  const r = positivo('mov-sem-reduced-motion', ctx, medSint({ estatico: est }), 1);
  assert.match(r.achados[0].mensagem, /1 regra @keyframes, 1 declaração de animação e nenhuma regra @media \(prefers-reduced-motion\)/);
  assert.equal(r.achados[0].instavel, undefined);
  // protegido por @media
  negativo('mov-sem-reduced-motion', ctx, medSint({ estatico: estatico({ movimento: { keyframes: ['pulso'], animacoes: 1 }, mediaQueries: { prefersReducedMotion: 1 } }) }));
  // protegido por matchMedia no JS
  const ctxJs = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')], scripts: [{ src: null, inline: "if(matchMedia('(prefers-reduced-motion: reduce)').matches){}" }] });
  negativo('mov-sem-reduced-motion', ctxJs, medSint({ estatico: est }));
  // sem animação
  negativo('mov-sem-reduced-motion', ctx, medSint({ estatico: estatico() }));
  // CSS parcial (um arquivo não foi baixado): dispara, mas marcado como instável
  const rp = rodar('mov-sem-reduced-motion', ctx, medSint({ estatico: estatico({ movimento: { keyframes: ['pulso'] }, arquivos: { css: 1, baixadosSemTexto: [{ url: 'x.css', erro: 'falhou' }] } }) }));
  assert.equal(rp.achados[0].instavel, true);
  // só animação computada e nenhum CSS lido: não dá para saber
  const comp = es({ movimento: { animacoes: { porNome: [anim({ nome: 'z' })] } } });
  assert.equal(rodar('mov-sem-reduced-motion', ctx, medSint({ es: comp, estatico: estatico({ arquivos: { css: 0, inline: 0 } }) })), null);
});

test('mov-easing-com-quique: cubic-bezier com y fora de 0 a 1, nome bounce e linear() acima de 1', () => {
  const ctx = ctxSint({ css: '.b{transition:transform .2s cubic-bezier(.68,-.55,.27,1.55)}', nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-easing-com-quique', ctx, medSint(), 1 / 3);
  assert.match(r.achados[0].mensagem, /1 uso de efeito de quique ou elástico: cubic-bezier com y fora do intervalo de 0 a 1/);
  assert.equal(r.achados[0].citacoes[0].valor, 'transition:transform .2s cubic-bezier(.68,-.55,.27,1.55)');
  // nome bounce em keyframes + linear() com valor 1.2 = 2 usos
  const ctx2 = ctxSint({ css: '@keyframes bounce{from{opacity:0}to{opacity:1}}.l{animation-timing-function:linear(0, 1.2, 1)}', nos: [no('body>h1', 'h1', 'Olá')] });
  positivo('mov-easing-com-quique', ctx2, medSint({ estatico: estatico({ movimento: { keyframes: ['bounce'] } }) }), 2 / 3);
  negativo('mov-easing-com-quique', ctxSint({ css: '.b{transition:transform .2s cubic-bezier(.2,.7,.2,1)}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
});

test('mov-hover-igual-em-todos: mesmo transform em 3 seletores = 0,5; imagem com scale no hover = 0,5; 2 seletores não dispara', () => {
  const css3 = '.card:hover,.plano:hover,.item:hover{transform:translateY(-4px)}';
  const ctx = ctxSint({ css: css3, nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-hover-igual-em-todos', ctx, medSint(), 0.5);
  assert.match(r.achados[0].mensagem, /mesmo transform \(translatey\(-4px\)\) em 3 seletores/);
  negativo('mov-hover-igual-em-todos', ctxSint({ css: '.card:hover,.plano:hover{transform:translateY(-4px)}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  // botões e links não contam como cartões
  negativo('mov-hover-igual-em-todos', ctxSint({ css: '.btn:hover,a:hover,button:hover{transform:scale(1.05)}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  const rImg = positivo('mov-hover-igual-em-todos', ctxSint({ css: '.galeria img:hover{transform:scale(1.1)}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint(), 0.5);
  assert.match(rImg.achados[0].mensagem, /1 imagem ganha escala ou rotação no hover/);
  // 6 seletores iguais = 1
  const css6 = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((c) => `.${c}:hover`).join(',') + '{transform:scale(1.02)}';
  positivo('mov-hover-igual-em-todos', ctxSint({ css: css6, nos: [no('body>h1', 'h1', 'Olá')] }), medSint(), 1);
  assert.equal(rodar('mov-hover-igual-em-todos', ctxSint({ nos: [no('body>h1', 'h1', 'Olá')] }), medSint()), null, 'sem CSS lido não dá para avaliar');
});

test('mov-loop-infinito-sem-funcao: 2 elementos com pulso infinito = 0,667; spinner, loading e animação finita não disparam', () => {
  const css = '@keyframes pulsar{from{opacity:1}to{opacity:.5}}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const mk = (a) => medSint({ es: es({ movimento: { animacoes: { porNome: a } } }) });
  const r = positivo('mov-loop-infinito-sem-funcao', ctx, mk([anim({ nome: 'pulsar', elementos: 2, iteracoes: 'infinite' })]), 2 / 3);
  assert.match(r.achados[0].mensagem, /2 elementos visíveis com animação em repetição infinita/);
  negativo('mov-loop-infinito-sem-funcao', ctx, mk([anim({ nome: 'spin', elementos: 2, iteracoes: 'infinite' }), anim({ nome: 'skeleton-loading', elementos: 3, iteracoes: 'infinite' })]));
  negativo('mov-loop-infinito-sem-funcao', ctx, mk([anim({ nome: 'pulsar', elementos: 2, iteracoes: '1' })]));
  // classe animate-pulse conta, exceto em esqueleto
  const html = '<div class="animate-pulse">a</div><div class="animate-pulse skeleton">b</div><span class="animate-ping">c</span>';
  positivo('mov-loop-infinito-sem-funcao', ctxSint({ html, nos: [no('body>h1', 'h1', 'Olá')] }), mk([]), 2 / 3);
});

test('mov-movimento-automatico-sem-pausa: marquee sem botão de pausar dispara; com botão Pausar não', () => {
  const ctx = ctxSint({ html: '<marquee>Promoção</marquee>', nos: [no('body>marquee', 'marquee', 'Promoção')] });
  const r = positivo('mov-movimento-automatico-sem-pausa', ctx, medSint(), 1 / 3);
  assert.match(r.achados[0].mensagem, /1 elemento marquee/);
  const comBotao = ctxSint({ html: '<marquee>Promoção</marquee><button>Pausar</button>', nos: [no('body>marquee', 'marquee', 'Promoção'), no('body>button', 'button', 'Pausar')] });
  negativo('mov-movimento-automatico-sem-pausa', comBotao, medSint());
  const comAria = ctxSint({ html: '<marquee>Promoção</marquee>', nos: [no('body>marquee', 'marquee', 'Promoção')], atributos: [{ seletor: 'body>button', atributo: 'aria-label', valor: 'Parar animação' }] });
  negativo('mov-movimento-automatico-sem-pausa', comAria, medSint());
  negativo('mov-movimento-automatico-sem-pausa', ctxSint({ html: '<p>Nada anda</p>', nos: [no('body>p', 'p', 'Nada anda')] }), medSint());
  // animação infinita de deslocamento (nome marquee) e autoplay em script
  const css = '@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}';
  const med = medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'marquee', iteracoes: 'infinite', anima: ['transform'] })] } } }) });
  positivo('mov-movimento-automatico-sem-pausa', ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')], scripts: [{ src: null, inline: 'new Swiper(".s",{autoplay:{delay:3000}})' }] }), med, 2 / 3);
});

test('mov-parallax-e-rolagem-sequestrada: data-parallax, background-attachment fixed e listener de scroll somam 3 assinaturas = 1', () => {
  const html = '<div data-parallax="0.4">x</div>';
  const css = '.bg{background-attachment:fixed}';
  const ctx = ctxSint({ html, css, nos: [no('body>h1', 'h1', 'Olá')], scripts: [{ src: null, inline: "window.addEventListener('scroll',function(){el.style.transform='translateY(1px)'})" }] });
  const r = positivo('mov-parallax-e-rolagem-sequestrada', ctx, medSint(), 1);
  assert.match(r.achados[0].mensagem, /Foram achadas 3 assinaturas/);
  // só uma biblioteca (script externo rellax) = 1/3
  const ctxLib = ctxSint({ html: '<script src="/js/rellax.min.js"></script><p>oi</p>', nos: [no('body>p', 'p', 'oi')], scripts: [{ src: '/js/rellax.min.js', inline: '' }] });
  const rl = positivo('mov-parallax-e-rolagem-sequestrada', ctxLib, medSint(), 1 / 3);
  assert.match(rl.achados[0].mensagem, /Foi achada 1 assinatura/);
  negativo('mov-parallax-e-rolagem-sequestrada', ctxSint({ html: '<p>oi</p>', css: 'p{margin:0}', nos: [no('body>p', 'p', 'oi')] }), medSint());
});

test('mov-duracao-fora-da-faixa: transição de 800 ms + entrada de 1200 ms = 0,5; 200 ms e entrada de 600 ms não disparam', () => {
  const css = '.b:hover{transition:transform .8s}@keyframes surgir{from{opacity:0}to{opacity:1}}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const med = medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'surgir', duracaoMs: 1200 })] }, transicoes: { duracoesMs: { '800ms': 2 } } } }) });
  const r = positivo('mov-duracao-fora-da-faixa', ctx, med, 0.5);
  assert.match(r.achados[0].mensagem, /2 durações acima da faixa/);
  const medOk = medSint({ es: es({ movimento: { animacoes: { porNome: [anim({ nome: 'surgir', duracaoMs: 600 })] }, transicoes: { duracoesMs: { '200ms': 4 } } } }) });
  negativo('mov-duracao-fora-da-faixa', ctxSint({ css: '.b:hover{transition:transform .2s}', nos: [no('body>h1', 'h1', 'Olá')] }), medOk);
  // atraso soma à duração: 300 ms + 300 ms de atraso = 600 ms em estado
  positivo('mov-duracao-fora-da-faixa', ctxSint({ css: '.b:focus{transition:opacity .3s ease .3s}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint(), 0.25);
});

test('mov-conteudo-invisivel-sem-js: 8 palavras só visíveis com JS = fração 8/12; opacidade com animação CSS e cru visível não disparam', () => {
  const finais = [no('body>h1', 'h1', 'Titulo fixo'), no('body>div>p', 'p', 'Este texto aparece só depois do script rodar'), no('body>footer>p', 'p', 'Rodape simples')];
  const cruHidden = [no('body>h1', 'h1', 'Titulo fixo'), no('body>div>p', 'p', 'Este texto aparece só depois do script rodar', { visivel: false, ocultoPor: 'visibility:hidden' }), no('body>footer>p', 'p', 'Rodape simples')];
  const ctx = ctxSint({ nos: finais, cruNos: cruHidden });
  const r = positivo('mov-conteudo-invisivel-sem-js', ctx, medSint(), Math.min(1, (8 / 12) / LIMIARES.movimento.semJsFracaoParaMax)); // intensidade é limitada a 1
  assert.match(r.achados[0].mensagem, /8 das 12 palavras visíveis/);
  assert.equal(r.achados[0].citacoes[0].valor, 'Este texto aparece só depois do script rodar');
  negativo('mov-conteudo-invisivel-sem-js', ctxSint({ nos: finais, cruNos: finais }), medSint());
  // 2 palavras: abaixo do mínimo de 5
  const poucas = [no('body>p', 'p', 'Duas palavras', { visivel: false, ocultoPor: 'visibility:hidden' })];
  negativo('mov-conteudo-invisivel-sem-js', ctxSint({ nos: [no('body>p', 'p', 'Duas palavras')], cruNos: poucas }), medSint());
  // opacidade 0 + animação de entrada em CSS (exceção da regra) não conta
  const cruOp = [no('body>div>p', 'p', 'Este texto aparece só depois do script rodar', { visivel: false, ocultoPor: 'opacity:0' })];
  const estilos = { movimento: { animacoes: { porNome: [anim({ nome: 'entrar' })] } } };
  negativo('mov-conteudo-invisivel-sem-js', ctxSint({ nos: [finais[1]], cruNos: cruOp, estilos }), medSint());
  // ...mas opacidade 0 sem animação CSS conta
  positivo('mov-conteudo-invisivel-sem-js', ctxSint({ nos: [finais[1]], cruNos: cruOp }), medSint(), 1);
  // sem a leitura do cru: não avaliável
  assert.equal(rodar('mov-conteudo-invisivel-sem-js', ctxSint({ nos: finais }), medSint()), null);
});

test('mov-video-autoplay-mal-configurado: autoplay sem muted/playsinline/poster = 1; configurado direito não dispara', () => {
  const ctx = ctxSint({ html: '<section><video autoplay loop src="a.mp4"></video></section>', nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-video-autoplay-mal-configurado', ctx, medSint(), 1);
  assert.match(r.achados[0].mensagem, /1 vídeo com autoplay: 1 sem muted, 1 sem playsinline, 1 sem poster perto do topo/);
  negativo('mov-video-autoplay-mal-configurado', ctxSint({ html: '<video autoplay muted playsinline poster="p.jpg" src="a.mp4"></video>', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  negativo('mov-video-autoplay-mal-configurado', ctxSint({ html: '<video controls src="a.mp4"></video>', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  // 1 de 2 vídeos problemático = 0,5; o segundo, com poster ausente mas longe do topo (depois de 2 seções), não conta o poster
  const html = '<video autoplay muted playsinline poster="p.jpg"></video><section></section><section></section><video autoplay muted playsinline></video><video autoplay playsinline muted poster="p.jpg"></video><video autoplay loop poster="x.jpg" muted></video>';
  const r2 = rodar('mov-video-autoplay-mal-configurado', ctxSint({ html, nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  assert.equal(r2.disparou, true);
  perto(r2.intensidade, 1 / 4, 1e-9); // só o último (sem playsinline); o sem poster longe do topo não conta
});

test('mov-gif-animado-no-lugar-de-video: GIF de 400 px e 200 KB = 1/3; leve, estreito ou sem peso conhecido', () => {
  const gif = (o) => ({ seletor: 'body>img', src: 'http://t.test/img/demo%20animado.gif', alt: '', visivel: true, clone: false, renderW: 400, renderH: 300, ...o });
  const ctx = (img, bytes) => ctxSint({ html: '<img src="img/demo animado.gif">', nos: [no('body>h1', 'h1', 'Olá')], imagens: [img], requisicoes: bytes === undefined ? [] : [{ url: img.src, status: 200, tipo: 'image', mime: 'image/gif', bytes }] });
  const r = positivo('mov-gif-animado-no-lugar-de-video', ctx(gif(), 200 * 1024), medSint(), 1 / 3);
  assert.match(r.achados[0].mensagem, /1 GIF exibido com 200 px ou mais de largura e 100 KB ou mais \(maior: demo animado\.gif, 200 KB, 400 px de largura\)/);
  negativo('mov-gif-animado-no-lugar-de-video', ctx(gif(), 50 * 1024), medSint());
  negativo('mov-gif-animado-no-lugar-de-video', ctx(gif({ renderW: 150 }), 500 * 1024), medSint());
  negativo('mov-gif-animado-no-lugar-de-video', ctxSint({ html: '<img src="a.png">', nos: [no('body>h1', 'h1', 'Olá')], imagens: [gif({ src: 'http://t.test/a.png' })] }), medSint());
  assert.equal(rodar('mov-gif-animado-no-lugar-de-video', ctx(gif(), undefined), medSint()), null, 'GIF sem peso conhecido: não avaliável');
});

test('mov-cascata-de-atrasos-longa: 8 atrasos até 800 ms = máx(0,25; 2/12; 440/1080); 3 itens até 300 ms não disparam', () => {
  const regrasCss = (n, passo) => Array.from({ length: n }, (_, i) => `.l li:nth-child(${i + 1}){animation-delay:${(i + 1) * passo}s}`).join('');
  const ctx = ctxSint({ css: regrasCss(8, 0.1), nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('mov-cascata-de-atrasos-longa', ctx, medSint(), 440 / 1080);
  assert.match(r.achados[0].mensagem, /cascata de 8 atrasos diferentes \(CSS em ".l li"\), com atraso de até 800 ms/);
  negativo('mov-cascata-de-atrasos-longa', ctxSint({ css: regrasCss(3, 0.1), nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  // atrasos no HTML (data-aos-delay) agrupados por classe
  const html = [100, 200, 300, 400, 500].map((d) => `<div class="c" data-aos-delay="${d}">x</div>`).join('');
  const rh = positivo('mov-cascata-de-atrasos-longa', ctxSint({ html, nos: [no('body>h1', 'h1', 'Olá')] }), medSint(), 140 / 1080 > 0.25 ? 140 / 1080 : 0.25);
  assert.match(rh.achados[0].mensagem, /5 atrasos diferentes \(HTML em <div>\), com atraso de até 500 ms/);
  // 7 itens com passo curto: dispara só por quantidade
  const r7 = rodar('mov-cascata-de-atrasos-longa', ctxSint({ css: regrasCss(7, 0.03), nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  assert.equal(r7.disparou, true);
  perto(r7.intensidade, 0.25, 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------------
// LAYOUT E ESPAÇAMENTO
// ---------------------------------------------------------------------------------------------------------------------
test('lay-padding-unico-em-tudo: 80% dos cartões com o mesmo padding e 4+ paddings no CSS = (0,8-0,7)/0,3', () => {
  const css = '.a{padding:5px}.b{padding:10px 20px}.c{padding:24px}.d{padding:7px}';
  const nosCards = nosCartoes('body>div', 5);
  const cards = { total: 5, paddingDominante: '24px', fracaoPaddingDominante: 0.8, nPaddingDistintos: 2, exemplos: [{ seletor: 'body>div>div:nth-of-type(1)', largura: 300, padding: '24px', raio: '12px', sombra: false }] };
  const ctx = ctxSint({ css, nos: nosCards });
  const r = positivo('lay-padding-unico-em-tudo', ctx, medSint({ es: es({ cards }) }), (0.8 - 0.7) / 0.3);
  assert.match(r.achados[0].mensagem, /80% dos 5 blocos em cartão usam o mesmo padding interno \(24px\), num site com 4 valores de padding diferentes/);
  negativo('lay-padding-unico-em-tudo', ctx, medSint({ es: es({ cards: { ...cards, fracaoPaddingDominante: 0.6 } }) }));
  negativo('lay-padding-unico-em-tudo', ctxSint({ css: '.a{padding:24px}.b{padding:8px}', nos: nosCards }), medSint({ es: es({ cards }) })); // só 2 valores distintos
  negativo('lay-padding-unico-em-tudo', ctx, medSint({ es: es({ cards: { ...cards, total: 2 } }) })); // poucos cartões
});

test('lay-espacamento-fora-da-escala: 4 valores fora de múltiplos de 4 px em 5 usos = 0,8; escala regular não dispara', () => {
  const css = '.a{padding:5px 7px}.b{margin:13px 18px}.c{padding:16px}.d{margin:0 1px 2px}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('lay-espacamento-fora-da-escala', ctx, medSint(), 0.8);
  assert.match(r.achados[0].mensagem, /4 valores distintos de margem, padding ou gap fora da escala de múltiplos de 4 px \(5px, 7px, 13px, 18px\), em 4 de 5 usos \(80%\)/);
  negativo('lay-espacamento-fora-da-escala', ctxSint({ css: '.a{padding:8px 12px}.b{margin:16px}.c{gap:1rem}.d{padding:5px 7px 13px}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint()); // só 3 fora
  negativo('lay-espacamento-fora-da-escala', ctxSint({ css: '.a{padding:8px}.b{margin:2rem}.c{gap:.5rem}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  assert.equal(rodar('lay-espacamento-fora-da-escala', ctxSint({ nos: [no('body>h1', 'h1', 'Olá')] }), medSint()), null);
});

test('lay-respiro-curto-entre-secoes: 3 de 3 pares abaixo de 64 px = 1; respiro folgado não dispara', () => {
  const nosS = [no('body>section:nth-of-type(1)>h2', 'h2', 'Um'), no('body>section:nth-of-type(2)>h2', 'h2', 'Dois'), no('body>section:nth-of-type(3)>h2', 'h2', 'Tres'), no('body>section:nth-of-type(4)>h2', 'h2', 'Quatro')];
  const itens = (pt, pb) => [1, 2, 3, 4].map((i) => sec(`body>section:nth-of-type(${i})`, 'section', pt, pb));
  const ctx = ctxSint({ nos: nosS });
  const r = positivo('lay-respiro-curto-entre-secoes', ctx, medSint({ es: es({ secoes: { itens: itens(20, 20) } }) }), 1);
  assert.match(r.achados[0].mensagem, /3 de 3 pares de seções consecutivas ficam com menos de 64 px de respiro/);
  negativo('lay-respiro-curto-entre-secoes', ctx, medSint({ es: es({ secoes: { itens: itens(80, 80) } }) }));
  // cabeçalho e rodapé não entram nos pares; 1 só seção não avalia pares
  negativo('lay-respiro-curto-entre-secoes', ctx, medSint({ es: es({ secoes: { itens: [sec('body>header', 'header', 0, 0), sec('body>section:nth-of-type(1)', 'section', 0, 0)] } }) }));
});

test('lay-ultimo-item-sozinho: 4 itens em 3 colunas = 1; 6 itens em 3 colunas e grade de 1 linha não disparam', () => {
  const nosG = nosCartoes('body>div', 4);
  const ctx = ctxSint({ nos: nosG });
  const mk = (g) => medSint({ es: es({ layout: { grades: [g] } }) });
  const r = positivo('lay-ultimo-item-sozinho', ctx, mk({ seletor: 'body>div', colunas: 3, filhos: 4, gap: '16px' }), 1);
  assert.match(r.achados[0].mensagem, /1 de 1 grade com várias linhas termina com 1 item sozinho na última linha \(primeira: 4 itens em 3 colunas/);
  negativo('lay-ultimo-item-sozinho', ctx, mk({ seletor: 'body>div', colunas: 3, filhos: 6, gap: '16px' }));
  negativo('lay-ultimo-item-sozinho', ctx, mk({ seletor: 'body>div', colunas: 3, filhos: 3, gap: '16px' }));
  negativo('lay-ultimo-item-sozinho', ctx, mk({ seletor: 'body>div', colunas: 1, filhos: 4, gap: '16px' }));
});

test('lay-bloco-de-texto-espremido: mediana de 10 caracteres por linha = (16-10)/16; 40 não dispara', () => {
  const ctx = ctxSint({ nos: [no('body>p', 'p', 'Um texto longo numa coluna estreita demais para ler.')] });
  const mk = (m) => medSint({ es: es({ tipografia: { paragrafos: { amostras: 3, caracteresPorLinhaMediana: m, caracteresPorLinhaMax: m, exemplosLongos: [{ seletor: 'body>p', caracteresPorLinha: m, linhas: 5 }] } } }) });
  const r = positivo('lay-bloco-de-texto-espremido', ctx, mk(10), 0.375);
  assert.match(r.achados[0].mensagem, /mediana de caracteres por linha nos 3 blocos de texto medidos é 10, abaixo do mínimo de 16/);
  negativo('lay-bloco-de-texto-espremido', ctx, mk(40));
  negativo('lay-bloco-de-texto-espremido', ctx, medSint()); // sem parágrafos medidos
});

test('lay-parede-de-texto: seção de 90 palavras em 700 px = 0,5+0,5·(10/15); abertura com 3 blocos antes da ação = 1/3', () => {
  const palavras = (n) => Array.from({ length: n }, (_, i) => `p${i}`).join(' ');
  const nosP = [no('body>section:nth-of-type(1)>h2', 'h2', 'Título da parede'), no('body>section:nth-of-type(1)>p', 'p', palavras(87))]; // 87 + 3 do título = 90 palavras
  const ctx = ctxSint({ nos: nosP });
  const med = (n) => medSint({ es: es({ secoes: { itens: [sec('body>section:nth-of-type(1)', 'section', 40, 40, 700)] } }) });
  const r = positivo('lay-parede-de-texto', ctx, med(), 0.5 + (0.5 * 10) / 15);
  assert.match(r.achados[0].mensagem, /tem 90 palavras visíveis, acima de 80/);
  // 50 palavras: não dispara
  negativo('lay-parede-de-texto', ctxSint({ nos: [no('body>section:nth-of-type(1)>p', 'p', palavras(50))] }), med());
  // seção alta demais (mais de 900 px) não cabe numa tela
  negativo('lay-parede-de-texto', ctx, medSint({ es: es({ secoes: { itens: [sec('body>section:nth-of-type(1)', 'section', 40, 40, 1200)] } }) }));
  // abertura: rótulo + título + frase antes do botão
  const hero = 'body>section:nth-of-type(1)';
  const nosH = [no(`${hero}>p:nth-of-type(1)`, 'p', 'Novidade'), no(`${hero}>h1`, 'h1', 'Título principal'), no(`${hero}>p:nth-of-type(2)`, 'p', 'Frase de apoio'), no(`${hero}>a`, 'a', 'Começar')];
  const html = '<a class="btn" href="#x">Começar</a>';
  const ctxH = ctxSint({ nos: nosH, html, links: [{ seletor: `${hero}>a`, hrefAttr: '#x', href: 'http://t.test/#x', texto: 'Começar', visivel: true, clone: false }] });
  const medH = medSint({ es: es({ layout: { heroes: [{ seletor: hero, tag: 'section', classe: '', textAlign: 'center', alturaPx: 400, temH1: true, topoPx: 0 }] }, secoes: { itens: [sec(hero, 'section', 40, 40, 400)] } }) });
  const rh = positivo('lay-parede-de-texto', ctxH, medH, 1 / 3);
  assert.match(rh.achados[0].mensagem, /Na abertura há 3 blocos de texto antes da primeira ação/);
});

test('lay-dois-sticky-no-topo: 2 elementos sticky com top 0 = 1; só um, ou top diferente de 0, não dispara', () => {
  const css = '.topo{position:sticky;top:0}.aviso{position:sticky;top:0}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const r = positivo('lay-dois-sticky-no-topo', ctx, medSint(), 1);
  assert.match(r.achados[0].mensagem, /prende 2 elementos no topo da tela com top 0 \("\.topo", "\.aviso"\)/);
  negativo('lay-dois-sticky-no-topo', ctxSint({ css: '.topo{position:sticky;top:0}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  negativo('lay-dois-sticky-no-topo', ctxSint({ css: '.topo{position:sticky;top:0}.lateral{position:sticky;top:80px}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  // fixed só conta quando o seletor lembra uma barra do topo; modal fixed não
  negativo('lay-dois-sticky-no-topo', ctxSint({ css: '.topo{position:sticky;top:0}.modal{position:fixed;top:0}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint());
  positivo('lay-dois-sticky-no-topo', ctxSint({ css: '.topo{position:sticky;top:0}.navbar{position:fixed;top:0}', nos: [no('body>h1', 'h1', 'Olá')] }), medSint(), 1);
});

test('lay-espaco-assimetrico-de-secao: 2 de 3 seções com razão 8 = 2/3; uma só seção ou razão pequena não dispara', () => {
  const nosS = [1, 2, 3, 4].map((i) => no(`body>section:nth-of-type(${i})>h2`, 'h2', `Seção ${i}`));
  const hero = 'body>section:nth-of-type(1)';
  const itens = [sec(hero, 'section', 100, 20), sec('body>section:nth-of-type(2)', 'section', 8, 64), sec('body>section:nth-of-type(3)', 'section', 64, 8), sec('body>section:nth-of-type(4)', 'section', 32, 32)];
  const medA = (it) => medSint({ es: es({ layout: { heroes: [{ seletor: hero, tag: 'section', classe: '', textAlign: 'start', alturaPx: 300, temH1: true, topoPx: 0 }] }, secoes: { itens: it } }) });
  const ctx = ctxSint({ nos: nosS });
  const r = positivo('lay-espaco-assimetrico-de-secao', ctx, medA(itens), 2 / 3);
  assert.match(r.achados[0].mensagem, /2 de 3 seções têm padding de cima e de baixo com razão acima de 2\.5 \(razões 8, 8\)/);
  negativo('lay-espaco-assimetrico-de-secao', ctx, medA([itens[0], itens[1], itens[3]])); // só 1 seção assimétrica (a abertura não conta)
  negativo('lay-espaco-assimetrico-de-secao', ctx, medA([itens[0], sec('body>section:nth-of-type(2)', 'section', 32, 48), sec('body>section:nth-of-type(3)', 'section', 40, 40)]));
});

// ---------------------------------------------------------------------------------------------------------------------
// ESTRUTURA PADRÃO
// ---------------------------------------------------------------------------------------------------------------------
const HERO = 'body>section:nth-of-type(1)';
const GRADE = 'body>section:nth-of-type(2)>div';
const heroEs = (textAlign = 'center') => ({ seletor: HERO, tag: 'section', classe: 'hero', textAlign, alturaPx: 400, temH1: true, topoPx: 0 });
function cenarioHeroTres({ textAlign = 'center', cartoes = 3, filhosGrade = 3, larguras = null } = {}) {
  const nos = [no(`${HERO}>h1`, 'h1', 'Título da abertura'), no(`${HERO}>p`, 'p', 'Frase de apoio'), ...nosCartoes(GRADE, cartoes)];
  const exemplos = larguras ? larguras.map((l, i) => ({ seletor: `${GRADE}>div:nth-of-type(${i + 1})`, largura: l, padding: '24px', raio: '12px', sombra: false })) : [];
  const ctx = ctxSint({ nos, headings: [{ nivel: 1, texto: 'Título da abertura', seletor: `${HERO}>h1`, visivel: true, clone: false }] });
  const med = medSint({ es: es({ cards: { total: exemplos.length, exemplos }, layout: { heroes: [heroEs(textAlign)], grades: [{ seletor: GRADE, colunas: 3, filhos: filhosGrade, gap: '24px' }] }, secoes: { itens: [sec(HERO, 'section', 80, 80), sec('body>section:nth-of-type(2)', 'section', 40, 40)] } }) });
  return { ctx, med };
}
test('estr-hero-tres-cards: abertura centralizada + grade 3x3 de mesma estrutura = 1; abertura à esquerda = 0,5; bento, 4 filhos e estrutura diferente não disparam', () => {
  const a = cenarioHeroTres();
  const r = positivo('estr-hero-tres-cards', a.ctx, a.med, 1);
  assert.match(r.achados[0].mensagem, /A abertura tem o texto centralizado e vem seguida de uma grade de 3 colunas com 3 cartões de mesma estrutura/);
  const b = cenarioHeroTres({ textAlign: 'start' });
  positivo('estr-hero-tres-cards', b.ctx, b.med, 0.5);
  const iguais = cenarioHeroTres({ larguras: [400, 400, 400] });
  positivo('estr-hero-tres-cards', iguais.ctx, iguais.med, 1);
  const bento = cenarioHeroTres({ larguras: [700, 300, 300] });
  negativo('estr-hero-tres-cards', bento.ctx, bento.med);
  const quatro = cenarioHeroTres({ cartoes: 4, filhosGrade: 4 });
  negativo('estr-hero-tres-cards', quatro.ctx, quatro.med);
  // cartões com estrutura diferente (o 3º não tem parágrafo)
  const c = cenarioHeroTres();
  c.ctx.paginas[0].final.extr.nos = c.ctx.paginas[0].final.extr.nos.filter((n) => n.seletor !== `${GRADE}>div:nth-of-type(3)>p`);
  negativo('estr-hero-tres-cards', c.ctx, c.med);
  // grade longe da abertura (3ª seção depois) não conta
  const d = cenarioHeroTres();
  d.med.css.dados.paginas[0].computado.secoes.itens = [sec(HERO, 'section', 80, 80), sec('body>section:nth-of-type(5)', 'section', 8, 8), sec('body>section:nth-of-type(6)', 'section', 8, 8), sec('body>section:nth-of-type(7)', 'section', 8, 8), sec('body>section:nth-of-type(2)', 'section', 40, 40)];
  negativo('estr-hero-tres-cards', d.ctx, d.med);
});

test('estr-cartoes-iguais-repetidos: 2 grades de cartões (fora a da abertura) = 1/3; 1 grade não dispara', () => {
  const nos = [...nosCartoes('body>section:nth-of-type(1)>ul', 3, { tag: 'li', titulo: 'h4', texto: 'p', prefixo: 'Plano' }), ...nosCartoes('body>section:nth-of-type(2)>div', 4)];
  const ctx = ctxSint({ nos });
  const r = positivo('estr-cartoes-iguais-repetidos', ctx, medSint(), 1 / 3);
  assert.match(r.achados[0].mensagem, /Há 2 grades ou listas com 3 ou mais cartões de mesma estrutura/);
  negativo('estr-cartoes-iguais-repetidos', ctxSint({ nos: nosCartoes('body>section>div', 4) }), medSint());
  // 4 grades = (4-1)/3 = 1
  const nos4 = [1, 2, 3, 4].flatMap((i) => nosCartoes(`body>section:nth-of-type(${i})>div`, 3));
  positivo('estr-cartoes-iguais-repetidos', ctxSint({ nos: nos4 }), medSint(), 1);
  // a grade logo abaixo da abertura não entra na conta
  const hero = cenarioHeroTres();
  hero.ctx.paginas[0].final.extr.nos.push(...nosCartoes('body>section:nth-of-type(3)>div', 3));
  negativo('estr-cartoes-iguais-repetidos', hero.ctx, hero.med);
  // cartões sem título (só texto) ou com parágrafo longo (mais de 25 palavras) não são "cartão ícone-título-frase"
  const longo = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
  const nosLongos = [1, 2, 3].flatMap((i) => [no(`body>div>div:nth-of-type(${i})>h3`, 'h3', `T${i}`), no(`body>div>div:nth-of-type(${i})>p`, 'p', longo)]);
  negativo('estr-cartoes-iguais-repetidos', ctxSint({ nos: nosLongos }), medSint());
});

test('estr-card-dentro-de-card: 1 par em 4 cartões = 0,25; sem aninhamento não dispara', () => {
  const nos = [no('body>div>div:nth-of-type(1)>h3', 'h3', 'Externo'), no('body>div>div:nth-of-type(1)>div>p', 'p', 'Interno')];
  const ctx = ctxSint({ nos });
  const cards = { total: 4, aninhados: { total: 1, raioFilhoMaiorQuePai: 0, pares: [{ filho: 'body>div>div:nth-of-type(1)>div', pai: 'body>div>div:nth-of-type(1)' }] } };
  const r = positivo('estr-card-dentro-de-card', ctx, medSint({ es: es({ cards }) }), 0.25);
  assert.match(r.achados[0].mensagem, /1 cartão está dentro de outro cartão, num total de 4 cartões/);
  negativo('estr-card-dentro-de-card', ctx, medSint({ es: es({ cards: { total: 4, aninhados: { total: 0, pares: [] } } }) }));
  negativo('estr-card-dentro-de-card', ctx, medSint({ es: es() })); // sem cartões
  // 2 pares em 2 cartões = 1
  positivo('estr-card-dentro-de-card', ctx, medSint({ es: es({ cards: { total: 2, aninhados: { total: 2, pares: cards.aninhados.pares } } }) }), 1);
});

test('estr-centralizar-tudo: 8 de 10 blocos centralizados = (0,8-0,6)/0,4 = 0,5; 5 de 10 não dispara', () => {
  const ctx = ctxSint({ nos: [no('body>h1', 'h1', 'Título'), no('body>p', 'p', 'Texto')] });
  const mk = (c, b) => medSint({ es: es({ layout: { centralizacao: { blocos: b, centralizados: c, fracao: c / b, exemplos: ['body>h1', 'body>p'] } } }) });
  const r = positivo('estr-centralizar-tudo', ctx, mk(8, 10), 0.5);
  assert.match(r.achados[0].mensagem, /8 de 10 blocos de topo \(até 3 níveis de profundidade\) têm o conteúdo centralizado \(80%\)/);
  negativo('estr-centralizar-tudo', ctx, mk(5, 10));
  negativo('estr-centralizar-tudo', ctx, mk(3, 3)); // amostra pequena demais
  positivo('estr-centralizar-tudo', ctx, mk(10, 10), 1);
  // exatamente no limite (0,6) dispara com intensidade 0, como a fórmula da regra
  const lim = rodar('estr-centralizar-tudo', ctx, mk(6, 10));
  assert.equal(lim.disparou, true);
  perto(lim.intensidade, 0, 1e-9);
});

test('estr-hero-centrado-empilhado: abertura centralizada com título, frase e botão e sem imagem = 1; à esquerda, com imagem ou sem botão não dispara', () => {
  const nos = [no(`${HERO}>h1`, 'h1', 'Título'), no(`${HERO}>p`, 'p', 'Frase de apoio'), no(`${HERO}>a`, 'a', 'Começar agora')];
  const html = '<a class="btn" href="#x">Começar agora</a>';
  const links = [{ seletor: `${HERO}>a`, hrefAttr: '#x', href: 'http://t.test/#x', texto: 'Começar agora', visivel: true, clone: false }];
  const mk = (textAlign) => medSint({ es: es({ layout: { heroes: [heroEs(textAlign)] } }) });
  const ctx = ctxSint({ nos, html, links });
  const r = positivo('estr-hero-centrado-empilhado', ctx, mk('center'), 1);
  assert.match(r.achados[0].mensagem, /A abertura tem o texto centralizado \(título, frase de apoio e botão\) e nenhuma imagem dentro dela/);
  negativo('estr-hero-centrado-empilhado', ctx, mk('start'));
  negativo('estr-hero-centrado-empilhado', ctxSint({ nos, html, links, imagens: [{ seletor: `${HERO}>img`, src: 'a.png', visivel: true, clone: false }] }), mk('center'));
  negativo('estr-hero-centrado-empilhado', ctxSint({ nos: nos.slice(0, 2), html: '<p>x</p>' }), mk('center')); // sem botão
});

test('estr-ritmo-uniforme-de-secoes: 3 de 4 seções com o mesmo par de padding = 0,75; todas diferentes não dispara', () => {
  const nosS = [1, 2, 3, 4].map((i) => no(`body>section:nth-of-type(${i})>h2`, 'h2', `Seção ${i}`));
  const ctx = ctxSint({ nos: nosS });
  const mk = (pares) => medSint({ es: es({ secoes: { itens: pares.map(([t, b], i) => sec(`body>section:nth-of-type(${i + 1})`, 'section', t, b)) } }) });
  const r = positivo('estr-ritmo-uniforme-de-secoes', ctx, mk([[96, 96], [96, 96], [96, 96], [40, 80]]), 0.75);
  assert.match(r.achados[0].mensagem, /3 de 4 seções, cabeçalho e rodapé repetem o mesmo padding vertical \(96px em cima e 96px embaixo\)/);
  negativo('estr-ritmo-uniforme-de-secoes', ctx, mk([[96, 96], [80, 64], [48, 48], [40, 80]]));
  negativo('estr-ritmo-uniforme-de-secoes', ctx, mk([[96, 96], [96, 96], [10, 10], [20, 20]])); // só 2 iguais
});

test('estr-esqueleto-hero-beneficios-chamada: abertura + grade de cartões + chamada com 1 botão = 1; com seção extra não dispara', () => {
  const S = (i) => `body>section:nth-of-type(${i})`;
  const nos = [no(`${S(1)}>h1`, 'h1', 'Título da abertura'), no(`${S(1)}>a`, 'a', 'Começar'), ...nosCartoes(S(2), 3), no(`${S(3)}>h2`, 'h2', 'Pronto para começar?'), no(`${S(3)}>a`, 'a', 'Criar conta')];
  const html = '<a class="btn" href="#a">Começar</a><a class="btn" href="#b">Criar conta</a>';
  const links = [{ seletor: `${S(1)}>a`, hrefAttr: '#a', href: 'http://t.test/#a', texto: 'Começar', visivel: true, clone: false }, { seletor: `${S(3)}>a`, hrefAttr: '#b', href: 'http://t.test/#b', texto: 'Criar conta', visivel: true, clone: false }];
  const itens = [sec(S(1), 'section', 64, 64), sec(S(2), 'section', 64, 64), sec(S(3), 'section', 64, 64)];
  const med = (it) => medSint({ es: es({ secoes: { itens: it } }) });
  const ctx = ctxSint({ nos, html, links });
  const r = positivo('estr-esqueleto-hero-beneficios-chamada', ctx, med(itens), 1);
  assert.match(r.achados[0].mensagem, /A página tem 3 seções no corpo e só três tipos/);
  // uma 4ª seção qualquer (preços, perguntas...) afasta o alerta
  const nos4 = [...nos.slice(0, -2), no(`${S(3)}>h2`, 'h2', 'Perguntas frequentes'), no(`${S(3)}>p`, 'p', 'Resposta longa. '.repeat(20)), no(`${S(4)}>h2`, 'h2', 'Pronto para começar?'), no(`${S(4)}>a`, 'a', 'Criar conta')];
  const links4 = [links[0], { ...links[1], seletor: `${S(4)}>a` }];
  negativo('estr-esqueleto-hero-beneficios-chamada', ctxSint({ nos: nos4, html, links: links4 }), med([...itens, sec(S(4), 'section', 64, 64)]));
  // só 2 seções: sem chamada final
  negativo('estr-esqueleto-hero-beneficios-chamada', ctx, med(itens.slice(0, 2)));
  // mais de 5 seções
  negativo('estr-esqueleto-hero-beneficios-chamada', ctx, med([...itens, sec(S(4), 'section', 8, 8), sec(S(5), 'section', 8, 8), sec(S(6), 'section', 8, 8)]));
});

test('estr-abertura-com-numero-grande-e-metricas: 3 pares número+legenda na abertura = 0,75; h1 só número = 1; sem métricas não dispara', () => {
  const metricas = (base) => [['10k+', 'clientes ativos'], ['98%', 'de satisfação'], ['3M+', 'pedidos entregues']].flatMap(([n, l], i) => [no(`${base}>div:nth-of-type(${i + 1})>strong`, 'strong', n), no(`${base}>div:nth-of-type(${i + 1})>span`, 'span', l)]);
  const nos = [no(`${HERO}>h1`, 'h1', 'Título da abertura'), ...metricas(`${HERO}>div`)];
  const med = medSint({ es: es({ layout: { heroes: [heroEs()] }, secoes: { itens: [sec(HERO, 'section', 80, 80, 400)] } }) });
  const headings = [{ nivel: 1, texto: 'Título da abertura', seletor: `${HERO}>h1`, visivel: true, clone: false }];
  const ctx = ctxSint({ nos, headings });
  const r = positivo('estr-abertura-com-numero-grande-e-metricas', ctx, med, 0.75);
  assert.match(r.achados[0].mensagem, /Na primeira dobra há 3 pares de número e legenda curta repetidos/);
  negativo('estr-abertura-com-numero-grande-e-metricas', ctxSint({ nos: [nos[0], ...nosCartoes(`${HERO}>div`, 3)], headings }), med);
  // só 2 métricas
  negativo('estr-abertura-com-numero-grande-e-metricas', ctxSint({ nos: [nos[0], ...metricas(`${HERO}>div`).slice(0, 4)], headings }), med);
  // h1 formado só por número
  const h1num = [{ nivel: 1, texto: '2.500+', seletor: `${HERO}>h1`, visivel: true, clone: false }];
  positivo('estr-abertura-com-numero-grande-e-metricas', ctxSint({ nos: [no(`${HERO}>h1`, 'h1', '2.500+')], headings: h1num }), med, 1);
  // métricas na seção seguinte só contam se a dobra (900 px) ainda não acabou: abertura de 1000 px esconde a seção 2
  const med2 = (h) => medSint({ es: es({ layout: { heroes: [{ ...heroEs(), alturaPx: h }] }, secoes: { itens: [sec(HERO, 'section', 80, 80, h), sec('body>section:nth-of-type(2)', 'section', 40, 40, 300)] } }) });
  const nos2 = [no(`${HERO}>h1`, 'h1', 'Título da abertura'), ...metricas('body>section:nth-of-type(2)>div')];
  positivo('estr-abertura-com-numero-grande-e-metricas', ctxSint({ nos: nos2, headings }), med2(500), 0.75);
  negativo('estr-abertura-com-numero-grande-e-metricas', ctxSint({ nos: nos2, headings }), med2(1000));
});

test('estr-numeracao-de-secoes: 01, 02, 03 em seções diferentes = 0,6; lista ordenada, "passo" ou sequência quebrada não dispara', () => {
  const secoes = (nums) => nums.flatMap((n, i) => [no(`body>section:nth-of-type(${i + 1})>span`, 'span', n), no(`body>section:nth-of-type(${i + 1})>h2`, 'h2', `Título ${i + 1}`)]);
  const r = positivo('estr-numeracao-de-secoes', ctxSint({ nos: secoes(['01', '02', '03']) }), medSint(), 0.6);
  assert.match(r.achados[0].mensagem, /3 seções ou blocos em sequência têm numeração curta \("01", "02", "03"\)/);
  positivo('estr-numeracao-de-secoes', ctxSint({ nos: secoes(['1', '2', '3', '4', '5']) }), medSint(), 1);
  negativo('estr-numeracao-de-secoes', ctxSint({ nos: secoes(['01', '02']) }), medSint());
  negativo('estr-numeracao-de-secoes', ctxSint({ nos: secoes(['01', '03', '05']) }), medSint()); // não é 1,2,3
  const emOl = [1, 2, 3].flatMap((i) => [no(`body>ol>li:nth-of-type(${i})>span`, 'span', `0${i}`)]);
  negativo('estr-numeracao-de-secoes', ctxSint({ nos: emOl }), medSint());
  const comPasso = [1, 2, 3].flatMap((i) => [no(`body>section:nth-of-type(${i})>span`, 'span', `0${i}`), no(`body>section:nth-of-type(${i})>b`, 'b', 'Passo')]);
  negativo('estr-numeracao-de-secoes', ctxSint({ nos: comPasso }), medSint());
  const emTabela = [1, 2, 3].map((i) => no(`body>table>tbody>tr:nth-of-type(${i})>td`, 'td', `0${i}`));
  negativo('estr-numeracao-de-secoes', ctxSint({ nos: emTabela }), medSint());
});

test('estr-rotulo-curto-sobre-titulos: 3 títulos com rótulo curto logo antes = 0,5; 2 rótulos, rótulo longo ou link não disparam', () => {
  const secoes = (n, rotulo = 'Recursos', tag = 'span') => Array.from({ length: n }, (_, i) => [no(`body>section:nth-of-type(${i + 1})>${tag}`, tag, rotulo), no(`body>section:nth-of-type(${i + 1})>h2`, 'h2', `Título ${i + 1}`)]).flat();
  const r = positivo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(3) }), medSint(), 0.5);
  assert.match(r.achados[0].mensagem, /3 títulos \(h1 ou h2\) têm logo antes um rótulo curto de até 6 palavras \("Recursos", "Recursos", "Recursos"\)/);
  positivo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(6) }), medSint(), 1);
  negativo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(2) }), medSint());
  negativo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(3, 'Um rótulo bem mais comprido que o limite de palavras') }), medSint());
  negativo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(3, 'Recursos', 'a') }), medSint()); // link não é rótulo
  negativo('estr-rotulo-curto-sobre-titulos', ctxSint({ nos: secoes(3, 'Recursos', 'time') }), medSint());
});

test('estr-moldura-falsa-de-navegador: trio vermelho/amarelo/verde no CSS + classe = 1; só o trio = 0,7; cores soltas não disparam', () => {
  const css = '.r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}';
  const nos = [no('body>h1', 'h1', 'Olá')];
  const r = positivo('estr-moldura-falsa-de-navegador', ctxSint({ css, nos, html: '<div class="browser-mockup"></div>' }), medSint(), 1);
  assert.match(r.achados[0].mensagem, /as três cores de bolinhas de janela \(#ff5f56, #ffbd2e, #27c93f\) estão no CSS e o HTML usa a classe "browser-mockup"/);
  positivo('estr-moldura-falsa-de-navegador', ctxSint({ css, nos, html: '<div></div>' }), medSint(), 0.7);
  negativo('estr-moldura-falsa-de-navegador', ctxSint({ css: '.r{background:#ff5f56}.y{background:#ffbd2e}', nos, html: '<div></div>' }), medSint());
  positivo('estr-moldura-falsa-de-navegador', ctxSint({ css: '', nos, html: '<div class="mac-dots"></div>' }), medSint(), 0.7);
});

test('estr-ilustracao-generica-de-banco: imagem undraw = 0,7; svg de cena (4 curvas, 3 cores, 200x150) = 0,7; 2 achados = 1; ícone e gráfico não disparam', () => {
  const nos = [no('body>h1', 'h1', 'Olá')];
  const img = { seletor: 'body>img', src: 'http://t.test/img/undraw_rocket.svg', alt: '', visivel: true, clone: false, renderW: 200, renderH: 150 };
  const r = positivo('estr-ilustracao-generica-de-banco', ctxSint({ nos, imagens: [img], html: '<img src="img/undraw_rocket.svg">' }), medSint(), 0.7);
  assert.match(r.achados[0].mensagem, /Foi achada 1 ilustração genérica: imagem de biblioteca de ilustração \(undraw\)/);
  const cena = '<svg viewBox="0 0 200 150" width="200" height="150"><path d="M0 0 C 10 10 20 20 30 30 S 40 40 50 50" fill="#f00"/><path d="M0 0 Q 1 2 3 4" fill="#0f0"/><circle fill="#00f"/></svg>';
  positivo('estr-ilustracao-generica-de-banco', ctxSint({ nos, html: cena }), medSint(), 0.7);
  positivo('estr-ilustracao-generica-de-banco', ctxSint({ nos, imagens: [img], html: `<img src="img/undraw_rocket.svg">${cena}` }), medSint(), 1);
  negativo('estr-ilustracao-generica-de-banco', ctxSint({ nos, html: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M0 0 C 1 1 2 2 3 3 S 4 4 5 5" fill="#f00"/><path d="M0 0 Q 1 2 3 4" fill="#0f0"/><circle fill="#00f"/></svg>' }), medSint());
  negativo('estr-ilustracao-generica-de-banco', ctxSint({ nos, html: cena.replace('<svg ', '<svg aria-label="gráfico de vendas" ') }), medSint());
  negativo('estr-ilustracao-generica-de-banco', ctxSint({ nos, html: '<p>sem imagens</p>' }), medSint());
});

test('estr-fechamento-com-cadastro-de-email: campo de e-mail + botão na última seção = 1; formulário em outra seção ou sem e-mail não dispara', () => {
  const S = (i) => `body>main>section:nth-of-type(${i})`;
  const form = (secao, campos) => ({ seletor: `${S(secao)}>form`, action: null, metodo: 'get', campos, textoAoRedor: 'Assinar', visivel: true, clone: false });
  const campos = [{ tag: 'input', tipo: 'email', nome: 'email' }, { tag: 'button', tipo: 'submit', nome: null }];
  const nos = [no(`${S(1)}>h2`, 'h2', 'Receba novidades'), no(`${S(2)}>h2`, 'h2', 'Fale conosco'), no(`${S(2)}>form>button`, 'button', 'Assinar')];
  const med = medSint({ es: es({ secoes: { itens: [sec(S(1), 'section', 40, 40), sec(S(2), 'section', 40, 40), sec('body>footer', 'footer', 20, 20)] } }) });
  const r = positivo('estr-fechamento-com-cadastro-de-email', ctxSint({ nos, formularios: [form(2, campos)] }), med, 1);
  assert.match(r.achados[0].mensagem, /A última seção antes do rodapé termina com um campo de e-mail e um botão de envio/);
  negativo('estr-fechamento-com-cadastro-de-email', ctxSint({ nos, formularios: [form(1, campos)] }), med); // está na 1ª seção, não na última
  negativo('estr-fechamento-com-cadastro-de-email', ctxSint({ nos, formularios: [form(2, [{ tag: 'input', tipo: 'text', nome: 'nome' }, campos[1]])] }), med);
  negativo('estr-fechamento-com-cadastro-de-email', ctxSint({ nos, formularios: [form(2, [campos[0]])] }), med); // sem botão
  positivo('estr-fechamento-com-cadastro-de-email', ctxSint({ nos, formularios: [form(2, [{ tag: 'input', tipo: 'text', nome: 'user_email' }, { tag: 'input', tipo: 'submit', nome: null }])] }), med, 1);
});

test('estr-abertura-com-botoes-demais: 3 botões na abertura = 1/3; 5 = 1; 2 botões não disparam', () => {
  const botoes = (n) => Array.from({ length: n }, (_, i) => ({ no: no(`${HERO}>a:nth-of-type(${i + 1})`, 'a', `Botão ${i + 1}`), href: `#b${i}` }));
  const monta = (n) => {
    const b = botoes(n);
    return ctxSint({
      nos: [no(`${HERO}>h1`, 'h1', 'Título'), ...b.map((x) => x.no)],
      html: b.map((x) => `<a class="btn" href="${x.href}">${x.no.texto}</a>`).join(''),
      links: b.map((x) => ({ seletor: x.no.seletor, hrefAttr: x.href, href: `http://t.test/${x.href}`, texto: x.no.texto, visivel: true, clone: false })),
    });
  };
  const med = medSint({ es: es({ layout: { heroes: [heroEs()] } }) });
  const r = positivo('estr-abertura-com-botoes-demais', monta(3), med, 1 / 3);
  assert.match(r.achados[0].mensagem, /A abertura tem 3 botões \("Botão 1", "Botão 2", "Botão 3"\)/);
  positivo('estr-abertura-com-botoes-demais', monta(5), med, 1);
  negativo('estr-abertura-com-botoes-demais', monta(2), med);
  // links comuns (sem aparência de botão) não contam
  const comuns = ctxSint({ nos: [no(`${HERO}>h1`, 'h1', 'Título'), ...botoes(4).map((x) => x.no)], html: botoes(4).map((x) => `<a href="${x.href}">${x.no.texto}</a>`).join(''), links: botoes(4).map((x) => ({ seletor: x.no.seletor, hrefAttr: x.href, href: 'http://t.test/', texto: x.no.texto, visivel: true, clone: false })) });
  negativo('estr-abertura-com-botoes-demais', comuns, med);
});

test('achados: nenhuma mensagem afirma autoria por IA e todas ficam em português sem números soltos', () => {
  // varre todas as mensagens geradas nos cenários acima por uma amostra direta
  const css = '.card:hover,.plano:hover,.item:hover{transform:translateY(-4px)}';
  const ctx = ctxSint({ css, nos: [no('body>h1', 'h1', 'Olá')] });
  const r = rodar('mov-hover-igual-em-todos', ctx, medSint());
  for (const a of r.achados) assert.doesNotMatch(a.mensagem, /\b(IA|inteligência artificial|ChatGPT|gerad[oa] por)\b/i);
});

// ---------------------------------------------------------------------------------------------------------------------
// INTEGRAÇÃO: medidores reais + detectores nas fixtures
// ---------------------------------------------------------------------------------------------------------------------
const F = {};
before(async () => {
  for (const nome of ['ia-ruim', 'b-boa', 'k-padrao-completo', 'k-esqueleto']) {
    const { ctx } = await lerFixture(nome, { tipoDeSite: 'landing-page' });
    const med = await executarMedidores(ctx, { ignorar: ['lighthouse', 'axe'] });
    const r = rodarMotor({ ctx, med, regras: REGRAS_LISTA, detectores });
    const v = verificarAchados(r.achados, ctx);
    F[nome] = { ctx, med, r, v, disparadas: r.tells.filter((t) => t.disparou).map((t) => t.regra_id) };
  }
}, { timeout: 180000 });

test('integração: nenhuma regra fica sem detector, sem erro, e as 8 sem dado aparecem como não avaliadas', () => {
  for (const nome of Object.keys(F)) {
    const c = F[nome].r.cobertura;
    assert.deepEqual(c.semDetector, [], `${nome}: regras sem detector`);
    assert.deepEqual(c.comErro, [], `${nome}: detectores com erro`);
    assert.deepEqual([...c.naoAvaliadas].sort(), Object.keys(NAO_AVALIAVEIS).sort(), `${nome}: não avaliadas`);
    assert.equal(c.avaliadas, 37);
    assert.equal(c.perguntasAoModelo, 1);
  }
});

test('integração: TODOS os achados passam no verificador e no schema (citações e números verificados)', () => {
  for (const nome of Object.keys(F)) {
    assert.deepEqual(F[nome].v.descartados.map((d) => `${d.regra_id}: ${d.motivo}`), [], `${nome}: achados descartados`);
    assert.equal(F[nome].v.aprovados.length, F[nome].r.achados.length);
    for (const a of F[nome].r.achados) { const val = validarAchado(a); assert.ok(val.ok, `${nome}/${a.regra_id}: ${val.erros.join('; ')}`); assert.ok(a.citacoes.length > 0, `${nome}/${a.regra_id}: sem citações`); }
  }
});

test('integração ia-ruim: dispara hero+3 cards, card dentro de card, abertura empilhada e sem reduced-motion', () => {
  const d = F['ia-ruim'].disparadas;
  for (const id of ['estr-hero-tres-cards', 'estr-card-dentro-de-card', 'mov-sem-reduced-motion', 'estr-hero-centrado-empilhado']) assert.ok(d.includes(id), `deveria disparar ${id}`);
  const t = Object.fromEntries(F['ia-ruim'].r.tells.map((x) => [x.regra_id, x]));
  assert.equal(t['estr-hero-tres-cards'].intensidade, 1);
  perto(t['estr-card-dentro-de-card'].intensidade, 0.25); // 1 par em 4 cartões
  assert.equal(t['mov-sem-reduced-motion'].intensidade, 1);
  const h = F['ia-ruim'].r.achados.find((a) => a.regra_id === 'estr-hero-tres-cards');
  assert.ok(h.citacoes.some((c) => c.valor.startsWith('Transforme seu negócio')));
});

test('integração ia-ruim: mov-mesma-entrada-em-tudo e estr-centralizar-tudo são avaliadas, mas ficam abaixo do limite da regra', () => {
  // 3 elementos com a mesma entrada (limite da regra: 4) e 4 de 15 blocos centralizados (limite: 0,6)
  const t = Object.fromEntries(F['ia-ruim'].r.tells.map((x) => [x.regra_id, x]));
  assert.equal(t['mov-mesma-entrada-em-tudo'].disparou, false);
  assert.equal(t['estr-centralizar-tudo'].disparou, false);
  const p = F['ia-ruim'].med.css.dados.paginas[0].computado;
  assert.equal(p.movimento.animacoes.porNome[0].elementos, 3);
  assert.ok(3 < LIMIARES.movimento.entradaMinElementos);
  assert.equal(p.layout.centralizacao.centralizados, 4);
  assert.equal(p.layout.centralizacao.blocos, 15);
  assert.ok(p.layout.centralizacao.fracao < LIMIARES.estrutura.centralizarFracaoMin);
});

test('integração b-boa: site feito com cuidado não dispara nenhuma das 37 regras avaliadas', () => {
  assert.deepEqual(F['b-boa'].disparadas, []);
  assert.equal(F['b-boa'].r.achados.length, 0);
});

test('integração k-padrao-completo: dispara as regras de movimento, layout e estrutura, inclusive mesma-entrada e centralizar-tudo', () => {
  const esperadas = [
    'mov-mesma-entrada-em-tudo', 'mov-varias-coreografias-de-rolagem', 'mov-transicao-em-tudo', 'mov-animar-propriedades-de-layout', 'mov-sem-reduced-motion',
    'mov-easing-com-quique', 'mov-hover-igual-em-todos', 'mov-loop-infinito-sem-funcao', 'mov-movimento-automatico-sem-pausa', 'mov-parallax-e-rolagem-sequestrada',
    'mov-duracao-fora-da-faixa', 'mov-conteudo-invisivel-sem-js', 'mov-video-autoplay-mal-configurado', 'mov-cascata-de-atrasos-longa',
    'lay-padding-unico-em-tudo', 'lay-espacamento-fora-da-escala', 'lay-respiro-curto-entre-secoes', 'lay-ultimo-item-sozinho', 'lay-bloco-de-texto-espremido',
    'lay-parede-de-texto', 'lay-dois-sticky-no-topo', 'lay-espaco-assimetrico-de-secao',
    'estr-hero-tres-cards', 'estr-cartoes-iguais-repetidos', 'estr-card-dentro-de-card', 'estr-centralizar-tudo', 'estr-hero-centrado-empilhado', 'estr-ritmo-uniforme-de-secoes',
    'estr-abertura-com-numero-grande-e-metricas', 'estr-numeracao-de-secoes', 'estr-rotulo-curto-sobre-titulos', 'estr-moldura-falsa-de-navegador', 'estr-ilustracao-generica-de-banco',
    'estr-fechamento-com-cadastro-de-email', 'estr-abertura-com-botoes-demais',
  ];
  assert.deepEqual([...F['k-padrao-completo'].disparadas].sort(), [...esperadas].sort());
  const t = Object.fromEntries(F['k-padrao-completo'].r.tells.map((x) => [x.regra_id, x]));
  perto(t['mov-mesma-entrada-em-tudo'].intensidade, 4 / 12); // 4 elementos com a animação "entrar"
  assert.equal(t['estr-centralizar-tudo'].intensidade, 1); // 100% dos blocos centralizados
  perto(t['estr-hero-tres-cards'].intensidade, 1);
  perto(t['mov-varias-coreografias-de-rolagem'].intensidade, 0.5); // 4 padrões de entrada
  perto(t['lay-espaco-assimetrico-de-secao'].intensidade, 2 / 13);
  assert.equal(t['lay-ultimo-item-sozinho'].intensidade, 1);
});

test('integração k-esqueleto: abertura + grade + chamada dispara o esqueleto', () => {
  const d = F['k-esqueleto'].disparadas;
  assert.ok(d.includes('estr-esqueleto-hero-beneficios-chamada'));
  assert.ok(d.includes('estr-hero-tres-cards'));
  assert.ok(!d.includes('estr-cartoes-iguais-repetidos'), 'a única grade é a da abertura');
});

test('integração: o Tell Score separa a página com todos os padrões (alto), o site com padrões isolados e o site cuidadoso (zero)', () => {
  const nota = (n) => calcularTellScore(F[n].r.tells).nota;
  assert.equal(nota('b-boa'), 0);
  assert.ok(nota('ia-ruim') > nota('b-boa'));
  assert.ok(nota('k-padrao-completo') > nota('ia-ruim'), `${nota('k-padrao-completo')} vs ${nota('ia-ruim')}`);
  assert.ok(F['k-padrao-completo'].disparadas.length > 5 * F['ia-ruim'].disparadas.length || F['k-padrao-completo'].disparadas.length >= 30);
});
