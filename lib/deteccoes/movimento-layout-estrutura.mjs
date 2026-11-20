// DETECTORES de movimento (regras/visual-movimento.json), layout e espaçamento (regras/layout-espacamento.json)
// e estrutura padrão (regras/estrutura-padrao.json). Contrato em lib/motor.mjs.
//
// Princípios (SPEC): o script mede, o modelo julga. Cada detector só olha o que os medidores entregaram (e, quando o
// medidor não expõe o dado, o texto do próprio código do site em ctx: CSS estático, HTML final, JS) e NUNCA opina além
// disso. Toda mensagem é só fato medido, sem números soltos: números calculados entram em `numeros_permitidos` e em
// evidências; trechos citados são conferidos AQUI com o próprio verificador antes de entrarem no achado.
// Nunca afirmar autoria: o vocabulário é "padrão", "repetido", "genérico".
//
// Convenções:
//  - agregação entre páginas: disparou = alguma página disparou; intensidade = a maior entre as páginas.
//  - `intensidade` segue a fórmula da regra quando ela traz uma; senão é proporcional ao sinal (comentado em cada caso).
//  - detector que devolve `null` = "não avaliável com os dados que existem hoje" (nunca "ok"); a lista dos que sempre
//    devolvem null, com o motivo, está em NAO_AVALIAVEIS (faltam retângulos por elemento no extrator, entre outros).
import postcss from 'postcss';
import { normalizarTexto, extrairNumeros } from '../util.mjs';
import { montarCorpus, verificarCitacao } from '../verificador.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// LIMIARES: os que a regra cita vêm marcados "regra"; os demais são "limiar inicial, a calibrar".
// ---------------------------------------------------------------------------------------------------------------------
export const LIMIARES = {
  movimento: {
    entradaMinElementos: 4, // regra (mov-mesma-entrada-em-tudo)
    entradaElementosParaMax: 12, // regra: intensidade = min(1, elementos / 12)
    coreografiasMaxPadroes: 2, // regra: dispara com mais de 2
    coreografiasPadroesParaMax: 4, // regra: (padrões - 2) / 4
    transicaoAllOcorrenciasParaMax: 5, // regra: min(1, ocorrências / 5)
    propriedadesLayoutParaMax: 5, // regra: min(1, ocorrências / 5)
    quiqueUsosParaMax: 3, // limiar inicial, a calibrar
    hoverMinSeletoresIguais: 3, // regra
    hoverSeletoresParaMax: 6, // limiar inicial, a calibrar
    hoverSoImagemIntensidade: 0.5, // limiar inicial, a calibrar
    loopOcorrenciasParaMax: 3, // limiar inicial, a calibrar
    automaticoCandidatosParaMax: 3, // limiar inicial, a calibrar
    parallaxOcorrenciasParaMax: 3, // limiar inicial, a calibrar
    duracaoEstadoMaxMs: 500, // regra
    duracaoEntradaMaxMs: 800, // regra
    duracaoItensParaMax: 4, // limiar inicial, a calibrar
    cascataMaxItens: 6, // regra
    cascataAtrasoTotalMaxMs: 360, // regra
    cascataItensParaMax: 12, // limiar inicial, a calibrar
    cascataAtrasoParaMaxMs: 1080, // limiar inicial, a calibrar (3x o limite da regra)
    cascataIntensidadeMinima: 0.25, // limiar inicial, a calibrar
    semJsPalavrasMin: 5, // regra
    semJsFracaoParaMax: 0.25, // limiar inicial, a calibrar: 1/4 do texto invisível sem JS = intensidade máxima
    videoPrimeiraDobraSecoes: 2, // limiar inicial: "perto do topo" = antes da 2ª seção ou h2 do HTML (proxy da dobra)
    gifLarguraMinPx: 200, // regra
    gifPesoMinKb: 100, // regra
    gifQuantidadeParaMax: 3, // limiar inicial, a calibrar
  },
  layout: {
    paddingFracaoMin: 0.7, // regra
    paddingValoresDistintosMin: 4, // regra
    paddingMinCartoes: 3, // limiar inicial, a calibrar
    escalaBasePx: 4, // regra
    escalaValoresIgnoradosPx: [0, 1, 2], // regra
    escalaMaxForaDaEscala: 3, // regra
    respiroLimitePx: 120, // regra (fundos iguais)
    respiroLimiteFundoMudaPx: 64, // regra (fundo muda); usado como limite único porque o fundo por seção não é medido
    respiroFracaoMin: 0.5, // regra
    respiroMinPares: 2, // limiar inicial, a calibrar
    textoEspremidoMinCaracteres: 16, // regra
    paredeJanelaAlturaPx: 900, // regra
    paredePalavrasAviso: 80, // regra
    paredePalavrasAlto: 95, // regra
    paredeBlocosAntesDaAcaoMax: 2, // regra
    paredeBlocosParaMax: 3, // limiar inicial: blocos além do máximo que levam à intensidade 1
    stickyMinElementos: 2, // regra
    assimetriaRazaoMax: 2.5, // regra
    assimetriaMinSecoes: 2, // regra
  },
  estrutura: {
    cartoesMinIrmaos: 3, // regra
    cartoesMinGrades: 2, // regra
    cartoesGradesParaMax: 4, // regra: min(1, (grades - 1) / 3)
    cartoesMaxPalavrasDoParagrafo: 25, // regra
    heroTresLarguraTolerancia: 0.1, // regra: larguras com diferença de até 10 %
    heroTresMaxSecoesDepois: 2, // regra: grade na 1ª ou 2ª seção depois da abertura
    centralizarFracaoMin: 0.6, // regra
    centralizarFracaoAlternativa: 0.5, // regra ("sites ao vivo"); exposta para calibração, não usada no disparo
    centralizarBlocosMin: 4, // limiar inicial: amostra mínima de blocos
    ritmoMinSecoes: 3, // regra
    esqueletoMaxSecoes: 5, // regra
    esqueletoMaxPalavrasDaChamada: 30, // limiar inicial, a calibrar
    metricasMinIrmaos: 3, // regra
    metricasParesParaMax: 4, // limiar inicial, a calibrar
    metricasMaxPalavrasDaLegenda: 6, // limiar inicial, a calibrar
    dobraPx: 900, // regra (1440x900)
    numeracaoMinSecoes: 3, // regra
    numeracaoSecoesParaMax: 5, // limiar inicial, a calibrar
    rotuloMaxPalavras: 6, // regra
    rotuloMinSecoes: 3, // regra
    rotuloSecoesParaMax: 6, // limiar inicial, a calibrar
    ilustracaoSvgMinPx: 120, // regra
    ilustracaoSvgMinCurvas: 3, // regra
    ilustracaoSvgMinPreenchimentos: 3, // regra
    botoesAberturaMin: 3, // regra
    botoesAberturaParaMax: 5, // limiar inicial, a calibrar
  },
};
const LM = LIMIARES.movimento;
const LL = LIMIARES.layout;
const LE = LIMIARES.estrutura;

// Detectores que sempre devolvem null hoje: o dado necessário não existe em nenhum medidor/extrator.
export const NAO_AVALIAVEIS = {
  'lay-irmaos-com-espacamento-diferente': 'precisa do padding e da distância entre irmãos elemento a elemento (retângulos); o extrator só agrega estilos',
  'lay-titulo-colado-no-bloco-anterior': 'precisa de getBoundingClientRect de títulos e dos blocos vizinhos; não é medido',
  'lay-vao-sob-o-hero': 'precisa do retângulo do último conteúdo da abertura; o extrator só guarda altura e topo do bloco',
  'lay-caixa-apertada': 'precisa da distância texto-borda dentro de cada caixa; só há o padding agregado dos cartões (caixa com imagem e padding 0 daria falso alarme)',
  'lay-texto-coberto': 'precisa de elementFromPoint em 3 pontos de cada linha de texto, no navegador',
  'lay-conteudo-estoura-caixa': 'precisa de scrollWidth/clientWidth e da borda direita dos filhos por elemento; só existe o estouro horizontal da página',
  'lay-alinhamento-esquerda-solto': 'precisa da coordenada x esquerda de títulos e blocos; não é medida',
  'estr-visual-vazio-no-lugar-de-imagem': 'precisa do tamanho (300x200) de cada caixa com fundo; os gradientes agregados não trazem dimensões',
};
const semDados = () => null;

// ---------------------------------------------------------------------------------------------------------------------
// utilidades gerais
// ---------------------------------------------------------------------------------------------------------------------
const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const arred = (x, c = 3) => Math.round(x * 10 ** c) / 10 ** c;
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const nPalavras = (s) => (String(s || '').match(/\S+/g) || []).length;
const unico = (arr) => [...new Set(arr)];
const soma = (arr) => arr.reduce((a, b) => a + b, 0);
const lista = (arr, max = 4) => (arr.length > max ? `${arr.slice(0, max).join(', ')} e mais ${arr.length - max}` : arr.join(', '));
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, um, varios) => (n === 1 ? um : varios);

