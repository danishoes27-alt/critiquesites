// VERIFICADOR DE CITAÇÕES: antes de qualquer relatório, confere se cada número, trecho e contagem
// citado por um achado EXISTE no código analisado. Achado com citação falsa é descartado.
//
// Citação: { tipo: 'trecho'|'numero'|'contagem', valor, versoes?: ['cru','dom250','final'] (padrão ['final']),
//            onde?: 'visivel'|'html'|'css'|'js'|'jsonld'|'qualquer' (padrão 'qualquer'), pagina?: url,
//            contagem?: { fn: 'imagens'|'imagens-lazy'|..., seletor?, texto?, esperado: número } }
import { normalizarTexto, extrairNumeros, numerosIguais } from './util.mjs';

const VERSOES = ['cru', 'dom250', 'final'];

// ---------- corpus ----------
function textoVisivel(extr) {
  return (extr?.nos || []).filter((n) => n.visivel && !n.clone).map((n) => n.texto);
}

export function montarCorpus(ctx) {
  const porPagina = new Map();
  const css = [...(ctx.ativos || []).filter((a) => a.tipo === 'css' && a.texto).map((a) => a.texto)];
  const js = [...(ctx.ativos || []).filter((a) => a.tipo === 'js' && a.texto).map((a) => a.texto)];
  for (const p of ctx.paginas) {
    const v = {};
    for (const versao of VERSOES) {
      const bloco = p[versao];
      if (!bloco) continue;
      const extr = bloco.extr;
      const visiveis = textoVisivel(extr);
      v[versao] = {
        extr,
        html: normalizarTexto(bloco.html || ''),
        visivel: visiveis.map((t) => normalizarTexto(t)),
        visivelJunto: normalizarTexto(visiveis.join(' ')),
        todoTexto: normalizarTexto((extr?.nos || []).map((n) => n.texto).join(' ')),
        css: normalizarTexto([...css, ...(extr?.estilosInline || [])].join(' ')),
        js: normalizarTexto([...js, ...(extr?.scripts || []).map((s) => s.inline || '')].join(' ')),
        jsonld: normalizarTexto((extr?.jsonld || []).join(' ')),
      };
    }
    porPagina.set(p.url, v);
    if (p.final?.extr?.url && p.final.extr.url !== p.url) porPagina.set(p.final.extr.url, v);
  }
  return porPagina;
}

function fatias(corpus, citacao) {
  const versoes = citacao.versoes?.length ? citacao.versoes : ['final'];
  const onde = citacao.onde || 'qualquer';
  const paginas = citacao.pagina ? [corpus.get(citacao.pagina)].filter(Boolean) : [...new Set(corpus.values())];
  const saida = [];
  for (const pag of paginas) {
    for (const ver of versoes) {
      const c = pag[ver];
      if (!c) continue;
      if (onde === 'visivel') saida.push(c.visivelJunto);
      else if (onde === 'html') saida.push(c.html);
      else if (onde === 'css') saida.push(c.css);
      else if (onde === 'js') saida.push(c.js);
      else if (onde === 'jsonld') saida.push(c.jsonld);
      else saida.push(c.html, c.todoTexto, c.css, c.js, c.jsonld);
    }
  }
  return saida;
}

// ---------- contagens recomputáveis ----------
export const CONTAGENS = {
  'imagens': (ex) => (ex.imagens || []).length,
  'imagens-lazy': (ex) => (ex.imagens || []).filter((i) => i.loading === 'lazy').length,
  'imagens-sem-lazy': (ex) => (ex.imagens || []).filter((i) => i.loading !== 'lazy').length,
  'imagens-sem-alt': (ex) => (ex.imagens || []).filter((i) => i.alt === null).length,
  'imagens-visiveis': (ex) => (ex.imagens || []).filter((i) => i.visivel && !i.clone).length,
  'links': (ex) => (ex.links || []).length,
  'links-visiveis': (ex) => (ex.links || []).filter((l) => l.visivel && !l.clone).length,
  'links-com-texto': (ex, c) => (ex.links || []).filter((l) => l.visivel && !l.clone && normalizarTexto(l.texto) === normalizarTexto(c.texto)).length,
  'h1-visiveis': (ex) => (ex.headings || []).filter((h) => h.nivel === 1 && h.visivel && !h.clone).length,
  'jsonld-blocos': (ex) => (ex.jsonld || []).length,
  'nos-clone': (ex) => (ex.nos || []).filter((n) => n.clone).length,
  'nos-ocultos': (ex) => (ex.nos || []).filter((n) => !n.visivel).length,
  'ocorrencias-visiveis': (ex, c) => {
    const alvo = normalizarTexto(c.texto);
    if (!alvo) return 0;
    return textoVisivel(ex).reduce((s, t) => s + (normalizarTexto(t).split(alvo).length - 1), 0);
  },
  'seletor': (ex, c) => (ex.nos || []).filter((n) => n.seletor === c.seletor).length,
};

export function registrarContagem(nome, fn) { CONTAGENS[nome] = fn; }

