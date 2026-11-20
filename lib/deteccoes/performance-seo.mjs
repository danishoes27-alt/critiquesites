// DETECTORES de performance (regras/performance.json) e SEO (regras/seo.json).
//
// Contrato (lib/motor.mjs): cada detector recebe { ctx, med, regra } e devolve
//   null                       -> regra NÃO avaliável (medidor ausente/com erro, dado que não foi medido, não se aplica);
//                                 nunca significa "ok".
//   { disparou, intensidade, achados:[{ pagina, mensagem, evidencias, citacoes, severidade?, instavel?, numeros_permitidos? }] }
//
// Princípios deste arquivo:
//  - o detector NUNCA opina além do que foi medido; mensagens em português simples, sem autoria por IA;
//  - toda citação (trecho / contagem / número) é CONFERIDA aqui com o próprio verificador (`verificarCitacao`) antes de sair:
//    o que não existe no código analisado não vai para o achado (o verificador final descartaria o achado inteiro);
//  - números que NÃO estão no texto do site (LCP em ms, bytes, KiB, notas do Lighthouse...) viram `evidencias` e
//    `numeros_permitidos` do achado;
//  - achado de selo "fato" precisa de pelo menos 1 citação verificável. Quando o fato vem do Lighthouse/HTTP (fora do HTML),
//    ancoramos o achado em algo que EXISTE na página: o <title> (em `onde:'html'`) ou, na falta dele, a contagem de links
//    (`contagem links`). Ver `ancora()`. Hoje só regras de selo "regra" dependem do Lighthouse, então isso é só proteção.
//  - Lighthouse: o medidor devolve métricas, notas, `auditoriasReprovadas` (score < 0.9, no máximo 30) e `oportunidades`.
//    Os detectores usam isso e, se o medidor passar a expor `execucao.auditorias[id]` ({score, numericValue, numericUnit,
//    displayValue, itens}), usam esse mapa com prioridade (ver `acharAuditoria`).
import { montarCorpus, verificarCitacao, CONTAGENS } from '../verificador.mjs';
import { extrairNumeros, normalizarTexto, numerosIguais, normalizarUrl } from '../util.mjs';
import { analisarUrlAmigavel } from '../medidores/seo.mjs';

// ============================================================ utilitários gerais
const DOBRA_PX = 900; // mesma dobra do medidor "imagens" (altura da janela desktop usada na captura)
const VIEWPORT_AREA = 1440 * 900;
const DPR_REFERENCIA = 2; // maior densidade de tela comum; evita acusar imagem "retina" legítima
const MAX_EXEMPLOS = 5;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const unicos = (lista) => [...new Set(lista)];
const rotulo = { cru: 'no HTML cru', dom250: 'aos 250 ms', final: 'no DOM final' };
const plural = (n, um, varios) => (n === 1 ? um : varios);
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
// [{v, texto}] -> [{v:[versões], texto}] (junta o mesmo texto visto nas duas versões)
function juntarPorVersao(itens) {
  const mapa = new Map();
  for (const { v, texto } of itens) { if (!mapa.has(texto)) mapa.set(texto, []); if (!mapa.get(texto).includes(v)) mapa.get(texto).push(v); }
  return [...mapa].map(([t, vs]) => ({ v: vs, texto: t }));
}
const versoesTexto = (vs) => vs.map((x) => rotulo[x]).join(' e ');