function dividirTopo(s, sep) { // separa por vírgula ou espaço fora de parênteses
  const partes = [];
  let nivel = 0;
  let atual = '';
  for (const ch of String(s)) {
    if (ch === '(') nivel++; else if (ch === ')') nivel = Math.max(0, nivel - 1);
    const corta = nivel === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep);
    if (corta) { if (atual.trim()) partes.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}
const paraMs = (t) => (/ms$/i.test(t) ? parseFloat(t) : parseFloat(t) * 1000);
const ehTempo = (t) => /^-?[\d.]+m?s$/i.test(t);

// ---------------------------------------------------------------------------------------------------------------------
// citações verificáveis: toda citação é conferida aqui com o próprio verificador antes de entrar no achado
// ---------------------------------------------------------------------------------------------------------------------
const _corpus = new WeakMap();
function corpusDe(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  let c = _corpus.get(ctx);
  if (c === undefined) { try { c = montarCorpus(ctx); } catch { c = null; } _corpus.set(ctx, c); }
  return c;
}
export function citacaoPassa(ctx, c) {
  const corpus = corpusDe(ctx);
  return !!corpus && verificarCitacao(c, corpus).ok;
}
const tr = (valor, onde) => ({ tipo: 'trecho', valor: String(valor).replace(/\s+/g, ' ').trim().slice(0, 160), onde, versoes: ['final'] });
const trHtml = (v) => tr(v, 'html');
const trCss = (v) => tr(v, 'css');
const trVis = (v) => tr(v, 'visivel');
const trJs = (v) => tr(v, 'js');

const pagDe = (ctx, url) => (ctx?.paginas || []).find((p) => p.url === url) || null;
const extrDe = (ctx, url) => pagDe(ctx, url)?.final?.extr || null;

function ancora(ctx, url) {
  const ex = extrDe(ctx, url);
  const h = (ex?.headings || []).find((x) => x.visivel && !x.clone && x.texto);
  const n = (ex?.nos || []).find((x) => x.visivel && !x.clone && x.texto);
  const t = h?.texto || n?.texto;
  return t ? trVis(t.slice(0, 60)) : null;
}
// Cada grupo é uma lista de alternativas; entra a primeira que o verificador aprova. Em regra de selo "opiniao" o
// verificador exige ao menos um trecho: se nenhum grupo servir, cai na âncora (título visível da página).
function citar(ctx, url, regra, ...grupos) {
  const out = [];
  for (const g of grupos) {
    const alternativas = (Array.isArray(g) ? g : [g]).filter(Boolean);
    const ok = alternativas.find((c) => citacaoPassa(ctx, c));
    if (ok && !out.some((o) => o.valor === ok.valor && o.onde === ok.onde)) out.push(ok);
  }
  if (!out.some((c) => c.tipo === 'trecho') && regra?.selo === 'opiniao') {
    const a = ancora(ctx, url);
    if (a && citacaoPassa(ctx, a)) out.push(a);
  }
  return out;
}

const ev = (pagina, o) => {
  const e = { pagina, versao: 'final', ...o };
  for (const k of Object.keys(e)) if (e[k] === null || e[k] === undefined) delete e[k];
  if (typeof e.trecho === 'string') e.trecho = e.trecho.replace(/\s+/g, ' ').trim().slice(0, 200);
  return e;
};
const PADRAO_ID_NORMA = /\b\d+(\.\d+){1,3}\b|\bart\.?\s*\d+|\bartigo\s*\d+|\bwcag\s*\d+(\.\d+)*/gi; // mesma limpeza do verificador
function achado({ pagina, mensagem, evidencias = [], citacoes = [], instavel = false }) {
  return {
    pagina, mensagem, evidencias, citacoes,
    // números da mensagem vêm de medições (estilo computado, razões, contagens); o verificador os confere por esta lista
    numeros_permitidos: unico([...extrairNumeros(mensagem), ...extrairNumeros(mensagem.replace(PADRAO_ID_NORMA, ' '))].map(String)),
    ...(instavel ? { instavel: true } : {}),
  };
}
const resultado = (disparou, intensidade = 1, achados = []) => ({ disparou: !!disparou, intensidade: disparou ? clamp01(intensidade) : 0, achados: disparou ? achados : [] });

// ---------------------------------------------------------------------------------------------------------------------
// acesso aos medidores e iteração por página
// ---------------------------------------------------------------------------------------------------------------------
function dadosCss(med) {
  const m = med?.css;
  if (!m || m.erro || !m.dados || !Array.isArray(m.dados.paginas)) return null;
  return m.dados;
}
function paginasCss(med) {
  const d = dadosCss(med);
  if (!d) return null;
  const comEstilos = d.paginas.filter((p) => p.computado);
  return comEstilos.length ? { paginas: comEstilos, site: d.site, todas: d.paginas } : null;
}
const estaticoDe = (med) => dadosCss(med)?.site?.estatico || null;

function agregar(rs) {
  const avaliados = rs.filter((r) => r !== null && r !== undefined);
  if (!avaliados.length) return null;
  const disparados = avaliados.filter((r) => r.disparou);
  return resultado(disparados.length > 0, disparados.length ? Math.max(...disparados.map((r) => r.intensidade ?? 1)) : 0, disparados.flatMap((r) => r.achados));
}

// Itera as páginas lidas (ctx.paginas) com o extrator final; `exigeCss` = só as que têm estilos computados.
function porPagina(avaliar, { exigeCss = false } = {}) {
  return ({ ctx, med, regra }) => {
    const css = paginasCss(med);
    if (exigeCss && !css) return null;
    const mapa = new Map((css?.paginas || []).map((p) => [p.url, p]));
    const rs = [];
    for (const pag of ctx?.paginas || []) {
      if (!pag.final?.extr) continue;
      const es = mapa.get(pag.url)?.computado || null;
      if (exigeCss && !es) continue;
      rs.push(avaliar({ ctx, med, regra, pag, url: pag.url, caminho: caminhoDe(pag.url), extr: pag.final.extr, es, site: css?.site || dadosCss(med)?.site || null }));
    }
    return agregar(rs);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// CSS estático (postcss) a partir do texto do próprio site: ctx.ativos (folhas) + <style> inline
// ---------------------------------------------------------------------------------------------------------------------
const _css = new WeakMap();
export function cssDoSite(ctx) {
  if (!ctx || typeof ctx !== 'object') return { regras: [], decls: [], texto: '' };
  let r = _css.get(ctx);
  if (r) return r;
  r = { regras: [], decls: [], texto: '' };
  const vistos = new Set();
  const textos = [];
  for (const a of ctx?.ativos || []) {
    if (a.tipo !== 'css' || a.texto == null) continue;
    const k = a.hash || a.texto;
    if (vistos.has(k)) continue;
    vistos.add(k); textos.push(a.texto);
  }
  for (const p of ctx?.paginas || []) {
    for (const t of p.final?.extr?.estilosInline || []) {
      if (!t || !t.trim() || vistos.has(t)) continue;
      vistos.add(t); textos.push(t);
    }
  }
  r.texto = textos.join('\n');
  for (const texto of textos) {
    let root;
    try { root = postcss.parse(texto); } catch { continue; }
    root.walkRules((rule) => {
      const pai = rule.parent;
      const keyframes = pai && pai.type === 'atrule' && /keyframes$/i.test(pai.name) ? pai.params.trim() : null;
      let media = null;
      for (let n = pai; n && n.type !== 'root'; n = n.parent) if (n.type === 'atrule' && /^(media|supports|container)$/i.test(n.name)) media = `@${n.name} ${n.params}`;
      const decls = [];
      rule.each((n) => {
        if (n.type !== 'decl') return;
        const d = { prop: n.prop.toLowerCase(), valor: n.value.trim(), important: !!n.important, texto: normalizarTexto(n.toString()), seletor: rule.selector.replace(/\s+/g, ' ').trim(), media, keyframes };
        decls.push(d);
        r.decls.push(d);
      });
      r.regras.push({ seletor: rule.selector.replace(/\s+/g, ' ').trim(), seletores: (rule.selectors || [rule.selector]).map((s) => s.replace(/\s+/g, ' ').trim()), decls, media, keyframes });
    });
  }
  _css.set(ctx, r);
  return r;
}

// transition: "opacity .3s ease 0.1s, transform .5s" -> [{prop, duracaoMs, atrasoMs}]
function itensDeTransicao(valor) {
  return dividirTopo(valor, ',').map((item) => {
    const toks = dividirTopo(item, ' ');
    const tempos = toks.filter(ehTempo);
    const prop = toks.find((t) => !ehTempo(t) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal)$/i.test(t) && !/^(cubic-bezier|steps|linear)\(/i.test(t)) || 'all';
    return { prop: prop.toLowerCase(), duracaoMs: tempos[0] !== undefined ? paraMs(tempos[0]) : 0, atrasoMs: tempos[1] !== undefined ? paraMs(tempos[1]) : 0 };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML final: tags e atributos (tokenizador simples; scripts, estilos e comentários são anulados mantendo as posições)
// ---------------------------------------------------------------------------------------------------------------------
function htmlLimpo(pag) {
  const html = pag?.final?.html || '';
  return html
    .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, (m) => ' '.repeat(m.length))
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, (m) => ' '.repeat(m.length));
}
function parseAttrs(s) {
  const a = {};
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}
const _tags = new WeakMap();
function tagsDe(pag) {
  const chave = pag?.final;
  if (!chave) return [];
  let r = _tags.get(chave);
  if (r) return r;
  r = [];
  const html = htmlLimpo(pag);
  const re = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) && r.length < 60000) r.push({ tag: m[1].toLowerCase(), attrs: parseAttrs(m[2]), raw: m[0], indice: m.index });
  _tags.set(chave, r);
  return r;
}
const classesDe = (t) => String(t.attrs.class || '').split(/\s+/).filter(Boolean);
const tagsComClasse = (pag, re) => tagsDe(pag).filter((t) => classesDe(t).some((c) => re.test(c)));
const tagsComAtributo = (pag, nome) => tagsDe(pag).filter((t) => nome in t.attrs);

const RE_CLASSE_BOTAO = /(^|[\s_-])(btn|button|cta|botao|botão)([\s_-]|$)/i;
const _acoes = new WeakMap();
// Seletores (do extrator) de ações visíveis: <button> e links com aparência de botão (classe btn/button/cta ou role=button).
function acoesDe(pag) {
  const chave = pag?.final;
  if (!chave) return new Set();
  let r = _acoes.get(chave);
  if (r) return r;
  const html = htmlLimpo(pag);
  const extr = pag.final.extr || {};
  const chaves = new Set();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const at = parseAttrs(m[1]);
    if (RE_CLASSE_BOTAO.test(at.class || '') || /^button$/i.test(at.role || '')) chaves.add(`${at.href ?? ''}|${normalizarTexto(m[2].replace(/<[^>]*>/g, ''))}`);
  }
  r = new Set();
  for (const l of extr.links || []) if (l.visivel && !l.clone && chaves.has(`${l.hrefAttr ?? ''}|${normalizarTexto(l.texto)}`)) r.add(l.seletor);
  for (const n of extr.nos || []) if (n.visivel && !n.clone && n.tag === 'button') r.add(n.seletor);
  _acoes.set(chave, r);
  return r;
}

// JS do site (próprio baixado + scripts inline) e URLs de scripts, em minúsculas
const _js = new WeakMap();
function jsDoSite(ctx) {
  if (!ctx || typeof ctx !== 'object') return { tudo: '', proprios: '', srcs: [] };
  let r = _js.get(ctx);
  if (r) return r;
  const partes = [];
  const proprios = [];
  for (const a of ctx?.ativos || []) if (a.tipo === 'js' && a.texto) { partes.push(a.texto); if (!a.terceiro) proprios.push(a.texto); }
  const srcs = [];
  for (const p of ctx?.paginas || []) {
    for (const s of p.final?.extr?.scripts || []) {
      if (s.inline) { partes.push(s.inline); proprios.push(s.inline); }
      if (s.src) srcs.push(s.src);
    }
  }
  r = { tudo: partes.join('\n').slice(0, 4_000_000), proprios: proprios.join('\n').slice(0, 4_000_000), srcs };
  _js.set(ctx, r);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// árvore de nós de texto (a partir dos seletores do extrator): estrutura de irmãos sem precisar do DOM no Node
// ---------------------------------------------------------------------------------------------------------------------
const tagDeSeg = (seg) => (!seg || seg[0] === '#' ? null : seg.replace(/:nth-of-type\(\d+\)$/, ''));
function novoNo(seg, pai, caminho) {
  return { seg, tag: tagDeSeg(seg), pai, caminho, filhos: new Map(), textos: [], imgs: 0, primeira: Infinity, ultima: -1 };
}
const _arv = new WeakMap();
function arvoreDe(extr) {
  let r = _arv.get(extr);
  if (r) return r;
  const raiz = novoNo('', null, '');
  const descer = (seletor) => {
    let n = raiz;
    for (const seg of String(seletor).split('>')) {
      let f = n.filhos.get(seg);
      if (!f) { f = novoNo(seg, n, n.caminho ? `${n.caminho}>${seg}` : seg); n.filhos.set(seg, f); }
      n = f;
    }
    return n;
  };
  (extr.nos || []).forEach((no, i) => {
    if (!no.visivel || no.clone || !no.texto || !no.seletor) return;
    const n = descer(no.seletor);
    n.textos.push({ tag: no.tag, texto: no.texto, i });
    for (let a = n; a && a !== raiz; a = a.pai) { a.primeira = Math.min(a.primeira, i); a.ultima = Math.max(a.ultima, i); }
  });
  for (const im of extr.imagens || []) {
    if (!im.visivel || im.clone || !im.seletor) continue;
    descer(im.seletor).imgs++;
  }
  r = { raiz, achar: (seletor) => { let n = raiz; for (const seg of String(seletor).split('>')) { n = n.filhos.get(seg); if (!n) return null; } return n; } };
  _arv.set(extr, r);
  return r;
}
const filhosElemento = (n) => [...n.filhos.values()].filter((f) => f.tag);
// assinatura estrutural de um filho: tags dos descendentes diretos que têm texto ou imagem, em ordem
function assinaturaDe(n) {
  const toks = [];
  for (const f of n.filhos.values()) {
    if (f.textos.length) toks.push(f.tag || 'x');
    else if (f.imgs) toks.push('img');
  }
  return toks;
}
const ehHeading = (t) => /^h[1-6]$/.test(t);
function ehAssinaturaDeCartao(toks, n) {
  if (!toks.some(ehHeading) || !toks.some((t) => /^(p|span|div|li)$/.test(t))) return false;
  const p = [...n.filhos.values()].find((f) => f.tag === 'p' && f.textos.length);
  return !p || nPalavras(p.textos.map((x) => x.texto).join(' ')) <= LE.cartoesMaxPalavrasDoParagrafo;
}
// Grades/listas com >= 3 irmãos de mesma assinatura (título + parágrafo curto, com ou sem imagem)
function gradesDeCartoes(extr) {
  const arv = arvoreDe(extr);
  const out = [];
  const visitar = (n) => {
    const kids = filhosElemento(n);
    const porTag = new Map();
    for (const k of kids) { if (!porTag.has(k.tag)) porTag.set(k.tag, []); porTag.get(k.tag).push(k); }
    let melhor = null;
    for (const [tag, g] of porTag) {
      if (g.length < LE.cartoesMinIrmaos) continue;
      const porAss = new Map();
      for (const k of g) { const toks = assinaturaDe(k); if (!ehAssinaturaDeCartao(toks, k)) continue; const a = toks.join(','); if (!porAss.has(a)) porAss.set(a, []); porAss.get(a).push(k); }
      for (const [ass, ks] of porAss) if (ks.length >= LE.cartoesMinIrmaos && (!melhor || ks.length > melhor.n)) melhor = { seletor: n.caminho, tag, n: ks.length, assinatura: ass, filhos: ks, primeira: Math.min(...ks.map((k) => k.primeira)) };
    }
    if (melhor) out.push(melhor);
    for (const k of n.filhos.values()) visitar(k);
  };
  visitar(arv.raiz);
  return out;
}
const textoSob = (extr, seletor, max = 60) => {
  const n = (extr?.nos || []).find((x) => x.visivel && !x.clone && x.texto && (x.seletor === seletor || x.seletor.startsWith(`${seletor}>`)));
  return n ? n.texto.slice(0, max) : null;
};
const nosSob = (extr, seletor) => (extr?.nos || []).filter((x) => x.visivel && !x.clone && x.texto && (x.seletor === seletor || x.seletor.startsWith(`${seletor}>`)));
const textoDoNo = (n, max = 60) => (n.textos[0]?.texto || '').slice(0, max);

// ---------------------------------------------------------------------------------------------------------------------
// ajudas sobre os estilos computados (final.estilos)
// ---------------------------------------------------------------------------------------------------------------------
const animacoesDe = (es) => es?.movimento?.animacoes?.porNome || [];
const heroDe = (es) => es?.layout?.heroes?.[0] || null;
const itensSecao = (es) => es?.secoes?.itens || [];
const RE_NOME_ENTRADA = /(fade|slide|reveal|enter|entrar|entrada|appear|aparec|zoom|rise|in-?up|in-?down|in-?left|in-?right)/i;
// entradas ao rolar: animação que roda uma vez e começa invisível ou desloca (ehEntrada); sem keyframes legíveis, vale o nome
const animacoesDeEntrada = (es) => animacoesDe(es).filter((a) => a.iteracoes !== 'infinite' && (a.ehEntrada === true || (a.ehEntrada === null && RE_NOME_ENTRADA.test(a.nome))));

function marcadoresDeEntrada(pag) {
  const aos = tagsComAtributo(pag, 'data-aos');
  const wow = tagsComClasse(pag, /^wow$/i);
  const ac = tagsComClasse(pag, /^animate__animated$/i);
  const efeitos = new Set();
  for (const t of tagsDe(pag)) for (const c of classesDe(t)) if (/^animate__[a-z]/i.test(c) && !/^animate__(animated|infinite|delay|slow|slower|fast|faster|repeat)/i.test(c)) efeitos.add(c);
  return { dataAos: { n: aos.length, valores: new Set(aos.map((t) => t.attrs['data-aos']).filter(Boolean)) }, wow: { n: wow.length }, animateCss: { n: ac.length, efeitos } };
}

// índice da seção (em es.secoes.itens) que contém o seletor; escolhe o item mais profundo
function idxSecao(es, seletor) {
  let melhor = -1;
  itensSecao(es).forEach((it, i) => {
    if (seletor === it.seletor || String(seletor).startsWith(`${it.seletor}>`)) { if (melhor < 0 || it.seletor.length >= itensSecao(es)[melhor].seletor.length) melhor = i; }
  });
  return melhor;
}

// ---------------------------------------------------------------------------------------------------------------------
// MOVIMENTO
// ---------------------------------------------------------------------------------------------------------------------
const RE_PROP_LAYOUT = /^(width|height|top|left|right|bottom|margin|margin-(top|right|bottom|left|inline|block)(-(start|end))?|padding|padding-(top|right|bottom|left|inline|block)(-(start|end))?)$/i;
const RE_QUIQUE = /(bounce|elastic|spring|overshoot)/i;
const RE_ANIM_EXCLUIDA = /(spin|spinner|load|loader|loading|skeleton|shimmer|progress|live|ao-?vivo|buffering)/i;
const RE_ESTADO = /:(hover|focus|active|focus-visible|focus-within)/i;

const detMesmaEntrada = porPagina(({ ctx, regra, pag, url, caminho, es }) => {
  const entradas = animacoesDeEntrada(es);
  const mk = marcadoresDeEntrada(pag);
  const cands = [];
  if (entradas[0]) cands.push({ origem: `animation-name "${entradas[0].nome}"`, n: entradas[0].elementos, nome: entradas[0].nome });
  if (mk.dataAos.n) cands.push({ origem: 'atributo data-aos', n: mk.dataAos.n, marcador: 'data-aos' });
  if (mk.wow.n) cands.push({ origem: 'classe wow', n: mk.wow.n, marcador: 'wow' });
  if (mk.animateCss.n) cands.push({ origem: 'classes animate__', n: mk.animateCss.n, marcador: 'animate__animated' });
  const melhor = cands.sort((a, b) => b.n - a.n)[0];
  const n = melhor?.n || 0;
  if (n < LM.entradaMinElementos) return resultado(false);
  const mensagem = `A mesma animação de entrada aparece em ${n} elementos visíveis (${melhor.origem}).`;
  return resultado(true, n / LM.entradaElementosParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: melhor.origem, valor: n, contagem: n })],
    citacoes: citar(ctx, url, regra, [melhor.nome && trCss(`@keyframes ${melhor.nome}`), melhor.nome && trCss(melhor.nome), melhor.marcador && trHtml(melhor.marcador)]),
  })]);
}, { exigeCss: true });

