// Medidor axe (M2.5): acessibilidade (WCAG 2.x A/AA + boas práticas) com axe-core, por página amostrada.
//
// Cada página é aberta de novo, num contexto novo e efêmero do navegador isolado (nav.novoContexto()),
// o axe-core é injetado e roda com as tags abaixo. O axe MEDE; quem julga é o modelo.
//
// Nós sob clone de carrossel (cópias aria-hidden de itens visíveis) são ignorados. A comparação usa os nós
// marcados `clone:true` no extrator (pagina.final.extr): resolvidos de volta para elementos no DOM vivo.
// O que está sob aria-hidden mas não foi confirmado como clone fica com `suspeitoDeClone:true` (e é mantido).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { saidaMedidor } from '../contexto.mjs';

export const id = 'axe';
export const VERSAO = '1';
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
export const TIMEOUT_PAGINA_MS = 30000;
const ESPERA_REDE_OCIOSA_MS = 5000;
const MAX_NOS_POR_VIOLACAO = 10;
const MAX_EVIDENCIAS = 300;

const require = createRequire(import.meta.url);
let _caminhoAxe = null;
export function caminhoAxe() {
  if (!_caminhoAxe) _caminhoAxe = require.resolve('axe-core/axe.min.js');
  return _caminhoAxe;
}

const ORDEM_IMPACTO = ['critical', 'serious', 'moderate', 'minor'];

// Seletores (formato do extrator) de tudo que o extrator marcou como clone nesta página.
function seletoresClone(pagina) {
  const extr = pagina?.final?.extr;
  const sels = new Set();
  if (!extr) return [];
  for (const lista of [extr.nos, extr.imagens, extr.links, extr.headings, extr.formularios]) {
    for (const x of lista || []) if (x.clone && x.seletor) sels.add(x.seletor);
  }
  return [...sels];
}

// Roda DENTRO do navegador. Autossuficiente.
async function rodarAxeNoDom({ tags, seletoresClone: selClone, maxNos }) {
  const resultado = await window.axe.run(document, {
    runOnly: { type: 'tag', values: tags },
    resultTypes: ['violations', 'incomplete'],
    reporter: 'v1',
  });
  // Elementos clone (resolvidos a partir dos seletores do extrator).
  const clones = [];
  for (const s of selClone) {
    try { const e = document.querySelector(s); if (e) clones.push(e); } catch (err) { /* seletor inválido: ignora */ }
  }
  const classeClone = /(^|[-_ ])(clone|cloned|duplicate|duplicated)([-_ ]|$)/i;
  const alvoDe = (target) => {
    // target: ['#a', '.b'] (ou aninhado para iframe/shadow). Só resolvemos o caso simples (1 nível).
    if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== 'string') return null;
    try { return document.querySelector(target[0]); } catch (err) { return null; }
  };
  const classificar = (target) => {
    const el = alvoDe(target);
    if (!el) return { clone: false, suspeito: false };
    if (clones.some((c) => c === el || c.contains(el))) return { clone: true, suspeito: false };
    const ah = el.closest('[aria-hidden="true"]');
    if (ah && clones.some((c) => ah.contains(c))) return { clone: true, suspeito: false };
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = typeof e.className === 'string' ? e.className : '';
      if (c && classeClone.test(c)) return { clone: true, suspeito: false };
    }
    return { clone: false, suspeito: !!ah };
  };
  const cortar = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

  const violacoes = [];
  const ignoradas = [];
  for (const v of resultado.violations) {
    const nosOk = [];
    let nosClone = 0;
    for (const n of v.nodes) {
      const c = classificar(n.target);
      if (c.clone) { nosClone += 1; continue; }
      nosOk.push({
        seletor: n.target.flat ? n.target.flat(Infinity).join(' ') : String(n.target),
        html: cortar(n.html, 200),
        resumoDeFalha: cortar(n.failureSummary, 400),
        ...(c.suspeito ? { suspeitoDeClone: true } : {}),
      });
    }
    const base = { id: v.id, impacto: v.impact || null, ajuda: v.help, helpUrl: v.helpUrl, tags: v.tags };
    if (!nosOk.length) { ignoradas.push({ ...base, nosIgnoradosPorClone: nosClone }); continue; }
    violacoes.push({ ...base, nosTotal: nosOk.length, nosIgnoradosPorClone: nosClone, nos: nosOk.slice(0, maxNos) });
  }
  const incompletos = resultado.incomplete.map((v) => {
    let nosClone = 0;
    for (const n of v.nodes) if (classificar(n.target).clone) nosClone += 1;
    return { id: v.id, impacto: v.impact || null, ajuda: v.help, helpUrl: v.helpUrl, nosTotal: v.nodes.length - nosClone, exemplo: v.nodes.length ? cortar(v.nodes[0].html, 160) : '' };
  }).filter((v) => v.nosTotal > 0);

  return {
    versaoAxe: window.axe.version,
    violacoes,
    ignoradasPorClone: ignoradas,
    incompletos,
    brutos: { violacoes: resultado.violations.length, incompletos: resultado.incomplete.length },
  };
}

async function injetarAxe(page) {
  try {
    await page.addScriptTag({ path: caminhoAxe() });
  } catch { /* CSP pode barrar a tag: cai no evaluate abaixo */ }
  const ok = await page.evaluate(() => typeof window.axe !== 'undefined' && typeof window.axe.run === 'function').catch(() => false);
  if (!ok) await page.evaluate(readFileSync(caminhoAxe(), 'utf8')); // evaluate não sofre CSP
}

