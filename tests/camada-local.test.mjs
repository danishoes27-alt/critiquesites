import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carregarSecoes } from '../lib/secoes-carregador.mjs';
import { carregarRegrasLocais, carregarDetectoresLocais, dirLocalPadrao, versaoDaCamadaLocal, arquivoDeSecoesLocais } from '../lib/camada-local.mjs';
import { carregarRegras } from '../lib/motor.mjs';
import { analisar } from '../lib/analisar.mjs';
import { lerJson } from '../lib/util.mjs';
import { estimarCusto } from '../lib/custo.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const fx = join(fixtures, 'secoes-locais-exemplo');
const idsPublicos = () => carregarRegras({ modo: 'completo' }).map((r) => r.id);

test('precedência: a seção local de um tipo vale mais que a pública, com campos opcionais e metadados', () => {
  const pub = carregarSecoes('blog', { dirLocal: null });
  assert.equal(pub.origem, 'publica');
  assert.equal(pub.secoes.length, 12);
  const loc = carregarSecoes('blog', { dirLocal: fx });
  assert.equal(loc.origem, 'local');
  assert.deepEqual(loc.secoes.map((s) => s.id), ['mural-de-avisos', 'cantinho-do-cha']);
  const [a] = loc.secoes;
  assert.deepEqual([a.pagina, a.ordem, a.cta, a.selo, a.obrigatoriedade], ['inicio', 1, 'Ver avisos', 'opiniao', 'essencial']);
  assert.deepEqual(loc.meta.faixas, [{ pagina: 'inicio', min: 3, max: 5 }]);
  assert.equal(loc.erro, undefined);
});

test('fallback: sem a camada local (ou com outro tipo), as seções públicas continuam valendo', () => {
  assert.equal(carregarSecoes('loja', { dirLocal: fx }).origem, 'publica');
  assert.equal(carregarSecoes('loja', { dirLocal: null }).secoes.length > 0, true);
  assert.equal(carregarSecoes('loja', { dirLocal: join(fx, 'nao-existe') }).origem, 'publica');
  // injetar só a pasta pública (teste hermético) desliga a camada local
  assert.equal(carregarSecoes('blog', { dirRegras: join(fixtures, '..', '..', 'regras', 'secoes') }).origem, 'publica');
});

test('tipo que só existe na camada local é aceito; sem ela, erro claro', () => {
  const loc = carregarSecoes('clube-de-leitura', { dirLocal: fx });
  assert.equal(loc.origem, 'local');
  assert.deepEqual(loc.secoes.map((s) => s.obrigatoriedade), ['essencial', 'esperada']);
  const sem = carregarSecoes('clube-de-leitura', { dirLocal: null });
  assert.match(sem.erro, /tipo de site desconhecido/);
});

test('JSON inválido ou vazio na camada local: aviso claro, usa o público, não lança', () => {
  for (const tipo of ['portfolio', 'agendamento']) {
    const r = carregarSecoes(tipo, { dirLocal: fx });
    assert.equal(r.origem, 'publica', tipo);
    assert.equal(r.erro, undefined, tipo);
    assert.ok(r.secoes.length >= 8, tipo);
    assert.match(r.avisos.join(' '), /camada local ignorada/, tipo);
  }
  assert.match(carregarSecoes('portfolio', { dirLocal: fx }).avisos.join(' '), /JSON inválido/);
});

test('nome de tipo não vira caminho de arquivo (sem ../ e sem barras)', () => {
  assert.equal(arquivoDeSecoesLocais('../blog', fx), null);
  assert.equal(arquivoDeSecoesLocais('a/b', fx), null);
  assert.equal(arquivoDeSecoesLocais('blog', null), null);
  assert.match(carregarSecoes('../blog', { dirLocal: fx }).erro, /desconhecido/);
});

test('variável CRITIQUESITES_LOCAL: desliga com "off" ou aponta para outra pasta', () => {
  assert.equal(dirLocalPadrao({ CRITIQUESITES_LOCAL: 'off' }), null);
  assert.equal(dirLocalPadrao({ CRITIQUESITES_LOCAL: 'NAO' }), null);
  assert.match(dirLocalPadrao({ CRITIQUESITES_LOCAL: fx }), /secoes-locais-exemplo$/);
  assert.match(dirLocalPadrao({}), /local$/);
});