const detCoreografias = porPagina(({ ctx, regra, pag, url, caminho, es }) => {
  const mk = marcadoresDeEntrada(pag);
  const padroes = new Map();
  for (const a of animacoesDeEntrada(es)) padroes.set(`anim:${a.nome}`, { rotulo: `animation-name "${a.nome}"`, nome: a.nome });
  for (const v of mk.dataAos.valores) padroes.set(`aos:${v}`, { rotulo: `data-aos "${v}"`, marcador: `data-aos="${v}"` });
  for (const v of mk.animateCss.efeitos) padroes.set(`ac:${v}`, { rotulo: `classe ${v}`, marcador: v });
  const n = padroes.size;
  if (n <= LM.coreografiasMaxPadroes) return resultado(false);
  const itens = [...padroes.values()];
  const mensagem = `Há ${n} padrões diferentes de entrada ao rolar (${lista(itens.map((i) => i.rotulo))}); o limite aceito é ${LM.coreografiasMaxPadroes}.`;
  return resultado(true, (n - LM.coreografiasMaxPadroes) / LM.coreografiasPadroesParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: itens.slice(0, 6).map((i) => ev(caminho, { trecho: i.rotulo, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...itens.slice(0, 3).map((i) => [i.nome && trCss(`@keyframes ${i.nome}`), i.nome && trCss(i.nome), i.marcador && trHtml(i.marcador)])),
  })]);
}, { exigeCss: true });

function detTransicaoEmTudo({ ctx, med, regra }) {
  const est = estaticoDe(med);
  const css = dadosCss(med);
  if (!est || !css) return null;
  let classes = 0;
  for (const p of ctx?.paginas || []) classes = Math.max(classes, tagsComClasse(p, /(^|:)transition-all$/).length);
  const computadas = Math.max(0, ...(css.paginas || []).map((p) => p.computado?.movimento?.transicoes?.all || 0));
  const estaticas = est.movimento?.transicaoAll || 0;
  const ocorrencias = estaticas + classes > 0 ? estaticas + classes : computadas;
  if (ocorrencias < 1) return resultado(false);
  const url = css.paginas[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const decls = cssDoSite(ctx).decls.filter((d) => /^transition(-property)?$/.test(d.prop) && !d.keyframes && (d.prop === 'transition' ? itensDeTransicao(d.valor).some((i) => i.prop === 'all') : /(^|,)\s*all\s*(,|$)/i.test(d.valor)));
  const mensagem = `Há ${ocorrencias} ${plural(ocorrencias, 'ocorrência', 'ocorrências')} de transição aplicada a todas as propriedades de uma vez (transition: all${classes ? ' ou classe transition-all' : ''}).`;
  return resultado(true, ocorrencias / LM.transicaoAllOcorrenciasParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: [...decls.slice(0, 3).map((d) => ev(caminho, { seletor: d.seletor, trecho: d.texto, valor: 'all', contagem: 1 })), ev(caminho, { trecho: 'transition: all', valor: ocorrencias, contagem: ocorrencias })],
    citacoes: citar(ctx, url, regra, ...decls.slice(0, 3).map((d) => trCss(d.texto)), classes ? trHtml('transition-all') : null),
  })]);
}

function detAnimarLayout({ ctx, med, regra }) {
  const est = estaticoDe(med);
  const css = paginasCss(med) || null;
  if (!est) return null;
  const props = est.movimento?.propriedadesTransicao || {};
  let transicoes = soma(Object.entries(props).filter(([p]) => RE_PROP_LAYOUT.test(p)).map(([, n]) => n));
  const nomesComLayout = unico((css?.paginas || []).flatMap((p) => animacoesDe(p.computado).filter((a) => Array.isArray(a.anima) && a.anima.some((x) => RE_PROP_LAYOUT.test(x))).map((a) => a.nome)));
  if (!transicoes && !nomesComLayout.length && css) transicoes = Math.max(0, ...css.paginas.map((p) => soma(Object.entries(p.computado?.movimento?.transicoes?.propriedades || {}).filter(([k]) => RE_PROP_LAYOUT.test(k)).map(([, n]) => n))));
  const ocorrencias = transicoes + nomesComLayout.length;
  if (ocorrencias < 1) return resultado(false);
  const url = css?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const decls = cssDoSite(ctx).decls.filter((d) => {
    if (d.keyframes) return nomesComLayout.includes(d.keyframes) && RE_PROP_LAYOUT.test(d.prop);
    if (d.prop === 'transition') return itensDeTransicao(d.valor).some((i) => RE_PROP_LAYOUT.test(i.prop));
    if (d.prop === 'transition-property') return dividirTopo(d.valor, ',').some((i) => RE_PROP_LAYOUT.test(i));
    return false;
  });
  const alvos = unico([...Object.keys(props).filter((p) => RE_PROP_LAYOUT.test(p)), ...(css?.paginas || []).flatMap((p) => animacoesDe(p.computado).flatMap((a) => (a.anima || []).filter((x) => RE_PROP_LAYOUT.test(x))))]);
  const mensagem = `Há ${ocorrencias} ${plural(ocorrencias, 'transição ou animação', 'transições ou animações')} de propriedades de layout (${lista(alvos.length ? alvos : ['largura, altura ou posição'])}) em vez de transformações.`;
  return resultado(true, ocorrencias / LM.propriedadesLayoutParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: [...decls.slice(0, 3).map((d) => ev(caminho, { seletor: d.seletor, trecho: d.texto, valor: d.prop, contagem: 1 })), ev(caminho, { trecho: 'propriedades de layout animadas', valor: ocorrencias, contagem: ocorrencias })],
    citacoes: citar(ctx, url, regra, ...decls.slice(0, 3).map((d) => trCss(d.texto))),
  })]);
}

function detSemReducedMotion({ ctx, med, regra }) {
  const est = estaticoDe(med);
  if (!est) return null;
  const css = paginasCss(med);
  const mov = est.movimento || {};
  const keyframes = (mov.keyframes || []).length;
  const animEst = mov.animacoes || 0;
  const trTransform = mov.propriedadesTransicao?.transform || 0;
  const animComp = css ? Math.max(0, ...css.paginas.map((p) => animacoesDe(p.computado).length)) : 0;
  const gatilhos = keyframes + animEst + trTransform;
  const temCssEstatico = (est.arquivos?.css || 0) + (est.arquivos?.inline || 0) > 0;
  if (!gatilhos && !animComp) return resultado(false);
  if (!gatilhos && !temCssEstatico) return null; // há animação computada, mas o CSS não foi lido: não dá para saber se há proteção
  const js = jsDoSite(ctx).tudo;
  const classeTailwind = (ctx?.paginas || []).some((p) => tagsComClasse(p, /^motion-(reduce|safe):/).length > 0);
  const protecao = (est.mediaQueries?.prefersReducedMotion || 0) > 0 || /prefers-reduced-motion/i.test(js) || classeTailwind;
  if (protecao) return resultado(false);
  const url = css?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const parciais = (est.arquivos?.baixadosSemTexto || []).length > 0 || (est.arquivos?.comErroParse || []).length > 0;
  const partes = [];
  if (keyframes) partes.push(`${keyframes} ${plural(keyframes, 'regra @keyframes', 'regras @keyframes')}`);
  if (animEst) partes.push(`${animEst} ${plural(animEst, 'declaração de animação', 'declarações de animação')}`);
  if (trTransform) partes.push(`${trTransform} ${plural(trTransform, 'transição de transform', 'transições de transform')}`);
  if (!partes.length) partes.push(`${animComp} ${plural(animComp, 'animação em uso', 'animações em uso')} nos estilos computados`);
  const mensagem = `O site tem ${lista(partes)} e nenhuma regra @media (prefers-reduced-motion), nem no CSS nem no JavaScript lido.`;
  const nome = (mov.keyframes || [])[0];
  return resultado(true, 1, [achado({
    pagina: caminho, mensagem, instavel: parciais,
    evidencias: [ev(caminho, { trecho: 'prefers-reduced-motion ausente', valor: 0, contagem: 0 }), ev(caminho, { trecho: partes.join('; '), valor: gatilhos || animComp, contagem: gatilhos || animComp })],
    citacoes: citar(ctx, url, regra, nome ? [trCss(`@keyframes ${nome}`), trCss(nome)] : null),
  })]);
}

function numerosDeBezier(texto) {
  const m = /cubic-bezier\(\s*([^)]*)\)/i.exec(texto);
  if (!m) return null;
  const n = m[1].split(',').map((x) => parseFloat(x));
  return n.length === 4 && n.every(Number.isFinite) ? n : null;
}
function detEasingComQuique({ ctx, med, regra }) {
  const est = estaticoDe(med);
  if (!est) return null;
  const css = paginasCss(med);
  const usos = new Map();
  const add = (chave, o) => { if (!usos.has(chave)) usos.set(chave, o); };
  for (const d of cssDoSite(ctx).decls) {
    if (!/^(transition|transition-timing-function|animation|animation-timing-function)$/.test(d.prop)) continue;
    for (const m of d.valor.matchAll(/cubic-bezier\([^)]*\)/gi)) {
      const n = numerosDeBezier(m[0]);
      if (n && (n[1] < 0 || n[1] > 1 || n[3] < 0 || n[3] > 1)) add(`cb:${n.join(',')}`, { rotulo: 'cubic-bezier com y fora do intervalo de 0 a 1', valor: m[0].replace(/\s+/g, ''), decl: d });
    }
    for (const m of d.valor.matchAll(/linear\(([^)]*)\)/gi)) {
      const vals = m[1].split(',').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
      if (vals.some((x) => x > 1)) add(`ln:${m[0]}`, { rotulo: 'linear() com valor acima de 1', valor: m[0].replace(/\s+/g, ''), decl: d });
    }
  }
  for (const p of css?.paginas || []) {
    for (const chave of [...Object.keys(p.computado?.movimento?.transicoes?.easing || {}), ...Object.keys(p.computado?.movimento?.animacoes?.easing || {})]) {
      const n = numerosDeBezier(chave);
      if (n && (n[1] < 0 || n[1] > 1 || n[3] < 0 || n[3] > 1)) add(`cb:${n.join(',')}`, { rotulo: 'cubic-bezier com y fora do intervalo de 0 a 1', valor: chave.replace(/\s+/g, ''), decl: null });
    }
  }
  const nomes = unico([...(est.movimento?.keyframes || []), ...Object.keys(est.movimento?.animacaoNomes || {})]).filter((x) => RE_QUIQUE.test(x));
  for (const n of nomes) add(`nome:${n}`, { rotulo: `animação de nome "${n}"`, nome: n });
  let classes = 0;
  for (const p of ctx?.paginas || []) classes += tagsComClasse(p, /(^|:)animate-bounce$/).length;
  if (classes) add('cls:animate-bounce', { rotulo: 'classe animate-bounce', classe: 'animate-bounce' });
  const n = usos.size;
  if (!n) return resultado(false);
  const url = css?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const itens = [...usos.values()];
  const mensagem = `Há ${n} ${plural(n, 'uso', 'usos')} de efeito de quique ou elástico: ${lista(itens.map((i) => i.rotulo), 3)}.`;
  return resultado(true, n / LM.quiqueUsosParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: itens.slice(0, 4).map((i) => ev(caminho, { seletor: i.decl?.seletor, trecho: i.decl?.texto || i.rotulo, valor: i.valor || i.rotulo, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...itens.slice(0, 3).map((i) => [i.decl && trCss(i.decl.texto), i.nome && trCss(`@keyframes ${i.nome}`), i.nome && trCss(i.nome), i.classe && trHtml(i.classe)])),
  })]);
}

