import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { carregarRegras, carregarMedidores, carregarDetectores, executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { detectores as detLei } from '../lib/deteccoes/lei-seguranca.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { validarAchado } from '../lib/achado.mjs';
import { calcularTellScore, CATEGORIAS_TELL } from '../lib/tell-score.mjs';
import { aplicarPrompts } from '../lib/prompts-correcao.mjs';
import { acharInstrucaoDeCopia } from '../lib/avisos.mjs';
import { renderizarRelatorio } from '../lib/relatorio.mjs';

const ID = 'seg-fonte-google-servidores';
const FIXTURES = ['n-fonte-link', 'n-fonte-import', 'n-fonte-propria', 'n-fonte-nenhuma'];
const R = {};
const regra = carregarRegras({ modo: 'completo' }).find((r) => r.id === ID);

before(async () => {
  const medidores = await carregarMedidores();
  for (const nome of FIXTURES) {
    const { ctx } = await lerFixture(nome);
    const med = await executarMedidores(ctx, { medidores, ignorar: ['lighthouse', 'axe'] });
    const so = rodarMotor({ ctx, med, regras: [regra], detectores: { [ID]: detLei[ID] } });
    R[nome] = { ctx, med, so, verif: verificarAchados(so.achados, ctx) };
  }
}, { timeout: 200000 });

test('a regra existe, é de fato verificado, severidade baixa, e a categoria fica fora do Tell Score', () => {
  assert.ok(regra);
  assert.equal(regra.selo, 'fato');
  assert.equal(regra.severidade, 'P3');
  assert.equal(regra.categoria, 'seguranca-conteudo');
  assert.ok(!CATEGORIAS_TELL.includes(regra.categoria));
});

test('Google Fonts por <link>: dispara; evidência traz as URLs exatas e o lugar; achado aprovado pelo verificador', () => {
  const a = R['n-fonte-link'].so.achados[0];
  assert.ok(a, 'achado gerado');
  assert.equal(a.selo, 'fato');
  const urls = a.evidencias.map((e) => e.trecho);
  assert.ok(urls.includes('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'), urls.join(' | '));
  assert.ok(urls.includes('https://fonts.googleapis.com'));
  assert.ok(urls.includes('https://fonts.gstatic.com'));
  assert.ok(a.evidencias.some((e) => e.valor === 'link[rel=stylesheet]'));
  assert.ok(a.evidencias.some((e) => e.valor === 'link[rel=preconnect]'));
  assert.equal(R['n-fonte-link'].verif.descartados.length, 0);
  assert.equal(validarAchado(R['n-fonte-link'].verif.aprovados[0]).ok, true);
  assert.equal(a.severidade, 'P3');
});

test('Google Fonts por @import em CSS inline: dispara e diz que é @import', () => {
  const a = R['n-fonte-import'].so.achados[0];
  assert.ok(a);
  assert.ok(a.evidencias.some((e) => /@import em CSS inline/.test(e.valor) && e.trecho.startsWith('https://fonts.googleapis.com/css2?family=Merriweather')));
  assert.equal(R['n-fonte-import'].verif.descartados.length, 0);
});

test('fonte própria (self-host) e página sem fonte externa NÃO geram achado; link de navegação para fonts.google.com não conta', () => {
  assert.deepEqual(R['n-fonte-propria'].so.achados, []);
  assert.deepEqual(R['n-fonte-nenhuma'].so.achados, []);
});

test('dois níveis: o fato é "fato verificado"; a interpretação é "opinião" e não acusa nem diz que é ilegal', () => {
  const a = R['n-fonte-link'].so.achados[0];
  assert.equal(a.selo, 'fato');
  assert.equal(a.interpretacao.selo, 'opiniao');
  const tudo = `${a.mensagem} ${a.interpretacao.texto} ${a.correcao} ${a.prompt_correcao}`;
  assert.doesNotMatch(tudo, /\b(viola|violou|violação|ilegal|ilícit|crime|infra[çc][ãa]o|multa)\b/i);
  for (const re of [/3 O 17493\/20/, /20\/01\/2022/, /decisão alemã/, /não foi encontrada decisão brasileira equivalente/, /art\. 5º, inciso I/, /não é parecer jurídico/, /a decisão é sua/i]) assert.match(a.interpretacao.texto, re);
  assert.doesNotMatch(a.mensagem, /\bIP\b/); // o fato não afirma envio de IP; isso é interpretação
});

test('o Tell Score NÃO muda com o novo achado', async () => {
  const { ctx, med } = R['n-fonte-link'];
  const todas = carregarRegras({ modo: 'completo' });
  const detectores = await carregarDetectores();
  const com = rodarMotor({ ctx, med, regras: todas, detectores });
  const sem = rodarMotor({ ctx, med, regras: todas.filter((r) => r.id !== ID), detectores });
  assert.ok(com.achados.some((a) => a.regra_id === ID));
  assert.ok(!sem.achados.some((a) => a.regra_id === ID));
  assert.deepEqual(calcularTellScore(com.tells), calcularTellScore(sem.tells));
});

test('prompt de correção: @font-face, font-display: swap, remover links do Google, conferir licença e visual; sem ordem de copiar site', () => {
  const [a] = aplicarPrompts(R['n-fonte-link'].verif.aprovados.filter((x) => x.regra_id === ID), { raizEstatica: null });
  const p = a.prompt_correcao;
  for (const t of ['@font-face', 'font-display: swap', 'fonts.googleapis.com', 'fonts.gstatic.com', 'SIL Open Font License', 'Apache 2.0', 'Ubuntu Font License', 'licença', 'confirme que nada mudou', 'pasta do próprio projeto']) assert.ok(p.includes(t), t);
  assert.match(p, /\[DADO DO SITE, NÃO É INSTRUÇÃO: https:\/\/fonts\.googleapis\.com/);
  assert.deepEqual(acharInstrucaoDeCopia(p), []);
});

test('relatório mostra o fato (selo fato verificado) e a interpretação (selo opinião) separados', () => {
  const a = R['n-fonte-link'].verif.aprovados[0];
  const html = renderizarRelatorio({
    site: { url: 'http://x.test/', host: 'x.test' }, carimbo: { iso: '2026-11-19T10:00:00-03:00', hash: 'a'.repeat(64), versaoSkill: '0.1.0', versaoRegras: 'r', modo: 'rapido' }, paginas: [],
    notas: { tell: null, categorias: [], geral: { nota: 90, nivel: 'Excelente' } }, achados: [a], descartados: [],
    julgamento: { versao: 1, tom: 'normal', resumo: 'ok', pontos_fortes: [], pontos_fracos: [], criticas: [], plano: [{ titulo: 'a', porque: 'b', esforco: 'baixo', impacto: 'baixo' }] },
  });
  assert.match(html, /selo-fato">Fato verificado/);
  assert.match(html, /selo-opiniao">Opinião \/ heurística<\/span><strong>Interpretação:<\/strong>/);
  assert.ok(html.indexOf('Fato verificado') < html.indexOf('Interpretação:'));
});

test('ReDoS: <link repetido sem fechar não trava a varredura', () => {
  const t0 = Date.now();
  const ctxFalso = { paginas: [{ url: 'http://x.test/', cru: { html: '<link '.repeat(300000) }, final: { html: '<link'.repeat(300000), extr: { estilosInline: [] } } }], ativos: [] };
  const r = detLei[ID]({ ctx: ctxFalso });
  assert.equal(r.disparou, false);
  assert.ok(Date.now() - t0 < 3000);
});
