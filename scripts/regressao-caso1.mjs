#!/usr/bin/env node
// REGRESSÃO DO SITE DE EXEMPLO Nº 1 (fictício: "Estúdio Aurora", "Guia de Receitas Caseiras").
//   node scripts/regressao-caso1.mjs fixture            -> confere a fixture fictícia (offline, determinística)
//   node scripts/regressao-caso1.mjs tudo               -> idem e grava docs/regressao-caso1.md (só a fixture fictícia)
//   node scripts/regressao-caso1.mjs vivo <url>         -> conferência opcional e local contra um site real
// A URL do modo "vivo" vem do argumento ou da variável de ambiente CRITIQUESITES_URL_VIVO. Nenhum endereço fica guardado
// no repositório, e o resultado ao vivo é gravado só em saidas/ (que o git ignora).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analisar } from '../lib/analisar.mjs';
import { lerJson } from '../lib/util.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(raiz, 'tests', 'fixtures', 'exemplo1');

const textoDoAchado = (a) => [a.mensagem, ...(a.evidencias || []).map((e) => `${e.trecho ?? ''} ${e.valor ?? ''}`), ...(a.citacoes || []).map((c) => String(c.valor ?? ''))].join(' \n ');

export function conferir(analise, medicoes = {}) {
  const achados = analise.achados || [];
  const porRegra = (id) => achados.filter((a) => a.regra_id === id);
  const algum = (re, lista = achados) => lista.find((a) => re.test(textoDoAchado(a)));
  const checks = [];
  const add = (id, tipo, descricao, passou, detalhe = '') => checks.push({ id, tipo, descricao, passou: !!passou, detalhe });

  // ---------- NÃO PODE AFIRMAR ----------
  const tiposJsonld = medicoes.jsonld?.dados?.tiposSoNoFinal || medicoes.jsonld?.dados?.site?.tipos || [];
  const negEstr = algum(/\b(sem|n[ãa]o (h[áa]|possui|tem|usa)|ausência de|nenhum)\b[^.\n]{0,30}dados estruturados/i);
  add('N1', 'nao-pode-afirmar', 'Afirmar "sem dados estruturados" (a página tem WebSite, WebPage, Product, Offer, FAQPage e VideoObject)', !negEstr, negEstr ? `achado ${negEstr.id}: ${negEstr.mensagem}` : `medido: tipos ${JSON.stringify(medicoes.jsonld?.dados?.site?.interesse ?? tiposJsonld).slice(0, 160)}`);
  // Só é erro dizer que o site NÃO usa lazy loading. Contar quantas imagens usam e quantas não usam é fato permitido.
  const negLazy = algum(/(sem lazy loading|n[ãa]o (usa|tem|possui|há) (nenhum )?(lazy|carregamento (tardio|preguiçoso))|nenhuma imagem (usa|tem) (lazy|loading))/i);
  const imgFinal = medicoes.imagens?.dados?.site?.final ?? medicoes.imagens?.dados?.paginas?.[0]?.final ?? {};
  add('N2', 'nao-pode-afirmar', 'Afirmar "sem lazy loading" (45 de 57 imagens usam loading=lazy)', !negLazy, negLazy ? `achado ${negLazy.id}: ${negLazy.mensagem}` : `medido no DOM final: ${imgFinal.lazy ?? '?'} de ${imgFinal.total ?? '?'} imagens com loading=lazy`);
  const dup = algum(/depoiment[^.\n]{0,40}duplic|duplic[^.\n]{0,40}depoiment/i);
  add('N3', 'nao-pode-afirmar', 'Afirmar "depoimentos duplicados" (são clones aria-hidden do carrossel)', !dup, dup ? `achado ${dup.id}: ${dup.mensagem}` : '');
  const infoOculto = new Set(['int2-clone-carrossel-ignorado', 'int2-texto-oculto-nao-e-visivel', 'int2-oculto-diverge-do-visivel']);
  const afirmaOff = achados.find((a) => !infoOculto.has(a.regra_id) && /0\s*%\s*off|oferta encerrada/i.test(textoDoAchado(a)));
  add('N4', 'nao-pode-afirmar', 'Afirmar "0% OFF" ou "oferta encerrada R$ 89" (texto oculto)', !afirmaOff, afirmaOff ? `achado ${afirmaOff.id}: ${afirmaOff.mensagem}` : '');
  // Achados "de método" (texto oculto, clone ignorado) listam o trecho oculto COMO oculto: não são afirmação sobre o site.
  const afirmaGuia = achados.find((a) => !infoOculto.has(a.regra_id) && /R\$\s*97\b|200\+/i.test(textoDoAchado(a)));
  add('N5', 'nao-pode-afirmar', 'Afirmar "Guia R$ 97 e 200+ receitas" (o visível é R$ 39 e 50 receitas)', !afirmaGuia, afirmaGuia ? `achado ${afirmaGuia.id}: ${afirmaGuia.mensagem}` : '');

  // ---------- TEM QUE APONTAR ----------
  const cont = [...porRegra('int2-contador-animado-valor-errado'), ...porRegra('int2-valor-muda-entre-versoes')];
  add('T1', 'tem-que-apontar', 'Contadores animados que começam em 0 e mostram valor errado em captura rápida', cont.length > 0, cont.length ? `achado ${cont[0].id}: ${cont[0].mensagem}` : 'nenhum achado de valor que muda entre versões');
  const gan = porRegra('lei-promessa-de-ganho').find((a) => /3\.?000/.test(textoDoAchado(a)));
  add('T2', 'tem-que-apontar', '"Ganhe R$ 3.000 por mês" no título como possível promessa de ganho (CDC art. 37)', !!gan, gan ? `achado ${gan.id}: ${gan.mensagem}` : 'sem achado de promessa de ganho com 3.000');
  const lPreco = porRegra('a11y-link-texto-repetido-sem-contexto').find((a) => /R\$\s*39\b/.test(textoDoAchado(a)));
  const linksPreco = (medicoes.links?.dados?.links || []).filter((l) => /R\$\s*39\b/.test(l.texto || '')).map((l) => l.texto);
  add('T3', 'tem-que-apontar', 'Links repetidos "R$ 39" sem contexto para leitor de tela', !!lPreco, lPreco ? `achado ${lPreco.id}: ${lPreco.mensagem}` : `sem achado; textos dos links com R$ 39 no código lido: ${JSON.stringify(linksPreco).slice(0, 220)}`);
  add('T4', 'tem-que-apontar', 'Ausência de CNPJ', porRegra('lei-cnpj-ausente').length > 0, porRegra('lei-cnpj-ausente')[0]?.mensagem || '');
  add('T5', 'tem-que-apontar', 'Ausência de termos (de uso)', porRegra('lei-termos-de-uso-ausente').length > 0, porRegra('lei-termos-de-uso-ausente')[0]?.mensagem || '');
  add('T6', 'tem-que-apontar', 'Ausência de política de privacidade', porRegra('lei-politica-privacidade-ausente').length > 0, porRegra('lei-politica-privacidade-ausente')[0]?.mensagem || '');
  const ids = porRegra('lei-analytics-id-vazio');
  const txt = ids.map(textoDoAchado).join(' ');
  const tagsJs = (medicoes.js?.dados?.tags || []).map((t) => `${t.tipo}=${t.id || '(vazio)'}`);
  add('T7', 'tem-que-apontar', 'IDs de GA4 e do pixel da Meta vazios', ids.length > 0 && /ga4|google analytics|G-/i.test(txt) && /meta|fbq|facebook|pixel/i.test(txt), ids.length ? ids.map((a) => a.mensagem).join(' | ').slice(0, 300) : `sem achado; tags no código lido: ${tagsJs.join(', ')}`);
  return checks;
}