// ---------- verificação ----------
export function verificarCitacao(citacao, corpus) {
  const tipo = citacao.tipo;
  if (tipo === 'trecho') {
    const alvo = normalizarTexto(citacao.valor);
    if (!alvo) return { ok: false, motivo: 'trecho vazio' };
    const alvoOk = fatias(corpus, citacao).some((f) => f.includes(alvo));
    return alvoOk ? { ok: true } : { ok: false, motivo: `trecho não encontrado (${citacao.onde || 'qualquer'}/${(citacao.versoes || ['final']).join(',')}): "${String(citacao.valor).slice(0, 80)}"` };
  }
  if (tipo === 'numero') {
    const alvo = String(citacao.valor);
    const achou = fatias(corpus, citacao).some((f) => extrairNumeros(f).some((n) => numerosIguais(n, alvo)));
    return achou ? { ok: true } : { ok: false, motivo: `número não encontrado (${citacao.onde || 'qualquer'}/${(citacao.versoes || ['final']).join(',')}): ${alvo}` };
  }
  if (tipo === 'contagem') {
    const c = citacao.contagem;
    if (!c || !CONTAGENS[c.fn]) return { ok: false, motivo: `contagem desconhecida: ${c?.fn}` };
    const versoes = citacao.versoes?.length ? citacao.versoes : ['final'];
    const paginas = citacao.pagina ? [corpus.get(citacao.pagina)].filter(Boolean) : [...new Set(corpus.values())];
    if (!paginas.length) return { ok: false, motivo: 'página da citação não encontrada' };
    for (const pag of paginas) {
      for (const ver of versoes) {
        const ex = pag[ver]?.extr;
        if (!ex) return { ok: false, motivo: `versão ${ver} não disponível` };
        const real = CONTAGENS[c.fn](ex, c);
        if (real !== c.esperado) return { ok: false, motivo: `contagem ${c.fn} (${ver}): citado ${c.esperado}, recalculado ${real}` };
      }
    }
    return { ok: true };
  }
  return { ok: false, motivo: `tipo de citação desconhecido: ${tipo}` };
}

// Números escritos na mensagem precisam ter respaldo (citações, evidências ou texto do site).
// (?!,\d): "22.987,16" é um valor com milhar e centavos, NÃO um id de norma como "1.4.3".
const PADRAO_ID_NORMA = /\b\d+(\.\d+){1,3}\b(?!,\d)|\bart\.?\s*\d+|\bartigo\s*\d+|\bwcag\s*\d+(\.\d+)*/gi;
export function numerosSemRespaldo(achado, corpus) {
  const msg = String(achado.mensagem || '').replace(PADRAO_ID_NORMA, ' ');
  const permitidos = new Set((achado.numeros_permitidos || []).map(String));
  const doAchado = [];
  for (const c of achado.citacoes || []) {
    if (c.tipo === 'numero') doAchado.push(c.valor);
    if (c.tipo === 'contagem' && c.contagem) doAchado.push(c.contagem.esperado);
    if (c.tipo === 'trecho') doAchado.push(...extrairNumeros(c.valor));
  }
  for (const e of achado.evidencias || []) { doAchado.push(...extrairNumeros(`${e.valor ?? ''} ${e.trecho ?? ''}`)); if (typeof e.contagem === 'number') doAchado.push(e.contagem); }
  const base = doAchado.flatMap((x) => (typeof x === 'number' ? [x] : extrairNumeros(String(x))));
  const noSite = new Set();
  for (const pag of new Set(corpus.values())) for (const v of VERSOES) if (pag[v]) for (const n of extrairNumeros(pag[v].visivelJunto)) noSite.add(n);
  const sem = [];
  for (const n of extrairNumeros(msg)) {
    if (permitidos.has(String(n))) continue;
    if (n <= 10 && Number.isInteger(n)) continue; // contagens pequenas ("3 links") não são alegação factual de valor
    if (base.some((b) => numerosIguais(b, n))) continue;
    if ([...noSite].some((s) => numerosIguais(s, n))) continue;
    sem.push(n);
  }
  return sem;
}

export function verificarAchados(achados, ctx, { estritoNumeros = true } = {}) {
  const corpus = montarCorpus(ctx);
  const aprovados = [];
  const descartados = [];
  for (const a of achados) {
    const citacoes = a.citacoes || [];
    const falhas = [];
    for (const c of citacoes) { const r = verificarCitacao(c, corpus); if (!r.ok) falhas.push({ citacao: c, motivo: r.motivo }); }
    let motivo = null;
    if (falhas.length) motivo = falhas[0].motivo;
    else if (a.selo === 'fato' && citacoes.length === 0) motivo = 'selo "fato" sem nenhuma citação verificável';
    else if (a.selo === 'opiniao' && !citacoes.some((c) => c.tipo === 'trecho')) motivo = 'opinião sem citar ao menos um trecho que exista no site';
    if (!motivo && estritoNumeros && (a.selo === 'fato' || a.selo === 'opiniao')) {
      const sem = numerosSemRespaldo(a, corpus);
      if (sem.length) motivo = `número(s) na mensagem sem respaldo no código: ${sem.join(', ')}`;
    }
    if (motivo) descartados.push({ id: a.id, regra_id: a.regra_id, selo: a.selo, motivo, falhas });
    else aprovados.push({ ...a, verificado: true });
  }
  return { aprovados, descartados, resumo: { total: achados.length, aprovados: aprovados.length, descartados: descartados.length } };
}
