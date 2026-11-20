// Medidor "links": análise dos <a href> visíveis e não-clone do DOM FINAL, e verificação HTTP de links quebrados.
// Só medidas (fatos e evidências reproduzíveis); quem julga é o modelo. O conteúdo do site é DADO.
//
// FORMATO DE `dados` (JSON puro; páginas ordenadas por URL; listas em ordem de documento ou ordenadas):
// {
//   resumo: { paginas, linksVisiveisNaoClone, internos, externos, outros, gruposTextoRepetido, gruposTextoRepetidoSemContexto,
//             vazios, genericos, hrefInvalidos, targetBlankSemRel, verificados, quebrados, semResposta },
//   totaisPorVersao: { cru: { links, visiveisNaoClone }, final: { links, visiveisNaoClone } },
//   links: [{ pagina, texto, href, interno, tipo: 'interno'|'externo'|'outro' }],     // TODOS os visíveis não-clone (final)
//   grupos: [{ texto, textoNormalizado, contagem, hrefsDistintos, paginas[], internos, externos }],
//          // agrupamento SITE-WIDE por normalizarTexto(texto), só grupos com 2+ links; ordem: contagem desc, texto asc
//   totalTextosDistintos,
//   textoRepetidoSemContexto: [{ pagina, texto, textoNormalizado, contagem, hrefs[], hrefsDistintos, mesmoDestino,
//          seletores[], contextos[], contextoDistinto, diferenciador: { ariaLabel, ariaLabelledby, title } }],
//          // POR PÁGINA: 2+ links visíveis não-clone com o MESMO texto normalizado e SEM aria-label / aria-labelledby / title
//          // que os diferencie (mesmo trio de valores). `contextoDistinto` informa se o campo `contexto` (texto do
//          // item/parágrafo ao redor) difere entre eles: é um FATO a mais para o modelo julgar; NÃO exclui o grupo,
//          // porque um leitor de tela que lista só os links vê apenas o texto repetido.
//   vazios: [{ pagina, seletor, href, temTitle }],        // sem texto, sem aria-label/aria-labelledby e sem imagem/ícone com alt/aria-label dentro
//   semTextoComNomePorDescendente,                        // quantos links sem texto têm nome vindo de alt/aria-label de um descendente
//   genericos: [{ pagina, texto, href, interno, temRotuloAcessivel, seletor }],
//   textosGenericosUsados: [...],                         // lista usada na comparação (igualdade após normalizar e tirar pontuação das pontas)
//   hrefInvalidos: [{ pagina, texto, hrefAttr, motivo: '#'|'javascript', seletor }],
//   targetBlankSemRel: [{ pagina, texto, href, interno, rel, seletor }],      // target=_blank sem rel noopener/noreferrer
//   verificacao: {
//     modo, incluiExternos, limite, intervaloMs, timeoutMs,
//     candidatos,                  // URLs distintas elegíveis neste modo (http/https, sem âncora pura)
//     verificados,                 // quantas foram de fato requisitadas (<= limite)
//     naoVerificadosPorLimite,     // elegíveis que ficaram de fora por causa do limite
//     externosNaoVerificados,      // (modo rápido) URLs externas distintas que não são verificadas neste modo
//     resultados: [{ url, status: número|null, ok, metodo: 'HEAD'|'GET', urlFinal, motivo: texto|null, bloqueado, interno }],  // ordenado por URL
//     quebrados: [{ url, status, metodo, interno, motivo, paginas[], textos[], links }],   // status >= 400
//     semResposta: [{ url, motivo, bloqueado, interno, paginas[], textos[], links }]       // status null (erro, tempo esgotado, bloqueio de segurança)
//   }
// }
// Verificação HTTP: SÓ internos no modo 'rapido' (máx. 40 URLs, 100 ms entre requisições) e internos + externos no
// 'completo' (máx. 150, 200 ms); timeout de 8 s; HEAD com fallback para GET (status >= 400 ou erro de rede que não
// seja bloqueio/tempo esgotado); nunca lança exceção (erro vira status null + motivo); cache por URL dentro da execução.
// Toda requisição passa por buscarSeguro (anti-SSRF). Limites conhecidos: nome acessível de links com imagem usa a lista
// `atributos` do extrator (máx. 800 elementos) e o seletor como prefixo; se a resposta GET passar de 5 MB vira "sem resposta".
//
// evidencias: [{ pagina, versao:'final', seletor, trecho, valor, contagem, visivel }]. Para grupos, `seletor` é a lista
// de seletores separada por vírgula (um seletor CSS válido que seleciona todos os links do grupo) e `contagem` o seu tamanho.
import { buscarSeguro } from '../rede-segura.mjs';
import { normalizarTexto, esperar as esperarMs } from '../util.mjs';