// Sujeito interativo? (link, botão, controle) não conta como "cartão".
const RE_SUJEITO_INTERATIVO = /(^|[\s>+~.#(])(a|button|input|select|textarea|summary|label|nav)(?![\w-])|btn|button|botao|link|menu|cta|tab\b|chip|badge|social/i;
const RE_TRANSFORM_HOVER = /(scale[xyz3d]*|translate[xyz3d]*|rotate[xyz3d]*)\(/i;
function detHoverIgual({ ctx, med, regra }) {
  const css = cssDoSite(ctx);
  if (!css.regras.length) return null; // sem CSS lido, não dá para avaliar regras :hover
  const grupos = new Map(); // transform normalizado -> Set(seletores)
  const exemplo = new Map();
  const imagens = new Map();
  for (const r of css.regras) {
    if (r.keyframes) continue;
    const d = r.decls.find((x) => x.prop === 'transform' && RE_TRANSFORM_HOVER.test(x.valor));
    if (!d) continue;
    for (const sel of r.seletores) {
      if (!/:hover/i.test(sel)) continue;
      const sujeito = sel.split(/:hover/i)[0].split(/[\s>+~]+/).pop() || '';
      const norm = d.valor.replace(/\s+/g, '').toLowerCase();
      if (/(^|[\s>+~.#-])(img|picture)(?![\w-])|(img|image|foto|photo|thumb|cover)/i.test(sel) && /(scale|rotate)/i.test(d.valor)) imagens.set(sel, d);
      if (RE_SUJEITO_INTERATIVO.test(sujeito)) continue;
      if (!grupos.has(norm)) { grupos.set(norm, new Set()); exemplo.set(norm, d); }
      grupos.get(norm).add(sel);
    }
  }
  const maior = [...grupos.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  const nIguais = maior ? maior[1].size : 0;
  const gatilhoIguais = nIguais >= LM.hoverMinSeletoresIguais;
  const gatilhoImagem = imagens.size > 0;
  const url = paginasCss(med)?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  if (!gatilhoIguais && !gatilhoImagem) return resultado(false);
  const caminho = caminhoDe(url);
  const partes = [];
  const decls = [];
  if (gatilhoIguais) { partes.push(`o mesmo transform (${maior[0]}) em ${nIguais} seletores diferentes ao passar o mouse`); decls.push(exemplo.get(maior[0])); }
  if (gatilhoImagem) { partes.push(`${imagens.size} ${plural(imagens.size, 'imagem ganha', 'imagens ganham')} escala ou rotação no hover`); decls.push([...imagens.values()][0]); }
  const inten = Math.max(gatilhoIguais ? nIguais / LM.hoverSeletoresParaMax : 0, gatilhoImagem ? LM.hoverSoImagemIntensidade : 0);
  return resultado(true, inten, [achado({
    pagina: caminho, mensagem: `No CSS há ${partes.join(' e ')}.`,
    evidencias: [...(gatilhoIguais ? [...maior[1]].slice(0, 3).map((s) => ev(caminho, { seletor: s, trecho: `${s} { transform: ${maior[0]} }`, valor: maior[0], contagem: nIguais })) : []), ...[...imagens.keys()].slice(0, 2).map((s) => ev(caminho, { seletor: s, trecho: imagens.get(s).texto, valor: imagens.get(s).valor, contagem: 1 }))],
    citacoes: citar(ctx, url, regra, ...decls.map((d) => trCss(d.texto))),
  })]);
}

const detLoopInfinito = porPagina(({ ctx, regra, pag, url, caminho, es }) => {
  const infinitas = animacoesDe(es).filter((a) => a.iteracoes === 'infinite' && !RE_ANIM_EXCLUIDA.test(a.nome));
  const porNome = soma(infinitas.map((a) => a.elementos));
  const classes = tagsDe(pag).filter((t) => classesDe(t).some((c) => /(^|:)animate-(pulse|ping)$/.test(c)) && !classesDe(t).some((c) => /skeleton|loading|loader|placeholder|progress|live/i.test(c)));
  const n = porNome + classes.length;
  if (n < 1) return resultado(false);
  const rotulos = [...infinitas.map((a) => `animation-name "${a.nome}"`), ...unico(classes.flatMap((t) => classesDe(t).filter((c) => /animate-(pulse|ping)/.test(c))))];
  const mensagem = `Há ${n} ${plural(n, 'elemento visível com animação', 'elementos visíveis com animação')} em repetição infinita que não parecem indicador de carregamento (${lista(rotulos, 3)}); o modelo confirma se tem função.`;
  return resultado(true, n / LM.loopOcorrenciasParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: rotulos.join('; '), valor: n, contagem: n })],
    citacoes: citar(ctx, url, regra, ...infinitas.slice(0, 2).map((a) => [trCss(`@keyframes ${a.nome}`), trCss(a.nome)]), classes.length ? [trHtml('animate-pulse'), trHtml('animate-ping')] : null),
  })]);
}, { exigeCss: true });

const RE_NOME_AUTOMATICO = /(marquee|ticker|scroll|slide|carousel|carrossel|roll|ribbon|logos?)/i;
const RE_CONTROLE_PAUSA = /(pausar|pause|parar|stop)/i;
function detMovimentoAutomatico({ ctx, med, regra }) {
  const css = paginasCss(med);
  const jsd = jsDoSite(ctx);
  const rs = [];
  for (const pag of ctx?.paginas || []) {
    if (!pag.final?.extr) continue;
    const es = css?.paginas.find((p) => p.url === pag.url)?.computado || null;
    const extr = pag.final.extr;
    const cands = [];
    const marquee = tagsDe(pag).filter((t) => t.tag === 'marquee');
    if (marquee.length) cands.push({ rotulo: `${marquee.length} ${plural(marquee.length, 'elemento marquee', 'elementos marquee')}`, html: '<marquee' });
    for (const a of animacoesDe(es)) if (a.iteracoes === 'infinite' && RE_NOME_AUTOMATICO.test(a.nome) && !RE_ANIM_EXCLUIDA.test(a.nome) && (a.anima === null || (a.anima || []).includes('transform'))) cands.push({ rotulo: `animação infinita "${a.nome}" que desloca conteúdo`, nome: a.nome });
    const autoplay = tagsDe(pag).filter((t) => /^carousel$/i.test(t.attrs['data-bs-ride'] || '') || 'data-autoplay' in t.attrs);
    if (autoplay.length) cands.push({ rotulo: `${autoplay.length} ${plural(autoplay.length, 'carrossel com rotação automática', 'carrosséis com rotação automática')}`, html: autoplay[0].attrs['data-bs-ride'] ? 'data-bs-ride' : 'data-autoplay' });
    const mAuto = /\bautoplay(?:Speed)?\s*:\s*(?:true|\{|\d)/i.exec(jsd.tudo);
    if (mAuto) cands.push({ rotulo: 'configuração autoplay em script', js: mAuto[0] });
    if (!cands.length) { rs.push(resultado(false)); continue; }
    const controles = (extr.nos || []).filter((n) => n.visivel && !n.clone && /^(button|a)$/.test(n.tag) && RE_CONTROLE_PAUSA.test(n.texto)).length
      + (extr.atributos || []).filter((a) => /^(aria-label|title)$/.test(a.atributo) && RE_CONTROLE_PAUSA.test(a.valor)).length;
    if (controles > 0) { rs.push(resultado(false)); continue; }
    const caminho = caminhoDe(pag.url);
    const n = cands.length;
    const mensagem = `Há conteúdo que muda sozinho (${lista(cands.map((c) => c.rotulo), 3)}) e nenhum botão de pausar ou parar foi encontrado; leitura estática, sem as duas leituras do DOM, e o modelo confirma na captura.`;
    rs.push(resultado(true, n / LM.automaticoCandidatosParaMax, [achado({
      pagina: caminho, mensagem,
      evidencias: cands.slice(0, 4).map((c) => ev(caminho, { trecho: c.rotulo, valor: 1, contagem: 1 })),
      citacoes: citar(ctx, pag.url, regra, ...cands.slice(0, 3).map((c) => [c.nome && trCss(`@keyframes ${c.nome}`), c.nome && trCss(c.nome), c.html && trHtml(c.html), c.js && trJs(c.js)])),
    })]));
  }
  return agregar(rs);
}

const ASSINATURAS_PARALLAX = [
  { id: 'rellax', re: /\brellax\b/i }, { id: 'jarallax', re: /\bjarallax\b/i },
  { id: 'locomotive-scroll', re: /locomotive[-_ ]?scroll/i }, { id: 'scrollmagic', re: /\bscrollmagic\b/i },
];
function detParallax({ ctx, med, regra }) {
  if (!ctx?.paginas?.length) return null;
  const css = cssDoSite(ctx);
  const jsd = jsDoSite(ctx);
  const ocorrencias = [];
  const htmlTudo = (ctx.paginas || []).map((p) => htmlLimpo(p)).join('\n');
  for (const a of ASSINATURAS_PARALLAX) {
    const noJs = a.re.test(jsd.tudo) || jsd.srcs.some((s) => a.re.test(s));
    const noHtml = a.re.test(htmlTudo);
    if (noJs || noHtml) ocorrencias.push({ rotulo: `biblioteca ${a.id}`, js: noJs ? a.id : null, html: a.id, n: 1 });
  }
  let dataAttr = 0;
  for (const p of ctx.paginas) dataAttr += tagsDe(p).filter((t) => 'data-parallax' in t.attrs || 'data-speed' in t.attrs).length;
  if (dataAttr) ocorrencias.push({ rotulo: `${dataAttr} ${plural(dataAttr, 'elemento com data-parallax ou data-speed', 'elementos com data-parallax ou data-speed')}`, html: 'data-parallax', htmlAlt: 'data-speed', n: dataAttr });
  const fixed = css.decls.filter((d) => !d.keyframes && ((d.prop === 'background-attachment' && /fixed/i.test(d.valor)) || (d.prop === 'background' && /\bfixed\b/i.test(d.valor))));
  if (fixed.length) ocorrencias.push({ rotulo: `${fixed.length} ${plural(fixed.length, 'regra', 'regras')} com background-attachment: fixed`, css: fixed[0].texto, n: fixed.length });
  const reListener = /addEventListener\(\s*['"]scroll['"][\s\S]{0,400}?(transform|translate)/gi;
  const listeners = (jsd.proprios.match(reListener) || []).length;
  if (listeners) ocorrencias.push({ rotulo: `${listeners} ${plural(listeners, 'listener de scroll que altera', 'listeners de scroll que alteram')} transform`, js: 'addEventListener', n: listeners });
  if (!ocorrencias.length) return resultado(false);
  const url = paginasCss(med)?.paginas?.[0]?.url || ctx.paginas[0].url;
  const caminho = caminhoDe(url);
  const total = soma(ocorrencias.map((o) => o.n));
  const mensagem = `${total === 1 ? 'Foi achada' : 'Foram achadas'} ${total} ${plural(total, 'assinatura', 'assinaturas')} de paralaxe ou rolagem controlada pela página: ${lista(ocorrencias.map((o) => o.rotulo), 4)}; o modelo confirma se o efeito domina a experiência.`;
  return resultado(true, total / LM.parallaxOcorrenciasParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: ocorrencias.slice(0, 5).map((o) => ev(caminho, { trecho: o.rotulo, valor: o.n, contagem: o.n })),
    citacoes: citar(ctx, url, regra, ...ocorrencias.slice(0, 3).map((o) => [o.css && trCss(o.css), o.js && trJs(o.js), o.html && trHtml(o.html), o.htmlAlt && trHtml(o.htmlAlt)])),
  })]);
}

function detDuracaoForaDaFaixa({ ctx, med, regra }) {
  const est = estaticoDe(med);
  const css = paginasCss(med);
  if (!est && !css) return null;
  const trMs = new Map(); // ms -> descrição
  const entradas = new Map(); // nome -> ms
  for (const p of css?.paginas || []) {
    for (const k of Object.keys(p.computado?.movimento?.transicoes?.duracoesMs || {})) { const ms = parseFloat(k); if (ms > LM.duracaoEstadoMaxMs) trMs.set(ms, { rotulo: `transição de ${ms} ms` }); }
    for (const a of animacoesDeEntrada(p.computado)) if (a.duracaoMs > LM.duracaoEntradaMaxMs) entradas.set(a.nome, a.duracaoMs);
  }
  for (const k of Object.keys(est?.movimento?.duracoesMs || {})) { const ms = parseFloat(k); if (ms > LM.duracaoEstadoMaxMs && !trMs.has(ms)) trMs.set(ms, { rotulo: `transição de ${ms} ms` }); }
  const regrasDeEstado = [];
  for (const d of cssDoSite(ctx).decls) {
    if (d.keyframes || !RE_ESTADO.test(d.seletor) || !/^transition(-duration)?$/.test(d.prop)) continue;
    const ms = d.prop === 'transition' ? Math.max(0, ...itensDeTransicao(d.valor).map((i) => i.duracaoMs + i.atrasoMs)) : Math.max(0, ...dividirTopo(d.valor, ',').filter(ehTempo).map(paraMs));
    if (ms > LM.duracaoEstadoMaxMs) { trMs.set(ms, { rotulo: `transição de ${ms} ms em estado de interface`, decl: d }); regrasDeEstado.push(d); }
  }
  const n = trMs.size + entradas.size;
  if (!n) return resultado(false);
  const url = css?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const rotulos = [...[...trMs.values()].map((x) => x.rotulo), ...[...entradas.entries()].map(([nome, ms]) => `entrada "${nome}" de ${ms} ms`)];
  const mensagem = `Há ${n} ${plural(n, 'duração acima da faixa', 'durações acima da faixa')} (estado até ${LM.duracaoEstadoMaxMs} ms, entrada até ${LM.duracaoEntradaMaxMs} ms): ${lista(rotulos, 3)}.`;
  const decls = [...trMs.values()].filter((x) => x.decl).map((x) => x.decl);
  return resultado(true, n / LM.duracaoItensParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: rotulos.slice(0, 4).map((r) => ev(caminho, { trecho: r, valor: 1, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...decls.slice(0, 2).map((d) => trCss(d.texto)), ...[...entradas.keys()].slice(0, 2).map((nome) => [trCss(`@keyframes ${nome}`), trCss(nome)])),
  })]);
}