// pt-BR: 1.234 e 1,5
function fmt(n, casas = 0) {
  const s = Number(n).toFixed(casas);
  const [inteiro, dec] = s.split('.');
  const com = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${com},${dec}` : com;
}
const fmtS = (ms) => `${fmt(ms / 1000, 1)} s`;
const kib = (bytes) => bytes / 1024;

// números que a mensagem cita e que NÃO estão no texto do site (medições): viram `numeros_permitidos`
const numerosDe = (...valores) => unicos(valores.flatMap((x) => (typeof x === 'number' ? [String(x)] : extrairNumeros(String(x)).map(String))));

const medidorOk = (med, id) => { const m = med?.[id]; return m && !m.erro && m.dados ? m.dados : null; };

// Entrada "URL" (site publicado) x pasta/ZIP/código colado (servidor local 127.0.0.1): regras de cabeçalho/hospedagem
// só valem para URL, porque numa pasta os cabeçalhos são do servidor temporário local.
const hostLocal = (h) => /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?|0\.0\.0\.0)(:\d+)?$/i.test(h) || /\.(localhost|test)(:\d+)?$/i.test(h);
function entradaEhUrl(ctx) {
  let h = ctx?.site?.host || '';
  if (!h) { try { h = new URL(ctx?.site?.urlInicial).host; } catch { h = ''; } }
  return !!h && !hostLocal(h);
}

// lista de páginas do ctx, ordenada por URL (mesma ordem dos medidores)
function paginasDe(ctx) {
  return (ctx.paginas || []).filter((p) => p && p.url).map((p) => ({
    p, url: p.url, caminho: caminhoDe(p.url),
    cru: p.cru?.extr || null, final: p.final?.extr || null,
    htmlCru: p.cru?.html || '', htmlFinal: p.final?.html || '',
  })).sort((a, b) => cmp(a.url, b.url));
}
const paginaInicial = (pgs) => pgs.find((g) => g.caminho === '/') || pgs[0] || null;
const porUrl = (lista, url) => (lista || []).find((x) => x.url === url);

// ============================================================ verificação das citações (antes de emitir)
const corpusCache = new WeakMap();
function corpusDe(ctx) {
  let c = corpusCache.get(ctx);
  if (!c) { c = montarCorpus(ctx); corpusCache.set(ctx, c); }
  return c;
}
const citacaoOk = (ctx, c) => { try { return verificarCitacao(c, corpusDe(ctx)).ok; } catch { return false; } };
const citacoesVerificaveis = (ctx, lista) => lista.filter(Boolean).filter((c) => citacaoOk(ctx, c));

// Citação de contagem recomputada a partir do extrator (garante `esperado` igual ao que o verificador recalcula).
function citContagem(pg, versao, fn, extra = {}) {
  const ex = pg[versao];
  if (!ex || !CONTAGENS[fn]) return null;
  return { tipo: 'contagem', versoes: [versao], pagina: pg.url, contagem: { fn, ...extra, esperado: CONTAGENS[fn](ex, extra) } };
}
const citTrecho = (pg, valor, onde, versoes) => (valor && String(valor).trim() ? { tipo: 'trecho', valor: String(valor), onde, versoes, pagina: pg.url } : null);

// Âncora para achados cujo fato vem de fora do HTML: algo que existe na página (título; senão, contagem de links).
function ancora(ctx, pg) {
  for (const v of ['final', 'cru']) {
    const t = pg[v]?.titulo;
    const c = t ? citTrecho(pg, t, 'html', [v]) : null;
    if (c && citacaoOk(ctx, c)) return c;
  }
  for (const v of ['final', 'cru']) {
    const c = citContagem(pg, v, 'links');
    if (c && citacaoOk(ctx, c)) return c;
  }
  return null;
}

// Monta um achado no formato do motor, conferindo as citações. `opiniao` sem trecho verificável não é emitida (retorna null).
function montar(ctx, regra, pg, { mensagem, evidencias = [], citacoes = [], numeros = [], severidade = null, instavel = false }) {
  const cits = citacoesVerificaveis(ctx, citacoes);
  if (regra.selo === 'fato' && !cits.length) { const a = ancora(ctx, pg); if (a) cits.push(a); }
  if (regra.selo === 'opiniao' && !cits.some((c) => c.tipo === 'trecho')) return null;
  const ev = evidencias.map((e) => ({ pagina: pg.caminho, ...e }));
  return {
    pagina: pg.caminho, mensagem, evidencias: ev, citacoes: cits,
    ...(numeros.length ? { numeros_permitidos: numerosDe(...numeros) } : {}),
    ...(severidade ? { severidade } : {}),
    ...(instavel ? { instavel: true } : {}),
  };
}
const resultado = (achados, intensidade = 1) => {
  const lista = achados.filter(Boolean);
  return { disparou: lista.length > 0, intensidade: lista.length ? Math.max(0, Math.min(1, intensidade)) : 0, achados: lista };
};
const naoDisparou = () => ({ disparou: false, intensidade: 0, achados: [] });
const fracao = (n, total) => (total > 0 ? Math.max(0, Math.min(1, n / total)) : 0);
const exemplo = (img) => ({ seletor: img.seletor, trecho: String(img.src ?? '').slice(0, 200), visivel: img.visivel === true });

// último pedaço do caminho de uma URL/src (para achar o mesmo arquivo no HTML)
function nomeDoArquivo(src) {
  const s = String(src ?? '');
  if (!s || s.startsWith('data:')) return '';
  let caminho = s;
  try { caminho = new URL(s, 'http://x.invalid/').pathname; } catch { /* usa o texto */ }
  return caminho.split('/').filter(Boolean).pop() || '';
}
const chaveSrc = (src) => {
  const s = String(src ?? '');
  if (s.startsWith('data:')) return s;
  try { const u = new URL(s, 'http://x.invalid/'); return (u.pathname + u.search).replace(/^\/+/, ''); } catch { return s.replace(/^\.?\/+/, ''); }
};

// ============================================================ Lighthouse
function lighthouse(med) {
  const m = med?.lighthouse;
  if (!m || m.erro || !m.dados) return null;
  const d = m.dados;
  if (d.erro || d.indisponivel || !Array.isArray(d.execucoes)) return null;
  const execs = d.execucoes.filter((e) => e && !e.erro);
  if (!execs.length) return null;
  const mobile = execs.filter((e) => e.formFactor === 'mobile');
  return { d, execs, mobile: mobile.length ? mobile : execs };
}

// Procura uma auditoria (primeiro o mapa `auditorias`, se o medidor o expuser; depois reprovadas/oportunidades).
function acharAuditoria(exec, ids) {
  for (const id of ids) {
    const x = exec.auditorias?.[id];
    if (x) {
      return {
        id, origem: 'auditorias', reprovada: typeof x.score === 'number' ? x.score < 0.9 : false, score: x.score ?? null,
        valorDeExibicao: x.displayValue ?? x.valorDeExibicao ?? null, numericValue: x.numericValue ?? null, numericUnit: x.numericUnit ?? null,
        itens: x.itens || x.items || x.details?.items || null, economiaMs: null, economiaBytes: null,
      };
    }
    const r = (exec.auditoriasReprovadas || []).find((a) => a.id === id);
    const o = (exec.oportunidades || []).find((a) => a.id === id);
    if (r || o) {
      return {
        id, origem: r ? 'reprovadas' : 'oportunidades', reprovada: !!r, score: r?.score ?? null,
        valorDeExibicao: r?.valorDeExibicao ?? o?.valorDeExibicao ?? null, numericValue: null, numericUnit: null, itens: null,
        economiaMs: o?.economiaMs ?? null, economiaBytes: o?.economiaBytes ?? null,
      };
    }
  }
  return null;
}
// A lista de reprovadas é cortada em 30: se ela está cheia, "não apareceu" não prova "passou".
const listaSaturada = (exec) => !exec.auditorias && (exec.auditoriasReprovadas || []).length >= 30;
// Auditoria que NÃO apareceu: sem o mapa `auditorias`, ausência entre as reprovadas (nota >= 0,9) significa "passou" (false),
// salvo lista cheia. Com o mapa, ausência significa "não foi medida": inconclusivo (undefined).
const semAuditoria = (exec) => (exec.auditorias || listaSaturada(exec) ? undefined : false);

// "Est savings of 5 KiB", "Total size was 5,123 KiB", "Root document took 1,230 ms" (Lighthouse em en-US)
function valoresDeExibicao(txt) {
  const saida = [];
  for (const m of String(txt ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(KiB|MiB|KB|MB|ms|s)\b/g)) saida.push({ valor: Number(m[1].replace(/,/g, '')), unidade: m[2] });
  return saida;
}
function emKib(a) {
  if (typeof a.economiaBytes === 'number' && a.economiaBytes > 0) return kib(a.economiaBytes);
  if (a.numericUnit === 'byte' && typeof a.numericValue === 'number') return kib(a.numericValue);
  const v = valoresDeExibicao(a.valorDeExibicao).find((x) => /^(KiB|KB|MiB|MB)$/.test(x.unidade));
  if (!v) return null;
  return /^M/.test(v.unidade) ? v.valor * 1024 : v.valor;
}
function emMs(a) {
  if (a.numericUnit === 'millisecond' && typeof a.numericValue === 'number') return a.numericValue;
  const v = valoresDeExibicao(a.valorDeExibicao).find((x) => /^(ms|s)$/.test(x.unidade));
  if (v) return v.unidade === 's' ? v.valor * 1000 : v.valor;
  if (typeof a.economiaMs === 'number' && a.economiaMs > 0) return a.economiaMs;
  return null;
}

const evLH = (e, valor, contagem) => ({ versao: 'final', trecho: `Lighthouse ${e.versaoLighthouse || ''} (${e.formFactor})`.replace(/\s+/g, ' ').trim(), valor, ...(typeof contagem === 'number' ? { contagem } : {}) });
// uma "página" mínima para âncora/pagina do achado a partir da URL medida pelo Lighthouse
function paginaDoExec(ctx, e) {
  const pgs = paginasDe(ctx);
  return pgs.find((g) => g.url === e.url) || pgs.find((g) => g.url === e.urlFinal) || { url: e.url, caminho: caminhoDe(e.url), cru: null, final: null, htmlCru: '', htmlFinal: '', p: null };
}

// Roda `avaliar(exec)` em cada execução mobile. avaliar devolve: undefined (inconclusivo), false (passou) ou { achado, intensidade }.
function porExecucao(ctx, med, regra, avaliar) {
  const lh = lighthouse(med);
  if (!lh) return null;
  const achados = [];
  let intensidade = 0;
  let conclusivo = 0;
  for (const e of lh.mobile) {
    const r = avaliar(e);
    if (r === undefined) continue;
    conclusivo++;
    if (r) { const a = montar(ctx, regra, paginaDoExec(ctx, e), { ...r.achado, instavel: r.achado.instavel ?? true }); if (a) { achados.push(a); intensidade = Math.max(intensidade, r.intensidade ?? 1); } }
  }
  if (!conclusivo) return null;
  return achados.length ? resultado(achados, intensidade) : naoDisparou();
}

// ---- métricas (LCP, CLS, TBT): limiares EXATAMENTE os da regra
function detectorMetrica({ chave, bom, ruim, texto }) {
  return ({ ctx, med, regra }) => {
    const p = regra.deteccao.parametros || {};
    const lim = bom(p), limRuim = ruim(p);
    return porExecucao(ctx, med, regra, (e) => {
      const m = e.metricas?.[chave];
      if (!m || typeof m.valor !== 'number') return undefined;
      if (m.valor <= lim) return false;
      const ruimAcima = m.valor > limRuim;
      const { mensagem, numeros } = texto({ valor: m.valor, lim, limRuim, ruimAcima });
      return {
        intensidade: ruimAcima ? 1 : 0.5,
        achado: { mensagem, numeros, evidencias: [evLH(e, texto({ valor: m.valor, lim, limRuim, ruimAcima }).valorEv, m.valor)] },
      };
    });
  };
}

const detLcp = detectorMetrica({
  chave: 'lcp', bom: (p) => p.limiar_bom_ms, ruim: (p) => p.limiar_ruim_ms,
  texto: ({ valor, lim, limRuim, ruimAcima }) => {
    const medido = fmtS(valor);
    const faixa = ruimAcima ? `acima de ${fmtS(limRuim)}, faixa que o Google considera ruim` : `entre ${fmtS(lim)} e ${fmtS(limRuim)}, faixa "precisa melhorar"`;
    return {
      mensagem: `Em laboratório (Lighthouse, celular emulado, uma execução), o maior elemento da página levou cerca de ${medido} para aparecer, ${faixa}. É medição de laboratório, não de visitantes reais, e varia de uma rodada para outra.`,
      numeros: [medido, fmtS(lim), fmtS(limRuim)], valorEv: `${valor} ms`,
    };
  },
});
const detCls = detectorMetrica({
  chave: 'cls', bom: (p) => p.limiar_bom, ruim: (p) => p.limiar_ruim,
  texto: ({ valor, lim, limRuim, ruimAcima }) => {
    const medido = fmt(valor, 2);
    const faixa = ruimAcima ? `acima de ${fmt(limRuim, 2)}, faixa considerada ruim` : `entre ${fmt(lim, 1)} e ${fmt(limRuim, 2)}, faixa "precisa melhorar"`;
    return {
      mensagem: `Em laboratório (Lighthouse, celular emulado, uma execução), o conteúdo da página pulou durante o carregamento: o deslocamento de layout (CLS) ficou em cerca de ${medido}, ${faixa}. Varia de uma rodada para outra.`,
      numeros: [medido, fmt(lim, 1), fmt(limRuim, 2)], valorEv: String(valor),
    };
  },
});
const detTbt = detectorMetrica({
  chave: 'tbt', bom: (p) => p.limiar_bom_ms, ruim: (p) => p.limiar_ruim_ms,
  texto: ({ valor, lim, limRuim, ruimAcima }) => {
    const medido = `${fmt(valor)} ms`;
    const faixa = ruimAcima ? `acima de ${fmt(limRuim)} ms, faixa considerada ruim` : `entre ${fmt(lim)} e ${fmt(limRuim)} ms, faixa "precisa melhorar"`;
    return {
      mensagem: `Em laboratório (Lighthouse, celular emulado, uma execução), o JavaScript deixou a página "congelada" por cerca de ${medido} durante o carregamento (TBT), ${faixa}. Isso é o TBT de laboratório, não o INP de visitantes reais.`,
      numeros: [medido, fmt(lim), fmt(limRuim)], valorEv: `${valor} ms`,
    };
  },
});

// ============================================================ performance: imagens
function contagensDaPagina(med, pg) {
  const d = medidorOk(med, 'imagens');
  return d ? porUrl(d.paginas, pg.url) : null;
}
const versoesCom = (pg) => ['cru', 'final'].filter((v) => pg[v]);

// (a) Gabarito do caso nº 1: reporta SEMPRE as duas contagens (cru e final) e nunca diz "sem lazy" se houver lazy em alguma versão.
function detLazyContagem({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const achados = [];
  let pior = 0;
  for (const pg of paginasDe(ctx)) {
    const c = contagensDaPagina(med, pg);
    if (!c) continue;
    const vs = ['cru', 'final'].filter((v) => c[v] && pg[v]);
    if (!vs.length || !vs.some((v) => c[v].abaixoDaDobraSemLazy > 0)) continue;
    const algumLazy = vs.some((v) => c[v].lazy > 0);
    const partes = vs.map((v) => {
      const x = c[v];
      return x.lazy > 0 ? `${rotulo[v]}, ${x.lazy} de ${x.total} imagens usam loading="lazy"` : `${rotulo[v]}, nenhuma das ${x.total} imagens usa loading="lazy"`;
    });
    const abaixo = vs.map((v) => `${rotulo[v]}, ${c[v].abaixoDaDobraSemLazy}`).join('; ');
    const mensagem = `Contagem de imagens com carregamento preguiçoso: ${partes.join('; ')}. `
      + `Imagens abaixo da primeira tela que carregam sem o atributo loading="lazy" (${abaixo}). `
      + (algumLazy ? 'O lazy já é usado em parte das imagens; falta aplicá-lo nas que ficam abaixo da primeira tela.' : 'Nenhuma imagem usa lazy em nenhuma das duas versões; as que ficam abaixo da primeira tela podem receber loading="lazy".');
    const citacoes = [];
    for (const v of vs) {
      citacoes.push(citContagem(pg, v, 'imagens'));
      citacoes.push(citContagem(pg, v, 'imagens-lazy'));
    }
    const verLazy = vs.filter((v) => c[v].lazy > 0);
    if (verLazy.length) citacoes.push(citTrecho(pg, 'loading="lazy"', 'html', verLazy));
    const evidencias = [];
    for (const v of vs) {
      evidencias.push({ versao: v, seletor: 'img', valor: 'total', contagem: c[v].total });
      evidencias.push({ versao: v, seletor: 'img[loading="lazy"]', valor: 'com loading=lazy', contagem: c[v].lazy });
      evidencias.push({ versao: v, seletor: 'img:not([loading="lazy"])', valor: 'sem lazy', contagem: c[v].total - c[v].lazy });
      evidencias.push({ versao: v, seletor: 'img', valor: 'abaixo da dobra sem lazy', contagem: c[v].abaixoDaDobraSemLazy });
    }
    for (const i of (pg.final?.imagens || []).filter((x) => x.visivel && !x.clone && x.topo >= DOBRA_PX && x.loading !== 'lazy').slice(0, MAX_EXEMPLOS)) evidencias.push({ versao: 'final', ...exemplo(i), valor: `abaixo da dobra sem lazy, topo ${i.topo}px` });
    const num = vs.flatMap((v) => [c[v].abaixoDaDobraSemLazy]);
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: num });
    if (a) {
      achados.push(a);
      const base = c.final || c.cru;
      pior = Math.max(pior, fracao(Math.max(...vs.map((v) => c[v].abaixoDaDobraSemLazy)), base.visiveisNaoClone));
    }
  }
  return achados.length ? resultado(achados, pior || 1) : naoDisparou();
}

function detLcpComLazy({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const achados = [];
  let pior = 0;
  for (const pg of paginasDe(ctx)) {
    const c = contagensDaPagina(med, pg);
    if (!c) continue;
    const vs = ['cru', 'final'].filter((v) => c[v] && pg[v]);
    if (!vs.some((v) => c[v].acimaDaDobraComLazy > 0)) continue;
    const partes = vs.map((v) => `${rotulo[v]}: ${c[v].acimaDaDobraComLazy} de ${c[v].lazy} com lazy`);
    const mensagem = `Há imagens na primeira tela marcadas com loading="lazy" (${partes.join('; ')}). A imagem principal não deve usar lazy: o navegador espera confirmar que ela está na tela e atrasa justamente o que mais importa. `
      + 'Não identificamos qual é o elemento LCP; a checagem vale para qualquer imagem visível acima da dobra.';
    const citacoes = [];
    for (const v of vs) { citacoes.push(citContagem(pg, v, 'imagens')); citacoes.push(citContagem(pg, v, 'imagens-lazy')); }
    citacoes.push(citTrecho(pg, 'loading="lazy"', 'html', vs.filter((v) => c[v].lazy > 0)));
    const evidencias = [];
    for (const v of vs) evidencias.push({ versao: v, seletor: 'img[loading="lazy"]', valor: 'acima da dobra com lazy', contagem: c[v].acimaDaDobraComLazy });
    for (const i of (pg.final?.imagens || []).filter((x) => x.visivel && !x.clone && x.topo < DOBRA_PX && x.loading === 'lazy').slice(0, MAX_EXEMPLOS)) evidencias.push({ versao: 'final', ...exemplo(i), valor: `acima da dobra com lazy, topo ${i.topo}px` });
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: vs.map((v) => c[v].acimaDaDobraComLazy) });
    if (a) { achados.push(a); pior = Math.max(pior, fracao(Math.max(...vs.map((v) => c[v].acimaDaDobraComLazy)), (c.final || c.cru).visiveisNaoClone)); }
  }
  return achados.length ? resultado(achados, pior || 1) : naoDisparou();
}

// Candidata a LCP: a maior imagem visível (não clone) cujo topo está acima da dobra. O medidor não registra o elemento LCP real:
// por isso a mensagem diz "maior imagem da primeira tela" e nunca afirma que é o LCP. Precisa cobrir ao menos 10% da primeira tela
// (critério nosso, para não tratar ícones pequenos como imagem principal).
export const AREA_MINIMA_LCP = 0.1;
function candidataLcp(extr) {
  const lista = (extr?.imagens || []).filter((i) => i.visivel && !i.clone && i.topo < DOBRA_PX && i.renderW > 0 && i.renderH > 0);
  let melhor = null;
  for (const i of lista) if (!melhor || i.renderW * i.renderH > melhor.renderW * melhor.renderH) melhor = i;
  return melhor && melhor.renderW * melhor.renderH >= AREA_MINIMA_LCP * VIEWPORT_AREA ? melhor : null;
}

function detLcpSemPrioridade({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const maxHigh = regra.deteccao.parametros?.max_recomendado_fetchpriority_high ?? 2;
  const achados = [];
  let avaliou = false;
  let intens = 0;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    const altas = (pg.final.imagens || []).filter((i) => String(i.fetchpriority || '').toLowerCase() === 'high');
    const cand = candidataLcp(pg.final);
    if (!cand && altas.length <= maxHigh) continue;
    if (cand) avaliou = true;
    const problemas = [];
    const evidencias = [];
    const citacoes = [];
    let forca = 0;
    if (cand) {
      const semPrioridade = String(cand.fetchpriority || '').toLowerCase() !== 'high';
      const chave = chaveSrc(cand.src);
      const noCru = !!pg.cru && (pg.cru.imagens || []).some((i) => {
        const k = chaveSrc(i.src);
        return k && (k === chave || k.endsWith(chave) || chave.endsWith(k)) && !i.src.startsWith('about:');
      });
      const desc = 'a maior imagem da primeira tela (provável candidata ao LCP)';
      if (pg.cru && !noCru) {
        problemas.push(`${desc} não tem o endereço no HTML cru: só aparece depois do JavaScript, e o navegador a descobre tarde`);
        forca = Math.max(forca, 1);
      }
      if (semPrioridade) {
        problemas.push(`${desc} não usa fetchpriority="high"`);
        forca = Math.max(forca, 0.5);
      }
      evidencias.push({ versao: 'final', ...exemplo(cand), valor: `maior imagem da primeira tela ${cand.renderW}x${cand.renderH}px; fetchpriority=${cand.fetchpriority ?? 'ausente'}; no HTML cru: ${pg.cru ? (noCru ? 'sim' : 'não') : 'não medido'}` });
      const nome = nomeDoArquivo(cand.src);
      if (nome && (pg.cru ? noCru : true)) citacoes.push(citTrecho(pg, nome, 'html', [noCru ? 'cru' : 'final']));
    }
    if (altas.length > maxHigh) {
      problemas.push(`${altas.length} imagens usam fetchpriority="high" (o recomendado é no máximo ${maxHigh}); quando tudo é prioridade, nada é`);
      evidencias.push({ versao: 'final', seletor: 'img[fetchpriority="high"]', valor: 'imagens com fetchpriority=high', contagem: altas.length });
      forca = Math.max(forca, 0.5);
    }
    if (!problemas.length) continue;
    const mensagem = `${cap(problemas.join('. '))}. Ausência de fetchpriority é uma recomendação, não um erro por si só.`;
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: [altas.length, maxHigh] });
    if (a) { achados.push(a); intens = Math.max(intens, forca); }
  }
  if (!avaliou && !achados.length) return null; // nenhuma página tem imagem grande na primeira tela: LCP provavelmente é texto, a regra não se aplica
  return achados.length ? resultado(achados, intens || 0.5) : naoDisparou();
}

function detImagemSemDimensoes({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const achados = [];
  let pior = 0;
  let avaliou = false;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    avaliou = true;
    const vis = (pg.final.imagens || []).filter((i) => i.visivel && !i.clone);
    const sem = vis.filter((i) => !String(i.larguraAttr ?? '').trim() || !String(i.alturaAttr ?? '').trim());
    if (!sem.length) continue;
    const mensagem = `${sem.length} de ${vis.length} imagens visíveis ${plural(sem.length, 'não tem', 'não têm')} width e height no HTML, então o navegador não reserva o espaço delas e o conteúdo pode pular quando chegam (piora o CLS). `
      + 'O script não confere se há aspect-ratio ou tamanho fixo no CSS; se houver, o espaço já está reservado.';
    const nomes = unicos(sem.map((i) => nomeDoArquivo(i.src)).filter(Boolean)).slice(0, 3);
    const citacoes = [citContagem(pg, 'final', 'imagens-visiveis'), ...nomes.map((n) => citTrecho(pg, n, 'html', ['final']))];
    const evidencias = [{ versao: 'final', seletor: 'img', valor: 'visíveis sem width e height', contagem: sem.length }, ...sem.slice(0, MAX_EXEMPLOS).map((i) => ({ versao: 'final', ...exemplo(i), valor: `width=${i.larguraAttr ?? 'ausente'} height=${i.alturaAttr ?? 'ausente'}` }))];
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: [sem.length, vis.length] });
    if (a) { achados.push(a); pior = Math.max(pior, fracao(sem.length, vis.length)); }
  }
  if (!avaliou) return null;
  return achados.length ? resultado(achados, pior) : naoDisparou();
}

// bytes de uma imagem a partir das requisições registradas na leitura da página (Content-Length; pode ser null)
function bytesDaImagem(pg, src) {
  const reqs = pg.p?.requisicoes || [];
  const r = reqs.find((x) => x.tipo === 'image' && x.url === src && Number.isFinite(x.bytes));
  return r ? r.bytes : null;
}

function detImagemMaiorQueExibido({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const minimo = (regra.deteccao.parametros?.excesso_minimo_kib ?? 4) * 1024;
  const achados = [];
  let pior = 0;
  let avaliou = false;
  let inconclusivo = false;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    avaliou = true;
    const vis = (pg.final.imagens || []).filter((i) => i.visivel && !i.clone && i.renderW > 0 && i.renderH > 0 && i.naturalW > 0 && i.naturalH > 0 && !String(i.src).startsWith('data:'));
    const grandes = [];
    for (const i of vis) {
      const razao = (i.naturalW * i.naturalH) / ((i.renderW * DPR_REFERENCIA) * (i.renderH * DPR_REFERENCIA));
      if (razao <= 1) continue;
      const bytes = bytesDaImagem(pg, i.src);
      if (bytes === null) { inconclusivo = true; continue; }
      const excesso = bytes * (1 - 1 / razao);
      if (excesso >= minimo) grandes.push({ i, bytes, excesso });
    }
    if (!grandes.length) continue;
    grandes.sort((a, b) => b.excesso - a.excesso || cmp(a.i.src, b.i.src));
    const total = grandes.reduce((s, g) => s + g.excesso, 0);
    const maior = grandes[0];
    const mensagem = `${grandes.length} ${plural(grandes.length, 'imagem é bem maior do que o espaço em que aparece', 'imagens são bem maiores do que o espaço em que aparecem')} (considerando telas de densidade dobrada): estimamos cerca de ${fmt(kib(total))} KiB de peso a mais. `
      + `A maior diferença é "${nomeDoArquivo(maior.i.src) || maior.i.src}", com ${maior.i.naturalW}x${maior.i.naturalH} pixels exibida em ${maior.i.renderW}x${maior.i.renderH}. Gere versões menores e use srcset e sizes.`;
    const nomes = unicos(grandes.map((g) => nomeDoArquivo(g.i.src)).filter(Boolean)).slice(0, 3);
    const citacoes = nomes.map((n) => citTrecho(pg, n, 'html', ['final']));
    const evidencias = grandes.slice(0, MAX_EXEMPLOS).map((g) => ({ versao: 'final', ...exemplo(g.i), valor: `natural ${g.i.naturalW}x${g.i.naturalH}; exibida ${g.i.renderW}x${g.i.renderH}; excesso ~${fmt(kib(g.excesso))} KiB`, contagem: Math.round(kib(g.excesso)) }));
    evidencias.push({ versao: 'final', seletor: 'img', valor: 'imagens com excesso', contagem: grandes.length });
    const a = montar(ctx, regra, pg, {
      mensagem, evidencias, citacoes,
      numeros: [grandes.length, fmt(kib(total)), maior.i.naturalW, maior.i.naturalH, maior.i.renderW, maior.i.renderH],
    });
    if (a) { achados.push(a); pior = Math.max(pior, fracao(grandes.length, vis.length)); }
  }
  if (!avaliou) return null;
  if (!achados.length && inconclusivo) return null; // há imagens maiores que o espaço, mas sem o peso do arquivo não dá para aplicar o corte de 4 KiB
  return achados.length ? resultado(achados, pior) : naoDisparou();
}

// imagens (por nome de arquivo) que já têm alternativa WebP/AVIF em <picture> ou srcset (lido no HTML do DOM final)
export function comAlternativaModerna(html) {
  const set = new Set();
  for (const m of String(html || '').matchAll(/<picture\b[\s\S]*?<\/picture>/gi)) {
    const bloco = m[0];
    if (/type=["']image\/(webp|avif)["']|\.(webp|avif)(\?|\s|["',])/i.test(bloco)) for (const im of bloco.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) set.add(nomeDoArquivo(im[1]));
  }
  for (const im of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    if (/srcset=["'][^"']*\.(webp|avif)/i.test(im[0])) { const s = /\bsrc=["']([^"']+)["']/i.exec(im[0]); if (s) set.add(nomeDoArquivo(s[1])); }
  }
  set.delete('');
  return set;
}

function detImagemFormato({ ctx, med, regra }) {
  if (!medidorOk(med, 'imagens')) return null;
  const minimo = (regra.deteccao.parametros?.ignorar_abaixo_kib ?? 20) * 1024;
  const achados = [];
  let pior = 0;
  let avaliou = false;
  let semPeso = false;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    avaliou = true;
    const modernas = comAlternativaModerna(pg.htmlFinal);
    const vistos = new Set();
    const lista = [];
    for (const i of pg.final.imagens || []) {
      const src = String(i.src);
      if (src.startsWith('data:') || !/\.(jpe?g|png)$/i.test(src.split(/[?#]/)[0])) continue;
      if (vistos.has(src) || modernas.has(nomeDoArquivo(src))) continue;
      vistos.add(src);
      const bytes = bytesDaImagem(pg, src);
      if (bytes === null) { semPeso = true; continue; }
      if (bytes >= minimo) lista.push({ i, bytes });
    }
    if (!lista.length) continue;
    lista.sort((a, b) => b.bytes - a.bytes || cmp(a.i.src, b.i.src));
    const maior = lista[0];
    const mensagem = `${lista.length} ${plural(lista.length, 'imagem pesada está', 'imagens pesadas estão')} em JPEG ou PNG, sem versão WebP ou AVIF em <picture> ou srcset (a maior: "${nomeDoArquivo(maior.i.src)}", cerca de ${fmt(kib(maior.bytes))} KiB). `
      + 'WebP e AVIF costumam comprimir melhor; o corte de 20 KiB é critério nosso, não do Google.';
    const citacoes = unicos(lista.map((l) => nomeDoArquivo(l.i.src))).slice(0, 3).map((n) => citTrecho(pg, n, 'html', ['final']));
    const evidencias = lista.slice(0, MAX_EXEMPLOS).map((l) => ({ versao: 'final', ...exemplo(l.i), valor: `${fmt(kib(l.bytes))} KiB`, contagem: Math.round(kib(l.bytes)) }));
    evidencias.push({ versao: 'final', seletor: 'img', valor: 'imagens JPEG/PNG pesadas', contagem: lista.length });
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: [lista.length, fmt(kib(maior.bytes)), minimo / 1024] });
    if (a) { achados.push(a); pior = Math.max(pior, fracao(lista.length, (pg.final.imagens || []).length)); }
  }
  if (!avaliou) return null;
  if (!achados.length && semPeso) return null;
  return achados.length ? resultado(achados, pior) : naoDisparou();
}

// GIF animado: o número de quadros só é conhecido pelo Lighthouse (o medidor de imagens não lê os arquivos). Sem Lighthouse, não avaliável.
function detGifAnimado({ ctx, med, regra }) {
  return porExecucao(ctx, med, regra, (e) => {
    // Só "efficient-animated-content" prova que o GIF é animado. No Lighthouse 13 essa auditoria não existe mais e o
    // image-delivery-insight reprova por vários motivos (não só GIF): sem a auditoria, o dado não foi medido (inconclusivo).
    const a = acharAuditoria(e, ['efficient-animated-content']);
    if (!a) return undefined;
    if (!a.reprovada) return false;
    const pg = paginaDoExec(ctx, e);
    const gifs = (pg.final?.imagens || []).filter((i) => /\.gif(\?|#|$)/i.test(String(i.src))).slice(0, MAX_EXEMPLOS);
    const eco = emKib(a);
    const mensagem = `O Lighthouse apontou conteúdo animado pesado que seria bem mais leve como vídeo (auditoria "${a.id}")${eco ? `, com economia estimada de ${fmt(eco)} KiB` : ''}. `
      + 'Um vídeo curto (MP4 ou WebM) com autoplay, mudo e em loop parece igual e pesa uma fração do GIF.';
    return {
      intensidade: 1,
      achado: {
        mensagem, numeros: eco ? [fmt(eco)] : [],
        evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, eco ? Math.round(eco) : undefined), ...gifs.map((i) => ({ versao: 'final', ...exemplo(i), valor: 'arquivo .gif na página' }))],
      },
    };
  });
}

// ============================================================ performance: CSS, HTML, DOM
function detFonteSemDisplay({ ctx, med, regra }) {
  const css = medidorOk(med, 'css');
  if (!css) return null;
  const est = css.site?.estatico;
  if (!est || !est.fontFace) return null;
  const ff = est.fontFace;
  const aceitos = new Set(regra.deteccao.parametros?.valores_aceitos || ['swap', 'optional', 'fallback']);
  const itens = (ff.itens || []).filter((f) => !f.fontDisplay || !aceitos.has(f.fontDisplay));
  const semDisplay = Math.max(ff.semFontDisplay || 0, itens.filter((f) => !f.fontDisplay).length);
  const comBlockAuto = (ff.fontDisplay?.block || 0) + (ff.fontDisplay?.auto || 0);
  const totalRuins = Math.max(itens.length, semDisplay + comBlockAuto);
  const google = (est.fontesExternas || []).filter((f) => /fonts\.googleapis\.com/i.test(f.host) && String(f.url).length < 200 && !/[?&]display=(swap|optional|fallback)\b/i.test(f.url));
  if (!totalRuins && !google.length) return naoDisparou();
  const pg = paginaInicial(paginasDe(ctx));
  if (!pg) return null;
  const partes = [];
  if (totalRuins) {
    const fam = unicos(itens.map((f) => f.familia).filter(Boolean)).slice(0, 4);
    partes.push(`${totalRuins} ${plural(totalRuins, 'regra @font-face está', 'regras @font-face estão')} sem font-display (ou com block/auto)${fam.length ? `: ${fam.join(', ')}` : ''}`);
  }
  if (google.length) partes.push(`${google.length} ${plural(google.length, 'endereço do Google Fonts está', 'endereços do Google Fonts estão')} sem o parâmetro display=swap`);
  const mensagem = `${partes.join('; ')}. Sem font-display o navegador pode deixar o texto invisível até a fonte chegar; com swap, optional ou fallback ele mostra um texto provisório.`;
  const citacoes = [totalRuins ? citTrecho(pg, '@font-face', 'css', ['final']) : null, ...google.map((g) => citTrecho(pg, 'fonts.googleapis.com', 'html', ['final']))].slice(0, 2);
  const evidencias = [
    ...itens.slice(0, MAX_EXEMPLOS).map((f) => ({ versao: 'final', seletor: '@font-face', trecho: `font-family: ${f.familia}; font-display: ${f.fontDisplay ?? '(ausente)'}`, valor: f.arquivo })),
    ...google.slice(0, MAX_EXEMPLOS).map((g) => ({ versao: 'final', seletor: 'link[href*="fonts.googleapis.com"]', trecho: String(g.url).slice(0, 200), valor: 'sem display=' })),
  ];
  if (totalRuins) evidencias.push({ versao: 'final', seletor: '@font-face', valor: 'sem font-display, block ou auto', contagem: totalRuins });
  const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: [totalRuins, google.length] });
  return a ? resultado([a], 1) : naoDisparou();
}

// Recursos que bloqueiam a renderização no <head> do HTML cru: <script src> sem async/defer/type=module e <link rel=stylesheet> sem media=print.
export function recursosBloqueantes(htmlCru) {
  const html = String(htmlCru || '');
  const cab = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const cabeca = cab ? cab[1] : (html.split(/<body\b/i)[0] || '');
  const attr = (s, nome) => { const m = new RegExp(`\\b${nome}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'i').exec(s); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };
  const scripts = [];
  for (const m of cabeca.matchAll(/<script\b([^>]*)>/gi)) {
    const a = m[1];
    const src = attr(a, 'src');
    if (src === null || src === '') continue;
    const tipo = (attr(a, 'type') || '').toLowerCase();
    scripts.push({ tag: m[0], src, bloqueia: attr(a, 'async') === null && attr(a, 'defer') === null && tipo !== 'module' });
  }
  const estilos = [];
  for (const m of cabeca.matchAll(/<link\b([^>]*)>/gi)) {
    const a = m[1];
    if (!/\bstylesheet\b/i.test(attr(a, 'rel') || '')) continue;
    const media = (attr(a, 'media') || '').trim().toLowerCase();
    estilos.push({ tag: m[0], href: attr(a, 'href') || '', bloqueia: media !== 'print' });
  }
  return { scripts, estilos };
}