export const id = 'links';
export const VERSAO = '1';
export const LIMITES = {
  rapido: { max: 40, intervaloMs: 100, incluiExternos: false },
  completo: { max: 150, intervaloMs: 200, incluiExternos: true },
};
export const TIMEOUT_MS = 8000;
// Exemplos comuns de texto de link sem significado fora de contexto (WCAG 2.4.4 / técnica F84: "clique aqui", "mais").
export const TEXTOS_GENERICOS = ['aqui', 'click here', 'clique', 'clique aqui', 'continue lendo', 'here', 'ler mais', 'learn more', 'leia mais', 'mais', 'more', 'read more', 'saiba mais', 'ver mais', 'veja mais'];

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordenarPorUrl = (paginas) => [...paginas].sort((a, b) => cmp(a.url, b.url));
const ehVisivelNaoClone = (l) => l.visivel === true && l.clone !== true;
const tokens = (s) => String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const semHash = (url) => { try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return String(url); } };
const unicosOrdenados = (arr) => [...new Set(arr)].sort(cmp);
const ENVOLTURA = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function tipoDoLink(l) {
  let proto = '';
  try { proto = new URL(l.href).protocol; } catch { /* href estranho */ }
  if (proto !== 'http:' && proto !== 'https:') return 'outro';
  return l.interno ? 'interno' : 'externo';
}

export function textoGenerico(texto) {
  const t = normalizarTexto(texto).replace(ENVOLTURA, '');
  return TEXTOS_GENERICOS.includes(t) ? t : null;
}

// ---------- verificação HTTP ----------
function ehTempoEsgotado(e) { return /abort|timeout|tempo/i.test(`${e && e.name} ${e && e.message}`); }

async function tentar(buscar, url, metodo, opcoes) {
  try {
    const r = await buscar(url, { ...opcoes, metodo });
    return { r };
  } catch (e) {
    return { e };
  }
}

// urls: [{ url, interno }]. Devolve { resultados, usadas } e NUNCA lança.
export async function verificarLinks(itens, { intervaloMs = 100, timeoutMs = TIMEOUT_MS, permitidos = [], permitirLocal = false, buscar = buscarSeguro, esperar = esperarMs, cache = new Map() } = {}) {
  const resultados = [];
  let primeira = true;
  for (const { url, interno } of itens) {
    if (cache.has(url)) { resultados.push({ ...cache.get(url), interno }); continue; }
    if (!primeira) await esperar(intervaloMs);
    primeira = false;
    const opcoes = { timeoutMs, permitidos, permitirLocal, maxBytes: 5 * 1024 * 1024 };
    let res;
    try {
      let t = await tentar(buscar, url, 'HEAD', opcoes);
      let metodo = 'HEAD';
      const precisaGet = (t.r && t.r.status >= 400) || (t.e && !t.e.bloqueado && !ehTempoEsgotado(t.e));
      if (precisaGet) { t = await tentar(buscar, url, 'GET', opcoes); metodo = 'GET'; }
      if (t.r) {
        res = { url, status: t.r.status, ok: t.r.status >= 200 && t.r.status < 400, metodo, urlFinal: t.r.url || url, motivo: null, bloqueado: false };
      } else {
        const e = t.e;
        const motivo = e && e.bloqueado ? String(e.message) : ehTempoEsgotado(e) ? `tempo esgotado (${timeoutMs / 1000} s)` : String((e && e.message) || e).slice(0, 200);
        res = { url, status: null, ok: false, metodo, urlFinal: url, motivo, bloqueado: !!(e && e.bloqueado) };
      }
    } catch (e) {
      res = { url, status: null, ok: false, metodo: 'HEAD', urlFinal: url, motivo: String((e && e.message) || e).slice(0, 200), bloqueado: false };
    }
    cache.set(url, res);
    resultados.push({ ...res, interno });
  }
  return resultados;
}

