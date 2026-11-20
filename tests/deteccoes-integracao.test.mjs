// Integração dos detectores: medidores reais + detectores reais + verificador de citações, em fixtures.
// Cobre os detectores de performance/SEO, visuais e de texto/conteúdo (que também têm testes próprios por módulo, quando existem).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { carregarRegras, carregarMedidores, carregarDetectores, executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { validarAchado } from '../lib/achado.mjs';
import { calcularTellScore } from '../lib/tell-score.mjs';

const FIXTURES = ['ia-ruim', 'b-boa', 'exemplo1', 'c-texto-batido', 'c-texto-bom', 'lazy', 'oculto', 'carrossel-clone', 'legal', 'e-a11y-ruim', 'site-12', 'contador-css', 'contador-reestruturado'];
const R = {}; // nome -> { motor, verif, tell, ctx }
let detectores;

before(async () => {
  detectores = await carregarDetectores();
  const medidores = await carregarMedidores();
  const regras = carregarRegras({ modo: 'completo' });
  for (const nome of FIXTURES) {
    const { ctx, fechar } = await lerFixture(nome, { manterAberto: true });
    try {
      const med = await executarMedidores(ctx, { medidores, ignorar: ['lighthouse'] });
      const motor = rodarMotor({ ctx, med, regras, detectores });
      R[nome] = { ctx, med, motor, verif: verificarAchados(motor.achados, ctx), tell: calcularTellScore(motor.tells) };
    } finally { await fechar(); }
  }
}, { timeout: 280000 });

const regrasDe = (nome) => new Set(R[nome].motor.achados.map((a) => a.regra_id));

test('cobertura: toda regra de script/misto tem detector (nenhuma "sem detector")', () => {
  const regras = carregarRegras({ modo: 'completo' });
  const sem = regras.filter((r) => r.deteccao.tipo !== 'julgamento' && !detectores[r.id]).map((r) => r.id);
  assert.deepEqual(sem, []);
  assert.ok(regras.filter((r) => r.deteccao.tipo !== 'julgamento').length > 200);
});

test('nenhum detector lança erro em nenhuma fixture; nenhum medidor falha', () => {
  for (const nome of FIXTURES) {
    assert.deepEqual(R[nome].motor.cobertura.comErro, [], nome);
    assert.deepEqual(Object.values(R[nome].med).filter((m) => m.erro).map((m) => `${m.id}: ${m.erro}`), [], nome);
  }
});

test('TODOS os achados gerados são aprovados pelo verificador de citações e validam no esquema', () => {
  for (const nome of FIXTURES) {
    assert.deepEqual(R[nome].verif.descartados.map((d) => `${d.regra_id}: ${d.motivo}`), [], nome);
    for (const a of R[nome].verif.aprovados) assert.equal(validarAchado(a).ok, true, `${nome} ${a.regra_id}: ${validarAchado(a).erros}`);
  }
});

test('separação: ia-ruim tem Tell Score alto, b-boa baixo, e a diferença passa de 20 pontos', () => {
  assert.ok(R['ia-ruim'].tell.nota >= 45, `ia-ruim ${R['ia-ruim'].tell.nota}`);
  assert.ok(R['b-boa'].tell.nota <= 15, `b-boa ${R['b-boa'].tell.nota}`);
  assert.ok(R['ia-ruim'].tell.nota - R['b-boa'].tell.nota >= 20);
});

test('visual: ia-ruim dispara os sinais de visual genérico; b-boa não dispara os principais', () => {
  const ia = regrasDe('ia-ruim');
  for (const id of ['cor-roxo-indigo-padrao', 'cor-gradiente-azul-roxo', 'tipo-fonte-padrao', 'tipo-texto-gradiente', 'sup-card-dentro-de-card', 'sup-sombra-difusa-padrao', 'sup-raio-unico-em-tudo', 'estr-hero-tres-cards', 'icone-emoji-como-icone', 'mov-sem-reduced-motion']) assert.ok(ia.has(id), `ia-ruim deveria disparar ${id}`);
  const boa = regrasDe('b-boa');
  for (const id of ['cor-roxo-indigo-padrao', 'tipo-fonte-padrao', 'estr-hero-tres-cards', 'sup-card-dentro-de-card', 'icone-emoji-como-icone', 'tipo-texto-gradiente']) assert.ok(!boa.has(id), `b-boa não deveria disparar ${id}`);
});