function detBloqueioRenderizacao({ ctx, med, regra }) {
  if (!medidorOk(med, 'html')) return null;
  const achados = [];
  let pior = 0;
  let avaliou = false;
  for (const pg of paginasDe(ctx)) {
    if (!pg.htmlCru) continue;
    avaliou = true;
    const r = recursosBloqueantes(pg.htmlCru);
    const sBloq = r.scripts.filter((s) => s.bloqueia);
    const eBloq = r.estilos.filter((e) => e.bloqueia);
    if (!sBloq.length) continue;
    const mensagem = `${sBloq.length} ${plural(sBloq.length, 'script do <head> bloqueia', 'scripts do <head> bloqueiam')} a renderização (sem async, defer nem type=module): o navegador espera cada um terminar antes de mostrar a página. `
      + `Há também ${eBloq.length} ${plural(eBloq.length, 'folha de estilo que bloqueia', 'folhas de estilo que bloqueiam')} a pintura; o CSS principal costuma precisar bloquear, então ${plural(eBloq.length, 'ela é só informativa', 'elas são só informativas')}.`;
    const citacoes = sBloq.slice(0, 2).map((s) => citTrecho(pg, s.tag, 'html', ['cru']));
    const evidencias = [
      ...sBloq.slice(0, MAX_EXEMPLOS).map((s) => ({ versao: 'cru', seletor: 'head > script[src]', trecho: s.tag.slice(0, 200), valor: s.src })),
      { versao: 'cru', seletor: 'head > script[src]:not([async]):not([defer]):not([type=module])', valor: 'scripts bloqueantes', contagem: sBloq.length },
      { versao: 'cru', seletor: 'head > link[rel~=stylesheet]:not([media="print"])', valor: 'estilos bloqueantes', contagem: eBloq.length },
    ];
    const a = montar(ctx, regra, pg, { mensagem, evidencias, citacoes, numeros: [sBloq.length, eBloq.length] });
    if (a) { achados.push(a); pior = Math.max(pior, fracao(sBloq.length, r.scripts.length)); }
  }
  if (!avaliou) return null;
  return achados.length ? resultado(achados, pior) : naoDisparou();
}

