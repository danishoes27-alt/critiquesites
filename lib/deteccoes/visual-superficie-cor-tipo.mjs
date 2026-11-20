// DETECTORES VISUAIS: COR, TIPOGRAFIA, SUPERFÍCIE e ICONOGRAFIA (regras/visual-cor.json, visual-tipografia.json,
// visual-superficie.json e visual-iconografia.json; só as regras de tipo 'script' e 'misto').
//
// Princípios (SPEC / motor.mjs):
//  - o script MEDE, o modelo julga: cada detector devolve fatos (seletor, trecho, valor) e nunca opina sobre autoria;
//  - null = "não avaliável" (medidor ausente/erro/dado ausente), NUNCA "ok";
//  - intensidade 0..1 = força do sinal (fração de elementos afetados etc.), usada no Tell Score (peso x intensidade);
//  - toda citação é conferida contra o mesmo corpus que o verificador usa ANTES de entrar no achado (citarSeExiste).
//
// De onde vêm os dados:
//  (1) saída do medidor css (estilos COMPUTADOS agregados de final.estilos, CSS estático, classes utilitárias);
//  (2) um analisador ESTÁTICO leve, interno a este arquivo, para o que o computado agregado não entrega (fatos por
//      elemento): lê o HTML final (árvore) + o CSS (postcss) e resolve um "mini-cascata" (seletores simples, herança de
//      poucas propriedades, var(), @media de desktop). É uma aproximação declarada: seletores que ele não entende não
//      casam (subestima, nunca inventa).
// Limiares: todos expostos em LIMIARES. Onde a regra traz número, ele está aqui; onde não traz, vai marcado
// "limiar inicial, a calibrar".
import postcss from 'postcss';
import { normalizarTexto, extrairNumeros, decodificarEntidades } from '../util.mjs';
import { montarCorpus } from '../verificador.mjs';
import { PALETA_PADRAO } from '../medidores/css.mjs';

export const LIMIARES = {
  viewportDesktopPx: 1440, // largura usada para decidir se um @media (min/max-width) está ativo no desktop
  // ---- cor ----
  'cor-roxo-indigo-padrao': { saturacaoDestaqueMinima: 0.4 /* limiar inicial, a calibrar */, intensidadeMinimaSePresente: 0.2 /* limiar inicial, a calibrar */ },
  'cor-gradiente-azul-roxo': { matizAzul: [200, 240], matizRoxo: [255, 300], matizRosa: [301, 345], matizCiano: [170, 199], saturacaoMinima: 0.2, regexClasses: /\bfrom-(purple|violet|indigo|fuchsia)-\d{2,3}(\s+via-\w+-\d{2,3})?\s+to-(blue|indigo|pink|cyan|sky)-\d{2,3}\b/gi },
  'cor-sem-tokens-semanticos': { minimoClasses: 4, classesParaSaturar: 16 /* limiar inicial, a calibrar */ },
  'cor-pills-multicoloridas': { minimoFamilias: 3, totalFamilias: 8, maxCaracteres: 28, raioPilulaPx: 999 /* 999px e 9999px (rounded-full) desenham o mesmo */, cromaMinimo: 0.03 /* limiar inicial, a calibrar */ },
  'cor-paleta-arco-iris': { minimoFamilias: 5, minimoElementosPorFamilia: 2 /* limiar inicial, a calibrar */, familiasPossiveis: 12 },
  'cor-neutros-sem-tom': { cromaNeutroMinimo: 0.005, cromaLimiteNeutro: 0.04 /* limiar inicial, a calibrar */, cromaDestaqueMinimo: 0.08 },
  'cor-acento-em-area-grande': { avisoFracao: 0.05, forteFracao: 0.08, tituloDisplayMinimoPx: 48, alturaTelaPx: 800, cromaAcentoMinimo: 0.08 },
  'cor-gradiente-repetido': { minimoElementos: 3, elementosParaSaturar: 6 /* limiar inicial, a calibrar */ },
  'cor-cinza-sobre-fundo-colorido': { textoCromaMaximo: 0.04, textoLuminosidade: [0.3, 0.85], fundoCromaMinimo: 0.08, minimoOcorrencias: 2 /* limiar inicial, a calibrar */, ocorrenciasParaSaturar: 8 /* limiar inicial, a calibrar */ },
  'cor-look-creme-terracota': { fundo: { Lmin: 0.9, Cmin: 0.006, matiz: [55, 105] }, acento: { Cmin: 0.08, matiz: [15, 55] }, serifadasDeModa: ['fraunces', 'playfair display', 'cormorant', 'lora', 'crimson', 'newsreader', 'dm serif'] },
  // ---- tipografia ----
  'tipo-fonte-padrao': { listaDisplayExtra: ['impact', 'arial black'] },
  'tipo-escala-ausente-ou-caotica': { minimoTamanhosParaHierarquia: 3, maximoTamanhos: 18, secoesMinimas: 2, tamanhosParaSaturar: 36 /* limiar inicial, a calibrar */ },
  'tipo-pesos-exagerados': { maximoPesos: 3, pesoExtremo: 800 },
  'tipo-titulo-sem-tracking': { tamanhoMinimoPx: 36 },
  'tipo-tracking-fora-de-faixa': { tamanhoTextoPequenoPx: 16, minimoEm: -0.04, ocorrenciasParaSaturar: 3 /* limiar inicial, a calibrar */ },
  'tipo-microtexto': { limitePx: 12, minimoTamanhosDistintos: 3, textoFuncionalMinimoPx: 11, tamanhosParaSaturar: 6 /* limiar inicial, a calibrar */ },
  'tipo-entrelinha-apertada': { prosaMinimoRazao: 1.3, caixaAltaMinimoQuebravel: 1.0, caixaAltaMinimoLinhaUnica: 1.02 },
  'tipo-linha-longa-demais': { limiteAviso: 75, limiteForte: 88, intervaloParaSaturar: 25 /* limiar inicial, a calibrar */ },
  'tipo-familias-demais': { maximoFamilias: 3, familiasParaSaturar: 6 /* limiar inicial, a calibrar */, regexFonteDeIcones: /(font\s?awesome|material (icons|symbols)|glyphicons|icomoon|ionicons|bootstrap-icons|feather|remixicon|boxicons|lucide|phosphor|themify|dashicons|fontello|linearicons|simple-line-icons|typicons|elusive|^fa$|^fa[srbl]$)/i },
  'tipo-texto-gradiente': { matizesIguaisGraus: 20, intensidadeUmaMatiz: 0.5 /* limiar inicial, a calibrar */ },
  'tipo-palavra-destacada-no-titulo': { minimoTitulos: 2 },
  'tipo-rotulo-caixa-alta-espacado': { ramoA: { tamanhoMaximoPx: 15, letterSpacingAcimaEm: 0.03, minimoOcorrencias: 3, ocorrenciasParaSaturar: 8 /* limiar inicial, a calibrar */ }, ramoB: { maxPalavras: 7, maxCaracteres: 56, letterSpacingMinimoEm: 0.04, sinaisNecessarios: 2, minimoOcorrencias: 2, ocorrenciasParaSaturar: 4 /* limiar inicial, a calibrar */ } },
  'tipo-mono-decorativa': { minimoOcorrencias: 3, ocorrenciasParaSaturar: 6 /* limiar inicial, a calibrar */, regexFamiliaMono: /mono|courier|jetbrains|plex mono|geist mono|fira code|space mono|dm mono|roboto mono|source code/i },
  'tipo-numeros-sem-tabular': { minimoDigitos: 3, fracaoParaDisparar: 0.5, minimoCandidatos: 3 /* limiar inicial, a calibrar */ },
  'tipo-acabamento-fino': { minimoAchados: 2, achadosParaSaturar: 6 /* limiar inicial, a calibrar */ },
  'tipo-titulos-de-secao-timidos': { medianaMinimaPx: 40, intervaloParaSaturar: 20 /* limiar inicial, a calibrar */ },
  // ---- superfície ----
  'sup-sombra-difusa-padrao': { minimoOcorrencias: 3, alfaMinimo: 0.1, alfaMaximo: 0.2 },
  'sup-brilho-neon-glow': { blurMinimoPx: 20, cromaMinimo: 0.04, alfaMinimo: 0.05, orbeBlurMinimoPx: 40, ocorrenciasParaSaturar: 3 /* limiar inicial, a calibrar */ },
  'sup-raio-unico-em-tudo': { valoresDistintos: 1, minimoUsos: 5, usosParaSaturar: 10 /* limiar inicial, a calibrar */ },
  'sup-pilula-em-tudo': { raioPilulaPx: 9999, tamanhoIgnoradoPx: 48, minimoElementos: 5, elementosParaSaturar: 10 /* limiar inicial, a calibrar */, regexSeletorControle: /btn|button|cta|input|select|textarea|switch|toggle|control|chip|pill|tag|badge|status/i },
  'sup-card-dentro-de-card': { minimoAninhados: 1 },
  'sup-card-shadcn-padrao': { trioClasses: ['rounded-lg', 'border', 'bg-card', 'text-card-foreground', 'shadow-sm'] },
  'sup-borda-lateral-colorida': { espessuraMinimaPx: 2, cromaMinimo: 0.04, outrosLadosMaximoPx: 1 },
  'sup-sombra-dura-offset': {},
  'sup-cards-irmaos-inconsistentes': { minimoIrmaos: 3, regexDestaque: /feature|destaque|popular|highlight|recommend|selected|active|primary|best|pro\b|premium/i },
  'sup-fundo-grade-ou-pontos': {},
  'sup-navegador-sem-tema': {},
  'sup-raio-aninhado-errado': {},
  'sup-moldura-de-janela-falsa': { circuloMaximoPx: 16, regexClasseBarra: /(browser|window|mac|osx)[-_]?(bar|chrome|dots|controls)|traffic[-_]?light|title[-_]?bar|window[-_]?(dots|buttons)|url[-_]?(bar|pill)/i, regexClasseAparelho: /phone[-_]?(frame|mock(up)?)|device[-_]?frame|\bnotch\b|terminal[-_]?(chrome|frame|bar|dots|header)|(ide|editor)[-_]?(chrome|frame)|(browser|window)[-_]?frame/i },
  // ---- iconografia ----
  'icone-emoji-como-icone': { minimoEmojis: 2, emojisParaSaturar: 6 /* limiar inicial, a calibrar */ },
  'icone-sparkle-ia': { emojis: ['✨', '🪄', '🤖', '🧠'] },
  'icone-bibliotecas-misturadas': { minimoBibliotecas: 2, marcaTerceirosMaximo: 2 },
  'icone-tamanhos-e-tracos-soltos': { tamanhoMaximoIconePx: 32, maximoStrokeWidthDistintos: 1, maximoTamanhosDistintos: 3 },
  'icone-em-tile-colorido': { tamanhoMaximoPx: 64, minimoRepeticoes: 3 },
  'icone-ilustracao-svg-desenhada': { tamanhoMinimoPx: 120, minimoCurvasOuPreenchimentos: 3, orcamentoIconePx: 64 },
  'icone-ilustracao-de-banco-generica': { regex: /undraw|storyset|drawkit/i },
  'icone-logo-gradiente-orbe': { minimoSinais: 2 },
  'icone-bloco-visual-vazio': { larguraMinimaPx: 300, alturaMinimaPx: 200 },
  'icone-selo-novidade-com-emoji': { maxCaracteres: 28 },
};

// =====================================================================================================================
// utilitários gerais
// =====================================================================================================================
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const arred = (x, c = 3) => { const f = 10 ** c; return Math.round(x * f) / f; };
const soma = (l) => l.reduce((a, b) => a + b, 0);
const media = (l) => (l.length ? soma(l) / l.length : 0);
const mediana = (l) => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const unicos = (l) => [...new Set(l)];
const cortar = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
// intensidade graduada por contagem (para regras de presença com limiar mínimo): base para o mínimo, +passo por ocorrência extra
const escala = (n, { base = 0.4, passo = 0.2 } = {}) => clamp01(base + passo * (n - 1));
// formata número em pt-BR (vírgula decimal) sem lixo de ponto flutuante
const fmt = (n, c = 2) => String(arred(n, c)).replace('.', ',');
const pct = (x) => `${Math.round(x * 100)}%`;
const incluiMinusc = (lista, v) => lista.includes(String(v).toLowerCase());

// =====================================================================================================================
// cor: parse e conversões (hex <-> OKLCH, HSL, famílias)
// =====================================================================================================================
const NOMES_CSS = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', teal: '#008080', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00', maroon: '#800000', olive: '#808000', aqua: '#00ffff', fuchsia: '#ff00ff', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', coral: '#ff7f50', crimson: '#dc143c', tomato: '#ff6347', salmon: '#fa8072', whitesmoke: '#f5f5f5', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', dimgray: '#696969', ivory: '#fffff0', beige: '#f5f5dc', linen: '#faf0e6' };
const h2 = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
const rgbParaHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);
const hexParaRgb = (hex) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const delin = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);

export function hexParaOklch(hex) {
  const [r, g, b] = hexParaRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  return { L, C, h: C < 1e-4 ? 0 : (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
}
function oklchParaHex(L, C, hDeg) {
  const a = C * Math.cos(hDeg * Math.PI / 180), b = C * Math.sin(hDeg * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbParaHex(delin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), delin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), delin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
}
export function hexParaHsl(hex) {
  const [r, g, b] = hexParaRgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), s, l };
}
function hslParaHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbParaHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
const croma = (hex) => hexParaOklch(hex).C;
const noIntervalo = (x, [a, b]) => x >= a && x <= b;

// Primeira cor de um texto CSS: { hex, a (0..1) } | null. Entende #hex, rgb()/rgba() (vírgula ou espaço), hsl(), oklch() e nomes comuns.
export function parseCor(texto) {
  const s = String(texto ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { hex: '#000000', a: 0 };
  let m = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/.exec(s);
  if (m) { let x = m[1]; if (x.length <= 4) x = x.split('').map((c) => c + c).join(''); return { hex: '#' + x.slice(0, 6), a: x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1 }; }
  const alfa = (t) => { if (t === undefined || t === '') return 1; const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t); return Number.isFinite(v) ? v : 1; };
  m = /rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([^)\s]+))?\s*\)/.exec(s);
  if (m) { const c = [m[1], m[2], m[3]].map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x))); return { hex: rgbParaHex(...c), a: alfa(m[4]) }; }
  m = /hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([^)\s]+))?\s*\)/.exec(s);
  if (m) return { hex: hslParaHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])), a: alfa(m[4]) };
  m = /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([^)\s]+))?\s*\)/.exec(s);
  if (m) { const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]); const C = m[2].endsWith('%') ? (parseFloat(m[2]) / 100) * 0.4 : parseFloat(m[2]); return { hex: oklchParaHex(L, C, parseFloat(m[3])), a: alfa(m[4]) }; }
  if (/^[a-z]+$/.test(s) && NOMES_CSS[s]) return { hex: NOMES_CSS[s], a: 1 };
  return null;
}
// Família cromática (para pílulas e paleta): null para cinzas. Faixas de matiz OKLCH.
export function familiaDeCor(hex, cromaMinimo = 0.03) {
  const { C, h } = hexParaOklch(hex);
  if (C < cromaMinimo) return null;
  if (h < 38 || h >= 355) return 'vermelho';
  if (h < 65) return 'laranja';
  if (h < 88) return 'âmbar';
  if (h < 115) return 'amarelo';
  if (h < 175) return 'verde';
  if (h < 275) return 'azul';
  if (h < 325) return 'roxo';
  return 'rosa';
}

// =====================================================================================================================
// HTML: árvore leve (tokenizador próprio; o HTML final é DOM serializado, então é bem formado)
// =====================================================================================================================
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const RE_TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][^\s>]*)\s*>|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const RE_ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function lerAtributos(txt) {
  const attrs = {};
  RE_ATTR.lastIndex = 0;
  let m;
  while ((m = RE_ATTR.exec(txt))) {
    const nome = m[1].toLowerCase();
    if (nome in attrs) continue;
    attrs[nome] = decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const arvoresHtml = new Map(); // html -> árvore (cache simples por conteúdo; o último fica na memória)
export function analisarHtml(html) {
  const texto = String(html || '');
  if (arvoresHtml.has(texto)) return arvoresHtml.get(texto);
  const raiz = { tag: '#raiz', attrs: {}, classes: [], filhos: [], conteudo: [], pai: null, ordem: -1 };
  const todos = [];
  const pilha = [raiz];
  let atual = raiz;
  let pos = 0;
  let m;
  let baixo = null;
  const addTexto = (el, bruto) => { if (!bruto) return; const v = decodificarEntidades(bruto); el.conteudo.push({ txt: v }); };
  RE_TOKEN.lastIndex = 0;
  while ((m = RE_TOKEN.exec(texto)) && todos.length < 80000) {
    if (m.index > pos) addTexto(atual, texto.slice(pos, m.index));
    pos = RE_TOKEN.lastIndex;
    if (m[0].startsWith('<!')) continue;
    if (m[1]) {
      const nome = m[1].toLowerCase();
      let i = pilha.length - 1;
      while (i > 0 && pilha[i].tag !== nome) i--;
      if (i > 0) { pilha[i].fim = RE_TOKEN.lastIndex; pilha.length = i; atual = pilha[i - 1]; }
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrTxt = m[3] || '';
    const autoFecha = /\/\s*$/.test(attrTxt);
    const attrs = lerAtributos(autoFecha ? attrTxt.replace(/\/\s*$/, '') : attrTxt);
    const el = { tag, attrs, classes: (attrs.class || '').split(/\s+/).filter(Boolean), id: attrs.id || null, pai: atual, filhos: [], conteudo: [], ini: m.index, iniFim: RE_TOKEN.lastIndex, fim: null, ordem: todos.length };
    atual.filhos.push(el);
    atual.conteudo.push({ el });
    todos.push(el);
    if (VOID.has(tag) || autoFecha) { el.fim = RE_TOKEN.lastIndex; continue; }
    if (RAW.has(tag)) {
      baixo ??= texto.toLowerCase();
      let j = baixo.indexOf('</' + tag, RE_TOKEN.lastIndex);
      if (j < 0) j = texto.length;
      el.textoRaw = texto.slice(RE_TOKEN.lastIndex, j);
      const k = texto.indexOf('>', j);
      RE_TOKEN.lastIndex = k < 0 ? texto.length : k + 1;
      el.fim = RE_TOKEN.lastIndex;
      pos = RE_TOKEN.lastIndex;
      continue;
    }
    pilha.push(el);
    atual = el;
  }
  if (pos < texto.length) addTexto(atual, texto.slice(pos));
  for (const el of todos) if (el.fim == null) el.fim = texto.length;
  const idContagem = new Map();
  for (const el of todos) if (el.id) idContagem.set(el.id, (idContagem.get(el.id) || 0) + 1);
  const arv = { html: texto, raiz, todos, idContagem, corpo: todos.find((e) => e.tag === 'body') || null, htmlEl: todos.find((e) => e.tag === 'html') || null };
  arvoresHtml.clear();
  arvoresHtml.set(texto, arv);
  return arv;
}

const memoTexto = new WeakMap();
export function textoTotal(el) {
  if (memoTexto.has(el)) return memoTexto.get(el);
  let t = '';
  if (RAW.has(el.tag)) t = '';
  else for (const c of el.conteudo) t += c.txt !== undefined ? c.txt : textoTotal(c.el);
  const r = t.replace(/\s+/g, ' ').trim();
  memoTexto.set(el, r);
  return r;
}
const textoDireto = (el) => el.conteudo.filter((c) => c.txt !== undefined).map((c) => c.txt).join('').replace(/\s+/g, ' ').trim();
const descendentes = (el) => { const out = []; const pilha = [...el.filhos].reverse(); while (pilha.length) { const e = pilha.pop(); out.push(e); for (let i = e.filhos.length - 1; i >= 0; i--) pilha.push(e.filhos[i]); } return out; };
const irmaoAnterior = (el) => { const p = el.pai; if (!p) return null; const i = p.filhos.indexOf(el); return i > 0 ? p.filhos[i - 1] : null; };
const irmaoSeguinte = (el) => { const p = el.pai; if (!p) return null; const i = p.filhos.indexOf(el); return i >= 0 && i < p.filhos.length - 1 ? p.filhos[i + 1] : null; };
const ancestrais = (el) => { const out = []; for (let a = el.pai; a && a.tag !== '#raiz'; a = a.pai) out.push(a); return out; };
const dentroDe = (el, tags) => ancestrais(el).some((a) => tags.includes(a.tag));

// seletor no mesmo formato do extrator (#id>tag:nth-of-type(n)...), para cruzar com os dados do medidor
export function seletorDe(arv, el) {
  const partes = [];
  let e = el;
  while (e && e.tag !== '#raiz' && e !== arv.htmlEl && partes.length < 8) {
    if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && arv.idContagem.get(e.id) === 1) { partes.unshift('#' + e.id); break; }
    let p = e.tag;
    const pai = e.pai;
    if (pai) { const irm = pai.filhos.filter((x) => x.tag === e.tag); if (irm.length > 1) p += ':nth-of-type(' + (irm.indexOf(e) + 1) + ')'; }
    partes.unshift(p);
    e = pai;
  }
  return partes.join('>');
}
// trecho do HTML (abertura do elemento, ou o elemento inteiro se for curto) seguro para citar
function trechoHtml(arv, el, max = 160) {
  let bruto = arv.html.slice(el.ini, el.fim);
  if (bruto.length > max) bruto = arv.html.slice(el.ini, el.iniFim);
  if (bruto.length > max) bruto = bruto.slice(0, max);
  return bruto.replace(/&[#\w]*$/, '');
}

// =====================================================================================================================
// CSS: regras (postcss) + seletores simples + mini-cascata
// =====================================================================================================================
function mediaAtiva(params) {
  const p = String(params || '').toLowerCase();
  const W = LIMIARES.viewportDesktopPx;
  return p.split(',').some((consulta) => {
    const c = consulta.trim();
    if (/^only\s+print|^print\b|\bspeech\b/.test(c) && !/screen|all/.test(c)) return false;
    if (/prefers-color-scheme\s*:\s*dark|prefers-reduced-motion|prefers-contrast|forced-colors|prefers-reduced-transparency|pointer\s*:\s*coarse|hover\s*:\s*none|orientation\s*:\s*portrait|print/.test(c)) return false;
    const px = (v, u) => parseFloat(v) * (u === 'px' ? 1 : 16);
    let ok = true;
    let m;
    const re1 = /\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g;
    while ((m = re1.exec(c))) { const x = px(m[2], m[3]); if (m[1] === 'min' ? x > W : x < W) ok = false; }
    const re2 = /\(\s*width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)\s*\)/g;
    while ((m = re2.exec(c))) { const x = px(m[2], m[3]); if (m[1].startsWith('>') ? x > W : x < W) ok = false; }
    return ok;
  });
}

const DINAMICAS = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'link', 'target', 'disabled', 'enabled', 'checked', 'invalid', 'valid', 'placeholder-shown', 'required', 'optional', 'read-only', 'indeterminate', 'autofill', 'any-link', 'open', 'popover-open', 'fullscreen', 'user-invalid', 'default', 'in-range', 'out-of-range', 'empty-cells']);
const desescapar = (s) => s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');

function parseCompound(txt) {
  const comp = { tag: null, id: null, classes: [], attrs: [], pseudos: [], pseudoEl: null, invalido: false };
  let i = 0;
  const n = txt.length;
  let m = /^(\*|[a-zA-Z][\w-]*)/.exec(txt);
  if (m) { comp.tag = m[1].toLowerCase(); i = m[0].length; }
  const ident = (s, j) => { const r = /^((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-]|[^\x00-\x7f])+)/.exec(s.slice(j)); return r ? r[1] : null; };
  while (i < n) {
    const c = txt[i];
    if (c === '#') { const id = ident(txt, i + 1); if (!id) { comp.invalido = true; break; } comp.id = desescapar(id); i += 1 + id.length; }
    else if (c === '.') { const id = ident(txt, i + 1); if (!id) { comp.invalido = true; break; } comp.classes.push(desescapar(id)); i += 1 + id.length; }
    else if (c === '[') {
      const fim = txt.indexOf(']', i);
      if (fim < 0) { comp.invalido = true; break; }
      const am = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*(?:[is])?)?\s*\]$/.exec(txt.slice(i, fim + 1));
      if (am) comp.attrs.push({ n: am[1].toLowerCase(), op: am[2] || null, v: am[3] ?? am[4] ?? am[5] ?? '' }); else comp.invalido = true;
      i = fim + 1;
    } else if (c === ':') {
      const duplo = txt[i + 1] === ':';
      const nome = ident(txt, i + (duplo ? 2 : 1));
      if (!nome) { comp.invalido = true; break; }
      i += (duplo ? 2 : 1) + nome.length;
      let arg = null;
      if (txt[i] === '(') {
        let prof = 0, j = i;
        for (; j < n; j++) { if (txt[j] === '(') prof++; else if (txt[j] === ')') { prof--; if (!prof) break; } }
        arg = txt.slice(i + 1, j);
        i = j + 1;
      }
      const baixo = nome.toLowerCase();
      if (duplo || /^(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)$/.test(baixo)) comp.pseudoEl = baixo;
      else comp.pseudos.push({ n: baixo, arg });
    } else { comp.invalido = true; break; }
  }
  return comp;
}

