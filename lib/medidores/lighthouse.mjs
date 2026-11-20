// Medidor Lighthouse (M2.6): desempenho, acessibilidade, boas práticas e SEO, medidos pelo Lighthouse
// num Chromium próprio (o do Playwright, dentro da pasta do projeto) lançado via chrome-launcher.
//
// Modos (SPEC §7.4):
//   rapido   : só a home, mobile (config padrão do Lighthouse).
//   completo : até 3 páginas (home + 2) em mobile, e a home também em desktop.
//
// VARIAÇÃO: uma única execução do Lighthouse varia de uma rodada para outra (CPU, rede e carga da máquina).
// Por isso `dados.variacao` traz esse aviso e os números devem ser lidos em faixas, não como valor exato.
//
// Segurança: o Lighthouse conduz o Chromium direto (fora do roteamento anti-SSRF do navegador isolado).
// Por isso cada URL passa por urlPermitida() ANTES de ser medida; URLs bloqueadas viram {erro}.
import { saidaMedidor } from '../contexto.mjs';
import { urlPermitida } from '../rede-segura.mjs';
// Importar o navegador.mjs seta PLAYWRIGHT_BROWSERS_PATH=0 (Chromium dentro da pasta do projeto).
import '../navegador.mjs';

export const id = 'lighthouse';
export const VERSAO = '1';
export const TIMEOUT_EXECUCAO_MS = 120000;
export const CATEGORIAS = ['performance', 'accessibility', 'best-practices', 'seo'];
export const VARIACAO = 'Uma única execução do Lighthouse varia entre rodadas (carga da máquina, rede, CPU); ' +
  'as notas e métricas são uma amostra, não um valor exato. Leia-as em faixas e confirme com mais de uma medição antes de concluir.';

const MAX_AUDITORIAS_REPROVADAS = 30;
const MAX_OPORTUNIDADES = 15;

const METRICAS = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbt: 'total-blocking-time',
  speedIndex: 'speed-index',
  tti: 'interactive',
};

async function caminhoChromium() {
  const { chromium } = await import('playwright');
  return chromium.executablePath();
}

// Lança o Chromium via chrome-launcher. --no-sandbox só se o lançamento normal falhar.
async function lancarChrome(chromePath) {
  const chromeLauncher = await import('chrome-launcher');
  const base = ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', '--mute-audio'];
  // SEGURANÇA: sem fallback para --no-sandbox (rodaria JS de terceiros sem a proteção do Chromium). Falhar é melhor.
  try {
    return await chromeLauncher.launch({ chromePath, chromeFlags: base, logLevel: 'silent', port: 0 });
  } catch (e1) {
    throw new Error(`não foi possível iniciar o Chromium com sandbox: ${String(e1.message).split('\n')[0]}`);
  }
}

function resumirLhr(lhr, url, formFactor) {
  const scores = {};
  for (const c of CATEGORIAS) {
    const cat = lhr.categories?.[c];
    scores[c] = cat && typeof cat.score === 'number' ? Math.round(cat.score * 100) : null;
  }
  const metricas = {};
  for (const [chave, auditId] of Object.entries(METRICAS)) {
    const a = lhr.audits?.[auditId];
    if (a && typeof a.numericValue === 'number') {
      metricas[chave] = { valor: chave === 'cls' ? Math.round(a.numericValue * 1000) / 1000 : Math.round(a.numericValue), unidade: a.numericUnit === 'unitless' ? '' : (a.numericUnit || 'millisecond'), exibicao: a.displayValue || null };
    } else metricas[chave] = null;
  }
  // categoria de cada auditoria (primeira em que aparece)
  const categoriaDe = {};
  for (const c of CATEGORIAS) for (const ref of lhr.categories?.[c]?.auditRefs || []) if (!categoriaDe[ref.id]) categoriaDe[ref.id] = { categoria: c, peso: ref.weight };
  const reprovadas = Object.values(lhr.audits || {})
    .filter((a) => typeof a.score === 'number' && a.score < 0.9 && categoriaDe[a.id] && ['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode))
    .sort((a, b) => (categoriaDe[b.id].peso || 0) - (categoriaDe[a.id].peso || 0) || a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, MAX_AUDITORIAS_REPROVADAS)
    .map((a) => ({ id: a.id, titulo: a.title, valorDeExibicao: a.displayValue || null, score: Math.round(a.score * 100) / 100, categoria: categoriaDe[a.id].categoria }));
  const oportunidades = Object.values(lhr.audits || {})
    .filter((a) => a.details && (a.details.overallSavingsMs > 0 || a.details.overallSavingsBytes > 0))
    .map((a) => ({ id: a.id, titulo: a.title, economiaMs: Math.round(a.details.overallSavingsMs || 0), economiaBytes: Math.round(a.details.overallSavingsBytes || 0), valorDeExibicao: a.displayValue || null }))
    .sort((a, b) => b.economiaMs - a.economiaMs || b.economiaBytes - a.economiaBytes || a.id.localeCompare(b.id))
    .slice(0, MAX_OPORTUNIDADES);
  return {
    url,
    urlFinal: lhr.finalDisplayedUrl || lhr.finalUrl || url,
    formFactor: lhr.configSettings?.formFactor || formFactor,
    versaoLighthouse: lhr.lighthouseVersion,
    scores,
    metricas,
    auditoriasReprovadas: reprovadas,
    oportunidades,
    avisosDeExecucao: (lhr.runWarnings || []).slice(0, 5),
    erroDeExecucao: lhr.runtimeError ? { codigo: lhr.runtimeError.code, mensagem: String(lhr.runtimeError.message || '').slice(0, 300) } : null,
  };
}

// Uma execução completa, com Chromium próprio, limite de tempo e kill() garantido.
async function executar(url, formFactor, { lighthouse, desktopConfig, chromePath, timeoutMs, rede }) {
  const t0 = Date.now();
  const base = { url, formFactor };
  const permitido = await urlPermitida(url, { permitidos: rede?.permitidos || [], permitirLocal: !!rede?.permitirLocal }).catch((e) => ({ ok: false, motivo: String(e.message) }));
  // Só o que ctx.rede libera (o servidor local do próprio projeto) passa; IPs privados/metadata continuam bloqueados.
  if (!permitido.ok) return { ...base, erro: `URL bloqueada pela política de rede: ${permitido.motivo}` };
  let chrome;
  let temporizador;
  try {
    chrome = await lancarChrome(chromePath);
    const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIAS, maxWaitForLoad: 45000 };
    const config = formFactor === 'desktop' ? desktopConfig : undefined;
    const rodada = lighthouse(url, flags, config);
    rodada.catch(() => {});
    const limite = new Promise((_, rej) => { temporizador = setTimeout(() => rej(new Error(`tempo esgotado (${Math.round(timeoutMs / 1000)} s)`)), timeoutMs); });
    const r = await Promise.race([rodada, limite]);
    if (!r || !r.lhr) throw new Error('o Lighthouse não devolveu resultado');
    return { ...resumirLhr(r.lhr, url, formFactor), duracaoMs: Date.now() - t0 };
  } catch (e) {
    return { ...base, erro: String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300), duracaoMs: Date.now() - t0 };
  } finally {
    clearTimeout(temporizador);
    if (chrome) { try { await chrome.kill(); } catch { /* já encerrado */ } }
  }
}