test('texto: c-texto-batido dispara headline vago e CTAs genéricos; c-texto-bom não dispara regras de texto genérico', () => {
  const batido = regrasDe('c-texto-batido');
  assert.ok(batido.has('txt-headline-vago'));
  assert.ok(batido.has('txt-ctas-genericos'));
  const bom = [...regrasDe('c-texto-bom')].filter((id) => id.startsWith('txt-'));
  assert.deepEqual(bom, []);
  // o veredito nunca fala em autoria por IA
  for (const a of R['c-texto-batido'].motor.achados) assert.ok(!/escrit[oa] por (uma )?(ia|inteligência artificial)/i.test(a.mensagem));
});

test('performance/SEO: lazy dispara a regra de imagem principal com lazy e nunca afirma "sem lazy"; ia-ruim sem meta description', () => {
  assert.ok(regrasDe('lazy').has('perf-lcp-imagem-com-lazy'));
  for (const nome of FIXTURES) for (const a of R[nome].motor.achados) assert.ok(!/\b(sem|n[ãa]o usa)\b[^.]{0,25}lazy/i.test(a.mensagem), `${nome}: ${a.mensagem.slice(0, 80)}`);
  assert.ok(regrasDe('ia-ruim').has('seo-meta-description-ausente-ou-repetida'));
});

test('SEO: dados estruturados — só afirma ausência quando não há nenhum formato; lista os tipos quando há', () => {
  const sem = R['ia-ruim'].motor.achados.find((a) => a.regra_id === 'seo-dados-estruturados-presentes');
  assert.match(sem.mensagem, /Não encontramos dados estruturados/);
  const com = R['exemplo1'].motor.achados.find((a) => a.regra_id === 'seo-dados-estruturados-presentes');
  assert.doesNotMatch(com.mensagem, /Não encontramos dados estruturados/);
  for (const tipo of ['Product', 'Offer', 'FAQPage', 'VideoObject', 'WebSite', 'WebPage']) assert.ok(com.mensagem.includes(tipo), tipo);
});

test('gabarito: texto oculto nunca vira afirmação em regras de texto, conteúdo ou preço', () => {
  for (const nome of ['oculto', 'exemplo1']) {
    const ruins = R[nome].motor.achados.filter((a) => /^(txt|cont|lei-preco|int2-preco)/.test(a.regra_id) && /0\s*%\s*off|oferta encerrada|R\$\s*47\b|100\+/i.test([a.mensagem, ...(a.evidencias || []).map((e) => e.trecho ?? '')].join(' ')));
    assert.deepEqual(ruins.map((a) => a.regra_id), [], nome);
  }
});

test('gabarito: clones aria-hidden do carrossel nunca viram "repetição" nem "duplicado"', () => {
  for (const a of R['carrossel-clone'].motor.achados) assert.ok(!/duplicad|repetid/i.test(a.mensagem) || a.regra_id.startsWith('int2-clone'), `${a.regra_id}: ${a.mensagem.slice(0, 100)}`);
});

test('gabarito: contador animado é apontado tanto quando o JS escreve o texto quanto quando o número é desenhado por CSS', () => {
  for (const nome of ['contador-css', 'contador-reestruturado', 'exemplo1']) {
    const a = R[nome].motor.achados.filter((x) => x.regra_id === 'int2-contador-animado-valor-errado');
    assert.ok(a.length >= 1, nome);
    assert.ok(a.every((x) => x.selo === 'fato' && x.citacoes.length > 0));
  }
});