// Peso total da página: auditoria total-byte-weight (limiar da regra: 5.000 KiB).
function detPesoTotal({ ctx, med, regra }) {
  const limite = regra.deteccao.parametros?.limiar_kib ?? 5000;
  const ids = regra.deteccao.parametros?.audit_ids || ['total-byte-weight'];
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, ids);
    if (!a) return semAuditoria(e); // sem a auditoria entre as reprovadas (nota >= 0,9) = bem abaixo do limite
    const valor = emKib(a);
    if (valor === null) return undefined;
    if (valor <= limite) return false;
    const mensagem = `Em laboratório (Lighthouse), a página baixa cerca de ${fmt(valor)} KiB no total, acima de ${fmt(limite)} KiB (cerca de 5 MB). Em celular com internet lenta isso é tempo e franquia de dados gastos. Varia de uma rodada para outra.`;
    return { intensidade: 1, achado: { mensagem, numeros: [fmt(valor), fmt(limite)], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? `${fmt(valor)} KiB`}`, Math.round(valor))] } };
  });
}

// DOM grande: conta os elementos do DOM final (medidor html; o extrator tem o mesmo número). Limiares históricos da regra.
function detDomGrande({ ctx, med, regra }) {
  const html = medidorOk(med, 'html');
  const p = regra.deteccao.parametros || {};
  const aviso = p.aviso_elementos ?? 800, erro = p.erro_elementos ?? 1400;
  const achados = [];
  let intens = 0;
  let avaliou = false;
  for (const pg of paginasDe(ctx)) {
    const doHtml = html ? porUrl(html.paginas, pg.url)?.final?.totalElementos : undefined;
    const total = typeof doHtml === 'number' ? doHtml : pg.final?.totalElementos;
    if (typeof total !== 'number') continue;
    if (!html && !pg.final) continue;
    avaliou = true;
    if (total <= aviso) continue;
    const acimaErro = total > erro;
    const mensagem = `O DOM final tem ${fmt(total)} elementos HTML, ${acimaErro ? `acima de ${fmt(erro)}, faixa em que o Lighthouse trata como erro` : `acima de ${fmt(aviso)}, faixa em que o Lighthouse começa a avisar`}. Muitos elementos deixam o navegador mais lento para montar, estilizar e rolar a página. Os limites vêm da documentação antiga do Lighthouse e podem ter mudado.`;
    const a = montar(ctx, regra, pg, { mensagem, evidencias: [{ versao: 'final', seletor: '*', valor: 'elementos no DOM final', contagem: total }], numeros: [fmt(total), fmt(aviso), fmt(erro)] });
    if (a) { achados.push(a); intens = Math.max(intens, acimaErro ? 1 : 0.5); }
  }
  if (!avaliou) return null;
  return achados.length ? resultado(achados, intens) : naoDisparou();
}

// ---- entrega do HTML (só entrada URL): compressão, cache, servidor, redirecionamentos, terceiros, JS não usado
// Dados vêm do Lighthouse. O insight "document-latency-insight" (Lighthouse 13) junta redirecionamentos, tempo do servidor e compressão;
// quando ele reprova só com economia em KiB, o motivo é compressão. Com economia em ms não dá para separar os três: inconclusivo.
const IDS_LATENCIA = ['document-latency-insight'];

function detSemCompressao({ ctx, med, regra }) {
  if (!entradaEhUrl(ctx)) return null;
  const ids = (regra.deteccao.parametros?.audit_ids || []).filter((i) => i !== 'document-latency-insight');
  return porExecucao(ctx, med, regra, (e) => {
    const direta = acharAuditoria(e, ids.length ? ids : ['uses-text-compression']);
    const doc = acharAuditoria(e, IDS_LATENCIA);
    let a = direta;
    if (!a && doc) {
      if (doc.reprovada && !(emKib(doc) !== null && emMs(doc) === null)) return undefined; // economia em ms: pode ser servidor ou redirecionamento
      a = doc;
    }
    if (!a) return semAuditoria(e);
    if (!a.reprovada) return false;
    const eco = emKib(a);
    const mensagem = `O Lighthouse indica que textos como HTML, CSS ou JavaScript são enviados sem compressão (brotli ou gzip)${eco ? `, com economia estimada de ${fmt(eco)} KiB` : ''}. Arquivos de texto comprimidos chegam bem menores; ative a compressão no servidor ou na hospedagem.`;
    return { intensidade: 1, achado: { mensagem, numeros: eco ? [fmt(eco)] : [], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, eco ? Math.round(eco) : undefined)] } };
  });
}

function detCacheEstaticos({ ctx, med, regra }) {
  if (!entradaEhUrl(ctx)) return null;
  const ids = unicos([...(regra.deteccao.parametros?.audit_ids || []), 'cache-insight']);
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, ids);
    if (!a) return semAuditoria(e);
    if (!a.reprovada) return false;
    const eco = emKib(a);
    const mensagem = `O Lighthouse encontrou arquivos estáticos (imagens, fontes, scripts ou estilos) sem política de cache eficiente${eco ? `, com economia estimada de ${fmt(eco)} KiB para quem volta ao site` : ''}. Configure cache longo (cache-control com max-age alto) para arquivos com versão no nome, sem aplicá-lo ao HTML.`;
    return { intensidade: 1, achado: { mensagem, numeros: eco ? [fmt(eco)] : [], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, eco ? Math.round(eco) : undefined)] } };
  });
}

function detServidorLento({ ctx, med, regra }) {
  if (!entradaEhUrl(ctx)) return null;
  const limite = regra.deteccao.parametros?.limiar_ms ?? 600;
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, ['server-response-time']);
    if (!a) {
      const doc = acharAuditoria(e, IDS_LATENCIA);
      if (doc && doc.reprovada) return undefined; // o insight junta servidor, redirecionamentos e compressão: não dá para separar
      return doc ? false : semAuditoria(e);
    }
    if (!a.reprovada) return false;
    const ms = emMs(a);
    if (ms !== null && ms <= limite) return false;
    const mensagem = `O servidor demorou${ms !== null ? ` cerca de ${fmt(ms)} ms` : ' demais'} para responder o HTML da página (limite do Lighthouse: ${fmt(limite)} ms; mede só a resposta do servidor, sem redirecionamentos). Isso atrasa tudo o que vem depois. A latência depende de onde a análise roda.`;
    return { intensidade: 1, achado: { mensagem, numeros: [...(ms !== null ? [fmt(ms)] : []), fmt(limite)], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, ms !== null ? Math.round(ms) : undefined)] } };
  });
}

function detRedirecionamentos({ ctx, med, regra }) {
  if (!entradaEhUrl(ctx)) return null;
  const minimo = regra.deteccao.parametros?.falha_se_saltos_maior_ou_igual ?? 2;
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, ['redirects']);
    if (!a) {
      const doc = acharAuditoria(e, IDS_LATENCIA);
      if (doc && doc.reprovada) return undefined;
      return doc ? false : semAuditoria(e);
    }
    if (!a.reprovada) return false;
    const saltos = Array.isArray(a.itens) ? a.itens.length : null;
    if (saltos !== null && saltos < minimo) return false;
    const mensagem = `A página passa por ${saltos !== null ? `${saltos} redirecionamentos` : 'dois ou mais redirecionamentos'} antes de abrir (o Lighthouse reprova a partir de ${minimo}). Cada salto soma uma espera: faça o endereço antigo ir direto ao final, em um único redirecionamento.`;
    return { intensidade: 1, achado: { mensagem, numeros: [...(saltos !== null ? [saltos] : []), minimo], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, saltos ?? undefined)] } };
  });
}

// Terceiros: a auditoria é informativa no Lighthouse 13 (nunca aparece entre as reprovadas). Só avalia quando o medidor expõe o valor.
function detTerceiros({ ctx, med, regra }) {
  const limite = regra.deteccao.parametros?.limiar_bloqueio_ms ?? 250;
  const js = medidorOk(med, 'js');
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, regra.deteccao.parametros?.audit_ids || ['third-parties-insight', 'third-party-summary']);
    if (!a) return undefined;
    const ms = emMs(a);
    if (ms === null) return undefined;
    if (ms <= limite) return false;
    const hosts = (js?.dominiosTerceiros || []).map((d) => d.host).slice(0, 4);
    const mensagem = `Scripts de terceiros bloquearam a página por cerca de ${fmt(ms)} ms, acima de ${fmt(limite)} ms (Lighthouse)${hosts.length ? `; domínios de terceiros vistos: ${hosts.join(', ')}` : ''}. Remova os que você não precisa e carregue os demais com atraso.`;
    return { intensidade: 1, achado: { mensagem, numeros: [fmt(ms), fmt(limite)], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? ''}`.trim(), Math.round(ms)), ...hosts.map((h) => ({ versao: 'final', trecho: h, valor: 'domínio de terceiro' }))] } };
  });
}

function detJsNaoUsado({ ctx, med, regra }) {
  const limite = (regra.deteccao.parametros?.limiar_kib_por_arquivo ?? 20);
  return porExecucao(ctx, med, regra, (e) => {
    const a = acharAuditoria(e, regra.deteccao.parametros?.audit_ids || ['unused-javascript']);
    if (!a) return semAuditoria(e);
    if (!a.reprovada) return false;
    const eco = emKib(a);
    if (eco !== null && eco < limite) return false;
    const mensagem = `O Lighthouse estima${eco !== null ? ` até ${fmt(eco)} KiB` : ' uma quantidade grande'} de JavaScript baixado e não usado na abertura da página (soma dos arquivos; o corte é de ${fmt(limite)} KiB por arquivo). Código "não usado na abertura" pode ser usado depois, em cliques e outras páginas.`;
    return { intensidade: 1, achado: { mensagem, numeros: [...(eco !== null ? [fmt(eco)] : []), fmt(limite)], evidencias: [evLH(e, `${a.id}: ${a.valorDeExibicao ?? 'reprovada'}`, eco !== null ? Math.round(eco) : undefined)] } };
  });
}

// ============================================================ SEO: título, descrição
const TITULOS_VAGOS = ['home', 'profile', 'perfil', 'início', 'inicio', 'página inicial', 'pagina inicial', 'sem título', 'sem titulo', 'untitled', 'document'];

function tituloNoHtml(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return m ? { tag: true, texto: m[1].replace(/\s+/g, ' ').trim() } : { tag: false, texto: '' };
}