async function medirPagina(nav, pagina) {
  const url = pagina.url;
  const t0 = Date.now();
  const ctx = await nav.novoContexto();
  let temporizador;
  const limite = new Promise((_, rej) => { temporizador = setTimeout(() => { rej(new Error(`tempo esgotado (${TIMEOUT_PAGINA_MS / 1000} s)`)); ctx.close().catch(() => {}); }, TIMEOUT_PAGINA_MS); });
  const trabalho = (async () => {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT_PAGINA_MS - 5000 });
    await page.waitForLoadState('networkidle', { timeout: ESPERA_REDE_OCIOSA_MS }).catch(() => {});
    await injetarAxe(page);
    // contagem de passes/inaplicáveis exige rodar com esses tipos: pedimos só as quantidades, sem os nós.
    const dadosAxe = await page.evaluate(rodarAxeNoDom, { tags: TAGS, seletoresClone: seletoresClone(pagina), maxNos: MAX_NOS_POR_VIOLACAO });
    const contagens = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['passes', 'inapplicable'], reporter: 'v1' });
      return { passes: r.passes.length, inaplicaveis: r.inapplicable.length };
    }, TAGS);
    return { dadosAxe, contagens };
  })();
  trabalho.catch(() => {}); // evita rejeição não tratada se o limite vencer antes
  try {
    const { dadosAxe, contagens } = await Promise.race([trabalho, limite]);
    return {
      url,
      versaoAxe: dadosAxe.versaoAxe,
      violacoes: dadosAxe.violacoes,
      incompletos: dadosAxe.incompletos,
      ignoradasPorClone: dadosAxe.ignoradasPorClone,
      contagens: { violacoes: dadosAxe.violacoes.length, passes: contagens.passes, incompletos: dadosAxe.incompletos.length, inaplicaveis: contagens.inaplicaveis },
      duracaoMs: Date.now() - t0,
    };
  } catch (e) {
    return { url, erro: String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300), duracaoMs: Date.now() - t0 };
  } finally {
    clearTimeout(temporizador);
    await ctx.close().catch(() => {});
  }
}

function agregar(porPagina) {
  const mapa = new Map();
  const incompletosMapa = new Map();
  const tot = { violacoes: 0, passes: 0, incompletos: 0, inaplicaveis: 0 };
  for (const p of porPagina) {
    if (p.erro) continue;
    tot.passes += p.contagens.passes;
    tot.incompletos += p.contagens.incompletos;
    tot.inaplicaveis += p.contagens.inaplicaveis;
    for (const v of p.violacoes) {
      let a = mapa.get(v.id);
      if (!a) { a = { id: v.id, impacto: v.impacto, ajuda: v.ajuda, helpUrl: v.helpUrl, tags: v.tags, nosTotal: 0, paginas: [], nos: [] }; mapa.set(v.id, a); }
      a.nosTotal += v.nosTotal;
      a.paginas.push({ url: p.url, nos: v.nosTotal });
      for (const n of v.nos) if (a.nos.length < MAX_NOS_POR_VIOLACAO) a.nos.push({ pagina: p.url, ...n });
    }
    for (const i of p.incompletos) {
      const a = incompletosMapa.get(i.id) || { id: i.id, impacto: i.impacto, ajuda: i.ajuda, helpUrl: i.helpUrl, nosTotal: 0, paginas: [] };
      a.nosTotal += i.nosTotal; a.paginas.push(p.url);
      incompletosMapa.set(i.id, a);
    }
  }
  const violacoes = [...mapa.values()].sort((a, b) => (ORDEM_IMPACTO.indexOf(a.impacto) + 1 || 9) - (ORDEM_IMPACTO.indexOf(b.impacto) + 1 || 9) || b.nosTotal - a.nosTotal || a.id.localeCompare(b.id));
  tot.violacoes = violacoes.length;
  const porImpacto = Object.fromEntries(ORDEM_IMPACTO.map((i) => [i, violacoes.filter((v) => v.impacto === i).length]));
  const incompletos = [...incompletosMapa.values()].sort((a, b) => b.nosTotal - a.nosTotal || a.id.localeCompare(b.id));
  return { violacoes, incompletos, contagens: tot, violacoesPorImpacto: porImpacto };
}

export async function medir(ctx) {
  const nav = ctx.navegador;
  if (!nav || typeof nav.novoContexto !== 'function') {
    return saidaMedidor(id, { indisponivel: 'navegador não disponível no contexto (ctx.navegador)' }, [], VERSAO);
  }
  const porPagina = [];
  for (const pagina of ctx.paginas || []) porPagina.push(await medirPagina(nav, pagina));
  const agregado = agregar(porPagina);

  const evidencias = [];
  for (const v of agregado.violacoes) {
    for (const n of v.nos) {
      if (evidencias.length >= MAX_EVIDENCIAS) break;
      evidencias.push({ pagina: n.pagina, versao: 'final', seletor: n.seletor, trecho: n.html, valor: `${v.id} (${v.impacto})`, contagem: v.nosTotal, visivel: true });
    }
  }
  const dados = {
    tags: TAGS,
    versaoAxe: porPagina.find((p) => p.versaoAxe)?.versaoAxe || null,
    paginasMedidas: porPagina.filter((p) => !p.erro).length,
    paginasComErro: porPagina.filter((p) => p.erro).map((p) => ({ url: p.url, erro: p.erro })),
    porPagina,
    agregado,
    nota: 'Nós sob clone de carrossel são ignorados (ver ignoradasPorClone por página). `suspeitoDeClone` marca o que está sob aria-hidden sem confirmação.',
  };
  return saidaMedidor(id, dados, evidencias, VERSAO);
}