function lerMedicoes(pasta) {
  const m = {};
  for (const id of ['jsonld', 'imagens', 'lei', 'links', 'js']) { const a = join(pasta, 'medicoes', `${id}.json`); if (existsSync(a)) m[id] = lerJson(a); }
  return m;
}

const comoScript = Boolean(process.argv[1]) && process.argv[1].split(String.fromCharCode(92)).join('/').endsWith('scripts/regressao-caso1.mjs');

async function rodarEConferir(entrada, opcoes = {}) {
  const r = await analisar({ entrada, modo: 'rapido', limitePaginas: opcoes.limitePaginas ?? 8, intervaloMs: opcoes.intervaloMs ?? 1000, saidas: join(raiz, 'saidas'), ignorarMedidores: ['lighthouse'], usarCache: false, aoProgredir: (m) => console.error('[regressao]', m) });
  const analise = lerJson(join(r.pasta, 'analise-parcial.json'));
  return { pasta: r.pasta, analise, checks: conferir(analise, lerMedicoes(r.pasta)) };
}

function tabela(res) {
  const ok = res.checks.filter((c) => c.passou).length;
  const linhas = [`Análise: ${basename(dirname(res.pasta))}/${basename(res.pasta)} · carimbo ${res.analise.carimbo.iso} · hash ${res.analise.carimbo.hash.slice(0, 16)}…`, '', `**Resultado: ${ok} de ${res.checks.length} itens passaram.**`, '', '| Item | Tipo | Descrição | Resultado | Detalhe |', '|---|---|---|---|---|'];
  for (const c of res.checks) linhas.push(`| ${c.id} | ${c.tipo === 'nao-pode-afirmar' ? 'NÃO pode afirmar' : 'TEM que apontar'} | ${c.descricao.replace(/\|/g, '/')} | ${c.passou ? 'passou' : '**FALHOU**'} | ${String(c.detalhe).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 260)} |`);
  return linhas.join('\n');
}