function parseSeletor(sel) {
  const s = sel.trim();
  const partes = [];
  let i = 0, comb = null;
  const n = s.length;
  while (i < n) {
    let espaco = false;
    while (i < n && /\s/.test(s[i])) { espaco = true; i++; }
    if (i < n && />|\+|~/.test(s[i])) { comb = s[i]; i++; while (i < n && /\s/.test(s[i])) i++; }
    else if (espaco && partes.length) comb = ' ';
    const ini = i;
    let prof = 0, q = '';
    while (i < n) {
      const c = s[i];
      if (q) { if (c === q) q = ''; i++; continue; }
      if (c === '\\') { i += 2; continue; }
      if (c === '"' || c === "'") { q = c; i++; continue; }
      if (c === '(' || c === '[') prof++; else if (c === ')' || c === ']') prof--;
      else if (prof === 0 && (/\s/.test(c) || c === '>' || c === '+' || c === '~')) break;
      i++;
    }
    const txt = s.slice(ini, i);
    if (!txt) break;
    partes.push({ comb: partes.length ? (comb || ' ') : null, comp: parseCompound(txt) });
    comb = null;
  }
  const invalido = !partes.length || partes.some((p) => p.comp.invalido);
  const ultimo = partes.length ? partes[partes.length - 1].comp : null;
  let a = 0, b = 0, c = 0;
  for (const p of partes) {
    const k = p.comp;
    if (k.id) a++;
    b += k.classes.length + k.attrs.length;
    for (const ps of k.pseudos) { if (ps.n === 'where') continue; b++; }
    if (k.tag && k.tag !== '*') c++;
    if (k.pseudoEl) c++;
  }
  return { partes, invalido, pseudoEl: ultimo?.pseudoEl || null, espec: a * 10000 + b * 100 + c };
}

function casaComp(el, k) {
  if (k.tag && k.tag !== '*' && el.tag !== k.tag) return false;
  if (k.id && el.id !== k.id) return false;
  for (const c of k.classes) if (!el.classes.includes(c)) return false;
  for (const a of k.attrs) {
    const v = el.attrs[a.n];
    if (v === undefined) return false;
    if (!a.op) continue;
    if (a.op === '=' && v !== a.v) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.v)) return false;
    if (a.op === '^=' && !v.startsWith(a.v)) return false;
    if (a.op === '$=' && !v.endsWith(a.v)) return false;
    if (a.op === '*=' && !v.includes(a.v)) return false;
    if (a.op === '|=' && !(v === a.v || v.startsWith(a.v + '-'))) return false;
  }
  for (const p of k.pseudos) {
    if (DINAMICAS.has(p.n)) return false;
    if (p.n === 'root') { if (el.tag !== 'html') return false; continue; }
    if (p.n === 'first-child') { if (irmaoAnterior(el)) return false; continue; }
    if (p.n === 'last-child') { if (irmaoSeguinte(el)) return false; continue; }
    if (p.n === 'only-child') { if (irmaoAnterior(el) || irmaoSeguinte(el)) return false; continue; }
    if (p.n === 'empty') { if (el.conteudo.length) return false; continue; }
    if (p.n === 'is' || p.n === 'where' || p.n === 'matches' || p.n === 'not') {
      const alvos = dividirTopo(p.arg || '', ',').map(parseSeletor);
      const algum = alvos.some((s) => !s.invalido && casa(el, s.partes, s.partes.length - 1));
      if (p.n === 'not' ? algum : !algum) return false;
      continue;
    }
    return false; // pseudo-classe que não sabemos resolver: não casa (subestima)
  }
  return true;
}
function casa(el, partes, i) {
  if (!casaComp(el, partes[i].comp)) return false;
  if (i === 0) return true;
  const comb = partes[i].comb;
  if (comb === '>') return !!el.pai && el.pai.tag !== '#raiz' && casa(el.pai, partes, i - 1);
  if (comb === ' ') { for (let a = el.pai; a && a.tag !== '#raiz'; a = a.pai) if (casa(a, partes, i - 1)) return true; return false; }
  if (comb === '+') { const p = irmaoAnterior(el); return !!p && casa(p, partes, i - 1); }
  if (comb === '~') { const pai = el.pai; if (!pai) return false; const idx = pai.filhos.indexOf(el); for (let j = idx - 1; j >= 0; j--) if (casa(pai.filhos[j], partes, i - 1)) return true; return false; }
  return false;
}