function escolherPaginas(ctx, max) {
  const paginas = (ctx.paginas || []).filter((p) => p && p.url);
  const home = paginas.find((p) => { try { const u = new URL(p.url); return u.pathname === '/' && u.origin === ctx.site?.origem; } catch { return false; } }) || paginas[0];
  if (!home) return [];
  return [home, ...paginas.filter((p) => p !== home)].slice(0, max).map((p) => p.url);
}

// Plano de execuções do modo (puro, testável): rápido = home mobile; completo = até 3 páginas mobile + home desktop.
export function planoDeExecucoes(ctx) {
  const modo = ctx.site?.modo === 'completo' ? 'completo' : 'rapido';
  const urls = escolherPaginas(ctx, modo === 'completo' ? 3 : 1);
  const plano = urls.map((u) => ({ url: u, formFactor: 'mobile' }));
  if (modo === 'completo' && urls.length) plano.push({ url: urls[0], formFactor: 'desktop' });
  return { modo, urls, plano };
}

export async function medir(ctx, { timeoutMs = TIMEOUT_EXECUCAO_MS } = {}) {
  const { modo, urls, plano } = planoDeExecucoes(ctx);
  if (!urls.length) return saidaMedidor(id, { indisponivel: 'nenhuma página para medir', variacao: VARIACAO }, [], VERSAO);

  let lighthouse, desktopConfig, chromePath;
  try {
    ({ default: lighthouse, desktopConfig } = await import('lighthouse'));
    chromePath = await caminhoChromium();
  } catch (e) {
    return saidaMedidor(id, { erro: `Lighthouse/Chromium indisponível: ${String(e.message).split('\n')[0]}`, variacao: VARIACAO }, [], VERSAO);
  }

  const execucoes = [];
  for (const p of plano) execucoes.push(await executar(p.url, p.formFactor, { lighthouse, desktopConfig, chromePath, timeoutMs, rede: ctx.rede }));

  const principal = execucoes.find((e) => !e.erro && e.formFactor === 'mobile') || execucoes.find((e) => !e.erro) || null;
  const dados = {
    modo,
    versaoLighthouse: principal?.versaoLighthouse || execucoes.find((e) => e.versaoLighthouse)?.versaoLighthouse || null,
    execucoes,
    principal: principal ? { url: principal.url, formFactor: principal.formFactor } : null,
    execucoesComErro: execucoes.filter((e) => e.erro).map((e) => ({ url: e.url, formFactor: e.formFactor, erro: e.erro })),
    variacao: VARIACAO,
  };
  const evidencias = [];
  for (const e of execucoes) {
    if (e.erro) continue;
    for (const c of CATEGORIAS) if (e.scores[c] !== null) evidencias.push({ pagina: e.url, versao: 'final', seletor: null, trecho: `Lighthouse ${e.versaoLighthouse} (${e.formFactor})`, valor: `${c}: ${e.scores[c]}`, contagem: e.scores[c], visivel: true });
  }
  return saidaMedidor(id, dados, evidencias, VERSAO);
}
