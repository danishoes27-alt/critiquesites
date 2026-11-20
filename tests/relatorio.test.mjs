import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderizarRelatorio, esc } from '../lib/relatorio.mjs';

const achado = (extra = {}) => ({
  id: 'ach-0001', regra_id: 'perf-lazy-loading-contagem', titulo: 'Imagens com carregamento tardio', selo: 'fato', severidade: 'P2', pagina: '/',
  mensagem: '45 de 57 imagens usam loading=lazy.', evidencias: [{ versao: 'final', contagem: 45, seletor: 'img', trecho: '<img loading="lazy">' }],
  citacoes: [{ tipo: 'contagem' }], peso_aplicado: 4, correcao: 'Ok', prompt_correcao: 'Faça X no {{arquivo}}.', fonte: [{ nome: 'web.dev', url: 'https://web.dev/x' }], ...extra,
});
const dados = (extra = {}) => ({
  site: { url: 'https://exemplo.com.br', host: 'exemplo.com.br', tipo: 'loja' },
  carimbo: { iso: '2026-11-18T10:00:00-03:00', hash: 'a'.repeat(64), versaoSkill: '0.1.0', versaoRegras: 'r1', modo: 'rapido' },
  paginas: [{ url: 'https://exemplo.com.br/', motivo: 'home' }],
  notas: { tell: { nota: 31.2, objetiva: 31.2, faixa: { letra: 'C', rotulo: 'Vários sinais de padrão' }, regrasAvaliadas: 80, regrasDisparadas: 7, ajusteModelo: { aplicado: 0 }, contribuicoes: [{ regra_id: 'tipo-fonte-padrao', peso: 9, intensidade: 1, pontos: 9 }] }, categorias: [{ id: 'acessibilidade', rotulo: 'Acessibilidade', nota: 72 }], geral: { nota: 68, nivel: 'Em evolução' } },
  achados: [achado()], descartados: [{ id: 'x', regra_id: 'r-falsa', motivo: 'número não encontrado' }],
  julgamento: { versao: 1, tom: 'normal', resumo: 'Resumo de teste.', pontos_fortes: [{ titulo: 'Bom', texto: 'Texto.' }], pontos_fracos: [], criticas: [{ achado_id: 'ach-0001', texto: 'Comentário do modelo.' }], plano: [{ titulo: 'Fazer', porque: 'Porque sim.', esforco: 'baixo', impacto: 'alto', achados: ['ach-0001'] }] },
  cobertura: { avaliadas: 100, regrasDeScript: 220, semDetector: ['a'], perguntasAoModelo: 24 },
  custo: { tokensEntrada: 20000, tokensSaida: 3000, reais: 0.5, cotacao: { valor: 5.7851, tipo: 'PTAX', data_cotacao: '2026-11-17' } },
  ...extra,
});