function dividirTopo(s, sep) {
  const partes = []; let nivel = 0, atual = '', q = '';
  for (const ch of String(s)) {
    if (q) { atual += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; atual += ch; continue; }
    if (ch === '(' || ch === '[') nivel++; if (ch === ')' || ch === ']') nivel--;
    if (ch === sep && nivel === 0) { partes.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

// Lê uma lista de CSS (textos) e devolve { regras, pseudo, decls }. regras: [{ sel, seletorTxt, decls:[{prop,valor,texto,imp}], ordem }]
function analisarCssTextos(textos) {
  const regras = [];
  const pseudo = [];
  let ordem = 0;
  for (const texto of textos) {
    let raiz;
    try { raiz = postcss.parse(texto); } catch { continue; }
    raiz.walkRules((r) => {
      let ativo = true;
      for (let p = r.parent; p && ativo; p = p.parent) {
        if (p.type !== 'atrule') continue;
        const nome = p.name.toLowerCase();
        if (/keyframes$|^font-face$|^page$|^counter-style$|^starting-style$|^container$/.test(nome)) ativo = false;
        else if (nome === 'media') ativo = mediaAtiva(p.params);
      }
      if (!ativo) return;
      const decls = [];
      r.each((n) => { if (n.type === 'decl') decls.push({ prop: n.prop.toLowerCase(), valor: n.value, texto: String(n).replace(/\s+/g, ' ').trim(), imp: !!n.important }); });
      if (!decls.length) return;
      ordem++;
      for (const s of dividirTopo(r.selector, ',')) {
        const ps = parseSeletor(s);
        if (ps.invalido) continue;
        const e = { sel: ps, seletorTxt: s, decls, ordem };
        if (ps.pseudoEl) pseudo.push(e); else regras.push(e);
      }
    });
  }
  const indice = new Map();
  for (const r of regras) {
    const k = r.sel.partes[r.sel.partes.length - 1].comp;
    const chave = k.id ? '#' + k.id : k.classes.length ? '.' + k.classes[0] : k.tag && k.tag !== '*' ? k.tag : '*';
    if (!indice.has(chave)) indice.set(chave, []);
    indice.get(chave).push(r);
  }
  return { regras, pseudo, indice };
}

const textosCssDoCtx = (ctx, p) => {
  const vistos = new Set();
  const out = [];
  for (const a of ctx.ativos || []) if (a.tipo === 'css' && a.texto && !vistos.has(a.texto)) { vistos.add(a.texto); out.push(a.texto); }
  for (const t of p.final?.extr?.estilosInline || []) if (t && !vistos.has(t)) { vistos.add(t); out.push(t); }
  return out;
};

// Ambiente estático de uma página: árvore HTML + CSS + funções de estilo. Em cache por página.
const ambientes = new WeakMap();
export function ambienteDaPagina(ctx, p) {
  if (ambientes.has(p)) return ambientes.get(p);
  const html = p.final?.html;
  if (!html) { ambientes.set(p, null); return null; }
  const arv = analisarHtml(html);
  const css = analisarCssTextos(textosCssDoCtx(ctx, p));
  const amb = criarAmbiente(arv, css);
  ambientes.set(p, amb);
  return amb;
}

function criarAmbiente(arv, css) {
  const cacheEstilo = new WeakMap();
  const candidatas = (el) => {
    const out = [];
    const add = (k) => { const l = css.indice.get(k); if (l) out.push(...l); };
    add('*'); add(el.tag); if (el.id) add('#' + el.id);
    for (const c of el.classes) add('.' + c);
    return out;
  };
  // estilo declarado do elemento: Map prop -> { valor, rank }
  const estilo = (el) => {
    let e = cacheEstilo.get(el);
    if (e) return e;
    e = new Map();
    const set = (prop, valor, rank, texto) => { const a = e.get(prop); if (!a || rank >= a.rank) e.set(prop, { valor, rank, texto }); };
    for (const r of candidatas(el)) {
      if (!casa(el, r.sel.partes, r.sel.partes.length - 1)) continue;
      for (const d of r.decls) set(d.prop, d.valor, (d.imp ? 1e15 : 0) + r.sel.espec * 1e6 + r.ordem, d.texto);
    }
    if (el.attrs.style) {
      for (const parte of dividirTopo(el.attrs.style, ';')) {
        const i = parte.indexOf(':');
        if (i < 0) continue;
        const imp = /!important\s*$/i.test(parte);
        set(parte.slice(0, i).trim().toLowerCase(), parte.slice(i + 1).replace(/!important\s*$/i, '').trim(), (imp ? 1e15 : 0) + 1e14, parte.trim());
      }
    }
    cacheEstilo.set(el, e);
    return e;
  };
  const herdado = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-transform', 'line-height', 'font-variant-numeric', 'font-feature-settings', 'text-align', 'font-variant']);
  const varDe = (el, nome, prof = 0) => {
    for (let e = el; e && e.tag !== '#raiz'; e = e.pai) { const d = estilo(e).get(nome); if (d) return resolverVars(e, d.valor, prof + 1); }
    return null;
  };
  const resolverVars = (el, valor, prof = 0) => {
    if (valor == null || prof > 6 || !/var\(/i.test(valor)) return valor;
    return valor.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/gi, (_, nome, fb) => { const v = varDe(el, nome, prof); return v != null ? v : (fb != null ? resolverVars(el, fb.trim(), prof + 1) : ''); });
  };
  // valor próprio (declarado no elemento) de um grupo de propriedades: o de maior precedência. Devolve { prop, valor } | null
  const proprio = (el, props) => {
    const e = estilo(el);
    let melhor = null;
    for (const p of props) { const d = e.get(p); if (d && (!melhor || d.rank >= melhor.rank)) melhor = { prop: p, valor: resolverVars(el, d.valor), rank: d.rank, texto: d.texto }; }
    return melhor;
  };
  const valorDe = (el, prop, { herdar = herdado.has(prop) } = {}) => {
    for (let e = el; e && e.tag !== '#raiz'; e = herdar ? e.pai : null) {
      const d = estilo(e).get(prop);
      if (d && !/^(inherit|unset)$/i.test(d.valor.trim())) return resolverVars(e, d.valor);
    }
    return null;
  };
  return { arv, css, estilo, proprio, valorDe, resolverVars, varDe };
}

// ---- interpretação de valores CSS ----
// comprimento em px (px, rem, em, pt); null para %, auto, vw...
export function comprimentoPx(v, base = 16) {
  const t = String(v ?? '').trim().toLowerCase();
  const m = /^(-?[\d.]+)(px|rem|em|pt)?$/.exec(t);
  if (!m) return null;
  const x = parseFloat(m[1]);
  if (!m[2]) return x === 0 ? 0 : null;
  return m[2] === 'px' ? x : m[2] === 'pt' ? (x * 4) / 3 : x * base;
}
// raio de canto: { px, pct }
function raioDe(valor) {
  const t = String(valor ?? '').trim().split(/[\s/]+/)[0];
  if (/%$/.test(t)) return { px: null, pct: parseFloat(t) };
  const px = comprimentoPx(t);
  return px == null ? null : { px, pct: null };
}
const larguraBordaPx = (t) => { if (/^(thin)$/i.test(t)) return 1; if (/^medium$/i.test(t)) return 3; if (/^thick$/i.test(t)) return 5; return comprimentoPx(t); };
// "border-left: 4px solid #6366f1" -> { w, estilo, cor }
function parseBorda(valor) {
  const tokens = String(valor ?? '').match(/[^\s(]+\([^)]*\)|\S+/g) || [];
  let w = null, estilo = null, cor = null;
  for (const p of tokens) {
    if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(p)) estilo = p.toLowerCase();
    else if (/^[\d.]|^thin$|^medium$|^thick$/i.test(p) && larguraBordaPx(p) != null) w = larguraBordaPx(p);
    else { const c = parseCor(p); if (c) cor = c; }
  }
  return { w, estilo, cor };
}

// =====================================================================================================================
// corpus / citações verificáveis
// =====================================================================================================================
const corpora = new WeakMap();
const corpusDe = (ctx) => { let c = corpora.get(ctx); if (!c) { c = montarCorpus(ctx); corpora.set(ctx, c); } return c; };
// Só devolve a citação se o trecho EXISTE no corpus (mesma normalização do verificador); senão null.
export function citarSeExiste(ctx, p, onde, valor, { versoes = ['final'] } = {}) {
  const v = String(valor ?? '');
  const alvo = normalizarTexto(v);
  if (!alvo) return null;
  const pag = corpusDe(ctx).get(p.url);
  if (!pag) return null;
  for (const ver of versoes) {
    const c = pag[ver];
    if (!c) return null;
    const campo = onde === 'visivel' ? c.visivelJunto : onde === 'html' ? c.html : onde === 'css' ? c.css : onde === 'js' ? c.js : c.todoTexto;
    if (!campo.includes(alvo)) return null;
  }
  return { tipo: 'trecho', valor: v, onde, versoes, pagina: p.url };
}
// procura por regex no corpus normalizado (css/html/visivel) e devolve a citação do primeiro trecho encontrado
export function citarRegex(ctx, p, onde, regex, { max = 160 } = {}) {
  const pag = corpusDe(ctx).get(p.url);
  const c = pag?.final;
  if (!c) return null;
  const campo = onde === 'visivel' ? c.visivelJunto : onde === 'html' ? c.html : onde === 'css' ? c.css : onde === 'js' ? c.js : c.todoTexto;
  const m = new RegExp(regex.source, regex.flags.replace('g', '')).exec(campo);
  if (!m) return null;
  let t = m[0].length > max ? m[0].slice(0, max) : m[0];
  t = t.replace(/&[#\w]*$/, '').trim();
  return t ? { tipo: 'trecho', valor: t, onde, versoes: ['final'], pagina: p.url } : null;
}
const semNulos = (l) => l.filter(Boolean);
const textoVisivelDoNo = (p, pred) => (p.final?.extr?.nos || []).find((n) => n.visivel && !n.clone && pred(n));

// ---- construção de achados ----
function ev({ pagina, seletor, trecho, valor, contagem, visivel, versao = 'final' }) {
  const o = { versao };
  if (pagina !== undefined) o.pagina = pagina;
  if (seletor != null) o.seletor = seletor;
  if (trecho != null) o.trecho = cortar(trecho, 200);
  if (valor !== undefined && valor !== null) o.valor = valor;
  if (typeof contagem === 'number') o.contagem = contagem;
  if (typeof visivel === 'boolean') o.visivel = visivel;
  return o;
}
// numeros_permitidos: os números que o PRÓPRIO detector escreveu na mensagem (vêm de medição, não do texto do site)
// concordância simples: "1 elemento(s)" -> "1 elemento"; "3 cartão(ões)" -> "3 cartões"
const concordar = (msg) => String(msg).replace(/(d+) ([p{L}-]+)((s|ões|ns))/gu, (_, n, w, suf) => (Number(n) === 1 ? `${n} ${w}` : suf === 's' ? `${n} ${w}s` : suf === 'ns' ? `${n} ${w.replace(/m$/, '')}ns` : `${n} ${w.replace(/ão$/, '')}ões`));
const maiuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
function achadoDe({ pagina, mensagem: msg0, evidencias = [], citacoes = [], extraPermitidos = [], severidade, instavel }) {
  const mensagem = maiuscula(concordar(msg0));
  const vistas = new Set();
  citacoes = semNulos(citacoes).filter((c) => { const k = JSON.stringify(c); if (vistas.has(k)) return false; vistas.add(k); return true; });
  const numeros = unicos([...extrairNumeros(mensagem), ...extraPermitidos].map((n) => String(n)));
  const a = { pagina, mensagem, evidencias: evidencias.slice(0, 12), citacoes: semNulos(citacoes).slice(0, 8) };
  if (numeros.length) a.numeros_permitidos = numeros;
  if (severidade) a.severidade = severidade;
  if (instavel) a.instavel = true;
  return a;
}
const resultado = (disparou, intensidade, achados = []) => ({ disparou: !!disparou, intensidade: disparou ? clamp01(intensidade) : 0, achados: disparou ? achados : [] });

// ---- dados do medidor css ----
const dadosCss = (med) => (med?.css && !med.css.erro && med.css.dados ? med.css.dados : null);
const paginaCss = (dados, p) => dados?.paginas?.find((x) => x.url === p.url) || null;
const estaticoDoSite = (dados) => dados?.site?.estatico || null;

// Roda um avaliador por página e agrega: dispara se alguma dispara; intensidade = média das páginas avaliadas (0 nas que não disparam).
// avaliar(p, i) -> null (página não avaliável) | { disparou, intensidade, achados }
function agregarPaginas(ctx, avaliar, { maxAchados = 8 } = {}) {
  const res = [];
  (ctx.paginas || []).forEach((p, i) => {
    let r = null;
    try { r = avaliar(p, i); } catch (e) { r = null; }
    if (r) res.push({ p, r });
  });
  if (!res.length) return null;
  const disparou = res.some((x) => x.r.disparou);
  const intensidade = media(res.map((x) => (x.r.disparou ? x.r.intensidade : 0)));
  const achados = [];
  for (const { p, r } of res) if (r.disparou) for (const a of r.achados) achados.push({ ...a, pagina: a.pagina || p.url });
  return resultado(disparou, intensidade, achados.slice(0, maxAchados));
}
// Guarda de tipo de site: a regra pode ser restrita a certos tipos; se o tipo é conhecido e não está na lista, não avalia.
function foraDoTipo(ctx, regra) {
  const tipos = regra?.tipos_de_site;
  const t = ctx?.site?.tipoDeSite;
  return !!(tipos && t && !tipos.includes('*') && !tipos.includes(t));
}
// Embrulha um detector: guarda de tipo + proteção contra exceção (devolve null = não avaliável).
function detector(fn) {
  return ({ ctx, med, regra }) => {
    if (!ctx || !Array.isArray(ctx.paginas) || !ctx.paginas.length) return null;
    if (foraDoTipo(ctx, regra)) return null;
    return fn({ ctx, med, regra });
  };
}

// =====================================================================================================================
// auxiliares de citação por cor / texto
// =====================================================================================================================
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Declaração de CSS que contém a cor (#rrggbb, #rgb ou rgb()). Devolve uma citação verificável ou null.
export function citarCor(ctx, p, hex) {
  const formas = [esc(hex) + '(?![0-9a-f])'];
  const curto = /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/.exec(hex);
  if (curto) formas.push('#' + curto[1] + curto[2] + curto[3] + '(?![0-9a-f])');
  const [r, g, b] = hexParaRgb(hex);
  formas.push(`rgba?\\(\\s*${r}[\\s,]+${g}[\\s,]+${b}\\b`);
  for (const f of formas) {
    const c = citarRegex(ctx, p, 'css', new RegExp(`[\\w-]+\\s*:\\s*[^;{}]*?${f}`));
    if (c) return c;
  }
  return null;
}
// até n citações distintas de trechos que casam com a regex
export function citarTodos(ctx, p, onde, regex, n = 3, { max = 160 } = {}) {
  const pag = corpusDe(ctx).get(p.url)?.final;
  if (!pag) return [];
  const campo = onde === 'visivel' ? pag.visivelJunto : onde === 'html' ? pag.html : onde === 'css' ? pag.css : pag.js;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  const vistos = new Set();
  const out = [];
  let m;
  while ((m = re.exec(campo)) && out.length < n) {
    if (!m[0]) { re.lastIndex++; continue; }
    const t = m[0].slice(0, max).replace(/&[#\w]*$/, '').trim();
    if (t && !vistos.has(t)) { vistos.add(t); out.push({ tipo: 'trecho', valor: t, onde, versoes: ['final'], pagina: p.url }); }
  }
  return out;
}
// texto visível citável (usa os nós de texto do extrator; confere no corpus)
export function citarTextoVisivel(ctx, p, texto, max = 60) {
  const t = cortar(texto, max).replace(/…$/, '');
  return t.length >= 2 ? citarSeExiste(ctx, p, 'visivel', t) : null;
}
// primeiro texto visível dentro do elemento do seletor (ou do próprio)
export function citarTextoDoSeletor(ctx, p, seletor, max = 60) {
  const nos = p.final?.extr?.nos || [];
  for (const n of nos) {
    if (!n.visivel || n.clone) continue;
    if (n.seletor === seletor || n.seletor.startsWith(seletor + '>')) {
      const c = citarSeExiste(ctx, p, 'visivel', cortar(n.texto, max).replace(/…$/, ''));
      if (c) return c;
    }
  }
  return null;
}
// seletor -> elemento da árvore estática (para cruzar dados do medidor com a árvore)
const mapasSeletor = new WeakMap();
function elementoPorSeletor(amb, seletor) {
  let m = mapasSeletor.get(amb);
  if (!m) { m = new Map(); for (const el of amb.arv.todos) { const s = seletorDe(amb.arv, el); if (!m.has(s)) m.set(s, el); } mapasSeletor.set(amb, m); }
  return m.get(seletor) || null;
}
const TAGS_NAO_VISUAIS = new Set(['html', 'head', 'script', 'style', 'meta', 'link', 'title', 'noscript', 'template', 'base']);
const emSvg = (el) => el.tag === 'svg' || dentroDe(el, ['svg']);

// =====================================================================================================================
// COR
// =====================================================================================================================
const HEX_PADRAO = new Set(PALETA_PADRAO.hexExatos);

// elementos de "destaque" medidos no computado: cores cromáticas fortes de texto/fundo/borda + paradas de gradiente
function destaquesDoComputado(es, saturacao) {
  const itens = [];
  const add = (lista, onde) => { for (const c of lista || []) if (c.s >= saturacao) itens.push({ hex: c.hex.slice(0, 7), n: c.contagem, onde }); };
  add(es.cores.texto, 'texto'); add(es.cores.fundo, 'fundo'); add(es.cores.borda, 'borda');
  for (const g of es.gradientes.itens || []) for (const s of g.paradas || []) if (s.s >= saturacao && s.a > 0) itens.push({ hex: s.hex.slice(0, 7), n: 1, onde: 'gradiente' });
  return { itens, total: soma(itens.map((i) => i.n)), naLista: soma(itens.filter((i) => HEX_PADRAO.has(i.hex)).map((i) => i.n)) };
}

const corRoxo = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-roxo-indigo-padrao'];
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    if (!pc) return null;
    const es = pc.computado;
    const classes = pc.classesUtilitarias?.indigoVioleta || 0;
    const exemplosClasses = pc.classesUtilitarias?.exemplos?.indigoVioleta || [];
    let ratio = 0, naLista = 0, total = 0, itens = [];
    if (es) {
      const d = destaquesDoComputado(es, L.saturacaoDestaqueMinima);
      naLista = d.naLista; total = d.total; itens = d.itens.filter((i) => HEX_PADRAO.has(i.hex));
      ratio = total ? naLista / total : 0;
    } else {
      const est = estaticoDoSite(dados);
      naLista = est?.cores?.rampaPadrao?.ocorrencias || 0;
      if (!naLista && !classes) return null; // sem computado e sem sinal estático: não avaliável
      ratio = L.intensidadeMinimaSePresente;
    }
    const disparou = naLista > 0 || classes > 0;
    if (!disparou) return resultado(false, 0);
    const intensidade = Math.max(ratio, L.intensidadeMinimaSePresente);
    const hexes = unicos(itens.map((i) => i.hex));
    const botaoNaRampa = pc.derivados?.cor?.botaoPrimarioNaRampa;
    const partes = [];
    if (hexes.length) partes.push(`cores ${hexes.slice(0, 4).join(', ')} usadas em ${naLista} de ${total} elementos de destaque medidos`);
    if (botaoNaRampa) partes.push(`o botão principal usa ${pc.derivados.cor.botaoPrimarioFundo}`);
    if (classes) partes.push(`${classes} classes utilitárias da rampa índigo/violeta no HTML`);
    const evidencias = [];
    for (const i of itens.slice(0, 5)) evidencias.push(ev({ pagina: p.url, trecho: `${i.onde} ${i.hex}`, valor: i.hex, contagem: i.n }));
    const prim = es?.cores?.botoes?.primario;
    if (botaoNaRampa && prim) evidencias.push(ev({ pagina: p.url, seletor: prim.seletor, trecho: `botão "${prim.texto}": fundo ${prim.fundo}`, valor: prim.fundo, visivel: true }));
    for (const t of exemplosClasses.slice(0, 3)) evidencias.push(ev({ pagina: p.url, trecho: `classe ${t}`, valor: t }));
    const citacoes = [];
    for (const h of hexes.slice(0, 3)) citacoes.push(citarCor(ctx, p, h));
    for (const t of exemplosClasses.slice(0, 2)) citacoes.push(citarSeExiste(ctx, p, 'html', t));
    if (!semNulos(citacoes).length && prim?.texto) citacoes.push(citarTextoVisivel(ctx, p, prim.texto));
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `A cor de destaque vem da rampa índigo/violeta de fábrica: ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const itemAzulRoxo = (g) => {
  const L = LIMIARES['cor-gradiente-azul-roxo'];
  if (g.tipo !== 'linear' || g.repetido) return false;
  const hs = (g.paradas || []).filter((s) => s.s >= L.saturacaoMinima && s.a > 0).map((s) => s.h);
  const tem = (f) => hs.some((h) => noIntervalo(h, f));
  const roxo = tem(L.matizRoxo);
  return (tem(L.matizAzul) && roxo) || (roxo && (tem(L.matizRosa) || tem(L.matizCiano)));
};
const gradAzulRoxo = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-gradiente-azul-roxo'];
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    if (!pc) return null;
    const es = pc.computado;
    const itens = (es?.gradientes?.itens || []).filter(itemAzulRoxo);
    const html = p.final?.html || '';
    const porClasse = unicos([...html.matchAll(new RegExp(L.regexClasses.source, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').toLowerCase()));
    if (!es && !porClasse.length) {
      const est = estaticoDoSite(dados);
      if (!est?.gradientes?.azulParaRoxo) return null;
    }
    if (!itens.length && !porClasse.length) return resultado(false, 0);
    const elementosComGrad = Math.max(1, es?.gradientes?.elementos || itens.length || 1);
    const seletores = unicos(itens.map((g) => g.seletor));
    const frac = seletores.length / elementosComGrad;
    const intensidade = Math.max(frac, 0.5); // piso 0.5: a presença de um degradê assim já é o sinal (limiar inicial, a calibrar)
    const partes = [];
    for (const g of itens.slice(0, 3)) partes.push(`${g.paradas.map((s) => s.hex).join(' → ')} em ${g.seletor}${g.aplicadoAoTexto ? ' (no texto)' : ''}`);
    for (const c of porClasse.slice(0, 2)) partes.push(`classes ${c}`);
    const evidencias = itens.slice(0, 5).map((g) => ev({ pagina: p.url, seletor: g.seletor, trecho: `${g.tipo}-gradient ${g.paradas.map((s) => s.hex).join(', ')}`, valor: g.paradas.map((s) => s.hex).join('→'), visivel: true }));
    for (const c of porClasse.slice(0, 3)) evidencias.push(ev({ pagina: p.url, trecho: c, valor: c }));
    const citacoes = [];
    for (const g of itens.slice(0, 2)) {
      const cores = g.paradas.map((s) => s.hex);
      citacoes.push(citarRegex(ctx, p, 'css', new RegExp(`(linear|radial|conic)-gradient\\([^;{}]*?${esc(cores[0])}[^;{}]*?${esc(cores[cores.length - 1])}[^;{}]*?\\)`)));
    }
    for (const c of porClasse.slice(0, 2)) citacoes.push(citarSeExiste(ctx, p, 'html', c));
    if (!semNulos(citacoes).length && itens[0]) citacoes.push(citarTextoDoSeletor(ctx, p, itens[0].seletor));
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Há degradê do azul para o roxo (ou do roxo para rosa/ciano): ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const corSemTokens = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-sem-tokens-semanticos'];
  const est = estaticoDoSite(dados);
  if (!est) return null;
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    if (!pc) return null;
    const n = pc.classesUtilitarias?.rampaPadrao || 0;
    const temTokens = !!est.propriedadesCustom?.temTokensSemanticos;
    if (n < L.minimoClasses || temTokens) return resultado(false, 0);
    const exemplos = pc.classesUtilitarias.exemplos.rampaPadrao || [];
    const evidencias = exemplos.slice(0, 5).map((t) => ev({ pagina: p.url, trecho: `classe ${t}`, valor: t }));
    evidencias.push(ev({ pagina: p.url, trecho: 'nenhuma variável de cor com papel (cor, marca, destaque, ação, superfície, perigo) declarada no CSS', valor: 0, contagem: 0 }));
    const citacoes = exemplos.slice(0, 3).map((t) => citarSeExiste(ctx, p, 'html', t));
    return resultado(true, n / L.classesParaSaturar, [achadoDe({ pagina: p.url, mensagem: `O HTML usa ${n} classes de cor da rampa padrão (ex.: ${exemplos.slice(0, 3).join(', ')}) e o CSS não declara nenhuma variável de cor com nome de uso (ação, perigo, fundo).`, evidencias, citacoes })]);
  });
});

const corPills = detector(({ ctx }) => {
  const L = LIMIARES['cor-pills-multicoloridas'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const pilulas = [];
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el)) continue;
      const txt = textoTotal(el);
      if (!txt || txt.length > L.maxCaracteres) continue;
      const r = amb.proprio(el, ['border-radius']);
      const raio = r ? raioDe(r.valor) : null;
      if (!raio || raio.px == null || raio.px < L.raioPilulaPx) continue;
      const bg = amb.proprio(el, ['background-color', 'background']);
      const fundo = bg ? parseCor(bg.valor) : null;
      const texto = parseCor(amb.valorDe(el, 'color') || '');
      const borda = amb.proprio(el, ['border-color', 'border']);
      const corBorda = borda ? parseBorda(borda.valor).cor || parseCor(borda.valor) : null;
      let familia = null, hex = null;
      for (const c of [fundo && fundo.a > 0.05 ? fundo : null, texto, corBorda && corBorda.a > 0.05 ? corBorda : null]) {
        if (!c) continue;
        const f = familiaDeCor(c.hex, L.cromaMinimo);
        if (f) { familia = f; hex = c.hex; break; }
      }
      if (familia) pilulas.push({ el, txt, familia, hex, seletor: seletorDe(amb.arv, el) });
    }
    const familias = unicos(pilulas.map((x) => x.familia));
    if (familias.length < L.minimoFamilias) return resultado(false, 0);
    const exemplos = familias.map((f) => pilulas.find((x) => x.familia === f));
    const evidencias = exemplos.map((x) => ev({ pagina: p.url, seletor: x.seletor, trecho: `"${x.txt}": família ${x.familia} (${x.hex})`, valor: x.familia, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `${pilulas.length} etiquetas em formato de pílula`, valor: pilulas.length, contagem: pilulas.length }));
    const citacoes = exemplos.map((x) => citarTextoVisivel(ctx, p, x.txt));
    return resultado(true, familias.length / L.totalFamilias, [achadoDe({ pagina: p.url, mensagem: `As etiquetas em formato de pílula da página aparecem em ${familias.length} famílias de cor diferentes (${familias.join(', ')}); quando tudo tem cor, a cor deixa de significar algo.`, evidencias, citacoes })]);
  });
});

const corArcoIris = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-paleta-arco-iris'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const baldes = Object.entries(es.cores.familiasDeMatiz || {}).filter(([, n]) => n >= L.minimoElementosPorFamilia).map(([h, n]) => ({ matiz: Number(h), n }));
    if (baldes.length < L.minimoFamilias) return resultado(false, 0);
    // cores representativas (uma por balde) para evidência e citação
    const todas = [...es.cores.fundo, ...es.cores.texto, ...es.cores.borda].filter((c) => c.s >= 0.25);
    const porBalde = new Map();
    for (const c of todas) { const b = Math.floor(c.h / 30) * 30; if (baldes.some((x) => x.matiz === b) && !porBalde.has(b)) porBalde.set(b, c); }
    const evidencias = baldes.map((b) => ev({ pagina: p.url, trecho: `matiz ${b.matiz}° a ${b.matiz + 30}°: ${b.n} elementos${porBalde.has(b.matiz) ? ` (ex.: ${porBalde.get(b.matiz).hex})` : ''}`, valor: b.matiz, contagem: b.n }));
    const citacoes = [...porBalde.values()].slice(0, 4).map((c) => citarCor(ctx, p, c.hex.slice(0, 7)));
    return resultado(true, baldes.length / L.familiasPossiveis, [achadoDe({ pagina: p.url, mensagem: `A página usa cores vivas de ${baldes.length} famílias de matiz diferentes (faixas de 30 graus) em fundos, textos e bordas, sem uma cor dominante clara. Confirmar se a variedade é intencional (marca multicolorida).`, evidencias, citacoes })]);
  });
});

// hex de neutros relevantes do computado: [{hex, n}]
const corNeutros = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-neutros-sem-tom'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const lista = [...es.cores.texto, ...es.cores.fundo, ...es.cores.borda].map((c) => ({ hex: c.hex.slice(0, 7), n: c.contagem }));
    const fundoPag = es.cores.paginaFundo?.hex ? es.cores.paginaFundo.hex.slice(0, 7) : null;
    const corBody = es.tipografia?.body?.cor ? es.tipografia.body.cor.slice(0, 7) : null;
    if (fundoPag) lista.push({ hex: fundoPag, n: 1 });
    const okl = lista.map((c) => ({ ...c, C: croma(c.hex) }));
    const neutros = okl.filter((c) => c.C < L.cromaLimiteNeutro);
    const puros = neutros.filter((c) => c.C < L.cromaNeutroMinimo);
    const temDestaque = okl.some((c) => c.C >= L.cromaDestaqueMinimo);
    const ramos = [];
    if (neutros.length && puros.length === neutros.length && temDestaque) ramos.push('todos os neutros sem tom e existe cor de destaque');
    if (fundoPag === '#000000') ramos.push('fundo da página em preto puro');
    if (corBody === '#000000' && fundoPag === '#ffffff') ramos.push('texto preto puro sobre fundo branco puro');
    if (!ramos.length) return resultado(false, 0);
    const evidencias = [];
    for (const c of puros.slice(0, 4)) evidencias.push(ev({ pagina: p.url, trecho: `neutro ${c.hex} sem tom (croma OKLCH ${fmt(c.C, 3)})`, valor: c.hex, contagem: c.n }));
    if (fundoPag) evidencias.push(ev({ pagina: p.url, seletor: 'body', trecho: `fundo da página ${fundoPag}`, valor: fundoPag }));
    if (corBody) evidencias.push(ev({ pagina: p.url, seletor: 'body', trecho: `texto principal ${corBody}`, valor: corBody }));
    const hexCit = unicos([...puros.map((c) => c.hex), ...(ramos.length > 1 || fundoPag === '#000000' ? [fundoPag] : [])].filter(Boolean)).slice(0, 3);
    const citacoes = hexCit.map((h) => citarCor(ctx, p, h)).filter(Boolean);
    // Cores padrão do navegador (texto preto, fundo branco) não aparecem escritas no CSS: ancora a opinião num trecho que existe.
    if (!citacoes.some((c) => c.tipo === 'trecho')) { const ancora = citarRegex(ctx, p, 'html', /<body[^>]{0,60}>?/); if (ancora) citacoes.push(ancora); }
    return resultado(true, 1, [achadoDe({ pagina: p.url, mensagem: `As cores neutras da página não têm tom:${ramos.join('; ')}. O resultado fica seco e com cara de padrão.`, evidencias, citacoes })]);
  });
});

const corAcentoAreaGrande = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-acento-em-area-grande'];
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    const es = pc?.computado;
    const amb = ambienteDaPagina(ctx, p);
    if (!es || !amb) return null;
    // cor de destaque: fundo do botão principal (se cromático), senão a cor de link mais usada
    const candidatos = [es.cores.botoes?.primario?.fundo, ...Object.keys(es.cores.links?.porCor || {})].filter((h) => h && h !== 'transparente').map((h) => h.slice(0, 7));
    const acento = candidatos.find((h) => croma(h) >= L.cromaAcentoMinimo);
    if (!acento) return null;
    const perto = (hex) => { const a = hexParaOklch(acento), b = hexParaOklch(hex); return Math.hypot(a.L - b.L, a.C - b.C) < 0.02 && (a.C < 0.02 || Math.abs(a.h - b.h) < 8); };
    // títulos grandes na cor de destaque
    const titulos = [];
    for (const t of es.tipografia.titulos || []) {
      if (t.tamanhoPx < L.tituloDisplayMinimoPx) continue;
      const el = elementoPorSeletor(amb, t.seletor);
      const cor = el ? parseCor(amb.valorDe(el, 'color') || '') : null;
      if (cor && cor.a > 0.5 && perto(cor.hex)) titulos.push(t);
    }
    // área da primeira tela coberta por um bloco de herói com fundo na cor de destaque (estimativa por blocos; não há captura de tela)
    let fracao = 0, heroiSel = null;
    const hero = es.layout?.heroes?.[0];
    if (hero) {
      const el = elementoPorSeletor(amb, hero.seletor);
      let cobre = false;
      for (let e = el; e && e.tag !== '#raiz' && !cobre; e = e.pai) {
        const bg = amb.proprio(e, ['background-color', 'background']);
        const c = bg && !/gradient|url\(/i.test(bg.valor) ? parseCor(bg.valor) : null;
        if (c && c.a > 0.9) { cobre = perto(c.hex); break; }
      }
      if (cobre) { const topo = Math.max(0, hero.topoPx || 0); fracao = clamp01((Math.min(topo + hero.alturaPx, L.alturaTelaPx) - Math.min(topo, L.alturaTelaPx)) / L.alturaTelaPx); heroiSel = hero.seletor; }
    }
    if (fracao < L.avisoFracao && !titulos.length) return resultado(false, 0);
    const intensidade = Math.max(titulos.length ? 0.5 : 0, clamp01(fracao / 0.5));
    const partes = [];
    if (fracao >= L.avisoFracao) partes.push(`o bloco de abertura (${heroiSel}) tem fundo ${acento} e cobre cerca de ${pct(fracao)} da primeira tela (estimativa por blocos)`);
    if (titulos.length) partes.push(`${titulos.length} título(s) de ${L.tituloDisplayMinimoPx}px ou mais estão escritos na cor de destaque ${acento}`);
    const evidencias = titulos.slice(0, 4).map((t) => ev({ pagina: p.url, seletor: t.seletor, trecho: `${t.tag} ${t.tamanhoPx}px: ${t.texto}`, valor: acento, visivel: true }));
    if (heroiSel) evidencias.push(ev({ pagina: p.url, seletor: heroiSel, trecho: `fundo ${acento}; ${hero.alturaPx}px de altura a partir de ${hero.topoPx}px`, valor: fracao }));
    const citacoes = [citarCor(ctx, p, acento), ...titulos.slice(0, 2).map((t) => citarTextoDoSeletor(ctx, p, t.seletor))];
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `A cor de destaque ocupa muito espaço: ${partes.join('; ')}. Confirmar se a cor chapada é postura de marca.`, evidencias, citacoes, extraPermitidos: [L.tituloDisplayMinimoPx] })]);
  });
});

const corGradienteRepetido = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-gradiente-repetido'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const validos = (es.gradientes.itens || []).filter((g) => {
      if (g.repetido) return false; // padrões finos (linhas, pontos)
      const paradas = g.paradas || [];
      const overlay = paradas.length > 0 && paradas.every((s) => s.s < 0.15) && paradas.some((s) => s.a < 1); // transparente -> preto/branco sobre foto
      return !overlay;
    });
    const seletores = unicos(validos.map((g) => g.seletor));
    if (seletores.length < L.minimoElementos) return resultado(false, 0);
    const evidencias = validos.slice(0, 6).map((g) => ev({ pagina: p.url, seletor: g.seletor, trecho: `${g.tipo}-gradient ${g.paradas.map((s) => s.hex).join(', ')}`, valor: g.tipo, visivel: true }));
    const citacoes = citarTodos(ctx, p, 'css', /(linear|radial|conic)-gradient\([^;{}]*?\)/, 3);
    return resultado(true, seletores.length / L.elementosParaSaturar, [achadoDe({ pagina: p.url, mensagem: `Há ${seletores.length} elementos visíveis com fundo em degradê (${unicos(validos.map((g) => g.tipo)).join(', ')}) na mesma página.`, evidencias, citacoes })]);
  });
});

// texto cinza (croma baixo, luminosidade intermediária) sobre fundo cromático, por elemento (mini-cascata)
const corCinzaSobreColorido = detector(({ ctx }) => {
  const L = LIMIARES['cor-cinza-sobre-fundo-colorido'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const fundoEfetivo = (el) => {
      for (let e = el; e && e.tag !== '#raiz'; e = e.pai) {
        const bg = amb.proprio(e, ['background-color', 'background', 'background-image']);
        if (!bg) continue;
        if (/url\(/i.test(bg.valor)) return { imagem: true };
        if (/gradient\(/i.test(bg.valor)) return { indeterminado: true };
        const c = parseCor(bg.valor);
        if (c && c.a >= 0.9) return { hex: c.hex };
        if (c && c.a === 0) continue;
      }
      return null;
    };
    let sobreColorido = 0;
    const cinzas = [];
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el)) continue;
      const proprioTxt = textoDireto(el);
      if (proprioTxt.length < 2) continue;
      const fundo = fundoEfetivo(el);
      if (!fundo?.hex) continue;
      const of = hexParaOklch(fundo.hex);
      if (of.C < L.fundoCromaMinimo) continue;
      const cor = parseCor(amb.valorDe(el, 'color') || '');
      if (!cor || cor.a < 0.9) continue;
      sobreColorido++;
      if (cor.hex === '#ffffff' || cor.hex === '#000000') continue;
      const ot = hexParaOklch(cor.hex);
      if (ot.C <= L.textoCromaMaximo && ot.L >= L.textoLuminosidade[0] && ot.L <= L.textoLuminosidade[1]) cinzas.push({ el, txt: proprioTxt, texto: cor.hex, fundo: fundo.hex });
    }
    if (cinzas.length < L.minimoOcorrencias) return resultado(false, 0);
    const evidencias = cinzas.slice(0, 6).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `texto cinza ${x.texto} sobre fundo ${x.fundo}: ${x.txt}`, valor: `${x.texto} / ${x.fundo}`, visivel: true }));
    const citacoes = cinzas.slice(0, 3).map((x) => citarTextoVisivel(ctx, p, x.txt));
    return resultado(true, cinzas.length / Math.max(sobreColorido, cinzas.length), [achadoDe({ pagina: p.url, mensagem: `${cinzas.length} textos em cinza neutro estão sobre fundo colorido (de ${sobreColorido} textos sobre fundo colorido medidos). O cinza fica sem vida em cima da cor.`, evidencias, citacoes })]);
  });
});

const corCremeTerracota = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['cor-look-creme-terracota'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const fundoHex = es.cores.paginaFundo?.hex ? es.cores.paginaFundo.hex.slice(0, 7) : null;
    if (!fundoHex) return resultado(false, 0);
    const of = hexParaOklch(fundoHex);
    const creme = of.L >= L.fundo.Lmin && of.C >= L.fundo.Cmin && noIntervalo(of.h, L.fundo.matiz);
    const cands = [es.cores.botoes?.primario?.fundo, ...Object.keys(es.cores.botoes?.porFundo || {}), ...Object.keys(es.cores.links?.porCor || {})].filter((h) => h && h !== 'transparente').map((h) => h.slice(0, 7));
    const acento = cands.find((h) => { const o = hexParaOklch(h); return o.C >= L.acento.Cmin && noIntervalo(o.h, L.acento.matiz); });
    const familias = unicos([es.tipografia.familias.h1, ...(es.tipografia.titulos || []).map((t) => t.familia)].filter(Boolean));
    const serif = familias.find((f) => L.serifadasDeModa.some((s) => f.toLowerCase() === s || f.toLowerCase().startsWith(s)));
    if (!(creme && acento && serif)) return resultado(false, 0);
    const evidencias = [
      ev({ pagina: p.url, seletor: 'body', trecho: `fundo da página ${fundoHex} (creme: luminosidade ${fmt(of.L)}, matiz ${Math.round(of.h)})`, valor: fundoHex }),
      ev({ pagina: p.url, trecho: `cor de destaque terracota ${acento}`, valor: acento }),
      ev({ pagina: p.url, seletor: es.tipografia.h1?.seletor ?? undefined, trecho: `fonte de título ${serif}`, valor: serif }),
    ];
    const citacoes = [citarCor(ctx, p, fundoHex), citarCor(ctx, p, acento), citarRegex(ctx, p, 'css', new RegExp(`font-family\\s*:\\s*[^;{}]*${esc(serif.toLowerCase())}[^;{}]*`))];
    return resultado(true, 1, [achadoDe({ pagina: p.url, mensagem: `Os três sinais da combinação de moda aparecem juntos: fundo creme (${fundoHex}), acento terracota (${acento}) e título em fonte serifada de moda (${serif}). Confirmar se a marca escolheu isso e tem fonte própria.`, evidencias, citacoes })]);
  });
});

// =====================================================================================================================
// TIPOGRAFIA
// =====================================================================================================================
const FONTES_GENERICAS = new Set(PALETA_PADRAO.fontesGenericas);
const ehFonteGenerica = (f) => !!f && (FONTES_GENERICAS.has(String(f).toLowerCase()) || incluiMinusc(LIMIARES['tipo-fonte-padrao'].listaDisplayExtra, f));
const primeiraFamilia = (pilha) => { const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(pilha || ''); return m ? (m[1] || m[2] || m[3]).trim() : ''; };
const PADROES_UA = { h1: 32, h2: 24, h3: 18.72, h4: 16, h5: 13.28, h6: 10.72, small: 13.33 };
// tamanho de fonte (px) de um elemento pela mini-cascata (em/% relativos ao pai); padrões do navegador para títulos
function tamanhoFontePx(amb, el) {
  for (let e = el; e && e.tag !== '#raiz'; e = e.pai) {
    const d = amb.proprio(e, ['font-size']);
    if (d) {
      const m = /^([\d.]+)(px|rem|em|%|pt)$/.exec(d.valor.trim().toLowerCase());
      if (!m) return null;
      const x = parseFloat(m[1]);
      if (m[2] === 'px') return x;
      if (m[2] === 'rem') return x * 16;
      if (m[2] === 'pt') return (x * 4) / 3;
      const pai = e.pai && e.pai.tag !== '#raiz' ? tamanhoFontePx(amb, e.pai) : 16;
      return pai == null ? null : m[2] === 'em' ? x * pai : (x / 100) * pai;
    }
    if (PADROES_UA[e.tag]) return PADROES_UA[e.tag];
  }
  return 16;
}
// letter-spacing em "em" (px/em/normal); null se não der para saber
function espacamentoEm(amb, el, tamanho) {
  const v = amb.valorDe(el, 'letter-spacing');
  if (v == null || /^normal$/i.test(v.trim())) return 0;
  const m = /^(-?[\d.]+)(px|em|rem)$/i.exec(v.trim());
  if (!m) return null;
  const x = parseFloat(m[1]);
  if (m[2].toLowerCase() === 'em') return x;
  const px = m[2].toLowerCase() === 'px' ? x : x * 16;
  return tamanho ? px / tamanho : null;
}
const eCabecalhoOuNav = (el) => dentroDe(el, ['nav', 'footer', 'button', 'code', 'pre', 'figcaption', 'label', 'th', 'time', 'svg']);
const RE_LOGO = /(^|[-_ ])(logo|logotipo|brand|marca|wordmark)([-_ ]|$)/i;

const tipoFontePadrao = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const est = estaticoDoSite(dados);
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const papeis = [{ papel: 'corpo', familia: es.tipografia.familias.body, pilha: es.tipografia.familias.pilhaBody, seletor: 'body' }];
    if (es.tipografia.h1) papeis.push({ papel: 'título principal', familia: es.tipografia.h1.familia, pilha: es.tipografia.familias.pilhaH1, seletor: es.tipografia.h1.seletor });
    const genericos = papeis.filter((x) => ehFonteGenerica(x.familia));
    const declaradasPropria = (es.tipografia.fontes.declaradas || []).filter((f) => !ehFonteGenerica(f.familia));
    const fontFacePropria = (est?.tipografia?.fontFaceComFamiliaNaoGenerica || []).length > 0;
    const algumPapelPropriamente = papeis.some((x) => x.familia && !ehFonteGenerica(x.familia));
    const propria = declaradasPropria.length > 0 || fontFacePropria || algumPapelPropriamente;
    if (!genericos.length || propria) return resultado(false, 0);
    const evidencias = papeis.map((x) => ev({ pagina: p.url, seletor: x.seletor, trecho: `${x.papel}: font-family ${x.pilha || x.familia}`, valor: x.familia, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: 'nenhuma fonte própria (@font-face ou serviço de fontes) em uso', valor: 0, contagem: 0 }));
    const citacoes = genericos.map((x) => citarRegex(ctx, p, 'css', new RegExp(`font-family\\s*:\\s*[^;{}]*${esc(String(x.familia).toLowerCase())}[^;{}]*`)));
    if (!semNulos(citacoes).length) citacoes.push(citarTextoDoSeletor(ctx, p, es.tipografia.h1?.seletor || 'body'));
    const nomes = unicos(genericos.map((x) => x.familia));
    return resultado(true, genericos.length / papeis.length, [achadoDe({ pagina: p.url, mensagem: `${genericos.map((x) => x.papel).join(' e ')} ${genericos.length > 1 ? 'usam' : 'usa'} só fonte comum de biblioteca ou do sistema (${nomes.join(', ')}) e o site não define fonte própria.`, evidencias, citacoes })]);
  });
});

// tamanhos de fonte declarados e usados (valor distinto por elemento com texto próprio), pela mini-cascata
function tamanhosDeclaradosEmUso(amb) {
  const set = new Map();
  for (const el of amb.arv.todos) {
    if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || !textoDireto(el)) continue;
    const d = amb.proprio(el, ['font-size']);
    if (!d || /^(inherit|unset|initial)$/i.test(d.valor.trim())) continue;
    const px = comprimentoPx(d.valor);
    const chave = px != null ? `${arred(px, 1)}px` : d.valor.trim().toLowerCase();
    if (!set.has(chave)) set.set(chave, d.valor.trim());
  }
  return [...set.keys()];
}
const tipoEscala = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-escala-ausente-ou-caotica'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const amb = ambienteDaPagina(ctx, p);
    const usados = es.tipografia.tamanhos.lista || [];
    const declarados = amb ? tamanhosDeclaradosEmUso(amb) : [];
    const nSecoes = es.secoes?.n || 0;
    const nDecl = declarados.length || usados.length;
    const pouca = usados.length > 0 && usados.length < L.minimoTamanhosParaHierarquia && nSecoes >= L.secoesMinimas;
    const caos = nDecl > L.maximoTamanhos;
    if (!pouca && !caos) return resultado(false, 0);
    const partes = [];
    let intensidade = 0;
    if (pouca) { partes.push(`a página tem ${nSecoes} seções e só ${usados.length} tamanho(s) de letra (${usados.map((t) => t + 'px').join(', ')}), então título e texto quase não se distinguem`); intensidade = Math.max(intensidade, 1 - usados.length / L.minimoTamanhosParaHierarquia); }
    if (caos) { partes.push(`são ${nDecl} tamanhos de letra diferentes declarados e usados (o razoável é até ${L.maximoTamanhos})`); intensidade = Math.max(intensidade, clamp01(0.5 + (nDecl - L.maximoTamanhos) / (L.tamanhosParaSaturar - L.maximoTamanhos) / 2)); }
    const evidencias = [ev({ pagina: p.url, trecho: `tamanhos em uso: ${usados.map((t) => t + 'px').join(', ')}`, valor: usados.length, contagem: usados.length }), ev({ pagina: p.url, trecho: `tamanhos declarados e usados: ${declarados.slice(0, 20).join(', ')}`, valor: declarados.length, contagem: declarados.length })];
    const citacoes = citarTodos(ctx, p, 'css', /font-size\s*:\s*[^;{}]{1,30}/, 3);
    if (!citacoes.length) citacoes.push(citarTextoDoSeletor(ctx, p, es.tipografia.h1?.seletor || 'body'));
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Escala de tamanhos fora do razoável: ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const tipoPesos = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-pesos-exagerados'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const pesos = Object.keys(es.tipografia.pesos.valores || {});
    const titulos = es.tipografia.titulos || [];
    const pesados = titulos.filter((t) => Number(t.peso) >= L.pesoExtremo);
    const demais = pesos.length > L.maximoPesos;
    if (!demais && !pesados.length) return resultado(false, 0);
    const partes = [];
    let intensidade = 0;
    if (demais) { partes.push(`${pesos.length} pesos de letra diferentes em uso (${pesos.join(', ')}); o comum é até ${L.maximoPesos}`); intensidade = Math.max(intensidade, clamp01((pesos.length - L.maximoPesos) / 3)); }
    if (pesados.length) { partes.push(`${pesados.length} de ${titulos.length} títulos (h1 a h3) em peso ${unicos(pesados.map((t) => t.peso)).join('/')}`); intensidade = Math.max(intensidade, pesados.length / titulos.length); }
    const evidencias = pesados.slice(0, 5).map((t) => ev({ pagina: p.url, seletor: t.seletor, trecho: `${t.tag} peso ${t.peso}: ${t.texto}`, valor: t.peso, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `pesos em uso: ${pesos.join(', ')}`, valor: pesos.length, contagem: pesos.length }));
    const citacoes = [...citarTodos(ctx, p, 'css', /font-weight\s*:\s*(800|900|extra-?bold|black)\b/, 2), ...pesados.slice(0, 2).map((t) => citarTextoDoSeletor(ctx, p, t.seletor))];
    if (!semNulos(citacoes).length) citacoes.push(...citarTodos(ctx, p, 'css', /font-weight\s*:\s*[\w-]+/, 3));
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Pesos de letra exagerados: ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const tipoTituloSemTracking = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-titulo-sem-tracking'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const g = es.tipografia.titulosGrandes;
    if (!g || g.total === 0) return resultado(false, 0); // sem título grande: nada a medir (não é falha)
    if (g.comTrackingNegativo > 0) return resultado(false, 0);
    const grandes = (es.tipografia.titulos || []).filter((t) => t.tamanhoPx >= L.tamanhoMinimoPx && t.letterSpacingPx >= 0);
    const evidencias = grandes.slice(0, 5).map((t) => ev({ pagina: p.url, seletor: t.seletor, trecho: `${t.tag} ${t.tamanhoPx}px, letter-spacing ${t.letterSpacingPx}px: ${t.texto}`, valor: t.letterSpacingEm, visivel: true }));
    const citacoes = grandes.slice(0, 3).map((t) => citarTextoDoSeletor(ctx, p, t.seletor));
    return resultado(true, 1, [achadoDe({ pagina: p.url, mensagem: `Há ${g.total} título(s) de ${L.tamanhoMinimoPx}px ou mais com o espaçamento entre letras de fábrica; nenhum tem apertamento negativo.`, evidencias, citacoes })]);
  });
});

const tipoTrackingFora = detector(({ ctx, med }) => {
  const L = LIMIARES['tipo-tracking-fora-de-faixa'];
  const dados = dadosCss(med);
  if (!dados) return null;
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    const amb = ambienteDaPagina(ctx, p);
    if (!es && !amb) return null;
    const ocorrencias = [];
    for (const t of es?.tipografia?.titulos || []) if (t.letterSpacingEm < L.minimoEm) ocorrencias.push({ tipo: 'apertado demais', seletor: t.seletor, trecho: `${t.tag}: letter-spacing ${t.letterSpacingEm}em`, texto: t.texto });
    if (amb) {
      for (const r of amb.css.regras) {
        const ls = r.decls.find((d) => d.prop === 'letter-spacing');
        if (!ls) continue;
        const m = /^(-[\d.]+)(px|em|rem)$/.exec(ls.valor.trim().toLowerCase());
        if (!m) continue;
        const fs = r.decls.find((d) => d.prop === 'font-size');
        const tam = fs ? comprimentoPx(fs.valor) : null;
        const em = m[2] === 'em' ? parseFloat(m[1]) : tam ? (m[2] === 'px' ? parseFloat(m[1]) : parseFloat(m[1]) * 16) / tam : null;
        if (em != null && em < L.minimoEm) ocorrencias.push({ tipo: 'apertado demais', seletor: r.seletorTxt, trecho: ls.texto, decl: ls.texto });
        else if (tam != null && tam < L.tamanhoTextoPequenoPx) ocorrencias.push({ tipo: 'texto pequeno com espaçamento negativo', seletor: r.seletorTxt, trecho: `${fs.texto}; ${ls.texto}`, decl: ls.texto });
      }
    }
    if (!ocorrencias.length) return resultado(false, 0);
    const evidencias = ocorrencias.slice(0, 6).map((o) => ev({ pagina: p.url, seletor: o.seletor, trecho: `${o.tipo}: ${o.trecho}`, valor: o.tipo }));
    const citacoes = ocorrencias.filter((o) => o.decl).slice(0, 3).map((o) => citarSeExiste(ctx, p, 'css', o.decl));
    for (const o of ocorrencias.filter((x) => !x.decl).slice(0, 2)) citacoes.push(citarTextoDoSeletor(ctx, p, o.seletor));
    return resultado(true, ocorrencias.length / L.ocorrenciasParaSaturar, [achadoDe({ pagina: p.url, mensagem: `Há espaçamento entre letras apertado fora da faixa segura em ${ocorrencias.length} ponto(s): ${unicos(ocorrencias.map((o) => o.tipo)).join(' e ')} (limite ${fmt(L.minimoEm)}em; texto abaixo de ${L.tamanhoTextoPequenoPx}px não deve ter apertamento).`, evidencias, citacoes })]);
  });
});

const tipoMicrotexto = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-microtexto'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const a = es.tipografia.tamanhos.abaixo12;
    if (a.tamanhos.length < L.minimoTamanhosDistintos) return resultado(false, 0);
    const evidencias = (a.exemplos || []).map((t) => ev({ pagina: p.url, seletor: t.seletor, trecho: `${t.tamanhoPx}px: ${t.texto}`, valor: t.tamanhoPx, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `tamanhos abaixo de ${L.limitePx}px: ${a.tamanhos.map((t) => t + 'px').join(', ')}`, valor: a.tamanhos.length, contagem: a.elementos }));
    const citacoes = [...(a.exemplos || []).slice(0, 3).map((t) => citarTextoVisivel(ctx, p, t.texto)), ...citarTodos(ctx, p, 'css', /font-size\s*:\s*(?:[1-9]|1[01])(?:\.\d+)?px/, 2)];
    return resultado(true, a.tamanhos.length / L.tamanhosParaSaturar, [achadoDe({ pagina: p.url, mensagem: `${a.tamanhos.length} tamanhos de letra diferentes abaixo de ${L.limitePx}px (${a.tamanhos.map((t) => t + 'px').join(', ')}) em ${a.elementos} elementos de texto. Difícil de ler, principalmente no celular.`, evidencias, citacoes })]);
  });
});

const tipoEntrelinha = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-entrelinha-apertada'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const amb = ambienteDaPagina(ctx, p);
    const lh = es.tipografia.lineHeightCorpo;
    // ramo B: títulos em caixa alta com entrelinha menor que 1 (declarado, mini-cascata)
    const caixaAlta = [];
    if (amb) {
      for (const el of amb.arv.todos) {
        if (!/^h[1-6]$/.test(el.tag) || !textoTotal(el)) continue;
        if (!/^uppercase$/i.test((amb.valorDe(el, 'text-transform') || '').trim())) continue;
        const v = (amb.valorDe(el, 'line-height') || '').trim();
        const num = /^[\d.]+$/.test(v) ? parseFloat(v) : null;
        if (num == null) continue;
        const nowrap = /nowrap/i.test(amb.valorDe(el, 'white-space', { herdar: true }) || '');
        const minimo = nowrap ? L.caixaAltaMinimoLinhaUnica : L.caixaAltaMinimoQuebravel;
        if (num < minimo) caixaAlta.push({ seletor: seletorDe(amb.arv, el), razao: num, texto: textoTotal(el) });
      }
    }
    const medida = lh && lh.amostras > 0 ? lh.medianaRazao : null;
    const ramoA = medida != null && medida < L.prosaMinimoRazao;
    if (!ramoA && !caixaAlta.length) {
      if (lh && lh.amostras === 0 && lh.normal > 0) return null; // só "line-height: normal" (razão depende da fonte): não avaliável
      return resultado(false, 0);
    }
    const partes = [];
    let intensidade = 0;
    if (ramoA) { partes.push(`a entrelinha mediana dos parágrafos é ${fmt(medida)} vez o tamanho da letra (o mínimo confortável é ${fmt(L.prosaMinimoRazao)})`); intensidade = Math.max(intensidade, clamp01((L.prosaMinimoRazao - medida) / 0.3)); }
    if (caixaAlta.length) { partes.push(`${caixaAlta.length} título(s) em caixa alta com entrelinha abaixo de ${fmt(L.caixaAltaMinimoQuebravel)}`); intensidade = 1; }
    const evidencias = [];
    if (ramoA) evidencias.push(ev({ pagina: p.url, trecho: `mediana da entrelinha dos parágrafos: ${fmt(medida)} (${lh.amostras} amostras)`, valor: medida, contagem: lh.amostras }));
    for (const c of caixaAlta.slice(0, 4)) evidencias.push(ev({ pagina: p.url, seletor: c.seletor, trecho: `caixa alta, line-height ${fmt(c.razao)}: ${c.texto}`, valor: c.razao, visivel: true }));
    const citacoes = [];
    if (ramoA) {
      for (const r of amb?.css.regras || []) { const d = r.decls.find((x) => x.prop === 'line-height' && /^[\d.]+$/.test(x.valor.trim()) && parseFloat(x.valor) < L.prosaMinimoRazao); if (d) { citacoes.push(citarSeExiste(ctx, p, 'css', d.texto)); break; } }
    }
    for (const c of caixaAlta.slice(0, 2)) citacoes.push(citarTextoDoSeletor(ctx, p, c.seletor));
    if (!semNulos(citacoes).length && amb) { const par = amb.arv.todos.find((e) => e.tag === 'p' && textoTotal(e).length > 40); if (par) citacoes.push(citarTextoVisivel(ctx, p, textoTotal(par), 50)); }
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Entrelinha apertada: ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const tipoLinhaLonga = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-linha-longa-demais'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const pg = es.tipografia.paragrafos;
    if (!pg || !pg.amostras) return null; // nenhum parágrafo de 3 linhas ou mais: nada a medir
    if (pg.caracteresPorLinhaMediana <= L.limiteAviso) return resultado(false, 0);
    const forte = pg.caracteresPorLinhaMax >= L.limiteForte;
    let intensidade = clamp01((pg.caracteresPorLinhaMediana - L.limiteAviso) / L.intervaloParaSaturar);
    if (forte) intensidade = Math.max(intensidade, 0.7);
    const evidencias = (pg.exemplosLongos || []).map((x) => ev({ pagina: p.url, seletor: x.seletor, trecho: `${x.caracteresPorLinha} caracteres por linha em ${x.linhas} linhas`, valor: x.caracteresPorLinha, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `mediana ${pg.caracteresPorLinhaMediana} caracteres por linha (${pg.amostras} parágrafos; viewport ${es.viewport?.largura}px)`, valor: pg.caracteresPorLinhaMediana, contagem: pg.amostras }));
    const citacoes = (pg.exemplosLongos || []).slice(0, 3).map((x) => citarTextoDoSeletor(ctx, p, x.seletor, 70));
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Os parágrafos de corpo têm em mediana ${pg.caracteresPorLinhaMediana} caracteres por linha (acima de ${L.limiteAviso} cansa a leitura), com linhas de até ${pg.caracteresPorLinhaMax}${forte ? `, passando de ${L.limiteForte}` : ''}.`, evidencias, citacoes })]);
  });
});

