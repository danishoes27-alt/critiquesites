import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFixture } from './helpers/ler-fixture.mjs';
import * as texto from '../lib/medidores/texto.mjs';

const { medirTexto, contarSilabas, dividirFrases, fleschPt } = texto;

// Lista mínima injetável (não depende do arquivo final de clichês).
const MINI = [
  { id: 't-transforme', padrao: 'transforme (o|a|seu|sua) ', tipo: 'hype', peso: 3, confianca: 'media' },
  { id: 't-potencial', padrao: '(todo|pleno) (o )?potencial', tipo: 'hype', peso: 3, confianca: 'media' },
  { id: 't-experiencia', padrao: 'experi[eê]ncia (completa|incr[ií]vel)', tipo: 'vago', peso: 2, confianca: 'baixa' },
  { id: 't-excelencia', padrao: 'excel[eê]ncia', tipo: 'hype', peso: 2, confianca: 'baixa' },
];
const bloco = (t, tag = 'p') => ({ texto: t, tag });
const pagina = (nome, ...blocos) => ({ pagina: nome, blocos });
const arred2 = (x) => Math.round(x * 100) / 100;

test('texto: interface do medidor (id, saída) e ctx vazio', async () => {
  assert.equal(texto.id, 'texto');
  const r = await texto.medir({ paginas: [] }, { cliches: MINI });
  assert.equal(r.id, 'texto');
  assert.equal(r.dados.total.palavras, 0);
  assert.equal(r.dados.total.frases, 0);
  assert.equal(r.dados.total.legibilidade.flesch, null);
  assert.equal(r.dados.total.cliches.porMil, 0);
  assert.deepEqual(r.dados.fraseParaTesteDaTroca, []);
  assert.deepEqual(r.evidencias, []);
});

test('texto: contarSilabas (palavras de referência)', () => {
  const esperado = { casa: 2, 'pão': 1, 'saída': 3, 'país': 2, queijo: 2, que: 1, coordenar: 4, poeta: 3, voo: 2, luz: 1, 'árvore': 3, cidade: 3, empresa: 3, 'você': 2, Curitiba: 4, WhatsApp: 2, guerra: 2, quando: 2, 'água': 2, 'ruído': 3, 'baú': 2, 'saúde': 3, sr: 1, 'R$': 1, '': 0 };
  for (const [p, n] of Object.entries(esperado)) assert.equal(contarSilabas(p), n, p);
});

test('texto: dividirFrases não quebra abreviações nem iniciais, mas quebra o resto', () => {
  assert.deepEqual(dividirFrases('Dr. Silva chegou. Foram 3,5 km. Oi! Tudo bem? Sim…  Fim.'), ['Dr. Silva chegou.', 'Foram 3,5 km.', 'Oi!', 'Tudo bem?', 'Sim…', 'Fim.']);
  assert.deepEqual(dividirFrases('Fale com J. Silva hoje. Ou com a Sra. Lima.'), ['Fale com J. Silva hoje.', 'Ou com a Sra. Lima.']);
  assert.deepEqual(dividirFrases('rápido. simples. seguro.'), ['rápido.', 'simples.', 'seguro.']);
  assert.deepEqual(dividirFrases('Era o que ele é. Depois saiu.'), ['Era o que ele é.', 'Depois saiu.']);
  assert.deepEqual(dividirFrases('Sem pontuação final'), ['Sem pontuação final']);
  assert.deepEqual(dividirFrases('  ...  '), []);
});

