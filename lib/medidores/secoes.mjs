// Medidor de seções esperadas por tipo de site (M2.13 / SPEC §6.3).
//
// Para o tipo em ctx.site.tipoDeSite, carrega as regras (lib/secoes-carregador.mjs; JSONs em regras/secoes/)
// e procura cada seção esperada em TODAS as páginas amostradas (ou só na home, conforme `deteccao.onde`):
//   - palavras e padrões regex no texto VISÍVEL e NÃO-clone (nós de texto, headings, links, href interno, alt, título, URL);
//   - seletores CSS no DOM vivo da página (só os que não são tag pura; `footer`, `form`... são "dicas" de onde olhar).
//
// `encontrada`: true | false | 'indeterminada'.
//   true            : há prova (palavra/regex/seletor específico) em conteúdo visível e não-clone.
//   false           : nada encontrado nas páginas inspecionadas (listadas em `paginasInspecionadas`).
//                     Isto NÃO diz "o site não tem": diz "o script não achou nessas páginas".
//   'indeterminada' : regra com detectavel_por_script='nao' (o script só junta candidatos para o modelo),
//                     prova só em texto oculto, só um seletor genérico com palavras-chave ausentes, ou
//                     detecção 'parcial' com candidatos fracos.
// NUNCA se afirma "ausente" sem listar as páginas inspecionadas.
import { saidaMedidor } from '../contexto.mjs';
import { carregarSecoes, compilarDeteccao, normalizarParaBusca } from '../secoes-carregador.mjs';

export const id = 'secoes';
export const VERSAO = '1';
const MAX_HITS_POR_PAGINA = 3;
const MAX_OCORRENCIAS = 6;
const MAX_CANDIDATOS = 6;
const TRECHO_MAX = 160;

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const ehTituloTag = (t) => /^h[1-6]$/.test(t || '');
const cortar = (s, n = TRECHO_MAX) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- texto da página como "unidades" pesquisáveis ----------
function unidadesDaPagina(pag) {
  const extr = pag.final.extr;
  const caminho = caminhoDe(pag.url);
  const u = [];
  const add = (via, texto, seletor, visivel, clone) => {
    if (!texto || clone) return;
    u.push({ via, texto: String(texto), busca: normalizarParaBusca(texto), seletor: seletor || null, visivel: visivel !== false, pagina: caminho });
  };
  for (const n of extr.nos || []) add(ehTituloTag(n.tag) ? 'heading' : (n.tag === 'a' ? 'link' : 'texto'), n.texto, n.seletor, n.visivel, n.clone);
  for (const l of extr.links || []) {
    add('link', l.ariaLabel, l.seletor, l.visivel, l.clone);
    add('link', l.title, l.seletor, l.visivel, l.clone);
    if (l.interno && l.hrefAttr) {
      let alvo = l.hrefAttr;
      try { alvo = decodeURIComponent(new URL(l.href).pathname); } catch { /* usa o atributo */ }
      add('href', alvo.replace(/[-_/.]+/g, ' ').trim(), l.seletor, l.visivel, l.clone);
    }
  }
  for (const i of extr.imagens || []) add('alt', i.alt, i.seletor, i.visivel, i.clone);
  if (extr.titulo) add('titulo', extr.titulo, 'title', true, false);
  add('url', decodeURIComponent(caminho).replace(/[-_/.?=&]+/g, ' ').trim(), null, true, false);
  return u;
}