const FAMILIAS_IGNORADAS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|unset|revert|math|emoji|fangsong)$/i;
const tipoFamiliasDemais = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-familias-demais'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    const amb = ambienteDaPagina(ctx, p);
    if (!es && !amb) return null;
    const familias = new Map(); // minúscula -> nome original
    const add = (nome) => { const n = String(nome || '').replace(/^["']|["']$/g, '').trim(); if (!n || /^var\(|^\$/.test(n) || FAMILIAS_IGNORADAS.test(n) || L.regexFonteDeIcones.test(n)) return; if (!familias.has(n.toLowerCase())) familias.set(n.toLowerCase(), n); };
    const decl = [];
    if (amb) for (const r of amb.css.regras) for (const d of r.decls) if (d.prop === 'font-family' || /^--font/.test(d.prop)) { add(primeiraFamilia(d.valor)); decl.push(d); }
    if (!familias.size && es) for (const f of Object.keys(es.tipografia.familias.valores || {})) add(f);
    if (familias.size <= L.maximoFamilias) return resultado(false, 0);
    const lista = [...familias.values()];
    const evidencias = lista.slice(0, 8).map((f) => ev({ pagina: p.url, trecho: `família ${f}`, valor: f }));
    const citacoes = lista.slice(0, 4).map((f) => citarRegex(ctx, p, 'css', new RegExp(`font-family\\s*:\\s*[^;{}]*${esc(f.toLowerCase())}[^;{}]*`)) || citarRegex(ctx, p, 'css', new RegExp(`--font[\\w-]*\\s*:\\s*[^;{}]*${esc(f.toLowerCase())}[^;{}]*`)));
    return resultado(true, clamp01((lista.length - L.maximoFamilias) / (L.familiasParaSaturar - L.maximoFamilias)), [achadoDe({ pagina: p.url, mensagem: `A página declara ${lista.length} famílias de fonte diferentes (${lista.slice(0, 6).join(', ')}); o razoável é até ${L.maximoFamilias}.`, evidencias, citacoes })]);
  });
});

