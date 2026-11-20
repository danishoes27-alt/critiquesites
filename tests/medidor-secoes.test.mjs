import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as secoes from '../lib/medidores/secoes.mjs';
import { carregarSecoes, normalizarSecao, TIPOS_DE_SITE, DIR_REGRAS_SECOES } from '../lib/secoes-carregador.mjs';

const FONTE = [{ nome: 'teste', url: 'https://exemplo.test/', licenca: 'teste', data_consulta: '2026-11-18' }];
const sec = (id, det, extra = {}) => ({
  id, tipo_de_site: 'loja', nome: `Seção ${id}`, descricao: 'Descrição de teste para a seção esperada da loja.', obrigatoriedade: 'essencial', peso: 8,
  deteccao: { seletores: [], palavras: [], padroes_regex: [], onde: 'qualquer-pagina', detectavel_por_script: 'sim', ...det },
  fonte: FONTE, confianca: 'media', notas: '', ...extra,
});

let dir, dirVazio, fx;
const REGRAS = [
  sec('trocas-e-devolucoes', { palavras: ['trocas e devoluções', 'troca', 'devolução'], onde: 'pagina-propria' }),
  sec('formas-de-pagamento', { palavras: ['formas de pagamento', 'pix', 'boleto', 'cartão de crédito'], padroes_regex: ['\\bpix\\b'], seletores: ['.formas-pagamento', 'footer'] }),
  sec('identificacao-do-fornecedor', { padroes_regex: ['\\b\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}\\b'], palavras: ['cnpj'] }),
  sec('contato-por-email', { seletores: ['a[href^="mailto:"]'] }),
  sec('cupom-de-desconto', { palavras: ['cupom de desconto'] }, { obrigatoriedade: 'opcional', peso: 2 }),
  sec('avaliacoes-de-clientes', { palavras: ['avaliações', 'o que dizem'], detectavel_por_script: 'nao' }, { obrigatoriedade: 'esperada' }),
  sec('selo-de-seguranca', { palavras: ['selo de segurança'], seletores: ['footer'], detectavel_por_script: 'parcial', onde: 'home' }, { obrigatoriedade: 'esperada' }),
  sec('politica-de-privacidade', { palavras: ['política de privacidade', 'lgpd'] }),
  { id: 'regra-minima', nome: 'Só id e nome' },
  { nome: 'sem id, deve ser descartada' },
];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cs-secoes-'));
  writeFileSync(join(dir, 'loja.json'), JSON.stringify(REGRAS), 'utf8');
  dirVazio = mkdtempSync(join(tmpdir(), 'cs-secoes-vazio-'));
  fx = await lerFixture('e-loja', { caminhos: ['/', '/trocas-e-devolucoes.html'], tipoDeSite: 'loja', manterAberto: true, buscarAtivos: false });
});
after(async () => {
  await fx?.fechar();
  for (const d of [dir, dirVazio]) if (d) rmSync(d, { recursive: true, force: true });
});

const porId = (r) => Object.fromEntries(r.dados.secoes.map((s) => [s.id, s]));

test('carregador: normaliza tolerando campos ausentes e descarta seção sem id', () => {
  const c = carregarSecoes('loja', { dirRegras: dir });
  assert.equal(c.erro, undefined);
  assert.equal(c.secoes.length, REGRAS.length - 1);
  const minima = c.secoes.find((s) => s.id === 'regra-minima');
  assert.equal(minima.obrigatoriedade, 'esperada');
  assert.equal(minima.peso, 5);
  assert.deepEqual(minima.deteccao.palavras, []);
  assert.equal(minima.deteccao.onde, 'qualquer-pagina');
  assert.equal(minima.deteccao.detectavel_por_script, 'parcial');
  assert.ok(c.avisos.some((a) => /sem id/.test(a)));
  assert.ok(c.avisos.some((a) => /regra-minima/.test(a)));
});

test('carregador: tipo desconhecido, arquivo ausente e JSON inválido viram {erro}, sem lançar', () => {
  assert.match(carregarSecoes('tipo-que-nao-existe').erro, /desconhecido/);
  assert.match(carregarSecoes('../../etc/passwd').erro, /desconhecido/);
  assert.match(carregarSecoes('blog', { dirRegras: dirVazio }).erro, /não encontrado/);
  writeFileSync(join(dirVazio, 'cardapio.json'), '{ isto não é json', 'utf8');
  assert.match(carregarSecoes('cardapio', { dirRegras: dirVazio }).erro, /JSON inválido/);
  writeFileSync(join(dirVazio, 'portfolio.json'), '{"a": 1}', 'utf8');
  assert.match(carregarSecoes('portfolio', { dirRegras: dirVazio }).erro, /formato inesperado/);
  assert.equal(normalizarSecao(42).secao, null);
});