// ---------- análise ----------
function nomePorDescendente(link, atributos) {
  const prefixo = link.seletor + '>';
  return (atributos || []).some((a) => (a.atributo === 'alt' || a.atributo === 'aria-label') && String(a.valor || '').trim() && String(a.seletor || '').startsWith(prefixo));
}

// opcoes (só para testes): { buscar, esperar } substituem buscarSeguro e a espera entre requisições.
export async function medir(ctx) { return medirComOpcoes(ctx); }

export async function medirComOpcoes(ctx, opcoes = {}) {
  const paginasOrd = ordenarPorUrl(ctx.paginas || []);
  const evidencias = [];
  const links = [];
  const vazios = [], genericos = [], hrefInvalidos = [], targetBlankSemRel = [], semContexto = [];
  const porTexto = new Map(); // site-wide
  let semTextoComNomePorDescendente = 0;
  let internos = 0, externos = 0, outros = 0;
  const totaisPorVersao = { cru: { links: 0, visiveisNaoClone: 0 }, final: { links: 0, visiveisNaoClone: 0 } };
  const ocorrencias = new Map(); // url sem hash -> { interno, paginas:Set, textos:Set, links, primeiro:{pagina, seletor, texto} }

  const addEv = (pagina, seletor, trecho, valor, contagem) => evidencias.push({ pagina, versao: 'final', seletor, trecho: String(trecho ?? '').slice(0, 200), valor, contagem, visivel: true });

  for (const p of paginasOrd) {
    const caminho = caminhoDe(p.url);
    const exCru = p.cru && p.cru.extr, exFinal = p.final && p.final.extr;
    if (exCru) { totaisPorVersao.cru.links += (exCru.links || []).length; totaisPorVersao.cru.visiveisNaoClone += (exCru.links || []).filter(ehVisivelNaoClone).length; }
    if (!exFinal) continue;
    totaisPorVersao.final.links += (exFinal.links || []).length;
    const visiveis = (exFinal.links || []).filter(ehVisivelNaoClone);
    totaisPorVersao.final.visiveisNaoClone += visiveis.length;
    const porTextoPagina = new Map();

    for (const l of visiveis) {
      const tipo = tipoDoLink(l);
      links.push({ pagina: caminho, texto: l.texto, href: l.href, interno: !!l.interno, tipo });
      if (tipo === 'interno') internos++; else if (tipo === 'externo') externos++; else outros++;

      const tn = normalizarTexto(l.texto);
      if (tn) {
        if (!porTexto.has(tn)) porTexto.set(tn, { texto: l.texto, links: [] });
        porTexto.get(tn).links.push({ pagina: caminho, href: l.href, tipo });
        if (!porTextoPagina.has(tn)) porTextoPagina.set(tn, []);
        porTextoPagina.get(tn).push(l);
      }

      const rotulo = !!(String(l.ariaLabel ?? '').trim() || String(l.ariaLabelledbyTexto ?? '').trim());
      if (!l.texto && !rotulo) {
        if (nomePorDescendente(l, exFinal.atributos)) semTextoComNomePorDescendente++;
        else vazios.push({ pagina: caminho, seletor: l.seletor, href: l.href, temTitle: !!String(l.title ?? '').trim() });
      }
      const g = textoGenerico(l.texto);
      if (g) genericos.push({ pagina: caminho, texto: l.texto, href: l.href, interno: !!l.interno, temRotuloAcessivel: rotulo, seletor: l.seletor });

      const ha = String(l.hrefAttr ?? '').trim();
      if (ha === '#') hrefInvalidos.push({ pagina: caminho, texto: l.texto, hrefAttr: l.hrefAttr, motivo: '#', seletor: l.seletor });
      else if (/^javascript:/i.test(ha)) hrefInvalidos.push({ pagina: caminho, texto: l.texto, hrefAttr: l.hrefAttr, motivo: 'javascript', seletor: l.seletor });

      if (String(l.target ?? '').toLowerCase() === '_blank' && !tokens(l.rel).some((t) => t === 'noopener' || t === 'noreferrer')) {
        targetBlankSemRel.push({ pagina: caminho, texto: l.texto, href: l.href, interno: !!l.interno, rel: l.rel ?? null, seletor: l.seletor });
      }

      // candidatos à verificação HTTP (http/https, sem âncora pura)
      if (tipo !== 'outro' && !ha.startsWith('#')) {
        const u = semHash(l.href);
        if (!ocorrencias.has(u)) ocorrencias.set(u, { interno: !!l.interno, paginas: new Set(), textos: new Set(), links: 0, primeiro: { pagina: caminho, seletor: l.seletor, texto: l.texto } });
        const o = ocorrencias.get(u);
        o.paginas.add(caminho); if (l.texto) o.textos.add(l.texto); o.links++;
      }
    }

    // texto repetido SEM diferenciador, por página
    for (const [tn, lista] of porTextoPagina) {
      if (lista.length < 2) continue;
      const sub = new Map();
      for (const l of lista) {
        const dif = { ariaLabel: normalizarTexto(l.ariaLabel), ariaLabelledby: normalizarTexto(l.ariaLabelledbyTexto), title: normalizarTexto(l.title) };
        const chave = JSON.stringify(dif);
        if (!sub.has(chave)) sub.set(chave, { dif, itens: [] });
        sub.get(chave).itens.push(l);
      }
      for (const { dif, itens } of sub.values()) {
        if (itens.length < 2) continue;
        const hrefs = itens.map((l) => l.href);
        const contextos = itens.map((l) => l.contexto ?? '');
        semContexto.push({
          pagina: caminho, texto: itens[0].texto, textoNormalizado: tn, contagem: itens.length,
          hrefs, hrefsDistintos: new Set(hrefs).size, mesmoDestino: new Set(hrefs).size === 1,
          seletores: itens.map((l) => l.seletor),
          contextos, contextoDistinto: new Set(contextos.map((c) => normalizarTexto(c))).size > 1,
          diferenciador: { ariaLabel: dif.ariaLabel, ariaLabelledby: dif.ariaLabelledby, title: dif.title },
        });
      }
    }
  }

  semContexto.sort((a, b) => cmp(a.pagina, b.pagina) || cmp(a.textoNormalizado, b.textoNormalizado));

  // grupos site-wide
  const grupos = [...porTexto.entries()].filter(([, g]) => g.links.length >= 2).map(([tn, g]) => ({
    texto: g.texto, textoNormalizado: tn, contagem: g.links.length,
    hrefsDistintos: new Set(g.links.map((x) => x.href)).size,
    paginas: unicosOrdenados(g.links.map((x) => x.pagina)),
    internos: g.links.filter((x) => x.tipo === 'interno').length,
    externos: g.links.filter((x) => x.tipo === 'externo').length,
  })).sort((a, b) => (b.contagem - a.contagem) || cmp(a.textoNormalizado, b.textoNormalizado));

  // ---------- verificação HTTP ----------
  const modo = ctx.site && ctx.site.modo === 'completo' ? 'completo' : 'rapido';
  const lim = LIMITES[modo];
  const todasUrls = [...ocorrencias.entries()].map(([url, o]) => ({ url, interno: o.interno }));
  const elegiveis = lim.incluiExternos ? todasUrls : todasUrls.filter((x) => x.interno);
  const escolhidas = elegiveis.slice(0, lim.max);
  const resultadosOrdem = await verificarLinks(escolhidas, {
    intervaloMs: lim.intervaloMs, timeoutMs: TIMEOUT_MS,
    permitidos: (ctx.rede && ctx.rede.permitidos) || [], permitirLocal: !!(ctx.rede && ctx.rede.permitirLocal),
    buscar: opcoes.buscar, esperar: opcoes.esperar,
  });
  const resultados = [...resultadosOrdem].sort((a, b) => cmp(a.url, b.url));
  const dadosOcorr = (url) => { const o = ocorrencias.get(url); return { paginas: [...o.paginas].sort(cmp), textos: [...o.textos].sort(cmp), links: o.links }; };
  const quebrados = resultados.filter((r) => r.status !== null && r.status >= 400)
    .map((r) => ({ url: r.url, status: r.status, metodo: r.metodo, interno: r.interno, motivo: r.motivo, ...dadosOcorr(r.url) }));
  const semResposta = resultados.filter((r) => r.status === null)
    .map((r) => ({ url: r.url, motivo: r.motivo, bloqueado: r.bloqueado, interno: r.interno, ...dadosOcorr(r.url) }));
  const verificacao = {
    modo, incluiExternos: lim.incluiExternos, limite: lim.max, intervaloMs: lim.intervaloMs, timeoutMs: TIMEOUT_MS,
    candidatos: elegiveis.length,
    verificados: resultados.length,
    naoVerificadosPorLimite: elegiveis.length - escolhidas.length,
    externosNaoVerificados: lim.incluiExternos ? 0 : todasUrls.filter((x) => !x.interno).length,
    resultados, quebrados, semResposta,
  };

  // ---------- evidências ----------
  for (const g of semContexto) addEv(g.pagina, g.seletores.join(', '), g.texto, `texto repetido sem diferenciador; destinos distintos=${g.hrefsDistintos}`, g.contagem);
  const porPagina = (lista) => { const m = new Map(); for (const x of lista) { if (!m.has(x.pagina)) m.set(x.pagina, []); m.get(x.pagina).push(x); } return m; };
  for (const [pg, lista] of porPagina(vazios)) addEv(pg, lista.map((x) => x.seletor).join(', '), '', 'link vazio', lista.length);
  for (const [pg, lista] of porPagina(genericos)) addEv(pg, lista.map((x) => x.seletor).join(', '), unicosOrdenados(lista.map((x) => x.texto)).join(' | '), 'texto genérico', lista.length);
  for (const motivo of ['#', 'javascript']) {
    for (const [pg, lista] of porPagina(hrefInvalidos.filter((x) => x.motivo === motivo))) addEv(pg, lista.map((x) => x.seletor).join(', '), lista[0].hrefAttr, `href inválido (${motivo})`, lista.length);
  }
  for (const [pg, lista] of porPagina(targetBlankSemRel)) addEv(pg, lista.map((x) => x.seletor).join(', '), lista[0].href, 'target=_blank sem rel noopener/noreferrer', lista.length);
  for (const q of quebrados) { const o = ocorrencias.get(q.url); addEv(o.primeiro.pagina, o.primeiro.seletor, o.primeiro.texto, `${q.url} -> ${q.status}`, q.links); }
  for (const q of semResposta) { const o = ocorrencias.get(q.url); addEv(o.primeiro.pagina, o.primeiro.seletor, o.primeiro.texto, `${q.url} -> sem resposta: ${q.motivo}`, q.links); }

  const resumo = {
    paginas: paginasOrd.length,
    linksVisiveisNaoClone: links.length,
    internos, externos, outros,
    gruposTextoRepetido: grupos.length,
    gruposTextoRepetidoSemContexto: semContexto.length,
    vazios: vazios.length,
    genericos: genericos.length,
    hrefInvalidos: hrefInvalidos.length,
    targetBlankSemRel: targetBlankSemRel.length,
    verificados: verificacao.verificados,
    quebrados: quebrados.length,
    semResposta: semResposta.length,
  };
  return {
    id, versao: VERSAO,
    dados: {
      resumo, totaisPorVersao, links, grupos, totalTextosDistintos: porTexto.size,
      textoRepetidoSemContexto: semContexto, vazios, semTextoComNomePorDescendente,
      genericos, textosGenericosUsados: TEXTOS_GENERICOS, hrefInvalidos, targetBlankSemRel, verificacao,
    },
    evidencias,
  };
}
