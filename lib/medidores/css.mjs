// Medidor css (M2.2): combina (a) estilos COMPUTADOS das páginas (final.estilos e mobile.estilos, de extrator-estilos.mjs)
// e (b) CSS ESTÁTICO (postcss sobre ctx.ativos tipo 'css' + <style> inline). Só MEDE: devolve números e evidências; não julga nem pontua.
//
// dados = {
//   paletaPadrao: { origem, hexExatos, hexEmGradienteLinear, faixaMatizAzul, faixaMatizRoxo, regexClasses, fontesGenericas },
//   paginas: [ { url, computado: <final.estilos>|null, mobile: { overflowHorizontal, viewportMeta, estilos }|null, derivados: {...}|null,
//                estatico: { blocosInline, bytesInline, arquivosCss:[url] }, classesUtilitarias: {...} } ],
//   site: { computado: {...agregado das páginas}, estatico: {...CSS estático do site todo} }
// }
import postcss from 'postcss';
import { sha256 } from '../util.mjs';

export const id = 'css';
const VERSAO = '1';

// ---------------------------------------------------------------------------------------------------------------------
// Paleta padrão de "cara de IA". ORIGEM:
//  - hexExatos: rampa índigo/violeta/roxo/fúcsia 400-700 do Tailwind (+ shadcn), lista PURPLE_HEXES de
//    referencias/ai-design-tells/ai_design_tells/taxonomy.py (tell A1), idêntica a regras/visual-cor.json > cor-roxo-indigo-padrao
//    (resumo-ai-design-tells.md). O scanner do unslop-ui (devibe_scan.py, regra ai-purple) usa um subconjunto de 11 desses hex.
//  - hexEmGradienteLinear: hex que o unslop-ui (devibe_scan.py, regra purple-blue-gradient) procura dentro de linear-gradient().
//  - faixas de matiz: regras/visual-cor.json > cor-gradiente-azul-roxo (azul 200-240, roxo 255-300 graus).
//  - regexClasses: regras/visual-cor.json e visual-superficie.json (classes utilitárias equivalentes).
//  - fontesGenericas: regras/visual-tipografia.json > tipo-fonte-padrao (lista_generica) + ai-design-tells B1 / unslop-ui generic-font.
// ---------------------------------------------------------------------------------------------------------------------
export const PALETA_PADRAO = {
  origem: 'ai-design-tells taxonomy.py PURPLE_HEXES (A1) = regras/visual-cor.json cor-roxo-indigo-padrao; unslop-ui devibe_scan.py (ai-purple, purple-blue-gradient); regras/visual-tipografia.json tipo-fonte-padrao',
  hexExatos: ['#6366f1', '#4f46e5', '#4338ca', '#818cf8', '#a5b4fc', '#8b5cf6', '#7c3aed', '#6d28d9', '#a78bfa', '#c4b5fd', '#a855f7', '#9333ea', '#7e22ce', '#c084fc', '#d8b4fe', '#d946ef', '#c026d3'],
  hexEmGradienteLinear: ['#6366f1', '#7c3aed', '#8b5cf6', '#a855f7'],
  faixaMatizAzul: [200, 240],
  faixaMatizRoxo: [255, 300],
  regexClasses: {
    indigoVioleta: '^(bg|text|from|via|to|border|ring|fill|stroke|decoration|outline)-(indigo|violet|purple|fuchsia)-(400|500|600|700|800)(/\\d+)?$',
    sombraPadrao: '^shadow-(md|lg|xl|2xl)$',
    raioGrande: '^rounded-(2xl|3xl|full)$',
    rampaPadrao: '^(bg|text|border|ring)-[a-z]+-\\d{2,3}$',
    animacaoPadrao: '^(animate-(pulse|ping|bounce|spin)|transition-all)$',
  },
  fontesGenericas: ['inter', 'roboto', 'arial', 'helvetica', 'helvetica neue', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'segoe ui', 'sans-serif', 'open sans', 'lato', 'poppins', 'geist'],
};
const HEX_PADRAO = new Set(PALETA_PADRAO.hexExatos);
const FONTES_GENERICAS = new Set(PALETA_PADRAO.fontesGenericas);
const RE_CLASSES = Object.fromEntries(Object.entries(PALETA_PADRAO.regexClasses).map(([k, v]) => [k, new RegExp(v)]));
const RE_TOKEN_SEMANTICO = /^--(color|cor|brand|marca|accent|acento|primary|primaria|secondary|secundaria|surface|fg|bg|background|foreground|text|texto|danger|border|ring|muted|card|popover|destructive)([-_]|$)/i;
const noIntervalo = (h, [a, b]) => h >= a && h <= b;