// ---------- seletores CSS no DOM vivo ----------
async function avaliarSeletores(nav, paginas, seletores) {
  const porPagina = new Map(); // caminho -> { [seletor]: {...} } | { erro }
  if (!nav || typeof nav.novoContexto !== 'function' || !seletores.length || !paginas.length) return porPagina;
  const ctx = await nav.novoContexto();
  try {
    for (const pag of paginas) {
      const caminho = caminhoDe(pag.url);
      const page = await ctx.newPage();
      try {
        await page.goto(pag.url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        porPagina.set(caminho, await page.evaluate((sels) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const caminhoEl = (el) => {
            const partes = [];
            for (let e = el; e && e.nodeType === 1 && e !== document.documentElement && partes.length < 5; e = e.parentElement) {
              if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { partes.unshift('#' + e.id); break; }
              let p = e.tagName.toLowerCase();
              const pai = e.parentElement;
              if (pai) { const irm = Array.prototype.filter.call(pai.children, (x) => x.tagName === e.tagName); if (irm.length > 1) p += ':nth-of-type(' + (irm.indexOf(e) + 1) + ')'; }
              partes.unshift(p);
            }
            return partes.join('>');
          };
          const visivel = (el) => {
            if (el.closest('[aria-hidden="true"]')) return false;
            if (!el.getClientRects().length) return false;
            const cs = getComputedStyle(el);
            return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) !== 0;
          };
          const out = {};
          for (const s of sels) {
            let els;
            try { els = Array.prototype.slice.call(document.querySelectorAll(s)); } catch (e) { out[s] = { invalido: true }; continue; }
            const vis = els.filter(visivel);
            const ocu = els.filter((e) => !vis.includes(e));
            const amostra = (e) => ({ texto: norm(e.textContent || e.getAttribute('aria-label') || e.getAttribute('alt') || '').slice(0, 160), seletor: caminhoEl(e) });
            out[s] = { total: els.length, visiveis: vis.length, amostras: vis.slice(0, 3).map(amostra), amostrasOcultas: ocu.slice(0, 2).map(amostra) };
          }
          return out;
        }, seletores));
      } catch (e) {
        porPagina.set(caminho, { erro: String(e.message).split('\n')[0].slice(0, 200) });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return porPagina;
}

// ---------- detecção de UMA seção em UMA página ----------
function procurarNaPagina(unidades, comp, avaliacaoSeletores) {
  const visiveis = [];
  const ocultos = [];
  const dicas = [];
  const vistos = new Set();
  const registrar = (lista, hit) => { const k = `${hit.via}|${hit.termo}|${hit.trecho}`; if (vistos.has(k)) return; vistos.add(k); lista.push(hit); };
  for (const un of unidades) {
    const alvo = un.visivel ? visiveis : ocultos;
    if (alvo.length >= MAX_HITS_POR_PAGINA) continue;
    for (const p of comp.palavras) {
      if (p.re.test(un.busca)) { registrar(alvo, { pagina: un.pagina, via: un.via, tipo: 'palavra', termo: p.termo, trecho: cortar(un.texto), seletor: un.seletor, visivel: un.visivel }); break; }
    }
    for (const r of comp.regexes) {
      if (r.re.test(String(un.texto).normalize('NFKC'))) { registrar(alvo, { pagina: un.pagina, via: un.via, tipo: 'regex', termo: r.padrao, trecho: cortar(un.texto), seletor: un.seletor, visivel: un.visivel }); break; }
    }
  }
  if (avaliacaoSeletores && !avaliacaoSeletores.erro) {
    for (const s of comp.seletores) {
      const a = avaliacaoSeletores[s.seletor];
      if (!a || a.invalido) continue;
      const lista = s.generico ? dicas : visiveis;
      for (const am of a.amostras || []) registrar(lista, { pagina: null, via: 'seletor', tipo: s.generico ? 'dica-seletor' : 'seletor', termo: s.seletor, trecho: cortar(am.texto), seletor: am.seletor, visivel: true, contagem: a.visiveis });
      if (!(a.amostras || []).length) for (const am of a.amostrasOcultas || []) registrar(ocultos, { pagina: null, via: 'seletor', tipo: 'seletor', termo: s.seletor, trecho: cortar(am.texto), seletor: am.seletor, visivel: false, contagem: a.total });
    }
  }
  return { visiveis, ocultos, dicas };
}

function decidir(secao, comp, porPagina, seletoresNaoAvaliados = false) {
  const prova = porPagina.flatMap((p) => p.visiveis).filter((h) => h.tipo !== 'dica-seletor');
  const ocultos = porPagina.flatMap((p) => p.ocultos);
  const dicas = porPagina.flatMap((p) => p.dicas);
  const detectavel = secao.deteccao.detectavel_por_script;
  const temTexto = comp.palavras.length + comp.regexes.length > 0;
  // seletor específico (não-tag-pura) sem nenhuma palavra que o acompanhe? vale como prova; com palavras ausentes, é só indício.
  const provaFirme = prova.filter((h) => h.tipo !== 'seletor' || !temTexto || prova.some((x) => x.tipo !== 'seletor'));
  const soSeletor = prova.length > 0 && provaFirme.length === 0;

  let encontrada; let motivo; let ocorrencias; let candidatos = [];
  if (!temTexto && !comp.seletores.length) {
    encontrada = 'indeterminada'; motivo = 'a regra não traz critérios de detecção (seletores, palavras ou padrões)'; ocorrencias = [];
  } else if (detectavel === 'nao') {
    encontrada = 'indeterminada';
    motivo = 'o script não consegue provar esta seção; os trechos candidatos vão para o modelo julgar';
    candidatos = [...prova, ...ocultos, ...dicas];
    ocorrencias = [];
  } else if (provaFirme.length) {
    encontrada = true; ocorrencias = provaFirme;
  } else if (soSeletor) {
    encontrada = 'indeterminada'; motivo = 'só um seletor específico foi achado, sem as palavras-chave esperadas; confira o trecho'; ocorrencias = []; candidatos = [...prova, ...ocultos];
  } else if (ocultos.length) {
    encontrada = 'indeterminada'; motivo = 'só apareceu em conteúdo oculto (menu recolhido, acordeão fechado ou similar); não conta como visível'; ocorrencias = []; candidatos = ocultos;
  } else if (seletoresNaoAvaliados && !temTexto) {
    encontrada = 'indeterminada'; motivo = 'a regra só tem seletores CSS e eles não puderam ser avaliados no navegador (sem navegador ou falha ao abrir a página)'; ocorrencias = [];
  } else if (detectavel === 'parcial' && dicas.length) {
    encontrada = 'indeterminada'; motivo = 'detecção parcial: sem palavras-chave, mas há elementos onde a seção costuma ficar; o modelo deve conferir'; ocorrencias = []; candidatos = dicas;
  } else {
    encontrada = false; ocorrencias = [];
    motivo = detectavel === 'sim' ? 'não encontrada nas páginas inspecionadas' : 'não encontrada nas páginas inspecionadas (detecção parcial: pode existir de forma que o script não reconhece)';
    if (seletoresNaoAvaliados) motivo += '; seletores CSS não foram avaliados em todas as páginas';
    candidatos = dicas;
  }
  return { encontrada, motivo, ocorrencias: ocorrencias.slice(0, MAX_OCORRENCIAS), candidatos: candidatos.slice(0, MAX_CANDIDATOS), ausenciaConfiavel: encontrada === false && detectavel === 'sim' && !seletoresNaoAvaliados };
}

export async function medir(ctx, opcoes = {}) {
  const tipo = ctx.site?.tipoDeSite || null;
  if (!tipo) return saidaMedidor(id, { indisponivel: 'tipo de site não definido' }, [], VERSAO);
  const dirRegras = opcoes.dirRegras ?? ctx.dirRegras;
  const dirLocal = opcoes.dirLocal !== undefined ? opcoes.dirLocal : ctx.dirLocal;
  const carregado = carregarSecoes(tipo, { ...(dirRegras ? { dirRegras } : {}), ...(dirLocal !== undefined ? { dirLocal } : {}) });
  if (carregado.erro) return saidaMedidor(id, { indisponivel: carregado.erro, tipoDeSite: tipo, avisos: carregado.avisos }, [], VERSAO);
  const paginas = (ctx.paginas || []).filter((p) => p?.final?.extr);
  if (!paginas.length) return saidaMedidor(id, { indisponivel: 'nenhuma página lida disponível', tipoDeSite: tipo }, [], VERSAO);

  const home = paginas.find((p) => { try { const u = new URL(p.url); return u.pathname === '/' && u.origin === ctx.site?.origem; } catch { return false; } }) || paginas[0];
  const avisos = [...carregado.avisos];
  const compiladas = new Map();
  for (const s of carregado.secoes) { const c = compilarDeteccao(s); avisos.push(...c.avisos); compiladas.set(s.id, c); }

  const paginasDaSecao = (s) => (s.deteccao.onde === 'home' ? [home] : paginas);
  // seletores a avaliar no DOM vivo, por página
  const seletoresPorPagina = new Map();
  for (const s of carregado.secoes) {
    for (const p of paginasDaSecao(s)) {
      const k = caminhoDe(p.url);
      if (!seletoresPorPagina.has(k)) seletoresPorPagina.set(k, new Set());
      for (const x of compiladas.get(s.id).seletores) seletoresPorPagina.get(k).add(x.seletor);
    }
  }
  const todosSeletores = [...new Set([...seletoresPorPagina.values()].flatMap((x) => [...x]))];
  const semNavegador = !!todosSeletores.length && !(ctx.navegador && typeof ctx.navegador.novoContexto === 'function');
  if (semNavegador) avisos.push('sem navegador no contexto: seletores CSS não foram avaliados (só palavras e padrões no texto)');
  let avaliacao = new Map();
  try {
    avaliacao = await avaliarSeletores(ctx.navegador, paginas.filter((p) => seletoresPorPagina.has(caminhoDe(p.url))), todosSeletores);
  } catch (e) {
    avisos.push(`falha ao avaliar seletores no navegador: ${String(e.message).split('\n')[0]}`);
  }
  for (const [caminho, a] of avaliacao) if (a.erro) avisos.push(`seletores não avaliados em ${caminho}: ${a.erro}`);

  const unidadesPorPagina = new Map(paginas.map((p) => [p, unidadesDaPagina(p)]));
  const secoes = [];
  const evidencias = [];
  for (const s of carregado.secoes) {
    const comp = compiladas.get(s.id);
    const alvos = paginasDaSecao(s);
    const porPagina = alvos.map((p) => {
      const r = procurarNaPagina(unidadesPorPagina.get(p), comp, avaliacao.get(caminhoDe(p.url)));
      for (const lista of [r.visiveis, r.ocultos, r.dicas]) for (const h of lista) if (!h.pagina) h.pagina = caminhoDe(p.url);
      return r;
    });
    const semAvaliacao = comp.seletores.length > 0 && alvos.some((p) => { const a = avaliacao.get(caminhoDe(p.url)); return !a || a.erro; });
    const d = decidir(s, comp, porPagina, semAvaliacao);
    const inspecionadas = alvos.map((p) => caminhoDe(p.url));
    secoes.push({
      id: s.id, nome: s.nome, obrigatoriedade: s.obrigatoriedade, peso: s.peso, confiancaDaRegra: s.confianca,
      ...(s.pagina ? { pagina: s.pagina } : {}), ...(s.ordem !== undefined ? { ordem: s.ordem } : {}), ...(s.cta ? { cta: s.cta } : {}), ...(s.selo ? { selo: s.selo } : {}),
      detectavelPorScript: s.deteccao.detectavel_por_script, onde: s.deteccao.onde,
      encontrada: d.encontrada, motivo: d.motivo || null, ausenciaConfiavel: d.ausenciaConfiavel,
      ocorrencias: d.ocorrencias, candidatos: d.candidatos, paginasInspecionadas: inspecionadas,
    });
    if (d.encontrada === true) {
      const o = d.ocorrencias[0];
      evidencias.push({ pagina: o.pagina, versao: 'final', seletor: o.seletor, trecho: o.trecho, valor: s.id, contagem: d.ocorrencias.length, visivel: true });
    } else {
      evidencias.push({ pagina: inspecionadas[0] || null, versao: 'final', seletor: null, trecho: `${d.encontrada === false ? 'não encontrada' : 'indeterminada'} em ${inspecionadas.length} página(s): ${inspecionadas.slice(0, 12).join(', ')}`, valor: s.id, contagem: 0, visivel: null });
    }
  }

  const cont = (f) => secoes.filter(f).length;
  const dados = {
    tipoDeSite: tipo,
    arquivoDeRegras: carregado.origem === 'local' ? '(camada local)' : carregado.arquivo,
    origemDasSecoes: carregado.origem || 'publica',
    ...(carregado.meta ? { meta: carregado.meta } : {}),
    paginasInspecionadas: paginas.map((p) => caminhoDe(p.url)),
    paginasNaoLidas: (ctx.paginasComErro || []).map((p) => caminhoDe(p.url)),
    resumo: {
      total: secoes.length,
      encontradas: cont((s) => s.encontrada === true),
      ausentes: cont((s) => s.encontrada === false),
      indeterminadas: cont((s) => s.encontrada === 'indeterminada'),
      essenciaisAusentes: secoes.filter((s) => s.encontrada === false && s.obrigatoriedade === 'essencial').map((s) => s.id),
      pesoTotal: secoes.reduce((a, s) => a + s.peso, 0),
      pesoEncontrado: secoes.filter((s) => s.encontrada === true).reduce((a, s) => a + s.peso, 0),
    },
    secoes,
    avisos,
    nota: '"Ausente" significa "o script não achou nas páginas inspecionadas" (amostra do site), nunca "o site não tem". Seções indeterminadas e de detecção parcial passam pelo julgamento do modelo.',
  };
  return saidaMedidor(id, dados, evidencias, VERSAO);
}