test('texto: contagens exatas em entrada sintética (palavras, frases, clichês, travessão, exclamação, especificidade)', () => {
  const p = { pagina: '/', texto: 'Transforme seu negócio. Alcance todo o potencial! Atendemos 3 cidades — desde 2010.\nNossa excelência é inegável.' };
  const r = medirTexto([p], { cliches: MINI });
  const t = r.total;
  assert.equal(t.palavras, 16); // 3 + 4 + 5 ("—" não é palavra) + 4
  assert.equal(t.frases, 4);
  assert.equal(t.cliches.quantidade, 3);
  assert.equal(t.cliches.pesoTotal, 8);
  assert.equal(t.cliches.porMil, 187.5); // 3/16*1000
  assert.equal(t.cliches.indicePonderado, 500); // 8/16*1000
  assert.equal(t.cliches.amostraSuficiente, false); // < 150 palavras
  assert.deepEqual(t.travessoes, { quantidade: 1, porMil: 62.5 });
  assert.deepEqual(t.exclamacoes, { quantidade: 1, porMil: 62.5 });
  assert.equal(t.especificidade.frasesEspecificas, 1); // só "Atendemos 3 cidades — desde 2010."
  assert.equal(t.especificidade.fracao, 0.25);
  assert.deepEqual(t.especificidade.porCategoria, { numero: 1, nomeProprio: 0, moeda: 0, unidade: 0, data: 0 });
  assert.deepEqual(r.cliches.ocorrencias.map((o) => [o.id, o.trecho, o.peso]), [
    ['t-transforme', 'Transforme seu', 3],
    ['t-potencial', 'todo o potencial', 3],
    ['t-excelencia', 'excelência', 2],
  ]);
  assert.deepEqual(r.cliches.porId.map((x) => [x.id, x.vezes]), [['t-excelencia', 1], ['t-potencial', 1], ['t-transforme', 1]]);
  assert.deepEqual(r.cliches.porTipo, { hype: { vezes: 3, peso: 8 } });
  assert.deepEqual(r.cliches.lista, { origem: 'parametro', total: 4, usados: 4, invalidos: [], tipos: texto.TIPOS_CLICHE });
  // por página = total (só 1 página)
  assert.equal(r.paginas.length, 1);
  assert.equal(r.paginas[0].pagina, '/');
  assert.equal(r.paginas[0].palavras, 16);
});

test('texto: legibilidade usa a fórmula de Flesch para português com os números medidos', () => {
  // 248.835 − 1.015 × (palavras/frases) − 84.6 × (sílabas/palavras)
  assert.ok(Math.abs(fleschPt(6, 3, 10) - 105.805) < 1e-9);
  assert.ok(Math.abs(fleschPt(100, 5, 180) - (248.835 - 1.015 * 20 - 84.6 * 1.8)) < 1e-9);
  assert.equal(fleschPt(0, 0, 0), null);
  const r = medirTexto([pagina('/', bloco('Casa branca. Pão quente. Sol forte.'))], { cliches: [] });
  const l = r.total.legibilidade;
  assert.equal(r.total.palavras, 6);
  assert.equal(r.total.frases, 3);
  assert.equal(r.total.silabas, 10); // casa2 branca2 pão1 quente2 sol1 forte2
  assert.equal(l.palavrasPorFrase, 2);
  assert.equal(l.silabasPorPalavra, 1.67);
  assert.equal(l.flesch, arred2(fleschPt(6, 3, 10)));
  assert.equal(l.faixa, 'muito fácil');
  // texto longo e pesado cai de faixa
  const pesado = 'Institucionalmente, a responsabilidade socioambiental contemporânea pressupõe mobilização interdisciplinar sistemática, considerando implicações macroeconômicas.';
  const r2 = medirTexto([pagina('/', bloco(pesado))], { cliches: [] });
  assert.equal(r2.total.frases, 1);
  assert.ok(r2.total.legibilidade.flesch < 25);
  assert.equal(r2.total.legibilidade.faixa, 'muito difícil');
});

test('texto: "não é X, é Y", "não apenas X, mas também Y" e tricolons (com adjacência)', () => {
  const r = medirTexto([pagina('/',
    bloco('Não é apenas um site, é uma experiência.'),
    bloco('Não é caro, é justo.'),
    bloco('Não apenas rápido, mas também seguro.'),
    bloco('Não vendemos sapatos. Entregamos conforto.'), // paralelismo por verbo: fora do escopo do medidor
    bloco('Rápido, simples e seguro.'),
    bloco('Casa, carro e barco.'),
    bloco('Compramos 10, 20 e 30 itens.'), // lista numérica não é tricolon retórico
    bloco('Frase comum sem lista nenhuma.'),
    bloco('Preço, prazo e qualidade.'),
  )], { cliches: [] });
  const e = r.estruturas;
  assert.deepEqual(e.naoEXEY.map((x) => [x.tipo, x.trecho]), [
    ['nao-e-x-e-y', 'Não é apenas um site, é'],
    ['nao-e-x-e-y', 'Não é caro, é'],
    ['nao-apenas-mas-tambem', 'Não apenas rápido, mas também'],
  ]);
  assert.deepEqual(e.tricolons.map((x) => x.trecho), ['Rápido, simples e seguro', 'Casa, carro e barco', 'Preço, prazo e qualidade']);
  assert.equal(r.total.repeticao.naoEXEY, 3);
  assert.equal(r.total.repeticao.tricolons, 3);
  // "Rápido…" e "Casa…" são frases vizinhas com tricolon (2); "Preço…" fica isolada (a anterior não tem)
  assert.equal(r.total.repeticao.tricolonsEmSequencia, 2);
});