const tipoTextoGradiente = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-texto-gradiente'];
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    const es = pc?.computado;
    const amb = ambienteDaPagina(ctx, p);
    const itens = es?.gradientes?.texto?.itens || [];
    const porClasse = amb ? amb.arv.todos.filter((e) => e.classes.includes('bg-clip-text') && e.classes.includes('text-transparent')) : [];
    if (!es && !porClasse.length) { const est = estaticoDoSite(dados); if (!est) return null; if (!est.efeitos?.backgroundClipText) return resultado(false, 0); }
    if (!itens.length && !porClasse.length && es) return resultado(false, 0);
    const multiMatiz = (seletor) => {
      const g = (es?.gradientes?.itens || []).find((x) => x.seletor === seletor && x.aplicadoAoTexto);
      if (!g) return true;
      const hs = g.paradas.filter((s) => s.s >= 0.2 && s.a > 0).map((s) => s.h);
      return hs.length < 2 || Math.max(...hs) - Math.min(...hs) > L.matizesIguaisGraus;
    };
    const lista = itens.map((i) => ({ seletor: i.seletor, tag: i.tag, texto: i.texto, tamanhoPx: i.tamanhoPx, multi: multiMatiz(i.seletor) }));
    for (const e of porClasse) lista.push({ seletor: seletorDe(amb.arv, e), tag: e.tag, texto: textoTotal(e), tamanhoPx: null, multi: true });
    const dedup = [...new Map(lista.map((x) => [x.seletor, x])).values()];
    const intensidade = dedup.some((x) => x.multi) ? 1 : L.intensidadeUmaMatiz;
    const evidencias = dedup.slice(0, 6).map((x) => ev({ pagina: p.url, seletor: x.seletor, trecho: `${x.tag}${x.tamanhoPx ? ' ' + x.tamanhoPx + 'px' : ''}: ${x.texto}${x.multi ? '' : ' (degradê de uma só matiz)'}`, valor: 'background-clip: text', visivel: true }));
    const citacoes = [citarRegex(ctx, p, 'css', /(-webkit-)?background-clip\s*:\s*text/), ...dedup.slice(0, 2).map((x) => citarTextoDoSeletor(ctx, p, x.seletor))];
    const nomes = dedup.slice(0, 3).map((x) => `${x.tag}${x.texto ? ` "${cortar(x.texto, 40)}"` : ''}`);
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Há texto preenchido com degradê (background-clip: text) em ${dedup.length} elemento(s): ${nomes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const tipoPalavraDestacada = detector(({ ctx }) => {
  const L = LIMIARES['tipo-palavra-destacada-no-titulo'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const visiveis = new Set((p.final?.extr?.headings || []).filter((h) => h.visivel && !h.clone).map((h) => normalizarTexto(h.texto)));
    const titulos = amb.arv.todos.filter((e) => /^h[1-3]$/.test(e.tag) && textoTotal(e) && (visiveis.size === 0 || visiveis.has(normalizarTexto(textoTotal(e)).slice(0, 200))));
    const achados = [];
    for (const h of titulos) {
      const palavrasTitulo = textoTotal(h).split(/\s+/).filter(Boolean);
      if (palavrasTitulo.length < 2) continue;
      const marcados = descendentes(h).filter((e) => {
        if (!['em', 'i', 'span', 'mark'].includes(e.tag)) return false;
        const t = textoTotal(e);
        if (!t || /\s/.test(t)) return false;
        if (e.tag === 'span') {
          const s = amb.estilo(e);
          return ['color', 'font-style', 'font-weight', 'background', 'background-color', 'text-decoration', 'background-image'].some((k) => s.has(k));
        }
        return true;
      });
      if (marcados.length === 1) achados.push({ h, e: marcados[0] });
    }
    if (achados.length < L.minimoTitulos) return resultado(false, 0);
    const evidencias = achados.slice(0, 6).map(({ h, e }) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, h), trecho: `<${e.tag}> em "${textoTotal(e)}" dentro de "${cortar(textoTotal(h), 70)}"`, valor: textoTotal(e), visivel: true }));
    const citacoes = achados.slice(0, 3).map(({ e }) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, e, 120)));
    return resultado(true, achados.length / Math.max(titulos.length, achados.length), [achadoDe({ pagina: p.url, mensagem: `Em ${achados.length} de ${titulos.length} títulos (h1 a h3), exatamente uma palavra aparece em itálico ou com estilo diferente do resto. Repetido seção após seção, vira fórmula; confirmar se é intencional.`, evidencias, citacoes })]);
  });
});