// ---------------------------------------------------------------------------------------------------------------------
// utilitários de cor (texto CSS -> hex)
// ---------------------------------------------------------------------------------------------------------------------
const h2 = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
const rgbHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);
function hslParaRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function matizDe(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100) / 100, l: Math.round(l * 100) / 100 };
}
// Todas as cores literais de um valor CSS (ignora url(...)); devolve [{hex, bruto}] com hex = #rrggbb (alfa descartado).
export function coresDeValor(valor, { propriedadeCustom = false } = {}) {
  const v = String(valor).replace(/url\([^)]*\)/gi, ' ');
  const out = [];
  let m;
  const reHex = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/gi;
  while ((m = reHex.exec(v))) {
    let h = m[1].toLowerCase();
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    out.push({ hex: '#' + h.slice(0, 6), bruto: m[0] });
  }
  const reRgb = /rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/gi;
  while ((m = reRgb.exec(v))) {
    const c = [m[1], m[2], m[3]].map((x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
    out.push({ hex: rgbHex(c[0], c[1], c[2]), bruto: m[0] });
  }
  const reHsl = /hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/gi;
  while ((m = reHsl.exec(v))) {
    const c = hslParaRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    out.push({ hex: rgbHex(c[0], c[1], c[2]), bruto: m[0] });
  }
  if (propriedadeCustom) { // padrão shadcn: --primary: 222.2 47.4% 11.2%
    const t = /^\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*[\d.]+%?)?\s*$/.exec(v);
    if (t) { const c = hslParaRgb(parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])); out.push({ hex: rgbHex(c[0], c[1], c[2]), bruto: v.trim() }); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// CSS estático
// ---------------------------------------------------------------------------------------------------------------------
const cont = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const ordenado = (m, limite) => {
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return Object.fromEntries(limite ? arr.slice(0, limite) : arr);
};
const dividirTopo = (s, sep) => {
  const partes = []; let nivel = 0, atual = '';
  for (const ch of String(s)) {
    if (ch === '(') nivel++; if (ch === ')') nivel--;
    if (ch === sep && nivel === 0) { partes.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
};
const trecho = (s, n = 160) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
const RE_TEMPO = /^[\d.]+m?s$/i;
const RE_EASING = /(cubic-bezier\([^)]*\)|steps\([^)]*\)|linear\([^)]*\)|step-start|step-end|ease-in-out|ease-in|ease-out|ease|linear)(?![\w-])/i;
const categoriaEasing = (e) => (/^cubic-bezier/i.test(e) ? 'cubic-bezier' : /^steps|^step-/i.test(e) ? 'steps' : /^linear\(/i.test(e) ? 'linear()' : e.toLowerCase());
const GRUPOS = ['button', 'a', 'input', 'select', 'textarea'];
const RE_ESTADOS = { hover: /:hover(?![\w-])/i, focus: /:focus(?![\w-])/i, focusVisible: /:focus-visible(?![\w-])/i, focusWithin: /:focus-within(?![\w-])/i, active: /:active(?![\w-])/i };
const RE_FOCO_GLOBAL = /^(?:(?:\*|html|body|:root)\s*)?:(?:focus|focus-visible)$/i;
const palavrasVisuais = new Set(['box-shadow', 'text-decoration', 'background', 'background-color', 'border', 'border-color', 'border-bottom', 'border-bottom-color', 'outline-color', 'outline-width', 'outline-style']);

function novoEstatico() {
  return {
    arquivos: [], bytes: 0, regras: 0, declaracoes: 0, important: 0,
    fontFace: { total: 0, familias: new Map(), fontDisplay: new Map(), semFontDisplay: 0, itens: [] },
    imports: [],
    propsCustom: { total: 0, nomes: new Set(), semanticos: new Set(), comCor: 0 },
    media: { total: 0, minW: new Set(), maxW: new Set(), reducedMotion: 0, colorScheme: 0, contrast: 0, reducedMotionAnulaMovimento: 0 },
    estados: { hover: 0, focus: 0, focusVisible: 0, focusWithin: 0, active: 0, focoGlobal: [], porGrupo: Object.fromEntries(GRUPOS.map((g) => [g, { hover: 0, foco: 0, active: 0 }])), outlineNone: [], focusVisibleComIndicador: false },
    movimento: { transicoes: 0, transicaoAll: 0, transicaoPropriedades: new Map(), easing: new Map(), cubicBeziers: new Map(), duracoesMs: new Map(), animacoes: 0, animacaoNomes: new Map(), keyframes: new Map(), willChange: 0 },
    efeitos: { backdropFilter: 0, backgroundClipText: 0, textoGradienteDecl: [] },
    tema: { selection: 0, caretColor: 0, scrollbarColor: 0, accentColor: 0 },
    tipografia: { fontSizeUnidades: new Map(), familiasDeclaradas: new Map(), exemplosFonteGenerica: [] },
    cores: new Map(), coresPadrao: new Map(), coresRoxas: new Map(), evCoresPadrao: [],
    gradientes: { total: 0, azulRoxo: [], comHexPadrao: [], tipos: new Map() },
    evidencias: [],
  };
}

function processarCss(E, texto, origem) {
  let root;
  try { root = postcss.parse(texto, { from: origem }); } catch (e) { E.arquivos.push({ origem, bytes: texto.length, erroParse: String(e.message).slice(0, 160) }); return; }
  const arq = { origem, bytes: texto.length, regras: 0, declaracoes: 0 };
  E.arquivos.push(arq);
  E.bytes += texto.length;

  root.walkAtRules((at) => {
    const nome = at.name.toLowerCase();
    if (nome === 'font-face') {
      E.fontFace.total++;
      let familia = null, src = '', display = null;
      at.walkDecls((d) => {
        const p = d.prop.toLowerCase();
        if (p === 'font-family') familia = d.value.replace(/^["']|["']$/g, '').trim();
        else if (p === 'src') src = d.value;
        else if (p === 'font-display') display = d.value.trim().toLowerCase();
      });
      if (familia) cont(E.fontFace.familias, familia);
      if (display) cont(E.fontFace.fontDisplay, display); else E.fontFace.semFontDisplay++;
      E.fontFace.itens.push({ familia, fontDisplay: display, src: trecho(src.replace(/url\(\s*["']?data:[^)]*\)/gi, 'url(data:...)'), 100), arquivo: origem });
    } else if (nome === 'import') {
      E.imports.push({ url: trecho(at.params, 160), arquivo: origem });
    } else if (nome === 'media') {
      E.media.total++;
      const p = at.params;
      let m;
      const reMM = /\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/gi;
      while ((m = reMM.exec(p))) {
        const px = parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16);
        (m[1].toLowerCase() === 'min' ? E.media.minW : E.media.maxW).add(px);
      }
      const reR = /\(\s*width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)\s*\)/gi;
      while ((m = reR.exec(p))) {
        const px = parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16);
        (m[1].startsWith('>') ? E.media.minW : E.media.maxW).add(px);
      }
      if (/prefers-reduced-motion/i.test(p)) {
        E.media.reducedMotion++;
        at.walkDecls((d) => { if (/^(animation|animation-name|animation-duration|transition|transition-duration|scroll-behavior)$/i.test(d.prop) && /(none|0s|0\.01ms|0ms|auto)/i.test(d.value)) E.media.reducedMotionAnulaMovimento++; });
      }
      if (/prefers-color-scheme/i.test(p)) E.media.colorScheme++;
      if (/prefers-contrast/i.test(p)) E.media.contrast++;
    } else if (nome.endsWith('keyframes')) {
      cont(E.movimento.keyframes, at.params.trim());
    }
  });

  root.walkRules((rule) => {
    const pai = rule.parent;
    if (pai && pai.type === 'atrule' && /keyframes$/i.test(pai.name)) return;
    E.regras++; arq.regras++;
    const seletores = rule.selectors || [rule.selector];
    const decls = [];
    rule.each((n) => { if (n.type === 'decl') decls.push(n); });
    const valorVazio = (d) => (/^box-shadow$/i.test(d.prop) ? /^none$/i.test(d.value.trim()) : /^(none|0|transparent)(\s|$)/i.test(d.value.trim()));
    // "substituto" do outline removido: só vale em regra de foco (um fundo em repouso não indica foco)
    const regraDeFoco = /:focus/i.test(rule.selector);
    const temSubst = regraDeFoco && decls.some((d) => (palavrasVisuais.has(d.prop.toLowerCase()) && !valorVazio(d) && !/^outline/i.test(d.prop)) || (/^outline(-color|-width|-style)?$/i.test(d.prop) && !/^(none|0|0px)(\s|$)/i.test(d.value.trim())));
    for (const sel of seletores) {
      const flags = {};
      for (const [k, re] of Object.entries(RE_ESTADOS)) if (re.test(sel)) { flags[k] = true; E.estados[k]++; }
      if (/::selection/i.test(sel)) E.tema.selection++;
      if (flags.focus || flags.focusVisible) {
        if (RE_FOCO_GLOBAL.test(sel.trim()) || /^:where\(\s*:focus(-visible)?\s*\)$/i.test(sel.trim())) E.estados.focoGlobal.push({ seletor: sel.trim(), arquivo: origem });
        if (flags.focusVisible && decls.some((d) => /^(outline|box-shadow|border|border-color|background|background-color)$/i.test(d.prop) && !/^(none|0)(\s|$)/i.test(d.value.trim()))) E.estados.focusVisibleComIndicador = true;
      }
      if (flags.hover || flags.focus || flags.focusVisible || flags.active || flags.focusWithin) {
        const grupos = new Set();
        const reTag = /(?:^|[\s>+~(,])(a|button|input|select|textarea)(?![\w-])/gi;
        let m;
        while ((m = reTag.exec(sel))) grupos.add(m[1].toLowerCase());
        if (/\.[\w-]*(btn|button|botao|cta)[\w-]*/i.test(sel)) grupos.add('button');
        if (/\.[\w-]*link[\w-]*/i.test(sel)) grupos.add('a');
        if (/\.[\w-]*(input|field|form-control)[\w-]*/i.test(sel)) grupos.add('input');
        for (const g of grupos) {
          if (flags.hover) E.estados.porGrupo[g].hover++;
          if (flags.focus || flags.focusVisible || flags.focusWithin) E.estados.porGrupo[g].foco++;
          if (flags.active) E.estados.porGrupo[g].active++;
        }
      }
    }
    for (const d of decls) {
      const p = d.prop.toLowerCase();
      if ((p === 'outline' && /^\s*(none|0|0px)(\s|$)/i.test(d.value)) || (p === 'outline-style' && /^\s*none/i.test(d.value)) || (p === 'outline-width' && /^\s*0(px)?\s*$/i.test(d.value))) {
        E.estados.outlineNone.push({ seletor: trecho(rule.selector, 120), valor: `${d.prop}: ${trecho(d.value, 40)}`, substitutoNaRegra: temSubst, emFoco: /:focus/i.test(rule.selector), arquivo: origem });
      }
    }
  });

  const clipJaContado = new Set();
  root.walkDecls((d) => {
    const p = d.prop.toLowerCase();
    const v = d.value;
    E.declaracoes++; arq.declaracoes++;
    if (d.important) E.important++;
    const pai = d.parent;
    const seletor = pai && pai.type === 'rule' ? trecho(pai.selector, 120) : pai && pai.type === 'atrule' ? '@' + pai.name : '';
    const emKeyframes = pai && pai.type === 'rule' && pai.parent && pai.parent.type === 'atrule' && /keyframes$/i.test(pai.parent.name);

    if (p.startsWith('--')) {
      E.propsCustom.total++;
      E.propsCustom.nomes.add(p);
      if (RE_TOKEN_SEMANTICO.test(p)) E.propsCustom.semanticos.add(p);
    }
    // cores declaradas
    for (const c of coresDeValor(v, { propriedadeCustom: p.startsWith('--') })) {
      cont(E.cores, c.hex);
      if (p.startsWith('--')) E.propsCustom.comCor++;
      if (HEX_PADRAO.has(c.hex)) {
        cont(E.coresPadrao, c.hex);
        if (E.evCoresPadrao.length < 20) E.evCoresPadrao.push({ arquivo: origem, seletor, propriedade: p, trecho: trecho(`${d.prop}: ${v}`), valor: c.hex });
      } else {
        const hs = matizDe(c.hex);
        if (hs.s >= 0.35 && hs.l > 0.1 && hs.l < 0.95 && hs.h >= 240 && hs.h <= 300) cont(E.coresRoxas, c.hex);
      }
    }
    // gradientes
    if (/gradient\(/i.test(v) && /^(background|background-image|--)/.test(p)) {
      const re = /(repeating-)?(linear|radial|conic)-gradient\(/gi;
      let m;
      while ((m = re.exec(v))) {
        let i = re.lastIndex, nivel = 1;
        while (i < v.length && nivel > 0) { if (v[i] === '(') nivel++; else if (v[i] === ')') nivel--; i++; }
        const corpo = v.slice(re.lastIndex, i - 1);
        re.lastIndex = i;
        E.gradientes.total++; cont(E.gradientes.tipos, m[2].toLowerCase());
        const cores = coresDeValor(corpo).map((c) => c.hex);
        const matizes = cores.map(matizDe).filter((x) => x.s >= 0.2);
        const azul = matizes.some((x) => noIntervalo(x.h, PALETA_PADRAO.faixaMatizAzul)), roxo = matizes.some((x) => noIntervalo(x.h, PALETA_PADRAO.faixaMatizRoxo));
        const item = { arquivo: origem, seletor, trecho: trecho(`${d.prop}: ${m[0]}${corpo})`, 200), cores };
        if (azul && roxo && m[2].toLowerCase() === 'linear') E.gradientes.azulRoxo.push(item);
        if (m[2].toLowerCase() === 'linear' && cores.some((c) => PALETA_PADRAO.hexEmGradienteLinear.includes(c))) E.gradientes.comHexPadrao.push(item);
      }
    }
    if ((p === 'background-clip' || p === '-webkit-background-clip') && /(^|\s)text(\s|$)/i.test(v) && !clipJaContado.has(pai)) {
      clipJaContado.add(pai);
      E.efeitos.backgroundClipText++;
      if (E.efeitos.textoGradienteDecl.length < 20) E.efeitos.textoGradienteDecl.push({ arquivo: origem, seletor, trecho: trecho(`${d.prop}: ${v}`) });
    }
    if (p === 'backdrop-filter' || p === '-webkit-backdrop-filter') E.efeitos.backdropFilter++;
    if (p === 'will-change' && !/^auto$/i.test(v.trim())) E.movimento.willChange++;
    if (p === 'caret-color') E.tema.caretColor++;
    if (p === 'scrollbar-color') E.tema.scrollbarColor++;
    if (p === 'accent-color') E.tema.accentColor++;

    // tipografia
    if (p === 'font-size' && !emKeyframes) {
      const t = v.trim().toLowerCase();
      const m = /^([\d.]+)(px|rem|em|%|vw|vh|vmin|vmax|pt|ch)$/.exec(t);
      cont(E.tipografia.fontSizeUnidades, m ? (m[2] === '%' ? 'pct' : m[2]) : /^clamp\(/.test(t) ? 'clamp' : /^calc\(/.test(t) ? 'calc' : /^var\(/.test(t) ? 'var' : /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/.test(t) ? 'palavra-chave' : /^(inherit|initial|unset)$/.test(t) ? 'herdado' : 'outro');
    }
    if (p === 'font-family') {
      const primeira = dividirTopo(v, ',')[0] || '';
      const nome = primeira.replace(/^["']|["']$/g, '').trim();
      if (nome && !/^var\(/i.test(nome)) {
        cont(E.tipografia.familiasDeclaradas, nome);
        if (FONTES_GENERICAS.has(nome.toLowerCase()) && E.tipografia.exemplosFonteGenerica.length < 10) E.tipografia.exemplosFonteGenerica.push({ arquivo: origem, seletor, trecho: trecho(`${d.prop}: ${v}`, 120), valor: nome });
      }
    }

    // movimento
    if (p === 'transition' || p === 'transition-property' || p === 'transition-timing-function' || p === 'transition-duration') {
      if (p === 'transition') {
        for (const item of dividirTopo(v, ',')) {
          if (/^(none|initial|inherit|unset)$/i.test(item)) continue;
          E.movimento.transicoes++;
          const e = RE_EASING.exec(item);
          const resto = item.replace(RE_EASING, ' ').trim().split(/\s+/).filter(Boolean);
          const tempos = resto.filter((t) => RE_TEMPO.test(t));
          const prop = resto.find((t) => !RE_TEMPO.test(t)) || 'all';
          cont(E.movimento.transicaoPropriedades, prop.toLowerCase());
          if (prop.toLowerCase() === 'all') E.movimento.transicaoAll++;
          cont(E.movimento.easing, e ? categoriaEasing(e[1]) : 'ease (implícito)');
          if (e && /^cubic-bezier/i.test(e[1])) cont(E.movimento.cubicBeziers, e[1].replace(/\s+/g, ''));
          if (tempos[0]) cont(E.movimento.duracoesMs, Math.round(/ms$/i.test(tempos[0]) ? parseFloat(tempos[0]) : parseFloat(tempos[0]) * 1000) + 'ms');
          if (E.evidencias.length < 400 && (prop.toLowerCase() === 'all')) E.evidencias.push({ tipo: 'transition-all', pagina: null, versao: 'final', arquivo: origem, seletor, trecho: trecho(`${d.prop}: ${v}`), valor: 'all', contagem: 1, visivel: null });
        }
      } else if (p === 'transition-timing-function') {
        for (const e of dividirTopo(v, ',')) { cont(E.movimento.easing, categoriaEasing(e)); if (/^cubic-bezier/i.test(e)) cont(E.movimento.cubicBeziers, e.replace(/\s+/g, '')); }
      } else if (p === 'transition-property') {
        for (const x of dividirTopo(v, ',')) { cont(E.movimento.transicaoPropriedades, x.toLowerCase()); if (x.toLowerCase() === 'all') E.movimento.transicaoAll++; }
      }
    }
    if (p === 'animation' || p === 'animation-name' || p === 'animation-timing-function') {
      if (p === 'animation-timing-function') {
        for (const e of dividirTopo(v, ',')) cont(E.movimento.easing, categoriaEasing(e));
      } else {
        for (const item of dividirTopo(v, ',')) {
          if (/^(none|initial|inherit|unset)$/i.test(item)) continue;
          E.movimento.animacoes++;
          if (p === 'animation') {
            const e = RE_EASING.exec(item);
            const resto = item.replace(RE_EASING, ' ').trim().split(/\s+/).filter(Boolean);
            const palavras = new Set(['infinite', 'alternate', 'alternate-reverse', 'reverse', 'normal', 'both', 'forwards', 'backwards', 'paused', 'running']);
            const nome = resto.find((t) => !RE_TEMPO.test(t) && !palavras.has(t.toLowerCase()) && !/^[\d.]+$/.test(t));
            if (nome) cont(E.movimento.animacaoNomes, nome);
            cont(E.movimento.easing, e ? categoriaEasing(e[1]) : 'ease (implícito)');
            if (e && /^cubic-bezier/i.test(e[1])) cont(E.movimento.cubicBeziers, e[1].replace(/\s+/g, ''));
          } else cont(E.movimento.animacaoNomes, item);
        }
      }
    }
  });
}

// CSS gerado por frameworks traz regras como "[class~=...]"; só olhamos classes utilitárias no HTML renderizado.
function classesUtilitarias(html) {
  const out = { indigoVioleta: 0, sombraPadrao: 0, raioGrande: 0, rampaPadrao: 0, animacaoPadrao: 0, backdropBlur: 0, gradienteTailwind: 0, exemplos: {} };
  if (!html) return out;
  const re = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(html))) {
    for (const t0 of (m[1] || m[2] || '').split(/\s+/)) {
      if (!t0) continue;
      const t = t0.slice(t0.lastIndexOf(':') + 1);
      const marca = (k) => { out[k]++; (out.exemplos[k] ||= []); if (out.exemplos[k].length < 8 && !out.exemplos[k].includes(t0)) out.exemplos[k].push(t0); };
      if (RE_CLASSES.indigoVioleta.test(t)) marca('indigoVioleta');
      if (RE_CLASSES.sombraPadrao.test(t)) marca('sombraPadrao');
      if (RE_CLASSES.raioGrande.test(t)) marca('raioGrande');
      if (RE_CLASSES.rampaPadrao.test(t)) marca('rampaPadrao');
      if (RE_CLASSES.animacaoPadrao.test(t)) marca('animacaoPadrao');
      if (/^backdrop-blur/.test(t)) marca('backdropBlur');
      if (/^bg-gradient-to-/.test(t) || /^bg-linear-/.test(t)) marca('gradienteTailwind');
    }
  }
  return out;
}

function resumirEstatico(E, ctx) {
  const e = E.estados;
  const foco = e.focoGlobal.length > 0;
  const focusVisibleExiste = e.focusVisible > 0;
  const semSubst = e.outlineNone.filter((o) => !o.substitutoNaRegra && !(focusVisibleExiste && e.focusVisibleComIndicador));
  const media = E.media;
  const todos = [...media.minW, ...media.maxW];
  const bp = [...new Set(todos)].sort((a, b) => a - b);
  const generica = (n) => FONTES_GENERICAS.has(String(n).toLowerCase());
  const decl = [...E.tipografia.familiasDeclaradas.keys()];
  const folhas = new Set();
  for (const p of ctx.paginas) {
    for (const f of p.final?.extr?.folhas || []) folhas.add(f);
    for (const l of p.final?.extr?.linksHead || []) if (l.href) folhas.add(l.href);
  }
  const externas = [];
  for (const u of [...folhas, ...E.imports.map((i) => i.url)]) {
    const m = /(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|fonts\.adobe\.com)/i.exec(u || '');
    if (m && !externas.some((x) => x.host === m[1].toLowerCase())) externas.push({ host: m[1].toLowerCase(), url: String(u).slice(0, 200) });
  }
  const familiasFontFace = [...E.fontFace.familias.keys()];
  return {
    arquivos: { css: E.arquivos.filter((a) => !a.origem.startsWith('inline:')).length, inline: E.arquivos.filter((a) => a.origem.startsWith('inline:')).length, comErroParse: E.arquivos.filter((a) => a.erroParse).map((a) => ({ origem: a.origem, erro: a.erroParse })), baixadosSemTexto: ctx.ativos.filter((a) => a.tipo === 'css' && a.texto == null).map((a) => ({ url: a.url, erro: a.erro })) },
    bytes: E.bytes, regras: E.regras, declaracoes: E.declaracoes, important: E.important,
    fontFace: { total: E.fontFace.total, familias: ordenado(E.fontFace.familias), fontDisplay: ordenado(E.fontFace.fontDisplay), semFontDisplay: E.fontFace.semFontDisplay, itens: E.fontFace.itens.slice(0, 30) },
    imports: E.imports,
    fontesExternas: externas,
    propriedadesCustom: { total: E.propsCustom.total, nomesDistintos: E.propsCustom.nomes.size, comCor: E.propsCustom.comCor, temTokensSemanticos: E.propsCustom.semanticos.size > 0, semanticos: [...E.propsCustom.semanticos].slice(0, 30) },
    mediaQueries: { total: media.total, breakpointsPx: bp, minWidthPx: [...media.minW].sort((a, b) => a - b), maxWidthPx: [...media.maxW].sort((a, b) => a - b), prefersReducedMotion: media.reducedMotion, reducedMotionAnulaMovimento: media.reducedMotionAnulaMovimento, prefersColorScheme: media.colorScheme, prefersContrast: media.contrast },
    estados: {
      hover: e.hover, focus: e.focus, focusVisible: e.focusVisible, focusWithin: e.focusWithin, active: e.active,
      regraGlobalDeFoco: foco, regrasGlobaisDeFoco: e.focoGlobal.slice(0, 10), focusVisibleComIndicador: e.focusVisibleComIndicador,
      porGrupo: e.porGrupo,
      gruposSemNenhumEstado: GRUPOS.filter((g) => !e.porGrupo[g].hover && !e.porGrupo[g].foco && !e.porGrupo[g].active),
      outlineNone: { total: e.outlineNone.length, semSubstituto: semSubst.length, itens: e.outlineNone.slice(0, 20), itensSemSubstituto: semSubst.slice(0, 20) },
    },
    movimento: {
      transicoes: E.movimento.transicoes, transicaoAll: E.movimento.transicaoAll, propriedadesTransicao: ordenado(E.movimento.transicaoPropriedades, 20),
      easing: ordenado(E.movimento.easing), cubicBeziers: ordenado(E.movimento.cubicBeziers, 10), duracoesMs: ordenado(E.movimento.duracoesMs, 10),
      temCubicBezier: E.movimento.cubicBeziers.size > 0, animacoes: E.movimento.animacoes, animacaoNomes: ordenado(E.movimento.animacaoNomes, 20),
      keyframes: [...E.movimento.keyframes.keys()], willChange: E.movimento.willChange,
      temMovimento: E.movimento.transicoes + E.movimento.animacoes + E.movimento.keyframes.size > 0,
    },
    efeitos: { backdropFilter: E.efeitos.backdropFilter, backgroundClipText: E.efeitos.backgroundClipText, textoGradiente: E.efeitos.textoGradienteDecl },
    temaNativo: E.tema,
    tipografia: {
      fontSizeUnidades: ordenado(E.tipografia.fontSizeUnidades),
      familiasDeclaradas: ordenado(E.tipografia.familiasDeclaradas, 30),
      familiasGenericasUsadas: decl.filter(generica), familiasNaoGenericas: decl.filter((n) => !generica(n) && !/^(serif|monospace|cursive|fantasy|ui-[a-z-]+|inherit|initial|unset|-apple-system)$/i.test(n)),
      temFontFacePropria: E.fontFace.total > 0, familiasFontFace, fontFaceComFamiliaNaoGenerica: familiasFontFace.filter((n) => !generica(n)),
    },
    cores: {
      distintas: E.cores.size, valores: ordenado(E.cores, 40),
      rampaPadrao: { distintas: E.coresPadrao.size, ocorrencias: [...E.coresPadrao.values()].reduce((a, b) => a + b, 0), valores: ordenado(E.coresPadrao) },
      matizRoxoForaDaLista: ordenado(E.coresRoxas, 10),
    },
    gradientes: { total: E.gradientes.total, porTipo: ordenado(E.gradientes.tipos), azulParaRoxo: E.gradientes.azulRoxo.length, comHexPadrao: E.gradientes.comHexPadrao.length, exemplosAzulRoxo: E.gradientes.azulRoxo.slice(0, 5), exemplosHexPadrao: E.gradientes.comHexPadrao.slice(0, 5) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// derivados por página (a partir dos estilos computados)
// ---------------------------------------------------------------------------------------------------------------------
function derivarComputado(es) {
  if (!es) return null;
  const tip = es.tipografia, cor = es.cores;
  const generica = (n) => !!n && FONTES_GENERICAS.has(String(n).toLowerCase());
  const naLista = (lista) => (lista || []).filter((c) => HEX_PADRAO.has(c.hex));
  const cromatica = (lista) => (lista || []).filter((c) => c.s >= 0.25);
  const somaN = (l) => l.reduce((a, c) => a + c.contagem, 0);
  const rampa = { texto: naLista(cor.texto), fundo: naLista(cor.fundo), borda: naLista(cor.borda) };
  const nDestaque = somaN(cromatica(cor.texto)) + somaN(cromatica(cor.fundo)) + somaN(cromatica(cor.borda));
  const nRampa = somaN(rampa.texto) + somaN(rampa.fundo) + somaN(rampa.borda);
  const dentroAzul = (h) => noIntervalo(h, PALETA_PADRAO.faixaMatizAzul), dentroRoxo = (h) => noIntervalo(h, PALETA_PADRAO.faixaMatizRoxo);
  const azulRoxo = es.gradientes.itens.filter((g) => {
    const hs = g.paradas.filter((p) => p.s >= 0.2 && p.a > 0).map((p) => p.h);
    return g.tipo === 'linear' && hs.some(dentroAzul) && hs.some(dentroRoxo);
  });
  const usosRaio = es.raios.valores[es.raios.dominante] || 0;
  const entradas = es.movimento.animacoes.porNome.filter((a) => a.ehEntrada);
  const maisRepetida = entradas.length ? entradas[0] : (es.movimento.animacoes.porNome[0] || null);
  const grade3 = es.layout.grades.find((g) => g.colunas === 3 && g.filhos >= 3) || null;
  const flex3 = es.layout.flexLinhas.find((f) => f.filhos === 3 && f.larguraIgual) || null;
  const primario = cor.botoes.primario;
  return {
    fonte: { body: tip.familias.body, h1: tip.familias.h1, bodyGenerica: generica(tip.familias.body), h1Generica: generica(tip.familias.h1), temFonteCustom: tip.fontes.temFonteCustom, bodyUsaFonteCustom: tip.fontes.bodyUsaFonteCustom, h1UsaFonteCustom: tip.fontes.h1UsaFonteCustom, familiasDistintas: tip.familias.nDistintas, familiasNaoGenericas: Object.keys(tip.familias.valores).filter((n) => !generica(n)) },
    tipografia: { nTamanhos: tip.tamanhos.nDistintos, tamanhos: tip.tamanhos.lista, tamanhosAbaixo12: tip.tamanhos.abaixo12.tamanhos.length, h1Px: tip.h1 ? tip.h1.tamanhoPx : null, h1LetterSpacingEm: tip.h1 ? tip.h1.letterSpacingEm : null, titulosGrandes: tip.titulosGrandes.total, titulosGrandesSemTrackingNegativo: tip.titulosGrandes.total - tip.titulosGrandes.comTrackingNegativo, nPesos: tip.pesos.nDistintos, lineHeightMedianaCorpo: tip.lineHeightCorpo.medianaRazao, caracteresPorLinhaMediana: tip.paragrafos.caracteresPorLinhaMediana },
    cor: {
      rampaPadrao: { elementos: nRampa, porOnde: { texto: somaN(rampa.texto), fundo: somaN(rampa.fundo), borda: somaN(rampa.borda) }, hex: [...new Set([...rampa.texto, ...rampa.fundo, ...rampa.borda].map((c) => c.hex))] },
      elementosDeDestaque: nDestaque, intensidade: nDestaque ? Math.round((nRampa / nDestaque) * 1000) / 1000 : 0,
      botaoPrimarioNaRampa: !!(primario && HEX_PADRAO.has(primario.fundo)), botaoPrimarioFundo: primario ? primario.fundo : null,
      temaEscuro: cor.temaEscuro, fundoPagina: cor.paginaFundo.hex, nDistintas: { texto: cor.nDistintasTexto, fundo: cor.nDistintasFundo },
    },
    gradiente: { elementos: es.gradientes.elementos, azulParaRoxo: azulRoxo.length, azulParaRoxoItens: azulRoxo.slice(0, 5).map((g) => ({ seletor: g.seletor, paradas: g.paradas.map((p) => p.hex), angulo: g.angulo, aplicadoAoTexto: g.aplicadoAoTexto })), textoComGradiente: es.gradientes.texto.elementos },
    raios: { dominante: es.raios.dominante, usosDominante: usosRaio, nDistintos: es.raios.nDistintos, fracaoDominante: es.raios.fracaoDominante, porTipoDistintos: Object.fromEntries(Object.entries(es.raios.porTipo).map(([k, v]) => [k, Object.keys(v).length])), pilulas: es.raios.pilulas },
    sombras: { difusaGenerica: es.sombras.elementosComDifusaGenerica, glow: es.sombras.elementosComGlow, dura: es.sombras.elementosComSombraDura, comSombra: es.sombras.elementos },
    efeitos: { backdropBlur: es.efeitos.backdropBlur.elementos, blurGrande: es.efeitos.filtros.blurGrande },
    cards: { total: es.cards.total, paddingDominante: es.cards.paddingDominante, fracaoPaddingDominante: es.cards.fracaoPaddingDominante, nPaddingDistintos: es.cards.nPaddingDistintos, aninhados: es.cards.aninhados.total },
    secoes: { n: es.secoes.n, uniforme: es.secoes.uniforme, valorDominante: es.secoes.valorDominante, fracaoDominante: es.secoes.fracaoDominante },
    centralizacao: { fracao: es.layout.centralizacao.fracao, blocos: es.layout.centralizacao.blocos, centralizados: es.layout.centralizacao.centralizados },
    heroTresCards: { hero: es.layout.heroes.length > 0, heroCentralizado: es.layout.heroes.some((h) => /center/.test(h.textAlign)), grade3Colunas: !!grade3, filhosDaGrade: grade3 ? grade3.filhos : (flex3 ? flex3.filhos : 0), flex3Iguais: !!flex3 },
    emojis: { total: es.emojis.contagem, unicos: es.emojis.unicos },
    movimento: { animacoesElementos: es.movimento.animacoes.elementos, animacaoMaisRepetida: maisRepetida ? { nome: maisRepetida.nome, elementos: maisRepetida.elementos, ehEntrada: maisRepetida.ehEntrada } : null, transicoesElementos: es.movimento.transicoes.elementos, transicaoAll: es.movimento.transicoes.all, temEasingCustom: es.movimento.transicoes.temEasingCustom, soEasingPadrao: es.movimento.transicoes.soEasingPadrao },
    contraste: { avaliados: es.contraste.avaliados, falhas: es.contraste.falhas, indeterminados: es.contraste.indeterminados, razaoMinima: es.contraste.razaoMinima },
    alvosToque: { total: es.alvosToque.total, abaixo24: es.alvosToque.abaixo24, abaixo44: es.alvosToque.abaixo44, abaixo24SemInline: es.alvosToque.abaixo24SemInline },
    overflowHorizontal: es.overflowHorizontal.ativo,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// medir
// ---------------------------------------------------------------------------------------------------------------------
export async function medir(ctx) {
  const evidencias = [];
  const LIM = 12; // por tipo e por página
  const contadorEv = new Map();
  const ev = (tipo, e) => {
    const k = `${tipo}|${e.pagina ?? ''}`;
    if ((contadorEv.get(k) || 0) >= LIM) return;
    contadorEv.set(k, (contadorEv.get(k) || 0) + 1);
    evidencias.push({ tipo, pagina: e.pagina ?? null, versao: e.versao ?? 'final', seletor: e.seletor ?? null, trecho: e.trecho ?? null, valor: e.valor ?? null, contagem: e.contagem ?? null, visivel: e.visivel ?? true, ...(e.arquivo ? { arquivo: e.arquivo } : {}) });
  };

  // ---- CSS estático (arquivos baixados + <style> inline, sem duplicar o mesmo conteúdo) ----
  const E = novoEstatico();
  const vistos = new Set();
  for (const a of ctx.ativos || []) {
    if (a.tipo !== 'css' || a.texto == null) continue;
    const h = a.hash || sha256(a.texto);
    if (vistos.has(h)) continue;
    vistos.add(h);
    processarCss(E, a.texto, a.url);
  }
  const paginasLidas = ctx.paginas || [];
  const inlinePorPagina = new Map();
  for (const p of paginasLidas) {
    const blocos = (p.final?.extr?.estilosInline || []).filter((t) => t && t.trim());
    let bytes = 0;
    blocos.forEach((t, i) => {
      bytes += t.length;
      const h = sha256(t);
      if (vistos.has(h)) return;
      vistos.add(h);
      processarCss(E, t, `inline:${p.url}#${i}`);
    });
    inlinePorPagina.set(p, { blocosInline: blocos.length, bytesInline: bytes });
  }
  const estatico = resumirEstatico(E, ctx);

  // evidências do CSS estático
  for (const o of E.estados.outlineNone.filter((x) => !x.substitutoNaRegra).slice(0, LIM)) ev('css-outline-none', { arquivo: o.arquivo, seletor: o.seletor, trecho: o.valor, valor: o.valor, contagem: 1, visivel: null });
  for (const c of E.evCoresPadrao.slice(0, LIM)) ev('css-cor-paleta-padrao', { arquivo: c.arquivo, seletor: c.seletor, trecho: c.trecho, valor: c.valor, contagem: E.coresPadrao.get(c.valor) });
  for (const g of E.gradientes.azulRoxo.slice(0, LIM)) ev('css-gradiente-azul-roxo', { arquivo: g.arquivo, seletor: g.seletor, trecho: g.trecho, valor: g.cores.join('→'), contagem: 1 });
  for (const g of E.efeitos.textoGradienteDecl.slice(0, LIM)) ev('css-background-clip-text', { arquivo: g.arquivo, seletor: g.seletor, trecho: g.trecho, valor: 'background-clip: text', contagem: 1 });
  for (const f of E.tipografia.exemplosFonteGenerica.slice(0, LIM)) ev('css-fonte-generica', { arquivo: f.arquivo, seletor: f.seletor, trecho: f.trecho, valor: f.valor, contagem: E.tipografia.familiasDeclaradas.get(f.valor) });
  for (const f of E.fontFace.itens.slice(0, LIM)) ev('css-font-face', { arquivo: f.arquivo, seletor: '@font-face', trecho: `font-family: ${f.familia}; font-display: ${f.fontDisplay ?? '(ausente)'}`, valor: f.familia, contagem: 1, visivel: null });
  if (!E.estados.focusVisible && !E.estados.focus) ev('css-sem-foco', { seletor: null, trecho: 'nenhuma regra :focus nem :focus-visible no CSS analisado', valor: 0, contagem: 0, visivel: null });
  if (!E.media.reducedMotion && (E.movimento.transicoes + E.movimento.animacoes + E.movimento.keyframes.size) > 0) ev('css-sem-reduced-motion', { seletor: null, trecho: `${E.movimento.transicoes} transições, ${E.movimento.animacoes} animações e ${E.movimento.keyframes.size} @keyframes sem @media (prefers-reduced-motion)`, valor: 0, contagem: 0, visivel: null });

  // ---- por página ----
  const paginas = [];
  const agg = {
    paginasLidas: paginasLidas.length, paginasComEstilos: 0, familiasBody: new Map(), familiasH1: new Map(), temFonteCustom: false, tamanhosDistintos: new Set(), raios: new Map(),
    emojis: 0, falhasContraste: 0, paginasComOverflowMobile: 0, alvosAbaixo44Mobile: 0, paginasComGradienteAzulRoxo: 0, cardsAninhados: 0, paginasComHeroTresCards: 0,
    paginasComTextoGradiente: 0, sombrasDifusas: 0, backdropBlur: 0, paginasComRampaPadrao: 0, paginasSemViewportMeta: 0,
  };
  for (const p of paginasLidas) {
    const url = p.url;
    const es = p.final?.estilos || null;
    const mob = p.mobile || null;
    const der = derivarComputado(es);
    const util = classesUtilitarias(p.final?.html);
    paginas.push({
      url,
      computado: es,
      mobile: mob ? { overflowHorizontal: mob.overflowHorizontal, viewportMeta: mob.viewportMeta, estilos: mob.estilos } : null,
      derivados: der,
      derivadosMobile: mob && mob.estilos ? { alvosToque: { total: mob.estilos.alvosToque.total, abaixo24: mob.estilos.alvosToque.abaixo24, abaixo44: mob.estilos.alvosToque.abaixo44, abaixo24SemInline: mob.estilos.alvosToque.abaixo24SemInline }, contraste: { avaliados: mob.estilos.contraste.avaliados, falhas: mob.estilos.contraste.falhas }, overflowHorizontal: mob.estilos.overflowHorizontal.ativo, tamanhoFonteMinimoPx: mob.estilos.tipografia.tamanhos.menorPx } : null,
      estatico: Object.assign({ arquivosCss: (p.final?.extr?.folhas || []) }, inlinePorPagina.get(p) || { blocosInline: 0, bytesInline: 0 }),
      classesUtilitarias: util,
    });
    if (!es) continue;
    agg.paginasComEstilos++;
    cont(agg.familiasBody, der.fonte.body || '(vazio)'); cont(agg.familiasH1, der.fonte.h1 || '(sem h1)');
    agg.temFonteCustom ||= der.fonte.temFonteCustom;
    for (const t of es.tipografia.tamanhos.lista) agg.tamanhosDistintos.add(t);
    for (const [k, n] of Object.entries(es.raios.valores)) cont(agg.raios, k, n);
    agg.emojis += es.emojis.contagem; agg.falhasContraste += es.contraste.falhas;
    if (der.gradiente.azulParaRoxo) agg.paginasComGradienteAzulRoxo++;
    agg.cardsAninhados += der.cards.aninhados;
    if (der.heroTresCards.hero && der.heroTresCards.grade3Colunas) agg.paginasComHeroTresCards++;
    if (der.gradiente.textoComGradiente) agg.paginasComTextoGradiente++;
    agg.sombrasDifusas += der.sombras.difusaGenerica; agg.backdropBlur += der.efeitos.backdropBlur;
    if (der.cor.rampaPadrao.elementos) agg.paginasComRampaPadrao++;
    if (mob) { if (mob.overflowHorizontal) agg.paginasComOverflowMobile++; if (mob.estilos) agg.alvosAbaixo44Mobile += mob.estilos.alvosToque.abaixo44; if (!mob.viewportMeta) agg.paginasSemViewportMeta++; }

    // evidências computadas
    const base = { pagina: url, versao: 'final' };
    ev('fonte-body', { ...base, seletor: 'body', trecho: es.tipografia.familias.pilhaBody, valor: es.tipografia.familias.body, contagem: es.tipografia.familias.valores[es.tipografia.familias.body] || 0 });
    if (es.tipografia.h1) ev('fonte-h1', { ...base, seletor: es.tipografia.h1.seletor, trecho: es.tipografia.familias.pilhaH1, valor: es.tipografia.h1.familia });
    if (es.tipografia.h1) ev('tamanho-h1', { ...base, seletor: es.tipografia.h1.seletor, trecho: `font-size: ${es.tipografia.h1.tamanhoPx}px; letter-spacing: ${es.tipografia.h1.letterSpacingPx}px`, valor: es.tipografia.h1.tamanhoPx });
    ev('escala-tipografica', { ...base, seletor: null, trecho: es.tipografia.tamanhos.lista.map((t) => t + 'px').join(', '), valor: es.tipografia.tamanhos.nDistintos, contagem: es.tipografia.tamanhos.nDistintos });
    for (const t of es.tipografia.titulos.filter((x) => x.tamanhoPx >= 36 && x.letterSpacingPx >= 0)) ev('titulo-sem-tracking', { ...base, seletor: t.seletor, trecho: `${t.tag} ${t.tamanhoPx}px, letter-spacing ${t.letterSpacingPx}px: ${t.texto}`, valor: t.letterSpacingEm });
    for (const t of es.tipografia.tamanhos.abaixo12.exemplos) ev('microtipo', { ...base, seletor: t.seletor, trecho: t.texto, valor: t.tamanhoPx });
    for (const c of rampaEvidencias(es)) ev('cor-rampa-padrao', { ...base, seletor: null, trecho: `${c.onde}: ${c.hex}`, valor: c.hex, contagem: c.contagem });
    if (es.cores.botoes.primario) ev('botao-primario', { ...base, seletor: es.cores.botoes.primario.seletor, trecho: `fundo ${es.cores.botoes.primario.fundo}; texto ${es.cores.botoes.primario.cor}; raio ${es.cores.botoes.primario.raio}`, valor: es.cores.botoes.primario.fundo });
    for (const g of es.gradientes.itens.filter((x) => azulRoxoItem(x))) ev('gradiente-azul-roxo', { ...base, seletor: g.seletor, trecho: `${g.tipo}-gradient(${g.direcao ?? ''} ${g.paradas.map((x) => x.hex).join(', ')})`, valor: g.paradas.map((x) => x.hex).join('→'), contagem: 1 });
    for (const g of es.gradientes.texto.itens) ev('texto-com-gradiente', { ...base, seletor: g.seletor, trecho: `${g.tag} ${g.tamanhoPx}px: ${g.texto}`, valor: 'background-clip:text', contagem: es.gradientes.texto.elementos });
    if (es.raios.comRaio) ev('raio-dominante', { ...base, seletor: null, trecho: `border-radius ${es.raios.dominante} em ${es.raios.valores[es.raios.dominante]} de ${es.raios.comRaio} elementos (${es.raios.nDistintos} valor(es) distinto(s))`, valor: es.raios.dominante, contagem: es.raios.valores[es.raios.dominante] });
    for (const d of es.sombras.detalhes.filter((x) => x.difusaGenerica)) ev('sombra-difusa', { ...base, seletor: es.sombras.exemplosDifusa[0] ?? null, trecho: d.raw, valor: `blur ${d.blur}px, alfa ${d.alfa}`, contagem: d.elementos });
    for (const d of es.sombras.detalhes.filter((x) => x.glow)) ev('sombra-glow', { ...base, seletor: null, trecho: d.raw, valor: d.cor, contagem: d.elementos });
    for (const ex of es.efeitos.backdropBlur.exemplos) ev('backdrop-blur', { ...base, seletor: ex.seletor, trecho: ex.valor, valor: ex.valor, contagem: es.efeitos.backdropBlur.elementos });
    for (const par of es.cards.aninhados.pares) ev('card-dentro-de-card', { ...base, seletor: par.filho, trecho: `dentro de ${par.pai}`, valor: par.pai, contagem: es.cards.aninhados.total });
    if (es.cards.total) ev('padding-cards', { ...base, seletor: es.cards.exemplos[0]?.seletor ?? null, trecho: `padding dominante ${es.cards.paddingDominante}`, valor: es.cards.paddingDominante, contagem: es.cards.padding[es.cards.paddingDominante] });
    if (es.secoes.n >= 2) ev('ritmo-secoes', { ...base, seletor: null, trecho: es.secoes.itens.map((s) => `${s.tag}:${s.paddingTopPx}/${s.paddingBottomPx}`).join(' '), valor: es.secoes.uniforme, contagem: es.secoes.n });
    ev('centralizacao', { ...base, seletor: null, trecho: `${es.layout.centralizacao.centralizados} de ${es.layout.centralizacao.blocos} blocos de topo centralizados`, valor: es.layout.centralizacao.fracao, contagem: es.layout.centralizacao.centralizados });
    for (const g of es.layout.grades) ev('grade', { ...base, seletor: g.seletor, trecho: `grid com ${g.colunas} colunas e ${g.filhos} filhos`, valor: g.colunas, contagem: g.filhos });
    for (const h of es.layout.heroes) ev('hero', { ...base, seletor: h.seletor, trecho: `${h.tag}.${h.classe} text-align ${h.textAlign}`, valor: h.textAlign });
    if (es.emojis.contagem) for (const e of es.emojis.elementos) ev('emoji', { ...base, seletor: e.seletor, trecho: e.texto, valor: e.emojis.join(''), contagem: es.emojis.contagem });
    for (const a of es.movimento.animacoes.porNome) ev('animacao', { ...base, seletor: null, trecho: `animation-name ${a.nome} (${a.duracaoMs}ms ${a.easing})`, valor: a.nome, contagem: a.elementos });
    if (es.movimento.transicoes.elementos) ev('transicoes', { ...base, seletor: null, trecho: `easing: ${Object.keys(es.movimento.transicoes.easing).join(', ')}`, valor: es.movimento.transicoes.elementos, contagem: es.movimento.transicoes.elementos });
    for (const f of es.contraste.itens) ev('contraste-falha', { ...base, seletor: f.seletor, trecho: `${f.corTexto} sobre ${f.corFundo}: ${f.texto}`, valor: f.razao, contagem: es.contraste.falhas });
    for (const t of es.alvosToque.exemplos) ev('alvo-toque-pequeno', { ...base, seletor: t.seletor, trecho: `${t.tag} ${t.larguraPx}x${t.alturaPx}px: ${t.texto}`, valor: `${t.larguraPx}x${t.alturaPx}`, contagem: es.alvosToque.abaixo44 });
    for (const i of es.imagens.exemplos) ev('imagem-proporcao', { ...base, seletor: i.seletor, trecho: `render ${i.renderW}x${i.renderH}, natural ${i.naturalW}x${i.naturalH}`, valor: i.razaoAspecto });
    if (es.overflowHorizontal.ativo) ev('overflow-horizontal', { ...base, seletor: es.overflowHorizontal.culpados[0]?.seletor ?? null, trecho: `documento ${es.overflowHorizontal.larguraDocumento}px > ${es.overflowHorizontal.larguraReferencia}px`, valor: es.overflowHorizontal.larguraDocumento });
    if (util.indigoVioleta) ev('classes-indigo-violeta', { ...base, seletor: null, trecho: util.exemplos.indigoVioleta.join(' '), valor: util.indigoVioleta, contagem: util.indigoVioleta });
    if (mob) {
      const bm = { pagina: url, versao: 'final' };
      if (mob.overflowHorizontal) ev('mobile-overflow-horizontal', { ...bm, seletor: mob.estilos?.overflowHorizontal.culpados[0]?.seletor ?? null, trecho: `documento ${mob.estilos?.overflowHorizontal.larguraDocumento}px em viewport de ${mob.estilos?.overflowHorizontal.larguraReferencia}px`, valor: true });
      if (!mob.viewportMeta) ev('mobile-sem-viewport-meta', { ...bm, seletor: 'meta[name=viewport]', trecho: 'ausente', valor: null });
      for (const t of (mob.estilos?.alvosToque.exemplos || [])) ev('mobile-alvo-toque-pequeno', { ...bm, seletor: t.seletor, trecho: `${t.tag} ${t.larguraPx}x${t.alturaPx}px: ${t.texto}`, valor: `${t.larguraPx}x${t.alturaPx}`, contagem: mob.estilos.alvosToque.abaixo44 });
      for (const f of (mob.estilos?.contraste.itens || [])) ev('mobile-contraste-falha', { ...bm, seletor: f.seletor, trecho: `${f.corTexto} sobre ${f.corFundo}: ${f.texto}`, valor: f.razao });
    }
  }

  const site = {
    computado: {
      paginasLidas: agg.paginasLidas, paginasComEstilos: agg.paginasComEstilos, familiasBody: ordenado(agg.familiasBody), familiasH1: ordenado(agg.familiasH1), temFonteCustom: agg.temFonteCustom,
      tamanhosDistintos: [...agg.tamanhosDistintos].sort((a, b) => a - b), raios: ordenado(agg.raios), emojis: agg.emojis, falhasContraste: agg.falhasContraste,
      paginasComOverflowMobile: agg.paginasComOverflowMobile, alvosAbaixo44Mobile: agg.alvosAbaixo44Mobile, paginasSemViewportMeta: agg.paginasSemViewportMeta,
      paginasComGradienteAzulRoxo: agg.paginasComGradienteAzulRoxo, cardsAninhados: agg.cardsAninhados, paginasComHeroTresCards: agg.paginasComHeroTresCards,
      paginasComTextoGradiente: agg.paginasComTextoGradiente, sombrasDifusas: agg.sombrasDifusas, backdropBlur: agg.backdropBlur, paginasComRampaPadrao: agg.paginasComRampaPadrao,
    },
    estatico,
  };
  return { id, versao: VERSAO, dados: { paletaPadrao: PALETA_PADRAO, paginas, site }, evidencias };
}

function azulRoxoItem(g) {
  const hs = g.paradas.filter((p) => p.s >= 0.2 && p.a > 0).map((p) => p.h);
  return g.tipo === 'linear' && hs.some((h) => noIntervalo(h, PALETA_PADRAO.faixaMatizAzul)) && hs.some((h) => noIntervalo(h, PALETA_PADRAO.faixaMatizRoxo));
}
function rampaEvidencias(es) {
  const out = [];
  for (const [onde, lista] of [['texto', es.cores.texto], ['fundo', es.cores.fundo], ['borda', es.cores.borda]]) for (const c of lista) if (HEX_PADRAO.has(c.hex)) out.push({ onde, hex: c.hex, contagem: c.contagem });
  return out;
}