test('texto: aberturas repetidas (bigrama inicial em ≥ 3 frases)', () => {
  const r = medirTexto([pagina('/',
    bloco('Nós oferecemos qualidade total.'),
    bloco('Nós oferecemos preço justo.'),
    bloco('Nós oferecemos entrega rápida.'),
    bloco('Outro começo diferente aqui.'),
    bloco('Sim.'), // 1 palavra: não elegível
  )], { cliches: [] });
  const rep = r.total.repeticao;
  assert.equal(rep.frasesElegiveis, 4);
  assert.equal(rep.frasesComAberturaRepetida, 3);
  assert.equal(rep.fracaoAberturaRepetida, 0.75);
  assert.deepEqual(rep.aberturasRepetidas, [{ abertura: 'nos oferecemos', vezes: 3, exemplos: ['Nós oferecemos qualidade total.', 'Nós oferecemos preço justo.', 'Nós oferecemos entrega rápida.'] }]);
  // duas repetições só não bastam
  const r2 = medirTexto([pagina('/', bloco('Nós oferecemos A.'), bloco('Nós oferecemos B.'))], { cliches: [] });
  assert.deepEqual(r2.total.repeticao.aberturasRepetidas, []);
});

test('texto: CTAs genéricos x total de botões/links', () => {
  const ctas = ['Saiba mais', 'Saiba mais →', 'CLIQUE AQUI', 'Comece agora!', 'Fale conosco', 'Entre em contato', 'Agende uma visita técnica', 'Ver cardápio de hoje', '', '   '];
  const r = medirTexto([{ pagina: '/', blocos: ['Texto qualquer da página.'], ctas }], { cliches: [] });
  const c = r.total.ctas;
  assert.equal(c.total, 8);
  assert.equal(c.genericos, 6);
  assert.equal(c.fracaoGenericos, 0.75);
  assert.deepEqual(c.lista, [
    { texto: 'CLIQUE AQUI', vezes: 1 }, { texto: 'Comece agora!', vezes: 1 }, { texto: 'Entre em contato', vezes: 1 },
    { texto: 'Fale conosco', vezes: 1 }, { texto: 'Saiba mais', vezes: 1 }, { texto: 'Saiba mais →', vezes: 1 },
  ]);
  // lista própria de CTAs genéricos substitui a padrão
  const r2 = medirTexto([{ pagina: '/', blocos: ['x y z'], ctas }], { cliches: [], ctas: ['ver cardápio de hoje'] });
  assert.equal(r2.total.ctas.genericos, 1);
  assert.equal(r2.total.ctas.total, 8);
  // repetido conta mais de uma vez
  const r3 = medirTexto([{ pagina: '/', blocos: ['x y z'], ctas: ['Saiba mais', 'Saiba mais', 'Sobre nós'] }], { cliches: [] });
  assert.deepEqual(r3.total.ctas.lista, [{ texto: 'Saiba mais', vezes: 2 }]);
  assert.equal(r3.total.ctas.fracaoGenericos, 0.6667);
});