const tipoRotuloCaixaAlta = detector(({ ctx }) => {
  const L = LIMIARES['tipo-rotulo-caixa-alta-espacado'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const sinais = (el) => {
      const tam = tamanhoFontePx(amb, el);
      const maiusc = /^uppercase$/i.test((amb.valorDe(el, 'text-transform') || '').trim());
      const versalete = /small-caps/i.test(amb.valorDe(el, 'font-variant') || '') || /small-caps/i.test(amb.valorDe(el, 'font-variant-caps', { herdar: true }) || '');
      const esp = espacamentoEm(amb, el, tam);
      return { tam, maiusc, versalete, esp };
    };
    const ramoA = [];
    const ramoB = [];
    const alvosB = new Set();
    for (const h of amb.arv.todos.filter((e) => /^h[1-3]$/.test(e.tag))) { const ant = irmaoAnterior(h); if (ant) alvosB.add(ant); }
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el)) continue;
      // exceções da regra: legendas, cabeçalhos de tabela, rótulos de formulário, navegação, datas, botões, código, logotipos e links de rodapé
      if (['figcaption', 'th', 'label', 'nav', 'time', 'button', 'code', 'pre', 'kbd', 'samp'].includes(el.tag) || eCabecalhoOuNav(el) || el.classes.some((c) => RE_LOGO.test(c)) || (el.tag === 'a' && /btn|button|cta/i.test(el.attrs.class || ''))) continue;
      const A = L.ramoA, B = L.ramoB;
      const proprioTxt = textoDireto(el);
      const txtTotal = textoTotal(el);
      const noRamoA = !!proprioTxt && proprioTxt.length <= 60; // "rótulo": texto curto (limiar inicial, a calibrar)
      const noRamoB = alvosB.has(el) && !!txtTotal;
      if (!noRamoA && !noRamoB) continue;
      const s = sinais(el);
      if (noRamoA && s.tam != null && s.tam <= A.tamanhoMaximoPx && (s.maiusc || s.versalete || (s.esp != null && s.esp > A.letterSpacingAcimaEm))) ramoA.push({ el, txt: proprioTxt, s });
      if (noRamoB) {
        const n = txtTotal.split(/\s+/).filter(Boolean).length;
        const quantos = (s.maiusc || s.versalete ? 1 : 0) + (s.esp != null && s.esp >= B.letterSpacingMinimoEm ? 1 : 0) + (s.tam != null && s.tam <= A.tamanhoMaximoPx ? 1 : 0);
        if (n <= B.maxPalavras && txtTotal.length <= B.maxCaracteres && quantos >= B.sinaisNecessarios) ramoB.push({ el, txt: txtTotal, s });
      }
    }
    const dispA = ramoA.length >= L.ramoA.minimoOcorrencias, dispB = ramoB.length >= L.ramoB.minimoOcorrencias;
    if (!dispA && !dispB) return resultado(false, 0);
    const intensidade = Math.max(dispA ? ramoA.length / L.ramoA.ocorrenciasParaSaturar : 0, dispB ? ramoB.length / L.ramoB.ocorrenciasParaSaturar : 0);
    const exemplos = (dispB ? ramoB : ramoA).slice(0, 5);
    const evidencias = exemplos.map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `"${x.txt}" (${[x.s.maiusc ? 'caixa alta' : '', x.s.versalete ? 'versalete' : '', x.s.esp ? `espaçamento ${fmt(x.s.esp)}em` : '', x.s.tam ? `${arred(x.s.tam, 1)}px` : ''].filter(Boolean).join(', ')})`, valor: x.txt, visivel: true }));
    const citacoes = [...exemplos.slice(0, 3).map((x) => citarTextoVisivel(ctx, p, x.txt)), citarRegex(ctx, p, 'css', /text-transform\s*:\s*uppercase/)];
    const partes = [];
    if (dispA) partes.push(`${ramoA.length} rótulos pequenos em caixa alta ou com letras espaçadas`);
    if (dispB) partes.push(`${ramoB.length} rótulos curtos logo acima de títulos (eyebrows)`);
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Rótulos em CAIXA ALTA espaçada aparecem em vários lugares: ${partes.join('; ')}. Um pouco é normal; em todo lugar vira marca de página padronizada.`, evidencias, citacoes })]);
  });
});

const tipoMonoDecorativa = detector(({ ctx }) => {
  const L = LIMIARES['tipo-mono-decorativa'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const corpo = amb.arv.corpo || amb.arv.htmlEl;
    if (corpo && L.regexFamiliaMono.test(primeiraFamilia(amb.valorDe(corpo, 'font-family') || ''))) return resultado(false, 0); // site inteiro em mono: escolha deliberada
    const RE_ROTULO = /(label|legend|legenda|caption|badge|tag|eyebrow|kicker|chip|pill|overline)/i;
    const achados = [];
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || ['code', 'pre', 'kbd', 'samp'].includes(el.tag) || dentroDe(el, ['code', 'pre', 'kbd', 'samp'])) continue;
      const alvo = ['label', 'th', 'figcaption', 'small'].includes(el.tag) || el.classes.some((c) => RE_ROTULO.test(c));
      if (!alvo) continue;
      const t = textoDireto(el);
      if (!t) continue;
      const digitos = (t.match(/\d/g) || []).length;
      if (digitos / t.length >= 0.4) continue; // preço, medida, versão, data
      const fam = primeiraFamilia(amb.valorDe(el, 'font-family') || '');
      if (fam && L.regexFamiliaMono.test(fam)) achados.push({ el, t, fam });
    }
    if (achados.length < L.minimoOcorrencias) return resultado(false, 0);
    const evidencias = achados.slice(0, 6).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `${x.el.tag}: "${cortar(x.t, 50)}" em ${x.fam}`, valor: x.fam, visivel: true }));
    const citacoes = [...achados.slice(0, 3).map((x) => citarTextoVisivel(ctx, p, x.t)), citarRegex(ctx, p, 'css', new RegExp(`font-family\\s*:\\s*[^;{}]*(${L.regexFamiliaMono.source})[^;{}]*`, 'i'))];
    return resultado(true, achados.length / L.ocorrenciasParaSaturar, [achadoDe({ pagina: p.url, mensagem: `Fonte monoespaçada (${unicos(achados.map((x) => x.fam)).join(', ')}) usada em ${achados.length} rótulos, legendas ou cabeçalhos que não são código nem dados.`, evidencias, citacoes })]);
  });
});

const tipoNumerosSemTabular = detector(({ ctx }) => {
  const L = LIMIARES['tipo-numeros-sem-tabular'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const RE_NUM = /(price|preco|preço|stat|counter|contador|metric|kpi|number|numero|valor|amount)/i;
    const cands = [];
    for (const el of amb.arv.todos) {
      if (!(['td', 'th'].includes(el.tag) || el.classes.some((c) => RE_NUM.test(c)))) continue;
      const t = textoDireto(el);
      if (!t) continue;
      const digitos = (t.match(/\d/g) || []).length;
      const naoEspaco = t.replace(/\s/g, '').length;
      if (digitos < L.minimoDigitos || digitos / naoEspaco < 0.5) continue;
      const vn = (amb.valorDe(el, 'font-variant-numeric') || '') + ' ' + (amb.valorDe(el, 'font-feature-settings') || '');
      cands.push({ el, t, tabular: /tabular-nums|tnum/i.test(vn) });
    }
    if (cands.length < L.minimoCandidatos) return resultado(false, 0);
    const sem = cands.filter((c) => !c.tabular);
    const fracao = sem.length / cands.length;
    if (fracao <= L.fracaoParaDisparar) return resultado(false, 0);
    const evidencias = sem.slice(0, 6).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `${x.el.tag}: ${x.t}`, valor: x.t, visivel: true }));
    const citacoes = sem.slice(0, 3).map((x) => citarTextoVisivel(ctx, p, x.t));
    return resultado(true, fracao, [achadoDe({ pagina: p.url, mensagem: `${sem.length} de ${cands.length} células e valores numéricos (tabelas, preços, contadores) não usam algarismos de mesma largura (font-variant-numeric: tabular-nums), então as colunas não alinham.`, evidencias, citacoes })]);
  });
});

const tipoAcabamentoFino = detector(({ ctx }) => {
  const L = LIMIARES['tipo-acabamento-fino'];
  return agregarPaginas(ctx, (p) => {
    const extr = p.final?.extr;
    if (!extr) return null;
    const amb = ambienteDaPagina(ctx, p);
    const achados = [];
    for (const n of extr.nos || []) {
      if (!n.visivel || n.clone || !['p', 'li', 'blockquote', 'dd'].includes(n.tag)) continue;
      for (const m of n.texto.matchAll(/"[^"\n]{3,}"/g)) achados.push({ tipo: 'aspas retas', seletor: n.seletor, trecho: m[0] });
      const i = n.texto.indexOf('...');
      if (i >= 0) achados.push({ tipo: 'três pontos no lugar de reticências', seletor: n.seletor, trecho: n.texto.slice(Math.max(0, i - 20), i + 3).trim() });
    }
    if (amb) {
      for (const r of amb.css.regras) {
        const j = r.decls.find((d) => d.prop === 'text-align' && /^justify$/i.test(d.valor.trim()));
        if (j && !r.decls.some((d) => d.prop === 'hyphens' && /auto/i.test(d.valor))) achados.push({ tipo: 'texto justificado sem hifenização', seletor: r.seletorTxt, trecho: j.texto, css: j.texto });
      }
    }
    if (achados.length < L.minimoAchados) return resultado(false, 0);
    const evidencias = achados.slice(0, 6).map((a) => ev({ pagina: p.url, seletor: a.seletor, trecho: `${a.tipo}: ${a.trecho}`, valor: a.tipo }));
    const citacoes = achados.slice(0, 4).map((a) => (a.css ? citarSeExiste(ctx, p, 'css', a.css) : citarSeExiste(ctx, p, 'visivel', a.trecho)));
    return resultado(true, achados.length / L.achadosParaSaturar, [achadoDe({ pagina: p.url, mensagem: `Pequenos descuidos de acabamento no texto: ${unicos(achados.map((a) => a.tipo)).join('; ')} (${achados.length} ocorrências). Detalhe fino, de peso baixo.`, evidencias, citacoes })]);
  });
});

const tipoTitulosTimidos = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['tipo-titulos-de-secao-timidos'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const h2 = (es.tipografia.titulos || []).filter((t) => t.tag === 'h2');
    if (!h2.length) return null; // sem h2 visível: nada a medir
    const med2 = mediana(h2.map((t) => t.tamanhoPx));
    if (med2 >= L.medianaMinimaPx) return resultado(false, 0);
    const evidencias = h2.slice(0, 5).map((t) => ev({ pagina: p.url, seletor: t.seletor, trecho: `h2 ${t.tamanhoPx}px: ${t.texto}`, valor: t.tamanhoPx, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `viewport de ${es.viewport?.largura}px; mediana dos h2: ${med2}px`, valor: med2 }));
    const citacoes = h2.slice(0, 3).map((t) => citarTextoDoSeletor(ctx, p, t.seletor));
    return resultado(true, clamp01((L.medianaMinimaPx - med2) / L.intervaloParaSaturar), [achadoDe({ pagina: p.url, mensagem: `Os títulos de seção (h2) têm mediana de ${med2}px no desktop (abaixo de ${L.medianaMinimaPx}px); a hierarquia de leitura rápida fica fraca.`, evidencias, citacoes })]);
  });
});

// =====================================================================================================================
// SUPERFÍCIE
// =====================================================================================================================
const RE_COR_FN = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8}\b)/i;
// camadas de um box-shadow/text-shadow: [{ inset, x, y, blur, spread, cor(hex|null), alfa }]
export function camadasSombra(valor) {
  return dividirTopo(String(valor || ''), ',').filter((t) => !/^none$/i.test(t)).map((parte) => {
    const inset = /\binset\b/i.test(parte);
    const semInset = parte.replace(/\binset\b/i, ' ');
    const mc = RE_COR_FN.exec(semInset);
    const cor = mc ? parseCor(mc[1]) : parseCor(semInset.split(/\s+/).find((t) => NOMES_CSS[t.toLowerCase()]) || '');
    const resto = mc ? semInset.replace(mc[1], ' ') : semInset;
    const nums = (resto.match(/-?[\d.]+(?:px|rem|em)?/g) || []).map((x) => comprimentoPx(x) ?? parseFloat(x));
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    return { inset, x, y, blur, spread, cor: cor ? cor.hex : null, alfa: cor ? cor.a : 1 };
  });
}
const ladoDe = (arr, idx) => (arr.length === 1 ? arr[0] : arr.length === 2 ? arr[idx % 2 === 0 ? 0 : 1] : arr.length === 3 ? [arr[0], arr[1], arr[2], arr[1]][idx] : arr[idx]);
const tokensTopo = (v) => String(v ?? '').match(/[^\s(]+\([^)]*\)|\S+/g) || [];
// borda de um lado, pela mini-cascata: { w (px efetivos), estilo, cor(hex|null), texto (declaração vencedora da largura/cor) }
function bordaDoLado(amb, el, lado) {
  const e = amb.estilo(el);
  const idx = { top: 0, right: 1, bottom: 2, left: 3 }[lado];
  const nomes = lado === 'left' ? [`border-left`, 'border-inline-start'] : lado === 'right' ? [`border-right`, 'border-inline-end'] : [`border-${lado}`];
  const cand = [];
  const lerD = (prop) => { const d = e.get(prop); return d ? { ...d, valor: amb.resolverVars(el, d.valor) } : null; };
  let d = lerD('border');
  if (d) { const b = parseBorda(d.valor); cand.push({ rank: d.rank, w: b.w, estilo: b.estilo, cor: b.cor, texto: d.texto }); }
  d = lerD('border-width'); if (d) cand.push({ rank: d.rank, w: larguraBordaPx(ladoDe(tokensTopo(d.valor), idx) || ''), texto: d.texto });
  d = lerD('border-style'); if (d) cand.push({ rank: d.rank, estilo: (ladoDe(tokensTopo(d.valor), idx) || '').toLowerCase(), texto: d.texto });
  d = lerD('border-color'); if (d) cand.push({ rank: d.rank, cor: parseCor(ladoDe(tokensTopo(d.valor), idx) || ''), texto: d.texto });
  for (const n of nomes) {
    d = lerD(n); if (d) { const b = parseBorda(d.valor); cand.push({ rank: d.rank, w: b.w, estilo: b.estilo, cor: b.cor, texto: d.texto }); }
    d = lerD(n + '-width'); if (d) cand.push({ rank: d.rank, w: larguraBordaPx(d.valor.trim()), texto: d.texto });
    d = lerD(n + '-style'); if (d) cand.push({ rank: d.rank, estilo: d.valor.trim().toLowerCase(), texto: d.texto });
    d = lerD(n + '-color'); if (d) cand.push({ rank: d.rank, cor: parseCor(d.valor), texto: d.texto });
  }
  const melhor = (campo) => cand.filter((c) => c[campo] != null).sort((a, b) => b.rank - a.rank)[0] || null;
  const mw = melhor('w'), me = melhor('estilo'), mc = melhor('cor');
  const estilo = me ? me.estilo : null;
  const ativo = estilo && !/^(none|hidden)$/.test(estilo);
  return { w: ativo ? (mw ? mw.w : 3) : 0, estilo, cor: mc && mc.cor ? mc.cor.hex : null, texto: (mw || mc || me)?.texto || null };
}
const ehControle = (el) => ['button', 'input', 'select', 'textarea', 'option'].includes(el.tag) || LIMIARES['sup-pilula-em-tudo'].regexSeletorControle.test(el.attrs.class || '');

const supSombraDifusa = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['sup-sombra-difusa-padrao'];
  return agregarPaginas(ctx, (p) => {
    const pc = paginaCss(dados, p);
    const es = pc?.computado;
    if (!es) return null;
    const camadas = (es.sombras.detalhes || []).filter((d) => d.difusaGenerica && d.alfa >= L.alfaMinimo && d.alfa <= L.alfaMaximo);
    const nComp = Math.min(soma(camadas.map((d) => d.elementos)), es.sombras.elementos || 0);
    const nClasses = pc.classesUtilitarias?.sombraPadrao || 0;
    const n = Math.max(nComp, nClasses);
    if (n < L.minimoOcorrencias) return resultado(false, 0);
    const exemplosClasses = pc.classesUtilitarias?.exemplos?.sombraPadrao || [];
    const evidencias = camadas.slice(0, 4).map((d) => ev({ pagina: p.url, seletor: es.sombras.exemplosDifusa?.[0], trecho: `box-shadow ${d.raw}`, valor: `blur ${d.blur}px, preto com alfa ${d.alfa}`, contagem: d.elementos, visivel: true }));
    for (const s of (es.sombras.exemplosDifusa || []).slice(0, 3)) evidencias.push(ev({ pagina: p.url, seletor: s, trecho: 'elemento com a sombra difusa padrão', visivel: true }));
    for (const t of exemplosClasses.slice(0, 3)) evidencias.push(ev({ pagina: p.url, trecho: `classe ${t}`, valor: t }));
    const citacoes = [citarRegex(ctx, p, 'css', /box-shadow\s*:\s*[^;{}]*rgba?\(\s*0[\s,]+0[\s,]+0\s*[,/]\s*0?\.[12]\d*\s*\)[^;{}]*/), ...exemplosClasses.slice(0, 2).map((t) => citarSeExiste(ctx, p, 'html', t))];
    const alvo = Math.max(es.cards?.total || 0, n);
    return resultado(true, n / alvo, [achadoDe({ pagina: p.url, mensagem: `${n} elementos (cartões, botões) repetem a mesma sombra suave e difusa de fábrica (preto com baixa opacidade e desfoque de ${camadas[0]?.blur ?? 'dezenas de'} px), sem relação com a luz ou a hierarquia da página.`, evidencias, citacoes })]);
  });
});

const supBrilhoGlow = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['sup-brilho-neon-glow'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const amb = ambienteDaPagina(ctx, p);
    const glows = (es.sombras.detalhes || []).filter((d) => !d.inset && d.x === 0 && d.y === 0 && d.blur > L.blurMinimoPx && d.alfa >= L.alfaMinimo && croma(d.cor) >= L.cromaMinimo);
    const nCaixa = Math.min(soma(glows.map((d) => d.elementos)), es.sombras.elementos || 0);
    const nTexto = es.efeitos?.textShadow?.saturados || 0;
    const nOrbesEl = es.efeitos?.filtros?.blurGrande || 0;
    // orbes em pseudo-elementos (::before/::after) absolutos com filter: blur(>= 40px), pelo CSS estático
    const orbes = [];
    if (amb) for (const r of amb.css.pseudo) {
      const f = r.decls.find((d) => d.prop === 'filter' && /blur\(\s*([\d.]+)px/i.test(d.valor));
      const pos = r.decls.find((d) => d.prop === 'position' && /^(absolute|fixed)$/i.test(d.valor.trim()));
      if (f && pos && parseFloat(/blur\(\s*([\d.]+)px/i.exec(f.valor)[1]) >= L.orbeBlurMinimoPx) orbes.push({ seletor: r.seletorTxt, decl: f.texto });
    }
    const total = nCaixa + nTexto + nOrbesEl + orbes.length;
    if (total < 1) return resultado(false, 0);
    const partes = [];
    if (nCaixa) partes.push(`${nCaixa} elemento(s) com sombra colorida sem deslocamento e desfoque acima de ${L.blurMinimoPx}px`);
    if (nTexto) partes.push(`${nTexto} elemento(s) com text-shadow colorido`);
    if (nOrbesEl + orbes.length) partes.push(`${nOrbesEl + orbes.length} orbe(s) desfocado(s) (blur de ${L.orbeBlurMinimoPx}px ou mais)`);
    const evidencias = glows.slice(0, 4).map((d) => ev({ pagina: p.url, trecho: `box-shadow ${d.raw}`, valor: d.cor, contagem: d.elementos, visivel: true }));
    for (const o of orbes.slice(0, 3)) evidencias.push(ev({ pagina: p.url, seletor: o.seletor, trecho: o.decl, valor: 'orbe desfocado' }));
    const citacoes = [];
    if (amb) {
      for (const r of amb.css.regras) {
        const d = r.decls.find((x) => x.prop === 'box-shadow' && camadasSombra(x.valor).some((c) => !c.inset && c.x === 0 && c.y === 0 && c.blur > L.blurMinimoPx && c.cor && croma(c.cor) >= L.cromaMinimo));
        if (d) { citacoes.push(citarSeExiste(ctx, p, 'css', d.texto)); break; }
      }
      const ts = amb.css.regras.map((r) => r.decls.find((x) => x.prop === 'text-shadow' && camadasSombra(x.valor).some((c) => c.cor && croma(c.cor) >= L.cromaMinimo))).find(Boolean);
      if (nTexto && ts) citacoes.push(citarSeExiste(ctx, p, 'css', ts.texto));
    }
    for (const o of orbes.slice(0, 2)) citacoes.push(citarSeExiste(ctx, p, 'css', o.decl));
    if (!semNulos(citacoes).length) citacoes.push(citarRegex(ctx, p, 'css', /(box|text)-shadow\s*:\s*[^;{}]+|filter\s*:\s*[^;{}]*blur\([^)]*\)/));
    return resultado(true, total / L.ocorrenciasParaSaturar, [achadoDe({ pagina: p.url, mensagem: `Há brilho colorido (glow) na página: ${partes.join('; ')}. Brilho não é profundidade; é efeito de moda.`, evidencias, citacoes })]);
  });
});

const supRaioUnico = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['sup-raio-unico-em-tudo'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const valores = Object.entries(es.raios.valores || {}).filter(([k]) => !/%/.test(k) && !/^0(px)?$/.test(k));
    if (valores.length !== L.valoresDistintos) return resultado(false, 0);
    const [valor, usos] = valores[0];
    if (usos < L.minimoUsos) return resultado(false, 0);
    const evidencias = [ev({ pagina: p.url, trecho: `border-radius ${valor} em ${usos} elementos (botões, cartões, campos)`, valor, contagem: usos })];
    for (const [tipo, mapa] of Object.entries(es.raios.porTipo || {})) if (Object.keys(mapa).length) evidencias.push(ev({ pagina: p.url, trecho: `${tipo}: ${Object.entries(mapa).map(([k, n]) => `${k} (${n})`).join(', ')}`, valor: tipo }));
    const citacoes = [citarRegex(ctx, p, 'css', new RegExp(`border-radius\\s*:\\s*${esc(valor)}`)) || citarRegex(ctx, p, 'css', /border-radius\s*:\s*[^;{}]+/)];
    return resultado(true, clamp01(0.5 + usos / L.usosParaSaturar / 2), [achadoDe({ pagina: p.url, mensagem: `Um único raio de canto (${valor}) aparece em ${usos} elementos, sem hierarquia entre peças grandes e pequenas.`, evidencias, citacoes })]);
  });
});

const supPilulaEmTudo = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  const L = LIMIARES['sup-pilula-em-tudo'];
  return agregarPaginas(ctx, (p) => {
    const es = dados ? paginaCss(dados, p)?.computado : null;
    const amb = ambienteDaPagina(ctx, p);
    if (!es && !amb) return null;
    const nComputado = soma(Object.entries(es?.raios?.porTipo?.card || {}).filter(([k]) => parseFloat(k) >= L.raioPilulaPx).map(([, n]) => n));
    const lista = [];
    if (amb) {
      for (const el of amb.arv.todos) {
        if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || ehControle(el)) continue;
        const curto = textoTotal(el);
        if (curto.length > 0 && curto.length <= 28 && !el.filhos.length) continue; // etiqueta curta (texto de poucas palavras): é assunto de cor-pills, não de cartão
        const r = amb.proprio(el, ['border-radius']);
        const raio = r ? raioDe(r.valor) : null;
        const porClasse = el.classes.some((c) => /^(?:[\w-]+:)*rounded-(2xl|3xl|full)$/.test(c));
        const porCss = !!(raio && raio.px != null && raio.px >= LIMIARES['cor-pills-multicoloridas'].raioPilulaPx);
        if (!porClasse && !porCss) continue;
        const w = comprimentoPx(amb.proprio(el, ['width'])?.valor), h = comprimentoPx(amb.proprio(el, ['height'])?.valor);
        const tok = (re) => { for (const c of el.classes) { const m = re.exec(c.slice(c.lastIndexOf(':') + 1)); if (m) return parseFloat(m[1]) * 4; } return null; };
        const tam = [w, h, tok(/^w-(\d+(?:\.\d+)?)$/), tok(/^h-(\d+(?:\.\d+)?)$/), tok(/^size-(\d+(?:\.\d+)?)$/)].filter((x) => x != null);
        if (tam.length && Math.max(...tam) <= L.tamanhoIgnoradoPx) continue; // avatar/ícone
        lista.push({ el, porClasse, porCss });
      }
    }
    const n = Math.max(nComputado, lista.length);
    if (n < L.minimoElementos) return resultado(false, 0);
    const evidencias = lista.slice(0, 5).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `${x.el.tag}${x.el.classes.length ? '.' + x.el.classes.slice(0, 3).join('.') : ''}: ${x.porCss ? 'border-radius de pílula' : 'classe rounded'}`, valor: 'pílula', visivel: true }));
    if (nComputado) evidencias.push(ev({ pagina: p.url, trecho: `${nComputado} cartões com raio de ${L.raioPilulaPx}px ou mais`, valor: nComputado, contagem: nComputado }));
    const citacoes = [...lista.slice(0, 3).map((x) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, x.el, 130))), citarRegex(ctx, p, 'css', /border-radius\s*:\s*(9{3,}\d*px|999px|50%)/)];
    return resultado(true, n / L.elementosParaSaturar, [achadoDe({ pagina: p.url, mensagem: `${n} cartões, caixas ou imagens (fora botões e etiquetas) têm cantos de pílula ou muito arredondados. Quando tudo é redondo, o formato deixa de dizer algo.`, evidencias, citacoes })]);
  });
});

const supCardDentroDeCard = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const L = LIMIARES['sup-card-dentro-de-card'];
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const a = es.cards.aninhados;
    if (a.total < L.minimoAninhados) return resultado(false, 0);
    const pares = a.pares || [];
    const evidencias = pares.slice(0, 5).map((x) => ev({ pagina: p.url, seletor: x.filho, trecho: `cartão dentro de cartão (${x.pai})`, valor: x.pai, visivel: true }));
    evidencias.push(ev({ pagina: p.url, trecho: `${a.total} cartões aninhados entre ${es.cards.total} cartões`, valor: a.total, contagem: a.total }));
    const citacoes = [];
    for (const x of pares.slice(0, 2)) citacoes.push(citarTextoDoSeletor(ctx, p, x.filho), citarTextoDoSeletor(ctx, p, x.pai));
    return resultado(true, escala(a.total, { base: 0.4, passo: 0.2 }), [achadoDe({ pagina: p.url, mensagem: `Cartões com moldura própria dentro de outro cartão também emoldurado: ${a.total}, entre ${es.cards.total} cartões medidos. A moldura dupla pesa e confunde a hierarquia.`, evidencias, citacoes })]);
  });
});

const supCardShadcn = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  const L = LIMIARES['sup-card-shadcn-padrao'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const trio = amb.arv.todos.filter((el) => L.trioClasses.every((c) => el.classes.includes(c)));
    const pag = corpusDe(ctx).get(p.url)?.final;
    const css = pag?.css || '';
    const tokens = /--radius\s*:\s*0?\.5rem/.test(css) && /--card-foreground\s*:/.test(css) && /--card\s*:/.test(css) && /--popover\s*:/.test(css);
    if (!trio.length && !tokens) return resultado(false, 0);
    const totalCards = dados ? paginaCss(dados, p)?.computado?.cards?.total : null;
    const evidencias = trio.slice(0, 4).map((el) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, el), trecho: `class="${el.attrs.class}"`, valor: el.attrs.class, visivel: true }));
    if (tokens) evidencias.push(ev({ pagina: p.url, trecho: 'variáveis do tema padrão do shadcn no CSS (--radius: 0.5rem, --card, --card-foreground, --popover)', valor: '--radius: 0.5rem' }));
    const citacoes = [...trio.slice(0, 2).map((el) => citarSeExiste(ctx, p, 'html', el.attrs.class)), ...(tokens ? [citarRegex(ctx, p, 'css', /--radius\s*:\s*0?\.5rem/), citarRegex(ctx, p, 'css', /--card-foreground\s*:\s*[^;{}]+/)] : [])];
    const intensidade = trio.length ? (totalCards ? trio.length / Math.max(totalCards, trio.length) : 1) : 0.5;
    return resultado(true, Math.max(intensidade, 0.5), [achadoDe({ pagina: p.url, mensagem: `${trio.length ? `Cartões com a combinação de classes: ${trio.length}, igual à de fábrica do shadcn (borda fina, fundo de cartão, sombra pequena, cantos de 0,5rem)` : 'O CSS traz as variáveis do tema padrão do shadcn (raio de 0,5rem, cartão, popover)'}. Confirmar no visual se o cartão se distingue do exemplo da documentação.`, evidencias, citacoes })]);
  });
});

const supBordaLateral = detector(({ ctx }) => {
  const L = LIMIARES['sup-borda-lateral-colorida'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const achados = [];
    for (const el of amb.arv.todos) {
      if (!['div', 'li', 'section', 'article', 'aside', 'blockquote', 'p', 'details', 'figure', 'dd', 'td'].includes(el.tag) || dentroDe(el, ['nav', 'svg'])) continue;
      const esq = bordaDoLado(amb, el, 'left');
      if (esq.w < L.espessuraMinimaPx || !esq.cor || croma(esq.cor) < L.cromaMinimo) continue;
      const outros = ['top', 'right', 'bottom'].map((l) => bordaDoLado(amb, el, l));
      if (outros.some((o) => o.w > L.outrosLadosMaximoPx)) continue;
      achados.push({ el, esq });
    }
    if (!achados.length) return resultado(false, 0);
    const evidencias = achados.slice(0, 5).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `${x.el.tag}: borda esquerda de ${x.esq.w}px na cor ${x.esq.cor}`, valor: x.esq.cor, visivel: true }));
    const citacoes = [...achados.slice(0, 3).map((x) => (x.esq.texto ? citarSeExiste(ctx, p, 'css', x.esq.texto) || citarSeExiste(ctx, p, 'html', x.esq.texto) : null)), ...achados.slice(0, 2).map((x) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, x.el, 130)))];
    return resultado(true, escala(achados.length), [achadoDe({ pagina: p.url, mensagem: `Faixa colorida grossa (${achados[0].esq.w}px) só no lado esquerdo em ${achados.length} elemento(s) (cartões, itens de lista ou avisos). Decoração muito repetida; um ícone ou fundo suave resolve melhor.`, evidencias, citacoes })]);
  });
});

const supSombraDura = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const amb = ambienteDaPagina(ctx, p);
    const camadas = (es.sombras.detalhes || []).filter((d) => !d.inset && d.blur === 0 && d.x !== 0 && d.y !== 0);
    const n = Math.min(soma(camadas.map((d) => d.elementos)), es.sombras.elementos || 0);
    if (n < 1) return resultado(false, 0);
    const evidencias = camadas.slice(0, 4).map((d) => ev({ pagina: p.url, trecho: `box-shadow ${d.raw}`, valor: `${d.x}px ${d.y}px sem desfoque`, contagem: d.elementos, visivel: true }));
    const citacoes = [];
    if (amb) for (const r of amb.css.regras) { const d = r.decls.find((x) => x.prop === 'box-shadow' && camadasSombra(x.valor).some((c) => !c.inset && c.blur === 0 && c.x !== 0 && c.y !== 0)); if (d) { citacoes.push(citarSeExiste(ctx, p, 'css', d.texto)); break; } }
    if (!semNulos(citacoes).length) citacoes.push(citarRegex(ctx, p, 'css', /box-shadow\s*:\s*-?[1-9]\d*px\s+-?[1-9]\d*px\s+0(px)?\b[^;{}]*/));
    return resultado(true, escala(n, { base: 0.4, passo: 0.15 }), [achadoDe({ pagina: p.url, mensagem: `${n} elemento(s) com sombra dura deslocada e sem desfoque (${camadas[0]?.raw ?? ''}). Estilo válido quando o site inteiro é assim; fora disso parece enfeite solto.`, evidencias, citacoes })]);
  });
});

const supCardsIrmaos = detector(({ ctx }) => {
  const L = LIMIARES['sup-cards-irmaos-inconsistentes'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const assinatura = (el) => {
      const r = amb.proprio(el, ['border-radius'])?.valor?.trim() || '';
      const s = amb.proprio(el, ['box-shadow'])?.valor?.trim() || '';
      const b = ['top', 'right', 'bottom', 'left'].map((l) => bordaDoLado(amb, el, l).w).join('/');
      return { r, s, b, vazio: !r && !s && b === '0/0/0/0' };
    };
    const grupos = [];
    const pais = [amb.arv.corpo, ...amb.arv.todos].filter(Boolean);
    for (const pai of new Set(pais)) {
      const filhos = pai.filhos.filter((c) => !TAGS_NAO_VISUAIS.has(c.tag) && !emSvg(c));
      if (filhos.length < L.minimoIrmaos) continue;
      const porToken = new Map();
      for (const f of filhos) for (const c of f.classes) { if (!porToken.has(c)) porToken.set(c, []); porToken.get(c).push(f); }
      const usados = new Set();
      for (const [token, lista] of [...porToken.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const livres = lista.filter((f) => !usados.has(f));
        if (livres.length < L.minimoIrmaos) continue;
        livres.forEach((f) => usados.add(f));
        const comparaveis = livres.filter((f) => !f.classes.some((c) => L.regexDestaque.test(c)));
        if (comparaveis.length < L.minimoIrmaos) continue;
        const sigs = comparaveis.map((f) => ({ f, ...assinatura(f) }));
        if (sigs.every((s) => s.vazio)) continue;
        const contagem = new Map();
        for (const s of sigs) { const k = `${s.r}|${s.s}|${s.b}`; contagem.set(k, (contagem.get(k) || 0) + 1); }
        const [kMax, nMax] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
        grupos.push({ pai, token, sigs, kMax, nMax, total: sigs.length, inconsistente: contagem.size > 1 });
      }
    }
    if (!grupos.length) return resultado(false, 0);
    const ruins = grupos.filter((g) => g.inconsistente);
    if (!ruins.length) return resultado(false, 0);
    const fora = soma(grupos.map((g) => g.total - g.nMax));
    const total = soma(grupos.map((g) => g.total));
    const g = ruins[0];
    const outros = g.sigs.filter((s) => `${s.r}|${s.s}|${s.b}` !== g.kMax);
    const evidencias = ruins.slice(0, 4).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.pai), trecho: `${x.total} irmãos com a classe "${x.token}": ${x.total - x.nMax} fora do valor mais comum`, valor: x.token, contagem: x.total }));
    for (const s of outros.slice(0, 3)) evidencias.push(ev({ pagina: p.url, seletor: seletorDe(amb.arv, s.f), trecho: `raio ${s.r || '(nenhum)'}; sombra ${s.s || '(nenhuma)'}; borda ${s.b}`, valor: `${s.r}|${s.s}|${s.b}`, visivel: true }));
    const citacoes = [...outros.slice(0, 2).map((s) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, s.f, 130))), citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, g.sigs.find((s) => `${s.r}|${s.s}|${s.b}` === g.kMax).f, 130))];
    return resultado(true, fora / total, [achadoDe({ pagina: p.url, mensagem: `Em ${ruins.length} grupo(s) de cartões irmãos (mesma classe-base), raio, sombra ou borda diferem entre peças que deveriam ser iguais: ${fora} de ${total} irmãos fogem do valor mais comum.`, evidencias, citacoes })]);
  });
});

// funções de gradiente de um valor de background, com o corpo balanceado
function funcoesGradiente(valor) {
  const out = [];
  const re = /(repeating-)?(linear|radial|conic)-gradient\(/gi;
  let m;
  const v = String(valor || '');
  while ((m = re.exec(v))) {
    let i = re.lastIndex, nivel = 1;
    while (i < v.length && nivel > 0) { if (v[i] === '(') nivel++; else if (v[i] === ')') nivel--; i++; }
    out.push({ repetido: !!m[1], tipo: m[2].toLowerCase(), corpo: v.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}
const supFundoGrade = detector(({ ctx }) => {
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const achados = [];
    const verifica = (valor, decls, seletor, texto) => {
      const fs = funcoesGradiente(valor);
      const grade = fs.some((g) => g.repetido || (g.tipo === 'linear' && /\b1px\b/.test(g.corpo)) || (g.tipo === 'radial' && /circle/i.test(g.corpo) && /\b1px\b/.test(g.corpo)));
      const tamanho = decls.find((d) => d.prop === 'background-size' && /\d+(\.\d+)?px/i.test(d.valor)) || (/background-size/i.test(texto) ? { valor: 'inline' } : null);
      if (grade && tamanho) achados.push({ seletor, decl: texto });
    };
    for (const r of amb.css.regras) for (const d of r.decls) if (d.prop === 'background' || d.prop === 'background-image') verifica(d.valor, r.decls, r.seletorTxt, d.texto);
    for (const el of amb.arv.todos) if (el.attrs.style && /gradient\(/i.test(el.attrs.style)) { const decls = dividirTopo(el.attrs.style, ';').map((t) => { const i = t.indexOf(':'); return { prop: t.slice(0, i).trim().toLowerCase(), valor: t.slice(i + 1).trim() }; }); const d = decls.find((x) => x.prop === 'background' || x.prop === 'background-image'); if (d) verifica(d.valor, decls, seletorDe(amb.arv, el), el.attrs.style); }
    const padroes = amb.arv.todos.filter((e) => e.tag === 'pattern' && dentroDe(e, ['svg']));
    const n = achados.length + padroes.length;
    if (!n) return resultado(false, 0);
    const evidencias = achados.slice(0, 4).map((a) => ev({ pagina: p.url, seletor: a.seletor, trecho: a.decl, valor: 'grade ou pontos em CSS' }));
    for (const e of padroes.slice(0, 2)) evidencias.push(ev({ pagina: p.url, seletor: seletorDe(amb.arv, e), trecho: trechoHtml(amb.arv, e, 120), valor: 'SVG de padrão' }));
    const citacoes = [...achados.slice(0, 3).map((a) => citarSeExiste(ctx, p, 'css', a.decl) || citarSeExiste(ctx, p, 'html', a.decl)), ...padroes.slice(0, 1).map((e) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, e, 100)))];
    return resultado(true, escala(n, { base: 0.5, passo: 0.25 }), [achadoDe({ pagina: p.url, mensagem: `${n} fundo(s) decorativo(s) em grade de linhas finas ou pontos (gradiente de 1px com tamanho em px, ou SVG de padrão). Confirmar se é textura enfeite ou parte do conteúdo.`, evidencias, citacoes })]);
  });
});

const supNavegadorSemTema = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  const est = estaticoDoSite(dados);
  if (!est) return null;
  if (est.arquivos?.comErroParse?.length && !est.bytes) return null;
  const pc = (ctx.paginas || [])[0];
  const declaraPaleta = (est.propriedadesCustom?.comCor || 0) > 0;
  const nenhum = !est.temaNativo?.selection && !est.temaNativo?.caretColor && !est.temaNativo?.scrollbarColor;
  if (!declaraPaleta || !nenhum) return resultado(false, 0);
  const citacoes = [citarRegex(ctx, pc, 'css', /--[\w-]+\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/)];
  return resultado(true, 1, [achadoDe({ pagina: pc.url, mensagem: 'O site declara variáveis de cor (paleta própria), mas não define cor para a seleção de texto (::selection), o cursor de digitação (caret-color) nem a barra de rolagem (scrollbar-color). Detalhe fino de acabamento.', evidencias: [ev({ pagina: pc.url, trecho: `${est.propriedadesCustom.comCor} variáveis com cor; ::selection, caret-color e scrollbar-color ausentes`, valor: 0, contagem: 0 })], citacoes })]);
});

const supRaioAninhado = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  return agregarPaginas(ctx, (p) => {
    const es = dados ? paginaCss(dados, p)?.computado : null;
    const amb = ambienteDaPagina(ctx, p);
    if (!es && !amb) return null;
    const erros = [];
    let pares = 0;
    if (amb) {
      for (const el of amb.arv.todos) {
        if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || ehControle(el) || ['img', 'a', 'span', 'i'].includes(el.tag)) continue;
        const raio = (e) => { const r = amb.proprio(e, ['border-radius']); const x = r ? raioDe(r.valor) : null; return x && x.px != null && x.px > 0 && x.px < LIMIARES['cor-pills-multicoloridas'].raioPilulaPx ? { px: x.px, texto: r.texto } : null; };
        const rf = raio(el);
        if (!rf) continue;
        const temFundoOuBorda = !!amb.proprio(el, ['background-color', 'background']) || bordaDoLado(amb, el, 'left').w > 0;
        if (!temFundoOuBorda) continue;
        let pai = el.pai, rp = null;
        for (; pai && pai.tag !== '#raiz'; pai = pai.pai) { rp = raio(pai); if (rp) break; }
        if (!rp) continue;
        pares++;
        if (rf.px > rp.px) erros.push({ el, pai, rf, rp });
      }
    }
    const nComp = es?.cards?.aninhados?.raioFilhoMaiorQuePai || 0;
    const n = Math.max(erros.length, nComp);
    if (n < 1) return resultado(false, 0);
    const evidencias = erros.slice(0, 5).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `raio do filho ${x.rf.px}px maior que o do pai ${x.rp.px}px (${seletorDe(amb.arv, x.pai)})`, valor: `${x.rf.px}>${x.rp.px}`, visivel: true }));
    if (nComp) evidencias.push(ev({ pagina: p.url, trecho: `${nComp} cartões aninhados com raio maior que o do cartão de fora`, valor: nComp, contagem: nComp }));
    const citacoes = [];
    for (const x of erros.slice(0, 2)) citacoes.push(citarSeExiste(ctx, p, 'css', x.rf.texto) || citarSeExiste(ctx, p, 'html', x.rf.texto), citarSeExiste(ctx, p, 'css', x.rp.texto) || citarSeExiste(ctx, p, 'html', x.rp.texto));
    if (!semNulos(citacoes).length) citacoes.push(citarRegex(ctx, p, 'css', /border-radius\s*:\s*[^;{}]+/));
    return resultado(true, clamp01(n / Math.max(pares, es?.cards?.aninhados?.total || 0, n)), [achadoDe({ pagina: p.url, mensagem: `Cantos de dentro mais arredondados que os da caixa de fora em ${n} elemento(s). Os cantos de dentro deveriam seguir o desenho da caixa de fora.`, evidencias, citacoes })]);
  });
});

const supMolduraJanela = detector(({ ctx }) => {
  const L = LIMIARES['sup-moldura-de-janela-falsa'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const porClasse = [];
    for (const el of amb.arv.todos) {
      const txt = `${el.attrs.class || ''} ${el.id || ''}`;
      const m = L.regexClasseBarra.exec(txt) || L.regexClasseAparelho.exec(txt);
      if (m) porClasse.push({ el, trecho: m[0] });
    }
    const circulos = [];
    for (const pai of amb.arv.todos) {
      if (pai.filhos.length < 3 || pai.filhos.length > 8) continue;
      const fam = new Map();
      for (const f of pai.filhos) {
        const w = comprimentoPx(amb.proprio(f, ['width'])?.valor), h = comprimentoPx(amb.proprio(f, ['height'])?.valor);
        if (w == null || h == null || w > L.circuloMaximoPx || h > L.circuloMaximoPx) continue;
        const r = raioDe(amb.proprio(f, ['border-radius'])?.valor);
        if (!r || !((r.pct != null && r.pct >= 50) || (r.px != null && r.px >= Math.min(w, h) / 2))) continue;
        const bg = parseCor(amb.proprio(f, ['background-color', 'background'])?.valor || '');
        const familia = bg ? familiaDeCor(bg.hex, 0.05) : null;
        if (familia) fam.set(familia, f);
      }
      if (fam.has('vermelho') && fam.has('verde') && (fam.has('amarelo') || fam.has('âmbar') || fam.has('laranja'))) circulos.push(pai);
    }
    if (!porClasse.length && !circulos.length) return resultado(false, 0);
    const evidencias = [...circulos.slice(0, 2).map((e) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, e), trecho: 'três círculos pequenos vermelho, amarelo e verde lado a lado (bolinhas de janela)', valor: 'bolinhas de janela', visivel: true })), ...porClasse.slice(0, 3).map((x) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, x.el), trecho: `classe/id "${x.trecho}"`, valor: x.trecho }))];
    const citacoes = [...circulos.slice(0, 1).map((e) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, e, 150))), ...porClasse.slice(0, 2).map((x) => citarSeExiste(ctx, p, 'html', x.trecho))];
    return resultado(true, circulos.length ? 1 : 0.6, [achadoDe({ pagina: p.url, mensagem: `A página monta uma moldura de janela de navegador, terminal ou aparelho com código (${circulos.length ? 'três bolinhas coloridas' : 'classes de barra de janela ou de aparelho'}). Confirmar se o conteúdo dentro é uma captura real ou um desenho.`, evidencias, citacoes })]);
  });
});

// =====================================================================================================================
// ICONOGRAFIA
// =====================================================================================================================
// mesma ideia do extrator de estilos: emoji "pictográfico" (com variações e sequências ZWJ); exclui ©, ®, ™, setas e marcas simples
const RE_EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*/gu;
const RE_EMOJI_EXCLUIR = /^[©®™‼⁉←-⇿⤴⤵⬅-⬇➡➔✓✔✖]/u;
const emojisDe = (texto) => (String(texto).match(RE_EMOJI) || []).filter((x) => !RE_EMOJI_EXCLUIR.test(x));
const nosVisiveis = (p) => (p.final?.extr?.nos || []).filter((n) => n.visivel && !n.clone);
// mesma conta do verificador ('ocorrencias-visiveis'): soma das ocorrências do texto normalizado nos nós visíveis
const ocorrenciasVisiveis = (p, alvo) => { const a = normalizarTexto(alvo); return a ? nosVisiveis(p).reduce((s, n) => s + (normalizarTexto(n.texto).split(a).length - 1), 0) : 0; };

const iconeEmoji = detector(({ ctx }) => {
  const L = LIMIARES['icone-emoji-como-icone'];
  return agregarPaginas(ctx, (p) => {
    if (!p.final?.extr) return null;
    const achados = [];
    for (const n of nosVisiveis(p)) for (const e of emojisDe(n.texto)) achados.push({ seletor: n.seletor, tag: n.tag, emoji: e, texto: n.texto });
    if (achados.length < L.minimoEmojis) return resultado(false, 0);
    const distintos = unicos(achados.map((a) => a.emoji));
    const titulos = (p.final.extr.headings || []).filter((h) => h.visivel && !h.clone && h.nivel <= 4);
    const titulosComEmoji = unicos(achados.filter((a) => /^h[1-4]$/.test(a.tag)).map((a) => a.seletor)).length;
    const fracTitulos = titulos.length ? titulosComEmoji / titulos.length : 0;
    const evidencias = achados.slice(0, 8).map((a) => ev({ pagina: p.url, seletor: a.seletor, trecho: `${a.tag}: ${cortar(a.texto, 60)}`, valor: a.emoji, visivel: true }));
    const citacoes = [];
    for (const e of distintos.slice(0, 3)) {
      citacoes.push(citarSeExiste(ctx, p, 'visivel', e));
      citacoes.push({ tipo: 'contagem', contagem: { fn: 'ocorrencias-visiveis', texto: e, esperado: ocorrenciasVisiveis(p, e) }, versoes: ['final'], pagina: p.url });
    }
    const intensidade = Math.max(achados.length / L.emojisParaSaturar, fracTitulos);
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `${achados.length} emojis fazem o papel de ícone em títulos, botões, links e cartões (${distintos.slice(0, 6).join(' ')}). O desenho muda de aparelho para aparelho.`, evidencias, citacoes })]);
  });
});

const RE_SPARKLE_CLASSES = [/^(lucide-)?(sparkles|wand2?|magic-?wand|robot|brain|braincircuit|cpu|bot)$/i, /^(fa-)?(wand-magic-sparkles|wand-sparkles|robot|brain|microchip)$/i, /^bi-(stars|robot|cpu)$/i, /^ph-(sparkle|sparkles|robot|brain|magic-wand)(-[a-z]+)?$/i, /^ti-(sparkles|robot|brain|wand)$/i, /^icon-(sparkles?|robot|brain)$/i];
const RE_SPARKLE_COMPONENTES = /<\s*(Sparkles|Wand2|Wand|BrainCircuit|Brain|Bot|Cpu|Stars|MagicWand)\b/g;
const iconeSparkle = detector(({ ctx }) => {
  const L = LIMIARES['icone-sparkle-ia'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb && !p.final?.extr) return null;
    const achados = [];
    for (const n of nosVisiveis(p)) for (const e of L.emojis) if (n.texto.includes(e)) achados.push({ tipo: 'emoji', trecho: e, seletor: n.seletor, onde: 'visivel' });
    if (amb) {
      for (const el of amb.arv.todos) {
        for (const c of el.classes) { const t = c.slice(c.lastIndexOf(':') + 1); if (RE_SPARKLE_CLASSES.some((r) => r.test(t))) achados.push({ tipo: 'classe de ícone', trecho: c, seletor: seletorDe(amb.arv, el), onde: 'html' }); }
        for (const a of ['data-lucide', 'data-feather', 'data-icon', 'data-lucide-icon']) { const v = el.attrs[a]; if (v && /^(sparkles?|wand2?|magic-?wand|robot|brain|cpu|bot|stars)$/i.test(v)) achados.push({ tipo: 'atributo de ícone', trecho: `${a}="${v}"`, seletor: seletorDe(amb.arv, el), onde: 'html' }); }
        if (el.classes.some((c) => /material-(icons|symbols)/.test(c)) && /^(auto_awesome|smart_toy|psychology|magic_button)$/.test(textoTotal(el))) achados.push({ tipo: 'ícone Material', trecho: textoTotal(el), seletor: seletorDe(amb.arv, el), onde: 'visivel' });
      }
      for (const m of amb.arv.html.matchAll(RE_SPARKLE_COMPONENTES)) achados.push({ tipo: 'componente de ícone', trecho: m[0], seletor: null, onde: 'html' });
    }
    if (!achados.length) return resultado(false, 0);
    const evidencias = achados.slice(0, 6).map((a) => ev({ pagina: p.url, seletor: a.seletor ?? undefined, trecho: `${a.tipo}: ${a.trecho}`, valor: a.trecho, visivel: a.onde === 'visivel' ? true : undefined }));
    const citacoes = achados.slice(0, 4).map((a) => citarSeExiste(ctx, p, a.onde, a.trecho));
    const nomes = unicos(achados.map((a) => a.trecho)).slice(0, 4).join(', ');
    return resultado(true, escala(achados.length, { base: 0.6, passo: 0.2 }), [achadoDe({ pagina: p.url, mensagem: `A página usa ícone de faíscas, varinha, robô ou cérebro (${nomes}) como símbolo de recurso ou de marca. É um desenho muito repetido, que não diz nada específico sobre o produto.`, evidencias, citacoes })]);
  });
});

const BIBLIOTECAS_ICONES = {
  'Material Icons': /material-icons|material-symbols/i,
  'Heroicons': /heroicon/i,
  'Lucide': /lucide/i,
  'Phosphor': /phosphor|\bph-(bold|fill|light|duotone|[a-z]+-[a-z]+)/i,
  'Font Awesome': /font-?awesome|\bfa-(solid|regular|brands|light)\b/i,
  'Feather': /feather-icons|\bfeather\b/i,
  'Tabler': /tabler-icons/i,
  'Bootstrap Icons': /bootstrap-icons|\bbi-[a-z]/i,
};
const iconeBibliotecas = detector(({ ctx }) => {
  const L = LIMIARES['icone-bibliotecas-misturadas'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const blob = amb.arv.todos.map((e) => Object.values(e.attrs).join(' ')).join(' ').toLowerCase();
    const css = corpusDe(ctx).get(p.url)?.final?.css || '';
    const achadas = [];
    for (const [nome, re] of Object.entries(BIBLIOTECAS_ICONES)) {
      const noHtml = re.exec(blob), noCss = re.exec(css);
      if (!noHtml && !noCss) continue;
      if (nome === 'Font Awesome') { // marca de rede social (fa-brands) em até duas posições não conta como biblioteca de ícones
        const comuns = amb.arv.todos.filter((e) => e.classes.some((c) => /^(fa-(solid|regular|light|thin|duotone|sharp)|fas|far|fal|fad)$/.test(c)));
        const marcas = amb.arv.todos.filter((e) => e.classes.some((c) => /^(fa-brands|fab)$/.test(c)));
        if (!comuns.length && marcas.length > 0 && marcas.length <= L.marcaTerceirosMaximo) continue;
      }
      achadas.push({ nome, re, onde: noHtml ? 'html' : 'css', trecho: (noHtml || noCss)[0] });
    }
    if (achadas.length < L.minimoBibliotecas) return resultado(false, 0);
    const evidencias = achadas.map((a) => ev({ pagina: p.url, trecho: `${a.nome}: "${a.trecho}" no ${a.onde === 'html' ? 'HTML' : 'CSS'}`, valor: a.nome }));
    const citacoes = achadas.slice(0, 4).map((a) => citarSeExiste(ctx, p, a.onde, a.trecho));
    return resultado(true, (achadas.length - 1) / 3, [achadoDe({ pagina: p.url, mensagem: `A página mistura ${achadas.length} bibliotecas de ícones (${achadas.map((a) => a.nome).join(', ')}), com traços e pesos que não combinam.`, evidencias, citacoes })]);
  });
});

const numeroOuNull = (v) => { const t = String(v ?? '').trim(); if (/^[d.]+$/.test(t)) return parseFloat(t); return comprimentoPx(t); }; // atributo width="24" (sem unidade) vale px
// tamanho declarado de um svg (px): atributos width/height, depois mini-cascata. { w, h }
function tamanhoDeclarado(amb, el) {
  const w = numeroOuNull(el.attrs.width) ?? comprimentoPx(amb.proprio(el, ['width'])?.valor);
  const h = numeroOuNull(el.attrs.height) ?? comprimentoPx(amb.proprio(el, ['height'])?.valor);
  return { w, h };
}
const iconeTamanhosETracos = detector(({ ctx }) => {
  const L = LIMIARES['icone-tamanhos-e-tracos-soltos'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const icones = [];
    for (const el of amb.arv.todos.filter((e) => e.tag === 'svg' && !dentroDe(e, ['svg']))) {
      const { w, h } = tamanhoDeclarado(amb, el);
      const lado = Math.max(w ?? 0, h ?? 0);
      if (!lado || lado > L.tamanhoMaximoIconePx) continue;
      let stroke = el.attrs['stroke-width'] ?? amb.valorDe(el, 'stroke-width', { herdar: false });
      if (stroke == null) { const f = descendentes(el).find((d) => d.attrs['stroke-width'] != null); stroke = f ? f.attrs['stroke-width'] : null; }
      icones.push({ el, lado: arred(lado, 1), stroke: stroke != null ? String(parseFloat(stroke)) : null });
    }
    if (icones.length < 2) return resultado(false, 0);
    const strokes = unicos(icones.map((i) => i.stroke).filter((s) => s && s !== 'NaN'));
    const tamanhos = unicos(icones.map((i) => i.lado));
    const muitosTracos = strokes.length > L.maximoStrokeWidthDistintos, muitosTamanhos = tamanhos.length > L.maximoTamanhosDistintos;
    if (!muitosTracos && !muitosTamanhos) return resultado(false, 0);
    const partes = [];
    if (muitosTracos) partes.push(`${strokes.length} espessuras de traço diferentes (${strokes.join(', ')})`);
    if (muitosTamanhos) partes.push(`${tamanhos.length} tamanhos diferentes (${tamanhos.map((t) => t + 'px').join(', ')})`);
    const evidencias = icones.slice(0, 6).map((i) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, i.el), trecho: `svg ${i.lado}px, traço ${i.stroke ?? '(não declarado)'}`, valor: i.lado, visivel: true }));
    const distintos = [];
    for (const k of (muitosTracos ? strokes : tamanhos)) distintos.push(icones.find((i) => (muitosTracos ? i.stroke : i.lado) === k));
    const citacoes = distintos.slice(0, 3).map((i) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, i.el, 150)));
    const intensidade = Math.max(muitosTracos ? (strokes.length - 1) / 2 : 0, muitosTamanhos ? (tamanhos.length - 3) / 3 : 0);
    return resultado(true, intensidade, [achadoDe({ pagina: p.url, mensagem: `Os ícones SVG de até ${L.tamanhoMaximoIconePx}px variam sem critério: ${partes.join('; ')}.`, evidencias, citacoes })]);
  });
});

const iconeTileColorido = detector(({ ctx }) => {
  const L = LIMIARES['icone-em-tile-colorido'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const ehIcone = (e) => e.tag === 'svg' || (e.tag === 'i' && e.classes.length > 0) || (e.tag === 'span' && e.classes.some((c) => /icon|ph-|fa-|bi-|material/i.test(c)) && !textoTotal(e)) || e.tag === 'img';
    const tiles = [];
    for (const el of amb.arv.todos) {
      if (!['div', 'span', 'a'].includes(el.tag) || emSvg(el)) continue;
      const prox = irmaoSeguinte(el);
      if (!prox || !/^h[2-4]$/.test(prox.tag)) continue;
      if (textoTotal(el)) continue;
      const filhos = el.filhos.filter((c) => !emSvg(c) || c.tag === 'svg');
      if (filhos.length !== 1 || !ehIcone(filhos[0])) continue;
      const r = raioDe(amb.proprio(el, ['border-radius'])?.valor);
      if (!r || !((r.px != null && r.px > 0) || (r.pct != null && r.pct > 0))) continue;
      const bg = parseCor(amb.proprio(el, ['background-color', 'background'])?.valor || '');
      if (!bg || bg.a <= 0) continue;
      const suave = hexParaOklch(bg.hex).L >= 0.8 || bg.a < 0.5;
      if (!suave) continue;
      const w = comprimentoPx(amb.proprio(el, ['width'])?.valor), h = comprimentoPx(amb.proprio(el, ['height'])?.valor);
      if ((w != null && w > L.tamanhoMaximoPx) || (h != null && h > L.tamanhoMaximoPx)) continue;
      tiles.push({ el, titulo: prox, bg: bg.hex });
    }
    if (tiles.length < L.minimoRepeticoes) return resultado(false, 0);
    const titulos = (p.final?.extr?.headings || []).filter((h) => h.visivel && !h.clone && h.nivel >= 2 && h.nivel <= 4).length;
    const evidencias = tiles.slice(0, 5).map((t) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, t.el), trecho: `quadrado/moeda de cor suave (${t.bg}) com um ícone, acima de "${cortar(textoTotal(t.titulo), 40)}"`, valor: t.bg, visivel: true }));
    const citacoes = [...tiles.slice(0, 2).map((t) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, t.el, 150))), ...tiles.slice(0, 2).map((t) => citarTextoVisivel(ctx, p, textoTotal(t.titulo)))];
    return resultado(true, tiles.length / Math.max(titulos, tiles.length), [achadoDe({ pagina: p.url, mensagem: `${tiles.length} cartões repetem a receita de ícone dentro de quadrado ou moeda de cor suave acima do título.`, evidencias, citacoes })]);
  });
});

const iconeIlustracaoSvg = detector(({ ctx }) => {
  const L = LIMIARES['icone-ilustracao-svg-desenhada'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const ilus = [];
    for (const el of amb.arv.todos.filter((e) => e.tag === 'svg' && !dentroDe(e, ['svg', 'header', 'nav', 'footer', 'button', 'a']))) {
      const { w, h } = tamanhoDeclarado(amb, el);
      const vb = (el.attrs.viewbox || '').trim().split(/[\s,]+/).map(Number);
      let grande;
      if (w != null || h != null) { const lado = Math.max(w ?? 0, h ?? 0); if (lado <= L.orcamentoIconePx) continue; grande = lado >= L.tamanhoMinimoPx; }
      else grande = vb.length === 4 && Math.max(vb[2], vb[3]) >= L.tamanhoMinimoPx;
      if (!grande) continue;
      const desc = descendentes(el);
      if (desc.some((d) => d.tag === 'text')) continue;
      const curvas = soma(desc.filter((d) => d.tag === 'path').map((d) => (d.attrs.d || '').match(/[CcSsQqTtAa]/g)?.length || 0)) + desc.filter((d) => ['circle', 'ellipse'].includes(d.tag)).length;
      const fills = unicos(desc.map((d) => d.attrs.fill).filter((f) => f && !/^(none|currentcolor|inherit)$/i.test(f)));
      if (curvas < L.minimoCurvasOuPreenchimentos && fills.length < L.minimoCurvasOuPreenchimentos) continue;
      ilus.push({ el, curvas, fills: fills.length, topo: el.ini / Math.max(1, amb.arv.html.length) < 0.25 });
    }
    if (!ilus.length) return resultado(false, 0);
    const evidencias = ilus.slice(0, 4).map((i) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, i.el), trecho: `svg grande, ${i.curvas} curvas, ${i.fills} preenchimentos distintos, sem texto${i.topo ? ' (perto do topo da página)' : ''}`, valor: i.curvas, contagem: i.curvas, visivel: true }));
    const citacoes = ilus.slice(0, 3).map((i) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, i.el, 150)));
    return resultado(true, ilus.some((i) => i.topo) ? 1 : 0.6, [achadoDe({ pagina: p.url, mensagem: `Há ${ilus.length} ilustração(ões) em SVG inline, grande, com várias curvas ou cores e sem texto${ilus.some((i) => i.topo) ? ', uma delas perto do topo da página' : ''}. Costuma ficar simples e genérica.`, evidencias, citacoes })]);
  });
});

const iconeBancoGenerico = detector(({ ctx }) => {
  const L = LIMIARES['icone-ilustracao-de-banco-generica'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const achados = [];
    for (const el of amb.arv.todos) for (const [k, v] of Object.entries(el.attrs)) if (L.regex.test(v)) achados.push({ onde: 'html', valor: v, seletor: seletorDe(amb.arv, el), attr: k });
    for (const c of p.final?.extr?.comentarios || []) if (L.regex.test(c)) achados.push({ onde: 'html', valor: c, seletor: null, attr: 'comentário' });
    const css = corpusDe(ctx).get(p.url)?.final?.css || '';
    const mc = new RegExp(`url\\([^)]*(${L.regex.source})[^)]*\\)`, 'i').exec(css);
    if (mc) achados.push({ onde: 'css', valor: mc[0], seletor: null, attr: 'url() no CSS' });
    if (!achados.length) return resultado(false, 0);
    const marca = (a) => { const m = new RegExp(`[^\\s"'()<>]*(${L.regex.source})[^\\s"'()<>]*`, 'i').exec(a.valor); return m ? m[0] : null; };
    const evidencias = achados.slice(0, 4).map((a) => ev({ pagina: p.url, seletor: a.seletor ?? undefined, trecho: `${a.attr}: ${cortar(a.valor, 100)}`, valor: marca(a) ?? a.valor }));
    const citacoes = achados.slice(0, 3).map((a) => { const m = marca(a); return m ? citarSeExiste(ctx, p, a.onde, m) : null; });
    return resultado(true, 1, [achadoDe({ pagina: p.url, mensagem: `A página usa ilustração de banco de imagens gratuito conhecido (${unicos(achados.map(marca).filter(Boolean)).slice(0, 3).join(', ')}), usado em milhares de páginas e sem relação com a marca.`, evidencias, citacoes })]);
  });
});