const RE_OCULTO_SEM_JS = /opacity|visibility|fora-da-tela|clip/;
const detConteudoInvisivelSemJs = porPagina(({ ctx, regra, pag, url, caminho, extr }) => {
  const cru = pag.cru?.extr;
  if (!cru?.nos) return null; // sem a leitura do HTML cru com JavaScript desligado
  // Exceções da regra: animação de entrada feita só em CSS (começa sozinha), @starting-style e regras escopadas em classe .js.
  // Nesses casos o "invisível sem JS" por opacidade é esperado, então só contam visibilidade, recorte e fora da tela.
  const css = cssDoSite(ctx);
  const entradaCss = (pag.final?.estilos?.movimento?.animacoes?.porNome || []).some((a) => a.ehEntrada);
  const ignorarOpacidade = entradaCss || /@starting-style/i.test(css.texto) || css.regras.some((r) => r.seletores.some((s) => /(^|[\s>])(html)?\.js(?![\w-])/i.test(s)));
  const porSeletor = new Map();
  for (const n of cru.nos) { if (!porSeletor.has(n.seletor)) porSeletor.set(n.seletor, []); porSeletor.get(n.seletor).push(n); }
  const finais = (extr.nos || []).filter((n) => n.visivel && !n.clone && n.texto);
  const afetados = [];
  for (const n of finais) {
    const c = (porSeletor.get(n.seletor) || []).find((x) => normalizarTexto(x.texto) === normalizarTexto(n.texto));
    if (!c || c.visivel !== false || !RE_OCULTO_SEM_JS.test(c.ocultoPor || '')) continue;
    if (ignorarOpacidade && /opacity/.test(c.ocultoPor)) continue;
    afetados.push({ n, motivo: c.ocultoPor });
  }
  const palavras = soma(afetados.map((a) => nPalavras(a.n.texto)));
  const total = soma(finais.map((n) => nPalavras(n.texto)));
  if (palavras < LM.semJsPalavrasMin) return resultado(false);
  const fracao = total ? palavras / total : 1;
  const mensagem = `Sem JavaScript, ${palavras} das ${total} palavras visíveis no DOM final ficam invisíveis (${pct(fracao)} do texto), em ${afetados.length} ${plural(afetados.length, 'elemento', 'elementos')}.`;
  return resultado(true, fracao / LM.semJsFracaoParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: afetados.slice(0, 4).map((a) => ev(caminho, { seletor: a.n.seletor, trecho: a.n.texto, valor: a.motivo, contagem: nPalavras(a.n.texto), visivel: true })),
    citacoes: citar(ctx, url, regra, ...afetados.slice(0, 3).map((a) => trVis(a.n.texto.slice(0, 80)))),
  })]);
});

const detVideoAutoplay = porPagina(({ ctx, regra, pag, url, caminho }) => {
  const tags = tagsDe(pag);
  const videos = tags.filter((t) => t.tag === 'video' && 'autoplay' in t.attrs);
  if (!videos.length) return resultado(false);
  const marcos = tags.filter((t) => t.tag === 'h2' || t.tag === 'section');
  const limite = marcos[LM.videoPrimeiraDobraSecoes - 1]?.indice ?? Infinity;
  const problemas = videos.map((v) => ({ v, semMuted: !('muted' in v.attrs), semPlaysinline: !('playsinline' in v.attrs), semPoster: !('poster' in v.attrs) && v.indice < limite }));
  const ruins = problemas.filter((p) => p.semMuted || p.semPlaysinline || p.semPoster);
  if (!ruins.length) return resultado(false);
  const cont = (k) => ruins.filter((p) => p[k]).length;
  const partes = [];
  if (cont('semMuted')) partes.push(`${cont('semMuted')} sem muted`);
  if (cont('semPlaysinline')) partes.push(`${cont('semPlaysinline')} sem playsinline`);
  if (cont('semPoster')) partes.push(`${cont('semPoster')} sem poster perto do topo`);
  const mensagem = `Há ${videos.length} ${plural(videos.length, 'vídeo com autoplay', 'vídeos com autoplay')}: ${partes.join(', ')}.`;
  return resultado(true, ruins.length / videos.length, [achado({
    pagina: caminho, mensagem,
    evidencias: ruins.slice(0, 3).map((p) => ev(caminho, { trecho: p.v.raw, valor: [p.semMuted && 'muted', p.semPlaysinline && 'playsinline', p.semPoster && 'poster'].filter(Boolean).join(','), contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...ruins.slice(0, 3).map((p) => trHtml(p.v.raw))),
  })]);
});

const detGifPesado = porPagina(({ ctx, regra, pag, url, caminho, extr }) => {
  const gifs = (extr.imagens || []).filter((i) => i.visivel && !i.clone && /\.gif(\?|#|$)/i.test(i.src || '') && i.renderW >= LM.gifLarguraMinPx);
  if (!gifs.length) return resultado(false);
  const bytesDe = (src) => (pag.requisicoes || []).find((r) => r.url === src && typeof r.bytes === 'number')?.bytes ?? null;
  const pesados = gifs.map((g) => ({ g, bytes: bytesDe(g.src) })).filter((x) => x.bytes !== null && x.bytes >= LM.gifPesoMinKb * 1024);
  if (!pesados.length) return gifs.every((g) => bytesDe(g.src) === null) ? null : resultado(false);
  const nomeDe = (src) => decodeURIComponent((src.split('?')[0].split('/').pop() || '')).slice(0, 80);
  const kb = (b) => Math.round(b / 1024);
  const mensagem = `${pesados.length} ${plural(pesados.length, 'GIF exibido', 'GIFs exibidos')} com ${LM.gifLarguraMinPx} px ou mais de largura e ${LM.gifPesoMinKb} KB ou mais (maior: ${nomeDe(pesados[0].g.src)}, ${kb(pesados[0].bytes)} KB, ${pesados[0].g.renderW} px de largura).`;
  return resultado(true, pesados.length / LM.gifQuantidadeParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: pesados.slice(0, 3).map((x) => ev(caminho, { seletor: x.g.seletor, trecho: nomeDe(x.g.src), valor: `${kb(x.bytes)} KB`, contagem: x.g.renderW, visivel: true })),
    citacoes: citar(ctx, url, regra, ...pesados.slice(0, 3).map((x) => trHtml(nomeDe(x.g.src)))),
  })]);
});

function detCascata({ ctx, med, regra }) {
  const css = cssDoSite(ctx);
  if (!ctx?.paginas?.length) return null;
  const grupos = []; // { origem, itens: Set(ms), max, amostra:{texto, onde} }
  const porBase = new Map();
  for (const r of css.regras) {
    if (r.keyframes) continue;
    for (const sel of r.seletores) {
      if (!/:nth-(last-)?(child|of-type)\(/i.test(sel)) continue;
      for (const d of r.decls) {
        let ms = null;
        if (/^(animation|transition)-delay$/.test(d.prop)) ms = Math.max(...dividirTopo(d.valor, ',').filter(ehTempo).map(paraMs));
        else if (d.prop === 'transition') ms = Math.max(0, ...itensDeTransicao(d.valor).map((i) => i.atrasoMs));
        else if (d.prop === 'animation') { const t = dividirTopo(d.valor, ' ').filter(ehTempo); ms = t[1] !== undefined ? paraMs(t[1]) : null; }
        if (ms === null || !Number.isFinite(ms)) continue;
        const base = sel.replace(/:nth-(last-)?(child|of-type)\([^)]*\)/gi, '').trim();
        if (!porBase.has(base)) porBase.set(base, { itens: new Map(), amostra: d.texto });
        porBase.get(base).itens.set(ms, d.texto);
      }
    }
  }
  for (const [base, g] of porBase) grupos.push({ origem: `CSS em "${base}"`, itens: g.itens.size, max: Math.max(...g.itens.keys()), css: g.amostra });
  for (const pag of ctx.paginas) {
    const porClasse = new Map();
    for (const t of tagsDe(pag)) {
      let ms = null;
      const st = t.attrs.style || '';
      const m = /(?:animation|transition)-delay\s*:\s*([^;]+)/i.exec(st);
      if (m) { const tempos = dividirTopo(m[1], ',').filter(ehTempo).map(paraMs); if (tempos.length) ms = Math.max(...tempos); }
      if (t.attrs['data-aos-delay'] !== undefined) ms = parseFloat(t.attrs['data-aos-delay']);
      if (t.attrs['data-wow-delay'] !== undefined) ms = paraMs(/\d$/.test(t.attrs['data-wow-delay']) ? `${t.attrs['data-wow-delay']}s` : t.attrs['data-wow-delay']);
      if (ms === null || !Number.isFinite(ms)) continue;
      const chave = `${t.tag}|${t.attrs.class || ''}`;
      if (!porClasse.has(chave)) porClasse.set(chave, { itens: new Set(), max: 0, raw: t.raw });
      const g = porClasse.get(chave);
      g.itens.add(ms); g.max = Math.max(g.max, ms);
    }
    for (const [chave, g] of porClasse) grupos.push({ origem: `HTML em <${chave.split('|')[0]}>`, itens: g.itens.size, max: g.max, html: g.raw, url: pag.url });
  }
  const disparam = grupos.filter((g) => g.itens > LM.cascataMaxItens || (g.itens >= 2 && g.max > LM.cascataAtrasoTotalMaxMs));
  if (!disparam.length) return resultado(false);
  const forca = (g) => Math.max(LM.cascataIntensidadeMinima, (g.itens - LM.cascataMaxItens) / LM.cascataItensParaMax, (g.max - LM.cascataAtrasoTotalMaxMs) / LM.cascataAtrasoParaMaxMs);
  const pior = disparam.sort((a, b) => forca(b) - forca(a))[0];
  const url = pior.url || paginasCss(med)?.paginas?.[0]?.url || ctx.paginas[0].url;
  const caminho = caminhoDe(url);
  const inten = forca(pior);
  const mensagem = `Há uma cascata de ${pior.itens} atrasos diferentes (${pior.origem}), com atraso de até ${Math.round(pior.max)} ms; os limites são ${LM.cascataMaxItens} itens e ${LM.cascataAtrasoTotalMaxMs} ms.`;
  return resultado(true, inten, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: pior.css || pior.html || pior.origem, valor: Math.round(pior.max), contagem: pior.itens })],
    citacoes: citar(ctx, url, regra, [pior.css && trCss(pior.css), pior.html && trHtml(pior.html)]),
  })]);
}