function detTituloAusente({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const vagos = (regra.deteccao.parametros?.vagos_exemplos || TITULOS_VAGOS).map((v) => normalizarTexto(v));
  const achados = [];
  for (const pg of paginasDe(ctx)) {
    const s = porUrl(seo.paginas, pg.url);
    if (!s || (!s.cru && !s.final)) continue;
    const cru = s.cru?.titulo, fim = s.final?.titulo;
    const noCru = tituloNoHtml(pg.htmlCru);
    const problemas = [];
    const citacoes = [];
    if (cru && !cru.presente && fim && !fim.presente) {
      problemas.push(noCru.tag ? 'a tag <title> existe mas está vazia, no HTML cru e no DOM final' : 'a página não tem <title>, nem no HTML cru nem no DOM final');
    } else if (cru && !cru.presente && fim?.presente) {
      problemas.push(`o título só aparece depois do JavaScript (no HTML cru ${noCru.tag ? 'a tag <title> está vazia' : 'não há <title>'}); o Google aceita título definido por JavaScript, mas quem lê o HTML cru não o vê`);
    } else if (fim && !fim.presente) {
      problemas.push('o DOM final não tem título (o HTML cru tem, e o JavaScript o apagou)');
    }
    const textoFinal = fim?.presente ? fim.texto : (cru?.presente ? cru.texto : '');
    if (textoFinal && vagos.includes(normalizarTexto(textoFinal))) {
      problemas.push(`o título "${textoFinal}" é vago: não diz do que a página trata (ele vira o link que aparece nos resultados do Google)`);
      citacoes.push(citTrecho(pg, textoFinal, 'html', [fim?.presente ? 'final' : 'cru']));
    }
    if (!problemas.length) continue;
    const evidencias = [
      { versao: 'cru', seletor: 'head > title', trecho: cru?.texto || '', valor: cru?.presente ? 'presente' : 'ausente ou vazio', contagem: cru?.presente ? 1 : 0 },
      { versao: 'final', seletor: 'head > title', trecho: fim?.texto || '', valor: fim?.presente ? 'presente' : 'ausente ou vazio', contagem: fim?.presente ? 1 : 0 },
    ];
    achados.push(montar(ctx, regra, pg, { mensagem: `Título da página: ${problemas.join('; ')}.`, evidencias, citacoes }));
  }
  return achados.filter(Boolean).length ? resultado(achados, 1) : naoDisparou();
}

// Heurística de mercado (60 caracteres): NÃO é regra do Google.
function detTituloTamanho({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const limite = regra.deteccao.parametros?.limite_pratico_caracteres ?? 60;
  const achados = [];
  for (const pg of paginasDe(ctx)) {
    const f = porUrl(seo.paginas, pg.url)?.final;
    if (!f || !f.titulo.presente || f.titulo.comprimento <= limite) continue;
    const mensagem = `O título tem ${f.titulo.comprimento} caracteres, acima dos ${limite} que o mercado costuma usar como referência. Isso é uma heurística: o Google diz que não há limite de tamanho e que o corte depende da largura do aparelho.`;
    achados.push(montar(ctx, regra, pg, {
      mensagem, citacoes: [citTrecho(pg, f.titulo.texto, 'html', ['final'])],
      evidencias: [{ versao: 'final', seletor: 'head > title', trecho: f.titulo.texto, valor: f.titulo.comprimento, contagem: f.titulo.comprimento }],
      numeros: [f.titulo.comprimento, limite],
    }));
  }
  return achados.filter(Boolean).length ? resultado(achados, 1) : naoDisparou();
}

function detTituloRepetido({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  if (paginasDe(ctx).length < 2) return null; // com 1 página não se aplica
  const pgs = paginasDe(ctx);
  const erro = new Set(seo.paginas.filter((p) => (p.status ?? 200) >= 400).map((p) => p.caminho));
  const achados = [];
  let afetadas = 0;
  for (const g of seo.site?.duplicados?.final?.titulos || []) {
    const caminhos = g.paginas.filter((c) => !erro.has(c));
    if (caminhos.length < (regra.deteccao.parametros?.min_paginas_no_grupo ?? 2)) continue;
    const primeira = pgs.find((x) => x.caminho === caminhos[0]);
    if (!primeira) continue;
    afetadas += caminhos.length;
    const mensagem = `${caminhos.length} páginas têm exatamente o mesmo título ("${g.texto}"): ${caminhos.slice(0, 5).join(', ')}${caminhos.length > 5 ? ' e outras' : ''}. Títulos iguais deixam as páginas indistinguíveis nos resultados de busca e nas abas do navegador.`;
    achados.push(montar(ctx, regra, primeira, {
      mensagem, citacoes: [citTrecho(primeira, g.texto, 'html', ['final'])],
      evidencias: caminhos.map((c) => ({ pagina: c, versao: 'final', seletor: 'head > title', trecho: g.texto, valor: 'título repetido', contagem: caminhos.length })),
      numeros: [caminhos.length],
    }));
  }
  return achados.filter(Boolean).length ? resultado(achados, fracao(afetadas, pgs.length)) : naoDisparou();
}

function detDescricao({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const pgs = paginasDe(ctx);
  const sem = [];
  const achados = [];
  for (const pg of pgs) {
    const s = porUrl(seo.paginas, pg.url);
    const f = s?.final, c = s?.cru;
    if (!f) continue;
    const ausenteFinal = !f.descricao.presente;
    const vazia = f.descricao.presente && !String(f.descricao.texto).trim();
    // ausente só no HTML cru, mas presente no final: o Google aceita description por JavaScript; não é problema
    if (ausenteFinal && (!c || !c.descricao.presente)) sem.push({ pg, motivo: 'ausente' });
    else if (vazia) sem.push({ pg, motivo: 'vazia' });
  }
  if (sem.length) {
    const lista = sem.map((x) => x.pg.caminho);
    const mensagem = `${sem.length} de ${pgs.length} ${plural(pgs.length, 'página', 'páginas')} ${plural(sem.length, 'está', 'estão')} sem meta description (ausente ou vazia): ${lista.slice(0, 5).join(', ')}${lista.length > 5 ? ' e outras' : ''}. Quando falta, o Google escreve o resumo sozinho; a description não muda a posição no ranking.`;
    achados.push(montar(ctx, regra, sem[0].pg, {
      mensagem,
      evidencias: sem.slice(0, 10).map((x) => ({ pagina: x.pg.caminho, versao: 'final', seletor: 'meta[name="description"]', valor: x.motivo, contagem: 0 })),
      numeros: [sem.length, pgs.length],
    }));
  }
  for (const g of seo.site?.duplicados?.final?.descricoes || []) {
    const primeira = pgs.find((x) => x.caminho === g.paginas[0]);
    if (!primeira) continue;
    const mensagem = `${g.paginas.length} páginas usam a mesma meta description ("${g.texto}"): ${g.paginas.slice(0, 5).join(', ')}${g.paginas.length > 5 ? ' e outras' : ''}. Cada página merece um resumo próprio.`;
    achados.push(montar(ctx, regra, primeira, {
      mensagem, citacoes: [citTrecho(primeira, g.texto, 'html', ['final'])],
      evidencias: g.paginas.map((c) => ({ pagina: c, versao: 'final', seletor: 'meta[name="description"]', trecho: g.texto, valor: 'repetida', contagem: g.paginas.length })),
      numeros: [g.paginas.length],
    }));
  }
  const afetadas = unicos([...sem.map((x) => x.pg.caminho), ...(seo.site?.duplicados?.final?.descricoes || []).flatMap((g) => g.paginas)]).length;
  return achados.filter(Boolean).length ? resultado(achados, fracao(afetadas, pgs.length)) : naoDisparou();
}

// ============================================================ SEO: dados estruturados
const TIPOS_CONFERIDOS = {
  Product: { obrig: (p) => [...(p.has('name') ? [] : ['name']), ...(['review', 'aggregateRating', 'offers'].some((x) => p.has(x)) ? [] : ['ao menos um entre review, aggregateRating ou offers'])], recom: ['aggregateRating', 'offers', 'review'] },
  Offer: { obrig: (p) => (p.has('price') || p.has('priceSpecification') ? [] : ['price']), recom: ['priceCurrency', 'availability', 'priceValidUntil'] },
  VideoObject: { obrig: (p) => ['name', 'thumbnailUrl', 'uploadDate'].filter((x) => !p.has(x)), recom: ['description', 'contentUrl', 'embedUrl', 'duration'] },
  WebSite: { obrig: (p) => ['name', 'url'].filter((x) => !p.has(x)), recom: ['alternateName'], soNaHome: true },
  Organization: { obrig: () => [], recom: ['name', 'url', 'logo', 'sameAs', 'address', 'telephone', 'contactPoint', 'email', 'description'] },
  Article: { obrig: () => [], recom: ['headline', 'image', 'datePublished', 'dateModified', 'author'] },
  LocalBusiness: { obrig: (p) => ['name', 'address'].filter((x) => !p.has(x)), recom: ['geo', 'openingHoursSpecification', 'telephone', 'url', 'priceRange'] },
  // FAQPage: só listado (o Google encerrou o resultado rico de FAQ em maio de 2026)
};

function formatosDe(v) {
  if (!v) return [];
  return [v.temJsonLd && 'JSON-LD', v.temMicrodata && 'microdata', v.temRdfa && 'RDFa'].filter(Boolean);
}
function tiposDe(v) {
  if (!v) return [];
  return unicos([...(v.jsonld?.tipos || []), ...(v.microdata?.tipos || []), ...(v.rdfa?.tipos || [])]).sort();
}

// (b) Gabarito do caso nº 1: NUNCA afirma "sem dados estruturados" se existir JSON-LD, microdata ou RDFa em qualquer versão; lista os @type.
function detDadosEstruturados({ ctx, med, regra }) {
  const jd = medidorOk(med, 'jsonld');
  if (!jd) return null;
  const pgs = paginasDe(ctx);
  if (!pgs.length) return null;
  const achados = [];
  if (!jd.site.temEmQualquerVersao) {
    const pg = paginaInicial(pgs);
    const citacoes = ['cru', 'final'].map((v) => citContagem(pg, v, 'jsonld-blocos'));
    const mensagem = 'Não encontramos dados estruturados (nem JSON-LD, nem microdata, nem RDFa) em nenhuma das duas versões das páginas lidas (HTML cru e DOM final). '
      + 'Eles ajudam os buscadores a entender produtos, perguntas frequentes e organização; ter o markup, porém, não garante resultado rico na busca.';
    achados.push(montar(ctx, regra, pg, { mensagem, citacoes, evidencias: [{ versao: 'cru', seletor: 'script[type="application/ld+json"]', valor: 'blocos JSON-LD', contagem: 0 }, { versao: 'final', seletor: 'script[type="application/ld+json"]', valor: 'blocos JSON-LD', contagem: 0 }] }));
    return resultado(achados, 1);
  }
  // Por página (versão final; se faltar, a crua): confere obrigatórias e recomendadas dos tipos comuns (parâmetros da regra).
  // Fala o que existe (formatos e @type por versão) e o que falta. Só "sem dados estruturados" quando não há NENHUM formato em NENHUMA versão.
  let conferidos = 0, comObrig = 0, comRecom = 0;
  for (const pg of pgs) {
    const j = porUrl(jd.paginas, pg.url);
    if (!j) continue;
    const v = j.final || j.cru;
    if (!v) continue;
    const tipos = tiposDe(v);
    if (!tipos.length) continue;
    const props = (t) => new Set(v.jsonld?.propriedadesPorTipo?.[t]?.propriedades || []);
    const faltaObrig = [];
    const faltaRecom = [];
    for (const t of tipos) {
      const cfg = TIPOS_CONFERIDOS[t];
      if (!cfg || !v.jsonld?.propriedadesPorTipo?.[t]) continue; // só confere o que veio em JSON-LD (microdata/RDFa não têm propriedades medidas)
      if (cfg.soNaHome && pg.caminho !== '/') continue;
      conferidos++;
      const o = cfg.obrig(props(t));
      const r = cfg.recom.filter((x) => !props(t).has(x));
      if (o.length) { faltaObrig.push({ tipo: t, faltam: o }); comObrig++; }
      if (r.length) { faltaRecom.push({ tipo: t, faltam: r }); comRecom++; }
    }
    if (!faltaObrig.length && !faltaRecom.length) continue; // dados completos para os tipos conferidos: nada a apontar
    const tCru = tiposDe(j.cru), tFim = tiposDe(j.final);
    const verTipos = (j.cru && j.final && tCru.join() === tFim.join())
      ? `tipos (${rotulo.cru} e ${rotulo.final}): ${tFim.join(', ')}`
      : [j.cru ? (tCru.length ? `tipos ${rotulo.cru}: ${tCru.join(', ')}` : `${rotulo.cru} não há dados estruturados`) : null, j.final ? (tFim.length ? `tipos ${rotulo.final}: ${tFim.join(', ')}` : `${rotulo.final} não há dados estruturados`) : null].filter(Boolean).join('; ');
    const formatos = unicos([...formatosDe(j.cru), ...formatosDe(j.final)]);
    const mensagem = `A página tem dados estruturados (${formatos.join(', ')}; ${verTipos}). `
      + (faltaObrig.length ? `Faltam campos obrigatórios: ${faltaObrig.map((x) => `em ${x.tipo}, ${x.faltam.join(', ')}`).join('; ')}. ` : '')
      + (faltaRecom.length ? `Faltam campos recomendados: ${faltaRecom.map((x) => `em ${x.tipo}, ${x.faltam.join(', ')}`).join('; ')}. ` : '')
      + 'Ter o markup não garante resultado rico na busca.';
    const citacoes = [];
    for (const ver of ['cru', 'final']) if (j[ver]?.jsonld?.blocos > 0) citacoes.push(citContagem(pg, ver, 'jsonld-blocos'));
    for (const x of [...faltaObrig, ...faltaRecom]) citacoes.push(citTrecho(pg, x.tipo, 'jsonld', [j.final ? 'final' : 'cru']));
    const ev = j.final ? 'final' : 'cru';
    const evidencias = [
      ...tipos.map((t) => ({ versao: ev, seletor: 'script[type="application/ld+json"]', valor: `@type ${t}`, contagem: v.jsonld?.contagemPorTipo?.[t] ?? 1 })),
      ...faltaObrig.map((x) => ({ versao: ev, seletor: `@type ${x.tipo}`, valor: `faltam (obrigatórios): ${x.faltam.join(', ')}` })),
      ...faltaRecom.map((x) => ({ versao: ev, seletor: `@type ${x.tipo}`, valor: `faltam (recomendados): ${x.faltam.join(', ')}` })),
    ];
    // intensidade: obrigatório faltando pesa cheio; só recomendados faltando pesa pouco
    achados.push({ a: montar(ctx, regra, pg, { mensagem, citacoes, evidencias }), forte: faltaObrig.length > 0 });
  }
  const lista = achados.filter((x) => x && x.a);
  if (!lista.length) return naoDisparou();
  const alguemForte = lista.some((x) => x.forte);
  return resultado(lista.map((x) => x.a), alguemForte ? fracao(comObrig, Math.max(conferidos, 1)) || 1 : 0.3);
}

function detJsonldErro({ ctx, med, regra }) {
  const jd = medidorOk(med, 'jsonld');
  if (!jd) return null;
  const achados = [];
  let ruins = 0, total = 0;
  for (const pg of paginasDe(ctx)) {
    const j = porUrl(jd.paginas, pg.url);
    if (!j) continue;
    const vs = ['cru', 'final'].filter((v) => j[v] && pg[v]);
    const problemas = [];
    const citacoes = [];
    const evidencias = [];
    const nums = [];
    for (const v of vs) {
      const x = j[v].jsonld;
      total += x.blocos;
      if (x.erros.length) {
        ruins += x.erros.length;
        problemas.push(`${rotulo[v]}, ${x.erros.length} de ${x.blocos} blocos JSON-LD ${x.erros.length === 1 ? 'tem' : 'têm'} erro de sintaxe (${x.erros.map((e) => `o ${e.indice + 1}º`).join(', ')}) e não ${x.erros.length === 1 ? 'pode' : 'podem'} ser ${x.erros.length === 1 ? 'lido' : 'lidos'}`);
        nums.push(x.erros.length, x.blocos, ...x.erros.map((e) => e.indice + 1));
        citacoes.push(citContagem(pg, v, 'jsonld-blocos'));
        for (const e of x.erros.slice(0, 3)) {
          citacoes.push(citTrecho(pg, e.trecho, 'jsonld', [v]));
          evidencias.push({ versao: v, seletor: 'script[type="application/ld+json"]', trecho: String(e.trecho).slice(0, 200), valor: e.erro, contagem: e.indice + 1 });
        }
      }
      if (x.raizesSemTipo > 0) {
        ruins += x.raizesSemTipo;
        problemas.push(`${rotulo[v]}, ${x.raizesSemTipo} ${plural(x.raizesSemTipo, 'objeto JSON-LD está', 'objetos JSON-LD estão')} sem @type, então não ${plural(x.raizesSemTipo, 'diz', 'dizem')} que tipo de coisa ${plural(x.raizesSemTipo, 'descreve', 'descrevem')}`);
        nums.push(x.raizesSemTipo);
        citacoes.push(citContagem(pg, v, 'jsonld-blocos'));
        evidencias.push({ versao: v, seletor: 'script[type="application/ld+json"]', valor: 'objetos raiz sem @type', contagem: x.raizesSemTipo });
      }
    }
    if (!problemas.length) continue;
    achados.push(montar(ctx, regra, pg, { mensagem: `Dados estruturados com problema: ${problemas.join('; ')}. Só o que o JSON.parse não consegue ler é afirmado aqui.`, citacoes, evidencias, numeros: nums }));
  }
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(ruins, total)) : naoDisparou();
}

// Percorre o JSON-LD e devolve os nós (objetos) com @type, em qualquer nível (@graph, listas, aninhados)
function nosJsonld(textos) {
  const nos = [];
  const visita = (v) => {
    if (Array.isArray(v)) { v.forEach(visita); return; }
    if (v && typeof v === 'object') {
      if (v['@type']) nos.push(v);
      Object.values(v).forEach(visita);
    }
  };
  for (const t of textos || []) { try { visita(JSON.parse(t)); } catch { /* bloco com erro: tratado em seo-jsonld-com-erro-de-sintaxe */ } }
  return nos;
}
const tipoDoNo = (n) => [].concat(n['@type']).map((t) => String(t).replace(/^.*[/:]/, ''));

// misto: compara preço, nome de produto e nome de vídeo do JSON-LD com o texto VISÍVEL e não-clone do DOM final.
// O que não bate vira PERGUNTA (nunca "preço errado"): texto oculto não conta como visível, mas é mencionado.
function detNaoBatem({ ctx, med, regra }) {
  if (!medidorOk(med, 'jsonld')) return null;
  const achados = [];
  let checados = 0, duvidas = 0;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    const nos = nosJsonld(pg.final.jsonld);
    if (!nos.length) continue;
    const visiveis = (pg.final.nos || []).filter((n) => n.visivel && !n.clone).map((n) => n.texto);
    const ocultos = (pg.final.nos || []).filter((n) => !n.visivel || n.clone).map((n) => n.texto);
    const juntoVis = normalizarTexto(visiveis.join(' '));
    const juntoOcu = normalizarTexto(ocultos.join(' '));
    const numVis = extrairNumeros(visiveis.join(' '));
    const numOcu = extrairNumeros(ocultos.join(' '));
    const duvidas_ = [];
    const citacoes = [];
    const evidencias = [];
    const nums = [];
    const checaNome = (campo, nome) => {
      if (!nome || typeof nome !== 'string') return;
      checados++;
      const alvo = normalizarTexto(nome);
      if (!alvo || juntoVis.includes(alvo) || alvo.length > 3 && visiveis.some((t) => alvo.includes(normalizarTexto(t)) && normalizarTexto(t).length >= 8)) return;
      duvidas++;
      const so = juntoOcu.includes(alvo) ? ' (aparece só em texto oculto)' : '';
      duvidas_.push(`${campo} "${nome}" não aparece no texto visível da página${so}`);
      citacoes.push(citTrecho(pg, nome, 'jsonld', ['final']));
      evidencias.push({ versao: 'final', seletor: 'script[type="application/ld+json"]', trecho: nome.slice(0, 200), valor: `${campo} não encontrado no texto visível` });
    };
    for (const n of nos) {
      const tipos = tipoDoNo(n);
      if (tipos.includes('Product')) checaNome('o nome do produto', n.name);
      if (tipos.includes('VideoObject')) checaNome('o título do vídeo', n.name);
      if (tipos.includes('Offer')) {
        const preco = n.price ?? n.priceSpecification?.price;
        if (preco !== undefined && preco !== null && String(preco).trim() !== '') {
          checados++;
          const [alvo] = extrairNumeros(String(preco));
          if (alvo !== undefined && !numVis.some((x) => numerosIguais(x, alvo))) {
            duvidas++;
            const so = numOcu.some((x) => numerosIguais(x, alvo)) ? ' (o valor aparece só em texto oculto)' : '';
            duvidas_.push(`o preço ${preco} não aparece no texto visível da página${so}`);
            citacoes.push({ tipo: 'numero', valor: String(preco), onde: 'jsonld', versoes: ['final'], pagina: pg.url });
            evidencias.push({ versao: 'final', seletor: 'script[type="application/ld+json"]', valor: `Offer.price ${preco} não encontrado no texto visível` });
            nums.push(String(preco));
          }
        }
      }
    }
    if (!duvidas_.length) continue;
    achados.push(montar(ctx, regra, pg, {
      mensagem: `Os dados estruturados dizem algo que o texto visível da página não mostra: ${duvidas_.join('; ')}. Isso não prova erro (pode haver formato ou moeda diferente, ou texto oculto de propósito); vale conferir se os dois dizem a mesma coisa.`,
      citacoes, evidencias, numeros: nums,
    }));
  }
  const lista = achados.filter(Boolean);
  if (!lista.length && checados === 0) return null; // nada comparável (sem preço, produto ou vídeo nos dados estruturados)
  return lista.length ? resultado(lista, fracao(duvidas, checados)) : naoDisparou();
}

// ============================================================ SEO: canonical, robots, noindex
function detCanonicalAusente({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const pgs = paginasDe(ctx);
  const sem = [];
  for (const pg of pgs) {
    const s = porUrl(seo.paginas, pg.url);
    if (!s || !s.final) continue;
    if (!s.final.canonical.presente && (!s.cru || !s.cru.canonical.presente)) sem.push(pg);
  }
  const avaliadas = pgs.filter((pg) => porUrl(seo.paginas, pg.url)?.final).length;
  if (!avaliadas) return null;
  if (!sem.length) return naoDisparou();
  const mensagem = `${sem.length} de ${avaliadas} ${plural(avaliadas, 'página', 'páginas')} ${plural(sem.length, 'não tem', 'não têm')} link canonical para si mesma (nem no HTML cru nem no DOM final): ${sem.slice(0, 5).map((p) => p.caminho).join(', ')}${sem.length > 5 ? ' e outras' : ''}. Não é um erro grave: o Google usa outros sinais para escolher a versão principal.`;
  const a = montar(ctx, regra, sem[0], { mensagem, evidencias: sem.slice(0, 10).map((p) => ({ pagina: p.caminho, versao: 'final', seletor: 'link[rel~="canonical"]', valor: 'ausente', contagem: 0 })), numeros: [sem.length, avaliadas] });
  return a ? resultado([a], fracao(sem.length, avaliadas)) : naoDisparou();
}

function detCanonicalConflitante({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const pgs = paginasDe(ctx);
  const statusPorUrl = new Map();
  for (const s of seo.paginas) { const k = normalizarUrl(s.url); if (k) statusPorUrl.set(k, s.status); }
  const achados = [];
  let avaliadas = 0;
  for (const pg of pgs) {
    const s = porUrl(seo.paginas, pg.url);
    if (!s) continue;
    const problemas = [];
    const citacoes = [];
    const evidencias = [];
    for (const v of ['cru', 'final']) {
      const c = s[v]?.canonical;
      if (!c || !c.presente) continue;
      avaliadas++;
      const href = String(c.href ?? '');
      if (c.quantidade > 1) { problemas.push({ v, texto: `há ${c.quantidade} links canonical na mesma página` }); evidencias.push({ versao: v, seletor: 'link[rel~="canonical"]', valor: 'canonicais', contagem: c.quantidade }); }
      if (href && !/^https?:\/\//i.test(href)) { problemas.push({ v, texto: `o canonical usa endereço relativo ("${href}"); prefira o endereço completo` }); citacoes.push(citTrecho(pg, `href="${href}"`, 'html', [v])); }
      if (href.includes('#')) { problemas.push({ v, texto: `o canonical contém um fragmento (#) ("${href}")` }); citacoes.push(citTrecho(pg, href, 'html', [v])); }
      const alvoUrl = c.absoluto ? normalizarUrl(c.absoluto) : null;
      const st = alvoUrl ? statusPorUrl.get(alvoUrl) : undefined;
      if (st !== undefined && st !== null && st !== 200) problemas.push({ v, texto: `o canonical aponta para uma página lida que respondeu com status ${st}` });
      if (c.apontaPara === 'outra' && c.absoluto) { try { if (new URL(c.absoluto).origin !== new URL(pg.url).origin) evidencias.push({ versao: v, seletor: 'link[rel~="canonical"]', trecho: href, valor: 'canonical para outro domínio (só informativo)' }); } catch { /* ignora */ } }
      if (href) evidencias.push({ versao: v, seletor: 'link[rel~="canonical"]', trecho: href, valor: c.apontaPara ?? 'sem destino' });
    }
    if (!problemas.length) continue;
    achados.push(montar(ctx, regra, pg, { mensagem: `Link canonical com problema: ${juntarPorVersao(problemas).map((p) => `${versoesTexto(p.v)}, ${p.texto}`).join('; ')}.`, citacoes, evidencias, numeros: problemas.flatMap((p) => extrairNumeros(p.texto)) }));
  }
  if (!avaliadas) return naoDisparou(); // nenhuma página tem canonical para conferir (ausência é de outra regra)
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(lista.length, pgs.length)) : naoDisparou();
}

function detNoindex({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const achados = [];
  for (const pg of paginasDe(ctx)) {
    const s = porUrl(seo.paginas, pg.url);
    if (!s) continue;
    const noCru = !!s.cru?.robotsMeta?.noindex, noFinal = !!s.final?.robotsMeta?.noindex, noCab = !!s.noindexNoCabecalho;
    if (!noCru && !noFinal && !noCab) continue;
    const fontes = [];
    const citacoes = [];
    const evidencias = [];
    const metasPorVersao = [];
    if (noCab) { fontes.push(`o cabeçalho X-Robots-Tag da resposta (${s.xRobotsTag})`); evidencias.push({ versao: 'cru', seletor: 'cabeçalho X-Robots-Tag', trecho: String(s.xRobotsTag), valor: 'noindex' }); }
    for (const v of ['cru', 'final']) {
      const x = s[v]?.robotsMeta;
      if (!x?.noindex) continue;
      const metas = x.metas.filter((m) => /noindex|none/i.test(m.conteudo));
      metasPorVersao.push({ v, texto: metas.map((m) => `${m.nome}: ${m.conteudo}`).join('; ') });
      for (const m of metas) { citacoes.push(citTrecho(pg, m.conteudo, 'html', [v])); evidencias.push({ versao: v, seletor: `meta[name="${m.nome}"]`, trecho: m.conteudo, valor: 'noindex' }); }
    }
    for (const g of juntarPorVersao(metasPorVersao)) fontes.push(`a tag <meta name="robots"> (${g.texto}) ${versoesTexto(g.v)}`);
    const soJs = noFinal && !noCru && !noCab;
    const mensagem = `A página pede para ficar fora do Google (noindex), segundo ${unicos(fontes).join(' e ')}. `
      + (soJs ? 'O noindex só aparece depois do JavaScript: o Google pode nem rodar o JavaScript dessas páginas. ' : '')
      + 'O script não sabe se isso é de propósito: páginas de agradecimento, áreas privadas e rascunhos costumam usar noindex. Confirme se é intencional.';
    achados.push(montar(ctx, regra, pg, { mensagem, citacoes, evidencias }));
  }
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, 1) : naoDisparou();
}

// Bloqueio do site inteiro no robots.txt. O medidor "robots" do plano não existe; usamos "robots-ia", que avalia o grupo de cada
// rastreador. Rastreadores sem grupo próprio caem no grupo "*": é por eles que lemos o "User-agent: *".
function detRobotsBloqueiaTudo({ ctx, med, regra }) {
  const r = medidorOk(med, 'robots-ia');
  if (!r || !r.robots) return null;
  const rb = r.robots;
  if (!rb.presente) {
    if ((rb.status ?? 0) >= 500) return null; // não deu para ler o robots.txt
    return naoDisparou(); // sem robots.txt: nada é proibido
  }
  const agentes = rb.agentesDeclarados || [];
  const viaCuringa = (r.rastreadores || []).filter((x) => x.origemDoGrupo === 'curinga');
  const googlebot = agentes.some((a) => /googlebot/.test(a));
  let curingaBloqueado = null;
  if (viaCuringa.length) curingaBloqueado = viaCuringa.some((x) => x.situacao === 'bloqueado' && !x.parcial);
  else if (!agentes.includes('*')) curingaBloqueado = false;
  if (curingaBloqueado === null) return null; // há grupo "*", mas todos os rastreadores avaliados têm grupo próprio: não dá para ler o "*"
  if (!curingaBloqueado) return googlebot ? null : naoDisparou(); // regra do Googlebot não visível
  const pg = paginaInicial(paginasDe(ctx));
  if (!pg) return null;
  const exemploCuringa = viaCuringa.find((x) => x.situacao === 'bloqueado' && !x.parcial);
  const mensagem = 'O robots.txt proíbe o site inteiro para os rastreadores em geral ("User-agent: *" com "Disallow: /", sem nenhum "Allow" que reabra caminhos). Os buscadores não vão rastrear nenhuma página. '
    + 'O robots.txt controla o acesso de rastreadores e não serve para esconder páginas do Google (para isso existe o noindex). '
    + 'Se o rastreador desta análise respeita o robots.txt, ele não consegue analisar as demais páginas do site.'
    + (googlebot ? ' Há também uma regra específica para o Googlebot, que esta checagem não lê.' : '');
  const evidencias = [{ versao: 'cru', pagina: '/robots.txt', trecho: 'User-agent: *\nDisallow: /', valor: 'bloqueado', ...(exemploCuringa ? { seletor: exemploCuringa.grupo } : {}) }];
  const a = montar(ctx, regra, pg, { mensagem, evidencias });
  return a ? resultado([a], 1) : naoDisparou();
}

// ============================================================ SEO: sitemap
function detSitemapAusente({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo || !seo.site) return null;
  if (!entradaEhUrl(ctx)) return null; // em pasta/ZIP o arquivo pode existir só localmente
  const sm = seo.site.sitemap, rb = seo.site.robotsTxt;
  if (sm.erro && sm.status === null) return null; // não deu para consultar
  if (sm.presente || (rb?.sitemapsDeclarados || []).length) return naoDisparou();
  const pg = paginaInicial(paginasDe(ctx));
  if (!pg) return null;
  const limite = regra.deteccao.parametros?.paginas_abaixo_das_quais_dispensavel ?? 500;
  const mensagem = `Não encontramos sitemap em /sitemap.xml nem declarado no robots.txt (status ${sm.status ?? 'sem resposta'} em /sitemap.xml). O Google diz que o sitemap não é obrigatório e não garante rastreamento nem indexação; sites com cerca de ${limite} páginas ou menos podem dispensá-lo.`;
  const a = montar(ctx, regra, pg, { mensagem, evidencias: [{ versao: 'cru', pagina: '/sitemap.xml', valor: sm.status ?? 'sem resposta', trecho: '/sitemap.xml' }], numeros: [limite, sm.status ?? 0] });
  return a ? resultado([a], 1) : naoDisparou();
}

// Só o que dá para checar sem requisições extras: páginas LIDAS que o sitemap lista e que têm noindex, status diferente de 200
// ou canonical para outro endereço. É uma amostra (as páginas da análise), não o sitemap inteiro.
function detSitemapProblematico({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo || !seo.site) return null;
  const sm = seo.site.sitemap;
  if (!sm.presente || sm.tipo !== 'urlset') return null;
  const pgs = paginasDe(ctx);
  const listadas = (sm.paginasAmostradas || []).filter((x) => x.listadaNoSitemap === true);
  if (!listadas.length) return null;
  const achados = [];
  for (const l of listadas) {
    const pg = pgs.find((x) => x.caminho === l.caminho);
    const s = seo.paginas.find((x) => x.caminho === l.caminho);
    if (!pg || !s) continue;
    const problemas = [];
    const citacoes = [];
    if (s.status !== null && s.status !== 200) problemas.push(`responde com status ${s.status}`);
    if (s.redirecionou) problemas.push('redireciona para outro endereço');
    if (s.noindexNoCabecalho || s.final?.robotsMeta?.noindex) {
      problemas.push('tem noindex');
      for (const m of (s.final?.robotsMeta?.metas || []).filter((x) => /noindex|none/i.test(x.conteudo))) citacoes.push(citTrecho(pg, m.conteudo, 'html', ['final']));
    }
    if (s.final?.canonical?.apontaPara === 'outra') { problemas.push('tem canonical apontando para outro endereço'); citacoes.push(citTrecho(pg, s.final.canonical.href, 'html', ['final'])); }
    if (!problemas.length) continue;
    achados.push(montar(ctx, regra, pg, {
      mensagem: `O sitemap lista esta página, mas ela ${problemas.join(' e ')}. O sitemap deve listar só endereços que respondem 200, sem noindex e sem apontar para outra versão. Checagem feita só nas páginas lidas nesta análise (uma amostra, não o sitemap inteiro).`,
      citacoes, evidencias: [{ versao: 'final', pagina: l.caminho, trecho: l.caminho, valor: problemas.join('; '), contagem: 1 }],
    }));
  }
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(lista.length, listadas.length)) : naoDisparou();
}

// ============================================================ SEO: links
const quebradoReal = (r) => r.status !== null ? (r.status >= 400 && ![401, 403, 429].includes(r.status) && r.status !== 999) : /tempo esgotado|timeout/i.test(String(r.motivo || ''));

function agrupaPorPagina(itens, pgs) {
  const mapa = new Map();
  for (const q of itens) for (const c of q.paginas || []) {
    if (!mapa.has(c)) mapa.set(c, []);
    mapa.get(c).push(q);
  }
  return [...mapa.entries()].sort((a, b) => cmp(a[0], b[0])).map(([caminho, qs]) => ({ pg: pgs.find((x) => x.caminho === caminho), qs })).filter((x) => x.pg);
}

function detLinksQuebrados(interno) {
  return ({ ctx, med, regra }) => {
    const ln = medidorOk(med, 'links');
    if (!ln || !ln.verificacao) return null;
    const v = ln.verificacao;
    if (!interno && !v.incluiExternos) return null; // links externos só no modo completo
    const resultados = (v.resultados || []).filter((r) => !!r.interno === interno);
    if (!resultados.length) return null;
    const quebrados = (v.quebrados || []).filter((q) => !!q.interno === interno && quebradoReal(q))
      .concat((v.semResposta || []).filter((q) => !!q.interno === interno && quebradoReal({ status: null, motivo: q.motivo })));
    const total = resultados.length;
    const nome = interno ? 'internos' : 'externos';
    const local = !entradaEhUrl(ctx);
    if (!quebrados.length) return naoDisparou();
    const pgs = paginasDe(ctx);
    const grupos = agrupaPorPagina(quebrados, pgs);
    if (!grupos.length) return null;
    const achados = grupos.map(({ pg, qs }) => {
      const exemplos = qs.slice(0, 3).map((q) => `${caminhoDe(q.url)} (${q.status ?? q.motivo})`);
      const mensagem = `Nesta página, ${qs.length} ${plural(qs.length, `link ${interno ? 'interno leva' : 'externo leva'}`, `links ${nome} levam`)} a páginas com erro, de ${total} links ${nome} verificados no site: ${exemplos.join(', ')}${qs.length > 3 ? ' e outros' : ''}. `
        + (local ? 'Esta é uma análise de pasta local: confirme no site publicado, pois rotas que dependem do servidor real podem não existir aqui. ' : '')
        + (interno ? 'Respostas de acesso negado ou de excesso de pedidos não contam como quebradas.' : 'Sites externos às vezes bloqueiam robôs; só contamos páginas não encontradas, erros do servidor e tempo esgotado.');
      const citacoes = [];
      for (const q of qs.slice(0, 3)) for (const t of (q.textos || []).slice(0, 1)) citacoes.push(citTrecho(pg, t, 'visivel', ['final']));
      const evidencias = qs.slice(0, 10).map((q) => ({ versao: 'final', seletor: 'a[href]', trecho: q.url.slice(0, 200), valor: q.status ?? q.motivo, contagem: q.links }));
      return montar(ctx, regra, pg, { mensagem, citacoes, evidencias, numeros: [qs.length, total, ...qs.slice(0, 3).map((q) => q.status).filter((x) => x !== null)] });
    }).filter(Boolean);
    return achados.length ? resultado(achados, fracao(quebrados.length, total)) : naoDisparou();
  };
}

// <a> que o Google não segue, lidos no HTML do DOM final
export function linksNaoSeguidos(html) {
  const itens = [];
  const attr = (s, nome) => { const m = new RegExp(`(?:^|\\s)${nome}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'i').exec(s); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };
  for (const m of String(html || '').matchAll(/<a\b([^>]*)>/gi)) {
    const a = m[1];
    const href = attr(a, 'href');
    const tag = m[0].replace(/\s+/g, ' ');
    if (href === null) { if (attr(a, 'name') === null) itens.push({ tipo: 'sem-href', tag }); continue; }
    const h = href.trim();
    if (h === '') itens.push({ tipo: 'href-vazio', tag });
    else if (/^javascript:/i.test(h)) itens.push({ tipo: 'javascript', tag });
    else if (h === '#' && attr(a, 'onclick') !== null) itens.push({ tipo: 'hash-com-onclick', tag });
  }
  for (const m of String(html || '').matchAll(/<(?!a\b)([a-z][\w-]*)\b([^>]*)>/gi)) {
    const a = m[2];
    if (/(?:^|\s)role\s*=\s*["']link["']/i.test(a) || /(?:^|\s)routerlink\b/i.test(a)) itens.push({ tipo: 'role-link-sem-a', tag: m[0].replace(/\s+/g, ' ') });
  }
  return itens;
}
const DESCRICAO_LINK = {
  'sem-href': '<a> sem href', 'href-vazio': '<a> com href vazio', javascript: 'link "javascript:"', 'hash-com-onclick': 'link "#" que só funciona por clique em JavaScript',
  'role-link-sem-a': 'elemento com role="link" ou routerLink que não é <a href>',
};

function detLinkNaoSeguido({ ctx, med, regra }) {
  if (!medidorOk(med, 'links')) return null;
  const achados = [];
  let avaliou = false;
  let total = 0, ruins = 0;
  for (const pg of paginasDe(ctx)) {
    if (!pg.final) continue;
    avaliou = true;
    const itens = linksNaoSeguidos(pg.htmlFinal);
    total += (pg.final.links || []).length + itens.length;
    if (!itens.length) continue;
    ruins += itens.length;
    const porTipo = {};
    for (const i of itens) porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
    const lista = Object.entries(porTipo).map(([t, n]) => `${n} ${DESCRICAO_LINK[t]}`).join(', ');
    const mensagem = `O Google só segue links que são <a> com href de verdade. Encontramos: ${lista}. Âncoras para ids da própria página e botões de menu não entram nesta conta; links criados por JavaScript valem se o resultado final tiver <a href>.`;
    const citacoes = itens.slice(0, 3).map((i) => citTrecho(pg, i.tag, 'html', ['final']));
    const evidencias = [...itens.slice(0, MAX_EXEMPLOS).map((i) => ({ versao: 'final', seletor: i.tipo, trecho: i.tag.slice(0, 200), valor: DESCRICAO_LINK[i.tipo] })), { versao: 'final', seletor: 'a', valor: 'links que o Google não segue', contagem: itens.length }];
    achados.push(montar(ctx, regra, pg, { mensagem, citacoes, evidencias, numeros: [...Object.values(porTipo), itens.length] }));
  }
  if (!avaliou) return null;
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(ruins, total)) : naoDisparou();
}

function detTextoGenerico({ ctx, med, regra }) {
  const ln = medidorOk(med, 'links');
  if (!ln) return null;
  const achados = [];
  let ruins = 0;
  const visiveis = ln.resumo?.linksVisiveisNaoClone || 0;
  for (const pg of paginasDe(ctx)) {
    const gen = (ln.genericos || []).filter((g) => g.pagina === pg.caminho && !g.temRotuloAcessivel);
    if (!gen.length) continue;
    ruins += gen.length;
    const porTexto = new Map();
    for (const g of gen) porTexto.set(g.texto, (porTexto.get(g.texto) || 0) + 1);
    const textos = [...porTexto.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    const mensagem = `${gen.length} ${plural(gen.length, 'link usa', 'links usam')} textos genéricos que não dizem para onde levam: ${textos.slice(0, 4).map(([t, n]) => `"${t}" (${n})`).join(', ')}. Um texto descritivo ajuda quem usa leitor de tela e o Google a entender o destino. Chamadas de ação específicas, como "Comprar agora", não entram.`;
    const citacoes = [];
    for (const [t] of textos.slice(0, 3)) { citacoes.push(citContagem(pg, 'final', 'links-com-texto', { texto: t })); citacoes.push(citTrecho(pg, t, 'visivel', ['final'])); }
    const evidencias = [...gen.slice(0, 10).map((g) => ({ versao: 'final', seletor: g.seletor, trecho: g.texto, valor: g.href, visivel: true })), { versao: 'final', seletor: 'a', valor: 'links com texto genérico', contagem: gen.length }];
    achados.push(montar(ctx, regra, pg, { mensagem, citacoes, evidencias, numeros: [gen.length, ...textos.slice(0, 4).map(([, n]) => n)] }));
  }
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(ruins, visiveis)) : naoDisparou();
}

// Imagem de destaque só como fundo de CSS: o extrator não registra o tamanho dos blocos com background-image (nem as regras que os
// atingem), então não há como medir "mais de 20% da primeira tela". Sem dado medido, não avaliável.
function detImagemSoFundoCss() {
  return null;
}

// ============================================================ SEO: hreflang
const CODIGO_HREFLANG = /^[a-z]{2}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i; // idioma ISO 639-1, script opcional (ex.: zh-Hans) e região opcional

function detHreflang({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const pgs = paginasDe(ctx);
  const completo = ctx.site?.modo === 'completo';
  const mapaHref = new Map(); // url normalizada da página -> Set de alvos que ela lista (final)
  let algum = false;
  for (const pg of pgs) {
    const f = porUrl(seo.paginas, pg.url)?.final;
    if (f && f.hreflang.length) { algum = true; mapaHref.set(normalizarUrl(pg.url), new Set(f.hreflang.map((h) => normalizarUrl(h.href, pg.url)).filter(Boolean))); }
  }
  if (!algum) return null; // site de um idioma só: não se aplica
  const achados = [];
  let ruins = 0, total = 0;
  for (const pg of pgs) {
    const s = porUrl(seo.paginas, pg.url);
    const f = s?.final;
    if (!f || !f.hreflang.length) continue;
    total++;
    const problemas = [];
    const citacoes = [];
    const evidencias = [];
    const eu = normalizarUrl(pg.url);
    const alvos = f.hreflang.map((h) => ({ ...h, abs: normalizarUrl(h.href, pg.url) }));
    if (!alvos.some((a) => a.abs === eu || (s.urlFinal && a.abs === normalizarUrl(s.urlFinal)))) problemas.push('a página não lista a si mesma entre as versões (autorreferência)');
    for (const a of alvos) {
      if (a.hreflang.toLowerCase() !== 'x-default' && !CODIGO_HREFLANG.test(a.hreflang)) { problemas.push(`o código de idioma "${a.hreflang}" não é válido`); citacoes.push(citTrecho(pg, `hreflang="${a.hreflang}"`, 'html', ['final'])); }
      if (!/^https?:\/\//i.test(String(a.href))) { problemas.push(`o endereço "${a.href}" (${a.hreflang}) não é uma URL completa com protocolo`); citacoes.push(citTrecho(pg, `href="${a.href}"`, 'html', ['final'])); }
      evidencias.push({ versao: 'final', seletor: 'link[rel="alternate"][hreflang]', trecho: String(a.href), valor: a.hreflang });
    }
    if (!f.hreflangXDefault) problemas.push('não há versão x-default');
    if (completo) {
      for (const a of alvos) {
        if (!a.abs || a.abs === eu || !mapaHref.has(a.abs)) continue; // só confere as versões que fazem parte das páginas lidas
        if (!mapaHref.get(a.abs).has(eu)) problemas.push(`a versão "${a.hreflang}" (${a.href}) não aponta de volta para esta página`);
      }
    }
    if (!problemas.length) continue;
    ruins++;
    achados.push(montar(ctx, regra, pg, {
      mensagem: `Versões de idioma (hreflang) com problema: ${unicos(problemas).join('; ')}.${completo ? '' : ' A checagem de retorno recíproco só roda no modo completo.'}`,
      citacoes, evidencias,
    }));
  }
  const lista = achados.filter(Boolean);
  return lista.length ? resultado(lista, fracao(ruins, total)) : naoDisparou();
}

function detMetadadosDiferem({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const achados = [];
  let avaliou = 0;
  for (const pg of paginasDe(ctx)) {
    const s = porUrl(seo.paginas, pg.url);
    if (!s?.cru || !s?.final) continue;
    avaliou++;
    const c = s.cru, f = s.final;
    const robots = (x) => x.robotsMeta.metas.map((m) => m.conteudo).join(', ');
    const campos = [
      { nome: 'o título', info: true, a: c.titulo.texto, b: f.titulo.texto },
      { nome: 'a meta description', info: true, a: c.descricao.texto, b: f.descricao.texto },
      { nome: 'o link canonical', info: false, a: c.canonical.href ?? '', b: f.canonical.href ?? '' },
      { nome: 'a meta robots', info: false, a: robots(c), b: robots(f) },
    ].filter((x) => normalizarTexto(x.a) !== normalizarTexto(x.b));
    if (!campos.length) continue;
    const aviso = campos.some((x) => !x.info);
    const partes = campos.map((x) => `${x.nome} muda (HTML cru: ${x.a ? `"${x.a}"` : 'vazio'}; DOM final: ${x.b ? `"${x.b}"` : 'vazio'})`);
    const citacoes = [];
    const evidencias = [];
    for (const x of campos) {
      citacoes.push(citTrecho(pg, x.a, 'html', ['cru']), citTrecho(pg, x.b, 'html', ['final']));
      evidencias.push({ versao: 'cru', seletor: x.nome, trecho: x.a, valor: 'HTML cru' }, { versao: 'final', seletor: x.nome, trecho: x.b, valor: 'DOM final' });
    }
    achados.push(montar(ctx, regra, pg, {
      mensagem: `Depois que o JavaScript roda: ${partes.join('; ')}. `
        + (aviso ? 'Canonical e robots definidos por JavaScript merecem atenção: o Google pode não rodar o JavaScript em páginas com noindex. ' : '')
        + 'Título e description definidos por JavaScript são aceitos pelo Google; aqui são só um aviso informativo.',
      citacoes, evidencias, severidade: aviso ? null : 'P3',
    }));
  }
  if (!avaliou) return null;
  const lista = achados.filter(Boolean);
  const alguma = lista.some((a) => !a.severidade);
  return lista.length ? resultado(lista, alguma ? 1 : 0.4) : naoDisparou();
}

// ============================================================ SEO: URLs, páginas órfãs
function detUrlPoucoAmigavel({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  if (!seo) return null;
  const ln = medidorOk(med, 'links');
  const pgs = paginasDe(ctx);
  const mapa = new Map(); // url -> { url, pagina (pg em que aparece) }
  for (const pg of pgs) { if (!mapa.has(pg.url)) mapa.set(pg.url, { url: pg.url, pg, link: null }); }
  for (const l of ln?.links || []) {
    if (l.tipo !== 'interno') continue;
    let u; try { u = new URL(l.href); } catch { continue; }
    u.hash = '';
    if (!mapa.has(u.toString())) mapa.set(u.toString(), { url: u.toString(), pg: pgs.find((x) => x.caminho === l.pagina) || pgs[0], link: l });
  }
  // roteamento por hash (#/ ou #!): olha o href como escrito
  const hash = [];
  for (const pg of pgs) for (const l of pg.final?.links || []) if (l.interno && /#!?\//.test(String(l.hrefAttr ?? ''))) hash.push({ url: l.hrefAttr, pg });
  const achadosUrl = [];
  for (const { url, pg, link } of mapa.values()) {
    const a = analisarUrlAmigavel(url);
    if (!a) continue;
    const motivos = [];
    if (a.temUnderscore) motivos.push('underline (_) no caminho');
    if (/\/[^?#]*[A-Z]/.test(new URL(url).pathname)) motivos.push('letras maiúsculas no caminho (maiúsculas diferentes contam como endereços diferentes)');
    if (a.parametros.some((p) => /^(sessionid|sid|phpsessid|jsessionid)$/i.test(p))) motivos.push('ID de sessão no endereço');
    if (motivos.length) achadosUrl.push({ url, pg, motivos, link });
  }
  for (const h of hash) achadosUrl.push({ url: h.url, pg: h.pg, motivos: ['roteamento por # (#/ ou #!), que o Google não trata como páginas separadas'], link: null });
  if (!achadosUrl.length) return naoDisparou();
  const total = mapa.size + hash.length;
  const primeira = achadosUrl[0].pg;
  const exemplos = achadosUrl.slice(0, 5).map((x) => `${caminhoDe(x.url) || x.url} (${x.motivos.join('; ')})`);
  const mensagem = `${achadosUrl.length} ${plural(achadosUrl.length, 'endereço difícil de ler', 'endereços difíceis de ler')}: ${exemplos.join('; ')}${achadosUrl.length > 5 ? ' e outros' : ''}. Mudar endereços de um site já indexado exige redirecionamentos; o Google não exige minúsculas, só consistência.`;
  const citacoes = unicos(achadosUrl.map((x) => { const n = String(x.url).split('/').filter(Boolean).pop() || ''; return n.split(/[?#]/)[0]; }).filter(Boolean)).slice(0, 3).map((n) => citTrecho(primeira, n, 'html', ['final']));
  const evidencias = achadosUrl.slice(0, 10).map((x) => ({ pagina: x.pg.caminho, versao: 'final', seletor: 'a[href]', trecho: x.url.slice(0, 200), valor: x.motivos.join('; '), contagem: 1 }));
  const a = montar(ctx, regra, primeira, { mensagem, citacoes, evidencias, numeros: [achadosUrl.length] });
  return a ? resultado([a], fracao(achadosUrl.length, total)) : naoDisparou();
}

// Páginas do sitemap (só as primeiras amostradas pelo medidor) que nenhum link interno das páginas lidas alcança. Confiança baixa.
function detPaginasSemLinkInterno({ ctx, med, regra }) {
  const seo = medidorOk(med, 'seo');
  const ln = medidorOk(med, 'links');
  if (!seo || !ln || !seo.site) return null;
  const sm = seo.site.sitemap;
  if (!sm.presente || sm.tipo !== 'urlset' || !(sm.locsAmostra || []).length) return null;
  const pgs = paginasDe(ctx);
  if (pgs.length < 2) return null; // com uma página só, tudo pareceria órfão
  const alcancados = new Set();
  for (const l of ln.links || []) { if (l.tipo !== 'interno') continue; const k = normalizarUrl(l.href); if (k) alcancados.add(k); }
  for (const pg of pgs) { const k = normalizarUrl(pg.url); if (k && pg.url === (pgs.find((x) => x.caminho === '/') || {}).url) alcancados.add(k); }
  const home = pgs.find((x) => x.caminho === '/');
  const locs = sm.locsAmostra.map((l) => normalizarUrl(l, sm.url)).filter(Boolean);
  const orfas = locs.filter((l) => !alcancados.has(l) && l !== (home ? normalizarUrl(home.url) : null));
  if (!orfas.length) return naoDisparou();
  const pg = home || pgs[0];
  const mensagem = `${orfas.length} de ${locs.length} ${plural(locs.length, 'endereço', 'endereços')} do sitemap (as primeiras entradas lidas) não ${plural(orfas.length, 'tem', 'têm')} link interno nas páginas que visitamos: ${orfas.slice(0, 5).map(caminhoDe).join(', ')}. `
    + 'Não achamos link nas páginas visitadas; páginas que não visitamos podem apontar para elas. Confiança baixa.';
  const a = montar(ctx, regra, pg, { mensagem, evidencias: orfas.slice(0, 10).map((o) => ({ versao: 'final', pagina: caminhoDe(o), trecho: o, valor: 'sem link interno nas páginas lidas', contagem: 0 })), numeros: [orfas.length, locs.length] });
  return a ? resultado([a], fracao(orfas.length, locs.length)) : naoDisparou();
}

// ============================================================ mapa regra -> detector
export const detectores = {
  // performance
  'perf-lcp-acima-do-limite': detLcp,
  'perf-cls-acima-do-limite': detCls,
  'perf-tbt-bloqueio-da-thread': detTbt,
  'perf-lazy-loading-contagem': detLazyContagem,
  'perf-lcp-imagem-com-lazy': detLcpComLazy,
  'perf-lcp-imagem-sem-prioridade': detLcpSemPrioridade,
  'perf-imagem-sem-dimensoes': detImagemSemDimensoes,
  'perf-imagem-maior-que-o-exibido': detImagemMaiorQueExibido,
  'perf-imagem-formato-pouco-eficiente': detImagemFormato,
  'perf-gif-animado': detGifAnimado,
  'perf-fonte-sem-font-display': detFonteSemDisplay,
  'perf-recurso-bloqueia-renderizacao': detBloqueioRenderizacao,
  'perf-peso-total-da-pagina': detPesoTotal,
  'perf-dom-grande': detDomGrande,
  'perf-sem-compressao-de-texto': detSemCompressao,
  'perf-cache-de-arquivos-estaticos': detCacheEstaticos,
  'perf-servidor-lento': detServidorLento,
  'perf-redirecionamentos-multiplos': detRedirecionamentos,
  'perf-terceiros-travam-a-pagina': detTerceiros,
  'perf-javascript-nao-usado': detJsNaoUsado,
  // seo
  'seo-titulo-ausente-ou-vazio': detTituloAusente,
  'seo-titulo-tamanho-heuristica': detTituloTamanho,
  'seo-titulo-repetido-entre-paginas': detTituloRepetido,
  'seo-meta-description-ausente-ou-repetida': detDescricao,
  'seo-dados-estruturados-presentes': detDadosEstruturados,
  'seo-jsonld-com-erro-de-sintaxe': detJsonldErro,
  'seo-dados-estruturados-nao-batem-com-a-pagina': detNaoBatem,
  'seo-canonical-ausente': detCanonicalAusente,
  'seo-canonical-conflitante': detCanonicalConflitante,
  'seo-noindex-na-pagina': detNoindex,
  'seo-robots-txt-bloqueia-o-site-todo': detRobotsBloqueiaTudo,
  'seo-sitemap-ausente': detSitemapAusente,
  'seo-sitemap-com-urls-problematicas': detSitemapProblematico,
  'seo-links-internos-quebrados': detLinksQuebrados(true),
  'seo-links-externos-quebrados': detLinksQuebrados(false),
  'seo-link-que-o-google-nao-segue': detLinkNaoSeguido,
  'seo-texto-de-link-generico': detTextoGenerico,
  'seo-imagem-importante-so-como-fundo-css': detImagemSoFundoCss,
  'seo-hreflang-com-erro': detHreflang,
  'seo-metadados-diferem-entre-html-cru-e-final': detMetadadosDiferem,
  'seo-url-pouco-amigavel': detUrlPoucoAmigavel,
  'seo-paginas-sem-link-interno': detPaginasSemLinkInterno,
};
