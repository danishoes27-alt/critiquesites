// DETECTORES das regras de script/misto de acessibilidade (regras/acessibilidade.json), interação e estados
// (regras/interacao-estados.json) e responsividade (regras/responsividade.json).
//
// Contrato (lib/motor.mjs): cada detector recebe { ctx, med, regra } e devolve
//   null (não avaliável: medidor ausente/com erro, ou nenhum medidor entrega o fato: NUNCA vira "ok")
//   | { disparou, intensidade 0..1, achados:[{ pagina, mensagem, evidencias, citacoes, numeros_permitidos?, instavel? }] }.
// O detector só relata o que foi MEDIDO. Toda citação é pré-conferida aqui com o próprio verificador
// (lib/verificador.mjs): se um trecho não existe no código analisado, ele não é citado.
//
// FONTES DOS FATOS
//  - axe (lib/medidores/axe.mjs): violações por página; nós `suspeitoDeClone` e `ignoradasPorClone` não contam
//    (exceto em a11y-aria-hidden-em-elemento-focavel, que conta clones de propósito).
//  - css (lib/medidores/css.mjs): `dados.site.estatico` (CSS estático somado do site) e `dados.paginas[].mobile.estilos`
//    (estilos computados a 390 px). O resumo estático NÃO fica em `dados.paginas[].estatico` (ali só há arquivos/bytes).
//    Para detalhes por regra (transition, :hover > filho, vh) este módulo relê o CSS de ctx.ativos/<style> com o postcss.
//  - links (lib/medidores/links.mjs): `textoRepetidoSemContexto`.
//  - html (lib/medidores/html.mjs): meta viewport do HTML cru e do DOM final.
//  - ctx (paginas[].final.html / .extr / .mobile.extr, ativos): para o que nenhum medidor entrega (campos de formulário,
//    onclick, carrosséis, scripts); lido por um analisador de tag simples sobre o DOM serializado.
//
// REGRAS SEM DETECTOR "REAL" (devolvem null: nenhum medidor traz o fato e o detector não inventa):
//  a11y-contraste-componentes-ui, int-foco-invisivel-no-teclado, int-contraste-do-anel-de-foco, int-foco-coberto-por-elemento-fixo,
//  int-hover-sem-efeito, int-controle-pula-ao-focar, resp-conteudo-cortado-por-overflow, resp-campo-com-fonte-menor-que-16,
//  resp-menu-transborda-no-celular, resp-texto-colado-na-borda, resp-conteudo-sem-limite-em-tela-ultralarga,
//  resp-espacamento-de-texto-corta-conteudo (precisam de navegação por Tab, hover, retângulos de elementos, viewport de 1920 ou
//  injeção de CSS, que nenhum medidor faz hoje).
import postcss from 'postcss';
import { normalizarTexto, decodificarEntidades } from '../util.mjs';
import { montarCorpus, verificarCitacao } from '../verificador.mjs';

const D = {};
export const detectores = D;