test('carregador: aceita o formato {secoes:[...]} e repara valores inválidos', () => {
  writeFileSync(join(dirVazio, 'blog.json'), JSON.stringify({ secoes: [{ id: 'a-b', nome: 'Seção A', peso: 99, obrigatoriedade: 'urgente', deteccao: { onde: 'lugar-nenhum', palavras: ['x', 3, ''], padroes_regex: ['('] } }, { id: 'a-b', nome: 'repetida' }] }), 'utf8');
  const c = carregarSecoes('blog', { dirRegras: dirVazio });
  assert.equal(c.secoes.length, 1);
  assert.equal(c.secoes[0].peso, 10);
  assert.equal(c.secoes[0].obrigatoriedade, 'esperada');
  assert.deepEqual(c.secoes[0].deteccao.palavras, ['x']);
  assert.ok(c.avisos.some((a) => /repetido/.test(a)));
});

test('carregador: os JSONs oficiais de regras/secoes carregam para os 11 tipos', () => {
  for (const tipo of TIPOS_DE_SITE) {
    const c = carregarSecoes(tipo, { dirRegras: DIR_REGRAS_SECOES });
    assert.equal(c.erro, undefined, `${tipo}: ${c.erro}`);
    assert.ok(c.secoes.length > 0, `${tipo}: sem seções`);
  }
});

test('secoes: loja com "trocas e devoluções" presente e "formas de pagamento" ausente', async () => {
  assert.equal(secoes.id, 'secoes');
  const r = await secoes.medir(fx.ctx, { dirRegras: dir });
  assert.equal(r.id, 'secoes');
  const s = porId(r);
  assert.equal(r.dados.tipoDeSite, 'loja');
  assert.equal(s['trocas-e-devolucoes'].encontrada, true);
  assert.equal(s['formas-de-pagamento'].encontrada, false);
  assert.equal(s['formas-de-pagamento'].ausenciaConfiavel, true);
  // jamais afirmar ausência sem listar as páginas inspecionadas
  assert.deepEqual(s['formas-de-pagamento'].paginasInspecionadas, ['/', '/trocas-e-devolucoes.html']);
  assert.deepEqual(r.dados.paginasInspecionadas, ['/', '/trocas-e-devolucoes.html']);
  const ev = r.evidencias.find((e) => e.valor === 'formas-de-pagamento');
  assert.equal(ev.contagem, 0);
  assert.match(ev.trecho, /\/trocas-e-devolucoes\.html/);
  // o rodapé existe: aparece como candidato (dica de onde olhar), mas não prova nada
  assert.ok(s['formas-de-pagamento'].candidatos.some((c) => c.tipo === 'dica-seletor'));
});

test('secoes: ocorrências trazem página, via, termo e trecho', async () => {
  const r = await secoes.medir(fx.ctx, { dirRegras: dir });
  const t = porId(r)['trocas-e-devolucoes'];
  assert.ok(t.ocorrencias.length >= 2);
  const paginas = new Set(t.ocorrencias.map((o) => o.pagina));
  assert.ok(paginas.has('/') && paginas.has('/trocas-e-devolucoes.html'), [...paginas].join(','));
  assert.ok(t.ocorrencias.some((o) => o.via === 'heading' && /trocas e devoluções/i.test(o.trecho)));
  assert.ok(t.ocorrencias.every((o) => o.visivel === true && o.trecho));
  const ev = r.evidencias.find((e) => e.valor === 'trocas-e-devolucoes');
  assert.equal(ev.versao, 'final');
  assert.equal(ev.visivel, true);
});

test('secoes: pagina-propria também é achada só pelo link, lendo apenas a home', async () => {
  const soHome = { ...fx.ctx, paginas: [fx.ctx.paginas[0]] };
  const r = await secoes.medir(soHome, { dirRegras: dir });
  const t = porId(r)['trocas-e-devolucoes'];
  assert.equal(t.encontrada, true);
  assert.ok(t.ocorrencias.some((o) => o.via === 'link' || o.via === 'href'));
  assert.deepEqual(t.paginasInspecionadas, ['/']);
});

test('secoes: padrão regex (CNPJ) e seletor específico sem palavras', async () => {
  const s = porId(await secoes.medir(fx.ctx, { dirRegras: dir }));
  assert.equal(s['identificacao-do-fornecedor'].encontrada, true);
  assert.ok(s['identificacao-do-fornecedor'].ocorrencias.some((o) => o.tipo === 'regex' && /12\.345\.678\/0001-90/.test(o.trecho)));
  assert.equal(s['contato-por-email'].encontrada, true);
  assert.ok(s['contato-por-email'].ocorrencias.some((o) => o.tipo === 'seletor' && /oi@lunar\.example/.test(o.trecho)));
});