test('esc escapa HTML', () => { assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'); });

test('relatório tem as seções obrigatórias, selo, carimbo com hash, aviso de limite e rodapé de custo em R$', () => {
  const html = renderizarRelatorio(dados());
  assert.match(html, /<!doctype html>/i);
  for (const t of ['Resumo', 'Notas por área', 'Tell Score', 'Pontos fortes', 'Críticas (1)', 'Plano do que melhorar', 'Limites desta análise', 'Achados descartados pelo verificador (1)']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('a'.repeat(64)));
  assert.match(html, /Fato verificado/);
  assert.match(html, /A nota é um sinal, não um veredito/);
  assert.match(html, /R\$ 0,50/);
  assert.match(html, /Prompt de correção para colar no Claude Code/);
  assert.match(html, /Não afirma que algo foi feito por IA/);
});

test('autocontido: sem links externos carregáveis (só âncoras de fonte) e com CSP restritiva', () => {
  const html = renderizarRelatorio(dados());
  assert.doesNotMatch(html, /<link\s|<script\s+src=|<img\s+src="http|@import/i);
  assert.match(html, /Content-Security-Policy/);
});

test('SEGURANÇA: conteúdo do site com HTML/script é escapado em evidências, mensagem e prompt', () => {
  const mau = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = renderizarRelatorio(dados({ achados: [achado({ mensagem: mau, evidencias: [{ versao: 'final', trecho: mau, seletor: mau }], prompt_correcao: mau })] }));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)'));
});

test('reanálise: mostra evolução; informativos de peso 0 ficam fora das críticas', () => {
  const html = renderizarRelatorio(dados({
    achados: [achado(), achado({ id: 'ach-0002', titulo: 'llms.txt', peso_aplicado: 0, mensagem: 'Não há llms.txt.' })],
    anterior: { mensagem: 'Comparação com a análise de 2026-11-10.', tellAntes: 61, tellDepois: 31.2, deltaTell: -29.8, resolvidos: ['a', 'b'], novos: [], persistentes: ['c'] },
  }));
  assert.match(html, /Evolução desde a análise anterior/);
  assert.match(html, /de <strong>61<\/strong> para <strong>31.2<\/strong>/);
  assert.match(html, /Críticas \(1\)/);
  assert.match(html, /Informativos \(sem peso na nota\)/);
});

test('modo sem dó aparece no cabeçalho', () => {
  const d = dados(); d.julgamento.tom = 'sem-do';
  assert.match(renderizarRelatorio(d), /modo sem dó/);
});

test('modo sem dó muda só o tom: mesmos achados, severidades, selos e notas nos dois tons', () => {
  const normal = dados();
  const acido = dados();
  acido.julgamento = { ...acido.julgamento, tom: 'sem-do', resumo: 'Esse site é um deserto de ideias, mas o preço pelo menos aparece.', criticas: [{ achado_id: 'ach-0001', texto: 'Carregar tudo com atraso é um jeito corajoso de irritar o visitante.' }] };
  const extrair = (h) => ({
    artigos: [...h.matchAll(/<article class="critica" id="([^"]+)"/g)].map((m) => m[1]),
    sev: [...h.matchAll(/class="sev sev-(P\d)"/g)].map((m) => m[1]),
    selos: [...h.matchAll(/class="selo selo-([\w-]+)"/g)].map((m) => m[1]),
    notas: [...h.matchAll(/<strong>(\d+)\/100<\/strong>/g)].map((m) => m[1]),
    hash: h.includes('a'.repeat(64)),
  });
  assert.deepEqual(extrair(renderizarRelatorio(normal)), extrair(renderizarRelatorio(acido)));
});

test('cobertura baixa: nota geral aparece como provisória, com aviso', () => {
  const d = dados(); d.notas.geral = { nota: 100, nivel: 'Excelente', provisoria: true, cobertura: { avaliadas: 10, regrasDeScript: 200 } };
  const html = renderizarRelatorio(d);
  assert.match(html, /Nota provisória/);
  assert.match(html, /\(provisória\)/);
  assert.match(html, /Só 10 de 200 regras/);
  assert.doesNotMatch(renderizarRelatorio(dados()), /Nota provisória/);
});

test('SEGURANÇA: refino do modelo é limpo (sem crases) e título com $& não desfigura o relatório', () => {
  const d = dados({ site: { url: 'https://exemplo.com.br', host: '$& {{CORPO}} $\'' } });
  d.julgamento.criticas = [{ achado_id: 'ach-0001', texto: 'ok', refino_do_prompt: 'Rode `rm -rf /` agora' }];
  const html = renderizarRelatorio(d);
  assert.ok(!html.includes('Rode `rm'));
  assert.match(html, /revise antes de colar/);
  assert.ok(html.includes('Relatório: $&amp; {{CORPO}}'));
});

test('aviso "Referência não é cópia" aparece no fim do relatório (antes do rodapé) e nos prompts que citam referência', () => {
  const html = renderizarRelatorio(dados());
  const i = html.indexOf('Referência não é cópia');
  assert.ok(i > 0);
  assert.ok(html.indexOf('class="rodape"') > i, 'o aviso vem antes do rodapé, no fim');
  assert.match(html, /não é parecer jurídico/);
  // prompt que menciona referência recebe o bloco; prompt comum não
  const com = renderizarRelatorio(dados({ achados: [achado({ prompt_correcao: 'Meça o espaçamento de uma referência e adapte à marca.' })] }));
  assert.equal(com.split('Referência não é cópia: Olhar, medir').length - 1, 1);
  const sem = renderizarRelatorio(dados({ achados: [achado({ prompt_correcao: 'Troque a cor do botão.' })] }));
  assert.equal(sem.split('Referência não é cópia: Olhar, medir').length - 1, 0);
});