const iconeLogoOrbe = detector(({ ctx }) => {
  const L = LIMIARES['icone-logo-gradiente-orbe'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const cab = amb.arv.todos.find((e) => e.tag === 'header') || amb.arv.todos.find((e) => e.tag === 'nav');
    const escopo = cab ? [cab, ...descendentes(cab)] : amb.arv.todos;
    const logo = escopo.find((e) => e.classes.some((c) => RE_LOGO.test(c))) || (cab ? descendentes(cab).find((e) => e.tag === 'a') : null);
    if (!logo) return null;
    const sub = [logo, ...descendentes(logo)];
    const sinais = new Map();
    for (const e of sub) {
      const bg = amb.proprio(e, ['background', 'background-image']);
      if (bg && /gradient\(/i.test(bg.valor) && !sinais.has('fundo em degradê')) sinais.set('fundo em degradê', { el: e, texto: bg.texto });
      const sh = amb.proprio(e, ['box-shadow']);
      if (sh && camadasSombra(sh.valor).some((c) => !c.inset && c.x === 0 && c.y === 0 && c.blur > 0 && c.cor && croma(c.cor) >= 0.04 && !sinais.has('brilho colorido'))) sinais.set('brilho colorido', { el: e, texto: sh.texto });
      const clip = amb.proprio(e, ['background-clip', '-webkit-background-clip']);
      if (clip && /text/i.test(clip.valor) && !sinais.has('nome com degradê no texto')) sinais.set('nome com degradê no texto', { el: e, texto: clip.texto });
      if (!sinais.has('ícone de faíscas') && (e.classes.some((c) => RE_SPARKLE_CLASSES.some((r) => r.test(c))) || /✨/.test(textoDireto(e)))) sinais.set('ícone de faíscas', { el: e, texto: /✨/.test(textoDireto(e)) ? '✨' : e.attrs.class });
    }
    if (sinais.size < L.minimoSinais) return resultado(false, 0);
    const evidencias = [...sinais.entries()].map(([nome, s]) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, s.el), trecho: `${nome}: ${cortar(s.texto, 90)}`, valor: nome, visivel: true }));
    const citacoes = [...sinais.values()].slice(0, 3).map((s) => citarSeExiste(ctx, p, 'css', s.texto) || citarSeExiste(ctx, p, 'html', s.texto) || citarSeExiste(ctx, p, 'visivel', s.texto));
    if (!semNulos(citacoes).length) citacoes.push(citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, logo, 130)));
    return resultado(true, sinais.size / 4, [achadoDe({ pagina: p.url, mensagem: `O logotipo (primeiro link do cabeçalho) combina ${sinais.size} sinais de marca de modelo: ${[...sinais.keys()].join(', ')}. Confirmar no visual se é uma bola brilhante ou tile de gradiente.`, evidencias, citacoes })]);
  });
});