test('secoes: texto oculto não conta como visível (indeterminada, com o candidato)', async () => {
  const s = porId(await secoes.medir(fx.ctx, { dirRegras: dir }));
  assert.equal(s['cupom-de-desconto'].encontrada, 'indeterminada');
  assert.match(s['cupom-de-desconto'].motivo, /oculto/);
  assert.ok(s['cupom-de-desconto'].candidatos.some((c) => c.visivel === false && /cupom de desconto/i.test(c.trecho)));
});

test('secoes: detectavel_por_script "nao" sempre devolve indeterminada; parcial com dica também', async () => {
  const s = porId(await secoes.medir(fx.ctx, { dirRegras: dir }));
  assert.equal(s['avaliacoes-de-clientes'].encontrada, 'indeterminada');
  assert.ok(Array.isArray(s['avaliacoes-de-clientes'].candidatos));
  assert.equal(s['avaliacoes-de-clientes'].ausenciaConfiavel, false);
  assert.equal(s['selo-de-seguranca'].encontrada, 'indeterminada'); // só o <footer> como dica
  assert.deepEqual(s['selo-de-seguranca'].paginasInspecionadas, ['/']); // onde: 'home'
});

test('secoes: seção ausente de verdade, regra sem critérios e resumo', async () => {
  const r = await secoes.medir(fx.ctx, { dirRegras: dir });
  const s = porId(r);
  assert.equal(s['politica-de-privacidade'].encontrada, false);
  assert.equal(s['regra-minima'].encontrada, 'indeterminada');
  assert.equal(r.dados.secoes.length, REGRAS.length - 1);
  const res = r.dados.resumo;
  assert.equal(res.total, 9);
  assert.equal(res.encontradas, 3); // trocas, fornecedor, e-mail
  assert.equal(res.ausentes, 2); // pagamento, privacidade
  assert.equal(res.indeterminadas, 4); // cupom, avaliações, selo, regra mínima
  assert.deepEqual(res.essenciaisAusentes.sort(), ['formas-de-pagamento', 'politica-de-privacidade']);
  assert.equal(res.pesoEncontrado, 24);
  assert.ok(r.dados.avisos.some((a) => /sem id/.test(a)));
});

test('secoes: sem tipo de site, tipo sem arquivo e sem páginas devolvem indisponível', async () => {
  const semTipo = await secoes.medir({ ...fx.ctx, site: { ...fx.ctx.site, tipoDeSite: null } }, { dirRegras: dir });
  assert.equal(semTipo.dados.indisponivel, 'tipo de site não definido');
  const semArquivo = await secoes.medir({ ...fx.ctx, site: { ...fx.ctx.site, tipoDeSite: 'agendamento' } }, { dirRegras: dirVazio });
  assert.match(semArquivo.dados.indisponivel, /não encontrado/);
  const semPaginas = await secoes.medir({ site: { tipoDeSite: 'loja' }, paginas: [] }, { dirRegras: dir });
  assert.match(semPaginas.dados.indisponivel, /nenhuma página/);
});

test('secoes: sem navegador, avalia só texto e avisa que os seletores não foram avaliados', async () => {
  const r = await secoes.medir({ ...fx.ctx, navegador: null }, { dirRegras: dir });
  const s = porId(r);
  assert.equal(s['trocas-e-devolucoes'].encontrada, true);
  assert.ok(r.dados.avisos.some((a) => /seletores CSS não foram avaliados/.test(a)));
  // regra só com seletor e sem navegador: NÃO pode virar "ausente"
  assert.equal(s['contato-por-email'].encontrada, 'indeterminada');
  assert.match(s['contato-por-email'].motivo, /seletores CSS/);
  assert.equal(s['formas-de-pagamento'].encontrada, false);
  assert.equal(s['formas-de-pagamento'].ausenciaConfiavel, false); // havia seletores não avaliados
  assert.ok(s['contato-por-email'].paginasInspecionadas.length > 0);
});

test('secoes: as seções públicas reais (regras/secoes/loja.json) roda sem erro na fixture e-loja', async () => {
  const r = await secoes.medir(fx.ctx);
  assert.equal(r.dados.indisponivel, undefined);
  assert.ok(r.dados.secoes.length >= 10);
  const s = porId(r);
  assert.equal(s['trocas-e-devolucoes'].encontrada, true);
  assert.equal(s['identificacao-do-fornecedor'].encontrada, true);
  for (const x of r.dados.secoes) assert.ok(x.paginasInspecionadas.length > 0);
});