if (comoScript) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'tudo' || cmd === 'fixture') {
    const fx = await rodarEConferir(FIXTURE, { intervaloMs: 0, limitePaginas: 1 });
    if (cmd === 'tudo') {
      const md = [
        '# Regressão do site de exemplo nº 1 (v3)', '',
        'Site de exemplo totalmente fictício (fixture `tests/fixtures/exemplo1`: "Estúdio Aurora", "Guia de Receitas Caseiras"). Prova que a skill sabe apontar o que tem que apontar e não afirma o que não pode afirmar. A leitura é feita offline e o resultado é determinístico.', '',
        tabela(fx), '',
        'Quem quiser conferir contra um site real passa a URL por argumento (`node scripts/regressao-caso1.mjs vivo <url>`); o resultado fica em `saidas/` (fora do git).', '',
      ].join('\n');
      writeFileSync(join(raiz, 'docs', 'regressao-caso1.md'), md);
    }
    console.log(JSON.stringify({ passaram: fx.checks.filter((c) => c.passou).length, total: fx.checks.length, falhas: fx.checks.filter((c) => !c.passou) }, null, 2));
    process.exit(fx.checks.every((c) => c.passou) ? 0 : 1);
  } else if (cmd === 'vivo') {
    const url = arg || process.env.CRITIQUESITES_URL_VIVO;
    if (!url) { console.error('uso: vivo <url>  (ou defina CRITIQUESITES_URL_VIVO)'); process.exit(2); }
    const vivo = await rodarEConferir(url);
    const pastaSaida = join(raiz, 'saidas');
    mkdirSync(pastaSaida, { recursive: true });
    const arquivo = join(pastaSaida, 'regressao-vivo.md');
    writeFileSync(arquivo, ['# Conferência ao vivo (local, fora do git)', '', 'Os itens abaixo são os do site de exemplo nº 1; em um site real é normal alguns não se aplicarem. A skill só afirma o que está no código lido.', '', tabela(vivo), ''].join('\n'));
    console.log(JSON.stringify({ gravado_em: arquivo, passaram: vivo.checks.filter((c) => c.passou).length, total: vivo.checks.length }, null, 2));
  } else {
    console.error('uso: fixture | tudo | vivo <url>');
    process.exit(2);
  }
}