test('texto: headlines vagos (só h1–h3, sem número) e lorem ipsum', () => {
  const r = medirTexto([pagina('/',
    bloco('Bem-vindo ao nosso site', 'h1'),
    bloco('Soluções completas para sua empresa', 'h2'),
    bloco('Simples, rápido e seguro', 'h2'),
    bloco('Qualidade', 'h3'),
    bloco('Transforme seu negócio hoje', 'h2'),
    bloco('Nossos 3 planos', 'h2'),
    bloco('Soluções completas para 50 empresas', 'h2'), // tem número: específico
    bloco('Bem-vindo', 'h4'), // h4 fora do escopo
    bloco('Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
  )], { cliches: [] });
  assert.deepEqual(r.headlinesVagos.map((h) => [h.nivel, h.texto, h.padraoId]), [
    [1, 'Bem-vindo ao nosso site', 'bem-vindo'],
    [2, 'Soluções completas para sua empresa', 'solucoes-adjetivo'],
    [2, 'Simples, rápido e seguro', 'tricolon-de-adjetivos'],
    [3, 'Qualidade', 'palavra-abstrata-sozinha'],
    [2, 'Transforme seu negócio hoje', 'verbo-de-hype'],
  ]);
  assert.equal(r.total.headlinesVagos, 5);
  assert.equal(r.total.loremIpsum, 1);
  assert.deepEqual(r.loremIpsum, [{ pagina: '/', seletor: 'bloco:9', trecho: 'Lorem ipsum' }]);
});

test('texto: clichês — sem sobreposição, filtro por tipo, regex inválida, espaços sobrando no padrão', () => {
  const lista = [
    { id: 'a-longo', padrao: 'todo o potencial', tipo: 'hype', peso: 3 },
    { id: 'b-curto', padrao: 'o potencial', tipo: 'hype', peso: 2 },
    { id: 'c-mesmo-inicio', padrao: 'todo o', tipo: 'hype', peso: 9 },
    { id: 'cta', padrao: '^saiba mais$', tipo: 'cta-generico', peso: 2 },
    { id: 'quebrada', padrao: '(', tipo: 'hype', peso: 1 },
    { id: 'espaco', padrao: 'cansad[oa] de  ', tipo: 'abertura-batida', peso: 1 },
    { id: 'sem-tipo', padrao: 'plataforma', peso: 1 },
  ];
  const pg = [pagina('/', bloco('Libere todo o potencial da plataforma. Cansado de esperar? Saiba mais'))];
  const r = medirTexto(pg, { cliches: lista });
  // "todo o potencial" (início em "todo", mais longo) vence "todo o" e "o potencial"
  assert.deepEqual(r.cliches.ocorrencias.map((o) => [o.id, o.trecho]), [['a-longo', 'todo o potencial'], ['sem-tipo', 'plataforma'], ['espaco', 'Cansado de']]);
  assert.deepEqual(r.cliches.lista.invalidos, ['quebrada']);
  assert.equal(r.cliches.lista.usados, 5); // cta-generico e a regex inválida ficam de fora
  // tipos: null considera todos os tipos
  const todos = medirTexto(pg, { cliches: lista, tipos: null });
  assert.ok(todos.cliches.ocorrencias.some((o) => o.id === 'cta'));
  assert.equal(todos.cliches.lista.tipos, 'todos');
  // vencedor em início igual: o mais longo; depois o de maior peso
  const emp = medirTexto([pagina('/', bloco('Texto todo o potencial aqui.'))], { cliches: [{ id: 'x', padrao: 'todo o', tipo: 'hype', peso: 9 }, { id: 'y', padrao: 'todo o potencial', tipo: 'hype', peso: 1 }] });
  assert.deepEqual(emp.cliches.ocorrencias.map((o) => o.id), ['y']);
  // não repete resultado entre execuções (lastIndex de regex global)
  const de = medirTexto(pg, { cliches: lista });
  assert.deepEqual(de.cliches, r.cliches);
});

test('texto: frases para o teste da troca — pontuação, desempate por texto, dedupe e limite', () => {
  const pg1 = pagina('/a',
    bloco('Transforme seu negócio.'),
    bloco('Alcance todo o potencial da sua marca de forma simples e sem esforço total.'),
    bloco('Nossa excelência é inegável.'),
    bloco('Atendemos 3 cidades desde 2010.'), // específica e sem clichê: fora
    bloco('Oferecemos a melhor qualidade do mercado para o seu negócio e a sua empresa hoje mesmo.'),
    bloco('Texto neutro sem nada.'),
    bloco('Sim.'), // < 3 palavras: fora
  );
  const pg2 = pagina('/b',
    bloco('Transforme seu negócio.'), // duplicada da página /a: fica só a primeira
    bloco('Outro texto neutro sem nada.'),
    bloco('Frase qualquer aqui agora mesmo para teste.'),
    bloco('Vendemos tudo.'),
  );
  const r = medirTexto([pg1, pg2], { cliches: MINI });
  assert.deepEqual(r.fraseParaTesteDaTroca.map((f) => [f.pagina, f.frase, f.pontuacao]), [
    ['/a', 'Alcance todo o potencial da sua marca de forma simples e sem esforço total.', 11], // 3 clichê + 4 + 1 (14 palavras) + 3 abstratas
    ['/a', 'Transforme seu negócio.', 11], // empate (11): vence o texto menor ("alcance…" < "transforme…")
    ['/a', 'Nossa excelência é inegável.', 10],
    ['/a', 'Oferecemos a melhor qualidade do mercado para o seu negócio e a sua empresa hoje mesmo.', 8], // 4 + 1 (16 palavras) + 3 (5 abstratas, máx. 3)
    ['/b', 'Outro texto neutro sem nada.', 7], // empate (7) com "Texto neutro sem nada.": vence o texto menor ("outro…" < "texto…")
  ]);
  assert.equal(r.fraseParaTesteDaTroca[1].motivo, 'clichê (t-transforme); sem número, nome próprio, unidade ou data; frase curta (3 palavras); palavras abstratas (negocio)');
  assert.equal(r.fraseParaTesteDaTroca[2].motivo, 'clichê (t-excelencia); sem número, nome próprio, unidade ou data; frase curta (4 palavras); palavras abstratas (excelencia)');
  assert.equal(r.fraseParaTesteDaTroca[3].motivo, 'sem número, nome próprio, unidade ou data; palavras abstratas (melhor, qualidade, mercado, negocio, empresa)');
  assert.equal(r.fraseParaTesteDaTroca[4].motivo, 'sem número, nome próprio, unidade ou data; frase curta (5 palavras)');
  assert.equal(medirTexto([pg1, pg2], { cliches: MINI, quantidade: 6 }).fraseParaTesteDaTroca[5].frase, 'Texto neutro sem nada.');
  assert.deepEqual(Object.keys(r.fraseParaTesteDaTroca[0]).sort(), ['frase', 'motivo', 'pagina', 'pontuacao', 'seletor']);
  // quantidade configurável (rápido = 3 no SPEC §7.4)
  assert.deepEqual(medirTexto([pg1, pg2], { cliches: MINI, quantidade: 2 }).fraseParaTesteDaTroca.map((f) => f.frase), ['Alcance todo o potencial da sua marca de forma simples e sem esforço total.', 'Transforme seu negócio.']);
  // determinismo: mesma entrada, mesma saída; ordem das páginas não muda o ranking
  assert.deepEqual(medirTexto([pg2, pg1], { cliches: MINI }).fraseParaTesteDaTroca.map((f) => f.frase), r.fraseParaTesteDaTroca.map((f) => f.frase));
  assert.deepEqual(medirTexto([pg1, pg2], { cliches: MINI }).fraseParaTesteDaTroca, r.fraseParaTesteDaTroca);
});

test('texto: várias páginas — total é a soma e cada página tem as suas métricas', () => {
  const r = medirTexto([
    pagina('/', bloco('Transforme seu negócio hoje.'), bloco('Atendemos 3 cidades.')),
    pagina('/sobre', bloco('Fundada em 2010 por Maria Clara.'), bloco('Excelência em tudo!')),
  ], { cliches: MINI });
  assert.deepEqual(r.paginas.map((p) => [p.pagina, p.palavras, p.frases, p.cliches.quantidade]), [['/', 7, 2, 1], ['/sobre', 9, 2, 1]]);
  assert.equal(r.total.palavras, 16);
  assert.equal(r.total.frases, 4);
  assert.equal(r.total.cliches.quantidade, 2);
  assert.equal(r.total.especificidade.frasesEspecificas, 2);
  assert.equal(r.total.exclamacoes.quantidade, 1);
  assert.equal(r.paginasAnalisadas, 2);
});

test('texto: ctx real sintético — só visível não-clone, sem nav/rodapé/blockquote; fragmentos, botões e links', async () => {
  const no = (seletor, tag, t, extra = {}) => ({ seletor, tag, texto: t, visivel: true, ocultoPor: '', ariaOculto: false, clone: false, ...extra });
  const extr = {
    nos: [
      no('body>main>p:nth-of-type(1)', 'p', 'Primeiro parágrafo aqui.'),
      no('body>main>p:nth-of-type(1)>span', 'span', 'destaque aqui'),
      no('body>main>p:nth-of-type(2)', 'p', 'Oculto total.', { visivel: false, ocultoPor: 'display:none' }),
      no('body>main>p:nth-of-type(3)', 'p', 'Clone de carrossel.', { clone: true, ariaOculto: true }),
      no('body>footer>p', 'p', 'Rodapé legal 2026.'),
      no('body>nav>a', 'a', 'Menu'),
      no('body>main>blockquote', 'blockquote', 'Depoimento incrível.'),
      no('body>main>h1', 'h1', 'Título da página'),
      no('body>main>div>span', 'span', 'Texto solto aqui.'),
      no('body>main>button', 'button', 'Comece agora'),
      no('body>main>button:nth-of-type(2)>span', 'span', 'Compre agora'),
    ],
    links: [
      { seletor: 'a1', texto: 'Saiba mais', ariaLabel: null, visivel: true, clone: false },
      { seletor: 'a2', texto: 'Oculto', visivel: false, clone: false },
      { seletor: 'a3', texto: '', ariaLabel: 'Abrir menu', visivel: true, clone: false },
      { seletor: 'a4', texto: 'Clone', visivel: true, clone: true },
    ],
  };
  const p = { url: 'https://exemplo.com.br/x?y=1', cru: { extr: { nos: [no('p', 'p', 'só no cru')] } }, dom250: { extr: { nos: [] } }, final: { extr } };
  const r = await texto.medir({ paginas: [p] }, { cliches: MINI });
  const t = r.dados.total;
  assert.equal(r.dados.versaoLida, 'final');
  assert.equal(r.dados.paginas[0].pagina, '/x?y=1');
  assert.equal(t.palavras, 11); // parágrafo 3 + fragmento 2 + h1 3 + span solto 3
  assert.equal(t.frases, 3); // fragmento não vira frase; span sem pai com texto vira bloco
  assert.equal(t.ctas.total, 4); // Saiba mais, Abrir menu (aria-label), Comece agora, Compre agora
  assert.equal(t.ctas.genericos, 3); // Saiba mais, Comece agora, Compre agora
  // sem página lida no final, usa dom250 → cru
  const soCru = await texto.medir({ paginas: [{ url: 'https://exemplo.com.br/', cru: { extr } }] }, { cliches: MINI });
  assert.equal(soCru.dados.versaoLida, 'cru');
});

test('texto: fixture c-texto-batido (lista mínima injetada) — valores exatos', async () => {
  const { ctx } = await lerFixture('c-texto-batido');
  const r = medirTexto(ctx.paginas, { cliches: MINI });
  const t = r.total;
  assert.equal(r.versaoLida, 'final');
  assert.equal(t.palavras, 74); // h1 6 + 19 + h2 4 + 13 + 19 (três li) + 13; oculto e rodapé fora
  assert.equal(t.frases, 10);
  assert.equal(t.silabas, 164); // contador heurístico: valor de regressão
  assert.deepEqual(t.legibilidade, { flesch: arred2(fleschPt(74, 10, 164)), faixa: 'fácil', palavrasPorFrase: 7.4, silabasPorPalavra: 2.22 });
  assert.equal(t.cliches.quantidade, 4); // Transforme seu / todo o potencial / experiência completa / excelência (o "Transforme" oculto não conta)
  assert.equal(t.cliches.pesoTotal, 10);
  assert.equal(t.cliches.porMil, 54.05);
  assert.equal(t.cliches.indicePonderado, 135.14);
  assert.deepEqual(t.travessoes, { quantidade: 1, porMil: 13.51 });
  assert.deepEqual(t.exclamacoes, { quantidade: 2, porMil: 27.03 });
  assert.equal(t.especificidade.frasesEspecificas, 0);
  assert.equal(t.especificidade.fracao, 0);
  assert.equal(t.repeticao.naoEXEY, 1);
  assert.equal(t.repeticao.tricolons, 1);
  assert.equal(t.repeticao.frasesComAberturaRepetida, 0);
  assert.deepEqual({ total: t.ctas.total, genericos: t.ctas.genericos, fracao: t.ctas.fracaoGenericos }, { total: 6, genericos: 3, fracao: 0.5 }); // Início, Serviços, Saiba mais, Comece agora, Fale conosco, Sobre nós
  assert.deepEqual(t.ctas.lista.map((c) => c.texto), ['Comece agora', 'Fale conosco', 'Saiba mais']);
  assert.equal(t.headlinesVagos, 1);
  assert.equal(r.headlinesVagos[0].texto, 'Transforme seu negócio com soluções inovadoras');
  assert.equal(t.loremIpsum, 0); // o "Lorem ipsum" está num parágrafo oculto
  assert.equal(r.fraseParaTesteDaTroca.length, 5);
  // cada trecho de evidência existe no texto visível da página
  const visivel = ctx.paginas[0].final.extr.nos.filter((n) => n.visivel && !n.clone).map((n) => n.texto).join('\n');
  for (const o of r.cliches.ocorrencias) assert.ok(visivel.includes(o.trecho), o.trecho);
  for (const f of r.fraseParaTesteDaTroca) assert.ok(visivel.includes(f.frase), f.frase);
  for (const e of r.estruturas.naoEXEY) assert.ok(visivel.includes(e.trecho), e.trecho);
  for (const e of r.estruturas.tricolons) assert.ok(visivel.includes(e.trecho), e.trecho);
  assert.ok(!r.fraseParaTesteDaTroca.some((f) => /Lorem|Todos os direitos/.test(f.frase)));
});

test('texto: fixture c-texto-bom (lista mínima injetada) — específica, sem clichê, sem CTA genérico', async () => {
  const { ctx } = await lerFixture('c-texto-bom');
  const r = medirTexto(ctx.paginas, { cliches: MINI });
  const t = r.total;
  assert.equal(t.palavras, 70);
  assert.equal(t.frases, 5);
  assert.equal(t.silabas, 122); // regressão do contador heurístico
  assert.equal(t.legibilidade.flesch, arred2(fleschPt(70, 5, 122)));
  assert.equal(t.legibilidade.faixa, 'muito fácil');
  assert.equal(t.cliches.quantidade, 0);
  assert.equal(t.cliches.porMil, 0);
  assert.deepEqual(t.especificidade, { frasesEspecificas: 5, fracao: 1, porCategoria: { numero: 5, nomeProprio: 3, moeda: 1, unidade: 3, data: 2 } });
  assert.equal(t.ctas.total, 2);
  assert.equal(t.ctas.genericos, 0);
  assert.equal(t.headlinesVagos, 0);
  assert.equal(t.repeticao.naoEXEY + t.repeticao.tricolons, 0);
  assert.deepEqual(r.fraseParaTesteDaTroca, []); // nenhuma frase genérica para o teste da troca
});

test('texto: com o arquivo real de clichês, o batido pontua muito mais que o bom', async () => {
  const a = await lerFixture('c-texto-batido');
  const b = await lerFixture('c-texto-bom');
  const rb = await texto.medir(a.ctx);
  const rg = await texto.medir(b.ctx);
  assert.equal(rb.dados.cliches.lista.origem, 'arquivo');
  assert.ok(rb.dados.cliches.lista.total >= 100);
  assert.deepEqual(rb.dados.cliches.lista.invalidos, []);
  assert.ok(rb.dados.total.cliches.quantidade >= 5);
  assert.equal(rg.dados.total.cliches.quantidade, 0);
  assert.ok(rb.dados.total.cliches.indicePonderado > rg.dados.total.cliches.indicePonderado);
  assert.equal(rb.dados.fraseParaTesteDaTroca.length, 5);
  assert.deepEqual(rg.dados.fraseParaTesteDaTroca, []);
  assert.ok(rb.evidencias.length > 0);
  assert.ok(rb.evidencias.every((e) => e.pagina === '/' && e.versao === 'final' && e.trecho && e.visivel === true));
  assert.ok(rb.evidencias.some((e) => e.valor === 'teste-da-troca'));
});

test('texto: determinismo (duas execuções, mesmo resultado)', async () => {
  const { ctx } = await lerFixture('c-texto-batido');
  const a = await texto.medir(ctx, { cliches: MINI });
  const b = await texto.medir(ctx, { cliches: MINI });
  assert.deepEqual(a, b);
  const c = await texto.medir(ctx);
  const d = await texto.medir(ctx);
  assert.deepEqual(c, d);
});

test('texto: nunca afirma autoria por IA (nenhum campo de saída fala em "escrito por IA")', async () => {
  const { ctx } = await lerFixture('c-texto-batido');
  const r = await texto.medir(ctx);
  const json = JSON.stringify(r);
  assert.ok(!/escrit[oa]s? por (uma )?(ia|intelig[eê]ncia artificial)|gerad[oa]s? por (ia|chatgpt)|written by ai/i.test(json));
});