// ---------------------------------------------------------------------------------------------------------------------
// utilitários gerais
// ---------------------------------------------------------------------------------------------------------------------
const NAO = () => ({ disparou: false, intensidade: 0, achados: [] });
const SIM = (intensidade, achados) => ({ disparou: true, intensidade: Math.max(0, Math.min(1, Number.isFinite(intensidade) ? intensidade : 1)), achados });
const semMedicao = () => null;
const listaE = (l) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`);
const q = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const br = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
const unicos = (a) => [...new Set(a)];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const norm = (s) => normalizarTexto(s);
const cortar = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function ev(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) r[k] = v;
  if (typeof r.trecho === 'string') r.trecho = r.trecho.slice(0, 200);
  return r;
}

function paginasFinais(ctx) {
  return (ctx?.paginas || []).filter((p) => p?.final?.extr).map((p) => ({ p, url: p.url, caminho: caminhoDe(p.url), extr: p.final.extr, html: p.final.html || '' }));
}
const paginaInicial = (ctx) => { const l = paginasFinais(ctx); return l.length ? l[0].caminho : '/'; };

// ---------------------------------------------------------------------------------------------------------------------
// citações: sempre pré-conferidas com o verificador
// ---------------------------------------------------------------------------------------------------------------------
const corposCache = new WeakMap();
function corpo(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  let c = corposCache.get(ctx);
  if (!c) { c = montarCorpus({ ...ctx, paginas: ctx.paginas || [], ativos: ctx.ativos || [] }); corposCache.set(ctx, c); }
  return c;
}
function valida(ctx, cit) {
  try { const c = corpo(ctx); return !!c && verificarCitacao(cit, c).ok; } catch { return false; }
}
function primeira(ctx, cits) {
  for (const c of cits) if (c && valida(ctx, c)) return c;
  return null;
}
const T = (valor, onde = 'html', extra = {}) => ({ tipo: 'trecho', valor, onde, versoes: ['final'], ...extra });
const juntar = (lista, nova) => { if (nova && !lista.some((c) => c.tipo === nova.tipo && c.valor === nova.valor && c.onde === nova.onde && JSON.stringify(c.contagem) === JSON.stringify(nova.contagem))) lista.push(nova); };

// candidatos de trecho (do mais específico ao mais curto) para uma marcação HTML; ≤ 120 caracteres.
function candidatosTag(raw, max = 120) {
  const s = cortar(raw, 600);
  const out = [];
  if (s.length <= max) out.push(s);
  else {
    const c = s.slice(0, max);
    const i = c.lastIndexOf(' ');
    if (i > 12) out.push(c.slice(0, i));
    out.push(c);
  }
  const m = /^<[a-zA-Z][\w:-]*(?:\s+[^\s=>]+(?:="[^"]*")?){0,2}/.exec(s);
  if (m) out.push(m[0].slice(0, max));
  return unicos(out);
}
function citarHtml(ctx, raw, url) {
  return primeira(ctx, candidatosTag(raw).map((c) => T(c, 'html', url ? { pagina: url } : {})));
}
// trecho de CSS: tenta o texto como está, sem espaço depois do ":", e por último só o seletor.
function citarCss(ctx, ...candidatos) {
  const lista = [];
  for (const c of candidatos.filter(Boolean)) {
    const s = cortar(c, 120);
    lista.push(s, s.replace(/:\s+/g, ':'));
  }
  return primeira(ctx, unicos(lista).map((c) => T(c, 'css')));
}
// último recurso para regras de opinião (o verificador exige um trecho real do site): o primeiro texto visível.
function ancoraVisivel(ctx) {
  for (const pg of paginasFinais(ctx)) {
    for (const n of pg.extr.nos || []) {
      if (!n.visivel || n.clone) continue;
      const t = cortar(n.texto, 50);
      if (t.length >= 4) { const c = primeira(ctx, [T(t, 'visivel', { pagina: pg.url })]); if (c) return c; }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// analisador de HTML (DOM final serializado): só o necessário, sem dependências
// ---------------------------------------------------------------------------------------------------------------------
const VAZIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RE_TOKEN = /<!--[\s\S]*?-->|<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<(textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/textarea\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;

function lerAtributos(txt) {
  const o = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(txt || ''))) {
    const nome = m[1].toLowerCase();
    if (!(nome in o)) o[nome] = decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return o;
}

export function analisarHtml(html) {
  const els = [];
  const pilha = [];
  const re = new RegExp(RE_TOKEN.source, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const s = m[0];
    if (s.startsWith('<!--')) continue;
    const topo = pilha.length ? pilha[pilha.length - 1] : null;
    if (m[1] || m[2]) {
      const nome = (m[1] || m[2]).toLowerCase();
      if (nome === 'style') continue;
      const ab = /^<[^\s>\/]+((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(s);
      els.push({ tag: nome, attrs: lerAtributos(ab ? ab[1] : ''), raw: ab ? ab[0] : s, ini: m.index, fimAb: m.index + (ab ? ab[0].length : s.length), iniFecha: m.index + s.lastIndexOf('</'), fim: m.index + s.length, pai: topo });
      continue;
    }
    if (m[3]) {
      const nome = m[3].toLowerCase();
      let i = pilha.length - 1;
      while (i >= 0 && pilha[i].tag !== nome) i--;
      if (i < 0) continue;
      for (let j = pilha.length - 1; j >= i; j--) { pilha[j].iniFecha = m.index; pilha[j].fim = m.index + s.length; }
      pilha.length = i;
      continue;
    }
    const nome = m[4].toLowerCase();
    const autoFecha = /\/\s*$/.test(m[5] || '');
    const el = { tag: nome, attrs: lerAtributos(m[5] || ''), raw: s, ini: m.index, fimAb: m.index + s.length, iniFecha: null, fim: null, pai: topo };
    els.push(el);
    if (VAZIOS.has(nome) || autoFecha) { el.iniFecha = el.fimAb; el.fim = el.fimAb; } else pilha.push(el);
  }
  for (const e of pilha) { e.iniFecha = html.length; e.fim = html.length; }
  return { html, els };
}
const parseCache = new WeakMap();
function parse(pg) {
  let r = parseCache.get(pg.p);
  if (!r || r.html !== pg.html) { r = analisarHtml(pg.html); parseCache.set(pg.p, r); }
  return r;
}
function textoDe(doc, el) {
  if (el.iniFecha === null || el.iniFecha === undefined) return '';
  const bruto = doc.html.slice(el.fimAb, el.iniFecha).replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
  return decodificarEntidades(bruto).replace(/\s+/g, ' ').trim();
}
const classesDe = (el) => String(el.attrs.class || '').toLowerCase().split(/\s+/).filter(Boolean);
function ancestrais(el) { const o = []; for (let a = el.pai; a; a = a.pai) o.push(a); return o; }
const temAtributo = (el, nome) => Object.prototype.hasOwnProperty.call(el.attrs, nome);
function escondidoPeloHtml(el) {
  for (const a of [el, ...ancestrais(el)]) {
    if (temAtributo(a, 'hidden')) return true;
    if (String(a.attrs['aria-hidden']).toLowerCase() === 'true') return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.attrs.style || '')) return true;
  }
  return false;
}
const dentroDe = (el, tags) => ancestrais(el).some((a) => tags.includes(a.tag));

// ---------------------------------------------------------------------------------------------------------------------
// CSS: relê o CSS carregado (arquivos + <style>) para os detalhes que o medidor não resume
// ---------------------------------------------------------------------------------------------------------------------
const scanCache = new WeakMap();
function scanCss(ctx) {
  if (scanCache.has(ctx)) return scanCache.get(ctx);
  const textos = [];
  const vistos = new Set();
  const add = (t) => { if (t && t.trim() && !vistos.has(t)) { vistos.add(t); textos.push(t); } };
  for (const a of ctx.ativos || []) if (a.tipo === 'css' && a.texto) add(a.texto);
  for (const p of ctx.paginas || []) for (const t of p.final?.extr?.estilosInline || []) add(t);
  const regras = [];
  for (const t of textos) {
    let root;
    try { root = postcss.parse(t); } catch { continue; }
    root.walkRules((rule) => {
      const pai = rule.parent;
      if (pai && pai.type === 'atrule' && /keyframes$/i.test(pai.name)) return;
      const midia = [];
      for (let a = rule.parent; a && a.type !== 'root'; a = a.parent) if (a.type === 'atrule') midia.unshift(`@${a.name} ${a.params}`);
      const decls = [];
      rule.each((n) => { if (n.type === 'decl') decls.push({ prop: n.prop.toLowerCase(), valor: String(n.value), txt: n.toString(), important: !!n.important }); });
      regras.push({ seletor: rule.selector, seletores: (rule.selectors || [rule.selector]).map((s) => s.replace(/\s+/g, ' ').trim()), decls, midia: midia.join(' '), txt: rule.selector });
    });
  }
  scanCache.set(ctx, regras);
  return regras;
}

function cssEstatico(med) {
  const c = med && med.css;
  if (!c || c.erro || !c.dados || !c.dados.site || !c.dados.site.estatico) return null;
  return c.dados.site.estatico;
}
function cssPaginas(med) {
  const c = med && med.css;
  if (!c || c.erro || !c.dados || !Array.isArray(c.dados.paginas)) return null;
  return c.dados.paginas;
}
const RE_INTERATIVO = /(^|[\s>+~,(])(a|button|input|select|textarea|summary)(?![\w-])|\[tabindex|\[role=["']?(button|link)|(^|\s)\*(\s|$|:)|:focus|:focus-visible|:focus-within|\.[\w-]*(btn|button|botao|link|input|field|cta)[\w-]*/i;
const baseDe = (sel) => sel.replace(/:(focus-visible|focus-within|focus|hover|active|disabled)/gi, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------------------------
// AXE: coleta e montagem de achados
// ---------------------------------------------------------------------------------------------------------------------
function axeMedido(med) {
  const a = med && med.axe;
  if (!a || a.erro || !a.dados || a.dados.indisponivel) return null;
  const pags = (a.dados.porPagina || []).filter((p) => p && !p.erro);
  return pags.length ? pags : null;
}

function coletarAxe(med, ids, { suspeitos = false, clones = false } = {}) {
  const pags = axeMedido(med);
  if (!pags) return null;
  const a = { total: 0, paginasAfetadas: 0, paginasMedidas: pags.length, porId: {}, nos: [], porPagina: new Map(), clones: 0, incompletos: 0, pior: null, impactos: new Set() };
  for (const p of pags) {
    const caminho = caminhoDe(p.url);
    let totalPg = 0;
    for (const v of p.violacoes || []) {
      if (!ids.includes(v.id)) continue;
      const lista = v.nos || [];
      const ok = lista.filter((n) => suspeitos || !n.suspeitoDeClone);
      const nSusp = lista.length - ok.length;
      const tot = Math.max(0, (v.nosTotal || 0) - nSusp);
      if (clones) a.clones += v.nosIgnoradosPorClone || 0;
      if (tot <= 0) continue;
      a.porId[v.id] = (a.porId[v.id] || 0) + tot;
      a.total += tot;
      totalPg += tot;
      if (v.impacto) a.impactos.add(v.impacto);
      for (const n of ok) a.nos.push({ url: p.url, caminho, id: v.id, impacto: v.impacto, ajuda: v.ajuda, no: n, totalId: tot });
    }
    if (clones) for (const v of p.ignoradasPorClone || []) if (ids.includes(v.id)) a.clones += v.nosIgnoradosPorClone || 0;
    for (const v of p.incompletos || []) if (ids.includes(v.id)) a.incompletos += v.nosTotal || 0;
    if (totalPg) { a.paginasAfetadas++; a.porPagina.set(caminho, totalPg); }
  }
  a.pior = [...a.porPagina.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0]?.[0] ?? null;
  return a;
}

const emPaginas = (a) => (a.paginasAfetadas > 1 ? ` (em ${a.paginasAfetadas} páginas)` : '');

function montarAxe(ctx, a, mensagem, numeros = []) {
  const evidencias = a.nos.slice(0, 6).map((n) => ev({ pagina: n.caminho, versao: 'final', seletor: n.no.seletor, trecho: n.no.html, valor: `${n.id} (${n.impacto})`, contagem: n.totalId, visivel: true }));
  const citacoes = [];
  for (const n of a.nos) {
    if (citacoes.length >= 3) break;
    juntar(citacoes, citarHtml(ctx, n.no.html, n.url));
  }
  return { pagina: a.pior || paginaInicial(ctx), mensagem, evidencias, citacoes, numeros_permitidos: [a.total, a.paginasAfetadas, ...numeros] };
}

function detectorAxe(cfg) {
  return ({ ctx, med }) => {
    const a = coletarAxe(med, cfg.ids, cfg);
    if (!a) return null;
    const total = a.total + (cfg.clones ? a.clones : 0);
    if (total <= 0) return NAO();
    const msg = cfg.mensagem({ ...a, total, p: emPaginas(a) });
    const ach = montarAxe(ctx, a, msg, [total, ...(cfg.numeros || [])]);
    return SIM(1, [ach]);
  };
}

const AXE = {
  'a11y-imagem-sem-alt': { ids: ['image-alt', 'input-image-alt', 'area-alt'], mensagem: (a) => `${q(a.total, 'imagem sem', 'imagens sem')} texto alternativo (alt)${a.p}. Quem usa leitor de tela não fica sabendo o que ${a.total === 1 ? 'ela mostra' : 'elas mostram'}.` },
  'a11y-botao-sem-nome': { ids: ['button-name', 'input-button-name', 'aria-command-name'], mensagem: (a) => `${q(a.total, 'botão sem', 'botões sem')} nome acessível${a.p}: o leitor de tela anuncia só "botão", sem dizer o que ele faz.` },
  'a11y-link-sem-nome': { ids: ['link-name'], mensagem: (a) => `${q(a.total, 'link sem', 'links sem')} texto nem nome acessível${a.p}: o leitor de tela não consegue dizer para onde ele leva.` },
  'a11y-link-so-por-cor': { ids: ['link-in-text-block'], mensagem: (a) => `${q(a.total, 'link dentro de texto se distingue', 'links dentro de texto se distinguem')} do texto ao redor só pela cor${a.p}, sem sublinhado nem outro sinal. Quem não enxerga bem as cores não percebe que é link.` },
  'a11y-titulo-da-pagina-ausente': { ids: ['document-title'], mensagem: (a) => `${q(a.total, 'página sem', 'páginas sem')} título (title) ou com o título vazio. Quem usa leitor de tela, ou tem várias abas abertas, não sabe em que página está.` },
  'a11y-campo-sem-rotulo': { ids: ['label', 'select-name', 'aria-input-field-name', 'form-field-multiple-labels'], mensagem: (a) => `${q(a.total, 'campo de formulário sem', 'campos de formulário sem')} rótulo ligado a ${a.total === 1 ? 'ele' : 'eles'}${a.p} (ou com rótulos demais). Quem usa leitor de tela não sabe o que preencher.` },
  'a11y-nome-acessivel-difere-do-texto': { ids: ['label-content-name-mismatch'], mensagem: (a) => `${q(a.total, 'controle tem', 'controles têm')} nome acessível que não inclui o texto que aparece na tela${a.p}. Quem controla o site por voz diz o que lê e o comando não funciona.` },
  'a11y-autocomplete-incorreto': { ids: ['autocomplete-valid'], mensagem: (a) => `${q(a.total, 'campo tem', 'campos têm')} um valor de autocomplete inválido ou fora do lugar${a.p}. O navegador não consegue preencher os dados da pessoa sozinho.` },
  'a11y-sem-regiao-principal': { ids: ['landmark-one-main', 'landmark-no-duplicate-main', 'landmark-main-is-top-level'], mensagem: (a) => `A página não tem uma única região principal (main) bem posicionada${a.p}. Quem usa leitor de tela não consegue pular direto para o conteúdo.` },
  'a11y-sem-forma-de-pular-o-menu': { ids: ['bypass', 'skip-link'], mensagem: (a) => `Falta um jeito de pular o menu${a.p}: não há link "pular para o conteúdo" que funcione, nem região principal ou títulos que sirvam de atalho. Quem navega só pelo teclado precisa passar por todos os links do menu em cada página.` },
  'a11y-alvo-de-toque-pequeno': { ids: ['target-size'], numeros: [24], mensagem: (a) => `${q(a.total, 'alvo de clique ou toque menor', 'alvos de clique ou toque menores')} que 24 por 24 pixels e sem folga suficiente ao redor${a.p}. Fica difícil acertar com o dedo ou com o mouse.` },
  'a11y-video-sem-legenda': { ids: ['video-caption'], mensagem: (a) => `${q(a.total, 'vídeo sem', 'vídeos sem')} legenda${a.p}. Quem não escuta o áudio perde o conteúdo.` },
  'a11y-aria-uso-invalido': { ids: ['aria-roles', 'aria-valid-attr', 'aria-valid-attr-value', 'aria-allowed-attr', 'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-prohibited-attr', 'aria-deprecated-role', 'aria-conditional-attr'], mensagem: (a) => `${q(a.total, 'uso inválido', 'usos inválidos')} de ARIA${a.p}: atributos ou papéis que não existem, não combinam com o elemento ou faltam peças. O leitor de tela pode anunciar errado ou ignorar o elemento.` },
  'a11y-aria-hidden-em-elemento-focavel': {
    ids: ['aria-hidden-focus', 'aria-hidden-body'], clones: true,
    mensagem: (a) => `${q(a.total, 'elemento que recebe foco do teclado está', 'elementos que recebem foco do teclado estão')} dentro de uma área escondida do leitor de tela (aria-hidden)${a.p}${a.clones ? `, incluindo ${q(a.clones, 'dentro de cópia de carrossel', 'dentro de cópias de carrossel')}` : ''}. O teclado chega lá, mas o leitor de tela não anuncia nada.`,
  },
  'a11y-componente-aria-sem-nome': { ids: ['aria-dialog-name', 'aria-tooltip-name', 'aria-tab-name', 'aria-toggle-field-name', 'aria-meter-name', 'aria-progressbar-name', 'aria-treeitem-name'], mensagem: (a) => `${q(a.total, 'componente', 'componentes')} interativo${a.total === 1 ? '' : 's'} sem nome acessível${a.p} (janela, aba, interruptor, barra de progresso etc.). O leitor de tela não diz o que ${a.total === 1 ? 'ele é' : 'eles são'}.` },
  'a11y-iframe-sem-titulo': { ids: ['frame-title', 'frame-title-unique'], mensagem: (a) => `${q(a.total, 'quadro incorporado (iframe) sem', 'quadros incorporados (iframe) sem')} título, ou com título repetido${a.p}. O leitor de tela não diz o que o conteúdo embutido mostra.` },
  'a11y-svg-ou-role-img-sem-nome': { ids: ['svg-img-alt', 'role-img-alt', 'object-alt'], mensagem: (a) => `${q(a.total, 'imagem vetorial ou objeto sem', 'imagens vetoriais ou objetos sem')} nome acessível${a.p}. Quem usa leitor de tela não sabe o que ${a.total === 1 ? 'ele mostra' : 'eles mostram'}.` },
  'a11y-lista-ou-tabela-mal-estruturada': { ids: ['list', 'listitem', 'definition-list', 'dlitem', 'th-has-data-cells', 'td-headers-attr', 'scope-attr-valid', 'empty-table-header'], mensagem: (a) => `${q(a.total, 'lista ou tabela mal montada', 'listas ou tabelas mal montadas')}${a.p}: itens fora da lista ou cabeçalhos sem relação com os dados. O leitor de tela perde a estrutura.` },
  'a11y-espacamento-de-texto-travado': { ids: ['avoid-inline-spacing'], mensagem: (a) => `${q(a.total, 'elemento trava', 'elementos travam')} o espaçamento do texto com !important em estilo inline${a.p}. Quem precisa aumentar o espaçamento para ler melhor não consegue.` },
};
for (const [id, cfg] of Object.entries(AXE)) D[id] = detectorAxe(cfg);

// títulos vazios ou fora de ordem: mensagem por tipo
D['a11y-titulos-vazios-ou-fora-de-ordem'] = ({ ctx, med }) => {
  const a = coletarAxe(med, ['heading-order', 'empty-heading']);
  if (!a) return null;
  if (a.total <= 0) return NAO();
  const partes = [];
  if (a.porId['heading-order']) partes.push(`${q(a.porId['heading-order'], 'título pula', 'títulos pulam')} nível (por exemplo de h2 direto para h4)`);
  if (a.porId['empty-heading']) partes.push(`${q(a.porId['empty-heading'], 'título está', 'títulos estão')} vazio${a.porId['empty-heading'] === 1 ? '' : 's'}`);
  const msg = `Estrutura de títulos com problema${emPaginas(a)}: ${partes.join(' e ')}. Quem usa leitor de tela navega pelos títulos e se perde.`;
  return SIM(1, [montarAxe(ctx, a, msg, Object.values(a.porId))]);
};

// contraste de texto (axe color-contrast): a razão sai do resumo de falha do axe; "incomplete" nunca vira falha
D['a11y-contraste-texto-baixo'] = ({ ctx, med }) => {
  const a = coletarAxe(med, ['color-contrast']);
  if (!a) return null;
  if (a.total <= 0) return NAO();
  let pior = null;
  for (const n of a.nos) {
    const m = /insufficient color contrast of ([\d.]+)/i.exec(n.no.resumoDeFalha || '');
    if (m) { const r = Number(m[1]); if (pior === null || r < pior) pior = r; }
  }
  const nao = a.incompletos ? ` Há também ${q(a.incompletos, 'trecho', 'trechos')} com fundo de imagem ou degradê que não deu para medir (não verificável).` : '';
  const piorTxt = pior !== null ? ` O pior mede ${br(pior)} para 1.` : '';
  const msg = `${q(a.total, 'trecho de texto tem', 'trechos de texto têm')} contraste abaixo do mínimo${emPaginas(a)}: o mínimo é 4,5 para 1 no texto normal e 3 para 1 no texto grande.${piorTxt}${nao}`;
  const nums = [4.5, 3, a.incompletos, ...(pior !== null ? [pior] : [])];
  return SIM(1, [montarAxe(ctx, a, msg, nums)]);
};

// idioma da página: 4 regras do axe + comparação do lang do HTML cru com o do DOM final
D['a11y-idioma-da-pagina'] = ({ ctx, med }) => {
  const a = coletarAxe(med, ['html-has-lang', 'html-lang-valid', 'html-xml-lang-mismatch', 'valid-lang']);
  const hm = med && med.html && !med.html.erro && med.html.dados ? med.html.dados.paginas || [] : null;
  if (!a && !hm) return null;
  const difere = [];
  for (const p of hm || []) {
    const c = p.cru && p.cru.lang, f = p.final && p.final.lang;
    if (c && f && c.presente && f.presente && !c.vazio && !f.vazio && norm(c.valor) !== norm(f.valor)) difere.push({ caminho: p.caminho || caminhoDe(p.url), url: p.url, cru: c.valor, final: f.valor });
  }
  const total = (a ? a.total : 0) + difere.length;
  if (!total) return a ? NAO() : null;
  const base = a || { total: 0, paginasAfetadas: 0, nos: [], pior: null, porId: {} };
  const partes = [];
  if (a && a.total) partes.push(`${q(a.total, 'problema de idioma', 'problemas de idioma')} apontado${a.total === 1 ? '' : 's'} pelo verificador (lang ausente, inválido ou em conflito)${emPaginas(a)}`);
  if (difere.length) partes.push(`o idioma do HTML original (${difere[0].cru}) é diferente do idioma depois que o JavaScript roda (${difere[0].final})`);
  const msg = `${partes.join('; ')}. O leitor de tela escolhe a voz pelo idioma da página e lê com sotaque errado.`.replace(/^./, (c) => c.toUpperCase());
  const ach = a ? montarAxe(ctx, a, msg, [total]) : { pagina: difere[0].caminho, mensagem: msg, evidencias: [], citacoes: [], numeros_permitidos: [total] };
  for (const d of difere.slice(0, 2)) {
    ach.evidencias.push(ev({ pagina: d.caminho, versao: 'final', seletor: 'html', trecho: `lang cru=${d.cru}; final=${d.final}`, valor: `${d.cru} -> ${d.final}`, contagem: 1, visivel: true }));
    juntar(ach.citacoes, primeira(ctx, [T(`lang="${d.final}"`, 'html', { pagina: d.url })]));
  }
  if (!a) ach.pagina = difere[0].caminho;
  return SIM(1, [ach]);
};

// ---------------------------------------------------------------------------------------------------------------------
// zoom bloqueado / meta viewport
// ---------------------------------------------------------------------------------------------------------------------
const RE_ZOOM_A11Y = /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*[0-1](\.\d+)?\b/gi;
function viewportsDoHtml(med) {
  const h = med && med.html;
  if (!h || h.erro || !h.dados || !Array.isArray(h.dados.paginas)) return null;
  return h.dados.paginas;
}
function trechoViewport(ctx, valor, url, versoes) {
  const alvo = cortar(valor, 120);
  return primeira(ctx, [{ ...T(alvo, 'html', { pagina: url }), versoes }, { ...T(alvo, 'html'), versoes }]);
}

D['a11y-zoom-bloqueado'] = ({ ctx, med }) => {
  const a = coletarAxe(med, ['meta-viewport']);
  const pags = viewportsDoHtml(med);
  if (!a && !pags) return null;
  const achados = [];
  for (const p of pags || []) {
    const hits = [];
    for (const versao of ['cru', 'final']) {
      const v = p[versao] && p[versao].viewport;
      if (v && v.presente && v.valor) { const ms = v.valor.match(RE_ZOOM_A11Y); if (ms) hits.push({ versao, valor: v.valor, trecho: ms.join(' e ') }); }
    }
    if (hits.length) achados.push({ p, hits });
  }
  const total = (a ? a.total : 0) + achados.length;
  if (!total) return NAO();
  const ex = achados[0];
  const fragmento = ex ? ex.hits[ex.hits.length - 1].trecho : null;
  const msg = `A meta viewport${fragmento ? ` (${fragmento})` : ''} bloqueia ou limita o zoom${a && a.paginasAfetadas > 1 ? ` (em ${a.paginasAfetadas} páginas)` : ''}. Quem enxerga pouco precisa ampliar a página no celular e não consegue.`;
  const evidencias = [];
  const citacoes = [];
  for (const { p, hits } of achados.slice(0, 3)) {
    const h = hits[hits.length - 1];
    evidencias.push(ev({ pagina: p.caminho || caminhoDe(p.url), versao: h.versao, seletor: 'meta[name="viewport"]', trecho: h.valor, valor: h.trecho, contagem: 1 }));
    juntar(citacoes, trechoViewport(ctx, h.valor, p.url, hits.map((x) => x.versao)));
  }
  if (a) for (const n of a.nos.slice(0, 2)) { evidencias.push(ev({ pagina: n.caminho, versao: 'final', seletor: n.no.seletor, trecho: n.no.html, valor: `${n.id} (${n.impacto})`, contagem: n.totalId, visivel: true })); juntar(citacoes, citarHtml(ctx, n.no.html, n.url)); }
  return SIM(1, [{ pagina: ex ? (ex.p.caminho || caminhoDe(ex.p.url)) : (a.pior || paginaInicial(ctx)), mensagem: msg, evidencias, citacoes, numeros_permitidos: [total, a ? a.paginasAfetadas : 0] }]);
};

function lerViewport(valor) {
  const r = { userScalable: null, maxScale: null };
  for (const par of String(valor || '').split(/[,;]/)) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/i.exec(par);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].toLowerCase();
    if (k === 'user-scalable') r.userScalable = v;
    if (k === 'maximum-scale') { const n = parseFloat(v); r.maxScale = Number.isFinite(n) ? n : null; }
  }
  return r;
}
D['resp-zoom-bloqueado'] = ({ ctx, med }) => {
  const pags = viewportsDoHtml(med);
  if (!pags) return null;
  const achados = [];
  for (const p of pags) {
    const motivos = [];
    let usado = null;
    for (const versao of ['final', 'cru']) {
      const v = p[versao] && p[versao].viewport;
      if (!v || !v.presente || !v.valor) continue;
      const l = lerViewport(v.valor);
      const m = [];
      if (l.userScalable === 'no' || l.userScalable === '0') m.push('user-scalable=no');
      if (l.maxScale !== null && l.maxScale < 2) m.push(`maximum-scale=${l.maxScale}`);
      if (m.length) { motivos.push(...m); usado = usado || { versao, valor: v.valor }; }
    }
    if (motivos.length) achados.push({ p, motivos: unicos(motivos), usado });
  }
  if (!achados.length) return NAO();
  const ex = achados[0];
  const msg = `A meta viewport trava o zoom (${ex.motivos.join(' e ')})${achados.length > 1 ? `, em ${achados.length} páginas` : ''}. Quem enxerga pouco precisa ampliar a página no celular e não consegue.`;
  const evidencias = achados.slice(0, 3).map(({ p, motivos, usado }) => ev({ pagina: p.caminho || caminhoDe(p.url), versao: usado.versao, seletor: 'meta[name="viewport"]', trecho: usado.valor, valor: motivos.join(', '), contagem: 1 }));
  const citacoes = [];
  for (const { p, usado } of achados.slice(0, 3)) juntar(citacoes, trechoViewport(ctx, usado.valor, p.url, [usado.versao]));
  return SIM(1, [{ pagina: ex.p.caminho || caminhoDe(ex.p.url), mensagem: msg, evidencias, citacoes, numeros_permitidos: [achados.length, 2, ...ex.motivos.flatMap((m) => (m.match(/[\d.]+/g) || []).map(Number))] }]);
};

D['resp-sem-meta-viewport'] = ({ ctx, med }) => {
  const pags = viewportsDoHtml(med);
  if (!pags) return null;
  const ruins = [];
  let avaliadas = 0;
  for (const p of pags) {
    const v = p.final && p.final.viewport;
    if (!v) continue;
    avaliadas++;
    if (!v.presente) ruins.push({ p, tipo: 'ausente', valor: null });
    else if (!/width\s*=\s*device-width/i.test(v.valor || '')) ruins.push({ p, tipo: 'sem-largura', valor: v.valor });
  }
  if (!avaliadas) return null;
  if (!ruins.length) return NAO();
  const ex = ruins[0];
  const msg = ex.tipo === 'ausente'
    ? `A página não tem a meta viewport com width=device-width${ruins.length > 1 ? ` (${q(ruins.length, 'página', 'páginas')} sem ela)` : ''}. No celular ela aparece como a versão de computador encolhida, com texto miúdo.`
    : `A meta viewport existe, mas não tem width=device-width (valor atual: "${cortar(ex.valor, 80)}")${ruins.length > 1 ? `, em ${ruins.length} páginas` : ''}. No celular a página aparece encolhida, com texto miúdo.`;
  const evidencias = ruins.slice(0, 3).map(({ p, tipo, valor }) => ev({ pagina: p.caminho || caminhoDe(p.url), versao: 'final', seletor: 'meta[name="viewport"]', trecho: valor ?? 'ausente', valor: tipo, contagem: tipo === 'ausente' ? 0 : 1 }));
  const citacoes = [];
  for (const { p, tipo, valor } of ruins.slice(0, 3)) {
    if (tipo === 'sem-largura') juntar(citacoes, trechoViewport(ctx, valor, p.url, ['final']));
    else juntar(citacoes, primeira(ctx, [T('<head>', 'html', { pagina: p.url }), T('<head', 'html', { pagina: p.url })]));
  }
  const nums = ex.valor ? (ex.valor.match(/[\d.]+/g) || []).map(Number).filter(Number.isFinite) : [];
  return SIM(1, [{ pagina: ex.p.caminho || caminhoDe(ex.p.url), mensagem: msg, evidencias, citacoes, numeros_permitidos: [ruins.length, ...nums] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// a11y-link-texto-repetido-sem-contexto (links): o caso nº 1
// ---------------------------------------------------------------------------------------------------------------------
D['a11y-link-texto-repetido-sem-contexto'] = ({ ctx, med }) => {
  const m = med && med.links;
  if (!m || m.erro || !m.dados || !Array.isArray(m.dados.textoRepetidoSemContexto)) return null;
  const grupos = [...m.dados.textoRepetidoSemContexto].sort((a, b) => b.contagem - a.contagem || cmp(a.pagina, b.pagina) || cmp(a.textoNormalizado, b.textoNormalizado));
  if (!grupos.length) return NAO();
  const achados = [];
  for (const g of grupos.slice(0, 5)) {
    const pg = paginasFinais(ctx).find((x) => x.caminho === g.pagina);
    const url = pg ? pg.url : undefined;
    const destinos = g.mesmoDestino ? 'e todos levam ao mesmo lugar' : `e levam a ${g.hrefsDistintos} destinos diferentes`;
    const contexto = g.contextoDistinto ? ' O texto ao redor de cada link (como o nome do item) ajuda quem enxerga a tela, mas não aparece quando o leitor de tela lista só os links.' : '';
    const mensagem = `Para quem usa leitor de tela, a lista de links da página repete o mesmo texto: ${g.contagem} links dizem só "${g.texto}", sem aria-label nem outro nome que os diferencie, ${destinos}. Quem navega por essa lista não sabe qual é qual.${contexto}`;
    const citacoes = [];
    const contagemCit = { tipo: 'contagem', contagem: { fn: 'links-com-texto', texto: g.texto, esperado: g.contagem }, versoes: ['final'], ...(url ? { pagina: url } : {}) };
    if (valida(ctx, contagemCit)) citacoes.push(contagemCit);
    juntar(citacoes, primeira(ctx, [T(g.texto, 'visivel', url ? { pagina: url } : {})]));
    if (pg) {
      const doc = parse(pg);
      const alvos = doc.els.filter((e) => e.tag === 'a' && temAtributo(e, 'href') && norm(textoDe(doc, e)) === g.textoNormalizado && !ancestrais(e).some((x) => String(x.attrs['aria-hidden']).toLowerCase() === 'true'));
      for (const e of alvos.slice(0, 3)) juntar(citacoes, citarHtml(ctx, e.raw, pg.url));
    }
    const evidencias = [ev({ pagina: g.pagina, versao: 'final', seletor: g.seletores.join(', '), trecho: g.texto, valor: `texto repetido sem diferenciador; destinos distintos=${g.hrefsDistintos}`, contagem: g.contagem, visivel: true })];
    achados.push({ pagina: g.pagina, mensagem, evidencias, citacoes, numeros_permitidos: [g.contagem, g.hrefsDistintos] });
  }
  return SIM(1, achados);
};

// ---------------------------------------------------------------------------------------------------------------------
// movimento automático (axe + <video>/<audio> com autoplay sem muted)
// ---------------------------------------------------------------------------------------------------------------------
D['a11y-movimento-automatico-sem-pausa'] = ({ ctx, med }) => {
  const a = coletarAxe(med, ['no-autoplay-audio', 'blink', 'marquee']);
  const midias = [];
  for (const pg of paginasFinais(ctx)) {
    const doc = parse(pg);
    for (const e of doc.els) {
      if ((e.tag === 'video' || e.tag === 'audio') && temAtributo(e, 'autoplay') && !temAtributo(e, 'muted') && !escondidoPeloHtml(e)) midias.push({ pg, e });
    }
  }
  if (!a && !midias.length) return null;
  const total = (a ? a.total : 0) + midias.length;
  if (!total) return NAO();
  const partes = [];
  if (a && a.total) partes.push(`${q(a.total, 'elemento com', 'elementos com')} movimento ou som automático apontado${a.total === 1 ? '' : 's'} pelo verificador (som que toca sozinho, texto piscando ou rolando)`);
  if (midias.length) partes.push(`${q(midias.length, 'vídeo ou áudio começa', 'vídeos ou áudios começam')} sozinho e sem estar mudo${midias.length === 1 ? '' : 's'}`);
  const msg = `${partes.join('; ').replace(/^./, (c) => c.toUpperCase())}. Quem se distrai com movimento, ou usa leitor de tela, precisa de um jeito de pausar ou parar.`;
  const ach = a ? montarAxe(ctx, a, msg, [total, midias.length]) : { pagina: midias[0].pg.caminho, mensagem: msg, evidencias: [], citacoes: [], numeros_permitidos: [total, midias.length] };
  for (const { pg, e } of midias.slice(0, 3)) {
    ach.evidencias.push(ev({ pagina: pg.caminho, versao: 'final', seletor: e.tag, trecho: e.raw, valor: 'autoplay sem muted', contagem: midias.length, visivel: true }));
    juntar(ach.citacoes, citarHtml(ctx, e.raw, pg.url));
  }
  if (!a) ach.pagina = midias[0].pg.caminho;
  return SIM(1, [ach]);
};

// ---------------------------------------------------------------------------------------------------------------------
// CSS estático: foco, reduced-motion, micro-estados
// ---------------------------------------------------------------------------------------------------------------------
function outlineSemSubstituto(est) {
  const o = est.estados.outlineNone || {};
  const itens = (o.itensSemSubstituto || []).filter((i) => i.emFoco || RE_INTERATIVO.test(i.seletor || ''));
  const resto = Math.max(0, (o.semSubstituto || 0) - (o.itensSemSubstituto || []).length);
  return { itens, total: itens.length + resto };
}
function achadoOutline(ctx, est, mensagem, itens, total, extraNums = []) {
  const evidencias = itens.slice(0, 5).map((i) => ev({ pagina: paginaInicial(ctx), versao: 'final', seletor: i.seletor, trecho: `${i.seletor} { ${i.valor} }`, valor: i.valor, contagem: total }));
  const citacoes = [];
  for (const i of itens) {
    if (citacoes.length >= 3) break;
    juntar(citacoes, citarCss(ctx, `${i.seletor} { ${i.valor}`, i.valor, i.seletor));
  }
  return { pagina: paginaInicial(ctx), mensagem, evidencias, citacoes, numeros_permitidos: [total, ...extraNums] };
}
const exemplosSeletor = (itens) => itens.slice(0, 2).map((i) => `${i.seletor}`).join(' e ');

D['a11y-foco-do-teclado-invisivel'] = ({ ctx, med }) => {
  const est = cssEstatico(med);
  if (!est) return null;
  const { itens, total } = outlineSemSubstituto(est);
  if (total <= 0) return NAO();
  const msg = `O CSS tira o contorno de foco (${q(total, 'regra', 'regras')}, por exemplo ${exemplosSeletor(itens)}) sem colocar outro sinal visível no lugar. Quem navega pelo teclado perde a noção de onde está. (Só o CSS foi examinado; a navegação por Tab não foi testada.)`;
  return SIM(1, [achadoOutline(ctx, est, msg, itens, total)]);
};

D['int-contorno-de-foco-removido'] = ({ ctx, med }) => {
  const est = cssEstatico(med);
  if (!est) return null;
  const { itens, total } = outlineSemSubstituto(est);
  const semArquivos = (est.arquivos && est.arquivos.baixadosSemTexto ? est.arquivos.baixadosSemTexto.length : 0) > 0;
  const nenhumaRegra = est.regras > 0 && !est.estados.focus && !est.estados.focusVisible && !semArquivos;
  if (total <= 0 && !nenhumaRegra) return NAO();
  const partes = [];
  if (total > 0) partes.push(`o CSS remove o contorno de foco (${q(total, 'regra', 'regras')}, por exemplo ${exemplosSeletor(itens)}) sem criar outro sinal visível no lugar`);
  if (nenhumaRegra) partes.push('o CSS inteiro não tem nenhuma regra :focus nem :focus-visible, então ninguém desenhou o foco do teclado');
  const msg = `${partes.join('; ').replace(/^./, (c) => c.toUpperCase())}. Quem navega pelo teclado precisa ver onde está o foco.`;
  const ach = achadoOutline(ctx, est, msg, itens, total, [est.regras]);
  if (nenhumaRegra && !itens.length) ach.evidencias.push(ev({ pagina: paginaInicial(ctx), versao: 'final', trecho: 'nenhuma regra :focus nem :focus-visible no CSS analisado', valor: 0, contagem: 0 }));
  return SIM(1, [ach]);
};

D['a11y-animacao-sem-reduced-motion'] = ({ ctx, med }) => {
  const est = cssEstatico(med);
  if (!est) return null;
  const mv = est.movimento;
  const sinais = mv.transicoes + mv.animacoes + mv.keyframes.length;
  if (!sinais || est.mediaQueries.prefersReducedMotion > 0) return NAO();
  const scan = scanCss(ctx);
  const citacoes = [];
  if (mv.keyframes.length) juntar(citacoes, citarCss(ctx, `@keyframes ${mv.keyframes[0]}`));
  for (const r of scan) {
    if (citacoes.length >= 2) break;
    const d = r.decls.find((x) => /^(animation|animation-name|transition|transition-property)$/.test(x.prop) && !/^(none|initial|inherit|unset)$/i.test(x.valor.trim()));
    if (d) juntar(citacoes, citarCss(ctx, d.txt, `${r.seletor} { ${d.txt}`, r.seletor));
  }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const partes = [];
  if (mv.keyframes.length) partes.push(q(mv.keyframes.length, '@keyframes', '@keyframes'));
  if (mv.animacoes) partes.push(q(mv.animacoes, 'animação', 'animações'));
  if (mv.transicoes) partes.push(q(mv.transicoes, 'transição', 'transições'));
  const msg = `O CSS tem ${listaE(partes)}, mas nenhum bloco @media (prefers-reduced-motion: reduce) para desligar ou reduzir o movimento. Quem sente enjoo ou tontura com animação não tem como pedir menos movimento.`;
  const evidencias = [ev({ pagina: paginaInicial(ctx), versao: 'final', trecho: `${mv.transicoes} transições, ${mv.animacoes} animações e ${mv.keyframes.length} @keyframes sem @media (prefers-reduced-motion)`, valor: sinais, contagem: sinais })];
  return SIM(1, [{ pagina: paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [mv.keyframes.length, mv.animacoes, mv.transicoes] }]);
};

const NOMES_GRUPO = { button: 'botões', a: 'links', input: 'campos de texto', select: 'caixas de seleção', textarea: 'áreas de texto' };
D['int-micro-estados-ausentes'] = ({ ctx, med }) => {
  const est = cssEstatico(med);
  if (!est) return null;
  const sem0 = est.estados.gruposSemNenhumEstado || [];
  const presentes = new Set();
  const primeiras = {};
  for (const pg of paginasFinais(ctx)) {
    const doc = parse(pg);
    for (const e of doc.els) {
      let g = null;
      if (e.tag === 'button') g = 'button';
      else if (e.tag === 'a' && temAtributo(e, 'href')) g = 'a';
      else if (e.tag === 'input' && !/^(hidden)$/i.test(e.attrs.type || '')) g = 'input';
      else if (e.tag === 'select' || e.tag === 'textarea') g = e.tag;
      if (!g) continue;
      presentes.add(g);
      if (!primeiras[g]) primeiras[g] = { pg, e };
    }
  }
  if (!presentes.size) return NAO();
  const sem = sem0.filter((g) => presentes.has(g));
  if (sem.length < 2) return NAO();
  const citacoes = [];
  for (const g of sem) { if (citacoes.length >= 3) break; const x = primeiras[g]; if (x) juntar(citacoes, citarHtml(ctx, x.e.raw, x.pg.url)); }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const nomes = sem.map((g) => NOMES_GRUPO[g]).join(', ');
  const msg = `No CSS, ${q(sem.length, 'grupo de elementos não tem', 'grupos de elementos não têm')} nenhum estado definido (nem hover, nem foco, nem ativo): ${nomes}. A pessoa clica ou passa o mouse e não recebe resposta visual.`;
  const evidencias = sem.map((g) => ev({ pagina: primeiras[g] ? primeiras[g].pg.caminho : paginaInicial(ctx), versao: 'final', seletor: g, trecho: `${g}: sem :hover, sem foco e sem :active`, valor: g, contagem: 0 }));
  return SIM(sem.length / presentes.size, [{ pagina: paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [sem.length, presentes.size] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// CSS por regra (postcss): anel de foco com fade, menu só com hover, desabilitado só por opacidade, altura em vh
// ---------------------------------------------------------------------------------------------------------------------
const RE_TEMPO = /^[\d.]+m?s$/i;
const emMs = (t) => (/ms$/i.test(t) ? parseFloat(t) : parseFloat(t) * 1000);
function transicoesComDuracao(decls) {
  const props = new Set();
  let propLista = null, durLista = null;
  for (const d of decls) {
    if (d.prop === 'transition') {
      for (const item of d.valor.split(/,(?![^(]*\))/)) {
        const t = item.trim().split(/\s+/).filter(Boolean);
        if (!t.length || /^(none|initial|inherit|unset)$/i.test(t[0])) continue;
        const tempo = t.find((x) => RE_TEMPO.test(x));
        if (!tempo || !(emMs(tempo) > 0)) continue;
        const prop = t.find((x) => !RE_TEMPO.test(x) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(x) && !/\(/.test(x));
        props.add((prop || 'all').toLowerCase());
      }
    } else if (d.prop === 'transition-property') propLista = d.valor.split(',').map((x) => x.trim().toLowerCase());
    else if (d.prop === 'transition-duration') durLista = d.valor.split(',').map((x) => x.trim());
  }
  if (propLista && durLista && durLista.some((x) => RE_TEMPO.test(x) && emMs(x) > 0)) for (const p of propLista) if (p !== 'none') props.add(p);
  return props;
}

D['int-anel-de-foco-com-fade'] = ({ ctx, med }) => {
  if (!cssEstatico(med)) return null;
  const regras = scanCss(ctx);
  const trans = new Map();
  for (const r of regras) {
    const props = transicoesComDuracao(r.decls);
    if (!props.size) continue;
    const decl = r.decls.find((d) => d.prop.startsWith('transition'));
    for (const s of r.seletores) {
      if (/:(hover|active|focus|disabled)/i.test(s)) continue;
      const b = baseDe(s);
      if (!RE_INTERATIVO.test(b)) continue;
      if (!trans.has(b)) trans.set(b, { props: new Set(), decl, regra: r });
      for (const p of props) trans.get(b).props.add(p);
    }
  }
  const hits = [];
  for (const r of regras) {
    const usadas = unicos(r.decls.map((d) => d.prop).filter((p) => /^(outline|outline-color|outline-width|outline-style|outline-offset|box-shadow|border-color)$/.test(p)));
    if (!usadas.length) continue;
    for (const s of r.seletores) {
      if (!/:focus-visible/i.test(s)) continue;
      const t = trans.get(baseDe(s));
      if (!t) continue;
      const casa = t.props.has('all') || (usadas.some((p) => p.startsWith('outline')) && (t.props.has('outline') || t.props.has('outline-color'))) || (usadas.includes('box-shadow') && t.props.has('box-shadow')) || (usadas.includes('border-color') && t.props.has('border-color'));
      if (casa) hits.push({ seletor: s, base: baseDe(s), t, foco: r });
    }
  }
  if (!hits.length) return NAO();
  const h = hits[0];
  const citacoes = [];
  juntar(citacoes, citarCss(ctx, h.t.decl.txt, `${h.t.regra.seletor} { ${h.t.decl.txt}`, h.t.regra.seletor));
  juntar(citacoes, citarCss(ctx, h.seletor));
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `O anel de foco aparece com transição (fade): ${q(hits.length, 'seletor', 'seletores')} com transição na mesma propriedade que o :focus-visible usa, como ${h.base}. Quem navega pelo teclado vê o foco chegar atrasado.`;
  const evidencias = hits.slice(0, 4).map((x) => ev({ pagina: paginaInicial(ctx), versao: 'final', seletor: x.seletor, trecho: x.t.decl.txt, valor: 'transição na propriedade do anel de foco', contagem: hits.length }));
  return SIM(1, [{ pagina: paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length] }]);
};

const RE_REVELA = /^(display|visibility|opacity)$/;
function revela(d) {
  const v = d.valor.trim().toLowerCase();
  if (d.prop === 'display') return v !== 'none';
  if (d.prop === 'visibility') return v === 'visible';
  if (d.prop === 'opacity') return parseFloat(v) > 0;
  return false;
}
const compacto = (s) => s.replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ').trim();
D['int-menu-so-com-hover'] = ({ ctx, med }) => {
  if (!cssEstatico(med)) return null;
  const regras = scanCss(ctx);
  const alternativas = [];
  const reveladores = [];
  for (const r of regras) {
    for (const s0 of r.seletores) {
      const s = compacto(s0);
      const iH = s.search(/:hover(?![\w-])/i);
      if (iH >= 0) {
        const depois = s.slice(iH + 6);
        const filho = /^\s*[>+~ ]\s*([.#\[\w*].*)$/.exec(depois);
        if (filho && r.decls.some((d) => RE_REVELA.test(d.prop) && revela(d))) reveladores.push({ s: s0, filho: compacto(filho[1]), r });
      }
      if (/:focus-within|\[aria-expanded|\.(open|is-open|active|show|expanded|opened)(?![\w-])/i.test(s) && r.decls.some((d) => RE_REVELA.test(d.prop) && revela(d))) alternativas.push(s);
    }
  }
  const sem = reveladores.filter((h) => !alternativas.some((a) => a.includes(h.filho)));
  if (!sem.length) return NAO();
  const h = sem[0];
  const decl = h.r.decls.find((d) => RE_REVELA.test(d.prop) && revela(d));
  const citacoes = [];
  juntar(citacoes, citarCss(ctx, h.s));
  juntar(citacoes, citarCss(ctx, decl ? decl.txt : ''));
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `O CSS revela conteúdo só quando o mouse passa por cima (${q(sem.length, 'regra', 'regras')}, por exemplo ${cortar(h.s, 80)}), e não há regra equivalente com :focus-within, aria-expanded ou classe de aberto para o teclado ou o toque. Quem usa só o teclado pode não alcançar esse conteúdo.`;
  const evidencias = sem.slice(0, 4).map((x) => ev({ pagina: paginaInicial(ctx), versao: 'final', seletor: x.s, trecho: x.r.decls.map((d) => d.txt).join('; '), valor: ':hover revela filho', contagem: sem.length }));
  return SIM(1, [{ pagina: paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [sem.length] }]);
};

D['int-desabilitado-so-por-opacidade'] = ({ ctx, med }) => {
  if (!cssEstatico(med)) return null;
  const regras = scanCss(ctx);
  const porSeletor = new Map();
  for (const r of regras) {
    for (const s of r.seletores) {
      if (!/:disabled|\[disabled|\[aria-disabled\s*=\s*["']?true|(^|[\s.])(is-)?disabled(?![\w-])/i.test(s)) continue;
      if (!porSeletor.has(s)) porSeletor.set(s, []);
      porSeletor.get(s).push(...r.decls);
    }
  }
  const hits = [];
  for (const [s, decls] of porSeletor) {
    const op = decls.find((d) => d.prop === 'opacity');
    if (!op) continue;
    const cursorOk = decls.some((d) => d.prop === 'cursor' && /not-allowed|default/i.test(d.valor));
    const outroCanal = decls.some((d) => /^(color|background|background-color|border-color|filter|text-decoration)$/.test(d.prop));
    if (!cursorOk && !outroCanal) hits.push({ s, op });
  }
  if (!hits.length) return NAO();
  const h = hits[0];
  const citacoes = [];
  juntar(citacoes, citarCss(ctx, h.op.txt, `${h.s} { ${h.op.txt}`, h.s));
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `O estado desabilitado usa só a opacidade (${q(hits.length, 'seletor', 'seletores')}, por exemplo ${cortar(h.s, 60)}): não há cursor not-allowed nem mudança de cor ou fundo. Quem enxerga pouco, ou vê a tela com brilho alto, pode não notar que o controle está desligado.`;
  const evidencias = hits.slice(0, 4).map((x) => ev({ pagina: paginaInicial(ctx), versao: 'final', seletor: x.s, trecho: x.op.txt, valor: 'só opacity', contagem: hits.length }));
  return SIM(1, [{ pagina: paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length] }]);
};

D['resp-altura-em-vh'] = ({ ctx, med }) => {
  const pags = cssPaginas(med);
  if (!pags) return null;
  const regras = scanCss(ctx);
  let comHero = 0;
  const hits = [];
  for (const p of pags) {
    const hero = p.computado && p.computado.layout && p.computado.layout.heroes && p.computado.layout.heroes[0];
    if (!hero) continue;
    comHero++;
    const classes = String(hero.classe || '').toLowerCase().split(/\s+/).filter(Boolean);
    const id = (/^#([\w-]+)/.exec(hero.seletor || '') || [])[1] || null;
    const casa = (sel) => {
      const ultimo = compacto(sel).split(/[\s>+~]+/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, '');
      if (!ultimo) return false;
      const tag = (/^[a-z][\w-]*/i.exec(ultimo) || [])[0];
      const cls = (ultimo.match(/\.[\w-]+/g) || []).map((x) => x.slice(1).toLowerCase());
      const idc = (/#([\w-]+)/.exec(ultimo) || [])[1];
      if (idc && id && idc === id) return true;
      if (cls.length && cls.every((c) => classes.includes(c))) return true;
      if (tag && !cls.length && !idc && tag.toLowerCase() === hero.tag) return true;
      return false;
    };
    for (const r of regras) {
      for (const s of r.seletores) {
        if (!casa(s)) continue;
        for (const d of r.decls) {
          if (!/^(height|min-height|max-height)$/.test(d.prop)) continue;
          if (!/(?<![a-z])\d*\.?\d+vh\b/i.test(d.valor)) continue;
          const par = regras.some((r2) => r2.seletores.includes(s) && r2.decls.some((d2) => d2.prop === d.prop && /(?<![a-z])\d*\.?\d+(dvh|svh)\b/i.test(d2.valor)));
          if (!par) hits.push({ p, s, d, r, hero });
        }
      }
    }
  }
  if (!comHero) return null;
  if (!hits.length) return NAO();
  const h = hits[0];
  const citacoes = [];
  juntar(citacoes, citarCss(ctx, h.d.txt, `${h.d.prop}: ${h.d.valor}`, h.s));
  const numeros = (h.d.valor.match(/[\d.]+/g) || []).map(Number);
  const msg = `A altura da abertura da página usa vh (${cortar(h.d.txt, 60)} em ${cortar(h.s, 60)}) sem a versão dvh ou svh no mesmo seletor. No celular, a barra do navegador faz a abertura passar da área realmente visível.`;
  const evidencias = hits.slice(0, 4).map((x) => ev({ pagina: caminhoDe(x.p.url), versao: 'final', seletor: x.s, trecho: x.d.txt, valor: `${x.d.prop}: ${x.d.valor}`, contagem: hits.length, visivel: true }));
  return SIM(1, [{ pagina: caminhoDe(h.p.url), mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length, ...numeros] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// HTML: campos de formulário
// ---------------------------------------------------------------------------------------------------------------------
const TIPOS_TEXTO = new Set(['', 'text', 'email', 'tel', 'password', 'search', 'url', 'number']);
function camposDe(pg) {
  const doc = parse(pg);
  const forms = doc.els.filter((e) => e.tag === 'form');
  const info = pg.extr.formularios || [];
  const rotulosPorFor = new Map();
  for (const e of doc.els) if (e.tag === 'label' && e.attrs.for) rotulosPorFor.set(e.attrs.for, textoDe(doc, e));
  const campos = [];
  for (const e of doc.els) {
    if (!['input', 'select', 'textarea'].includes(e.tag)) continue;
    const tipo = e.tag === 'input' ? String(e.attrs.type || '').toLowerCase() : e.tag;
    if (e.tag === 'input' && !TIPOS_TEXTO.has(tipo)) continue;
    if (escondidoPeloHtml(e)) continue;
    const form = ancestrais(e).find((a) => a.tag === 'form');
    if (form) { const i = forms.indexOf(form); const f = info[i]; if (f && (!f.visivel || f.clone)) continue; }
    const labelPai = ancestrais(e).find((a) => a.tag === 'label');
    const rotuloTexto = (labelPai ? textoDe(doc, labelPai) : '') || (e.attrs.id ? rotulosPorFor.get(e.attrs.id) || '' : '');
    const temRotulo = !!(labelPai || (e.attrs.id && rotulosPorFor.has(e.attrs.id)) || String(e.attrs['aria-label'] || '').trim() || String(e.attrs['aria-labelledby'] || '').trim() || String(e.attrs.title || '').trim());
    campos.push({ e, tipo, temRotulo, rotuloTexto, pg });
  }
  return campos;
}

D['int-placeholder-no-lugar-do-rotulo'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  let candidatos = 0;
  const hits = [];
  for (const pg of pgs) {
    for (const c of camposDe(pg)) {
      if (c.tipo === 'select') continue;
      candidatos++;
      if (String(c.e.attrs.placeholder || '').trim() && !c.temRotulo) hits.push(c);
    }
  }
  if (!candidatos) return NAO();
  if (!hits.length) return NAO();
  const citacoes = [];
  for (const h of hits) { if (citacoes.length >= 3) break; juntar(citacoes, citarHtml(ctx, h.e.raw, h.pg.url)); }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `${q(hits.length, 'campo tem', 'campos têm')} só o texto de exemplo (placeholder) no lugar do rótulo, sem label, aria-label nem título. O exemplo some assim que a pessoa começa a digitar, e quem usa leitor de tela fica sem saber o que preencher.`;
  const evidencias = hits.slice(0, 5).map((h) => ev({ pagina: h.pg.caminho, versao: 'final', seletor: h.e.tag, trecho: h.e.raw, valor: `placeholder="${cortar(h.e.attrs.placeholder, 40)}" sem rótulo`, contagem: hits.length, visivel: true }));
  return SIM(hits.length / candidatos, [{ pagina: hits[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length, candidatos] }]);
};

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAPA_CAMPOS = [
  { tipo: 'email', re: /(?<![a-z])e-?mail/, typeEsperado: 'email', ac: 'email', nome: 'e-mail' },
  { tipo: 'telefone', re: /(?<![a-z])(telefone|celular|phone|tel|whats)/, typeEsperado: 'tel', ac: 'tel', nome: 'telefone' },
  { tipo: 'cep', re: /(?<![a-z])(cep|postal|zip)/, typeEsperado: null, ac: 'postal-code', nome: 'CEP' },
  { tipo: 'endereco', re: /(?<![a-z])(endereco|address)/, typeEsperado: null, ac: 'street-address', nome: 'endereço' },
  { tipo: 'nome', re: /(?<![a-z])(nome|name)/, typeEsperado: null, ac: 'name', nome: 'nome' },
];
D['int-campo-sem-tipo-ou-autocomplete'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  let casados = 0;
  const hits = [];
  for (const pg of pgs) {
    for (const c of camposDe(pg)) {
      if (c.tipo === 'select' || c.tipo === 'password' || c.tipo === 'search' || c.tipo === 'number' || c.tipo === 'url') continue;
      const ident = semAcento([c.e.attrs.name, c.e.attrs.id].filter(Boolean).join(' '));
      const outro = semAcento([c.e.attrs.placeholder, c.e.attrs['aria-label'], c.rotuloTexto].filter(Boolean).join(' '));
      const m = MAPA_CAMPOS.find((x) => x.re.test(ident)) || MAPA_CAMPOS.find((x) => x.re.test(outro));
      if (!m) continue;
      casados++;
      const problemas = [];
      if (m.typeEsperado && c.tipo !== m.typeEsperado) problemas.push('type');
      if (!temAtributo(c.e, 'autocomplete')) problemas.push('autocomplete');
      if (problemas.length) hits.push({ ...c, m, problemas });
    }
  }
  if (!hits.length) return NAO();
  const semType = hits.filter((h) => h.problemas.includes('type')).length;
  const semAc = hits.filter((h) => h.problemas.includes('autocomplete')).length;
  const partes = [];
  if (semType) partes.push(`${q(semType, 'campo', 'campos')} de e-mail ou telefone com type de texto comum`);
  if (semAc) partes.push(`${q(semAc, 'campo', 'campos')} de dado pessoal sem autocomplete`);
  const citacoes = [];
  for (const h of hits) { if (citacoes.length >= 3) break; juntar(citacoes, citarHtml(ctx, h.e.raw, h.pg.url)); }
  const msg = `${partes.join(' e ').replace(/^./, (c) => c.toUpperCase())}. Sem o type e o autocomplete certos, o celular não abre o teclado adequado e o navegador não preenche os dados sozinho.`;
  const evidencias = hits.slice(0, 5).map((h) => ev({ pagina: h.pg.caminho, versao: 'final', seletor: h.e.tag, trecho: h.e.raw, valor: `${h.m.nome}: falta ${h.problemas.join(' e ')}`, contagem: hits.length, visivel: true }));
  return SIM(hits.length / casados, [{ pagina: hits[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [semType, semAc, hits.length, casados] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// HTML: links falsos, clique sem semântica, avisos, carrossel
// ---------------------------------------------------------------------------------------------------------------------
const RE_VOLTAR_TOPO = /\b(topo|top|voltar ao topo|back to top|subir)\b|^[↑▲^]$/i;
D['int-link-falso'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const hits = [];
  for (const pg of pgs) {
    for (const l of pg.extr.links || []) {
      if (!l.visivel || l.clone) continue;
      const h = String(l.hrefAttr ?? '').trim();
      const motivo = h === '#' ? '#' : h === '' ? 'vazio' : /^javascript:/i.test(h) ? 'javascript' : null;
      if (!motivo) continue;
      if (motivo === '#' && RE_VOLTAR_TOPO.test(norm(l.texto))) continue;
      hits.push({ pg, motivo, texto: l.texto, seletor: l.seletor, hrefAttr: l.hrefAttr });
    }
    const doc = parse(pg);
    const visiveis = new Set((pg.extr.nos || []).filter((n) => n.visivel && !n.clone && n.tag === 'a').map((n) => norm(n.texto)));
    for (const e of doc.els) {
      if (e.tag !== 'a' || temAtributo(e, 'href') || escondidoPeloHtml(e)) continue;
      const t = textoDe(doc, e);
      if (temAtributo(e, 'onclick') || (t && visiveis.has(norm(t)))) hits.push({ pg, motivo: 'sem-href', texto: t, seletor: 'a', raw: e.raw });
    }
  }
  if (!hits.length) return NAO();
  const porMotivo = {};
  for (const h of hits) porMotivo[h.motivo] = (porMotivo[h.motivo] || 0) + 1;
  const desc = { '#': 'href="#"', vazio: 'href vazio', javascript: 'href="javascript:"', 'sem-href': 'sem href' };
  const partes = Object.entries(porMotivo).map(([k, n]) => (k === 'sem-href' ? `${n} ${desc[k]}` : `${n} com ${desc[k]}`));
  const citacoes = [];
  for (const h of hits) {
    if (citacoes.length >= 3) break;
    const raw = h.raw || (h.motivo === 'vazio' ? `href=""` : `href="${h.hrefAttr}"`);
    juntar(citacoes, citarHtml(ctx, raw, h.pg.url));
    if (citacoes.length < 3 && h.texto) juntar(citacoes, primeira(ctx, [T(`${raw}>${h.texto}</a>`, 'html', { pagina: h.pg.url })]));
  }
  const msg = `${q(hits.length, 'link finge', 'links fingem')} ser ${hits.length === 1 ? 'link' : 'links'} mas ${hits.length === 1 ? 'não leva' : 'não levam'} a lugar nenhum (${partes.join(', ')}). Para quem usa leitor de tela, ${hits.length === 1 ? 'é anunciado' : 'são anunciados'} como link e o clique não vai a lugar nenhum; se for uma ação, deveria ser um botão.`;
  const evidencias = hits.slice(0, 6).map((h) => ev({ pagina: h.pg.caminho, versao: 'final', seletor: h.seletor, trecho: cortar(h.texto || h.raw || h.hrefAttr, 200), valor: desc[h.motivo], contagem: hits.length, visivel: true }));
  return SIM(1, [{ pagina: hits[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length, ...Object.values(porMotivo)] }]);
};

const ROLES_CONTROLE = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'switch', 'radio']);
function clicaveisSemSemantica(pg, { tags, estrito }) {
  const doc = parse(pg);
  const saida = [];
  for (const e of doc.els) {
    if (!temAtributo(e, 'onclick') || !tags(e.tag)) continue;
    if (escondidoPeloHtml(e)) continue;
    if (dentroDe(e, ['a', 'button'])) continue;
    const role = String(e.attrs.role || '').toLowerCase();
    const tab = e.attrs.tabindex !== undefined ? parseInt(e.attrs.tabindex, 10) : null;
    const focavel = tab !== null && Number.isFinite(tab) && tab >= 0;
    const temRole = ROLES_CONTROLE.has(role);
    const ok = estrito ? temRole && focavel : (temRole || focavel);
    if (ok) continue;
    if (!estrito) {
      const temFilhoInterativo = doc.els.some((x) => x.ini > e.ini && x.ini < (e.fim ?? e.ini) && ['a', 'button', 'input', 'select', 'textarea'].includes(x.tag));
      if (temFilhoInterativo) continue;
    }
    saida.push({ pg, e });
  }
  return saida;
}
function achadoClicavel(ctx, hits, textoMsg, extraNums = []) {
  const citacoes = [];
  for (const { pg, e } of hits) { if (citacoes.length >= 3) break; juntar(citacoes, citarHtml(ctx, e.raw, pg.url)); }
  const evidencias = hits.slice(0, 5).map(({ pg, e }) => ev({ pagina: pg.caminho, versao: 'final', seletor: e.tag, trecho: e.raw, valor: 'onclick sem papel nem foco de teclado', contagem: hits.length, visivel: true }));
  return { pagina: hits[0].pg.caminho, mensagem: textoMsg, evidencias, citacoes, numeros_permitidos: [hits.length, ...extraNums] };
};

D['a11y-clique-sem-teclado'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const nao = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option', 'html', 'body']);
  const hits = pgs.flatMap((pg) => clicaveisSemSemantica(pg, { tags: (t) => !nao.has(t), estrito: false }));
  if (!hits.length) return NAO();
  const msg = `${q(hits.length, 'elemento responde', 'elementos respondem')} ao clique (atributo onclick) mas ${hits.length === 1 ? 'não é' : 'não são'} link nem botão, e ${hits.length === 1 ? 'não tem' : 'não têm'} papel de controle nem tabindex. Quem usa só o teclado não consegue chegar ${hits.length === 1 ? 'a ele nem ativá-lo' : 'a eles nem ativá-los'}. (Cliques ligados por JavaScript não foram lidos; só o atributo onclick.)`;
  return SIM(1, [achadoClicavel(ctx, hits, msg)]);
};

D['int-clicavel-sem-semantica'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const alvo = new Set(['div', 'span', 'li', 'img', 'svg', 'p']);
  const hits = pgs.flatMap((pg) => clicaveisSemSemantica(pg, { tags: (t) => alvo.has(t), estrito: true }));
  if (!hits.length) return NAO();
  const msg = `${q(hits.length, 'bloco clicável não é', 'blocos clicáveis não são')} um botão nem um link: ${hits.length === 1 ? 'tem' : 'têm'} onclick, mas ${hits.length === 1 ? 'falta' : 'faltam'} papel e foco de teclado. Para quem usa teclado ou leitor de tela ${hits.length === 1 ? 'ele não existe' : 'eles não existem'}. (Só o atributo onclick foi lido, não o cursor nem cliques ligados por JavaScript.)`;
  return SIM(1, [achadoClicavel(ctx, hits, msg)]);
};

const RE_AVISO = /(^|[^a-z])(toast|snackbar|alert|notification|notice|error|erro|success|sucesso|mensagem)/i;
D['int-aviso-sem-aria-live'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const hits = [];
  for (const pg of pgs) {
    const doc = parse(pg);
    for (const e of doc.els) {
      if (VAZIOS.has(e.tag) || ['script', 'style', 'html', 'body', 'head', 'form', 'textarea', 'button', 'a', 'label', 'li', 'td', 'tr', 'table', 'ul', 'ol', 'section', 'main', 'nav', 'article', 'header', 'footer', 'svg', 'path'].includes(e.tag)) continue;
      const nome = `${classesDe(e).join(' ')} ${e.attrs.id || ''}`;
      if (!RE_AVISO.test(nome)) continue;
      if (e.attrs.role || temAtributo(e, 'aria-live')) continue;
      if (ancestrais(e).some((a) => /^(alert|status|log)$/i.test(a.attrs.role || '') || (temAtributo(a, 'aria-live') && String(a.attrs['aria-live']).toLowerCase() !== 'off'))) continue;
      const vazio = !textoDe(doc, e) && !/<(img|svg|input|button)\b/i.test(doc.html.slice(e.fimAb, e.iniFecha ?? e.fimAb));
      const escondido = temAtributo(e, 'hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.attrs.style || '');
      if (vazio || escondido) hits.push({ pg, e, vazio, escondido });
    }
  }
  if (!hits.length) return NAO();
  const citacoes = [];
  for (const { pg, e } of hits) { if (citacoes.length >= 3) break; juntar(citacoes, citarHtml(ctx, e.raw, pg.url)); }
  const msg = `${q(hits.length, 'contêiner de aviso (toast, alerta, erro ou sucesso) está', 'contêineres de aviso (toast, alerta, erro ou sucesso) estão')} vazio${hits.length === 1 ? '' : 's'} ou escondido${hits.length === 1 ? '' : 's'} e sem role="alert", role="status" nem aria-live. Quando a mensagem aparecer, o leitor de tela não vai anunciá-la.`;
  const evidencias = hits.slice(0, 5).map(({ pg, e, vazio }) => ev({ pagina: pg.caminho, versao: 'final', seletor: e.tag, trecho: e.raw, valor: vazio ? 'vazio ao carregar' : 'escondido ao carregar', contagem: hits.length }));
  return SIM(1, [{ pagina: hits[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length] }]);
};

const RE_RAIZ_CARROSSEL = /^(swiper|swiper-container|swiper-wrapper-root|slick-slider|slick|splide|carousel|owl-carousel|embla|glide|slider)$/i;
const RE_CONTROLE = /(anterior|pr[oó]xim[oa]?|prev|previous|next|voltar|avan[cç]ar|slide \d|ir para)/i;
D['int-carrossel-so-por-arraste'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const sem = [];
  let total = 0;
  for (const pg of pgs) {
    const doc = parse(pg);
    const raizes = doc.els.filter((e) => (classesDe(e).some((c) => RE_RAIZ_CARROSSEL.test(c)) || /^carousel$/i.test(e.attrs['data-ride'] || '') || temAtributo(e, 'data-carousel') || temAtributo(e, 'data-splide') || temAtributo(e, 'data-embla')) && !escondidoPeloHtml(e) && !classesDe(e).some((c) => /clone/.test(c)));
    const topo = raizes.filter((r) => !ancestrais(r).some((a) => raizes.includes(a)));
    for (const r of topo) {
      total++;
      const escopo = r.pai || r;
      const interior = doc.els.filter((x) => x.ini >= escopo.ini && x.ini < (escopo.fim ?? escopo.ini));
      const temControle = interior.some((x) => {
        const foc = x.tag === 'button' || (x.tag === 'a' && temAtributo(x, 'href')) || (x.attrs.tabindex !== undefined && parseInt(x.attrs.tabindex, 10) >= 0) || /^(button|tab)$/i.test(x.attrs.role || '');
        if (!foc || temAtributo(x, 'hidden')) return false;
        const nome = `${x.attrs['aria-label'] || ''} ${x.attrs.title || ''} ${textoDe(doc, x)} ${classesDe(x).join(' ')}`;
        return RE_CONTROLE.test(nome) || /(button-prev|button-next|arrow|pagination|dot|bullet|splide__pagination|slick-prev|slick-next|carousel-control)/i.test(classesDe(x).join(' '));
      });
      if (!temControle) sem.push({ pg, e: r });
    }
  }
  if (!total) return NAO();
  if (!sem.length) return NAO();
  const citacoes = [];
  for (const { pg, e } of sem) { if (citacoes.length >= 3) break; juntar(citacoes, citarHtml(ctx, e.raw, pg.url)); }
  const msg = `${q(sem.length, 'carrossel parece', 'carrosséis parecem')} depender só do gesto de arrastar: não achei botão anterior/próximo nem marcadores que o teclado alcance dentro ou ao lado dele. Quem não consegue arrastar (teclado, leitor de tela, tremor nas mãos) fica sem ver os outros itens.`;
  const evidencias = sem.slice(0, 4).map(({ pg, e }) => ev({ pagina: pg.caminho, versao: 'final', seletor: e.tag, trecho: e.raw, valor: 'carrossel sem controle focável', contagem: sem.length, visivel: true }));
  return SIM(sem.length / total, [{ pagina: sem[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [sem.length, total] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// JavaScript: formulário sem destino e bloqueio de colar
// ---------------------------------------------------------------------------------------------------------------------
function textosJs(ctx) {
  const lista = [];
  const vistos = new Set();
  for (const a of ctx.ativos || []) if (a.tipo === 'js' && a.texto && !vistos.has(a.texto)) { vistos.add(a.texto); lista.push({ origem: a.url, texto: a.texto }); }
  for (const p of ctx.paginas || []) for (const s of p.final?.extr?.scripts || []) if (s.inline && !vistos.has(s.inline)) { vistos.add(s.inline); lista.push({ origem: 'inline', texto: s.inline }); }
  return lista;
}
const jsNaoLido = (ctx) => (ctx.ativos || []).some((a) => a.tipo === 'js' && a.texto == null);
const RE_ENVIO = /\bfetch\s*\(|XMLHttpRequest|\baxios\b|sendBeacon|formspree|web3forms|getform\.io|formsubmit|emailjs|netlify|mailchimp|hsforms|\$\.(ajax|post)\s*\(|\.submit\s*\(/i;

D['int-formulario-sem-destino'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const sem = [];
  let totalForms = 0;
  for (const pg of pgs) {
    const doc = parse(pg);
    const forms = doc.els.filter((e) => e.tag === 'form');
    (pg.extr.formularios || []).forEach((f, i) => {
      if (!f.visivel || f.clone) return;
      totalForms++;
      const a = String(f.action ?? '').trim();
      if (a === '' || a === '#') sem.push({ pg, f, e: forms[i] });
    });
  }
  if (!totalForms) return NAO();
  if (!sem.length) return NAO();
  const js = textosJs(ctx);
  const envio = js.some((j) => RE_ENVIO.test(j.texto)) || pgs.some((pg) => /\bonsubmit\s*=/i.test(pg.html) && RE_ENVIO.test(pg.html));
  if (envio) return NAO();
  const citacoes = [];
  for (const { pg, e } of sem) { if (citacoes.length >= 3) break; if (e) juntar(citacoes, citarHtml(ctx, e.raw, pg.url)); }
  if (!citacoes.length) juntar(citacoes, primeira(ctx, [T('<form', 'html')]));
  const msg = `${q(sem.length, 'formulário não tem', 'formulários não têm')} destino (action vazio, "#" ou ausente) e não achei nenhuma chamada de envio (fetch, XMLHttpRequest, axios, sendBeacon ou serviço de formulário) no JavaScript carregado. Pode ser um formulário de enfeite que não envia nada.`;
  const evidencias = sem.slice(0, 4).map(({ pg, f }) => ev({ pagina: pg.caminho, versao: 'final', seletor: f.seletor, trecho: cortar(f.textoAoRedor, 160), valor: `action=${f.action === null ? '(ausente)' : `"${f.action}"`}`, contagem: sem.length, visivel: true }));
  return SIM(1, [{ pagina: sem[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [sem.length], ...(jsNaoLido(ctx) ? { instavel: true } : {}) }]);
};

const RE_PASTE_JS = [
  /addEventListener\(\s*['"]paste['"][\s\S]{0,300}?(preventDefault|return\s+false)/i,
  /\.onpaste\s*=\s*(function[\s\S]{0,200}?return\s+false|[^;]*?(false|preventDefault))/i,
  /\.on\(\s*['"]paste['"][\s\S]{0,300}?(preventDefault|return\s+false)/i,
];
D['int-bloqueia-colar'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx);
  if (!pgs.length) return null;
  const hits = [];
  for (const pg of pgs) {
    const doc = parse(pg);
    for (const e of doc.els) {
      const v = e.attrs.onpaste;
      if (v !== undefined && /(return\s+false|preventDefault)/i.test(v)) hits.push({ tipo: 'atributo', pg, e });
    }
  }
  for (const j of textosJs(ctx)) {
    for (const re of RE_PASTE_JS) {
      const m = re.exec(j.texto);
      if (m) { hits.push({ tipo: 'js', origem: j.origem, trecho: cortar(m[0], 120), texto: j.texto }); break; }
    }
  }
  if (!hits.length) return NAO();
  const citacoes = [];
  for (const h of hits) {
    if (citacoes.length >= 3) break;
    if (h.tipo === 'atributo') juntar(citacoes, citarHtml(ctx, h.e.raw, h.pg.url));
    else juntar(citacoes, primeira(ctx, [T(h.trecho, 'js', {}), T(h.trecho.slice(0, 60), 'js', {}), T(`addEventListener('paste'`, 'js', {}), T(`addEventListener("paste"`, 'js', {})]));
  }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `Há ${q(hits.length, 'bloqueio', 'bloqueios')} do evento de colar (paste), por atributo onpaste ou por script. Quem usa gerenciador de senhas, leitor de tela ou precisa colar um dado longo não consegue. (Não foi possível confirmar em quais campos o bloqueio vale.)`;
  const evidencias = hits.slice(0, 4).map((h) => ev(h.tipo === 'atributo' ? { pagina: h.pg.caminho, versao: 'final', seletor: h.e.tag, trecho: h.e.raw, valor: 'onpaste bloqueia', contagem: hits.length, visivel: true } : { pagina: paginaInicial(ctx), versao: 'final', trecho: h.trecho, valor: `script ${caminhoDe(h.origem)}`, contagem: hits.length }));
  return SIM(1, [{ pagina: hits[0].pg ? hits[0].pg.caminho : paginaInicial(ctx), mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// responsividade (leitura mobile 390 px: p.mobile.extr e css.paginas[].mobile.estilos)
// ---------------------------------------------------------------------------------------------------------------------
function mobileEstilos(med) {
  const pags = cssPaginas(med);
  if (!pags) return null;
  const l = pags.filter((p) => p.mobile && p.mobile.estilos).map((p) => ({ url: p.url, caminho: caminhoDe(p.url), es: p.mobile.estilos }));
  return l.length ? l : null;
}

D['resp-rolagem-horizontal'] = ({ ctx, med }) => {
  const l = mobileEstilos(med);
  if (!l) return null;
  const hits = l.filter((x) => x.es.overflowHorizontal && x.es.overflowHorizontal.larguraDocumento > x.es.overflowHorizontal.larguraReferencia + 1);
  if (!hits.length) return NAO();
  const h = hits.sort((a, b) => b.es.overflowHorizontal.larguraDocumento - a.es.overflowHorizontal.larguraDocumento)[0];
  const o = h.es.overflowHorizontal;
  const culpados = (o.culpados || []).slice(0, 3);
  const msg = `No celular a página fica mais larga que a tela: o conteúdo mede ${o.larguraDocumento} px para uma tela de ${o.larguraReferencia} px${hits.length > 1 ? `, e isso acontece em ${hits.length} páginas` : ''}. Quem usa o celular precisa rolar para o lado.${culpados.length ? ` Os elementos que mais passam da borda são ${culpados.map((c) => `${c.seletor} (até ${c.direitaPx} px)`).join(', ')}.` : ''}`;
  const evidencias = [ev({ pagina: h.caminho, versao: 'final', seletor: culpados[0] ? culpados[0].seletor : null, trecho: `documento ${o.larguraDocumento}px em tela de ${o.larguraReferencia}px`, valor: o.larguraDocumento, contagem: culpados.length, visivel: true })];
  for (const c of culpados) evidencias.push(ev({ pagina: h.caminho, versao: 'final', seletor: c.seletor, trecho: `borda direita em ${c.direitaPx}px`, valor: c.direitaPx, visivel: true }));
  void ctx;
  return SIM(1, [{ pagina: h.caminho, mensagem: msg, evidencias, citacoes: [], numeros_permitidos: [o.larguraDocumento, o.larguraReferencia, hits.length, ...culpados.map((c) => c.direitaPx), ...culpados.flatMap((c) => (String(c.seletor).match(/\d+/g) || []).map(Number))] }]);
};

function somaAlvos(l) {
  let total = 0, a24 = 0, a24si = 0, a44 = 0;
  for (const x of l) { const t = x.es.alvosToque; total += t.total; a24 += t.abaixo24; a24si += t.abaixo24SemInline; a44 += t.abaixo44; }
  return { total, a24, a24si, a44 };
}
function exemplosAlvos(ctx, l, filtro) {
  const evidencias = [], citacoes = [];
  for (const x of l) {
    for (const t of x.es.alvosToque.exemplos || []) {
      if (!filtro(t)) continue;
      if (evidencias.length < 5) evidencias.push(ev({ pagina: x.caminho, versao: 'final', seletor: t.seletor, trecho: `${t.tag} ${t.larguraPx}x${t.alturaPx}px: ${t.texto}`, valor: `${t.larguraPx}x${t.alturaPx}`, contagem: 1, visivel: true }));
      if (citacoes.length < 3 && t.texto && t.texto.length >= 3) juntar(citacoes, primeira(ctx, [T(t.texto, 'visivel', { pagina: x.url })]));
    }
  }
  return { evidencias, citacoes };
}
D['resp-alvo-menor-que-24px'] = ({ ctx, med }) => {
  const l = mobileEstilos(med);
  if (!l) return null;
  const s = somaAlvos(l);
  if (!s.total) return NAO();
  if (s.a24si <= 0) return NAO();
  const msg = `No celular, ${q(s.a24si, 'alvo de toque mede', 'alvos de toque medem')} menos de 24 por 24 pixels (de ${s.total} medidos, sem contar links dentro de frases). Fica difícil acertar com o dedo, principalmente para quem tem tremor ou dedos grandes. (A exceção de espaçamento da norma não foi medida.)`;
  const { evidencias, citacoes } = exemplosAlvos(ctx, l, (t) => !t.inline && (t.larguraPx < 24 || t.alturaPx < 24));
  const pior = l.sort((a, b) => b.es.alvosToque.abaixo24SemInline - a.es.alvosToque.abaixo24SemInline)[0];
  return SIM(s.a24si / s.total, [{ pagina: pior.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [s.a24si, s.total] }]);
};
D['resp-alvo-menor-que-44px'] = ({ ctx, med }) => {
  const l = mobileEstilos(med);
  if (!l) return null;
  const s = somaAlvos(l);
  const base = s.total - s.a24;
  const entre = s.a44 - s.a24;
  if (base <= 0) return NAO();
  const fracao = entre / base;
  if (!(fracao > 0.3)) return NAO();
  const pct = Math.round(fracao * 100);
  const msg = `No celular, ${q(entre, 'alvo de toque tem', 'alvos de toque têm')} entre 24 e 44 pixels de lado: ${pct}% dos ${base} alvos que passam do mínimo de 24 pixels. O recomendado para botões e links principais é pelo menos 44 por 44 pixels.`;
  const { evidencias, citacoes } = exemplosAlvos(ctx, l, (t) => !t.inline && t.larguraPx >= 24 && t.alturaPx >= 24);
  return SIM(fracao, [{ pagina: l[0].caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [entre, base, pct, 24, 44] }]);
};

D['resp-texto-pequeno-no-celular'] = ({ ctx, med }) => {
  const l = mobileEstilos(med);
  if (!l) return null;
  const pequenos = [];
  let linhas = null;
  let comTexto = 0, elPeq = 0;
  for (const x of l) {
    const tip = x.es.tipografia;
    comTexto += (x.es.amostra && x.es.amostra.comTexto) || 0;
    for (const e of tip.tamanhos.abaixo12.exemplos || []) if (e.tamanhoPx < 11) pequenos.push({ ...e, x });
    elPeq += tip.tamanhos.abaixo12.elementos || 0;
    const m = tip.lineHeightCorpo && tip.lineHeightCorpo.medianaRazao;
    if (m !== null && m !== undefined && m < 1.3 && tip.lineHeightCorpo.amostras > 0 && (linhas === null || m < linhas.m)) linhas = { m, x };
  }
  const tamanhosMin = pequenos.length ? Math.min(...pequenos.map((e) => e.tamanhoPx)) : null;
  if (!pequenos.length && !linhas) return NAO();
  const partes = [];
  if (pequenos.length) partes.push(`há texto com menos de 11 px no celular (o menor mede ${br(tamanhosMin)} px, por exemplo "${cortar(pequenos[0].texto, 50)}")`);
  if (linhas) partes.push(`a entrelinha mediana dos parágrafos é ${br(linhas.m)} vez o tamanho da letra, abaixo de 1,3`);
  const msg = `${partes.join('; ').replace(/^./, (c) => c.toUpperCase())}. Texto miúdo ou apertado cansa a leitura numa tela pequena. (A mediana do tamanho do texto corrido não foi medida.)`;
  const citacoes = [];
  for (const e of pequenos) { if (citacoes.length >= 2) break; juntar(citacoes, primeira(ctx, [T(e.texto, 'visivel', { pagina: e.x.url })])); }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const evidencias = pequenos.slice(0, 4).map((e) => ev({ pagina: e.x.caminho, versao: 'final', seletor: e.seletor, trecho: e.texto, valor: `${e.tamanhoPx}px`, contagem: elPeq, visivel: true }));
  if (linhas) evidencias.push(ev({ pagina: linhas.x.caminho, versao: 'final', trecho: `entrelinha mediana ${linhas.m}`, valor: linhas.m, contagem: linhas.x.es.tipografia.lineHeightCorpo.amostras }));
  return SIM(comTexto ? Math.min(1, elPeq / comTexto) || 1 : 1, [{ pagina: (pequenos[0] ? pequenos[0].x : linhas.x).caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [11, 1.3, ...(tamanhosMin !== null ? [tamanhosMin] : []), ...(linhas ? [linhas.m] : [])] }]);
};

D['resp-imagem-sem-srcset'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx).filter((pg) => pg.p.mobile && pg.p.mobile.extr);
  if (!pgs.length) return null;
  const hits = [];
  let candidatas = 0;
  for (const pg of pgs) {
    const imgs = pg.p.mobile.extr.imagens || [];
    for (const i of imgs) {
      if (!i.visivel || i.clone) continue;
      if (/\.svg(\?|$)/i.test(i.src) || /^data:image\/svg/i.test(i.src)) continue;
      if (!(i.renderW >= 100) || !i.naturalW) continue;
      candidatas++;
      if (!i.temSrcset && i.naturalW > 2 * i.renderW) hits.push({ pg, i });
    }
  }
  if (!candidatas) return NAO();
  if (hits.length < 3) return NAO();
  const citacoes = [];
  for (const { pg, i } of hits) {
    if (citacoes.length >= 3) break;
    const arq = String(i.src || '').split('?')[0].split('/').pop();
    const doc = parse(pg);
    const tag = doc.els.find((e) => e.tag === 'img' && arq && String(e.attrs.src || '').includes(arq));
    if (tag) juntar(citacoes, citarHtml(ctx, tag.raw, pg.url));
  }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const ex = hits[0].i;
  const msg = `${q(hits.length, 'imagem é', 'imagens são')} muito maior${hits.length === 1 ? '' : 'es'} do que o espaço em que aparece${hits.length === 1 ? '' : 'm'} no celular (por exemplo ${ex.naturalW} px de largura num espaço de ${ex.renderW} px) e sem srcset nem picture. O celular baixa a imagem grande à toa, gastando dados e demorando mais.`;
  const evidencias = hits.slice(0, 5).map(({ pg, i }) => ev({ pagina: pg.caminho, versao: 'final', seletor: i.seletor, trecho: `natural ${i.naturalW}px, exibida ${i.renderW}px`, valor: `${i.naturalW}/${i.renderW}`, contagem: hits.length, visivel: true }));
  return SIM(hits.length / candidatas, [{ pagina: hits[0].pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [hits.length, ex.naturalW, ex.renderW, candidatas, 2, 3, 100] }]);
};

D['resp-conteudo-some-no-celular'] = ({ ctx }) => {
  const pgs = paginasFinais(ctx).filter((pg) => pg.p.mobile && pg.p.mobile.extr);
  if (!pgs.length) return null;
  let palavras = 0;
  const escondidos = [];
  let pior = null;
  for (const pg of pgs) {
    const mob = pg.p.mobile.extr;
    const visMobile = new Set((mob.nos || []).filter((n) => n.visivel && !n.clone).map((n) => norm(n.texto)));
    const porSel = new Map((mob.nos || []).map((n) => [n.seletor, n]));
    let n = 0;
    for (const d of pg.extr.nos || []) {
      if (!d.visivel || d.clone) continue;
      const m = porSel.get(d.seletor);
      if (!m || m.visivel) continue;
      const t = norm(d.texto);
      if (!t || visMobile.has(t)) continue;
      const w = t.split(/\s+/).length;
      n += w;
      escondidos.push({ pg, d, w });
    }
    palavras += n;
    if (!pior || n > pior.n) pior = { pg, n };
  }
  if (palavras < 40) return NAO();
  escondidos.sort((a, b) => b.w - a.w);
  const citacoes = [];
  for (const { pg, d } of escondidos) { if (citacoes.length >= 2) break; juntar(citacoes, primeira(ctx, [T(cortar(d.texto, 60), 'visivel', { pagina: pg.url })])); }
  if (!citacoes.length) juntar(citacoes, ancoraVisivel(ctx));
  const msg = `${q(palavras, 'palavra aparece', 'palavras aparecem')} no computador e ${palavras === 1 ? 'fica escondida' : 'ficam escondidas'} no celular, sem aparecer em outro ponto da página (por exemplo "${cortar(escondidos[0].d.texto, 60)}"). Quem usa o celular recebe menos informação que quem usa o computador. (Só o texto foi comparado; tabelas largas não foram medidas.)`;
  const evidencias = escondidos.slice(0, 5).map(({ pg, d, w }) => ev({ pagina: pg.caminho, versao: 'final', seletor: d.seletor, trecho: d.texto, valor: 'visível no computador, escondido no celular', contagem: w, visivel: true }));
  return SIM(Math.min(1, palavras / 400), [{ pagina: pior.pg.caminho, mensagem: msg, evidencias, citacoes, numeros_permitidos: [palavras, 40] }]);
};

// ---------------------------------------------------------------------------------------------------------------------
// SEM MEDIÇÃO: nenhum medidor entrega esses fatos (Tab, hover, retângulos, 1920 px, injeção de CSS). null = não avaliada.
// ---------------------------------------------------------------------------------------------------------------------
for (const id of [
  'a11y-contraste-componentes-ui', 'int-foco-invisivel-no-teclado', 'int-contraste-do-anel-de-foco', 'int-foco-coberto-por-elemento-fixo',
  'int-hover-sem-efeito', 'int-controle-pula-ao-focar', 'resp-conteudo-cortado-por-overflow', 'resp-campo-com-fonte-menor-que-16',
  'resp-menu-transborda-no-celular', 'resp-texto-colado-na-borda', 'resp-conteudo-sem-limite-em-tela-ultralarga', 'resp-espacamento-de-texto-corta-conteudo',
]) D[id] = semMedicao;