// ---------------------------------------------------------------------------------------------------------------------
// LAYOUT E ESPAÇAMENTO
// ---------------------------------------------------------------------------------------------------------------------
const RE_PADDING_PROP = /^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/;
const detPaddingUnico = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const c = es.cards;
  if (!c || c.total < LL.paddingMinCartoes) return resultado(false);
  const distintosCss = new Set(cssDoSite(ctx).decls.filter((d) => !d.keyframes && RE_PADDING_PROP.test(d.prop) && !/var\(/i.test(d.valor)).map((d) => d.valor.toLowerCase().replace(/\s+/g, ' ')));
  const distintos = distintosCss.size || (c.nPaddingDistintos + (es.secoes?.nParesDistintos || 0));
  if (c.fracaoPaddingDominante < LL.paddingFracaoMin || distintos < LL.paddingValoresDistintosMin) return resultado(false);
  const ex = (c.exemplos || []).slice(0, 3).map((x) => textoSob(extr, x.seletor)).filter(Boolean);
  const mensagem = `${pct(c.fracaoPaddingDominante)} dos ${c.total} blocos em cartão usam o mesmo padding interno (${c.paddingDominante}), num site com ${distintos} valores de padding diferentes.`;
  return resultado(true, (c.fracaoPaddingDominante - LL.paddingFracaoMin) / (1 - LL.paddingFracaoMin), [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: `padding dominante ${c.paddingDominante}`, valor: c.fracaoPaddingDominante, contagem: c.total })],
    citacoes: citar(ctx, url, regra, ...ex.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const RE_ESPACO_PROP = /^(margin(-(top|right|bottom|left|inline|block)(-(start|end))?)?|padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?|gap|row-gap|column-gap|grid-gap)$/;
function valorPx(tok) {
  if (/^-?0+(\.0+)?$/.test(tok)) return 0;
  const m = /^(-?[\d.]+)(px|rem)$/i.exec(tok);
  return m ? parseFloat(m[1]) * (m[2].toLowerCase() === 'rem' ? 16 : 1) : null;
}
function detForaDaEscala({ ctx, med, regra }) {
  const css = cssDoSite(ctx);
  if (!css.regras.length) return null;
  let total = 0;
  let nFora = 0;
  const fora = new Map(); // valor em px fora da escala -> primeira declaração que o usa
  for (const d of css.decls) {
    if (d.keyframes || !RE_ESPACO_PROP.test(d.prop)) continue;
    for (const tok of dividirTopo(d.valor, ' ')) {
      const px = valorPx(tok);
      if (px === null) continue;
      const abs = Math.abs(px);
      if (LL.escalaValoresIgnoradosPx.includes(abs)) continue;
      total++;
      if (Math.abs(abs / LL.escalaBasePx - Math.round(abs / LL.escalaBasePx)) <= 0.001) continue;
      nFora++;
      if (!fora.has(arred(abs, 2))) fora.set(arred(abs, 2), d);
    }
  }
  if (!total) return resultado(false);
  if (fora.size <= LL.escalaMaxForaDaEscala) return resultado(false);
  const url = paginasCss(med)?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const valores = [...fora.keys()].sort((a, b) => a - b);
  const mensagem = `${fora.size} valores distintos de margem, padding ou gap fora da escala de múltiplos de ${LL.escalaBasePx} px (${lista(valores.map((v) => `${v}px`), 5)}), em ${nFora} de ${total} usos (${pct(nFora / total)}); medido no CSS declarado.`;
  return resultado(true, nFora / total, [achado({
    pagina: caminho, mensagem,
    evidencias: [...fora.entries()].slice(0, 4).map(([px, d]) => ev(caminho, { seletor: d.seletor, trecho: d.texto, valor: px, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...[...fora.values()].slice(0, 3).map((d) => trCss(d.texto))),
  })]);
}

const detRespiroCurto = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const itens = itensSecao(es).filter((it) => !/^(header|footer)$/.test(it.tag));
  const pares = [];
  for (let i = 0; i + 1 < itens.length; i++) pares.push({ a: itens[i], b: itens[i + 1], px: itens[i].paddingBottomPx + itens[i + 1].paddingTopPx });
  if (pares.length < LL.respiroMinPares) return resultado(false);
  const curtos = pares.filter((p) => p.px < LL.respiroLimiteFundoMudaPx);
  const fracao = curtos.length / pares.length;
  if (fracao < LL.respiroFracaoMin) return resultado(false);
  const mensagem = `${curtos.length} de ${pares.length} pares de seções consecutivas ficam com menos de ${LL.respiroLimiteFundoMudaPx} px de respiro (padding de baixo mais padding de cima; margens e fundo não entram na medida).`;
  const exemplos = curtos.slice(0, 2).map((p) => textoSob(extr, p.b.seletor)).filter(Boolean);
  return resultado(true, fracao, [achado({
    pagina: caminho, mensagem,
    evidencias: curtos.slice(0, 3).map((p) => ev(caminho, { seletor: p.b.seletor, trecho: `${p.a.paddingBottomPx}px + ${p.b.paddingTopPx}px`, valor: p.px, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...exemplos.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const detUltimoItemSozinho = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const grades = (es.layout?.grades || []).filter((g) => g.colunas >= 2 && g.filhos > g.colunas);
  if (!grades.length) return resultado(false);
  const sozinhas = grades.filter((g) => g.filhos % g.colunas === 1);
  if (!sozinhas.length) return resultado(false);
  const g = sozinhas[0];
  const nos = filhosElemento(arvoreDe(extr).achar(g.seletor) || { filhos: new Map() });
  const ultimo = nos[nos.length - 1];
  const mensagem = `${sozinhas.length} de ${grades.length} ${plural(grades.length, 'grade', 'grades')} com várias linhas termina com 1 item sozinho na última linha (primeira: ${g.filhos} itens em ${g.colunas} colunas, medido em 1440 px).`;
  return resultado(true, sozinhas.length / grades.length, [achado({
    pagina: caminho, mensagem,
    evidencias: sozinhas.slice(0, 3).map((x) => ev(caminho, { seletor: x.seletor, trecho: `grid com ${x.colunas} colunas e ${x.filhos} filhos`, valor: x.filhos, contagem: x.colunas })),
    citacoes: citar(ctx, url, regra, ultimo ? trVis(textoDoNo(ultimo)) : null),
  })]);
}, { exigeCss: true });

const detTextoEspremido = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const p = es.tipografia?.paragrafos;
  if (!p || !p.amostras || p.caracteresPorLinhaMediana === null) return resultado(false);
  if (p.caracteresPorLinhaMediana >= LL.textoEspremidoMinCaracteres) return resultado(false);
  const ex = (p.exemplosLongos || []).slice(0, 2).map((x) => textoSob(extr, x.seletor)).filter(Boolean);
  const mensagem = `A mediana de caracteres por linha nos ${p.amostras} blocos de texto medidos é ${p.caracteresPorLinhaMediana}, abaixo do mínimo de ${LL.textoEspremidoMinCaracteres} (blocos com 3 linhas ou mais, em 1440 px).`;
  return resultado(true, (LL.textoEspremidoMinCaracteres - p.caracteresPorLinhaMediana) / LL.textoEspremidoMinCaracteres, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: 'caracteres por linha (mediana)', valor: p.caracteresPorLinhaMediana, contagem: p.amostras })],
    citacoes: citar(ctx, url, regra, ...ex.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const RE_BLOCO_TEXTO = /^(p|h[1-6]|li|blockquote|figcaption)$/;
const detParedeDeTexto = porPagina(({ ctx, regra, pag, url, caminho, extr, es }) => {
  const achadosDoTipo = [];
  let inten = 0;
  const secoes = itensSecao(es).filter((s) => s.alturaPx <= LL.paredeJanelaAlturaPx);
  let melhor = null;
  for (const s of secoes) {
    const nos = nosSob(extr, s.seletor);
    const palavras = soma(nos.map((n) => nPalavras(n.texto)));
    if (palavras > LL.paredePalavrasAviso && (!melhor || palavras > melhor.palavras)) melhor = { s, palavras, nos };
  }
  if (melhor) {
    inten = Math.max(inten, melhor.palavras > LL.paredePalavrasAlto ? 1 : 0.5 + (0.5 * (melhor.palavras - LL.paredePalavrasAviso)) / (LL.paredePalavrasAlto - LL.paredePalavrasAviso));
    const longo = [...melhor.nos].sort((a, b) => b.texto.length - a.texto.length)[0];
    achadosDoTipo.push({ mensagem: `Uma seção cabe numa tela de ${LL.paredeJanelaAlturaPx} px e tem ${melhor.palavras} palavras visíveis, acima de ${LL.paredePalavrasAviso}.`, ev: ev(caminho, { seletor: melhor.s.seletor, trecho: 'palavras na seção', valor: melhor.palavras, contagem: melhor.palavras }), cit: trVis(longo.texto.slice(0, 80)) });
  }
  const hero = heroDe(es);
  if (hero) {
    const acoes = acoesDe(pag);
    const nos = nosSob(extr, hero.seletor);
    const iAcao = nos.findIndex((n) => acoes.has(n.seletor));
    if (iAcao > 0) {
      const blocos = nos.slice(0, iAcao).filter((n) => RE_BLOCO_TEXTO.test(n.tag));
      if (blocos.length > LL.paredeBlocosAntesDaAcaoMax) {
        inten = Math.max(inten, (blocos.length - LL.paredeBlocosAntesDaAcaoMax) / LL.paredeBlocosParaMax);
        achadosDoTipo.push({ mensagem: `Na abertura há ${blocos.length} blocos de texto antes da primeira ação; o máximo aceito é ${LL.paredeBlocosAntesDaAcaoMax}.`, ev: ev(caminho, { seletor: hero.seletor, trecho: 'blocos de texto antes da primeira ação', valor: blocos.length, contagem: blocos.length }), cit: trVis(blocos[blocos.length - 1].texto.slice(0, 80)) });
      }
    }
  }
  if (!achadosDoTipo.length) return resultado(false);
  return resultado(true, inten, achadosDoTipo.map((a) => achado({ pagina: caminho, mensagem: a.mensagem, evidencias: [a.ev], citacoes: citar(ctx, url, regra, a.cit) })));
}, { exigeCss: true });

const RE_SELETOR_FIXO_DO_TOPO = /(header|nav|topbar|topo|navbar|menu|banner|announcement|aviso|barra|bar\b)/i;
function detDoisSticky({ ctx, med, regra }) {
  const css = cssDoSite(ctx);
  if (!css.regras.length) return null;
  const achados = new Map();
  for (const r of css.regras) {
    if (r.keyframes) continue;
    const pos = r.decls.find((d) => d.prop === 'position' && /^(sticky|fixed)$/i.test(d.valor));
    const top = r.decls.find((d) => d.prop === 'top' && /^-?0+(\.0+)?(px|rem|em)?$/.test(d.valor.trim()));
    if (!pos || !top) continue;
    if (/print/i.test(r.media || '')) continue;
    for (const sel of r.seletores) {
      if (/^sticky$/i.test(pos.valor) || RE_SELETOR_FIXO_DO_TOPO.test(sel)) { if (!achados.has(sel)) achados.set(sel, { pos, top }); }
    }
  }
  const n = achados.size;
  if (n < LL.stickyMinElementos) return resultado(false);
  const url = paginasCss(med)?.paginas?.[0]?.url || ctx?.paginas?.[0]?.url;
  const caminho = caminhoDe(url);
  const sels = [...achados.keys()];
  const mensagem = `O CSS prende ${n} elementos no topo da tela com top 0 (${lista(sels.map((s) => `"${s}"`), 3)}); podem disputar o mesmo lugar ao rolar.`;
  return resultado(true, 1, [achado({
    pagina: caminho, mensagem,
    evidencias: sels.slice(0, 3).map((s) => ev(caminho, { seletor: s, trecho: `${achados.get(s).pos.texto}; ${achados.get(s).top.texto}`, valor: 0, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...[...achados.values()].slice(0, 2).map((x) => trCss(x.pos.texto))),
  })]);
}

const detAssimetriaSecao = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const hero = heroDe(es);
  const itens = itensSecao(es).filter((s) => s.seletor !== hero?.seletor && !/^(header|footer)$/.test(s.tag) && s.paddingTopPx > 0 && s.paddingBottomPx > 0);
  if (!itens.length) return resultado(false);
  const ruins = itens.filter((s) => Math.max(s.paddingTopPx, s.paddingBottomPx) / Math.min(s.paddingTopPx, s.paddingBottomPx) > LL.assimetriaRazaoMax);
  if (ruins.length < LL.assimetriaMinSecoes) return resultado(false);
  const razoes = ruins.map((s) => arred(Math.max(s.paddingTopPx, s.paddingBottomPx) / Math.min(s.paddingTopPx, s.paddingBottomPx), 2));
  const mensagem = `${ruins.length} de ${itens.length} seções têm padding de cima e de baixo com razão acima de ${LL.assimetriaRazaoMax} (razões ${lista(razoes, 4)}); margens do contêiner não entram na medida.`;
  const ex = ruins.slice(0, 2).map((s) => textoSob(extr, s.seletor)).filter(Boolean);
  return resultado(true, ruins.length / itens.length, [achado({
    pagina: caminho, mensagem,
    evidencias: ruins.slice(0, 3).map((s, i) => ev(caminho, { seletor: s.seletor, trecho: `padding ${s.paddingTopPx}px em cima e ${s.paddingBottomPx}px embaixo`, valor: razoes[i], contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...ex.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

// ---------------------------------------------------------------------------------------------------------------------
// ESTRUTURA PADRÃO
// ---------------------------------------------------------------------------------------------------------------------
// Acha "abertura + grade de 3 colunas com 3 cartões de mesma estrutura" (ou flex de 3 filhos de larguras iguais).
function acharHeroTresCards(es, extr) {
  const hero = heroDe(es);
  if (!hero) return null;
  const arv = arvoreDe(extr);
  const candidatas = [
    ...(es.layout?.grades || []).filter((g) => g.colunas === 3 && g.filhos === 3).map((g) => ({ seletor: g.seletor, tipo: 'grid' })),
    ...(es.layout?.flexLinhas || []).filter((f) => f.filhos === 3 && f.larguraIgual).map((f) => ({ seletor: f.seletor, tipo: 'flex' })),
  ];
  const iHero = idxSecao(es, hero.seletor);
  for (const g of candidatas) {
    const iG = idxSecao(es, g.seletor);
    const posicaoOk = iHero >= 0 && iG >= 0 ? iG >= iHero && iG - iHero <= LE.heroTresMaxSecoesDepois : null;
    if (posicaoOk === false) continue;
    const no = arv.achar(g.seletor);
    const kids = no ? filhosElemento(no) : [];
    let estruturaIgual = null;
    if (kids.length === 3) {
      const ass = kids.map((k) => assinaturaDe(k).join(','));
      estruturaIgual = ass[0] !== '' && ass.every((a) => a === ass[0]);
      if (estruturaIgual && assinaturaDe(kids[0]).length < 2) estruturaIgual = false;
    }
    if (estruturaIgual === false) continue;
    const larguras = kids.map((k) => (es.cards?.exemplos || []).find((c) => c.seletor === `${g.seletor}>${k.seg}`)?.largura).filter((x) => typeof x === 'number');
    let larguraIgual = null;
    if (larguras.length === 3) larguraIgual = (Math.max(...larguras) - Math.min(...larguras)) / Math.max(...larguras) <= LE.heroTresLarguraTolerancia;
    if (larguraIgual === false) continue; // grade bento: não penaliza
    return { hero, grade: g, posicaoOk, estruturaIgual, larguraIgual, centralizada: /center/.test(hero.textAlign || ''), kids };
  }
  return null;
}

const detHeroTresCards = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const r = acharHeroTresCards(es, extr);
  if (!r) return resultado(false);
  const h1 = (extr.headings || []).find((h) => h.nivel === 1 && h.visivel && !h.clone && h.texto);
  const titulos = r.kids.map((k) => (k.filhos.size ? [...k.filhos.values()].find((f) => ehHeading(f.tag || '') && f.textos.length) : null)).map((f) => (f ? textoDoNo(f, 50) : null)).filter(Boolean);
  const inten = r.centralizada && r.larguraIgual !== false ? 1 : 0.5;
  const mensagem = `A abertura${r.centralizada ? ' tem o texto centralizado e' : ''} vem seguida de ${r.grade.tipo === 'grid' ? 'uma grade de 3 colunas' : 'uma linha flex'} com 3 cartões de mesma estrutura${r.estruturaIgual === null ? ' (estrutura não conferida pelos seletores)' : ''}; o modelo confirma na captura se os cartões são intercambiáveis.`;
  return resultado(true, inten, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { seletor: r.hero.seletor, trecho: `abertura com text-align ${r.hero.textAlign}`, valor: r.hero.textAlign }), ev(caminho, { seletor: r.grade.seletor, trecho: `${r.grade.tipo} com 3 filhos de mesma estrutura`, valor: 3, contagem: 3 })],
    citacoes: citar(ctx, url, regra, h1 ? trVis(h1.texto.slice(0, 80)) : null, ...titulos.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const detCartoesIguais = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const heroTres = es ? acharHeroTresCards(es, extr) : null;
  const grades = gradesDeCartoes(extr).filter((g) => !(heroTres && g.seletor === heroTres.grade.seletor));
  if (grades.length < LE.cartoesMinGrades) return resultado(false);
  const mensagem = `Há ${grades.length} grades ou listas com ${LE.cartoesMinIrmaos} ou mais cartões de mesma estrutura (título e frase curta), sem contar a fileira logo abaixo da abertura.`;
  return resultado(true, (grades.length - 1) / (LE.cartoesGradesParaMax - 1), [achado({
    pagina: caminho, mensagem,
    evidencias: grades.slice(0, 4).map((g) => ev(caminho, { seletor: g.seletor, trecho: `${g.n} irmãos <${g.tag}> com assinatura ${g.assinatura}`, valor: g.n, contagem: g.n })),
    citacoes: citar(ctx, url, regra, ...grades.slice(0, 3).map((g) => trVis(textoDoNo(g.filhos[0])))),
  })]);
});

const detCardDentroDeCard = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const c = es.cards;
  if (!c || !c.total) return resultado(false);
  const n = c.aninhados?.total || 0;
  if (n < 1) return resultado(false);
  const pares = c.aninhados.pares || [];
  const mensagem = `${n} ${plural(n, 'cartão está', 'cartões estão')} dentro de outro cartão, num total de ${c.total} cartões.`;
  const textos = pares.slice(0, 2).flatMap((p) => [textoSob(extr, p.filho), textoSob(extr, p.pai)]).filter(Boolean);
  return resultado(true, n / c.total, [achado({
    pagina: caminho, mensagem,
    evidencias: pares.slice(0, 3).map((p) => ev(caminho, { seletor: p.filho, trecho: `dentro de ${p.pai}`, valor: n, contagem: n })),
    citacoes: citar(ctx, url, regra, ...textos.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const detCentralizarTudo = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const c = es.layout?.centralizacao;
  if (!c) return null;
  if (c.blocos < LE.centralizarBlocosMin) return resultado(false);
  if (c.fracao < LE.centralizarFracaoMin) return resultado(false);
  const mensagem = `${c.centralizados} de ${c.blocos} blocos de topo (até 3 níveis de profundidade) têm o conteúdo centralizado (${pct(c.fracao)}).`;
  const textos = (c.exemplos || []).slice(0, 3).map((s) => textoSob(extr, s)).filter(Boolean);
  return resultado(true, (c.fracao - LE.centralizarFracaoMin) / (1 - LE.centralizarFracaoMin), [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: 'blocos de topo centralizados', valor: c.fracao, contagem: c.centralizados })],
    citacoes: citar(ctx, url, regra, ...textos.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const detHeroCentradoEmpilhado = porPagina(({ ctx, regra, pag, url, caminho, extr, es }) => {
  const hero = heroDe(es);
  if (!hero || !/center/.test(hero.textAlign || '')) return resultado(false);
  const nos = nosSob(extr, hero.seletor);
  const h1 = nos.find((n) => n.tag === 'h1');
  const p = nos.find((n) => n.tag === 'p');
  const acoes = acoesDe(pag);
  const acao = nos.find((n) => acoes.has(n.seletor));
  if (!h1 || !p || !acao) return resultado(false);
  const imagens = (extr.imagens || []).filter((i) => i.visivel && !i.clone && (i.seletor || '').startsWith(`${hero.seletor}>`));
  if (imagens.length) return resultado(false);
  const mensagem = 'A abertura tem o texto centralizado (título, frase de apoio e botão) e nenhuma imagem dentro dela; o modelo confirma na captura se há visual ao lado e se o resultado parece genérico.';
  return resultado(true, 1, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { seletor: hero.seletor, trecho: `abertura com text-align ${hero.textAlign}`, valor: hero.textAlign })],
    citacoes: citar(ctx, url, regra, trVis(h1.texto.slice(0, 80)), trVis(p.texto.slice(0, 80)), trVis(acao.texto.slice(0, 60))),
  })]);
}, { exigeCss: true });

const detRitmoUniforme = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const itens = itensSecao(es).filter((s) => /^(section|header|footer)$/.test(s.tag));
  if (itens.length < LE.ritmoMinSecoes) return resultado(false);
  const pares = new Map();
  for (const s of itens) { const k = `${s.paddingTopPx}px/${s.paddingBottomPx}px`; pares.set(k, [...(pares.get(k) || []), s]); }
  const [par, grupo] = [...pares.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (grupo.length < LE.ritmoMinSecoes) return resultado(false);
  const mensagem = `${grupo.length} de ${itens.length} seções, cabeçalho e rodapé repetem o mesmo padding vertical (${par.replace('/', ' em cima e ')} embaixo).`;
  const ex = grupo.slice(0, 2).map((s) => textoSob(extr, s.seletor)).filter(Boolean);
  return resultado(true, grupo.length / itens.length, [achado({
    pagina: caminho, mensagem,
    evidencias: grupo.slice(0, 3).map((s) => ev(caminho, { seletor: s.seletor, trecho: `padding ${par}`, valor: par, contagem: grupo.length })),
    citacoes: citar(ctx, url, regra, ...ex.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

// Classifica uma seção de topo: abertura | grade | chamada | outra
function classificarSecao(item, extr, es, pag, grades) {
  const nos = nosSob(extr, item.seletor);
  const palavras = soma(nos.map((n) => nPalavras(n.texto)));
  if (nos.some((n) => n.tag === 'h1')) return 'abertura';
  if (grades.some((g) => g.seletor === item.seletor || g.seletor.startsWith(`${item.seletor}>`))) return 'grade';
  if ((extr.formularios || []).some((f) => f.visivel && !f.clone && (f.seletor === item.seletor || f.seletor.startsWith(`${item.seletor}>`)))) return 'outra';
  const acoes = acoesDe(pag);
  const nAcoes = nos.filter((n) => acoes.has(n.seletor)).length;
  if (nAcoes === 1 && palavras <= LE.esqueletoMaxPalavrasDaChamada && nos.some((n) => ehHeading(n.tag) || n.tag === 'p')) return 'chamada';
  return 'outra';
}
const detEsqueleto = porPagina(({ ctx, regra, pag, url, caminho, extr, es }) => {
  const secoes = itensSecao(es).filter((s) => s.tag === 'section' || s.tag === 'div');
  if (secoes.length < 3 || secoes.length > LE.esqueletoMaxSecoes) return resultado(false);
  const grades = gradesDeCartoes(extr);
  const tipos = secoes.map((s) => classificarSecao(s, extr, es, pag, grades));
  if (tipos.includes('outra')) return resultado(false);
  if (tipos[0] !== 'abertura' || tipos[tipos.length - 1] !== 'chamada' || !tipos.includes('grade')) return resultado(false);
  const mensagem = `A página tem ${secoes.length} seções no corpo e só três tipos: abertura, grade de cartões e faixa de chamada com um botão; nenhuma seção de preços, perguntas, processo, casos ou formulário; o modelo confirma lendo a ordem e o conteúdo.`;
  const h1 = (extr.headings || []).find((h) => h.nivel === 1 && h.visivel && !h.clone && h.texto);
  const chamada = nosSob(extr, secoes[secoes.length - 1].seletor).find((n) => ehHeading(n.tag) || n.tag === 'p');
  return resultado(true, 1, [achado({
    pagina: caminho, mensagem,
    evidencias: secoes.map((s, i) => ev(caminho, { seletor: s.seletor, trecho: tipos[i], valor: i + 1, contagem: 1 })),
    citacoes: citar(ctx, url, regra, h1 ? trVis(h1.texto.slice(0, 80)) : null, chamada ? trVis(chamada.texto.slice(0, 80)) : null),
  })]);
}, { exigeCss: true });

const RE_NUMERO_GRANDE = /^[+-]?[\d.,]+\s?(%|k|K|M|mi|mil)?\+?$/;
// Seções que aparecem na primeira dobra (1440x900): a abertura e, enquanto a soma das alturas ainda não passa da dobra, as seguintes
function secoesNaDobra(es) {
  const hero = heroDe(es);
  const itens = itensSecao(es);
  const i = hero ? itens.findIndex((s) => s.seletor === hero.seletor) : 0;
  if (i < 0 || !itens.length) return [];
  const out = [itens[i]];
  let fim = (hero ? hero.topoPx : 0) + itens[i].alturaPx;
  for (let j = i + 1; j < itens.length && fim < LE.dobraPx; j++) { out.push(itens[j]); fim += itens[j].alturaPx; }
  return out;
}
const detMetricas = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const secoes = secoesNaDobra(es);
  const arv = arvoreDe(extr);
  const h1 = (extr.headings || []).find((h) => h.nivel === 1 && h.visivel && !h.clone && h.texto);
  const h1Numero = !!h1 && RE_NUMERO_GRANDE.test(h1.texto.trim());
  let melhor = null;
  for (const s of secoes) {
    const raiz = arv.achar(s.seletor);
    if (!raiz) continue;
    const visitar = (n) => {
      const kids = filhosElemento(n);
      const porTag = new Map();
      for (const k of kids) { if (!porTag.has(k.tag)) porTag.set(k.tag, []); porTag.get(k.tag).push(k); }
      for (const g of porTag.values()) {
        const pares = g.filter((k) => {
          const textos = [...k.filhos.values()].flatMap((f) => f.textos.map((t) => t.texto));
          if (textos.length < 2) return false;
          return textos.some((t) => RE_NUMERO_GRANDE.test(t.trim()) && /\d/.test(t)) && textos.some((t) => !RE_NUMERO_GRANDE.test(t.trim()) && nPalavras(t) <= LE.metricasMaxPalavrasDaLegenda);
        });
        if (pares.length >= LE.metricasMinIrmaos && (!melhor || pares.length > melhor.pares.length)) melhor = { n, pares };
      }
      for (const k of n.filhos.values()) visitar(k);
    };
    visitar(raiz);
  }
  if (!melhor && !h1Numero) return resultado(false);
  const partes = [];
  if (melhor) partes.push(`${melhor.pares.length} pares de número e legenda curta repetidos`);
  if (h1Numero) partes.push('o título principal é só um número');
  const mensagem = `Na primeira dobra há ${partes.join(' e ')}; o tamanho da fonte e o sentido da unidade ficam para o modelo julgar na captura.`;
  const textos = melhor ? melhor.pares.slice(0, 3).flatMap((k) => [...k.filhos.values()].slice(0, 1).map((f) => textoDoNo(f))) : [h1.texto.slice(0, 40)];
  return resultado(true, h1Numero ? 1 : melhor.pares.length / LE.metricasParesParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { seletor: melhor?.n.caminho, trecho: partes.join('; '), valor: melhor ? melhor.pares.length : 1, contagem: melhor ? melhor.pares.length : 1 })],
    citacoes: citar(ctx, url, regra, ...textos.map((t) => trVis(t))),
  })]);
}, { exigeCss: true });

const RE_NUMERACAO = /^\s*0?\d{1,2}\s*(\/\s*\d{1,2}|[.\-–—:])?\s*$/;
const RE_PASSO = /\b(passo|etapa|step)\b/i;
const detNumeracao = porPagina(({ ctx, regra, url, caminho, extr }) => {
  const arv = arvoreDe(extr);
  const cands = [];
  (extr.nos || []).forEach((n, i) => {
    if (!n.visivel || n.clone || !n.texto || n.texto.length > 8 || !RE_NUMERACAO.test(n.texto)) return;
    if (/^(td|th|li)$/.test(n.tag) || /(^|>)ol(:nth-of-type\(\d+\))?(>|$)/.test(n.seletor)) return;
    const no = arv.achar(n.seletor);
    const pai = no?.pai;
    const vizinhos = pai ? [...pai.filhos.values()].flatMap((f) => f.textos.map((t) => t.texto)).join(' ') : '';
    if (RE_PASSO.test(vizinhos)) return;
    cands.push({ n, i, valor: parseInt(n.texto, 10), pai: pai?.caminho || '' });
  });
  // maior sequência 1,2,3... (valores crescentes de 1 em 1, em ordem de documento) em contêineres diferentes
  let melhor = [];
  for (let s = 0; s < cands.length; s++) {
    const seq = [cands[s]];
    for (let j = s + 1; j < cands.length; j++) if (cands[j].valor === seq[seq.length - 1].valor + 1) seq.push(cands[j]);
    if (seq.length > melhor.length) melhor = seq;
  }
  if (unico(melhor.map((c) => c.pai)).length < LE.numeracaoMinSecoes || melhor.length < LE.numeracaoMinSecoes) return resultado(false);
  const mensagem = `${melhor.length} seções ou blocos em sequência têm numeração curta (${lista(melhor.map((c) => `"${c.n.texto.trim()}"`), 4)}) fora de lista ordenada e sem as palavras passo ou etapa; o modelo confirma se a ordem importa.`;
  return resultado(true, melhor.length / LE.numeracaoSecoesParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: melhor.slice(0, 4).map((c) => ev(caminho, { seletor: c.n.seletor, trecho: c.n.texto, valor: c.valor, contagem: 1, visivel: true })),
    citacoes: citar(ctx, url, regra, ...melhor.slice(0, 3).map((c) => trVis(c.n.texto.trim()))),
  })]);
});

const RE_ROTULO_EXCLUIDO = /^(a|th|label|nav|time|figcaption|button|h[1-6])$/;
const detRotuloCurto = porPagina(({ ctx, regra, url, caminho, extr }) => {
  const nos = extr.nos || [];
  const pai = (sel) => sel.split('>').slice(0, -1).join('>');
  const achados = [];
  nos.forEach((h, k) => {
    if (!h.visivel || h.clone || !(h.tag === 'h1' || h.tag === 'h2') || k === 0) return;
    const r = nos[k - 1];
    if (!r || !r.visivel || r.clone || !r.texto || RE_ROTULO_EXCLUIDO.test(r.tag)) return;
    if (nPalavras(r.texto) > LE.rotuloMaxPalavras) return;
    const pH = pai(h.seletor);
    const pR = pai(r.seletor);
    const irmao = pR === pH || (pR.startsWith(`${pH}>`) && pR.split('>').length - pH.split('>').length <= 1);
    if (!irmao) return;
    achados.push({ rotulo: r, titulo: h });
  });
  if (achados.length < LE.rotuloMinSecoes) return resultado(false);
  const mensagem = `${achados.length} títulos (h1 ou h2) têm logo antes um rótulo curto de até ${LE.rotuloMaxPalavras} palavras (${lista(achados.map((a) => `"${a.rotulo.texto.slice(0, 30)}"`), 3)}); o modelo aplica o teste de apagar a linha.`;
  return resultado(true, achados.length / LE.rotuloSecoesParaMax, [achado({
    pagina: caminho, mensagem,
    evidencias: achados.slice(0, 4).map((a) => ev(caminho, { seletor: a.rotulo.seletor, trecho: a.rotulo.texto, valor: nPalavras(a.rotulo.texto), contagem: 1, visivel: true })),
    citacoes: citar(ctx, url, regra, ...achados.slice(0, 3).map((a) => trVis(a.rotulo.texto.slice(0, 60)))),
  })]);
});

const CORES_SEMAFORO = {
  vermelho: ['#ff5f56', '#ff5f57', '#ec6a5e', '#ff605c', '#fc615d'],
  amarelo: ['#ffbd2e', '#febc2e', '#f4bf4f', '#ffbd44', '#fdbc40'],
  verde: ['#27c93f', '#28c840', '#61c554', '#00ca4e', '#34c749'],
};
const RE_CLASSE_MOLDURA = /^(traffic-?lights?|window-?(dots|controls|buttons)|mac-?(dots|window|buttons)|browser-?(mock(up)?|frame|chrome|window|bar|dots)|mockup-?browser)$/i;
function detMolduraFalsa({ ctx, med, regra }) {
  if (!ctx?.paginas?.length) return null;
  const css = cssDoSite(ctx).texto.toLowerCase();
  const trio = Object.entries(CORES_SEMAFORO).map(([nome, hexs]) => ({ nome, hex: hexs.find((h) => css.includes(h)) })).filter((x) => x.hex);
  let porClasse = null;
  let urlClasse = null;
  for (const p of ctx.paginas) {
    const t = tagsDe(p).find((x) => classesDe(x).some((c) => RE_CLASSE_MOLDURA.test(c)));
    if (t) { porClasse = classesDe(t).find((c) => RE_CLASSE_MOLDURA.test(c)); urlClasse = p.url; break; }
  }
  const temTrio = trio.length === 3;
  if (!temTrio && !porClasse) return resultado(false);
  const url = urlClasse || paginasCss(med)?.paginas?.[0]?.url || ctx.paginas[0].url;
  const caminho = caminhoDe(url);
  const partes = [];
  if (temTrio) partes.push(`as três cores de bolinhas de janela (${trio.map((x) => x.hex).join(', ')}) estão no CSS`);
  if (porClasse) partes.push(`o HTML usa a classe "${porClasse}"`);
  const mensagem = `Sinal de janela de navegador desenhada na mão: ${partes.join(' e ')}; o modelo confirma na captura.`;
  return resultado(true, temTrio && porClasse ? 1 : 0.7, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { trecho: partes.join('; '), valor: temTrio ? trio.map((x) => x.hex).join(',') : porClasse, contagem: temTrio ? 3 : 1 })],
    citacoes: citar(ctx, url, regra, ...trio.map((x) => trCss(x.hex)), porClasse ? trHtml(porClasse) : null),
  })]);
}

const TERMOS_ILUSTRACAO = /(undraw|storyset|drawkit)/i;
const RE_SVG_EXCECAO = /(gr[aá]fico|chart|mapa|map|diagrama|logo)/i;
const detIlustracaoGenerica = porPagina(({ ctx, regra, pag, url, caminho, extr }) => {
  const achados = [];
  for (const i of extr.imagens || []) if (i.visivel && !i.clone && TERMOS_ILUSTRACAO.test(i.src || '')) achados.push({ rotulo: `imagem de biblioteca de ilustração (${TERMOS_ILUSTRACAO.exec(i.src)[1].toLowerCase()})`, termo: TERMOS_ILUSTRACAO.exec(i.src)[1].toLowerCase() });
  const css = cssDoSite(ctx);
  for (const d of css.decls) if (/^background(-image)?$/.test(d.prop) && TERMOS_ILUSTRACAO.test(d.valor)) achados.push({ rotulo: `fundo CSS de biblioteca de ilustração (${TERMOS_ILUSTRACAO.exec(d.valor)[1].toLowerCase()})`, termo: TERMOS_ILUSTRACAO.exec(d.valor)[1].toLowerCase(), css: d.texto });
  const html = pag.final?.html || '';
  const svgs = [];
  const reSvg = /<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/gi;
  let m;
  while ((m = reSvg.exec(html)) && svgs.length < 200) {
    const at = parseAttrs(m[1]);
    const corpo = m[2];
    if (RE_SVG_EXCECAO.test(`${at.class || ''} ${at['aria-label'] || ''} ${at.id || ''}`) || /<text\b/i.test(corpo)) continue;
    const vb = /([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(at.viewbox || '');
    const w = parseFloat(at.width) || (vb ? parseFloat(vb[3]) : 0);
    const h = parseFloat(at.height) || (vb ? parseFloat(vb[4]) : 0);
    if (w < LE.ilustracaoSvgMinPx || h < LE.ilustracaoSvgMinPx) continue;
    const curvas = (corpo.match(/\bd\s*=\s*"([^"]*)"/gi) || []).reduce((s, d) => s + (d.match(/[CcSsQqAa]/g) || []).length, 0);
    const fills = new Set((corpo.match(/\bfill\s*=\s*"(?!none)([^"]+)"/gi) || []).map((x) => x.toLowerCase()));
    if (curvas >= LE.ilustracaoSvgMinCurvas && fills.size >= LE.ilustracaoSvgMinPreenchimentos) svgs.push({ rotulo: `SVG inline de cena (${Math.round(w)}x${Math.round(h)} px, ${curvas} curvas, ${fills.size} preenchimentos)`, html: m[0].slice(0, 60) });
  }
  const todos = [...achados, ...svgs];
  if (!todos.length) return resultado(false);
  const mensagem = `${todos.length === 1 ? 'Foi achada' : 'Foram achadas'} ${todos.length} ${plural(todos.length, 'ilustração genérica', 'ilustrações genéricas')}: ${lista(todos.map((t) => t.rotulo), 2)}; o modelo confirma se é arte de banco ou desenho próprio.`;
  return resultado(true, todos.length > 1 ? 1 : 0.7, [achado({
    pagina: caminho, mensagem,
    evidencias: todos.slice(0, 3).map((t) => ev(caminho, { trecho: t.rotulo, valor: 1, contagem: 1 })),
    citacoes: citar(ctx, url, regra, ...todos.slice(0, 3).map((t) => [t.css && trCss(t.css), t.termo && trHtml(t.termo), t.html && trHtml(t.html)])),
  })]);
});

const detFechamentoEmail = porPagina(({ ctx, regra, url, caminho, extr, es }) => {
  const itens = itensSecao(es).filter((s) => !/^(header|footer)$/.test(s.tag));
  if (!itens.length) return resultado(false);
  const ultima = itens[itens.length - 1];
  const form = (extr.formularios || []).find((f) => f.visivel && !f.clone && (f.seletor === ultima.seletor || f.seletor.startsWith(`${ultima.seletor}>`))
    && (f.campos || []).some((c) => c.tipo === 'email' || /mail/i.test(c.nome || ''))
    && (f.campos || []).some((c) => c.tag === 'button' || /^(submit|button)$/i.test(c.tipo || '')));
  if (!form) return resultado(false);
  const texto = textoSob(extr, form.seletor, 60);
  const mensagem = 'A última seção antes do rodapé termina com um campo de e-mail e um botão de envio; o modelo confirma se a inscrição cabe no objetivo do site.';
  return resultado(true, 1, [achado({
    pagina: caminho, mensagem,
    evidencias: [ev(caminho, { seletor: form.seletor, trecho: 'formulário com campo de e-mail na última seção', valor: 1, contagem: 1 })],
    citacoes: citar(ctx, url, regra, texto ? trVis(texto) : null),
  })]);
}, { exigeCss: true });

const detBotoesDemais = porPagina(({ ctx, regra, pag, url, caminho, extr, es }) => {
  const hero = heroDe(es);
  if (!hero) return resultado(false);
  const acoes = acoesDe(pag);
  const botoes = nosSob(extr, hero.seletor).filter((n) => acoes.has(n.seletor));
  if (botoes.length < LE.botoesAberturaMin) return resultado(false);
  const mensagem = `A abertura tem ${botoes.length} botões (${lista(botoes.map((b) => `"${b.texto.slice(0, 25)}"`), 4)}); o mínimo que dispara é ${LE.botoesAberturaMin}.`;
  return resultado(true, (botoes.length - 2) / (LE.botoesAberturaParaMax - 2), [achado({
    pagina: caminho, mensagem,
    evidencias: botoes.slice(0, 4).map((b) => ev(caminho, { seletor: b.seletor, trecho: b.texto, valor: botoes.length, contagem: botoes.length, visivel: true })),
    citacoes: citar(ctx, url, regra, ...botoes.slice(0, 3).map((b) => trVis(b.texto.slice(0, 40)))),
  })]);
}, { exigeCss: true });

// ---------------------------------------------------------------------------------------------------------------------
export const detectores = {
  // movimento
  'mov-mesma-entrada-em-tudo': detMesmaEntrada,
  'mov-varias-coreografias-de-rolagem': detCoreografias,
  'mov-transicao-em-tudo': detTransicaoEmTudo,
  'mov-animar-propriedades-de-layout': detAnimarLayout,
  'mov-sem-reduced-motion': detSemReducedMotion,
  'mov-easing-com-quique': detEasingComQuique,
  'mov-hover-igual-em-todos': detHoverIgual,
  'mov-loop-infinito-sem-funcao': detLoopInfinito,
  'mov-movimento-automatico-sem-pausa': detMovimentoAutomatico,
  'mov-parallax-e-rolagem-sequestrada': detParallax,
  'mov-duracao-fora-da-faixa': detDuracaoForaDaFaixa,
  'mov-conteudo-invisivel-sem-js': detConteudoInvisivelSemJs,
  'mov-video-autoplay-mal-configurado': detVideoAutoplay,
  'mov-gif-animado-no-lugar-de-video': detGifPesado,
  'mov-cascata-de-atrasos-longa': detCascata,
  // layout e espaçamento
  'lay-padding-unico-em-tudo': detPaddingUnico,
  'lay-irmaos-com-espacamento-diferente': semDados,
  'lay-espacamento-fora-da-escala': detForaDaEscala,
  'lay-titulo-colado-no-bloco-anterior': semDados,
  'lay-respiro-curto-entre-secoes': detRespiroCurto,
  'lay-vao-sob-o-hero': semDados,
  'lay-ultimo-item-sozinho': detUltimoItemSozinho,
  'lay-bloco-de-texto-espremido': detTextoEspremido,
  'lay-caixa-apertada': semDados,
  'lay-parede-de-texto': detParedeDeTexto,
  'lay-dois-sticky-no-topo': detDoisSticky,
  'lay-texto-coberto': semDados,
  'lay-conteudo-estoura-caixa': semDados,
  'lay-espaco-assimetrico-de-secao': detAssimetriaSecao,
  'lay-alinhamento-esquerda-solto': semDados,
  // estrutura padrão (estr-produto-desenhado-no-lugar-de-captura é "julgamento": o motor não chama detector)
  'estr-hero-tres-cards': detHeroTresCards,
  'estr-cartoes-iguais-repetidos': detCartoesIguais,
  'estr-card-dentro-de-card': detCardDentroDeCard,
  'estr-centralizar-tudo': detCentralizarTudo,
  'estr-hero-centrado-empilhado': detHeroCentradoEmpilhado,
  'estr-ritmo-uniforme-de-secoes': detRitmoUniforme,
  'estr-esqueleto-hero-beneficios-chamada': detEsqueleto,
  'estr-abertura-com-numero-grande-e-metricas': detMetricas,
  'estr-numeracao-de-secoes': detNumeracao,
  'estr-rotulo-curto-sobre-titulos': detRotuloCurto,
  'estr-visual-vazio-no-lugar-de-imagem': semDados,
  'estr-moldura-falsa-de-navegador': detMolduraFalsa,
  'estr-ilustracao-generica-de-banco': detIlustracaoGenerica,
  'estr-fechamento-com-cadastro-de-email': detFechamentoEmail,
  'estr-abertura-com-botoes-demais': detBotoesDemais,
};