const iconeBlocoVazio = detector(({ ctx }) => {
  const L = LIMIARES['icone-bloco-visual-vazio'];
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const MIDIA = ['img', 'picture', 'video', 'svg', 'canvas', 'iframe', 'object', 'embed'];
    const achados = [];
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || ['hr', 'br', 'img', 'input'].includes(el.tag)) continue;
      const vazio = !textoTotal(el) && !descendentes(el).some((d) => MIDIA.includes(d.tag));
      if (!vazio) continue;
      if (el.attrs['data-slot'] !== undefined) { achados.push({ el, motivo: `atributo data-slot="${el.attrs['data-slot']}" em bloco vazio` }); continue; }
      const bg = amb.proprio(el, ['background-color', 'background', 'background-image']);
      if (!bg || /url\(/i.test(bg.valor)) continue;
      const cor = /gradient\(/i.test(bg.valor) ? { a: 1 } : parseCor(bg.valor);
      if (!cor || cor.a <= 0.05) continue;
      const alt = Math.max(comprimentoPx(amb.proprio(el, ['height'])?.valor) ?? 0, comprimentoPx(amb.proprio(el, ['min-height'])?.valor) ?? 0);
      const larg = Math.max(comprimentoPx(amb.proprio(el, ['width'])?.valor) ?? 0, comprimentoPx(amb.proprio(el, ['min-width'])?.valor) ?? 0);
      const larguraNaoDeclarada = comprimentoPx(amb.proprio(el, ['width'])?.valor) == null && !amb.proprio(el, ['width']);
      if (alt >= L.alturaMinimaPx && (larg >= L.larguraMinimaPx || larguraNaoDeclarada)) achados.push({ el, motivo: `bloco de ${alt}px de altura só com ${/gradient\(/i.test(bg.valor) ? 'degradê' : 'cor de fundo'}, sem imagem, vídeo, SVG ou texto` });
    }
    if (!achados.length) return resultado(false, 0);
    const evidencias = achados.slice(0, 5).map((a) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, a.el), trecho: a.motivo, valor: a.el.tag, visivel: true }));
    const citacoes = achados.slice(0, 3).map((a) => citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, a.el, 150)));
    return resultado(true, escala(achados.length, { base: 0.6, passo: 0.2 }), [achadoDe({ pagina: p.url, mensagem: `Blocos grandes pensados para imagem ficaram só com cor ou degradê, sem foto, ilustração ou captura dentro: ${achados.length}. Parece página inacabada.`, evidencias, citacoes })]);
  });
});

const iconeSeloNovidade = detector(({ ctx }) => {
  const L = LIMIARES['icone-selo-novidade-com-emoji'];
  const RE_NOVIDADE = /(?<![\p{L}\d])(novo|new|introducing|beta|pro|lançamento|lancamento|versão|versao|v\d+)(?![\p{L}\d])/iu;
  return agregarPaginas(ctx, (p) => {
    const amb = ambienteDaPagina(ctx, p);
    if (!amb) return null;
    const h1 = amb.arv.todos.find((e) => e.tag === 'h1');
    const antesDoH1 = new Set();
    if (h1) { let e = h1; for (let i = 0; i < 3 && e && e.tag !== 'body'; i++, e = e.pai) { const a = irmaoAnterior(e); if (a) antesDoH1.add(a); } }
    const achados = [];
    for (const el of amb.arv.todos) {
      if (TAGS_NAO_VISUAIS.has(el.tag) || emSvg(el) || el.filhos.length > 4) continue;
      const t = textoTotal(el);
      if (!t || t.length > L.maxCaracteres) continue;
      if (!emojisDe(t).length || !RE_NOVIDADE.test(t)) continue;
      // evita contar pai e filho: fica o mais interno que contém emoji e palavra
      if (el.filhos.some((f) => { const tf = textoTotal(f); return tf && emojisDe(tf).length && RE_NOVIDADE.test(tf); })) continue;
      const r = raioDe(amb.proprio(el, ['border-radius'])?.valor);
      const pilula = (r && ((r.px != null && r.px >= 12) || (r.pct != null && r.pct > 0))) || el.classes.some((c) => /rounded|pill|badge|chip|tag|eyebrow|announce|new|novo/i.test(c));
      if (!pilula) continue;
      achados.push({ el, t, antes: [...antesDoH1].some((a) => a === el || descendentes(a).includes(el)) });
    }
    if (!achados.length) return resultado(false, 0);
    const evidencias = achados.slice(0, 5).map((a) => ev({ pagina: p.url, seletor: seletorDe(amb.arv, a.el), trecho: `selo "${a.t}"${a.antes ? ' logo antes do título principal' : ''}`, valor: a.t, visivel: true }));
    const citacoes = achados.slice(0, 3).flatMap((a) => [citarSeExiste(ctx, p, 'html', trechoHtml(amb.arv, a.el, 150)), ...emojisDe(a.t).slice(0, 1).map((e) => citarSeExiste(ctx, p, 'visivel', e))]);
    return resultado(true, achados.some((a) => a.antes) ? 1 : 0.7, [achadoDe({ pagina: p.url, mensagem: `Há ${achados.length} selo(s) de novidade com emoji (${achados.slice(0, 3).map((a) => `"${a.t}"`).join(', ')})${achados.some((a) => a.antes) ? ', um deles logo acima do título principal' : ''}. Enfeite de abertura que não informa nada concreto.`, evidencias, citacoes })]);
  });
});

// =====================================================================================================================
// regras de peso 0 / info (liberadas): só informam, nunca penalizam (peso_aplicado vem 0 da regra; intensidade 0)
// =====================================================================================================================
const infoModoEscuro = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es || !es.cores.temaEscuro) return resultado(false, 0);
    return { disparou: true, intensidade: 0, achados: [achadoDe({ pagina: p.url, mensagem: 'A página usa tema escuro. Isso, sozinho, não é sinal de visual genérico e não pontua; só os brilhos, degradês e neutros dentro dele têm regras próprias.', evidencias: [ev({ pagina: p.url, seletor: 'body', trecho: `fundo da página ${es.cores.paginaFundo?.hex}`, valor: es.cores.paginaFundo?.hex })], citacoes: [citarCor(ctx, p, String(es.cores.paginaFundo?.hex || '').slice(0, 7))] })] };
  });
});
const infoEstilosLiberados = detector(({ ctx, med }) => {
  const dados = dadosCss(med);
  if (!dados) return null;
  return agregarPaginas(ctx, (p) => {
    const es = paginaCss(dados, p)?.computado;
    if (!es) return null;
    const blur = es.efeitos?.backdropBlur?.elementos || 0;
    const grades = (es.layout?.grades || []).filter((g) => g.colunas >= 3 && g.filhos >= 5).length;
    if (!blur && !grades) return resultado(false, 0);
    const partes = [];
    if (blur) partes.push(`${blur} elemento(s) com vidro fosco (backdrop-filter blur)`);
    if (grades) partes.push(`${grades} grade(s) de 3 colunas ou mais com 5 itens ou mais (tipo bento)`);
    return { disparou: true, intensidade: 0, achados: [achadoDe({ pagina: p.url, mensagem: `Contexto, sem pontuação: ${partes.join('; ')}. Vidro fosco e grade bento, isolados, não são tratados como sinal de visual genérico.`, evidencias: (es.efeitos?.backdropBlur?.exemplos || []).slice(0, 3).map((x) => ev({ pagina: p.url, seletor: x.seletor, trecho: x.valor, valor: x.valor, visivel: true })), citacoes: semNulos([citarRegex(ctx, p, 'css', /backdrop-filter\s*:\s*[^;{}]+/)]) })] };
  });
});

// =====================================================================================================================
// exportação
// =====================================================================================================================
export const detectores = {
  // cor
  'cor-roxo-indigo-padrao': corRoxo,
  'cor-gradiente-azul-roxo': gradAzulRoxo,
  'cor-sem-tokens-semanticos': corSemTokens,
  'cor-pills-multicoloridas': corPills,
  'cor-paleta-arco-iris': corArcoIris,
  'cor-neutros-sem-tom': corNeutros,
  'cor-acento-em-area-grande': corAcentoAreaGrande,
  'cor-gradiente-repetido': corGradienteRepetido,
  'cor-cinza-sobre-fundo-colorido': corCinzaSobreColorido,
  'cor-look-creme-terracota': corCremeTerracota,
  'cor-modo-escuro-liberado': infoModoEscuro,
  // tipografia
  'tipo-fonte-padrao': tipoFontePadrao,
  'tipo-escala-ausente-ou-caotica': tipoEscala,
  'tipo-pesos-exagerados': tipoPesos,
  'tipo-titulo-sem-tracking': tipoTituloSemTracking,
  'tipo-tracking-fora-de-faixa': tipoTrackingFora,
  'tipo-microtexto': tipoMicrotexto,
  'tipo-entrelinha-apertada': tipoEntrelinha,
  'tipo-linha-longa-demais': tipoLinhaLonga,
  'tipo-familias-demais': tipoFamiliasDemais,
  'tipo-texto-gradiente': tipoTextoGradiente,
  'tipo-palavra-destacada-no-titulo': tipoPalavraDestacada,
  'tipo-rotulo-caixa-alta-espacado': tipoRotuloCaixaAlta,
  'tipo-mono-decorativa': tipoMonoDecorativa,
  'tipo-numeros-sem-tabular': tipoNumerosSemTabular,
  'tipo-acabamento-fino': tipoAcabamentoFino,
  'tipo-titulos-de-secao-timidos': tipoTitulosTimidos,
  // superfície
  'sup-sombra-difusa-padrao': supSombraDifusa,
  'sup-brilho-neon-glow': supBrilhoGlow,
  'sup-estilos-liberados-info': infoEstilosLiberados,
  'sup-raio-unico-em-tudo': supRaioUnico,
  'sup-pilula-em-tudo': supPilulaEmTudo,
  'sup-card-dentro-de-card': supCardDentroDeCard,
  'sup-card-shadcn-padrao': supCardShadcn,
  'sup-borda-lateral-colorida': supBordaLateral,
  'sup-sombra-dura-offset': supSombraDura,
  'sup-cards-irmaos-inconsistentes': supCardsIrmaos,
  'sup-fundo-grade-ou-pontos': supFundoGrade,
  'sup-navegador-sem-tema': supNavegadorSemTema,
  'sup-raio-aninhado-errado': supRaioAninhado,
  'sup-moldura-de-janela-falsa': supMolduraJanela,
  // iconografia
  'icone-emoji-como-icone': iconeEmoji,
  'icone-sparkle-ia': iconeSparkle,
  'icone-bibliotecas-misturadas': iconeBibliotecas,
  'icone-tamanhos-e-tracos-soltos': iconeTamanhosETracos,
  'icone-em-tile-colorido': iconeTileColorido,
  'icone-ilustracao-svg-desenhada': iconeIlustracaoSvg,
  'icone-ilustracao-de-banco-generica': iconeBancoGenerico,
  'icone-logo-gradiente-orbe': iconeLogoOrbe,
  'icone-bloco-visual-vazio': iconeBlocoVazio,
  'icone-selo-novidade-com-emoji': iconeSeloNovidade,
};
