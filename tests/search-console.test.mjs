import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, paraNumeroSC, lerArquivoSC, oportunidades, analisarSearchConsole } from '../lib/search-console.mjs';

const fx = (n) => new URL(`./fixtures/search-console/${n}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const site = [{ caminho: '/', titulo: 'Conserto de bicicletas em São Paulo', h1: 'Conserto de bicicletas em São Paulo', termo: 'Conserto de bicicletas em São Paulo' }, { caminho: '/contato.html', titulo: 'Contato', h1: 'Contato', termo: 'Contato' }];

test('números: formatos português e inglês, percentual e milhar', () => {
  assert.equal(paraNumeroSC('4.000', true), 4000);
  assert.equal(paraNumeroSC('4,000', false), 4000);
  assert.equal(paraNumeroSC('8,2', true), 8.2);
  assert.equal(paraNumeroSC('8.2', false), 8.2);
  assert.equal(paraNumeroSC('3,0%', true), 0.03);
  assert.equal(paraNumeroSC('3.0%', false), 0.03);
  assert.equal(paraNumeroSC('1.234,5', true), 1234.5);
  assert.equal(paraNumeroSC('abc', true), null);
  assert.equal(paraNumeroSC('=1+1', true), null);
});

test('parser: aspas, vírgula dentro de aspas, aspas duplas e quebra de linha dentro do campo', () => {
  const l = parseCsv('a,b\n"x, y","z ""q"""\n"linha\nquebrada",2\n', ',');
  assert.deepEqual(l, [['a', 'b'], ['x, y', 'z "q"'], ['linha\nquebrada', '2']]);
});

test('CSV em português (ponto e vírgula, BOM, acentos): colunas reconhecidas e linhas lidas', () => {
  const r = lerArquivoSC(fx('consultas-pt.csv'));
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'consultas');
  assert.equal(r.linhas.length, 11);
  const l = r.linhas.find((x) => x.consulta === 'conserto de bicicleta');
  assert.deepEqual([l.cliques, l.impressoes, l.ctr, l.posicao], [120, 4000, 0.03, 8.2]);
  assert.equal(r.linhas.find((x) => x.consulta === 'troca de câmara de ar').impressoes, 3000);
});

test('CSV em inglês (vírgula, milhar entre aspas) e CSV de páginas', () => {
  const q = lerArquivoSC(fx('consultas-en.csv'));
  assert.equal(q.ok, true);
  assert.equal(q.linhas[0].impressoes, 4000);
  assert.equal(q.linhas[0].ctr, 0.03);
  const p = lerArquivoSC(fx('paginas-en.csv'));
  assert.equal(p.ok, true);
  assert.equal(p.tipo, 'páginas');
  assert.equal(p.linhas[0].pagina, 'http://exemplo.test/');
  assert.equal(p.linhas[0].impressoes, 9000);
});

test('arquivo sem as colunas esperadas, sem extensão válida, inexistente ou grande demais é recusado com mensagem clara', () => {
  assert.match(lerArquivoSC(fx('invalido.csv')).erro, /Não reconheci as colunas/);
  assert.match(lerArquivoSC(fx('nao-existe.csv')).erro, /Não consegui abrir/);
  const dir = mkdtempSync(join(tmpdir(), 'cs-sc-'));
  try {
    writeFileSync(join(dir, 'x.exe'), 'a');
    assert.match(lerArquivoSC(join(dir, 'x.exe')).erro, /\.csv/);
    const grande = join(dir, 'grande.csv');
    writeFileSync(grande, 'Consulta,Impressões\n' + 'a,1\n'.repeat(1600000)); // ~6,4 MB
    assert.match(lerArquivoSC(grande).erro, /grande demais/);
    const cfg = { search_console: { tamanho_maximo_bytes: 5242880, linhas_maximas: 100, posicao_minima: 4, posicao_maxima: 20, impressoes_minimas: 100 } };
    const muitas = join(dir, 'muitas.csv');
    writeFileSync(muitas, 'Consulta,Impressões\n' + 'a,1\n'.repeat(500));
    assert.match(lerArquivoSC(muitas, cfg).erro, /Linhas demais/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('segurança: fórmula no arquivo vira texto, nada é executado e o arquivo original não é alterado nem copiado', () => {
  const antes = readFileSync(fx('consultas-pt.csv'));
  const r = lerArquivoSC(fx('consultas-pt.csv'));
  const f = r.linhas.find((x) => String(x.consulta).startsWith('=HYPERLINK'));
  assert.ok(f, 'a linha com fórmula foi lida como texto');
  assert.equal(typeof f.consulta, 'string');
  assert.ok(readFileSync(fx('consultas-pt.csv')).equals(antes));
  const out = analisarSearchConsole([fx('consultas-pt.csv')], site);
  assert.ok(!JSON.stringify(out).includes(fx('consultas-pt.csv').replace(/\\/g, '\\\\')), 'o caminho do arquivo não vai para o resultado');
});

test('oportunidades (PT): posição 4 a 20, CTR abaixo do típico do próprio site e consulta sem página própria', () => {
  const out = analisarSearchConsole([fx('consultas-pt.csv')], site);
  assert.equal(out.disponivel, true);
  assert.equal(out.selo, 'fato');
  assert.equal(out.posicao4a20[0].alvo, 'conserto de bicicleta'); // mais impressões dentro da faixa
  assert.ok(out.posicao4a20.every((o) => o.posicao >= 4 && o.posicao <= 20 && o.impressoes >= 100));
  assert.ok(!out.posicao4a20.some((o) => o.alvo === 'freio a disco ajuste'), 'poucas impressões ficam de fora');
  assert.ok(!out.posicao4a20.some((o) => o.alvo === 'aro 29 pneu'), 'posição 35 fica de fora');
  assert.deepEqual(out.ctrAbaixoDoTipicoDoSite.map((o) => o.alvo), ['regulagem de câmbio']);
  assert.equal(out.ctrAbaixoDoTipicoDoSite[0].ctrTipicoDoSite, 3);
  const sem = out.consultasSemPaginaPropria.map((o) => o.alvo);
  assert.ok(sem.includes('pintura de quadro de bicicleta'));
  assert.ok(!sem.includes('conserto de bicicleta'), 'plural e singular casam com o title');
});

test('oportunidades (EN) dão o mesmo resultado que em português para os mesmos dados', () => {
  const pt = analisarSearchConsole([fx('consultas-pt.csv')], site).ctrAbaixoDoTipicoDoSite.map((o) => [o.impressoes, o.posicao, o.ctr]);
  const en = analisarSearchConsole([fx('consultas-en.csv')], site).ctrAbaixoDoTipicoDoSite.map((o) => [o.impressoes, o.posicao, o.ctr]);
  assert.deepEqual(en, pt);
});

test('consultas e páginas juntas: lê os dois arquivos; sem CSV nada é inventado', () => {
  const dois = analisarSearchConsole([fx('consultas-en.csv'), fx('paginas-en.csv')], site);
  assert.equal(dois.arquivos.length, 2);
  assert.ok(dois.posicao4a20.some((o) => o.tipo === 'página' && o.alvo === 'http://exemplo.test/contato.html'));
  const sem = analisarSearchConsole([], site);
  assert.equal(sem.disponivel, false);
  assert.match(sem.mensagem, /Precisa do CSV do Search Console/);
  assert.equal(sem.posicao4a20, undefined);
  const ruim = analisarSearchConsole([fx('invalido.csv')], site);
  assert.equal(ruim.disponivel, false);
  assert.match(ruim.mensagem, /Não consegui usar o CSV/);
});

test('sem coluna de posição: avisa e não inventa oportunidade por posição', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-sc-'));
  try {
    writeFileSync(join(dir, 'a.csv'), 'Query,Clicks,Impressions\nfoo,1,500\n');
    const r = lerArquivoSC(join(dir, 'a.csv'));
    assert.match(r.avisos.join(' '), /Sem coluna de Posição/);
    assert.deepEqual(oportunidades(r.linhas, site).posicao4a20, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ReDoS/entrada patológica: aspas abertas e milhões de separadores terminam rápido e sem executar nada', () => {
  const t0 = Date.now();
  parseCsv('a,b\n"' + 'x'.repeat(3000000), ',');
  parseCsv(','.repeat(1500000), ',');
  assert.ok(Date.now() - t0 < 3000);
});