test('regras locais: válidas entram; fora do esquema, selo de regra sem fonte https e id repetido viram aviso', () => {
  const r = carregarRegrasLocais({ dirLocal: fx, modo: 'rapido', idsPublicos: idsPublicos() });
  assert.deepEqual(r.regras.map((x) => x.id), ['local-exemplo-palavra-magica', 'local-exemplo-julgamento']);
  const av = r.avisos.join(' | ');
  assert.match(av, /local-exemplo-quebrada.*fora do esquema/);
  assert.match(av, /local-exemplo-selo-sem-fonte.*sem fonte com endereço https/);
  assert.match(av, /estr-ritmo-uniforme-de-secoes repete um id/);
  assert.deepEqual(carregarRegrasLocais({ dirLocal: null }).regras, []);
  assert.deepEqual(carregarRegrasLocais({ dirLocal: join(fx, 'nao-existe') }).regras, []);
  assert.deepEqual(carregarRegrasLocais({ dirLocal: fx, modo: 'completo', tipoDeSite: 'loja', idsPublicos: idsPublicos() }).regras.length, 2);
});

test('detectores locais: carregam; módulo quebrado vira aviso', async () => {
  const ok = await carregarDetectoresLocais({ dirLocal: fx });
  assert.equal(typeof ok.detectores['local-exemplo-palavra-magica'], 'function');
  const tmp = mkdtempSync(join(tmpdir(), 'cs-local-'));
  try {
    mkdirSync(join(tmp, 'deteccoes-x'));
    writeFileSync(join(tmp, 'deteccoes-x', 'ruim.mjs'), 'export const detectores = {');
    const ruim = await carregarDetectoresLocais({ dirLocal: tmp });
    assert.deepEqual(ruim.detectores, {});
    assert.match(ruim.avisos[0], /não consegui carregar/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('versão da camada local: vazia sem ela; muda quando o conteúdo muda (carimbo do relatório)', () => {
  assert.equal(versaoDaCamadaLocal(null), '');
  const v1 = versaoDaCamadaLocal(fx);
  assert.match(v1, /^[0-9a-f]{12}$/);
  const tmp = mkdtempSync(join(tmpdir(), 'cs-local-'));
  try {
    cpSync(fx, tmp, { recursive: true });
    assert.equal(versaoDaCamadaLocal(tmp), v1);
    writeFileSync(join(tmp, 'secoes-por-tipo', 'clube-de-leitura.json'), readFileSync(join(tmp, 'secoes-por-tipo', 'clube-de-leitura.json'), 'utf8').replace('Próximo livro', 'Livro seguinte'));
    assert.notEqual(versaoDaCamadaLocal(tmp), v1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

const R = {};
before(async () => {
  const saidas = mkdtempSync(join(tmpdir(), 'cs-local-an-'));
  const base = { entrada: join(fixtures, 'seo-boa'), saidas, modo: 'rapido', limitePaginas: 1, intervaloMs: 0, ignorarMedidores: ['lighthouse', 'axe'], usarCache: false, tipoInformado: 'blog' };
  const ler = async (extra) => { const r = await analisar({ ...base, ...extra }); return { pasta: r.pasta, parcial: lerJson(join(r.pasta, 'analise-parcial.json')) }; };
  R.com = await ler({ dirLocal: fx });
  R.sem = await ler({ dirLocal: null });
}, { timeout: 200000 });

test('análise com camada local: usa seções locais, roda a regra local, avisa o que ignorou e muda o carimbo; sem ela nada muda', () => {
  const { pasta, parcial } = R.com;
  assert.equal(parcial.camadaLocal.ativa, true);
  assert.equal(parcial.camadaLocal.regras, 2);
  assert.ok(parcial.julgamentoCriterios.includes('local-exemplo-julgamento'), 'pergunta de julgamento local vai para os critérios do pacote');
  assert.ok(parcial.camadaLocal.avisos.length >= 3);
  assert.match(parcial.carimbo.versaoRegras, /\+local\.[0-9a-f]{12}$/);
  assert.equal(lerJson(join(pasta, 'medicoes', 'secoes.json')).dados.origemDasSecoes, 'local');
  assert.ok(lerJson(join(pasta, 'tells.json')).some((t) => t.regra_id === 'local-exemplo-palavra-magica'));
  const s = R.sem;
  assert.equal(s.parcial.camadaLocal.ativa, false);
  assert.ok(!s.parcial.julgamentoCriterios.includes('local-exemplo-julgamento'));
  assert.doesNotMatch(s.parcial.carimbo.versaoRegras, /local/);
  assert.equal(lerJson(join(s.pasta, 'medicoes', 'secoes.json')).dados.origemDasSecoes, 'publica');
  assert.ok(!lerJson(join(s.pasta, 'tells.json')).some((t) => t.regra_id === 'local-exemplo-palavra-magica'));
});

test('custo: a camada local soma o extra medido (de R$ 0,02 a R$ 0,06) só quando está ativa', () => {
  const sem = estimarCusto({ modo: 'rapido', paginas: 8 });
  const com = estimarCusto({ modo: 'rapido', paginas: 8, camadaLocal: true });
  const extra = com.reais - sem.reais;
  assert.ok(extra > 0.02 && extra < 0.06, `extra ${extra}`);
  assert.equal(estimarCusto({ modo: 'rapido', paginas: 8, camadaLocal: false }).reais, sem.reais);
});
