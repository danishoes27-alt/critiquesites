import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import { carregarRegras, carregarDetectores, executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { calcularNotaSeo, montarPlanoSeo } from '../lib/seo-nota.mjs';
import { medir as medirSeoGoogle, termoDoTitulo, palavrasSignificativas } from '../lib/medidores/seo-google.mjs';
import { detectores } from '../lib/deteccoes/seo-google.mjs';
import { calcularTellScore } from '../lib/tell-score.mjs';
import { acharPromessaDePosicao } from '../lib/avisos.mjs';

const R = {};
before(async () => {
  const det = await carregarDetectores();
  for (const nome of ['seo-ruim', 'seo-boa']) {
    const caminhos = nome === 'seo-boa' ? ['/', '/sobre.html', '/contato.html'] : ['/', '/contato.html'];
    const { ctx, fechar } = await lerFixture(nome, { caminhos, modo: 'completo', manterAberto: true });
    ctx.rede = { ...ctx.rede, permitirLocal: true };
    const med = await executarMedidores(ctx, { ignorar: ['lighthouse'] });
    await fechar();
    const regras = carregarRegras({ modo: 'completo', tipoDeSite: ctx.site.tipoDeSite });
    const motor = rodarMotor({ ctx, med, regras, detectores: det });
    const verif = verificarAchados(motor.achados, ctx);
    R[nome] = { ctx, med, regras, motor, verif, nota: calcularNotaSeo({ tells: motor.tells, regras, achados: verif.aprovados }) };
  }
}, { timeout: 280000 });

const dispara = (nome) => new Set(R[nome].motor.achados.map((a) => a.regra_id));

test('medidor seo-google: viewport, Open Graph, termo, autor/data e sinais locais medidos por página', () => {
  const ruim = R['seo-ruim'].med['seo-google'].dados;
  const boa = R['seo-boa'].med['seo-google'].dados;
  assert.equal(ruim.paginas[0].viewport.presente, false);
  assert.equal(boa.paginas[0].viewport.presente, true);
  assert.equal(boa.paginas[0].viewport.temWidth, true);
  assert.deepEqual(boa.paginas[0].og.faltando, []);
  assert.deepEqual(ruim.paginas[0].og.faltando, ['og:title', 'og:type', 'og:image', 'og:url']);
  const home = boa.paginas.find((p) => p.caminho === '/');
  assert.equal(home.termo.termo, 'Conserto de bicicletas em São Paulo');
  assert.equal(home.termo.fonte, 'title');
  assert.equal(home.termo.noH1, true);
  assert.deepEqual(home.local.telefones, ['11999991111']);
  assert.equal(home.local.telLinks, 1);
  assert.equal(home.local.mapaIncorporado, true);
  assert.deepEqual(home.local.ceps, ['01234-567']);
  assert.equal(boa.site.linkSobre, true);
  assert.equal(ruim.site.linkSobre, false);
  assert.deepEqual(ruim.site.telefonesDistintos, ['11988882222', '11999991111']);
});

test('seo-ruim: dispara as regras de SEO esperadas (novas e antigas), todas aprovadas pelo verificador', () => {
  const d = dispara('seo-ruim');
  for (const id of ['seo-h1-ausente', 'seo-viewport-ausente', 'seo-open-graph-incompleto', 'seo-titulo-ausente-ou-vazio', 'seo-canonical-ausente', 'seo-links-internos-quebrados', 'seo-local-dados-estruturados-ausentes', 'seo-local-telefone-ou-endereco-divergente', 'seo-local-telefone-sem-link', 'seo-local-sem-mapa', 'seo-eeat-pagina-sobre-ausente', 'seo-local-perfil-empresa-conferir']) assert.ok(d.has(id), `deveria disparar: ${id}`);
  assert.deepEqual(R['seo-ruim'].verif.descartados, []);
});

test('seo-boa: não dispara nenhuma regra nova de SEO (só o que vem do endereço fictício do sitemap)', () => {
  const novas = [...dispara('seo-boa')].filter((id) => R['seo-boa'].regras.find((r) => r.id === id)?.categoria === 'seo-google');
  assert.deepEqual(novas, ['seo-local-perfil-empresa-conferir']); // só o aviso informativo de conferir o Perfil da Empresa
  assert.deepEqual(R['seo-boa'].verif.descartados, []);
});

test('nota de SEO: determinística (mesma entrada, mesma nota) e separa seo-ruim de seo-boa com folga', () => {
  const { nota: ruim } = R['seo-ruim'], { nota: boa } = R['seo-boa'];
  const de = (x) => calcularNotaSeo({ tells: x.motor.tells, regras: x.regras, achados: x.verif.aprovados });
  assert.deepEqual(de(R['seo-ruim']), ruim);
  assert.deepEqual(de(R['seo-boa']), boa);
  assert.ok(boa.nota - ruim.nota >= 30, `folga insuficiente: ${boa.nota} x ${ruim.nota}`);
  assert.ok(boa.nota >= 90 && ruim.nota <= 60);
  assert.equal(ruim.selo, 'opiniao');
  assert.ok(ruim.topo.length === 5 && ruim.topo[0].pontosPerdidos >= ruim.topo[1].pontosPerdidos);
  assert.ok(ruim.topo.every((t) => ['fato', 'regra', 'opiniao', 'nao-verificavel'].includes(t.selo)));
  assert.match(ruim.observacao, /Não mede posição real/);
});

test('a nota de SEO e as outras notas não se misturam: o Tell Score não muda com as regras novas', () => {
  const x = R['seo-ruim'];
  const sem = x.motor.tells.filter((t) => t.categoria !== 'seo-google');
  assert.deepEqual(calcularTellScore(x.motor.tells), calcularTellScore(sem));
  const planoOrdem = montarPlanoSeo(x.nota);
  assert.ok(planoOrdem.length === x.nota.todos.length);
  assert.ok(['alto', 'medio', 'baixo'].includes(planoOrdem[0].impacto));
});

test('nenhuma mensagem, correção ou prompt gerado nas fixtures promete posição no Google', () => {
  for (const nome of ['seo-ruim', 'seo-boa']) {
    const texto = R[nome].verif.aprovados.map((a) => `${a.mensagem} ${a.correcao} ${a.prompt_correcao} ${a.interpretacao?.texto || ''}`).join('\n');
    assert.deepEqual(acharPromessaDePosicao(texto), [], nome);
  }
});

// ---------------- detectores com medidas sintéticas (rápido, sem navegador) ----------------
const pg = (caminho, extra = {}) => ({ url: `http://s.test${caminho}`, caminho, ehHome: caminho === '/', viewport: { presente: true, conteudo: 'width=device-width', temWidth: true, zoomInicialBaixo: false }, og: { presentes: [], faltando: [] }, termo: { termo: 'x', palavras: [], noH1: null, palavrasAusentesNoTexto: [], palavrasDoTexto: 0, fonte: 'title' }, eeat: { autor: true, dataVisivel: true, linksExternos: 1, palavras: 100 }, local: { telefones: [], ceps: [], enderecos: [], telLinks: 0, whatsappLinks: 0, mapaIncorporado: false }, ...extra });
const medDe = (paginas, { site = {}, jsonld = {} } = {}) => ({
  'seo-google': { dados: { paginas, site: { linkSobre: true, telefonesDistintos: [], cepsDistintos: [], tipoDeSite: null, ...site } } },
  seo: { dados: { paginas: paginas.map((p) => ({ url: p.url, final: { h1: { visiveisNaoClone: 1 } } })) } },
  jsonld: { dados: { paginas: paginas.map((p) => ({ url: p.url, final: { jsonld: { tipos: jsonld[p.caminho]?.tipos || [], propriedadesPorTipo: jsonld[p.caminho]?.props || {} } }, cru: null })), site: { final: { tipos: [] }, cru: { tipos: [] } } } },
});
const roda = (id, med, tipo = null) => detectores[id]({ ctx: { site: { tipoDeSite: tipo }, paginas: [] }, med, regra: {} });

test('detector: Product sem offers/review/aggregateRating dispara; com offers não; sem Product no site de loja dispara', () => {
  const m1 = medDe([pg('/p')], { jsonld: { '/p': { tipos: ['Product'], props: { Product: { propriedades: ['name', 'image'] } } } } });
  assert.equal(roda('seo-produto-sem-oferta-ou-avaliacao', m1).disparou, true);
  const m2 = medDe([pg('/p')], { jsonld: { '/p': { tipos: ['Product', 'Offer'], props: { Product: { propriedades: ['name', 'offers'] } } } } });
  assert.equal(roda('seo-produto-sem-oferta-ou-avaliacao', m2).disparou, false);
  assert.equal(roda('seo-produto-sem-dado-estruturado', medDe([pg('/')]), 'loja').disparou, true);
  assert.equal(roda('seo-produto-sem-dado-estruturado', medDe([pg('/')]), 'blog'), null); // não se aplica ao tipo
  assert.equal(roda('seo-produto-sem-oferta-ou-avaliacao', medDe([pg('/')])), null);
});

test('detector: LocalBusiness sem address dispara; negócio local sem LocalBusiness dispara; blog sem artigo dispara', () => {
  const m = medDe([pg('/')], { jsonld: { '/': { tipos: ['LocalBusiness'], props: { LocalBusiness: { propriedades: ['name', 'telephone'] } } } } });
  const r = roda('seo-local-dados-estruturados-incompletos', m);
  assert.equal(r.disparou, true);
  assert.match(r.achados[0].mensagem, /sem address/);
  const local = medDe([pg('/', { local: { telefones: ['11999991111'], ceps: [], enderecos: ['rua das flores 120'], telLinks: 0, whatsappLinks: 0, mapaIncorporado: false } })], { site: { telefonesDistintos: ['11999991111'] } });
  assert.equal(roda('seo-local-dados-estruturados-ausentes', local).disparou, true);
  assert.equal(roda('seo-artigo-sem-dado-estruturado', medDe([pg('/'), pg('/post')]), 'blog').disparou, true);
  assert.equal(roda('seo-artigo-sem-dado-estruturado', medDe([pg('/post')], { jsonld: { '/post': { tipos: ['BlogPosting'], props: {} } } }), 'blog').disparou, false);
});

test('detector E-E-A-T: só avalia páginas que parecem artigo; sem autor, sem data e sem fontes disparam', () => {
  const ruim = pg('/post', { eeat: { autor: false, dataVisivel: false, linksExternos: 0, palavras: 600 } });
  const m = medDe([pg('/'), ruim], { site: { linkSobre: false } });
  for (const id of ['seo-eeat-autor-ausente', 'seo-eeat-data-ausente', 'seo-eeat-sem-fontes-citadas']) assert.equal(roda(id, m, 'blog').disparou, true, id);
  assert.equal(roda('seo-eeat-pagina-sobre-ausente', m, 'blog').disparou, true);
  assert.equal(roda('seo-eeat-pagina-sobre-ausente', m, 'link-na-bio'), null);
  assert.equal(roda('seo-eeat-autor-ausente', medDe([pg('/')]), 'site-institucional'), null); // nenhuma página parece artigo
});

test('detector de termo: palavras do title ausentes do H1 e do texto; páginas curtas não são avaliadas', () => {
  const t = (extra) => pg('/', { termo: { termo: 'Conserto de bicicletas', palavras: ['conserto', 'bicicletas'], noH1: false, palavrasAusentesNoTexto: ['bicicletas'], palavrasDoTexto: 120, fonte: 'title', ...extra } });
  assert.equal(roda('seo-termo-do-title-fora-do-h1', medDe([t()])).disparou, true);
  assert.equal(roda('seo-termo-do-title-fora-do-h1', medDe([t({ noH1: true })])).disparou, false);
  assert.equal(roda('seo-termo-do-title-fora-do-texto', medDe([t()])).disparou, true);
  assert.equal(roda('seo-termo-do-title-fora-do-texto', medDe([t({ palavrasDoTexto: 20 })])), null);
  assert.equal(termoDoTitulo('Conserto de bicicletas | Oficina Modelo'), 'Conserto de bicicletas');
  assert.deepEqual(palavrasSignificativas('Conserto de bicicletas em São Paulo'), ['conserto', 'bicicletas', 'sao', 'paulo']);
});

test('medidor: ReDoS e texto enorme não travam; página sem extrator é ignorada', async () => {
  const t0 = Date.now();
  const html = '<iframe '.repeat(40000) + 'src="x';
  const extr = { url: 'http://s.test/', titulo: 'a', metas: [], links: [], headings: [], nos: [{ texto: 'Rua '.repeat(50000), visivel: true, clone: false }], jsonld: [] };
  const r = await medirSeoGoogle({ site: {}, paginas: [{ url: 'http://s.test/', final: { html, extr } }, { url: 'http://s.test/x' }] });
  assert.equal(r.dados.paginas.length, 1);
  assert.ok(Date.now() - t0 < 4000);
});
