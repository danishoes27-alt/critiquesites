// Função que roda DENTRO do navegador (page.evaluate). Precisa ser autossuficiente: nada de closures nem imports.
// Mede estilos COMPUTADOS agregados da página (até ~2000 elementos visíveis, não-clone). NÃO julga: só devolve números e evidências.
//
// FORMATO DE SAÍDA (versao 1; chaves em português; todas serializáveis). Convenções:
//  - "mapas de contagem" são objetos { valor: contagemDeElementos } em ordem decrescente de contagem
//    (chaves numéricas puras, como pesos "400", saem em ordem crescente do JS);
//  - tamanhos em px com unidade na chave ("16px"); cores em hex minúsculo ("#6366f1"; "#rrggbbaa" se alfa < 1);
//  - "seletor" usa o mesmo formato de extrairNoDom (#id>tag:nth-of-type(n)...).
//
// {
//   versao, viewport:{largura,altura},
//   amostra:{ totalElementos, visiveis, amostrados, comTexto, truncado, fatorAmostragem },
//   tipografia:{
//     familias:{ valores(mapa; 1ª família da pilha, só elementos com texto próprio), nDistintas, body, h1, pilhaBody, pilhaH1 },
//     fontes:{ declaradas:[{familia,status,peso,estilo}], carregadas, temFonteCustom, bodyUsaFonteCustom, h1UsaFonteCustom },
//     tamanhos:{ valores(mapa "16px"), nDistintos, lista:[px crescente], menorPx, maiorPx, abaixo12:{ tamanhos:[px], elementos, exemplos:[{seletor,tamanhoPx,texto}] } },
//     pesos:{ valores(mapa), nDistintos },
//     body:{ familia, tamanhoPx, peso, lineHeightPx, lineHeightRazao, cor, fundo }, h1:{ seletor, familia, tamanhoPx, peso, letterSpacingPx, letterSpacingEm, lineHeightPx }|null,
//     lineHeightCorpo:{ amostras, medianaRazao, normal },
//     titulos:[{ tag, seletor, texto, tamanhoPx, peso, letterSpacingPx, letterSpacingEm, familia }]   // h1-h3 visíveis (máx. 40)
//     titulosGrandes:{ minimoPx:36, total, comTrackingNegativo },
//     paragrafos:{ amostras, caracteresPorLinhaMediana, caracteresPorLinhaMax, exemplosLongos:[{seletor,caracteresPorLinha,linhas}] }
//   },
//   cores:{
//     texto:[{hex,contagem,h,s,l}] (top 30), fundo:[...], borda:[...], nDistintasTexto, nDistintasFundo,
//     paginaFundo:{hex,indeterminado}, temaEscuro,
//     familiasDeMatiz:{ "<matizInicialDoBalde30>": elementos }  // só cores cromáticas (s>=0.25) de texto/fundo/borda
//     links:{ total, porCor(mapa) }, botoes:{ total, porFundo(mapa), porCorTexto(mapa), primario:{seletor,texto,fundo,cor,raio,padding}|null }
//   },
//   raios:{ valores(mapa "16px"), nDistintos, dominante, fracaoDominante, comRaio, pilulas, porTipo:{botao,card,campo,imagem,outro}(mapas) },
//   sombras:{ elementos, valores(mapa do valor computado), detalhes:[{raw,x,y,blur,spread,inset,cor,alfa,elementos,difusaGenerica,glow}],
//             elementosComDifusaGenerica, elementosComGlow, elementosComSombraDura, exemplosDifusa:[seletor] },
//   cards:{ total, padding(mapa), paddingDominante, fracaoPaddingDominante, nPaddingDistintos, exemplos:[{seletor,largura,padding,raio,sombra}],
//           aninhados:{ total, raioFilhoMaiorQuePai, pares:[{filho,pai}] (máx. 20) } },
//   secoes:{ itens:[{seletor,tag,paddingTopPx,paddingBottomPx,alturaPx}], n, pares(mapa "96px/96px"), nParesDistintos, uniforme, valorDominante, fracaoDominante },
//   layout:{
//     centralizacao:{ profundidadeMax:3, blocos, centralizados, fracao, porProfundidade:{ "1":{blocos,centralizados} }, exemplos:[seletor] },
//     grades:[{seletor,colunas,filhos,gap}] (display:grid, máx. 30), flexLinhas:[{seletor,filhos,larguraIgual,wrap}] (flex em linha com >=3 filhos),
//     heroes:[{seletor,tag,classe,textAlign,alturaPx,temH1,topoPx}] (container mais próximo do primeiro h1)
//   },
//   gradientes:{ elementos, itens:[{seletor,tag,tipo,repetido,angulo,direcao,paradas:[{hex,h,s,l,a}],matizInicial,matizFinal,aplicadoAoTexto,fonteTamanhoPx}] (máx. 40),
//                texto:{ elementos, itens:[{seletor,tag,texto,tamanhoPx}] }, porTipo(mapa) },
//   efeitos:{ backdropBlur:{ elementos, exemplos:[{seletor,valor}] }, filtros:{ blur, blurGrande(>=40px), dropShadow },
//             textShadow:{ elementos, saturados }, willChange:{ elementos } },
//   movimento:{
//     animacoes:{ elementos, porNome:[{nome,elementos,duracaoMs,easing,iteracoes,anima:[props]|null,ehEntrada}], easing(mapa), infinitas },
//     transicoes:{ elementos, propriedades(mapa), easing(mapa), duracoesMs(mapa), all, temCubicBezier, temEasingCustom, soEasingPadrao }
//   },
//   alvosToque:{ total, abaixo24, abaixo44, abaixo24SemInline, exemplos:[{seletor,tag,larguraPx,alturaPx,inline,texto}] (10) },
//   contraste:{ avaliados, indeterminados, textoTransparente, falhas(total), razaoMinima, itens:[{seletor,texto,corTexto,corFundo,razao,minimo,tamanhoPx,peso,grande}] (máx. 50, pior primeiro) },
//   emojis:{ contagem, unicos:[...], porTipo:{titulo,botao,link,span,paragrafo,outro}, elementos:[{seletor,tag,emojis,texto}] (máx. 30) },
//   imagens:{ total, visiveis, distorcidas, naturalMuitoMaiorQueRender, semTamanhoNatural, exemplos:[{seletor,renderW,renderH,naturalW,naturalH,razaoAspecto,razaoNatural,objectFit}] },
//   overflowHorizontal:{ ativo, larguraDocumento, larguraViewport, larguraReferencia, culpados:[{seletor,direitaPx}] }
// }
//
// Limitações: contraste ignora sobreposições posicionadas e imagens (marca fundoIndeterminado); `prefers-reduced-motion`, :hover e
// :focus não são computáveis aqui (ficam para o CSS estático); a 1ª família da pilha é a DECLARADA, não necessariamente a renderizada.
export function coletarEstilosNoDom(opcoes) {
  const o = opcoes || {};
  const MAX_EL = o.maxElementos || 2000;
  const MAX_CONTRASTE = o.maxContraste || 300;
  const doc = document;
  const raiz = doc.documentElement;
  const corpo = doc.body || raiz;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ---------- utilitários ----------
  const arred = (n, c) => { const f = Math.pow(10, c === undefined ? 2 : c); return Math.round(n * f) / f; };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const norm = (s) => (s || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const contar = (m, k, n) => m.set(k, (m.get(k) || 0) + (n === undefined ? 1 : n));
  const ordenado = (m, limite) => {
    const arr = Array.from(m.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return Object.fromEntries(limite ? arr.slice(0, limite) : arr);
  };
  const dividirTopo = (s, sep) => {
    const partes = [];
    let nivel = 0, atual = '', aspas = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (aspas) { atual += ch; if (ch === aspas) aspas = ''; continue; }
      if (ch === '"' || ch === "'") { aspas = ch; atual += ch; continue; }
      if (ch === '(') nivel++;
      if (ch === ')') nivel--;
      if (ch === sep && nivel === 0) { partes.push(atual.trim()); atual = ''; continue; }
      atual += ch;
    }
    if (atual.trim()) partes.push(atual.trim());
    return partes;
  };
  const mediana = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const cacheEstilo = new WeakMap();
  const estilo = (el) => {
    let c = cacheEstilo.get(el);
    if (!c) { c = getComputedStyle(el); cacheEstilo.set(el, c); }
    return c;
  };

  const idUnico = (el) => {
    if (!el.id || !/^[A-Za-z][\w-]*$/.test(el.id)) return false;
    try { return doc.querySelectorAll('#' + CSS.escape(el.id)).length === 1; } catch (e) { return false; }
  };
  const seletorDe = (el) => {
    const partes = [];
    let e = el;
    while (e && e.nodeType === 1 && e !== raiz && partes.length < 8) {
      if (idUnico(e)) { partes.unshift('#' + CSS.escape(e.id)); break; }
      let p = e.tagName.toLowerCase();
      const pai = e.parentElement;
      if (pai) {
        const irm = Array.prototype.filter.call(pai.children, (x) => x.tagName === e.tagName);
        if (irm.length > 1) p += ':nth-of-type(' + (irm.indexOf(e) + 1) + ')';
      }
      partes.unshift(p);
      e = pai;
    }
    return partes.join('>');
  };

  // ---------- cores ----------
  const cacheCor = new Map();
  let ctxCanvas = null;
  try { const cv = doc.createElement('canvas'); cv.width = 1; cv.height = 1; ctxCanvas = cv.getContext('2d', { willReadFrequently: true }); } catch (e) { ctxCanvas = null; }
  // devolve [r,g,b,a] (a em 0..1) ou null
  const paraRgba = (v) => {
    if (!v) return null;
    if (cacheCor.has(v)) return cacheCor.get(v);
    let r = null;
    const s = String(v).trim();
    if (s === 'transparent') r = [0, 0, 0, 0];
    else {
      const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
      if (m) {
        let a = 1;
        if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        r = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
      } else if (/^#[0-9a-f]{3,8}$/i.test(s)) {
        let h = s.slice(1);
        if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
        if (h.length === 6 || h.length === 8) r = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      } else if (ctxCanvas) {
        try {
          ctxCanvas.clearRect(0, 0, 1, 1);
          ctxCanvas.fillStyle = '#010203';
          ctxCanvas.fillStyle = s;
          if (ctxCanvas.fillStyle !== '#010203' || /^#010203$/i.test(s)) {
            ctxCanvas.fillRect(0, 0, 1, 1);
            const d = ctxCanvas.getImageData(0, 0, 1, 1).data;
            r = [d[0], d[1], d[2], arred(d[3] / 255, 3)];
          }
        } catch (e) { r = null; }
      }
    }
    cacheCor.set(v, r);
    return r;
  };
  const h2 = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
  const hexDe = (c) => '#' + h2(c[0]) + h2(c[1]) + h2(c[2]) + (c[3] < 0.995 ? h2(c[3] * 255) : '');
  const hsl = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: arred(s, 2), l: arred(l, 2) };
  };
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const razaoContraste = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const compor = (f, fundo) => [f[0] * f[3] + fundo[0] * (1 - f[3]), f[1] * f[3] + fundo[1] * (1 - f[3]), f[2] * f[3] + fundo[2] * (1 - f[3])];

  // ---------- clones de carrossel (mesma ideia do extrairNoDom) ----------
  const raizesClone = new Set();
  const dicaClone = /(^|[-_ ])(clone|cloned|duplicate|duplicated)([-_ ]|$)/i;
  const baixa = (s) => norm(s).toLowerCase();
  for (const e of Array.prototype.slice.call(doc.querySelectorAll('[aria-hidden="true"]'))) {
    if (e.parentElement && e.parentElement.closest('[aria-hidden="true"]')) continue;
    const t = baixa(e.textContent);
    if (t.length < 8) continue;
    const irmaos = e.parentElement ? Array.prototype.slice.call(e.parentElement.children) : [];
    if (irmaos.some((s) => s !== e && !s.closest('[aria-hidden="true"]') && baixa(s.textContent) === t)) raizesClone.add(e);
  }
  for (const e of Array.prototype.slice.call(doc.querySelectorAll('[class]'))) {
    const c = typeof e.className === 'string' ? e.className : (e.getAttribute('class') || '');
    if (dicaClone.test(c)) raizesClone.add(e);
  }
  const cacheClone = new WeakMap();
  const ehClone = (el) => {
    let e = el;
    const visitados = [];
    while (e && e.nodeType === 1) {
      if (cacheClone.has(e)) { const r = cacheClone.get(e); visitados.forEach((v) => cacheClone.set(v, r)); return r; }
      visitados.push(e);
      if (raizesClone.has(e)) { visitados.forEach((v) => cacheClone.set(v, true)); return true; }
      e = e.parentElement;
    }
    visitados.forEach((v) => cacheClone.set(v, false));
    return false;
  };

  // opacidade acumulada dos ancestrais
  const cacheOp = new WeakMap();
  const opacidade = (el) => {
    if (!el || el.nodeType !== 1) return 1;
    if (cacheOp.has(el)) return cacheOp.get(el);
    const v = num(estilo(el).opacity);
    const r = (isNaN(v) ? 1 : v) * (el === raiz ? 1 : opacidade(el.parentElement));
    cacheOp.set(el, r);
    return r;
  };

  // ---------- seleção dos elementos ----------
  const IGN = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BR', 'WBR', 'SOURCE', 'TRACK', 'AREA', 'BASE', 'COLGROUP', 'COL']);
  const todos = Array.prototype.slice.call(corpo.querySelectorAll('*'));
  const caixa = new WeakMap();
  const candidatos = [];
  for (const el of todos) {
    if (IGN.has(el.tagName)) continue;
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') continue;
    const cs = estilo(el);
    if (cs.display === 'none' || cs.display === 'contents' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
    const b = el.getBoundingClientRect();
    if (!(b.width > 0) || !(b.height > 0)) continue;
    if (opacidade(el) < 0.01) continue;
    if (ehClone(el)) continue;
    caixa.set(el, b);
    candidatos.push(el);
  }
  let amostra = candidatos;
  if (candidatos.length > MAX_EL) {
    amostra = [];
    const passo = candidatos.length / MAX_EL;
    for (let i = 0; i < MAX_EL; i++) amostra.push(candidatos[Math.floor(i * passo)]);
  }
  const visivelEl = (el) => caixa.has(el);

  const textoProprio = (el) => {
    let t = '';
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
    return norm(t);
  };
  const primeiraFamilia = (pilha) => {
    const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(pilha || '');
    return m ? norm(m[1] || m[2] || m[3]) : '';
  };

  // ---------- classificação dos elementos ----------
  const REGEX_BTN = /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i;
  const classeDe = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
  const SELETOR_BLOCO = 'div,p,h1,h2,h3,h4,h5,h6,ul,ol,li,img,section,article,figure,table';
  // botão: <button>, input de ação, role=button, <a> com classe btn/button/cta ou <a> "em forma de botão" (inline-block com fundo e sem blocos dentro)
  const ehBotao = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'button' || (t === 'input' && /^(button|submit|reset)$/i.test(el.type)) || el.getAttribute('role') === 'button') return true;
    if (t !== 'a') return false;
    if (REGEX_BTN.test(classeDe(el))) return true;
    const cs = estilo(el);
    if (!/^inline-(block|flex)$/.test(cs.display)) return false;
    const bg = paraRgba(cs.backgroundColor);
    return !!(bg && bg[3] > 0) && !el.querySelector(SELETOR_BLOCO);
  };
  const ehCampo = (el) => { const t = el.tagName.toLowerCase(); return (t === 'input' && !/^(button|submit|reset|image)$/i.test(el.type)) || t === 'select' || t === 'textarea'; };
  const ehMidia = (el) => /^(img|picture|video|canvas|svg|iframe|object|embed)$/.test(el.tagName.toLowerCase());
  const ladosComBorda = (cs) => ['Top', 'Right', 'Bottom', 'Left'].filter((l) => num(cs['border' + l + 'Width']) > 0 && cs['border' + l + 'Style'] !== 'none' && cs['border' + l + 'Style'] !== 'hidden').length;
  const raioMax = (cs) => Math.max(num(cs.borderTopLeftRadius), num(cs.borderTopRightRadius), num(cs.borderBottomRightRadius), num(cs.borderBottomLeftRadius));
  const temSombra = (cs) => !!cs.boxShadow && cs.boxShadow !== 'none';
  const ehCard = (el) => {
    if (el === corpo || el === raiz) return false;
    if (ehBotao(el) || ehCampo(el) || ehMidia(el)) return false;
    const cs = estilo(el);
    if (cs.display === 'inline') return false;
    const b = caixa.get(el) || el.getBoundingClientRect();
    if (b.width <= 150 || b.width >= vw * 0.98) return false;
    return raioMax(cs) > 0 || temSombra(cs) || ladosComBorda(cs) >= 3;
  };

  // ---------- agregadores ----------
  const mFam = new Map(), mTam = new Map(), mPeso = new Map();
  const mCorTexto = new Map(), mCorFundo = new Map(), mCorBorda = new Map(), mMatiz = new Map();
  const mLinks = new Map(), mBotFundo = new Map(), mBotCor = new Map();
  const mRaio = new Map(), mRaioTipo = { botao: new Map(), card: new Map(), campo: new Map(), imagem: new Map(), outro: new Map() };
  const mSombra = new Map(), detSombra = new Map();
  const mPad = new Map();
  const mGrad = new Map();
  const mAnim = new Map(), mAnimEasing = new Map(), mTrProp = new Map(), mTrEasing = new Map(), mTrDur = new Map();
  let comTexto = 0, raioComRaio = 0, pilulas = 0;
  const tamanhosPequenos = [];
  let elementosPequenos = 0;
  const tamPequenosSet = new Set();
  const lhRazoes = []; let lhNormal = 0;
  const cardsSet = new Set();
  const cardsLista = [];
  const botoes = [];
  const linksTotal = { n: 0 };
  let nSombraEl = 0, nSombraDifusa = 0, nSombraGlow = 0, nSombraDura = 0;
  const exemplosDifusa = [];
  const gradItens = []; let gradEl = 0;
  const gradTexto = []; let gradTextoEl = 0;
  let backdropN = 0; const backdropEx = [];
  let blurN = 0, blurGrandeN = 0, dropShadowN = 0, tsN = 0, tsSat = 0, willN = 0;
  let animEl = 0, animInfinitas = 0, trEl = 0, trAll = 0, trCubic = 0, trCustom = 0;
  const animPorNome = new Map();
  const textosParaContraste = [];

  const parseCorEmTexto = (txt) => {
    // devolve { cor:[r,g,b,a]|null, resto:string } com a 1ª cor encontrada no texto
    const m = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}\b)/.exec(txt);
    if (!m) return { cor: null, resto: txt };
    return { cor: paraRgba(m[1]), resto: (txt.slice(0, m.index) + ' ' + txt.slice(m.index + m[1].length)).trim() };
  };
  const analisarSombra = (valor, corAtual) => {
    const camadas = [];
    for (const parte of dividirTopo(valor, ',')) {
      const inset = /\binset\b/.test(parte);
      const r = parseCorEmTexto(parte.replace(/\binset\b/, ''));
      const nums = (r.resto.match(/-?[\d.]+(?:e[+-]?\d+)?(?:px)?/g) || []).map((x) => parseFloat(x));
      const cor = r.cor || paraRgba(corAtual) || [0, 0, 0, 1];
      const [x, y, blur, spread] = [nums[0] || 0, nums[1] || 0, nums[2] || 0, nums[3] || 0];
      const hs = hsl(cor);
      const preto = cor[0] <= 10 && cor[1] <= 10 && cor[2] <= 10;
      camadas.push({
        raw: parte, x, y, blur, spread, inset, cor: hexDe([cor[0], cor[1], cor[2], 1]), alfa: arred(cor[3], 3),
        difusaGenerica: !inset && blur >= 10 && preto && cor[3] > 0 && cor[3] <= 0.25,
        glow: !inset && x === 0 && y === 0 && blur > 0 && hs.s >= 0.4 && cor[3] > 0.05,
        dura: !inset && blur === 0 && (x !== 0 || y !== 0),
      });
    }
    return camadas;
  };
  const angulo = (dir) => {
    if (!dir) return null;
    let m = /(-?[\d.]+)deg/.exec(dir); if (m) return parseFloat(m[1]);
    m = /(-?[\d.]+)turn/.exec(dir); if (m) return parseFloat(m[1]) * 360;
    m = /(-?[\d.]+)rad/.exec(dir); if (m) return arred(parseFloat(m[1]) * 180 / Math.PI, 1);
    m = /(-?[\d.]+)grad/.exec(dir); if (m) return arred(parseFloat(m[1]) * 0.9, 1);
    const mapa = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
    const k = dir.trim().toLowerCase().replace(/\s+/g, ' ');
    return mapa[k] !== undefined ? mapa[k] : null;
  };
  const gradientesDe = (bg) => {
    const out = [];
    const re = /(repeating-)?(linear|radial|conic)-gradient\(/g;
    let m;
    while ((m = re.exec(bg))) {
      let i = re.lastIndex, nivel = 1;
      while (i < bg.length && nivel > 0) { if (bg[i] === '(') nivel++; else if (bg[i] === ')') nivel--; i++; }
      const corpoG = bg.slice(re.lastIndex, i - 1);
      re.lastIndex = i;
      const partes = dividirTopo(corpoG, ',');
      let direcao = null;
      const paradas = [];
      partes.forEach((p, idx) => {
        const r = parseCorEmTexto(p);
        if (r.cor && /^(rgba?|hsla?|oklch|oklab|lab|lch|color|#)/i.test(p.trim())) {
          const hs = hsl(r.cor);
          paradas.push({ hex: hexDe([r.cor[0], r.cor[1], r.cor[2], 1]), h: hs.h, s: hs.s, l: hs.l, a: arred(r.cor[3], 2) });
        } else if (idx === 0) direcao = p;
        else {
          const nome = paraRgba(p.split(/\s+/)[0]);
          if (nome) { const hs = hsl(nome); paradas.push({ hex: hexDe([nome[0], nome[1], nome[2], 1]), h: hs.h, s: hs.s, l: hs.l, a: arred(nome[3], 2) }); }
        }
      });
      const cromaticas = paradas.filter((p) => p.s >= 0.1 && p.a > 0);
      out.push({
        tipo: m[2], repetido: !!m[1], direcao, angulo: m[2] === 'linear' ? (direcao ? angulo(direcao) : 180) : null, paradas,
        matizInicial: cromaticas.length ? cromaticas[0].h : null, matizFinal: cromaticas.length ? cromaticas[cromaticas.length - 1].h : null,
      });
    }
    return out;
  };
  const listaDe = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const paraMs = (t) => (/ms$/.test(t) ? parseFloat(t) : parseFloat(t) * 1000);

  // keyframes (só folhas de mesmo domínio são legíveis)
  const keyframes = new Map();
  const lerRegras = (regras) => {
    for (const r of Array.prototype.slice.call(regras || [])) {
      try {
        if (r.type === 7 && r.name) {
          const props = new Set();
          for (const f of Array.prototype.slice.call(r.cssRules)) for (let i = 0; i < f.style.length; i++) props.add(f.style[i]);
          const primeiro = r.cssRules.length ? r.cssRules[0] : null;
          let comecaInvisivel = false;
          if (primeiro && /^(0%|from)$/i.test(primeiro.keyText) && primeiro.style.getPropertyValue('opacity') !== '' && num(primeiro.style.getPropertyValue('opacity')) === 0) comecaInvisivel = true;
          keyframes.set(r.name, { props: Array.from(props).sort(), comecaInvisivel });
        } else if (r.cssRules) lerRegras(r.cssRules);
      } catch (e) { /* ignora */ }
    }
  };
  for (const folha of Array.prototype.slice.call(doc.styleSheets)) { try { lerRegras(folha.cssRules); } catch (e) { /* folha de outro domínio */ } }

  // ---------- passada principal ----------
  const grandes = []; // textos para contraste
  for (const el of amostra) {
    const cs = estilo(el);
    const tag = el.tagName.toLowerCase();
    const proprio = textoProprio(el);
    const tamPx = num(cs.fontSize);
    const botao = ehBotao(el);
    const campo = ehCampo(el);
    const midia = ehMidia(el);

    if (proprio) {
      comTexto++;
      contar(mFam, primeiraFamilia(cs.fontFamily) || '(vazio)');
      contar(mTam, arred(tamPx) + 'px');
      contar(mPeso, String(cs.fontWeight));
      if (tamPx < 12) {
        elementosPequenos++;
        tamPequenosSet.add(arred(tamPx));
        if (tamanhosPequenos.length < 5) tamanhosPequenos.push({ seletor: seletorDe(el), tamanhoPx: arred(tamPx), texto: proprio.slice(0, 60) });
      }
      const cor = paraRgba(cs.color);
      if (cor && cor[3] > 0) { const hx = hexDe(cor); contar(mCorTexto, hx); if (hsl(cor).s >= 0.25) contar(mMatiz, String(Math.floor(hsl(cor).h / 30) * 30)); }
      if (tag === 'a' && el.hasAttribute('href') && !botao && cor) { linksTotal.n++; contar(mLinks, hexDe(cor)); }
      textosParaContraste.push(el);
      if (tag === 'p' && proprio.length > 40) {
        const lh = cs.lineHeight;
        if (lh === 'normal') lhNormal++; else if (tamPx > 0) lhRazoes.push(num(lh) / tamPx);
      }
    }
    // fundo
    const bgc = paraRgba(cs.backgroundColor);
    if (bgc && bgc[3] > 0) { contar(mCorFundo, hexDe(bgc)); if (hsl(bgc).s >= 0.25) contar(mMatiz, String(Math.floor(hsl(bgc).h / 30) * 30)); }
    // borda
    if (ladosComBorda(cs) > 0) {
      const lado = ['Top', 'Right', 'Bottom', 'Left'].find((l) => num(cs['border' + l + 'Width']) > 0 && cs['border' + l + 'Style'] !== 'none');
      const bc = paraRgba(cs['border' + lado + 'Color']);
      if (bc && bc[3] > 0) { contar(mCorBorda, hexDe(bc)); if (hsl(bc).s >= 0.25) contar(mMatiz, String(Math.floor(hsl(bc).h / 30) * 30)); }
    }
    // raios
    const rmax = raioMax(cs);
    const card = ehCard(el);
    if (card) { cardsSet.add(el); cardsLista.push(el); }
    if (rmax > 0 || /%/.test(cs.borderTopLeftRadius)) {
      const chave = (() => {
        const v = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
        return v.every((x) => x === v[0]) ? v[0] : v.join(' ');
      })();
      raioComRaio++;
      contar(mRaio, chave);
      if (rmax >= 9999) pilulas++;
      const tipo = botao ? 'botao' : campo ? 'campo' : midia ? 'imagem' : card ? 'card' : 'outro';
      contar(mRaioTipo[tipo], chave);
    }
    // botões e links
    if (botao) {
      botoes.push({ el, fundo: bgc && bgc[3] > 0 ? hexDe(bgc) : 'transparente', cor: paraRgba(cs.color) ? hexDe(paraRgba(cs.color)) : null, topo: caixa.get(el).top, raio: cs.borderTopLeftRadius, padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft });
    }
    // sombras
    if (temSombra(cs)) {
      nSombraEl++;
      contar(mSombra, cs.boxShadow);
      const camadas = analisarSombra(cs.boxShadow, cs.color);
      let dif = false, glow = false, dura = false;
      for (const c of camadas) {
        const d = detSombra.get(c.raw) || Object.assign({ elementos: 0 }, c);
        d.elementos++;
        detSombra.set(c.raw, d);
        dif = dif || c.difusaGenerica; glow = glow || c.glow; dura = dura || c.dura;
      }
      if (dif) { nSombraDifusa++; if (exemplosDifusa.length < 10) exemplosDifusa.push(seletorDe(el)); }
      if (glow) nSombraGlow++;
      if (dura) nSombraDura++;
    }
    // gradientes
    if (cs.backgroundImage && cs.backgroundImage.indexOf('gradient(') !== -1) {
      const gs = gradientesDe(cs.backgroundImage);
      if (gs.length) {
        gradEl++;
        const clipTexto = /text/.test(cs.backgroundClip) || /text/.test(cs.webkitBackgroundClip || '');
        const preenchimento = paraRgba(cs.webkitTextFillColor || cs.color);
        const textoGrad = clipTexto && (!preenchimento || preenchimento[3] === 0);
        const seletor = seletorDe(el);
        for (const g of gs) {
          contar(mGrad, g.tipo);
          if (gradItens.length < 40) gradItens.push(Object.assign({ seletor, tag }, g, { aplicadoAoTexto: textoGrad, fonteTamanhoPx: arred(tamPx) }));
        }
        if (textoGrad) { gradTextoEl++; if (gradTexto.length < 20) gradTexto.push({ seletor, tag, texto: norm(el.textContent).slice(0, 60), tamanhoPx: arred(tamPx) }); }
      }
    }
    // efeitos
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none' && /blur/.test(bf)) { backdropN++; if (backdropEx.length < 10) backdropEx.push({ seletor: seletorDe(el), valor: bf }); }
    if (cs.filter && cs.filter !== 'none') {
      const mb = /blur\(([\d.]+)px\)/.exec(cs.filter);
      if (mb) { blurN++; if (parseFloat(mb[1]) >= 40) blurGrandeN++; }
      if (/drop-shadow/.test(cs.filter)) dropShadowN++;
    }
    if (cs.textShadow && cs.textShadow !== 'none') {
      tsN++;
      const r = parseCorEmTexto(cs.textShadow);
      if (r.cor && hsl(r.cor).s >= 0.4 && r.cor[3] > 0.05) tsSat++;
    }
    if (cs.willChange && cs.willChange !== 'auto') willN++;
    // animações
    if (cs.animationName && cs.animationName !== 'none') {
      animEl++;
      const nomes = listaDe(cs.animationName), durs = dividirTopo(cs.animationDuration, ','), eases = dividirTopo(cs.animationTimingFunction, ','), its = listaDe(cs.animationIterationCount);
      nomes.forEach((nome, i) => {
        if (nome === 'none') return;
        const dur = durs[i % durs.length] || '0s', ease = eases[i % eases.length] || 'ease', it = its[i % its.length] || '1';
        const reg = animPorNome.get(nome) || { nome, elementos: 0, duracaoMs: Math.round(paraMs(dur)), easing: ease, iteracoes: it };
        reg.elementos++;
        animPorNome.set(nome, reg);
        contar(mAnimEasing, ease);
        if (it === 'infinite') animInfinitas++;
      });
    }
    // transições
    const durT = dividirTopo(cs.transitionDuration || '0s', ',');
    if (durT.some((d) => paraMs(d) > 0)) {
      trEl++;
      const props = dividirTopo(cs.transitionProperty || 'all', ','), eases = dividirTopo(cs.transitionTimingFunction || 'ease', ',');
      const vistosProp = new Set(), vistosEase = new Set();
      durT.forEach((d, i) => {
        const ms = paraMs(d);
        if (!(ms > 0)) return;
        const p = props[i % props.length] || 'all', e = eases[i % eases.length] || 'ease';
        if (!vistosProp.has(p)) { vistosProp.add(p); contar(mTrProp, p); }
        if (!vistosEase.has(e)) { vistosEase.add(e); contar(mTrEasing, e); if (/cubic-bezier/.test(e)) trCubic++; if (/cubic-bezier|steps\(|linear\(/.test(e)) trCustom++; }
        contar(mTrDur, Math.round(ms) + 'ms');
        if (p === 'all') trAll++;
      });
    }
  }

  // ---------- tipografia: body, h1, títulos ----------
  const csBody = estilo(corpo);
  const lhPx = (cs) => (cs.lineHeight === 'normal' ? null : arred(num(cs.lineHeight)));
  const famBody = primeiraFamilia(csBody.fontFamily);
  const corBody = paraRgba(csBody.color);
  const h1El = Array.prototype.slice.call(doc.querySelectorAll('h1')).find((e) => visivelEl(e)) || null;
  let h1 = null, famH1 = null, pilhaH1 = null;
  if (h1El) {
    const cs = estilo(h1El);
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing);
    famH1 = primeiraFamilia(cs.fontFamily); pilhaH1 = cs.fontFamily.slice(0, 200);
    h1 = { seletor: seletorDe(h1El), familia: famH1, tamanhoPx: arred(num(cs.fontSize)), peso: String(cs.fontWeight), letterSpacingPx: arred(ls), letterSpacingEm: arred(ls / (num(cs.fontSize) || 1), 3), lineHeightPx: lhPx(cs) };
  }
  const titulos = [];
  let titulosGrandes = 0, titulosGrandesNeg = 0;
  for (const h of Array.prototype.slice.call(doc.querySelectorAll('h1,h2,h3'))) {
    if (!visivelEl(h)) continue;
    const cs = estilo(h);
    const t = num(cs.fontSize);
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing);
    if (titulos.length < 40) titulos.push({ tag: h.tagName.toLowerCase(), seletor: seletorDe(h), texto: norm(h.textContent).slice(0, 60), tamanhoPx: arred(t), peso: String(cs.fontWeight), letterSpacingPx: arred(ls), letterSpacingEm: arred(ls / (t || 1), 3), familia: primeiraFamilia(cs.fontFamily) });
    if (t >= 36) { titulosGrandes++; if (ls < 0) titulosGrandesNeg++; }
  }
  // fontes declaradas (@font-face)
  const fontesDecl = [];
  try { doc.fonts.forEach((f) => { if (fontesDecl.length < 60) fontesDecl.push({ familia: String(f.family).replace(/^["']|["']$/g, ''), status: f.status, peso: f.weight, estilo: f.style }); }); } catch (e) { /* sem document.fonts */ }
  const famCustom = new Set(fontesDecl.map((f) => f.familia.toLowerCase()));
  // parágrafos: caracteres por linha (aproximação: texto / número de linhas)
  const cpl = [];
  const longos = [];
  for (const p of amostra.filter((e) => e.tagName === 'P')) {
    const t = norm(p.textContent);
    const cs = estilo(p);
    const lh = cs.lineHeight === 'normal' ? num(cs.fontSize) * 1.2 : num(cs.lineHeight);
    const b = caixa.get(p);
    const linhas = lh > 0 ? Math.round((b.height - num(cs.paddingTop) - num(cs.paddingBottom)) / lh) : 0;
    if (t.length >= 80 && linhas >= 3) { const c = Math.round(t.length / linhas); cpl.push(c); longos.push({ seletor: null, el: p, caracteresPorLinha: c, linhas }); }
  }
  longos.sort((a, b) => b.caracteresPorLinha - a.caracteresPorLinha);

  // ---------- cores: listas ----------
  const topCores = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([hex, contagem]) => {
    const c = paraRgba(hex);
    const hs = c ? hsl(c) : { h: 0, s: 0, l: 0 };
    return { hex, contagem, h: hs.h, s: hs.s, l: hs.l };
  });
  // fundo da página (html/body)
  const fundoPagina = (() => {
    for (const e of [corpo, raiz]) {
      const c = paraRgba(estilo(e).backgroundColor);
      if (estilo(e).backgroundImage !== 'none') return { hex: null, indeterminado: true, rgb: null };
      if (c && c[3] >= 0.995) return { hex: hexDe(c), indeterminado: false, rgb: c.slice(0, 3) };
    }
    const esc = /dark/.test(estilo(raiz).colorScheme || '') && !/light/.test(estilo(raiz).colorScheme || '');
    const rgb = esc ? [18, 18, 18] : [255, 255, 255];
    return { hex: hexDe(rgb.concat([1])), indeterminado: false, rgb, padraoDoNavegador: true };
  })();
  let primario = null;
  if (botoes.length) {
    const comFundo = botoes.filter((b) => b.fundo !== 'transparente' && b.topo < vh * 1.5);
    const b = comFundo[0] || botoes.filter((x) => x.fundo !== 'transparente')[0] || botoes[0];
    primario = { seletor: seletorDe(b.el), texto: norm(b.el.textContent || b.el.value || '').slice(0, 40), fundo: b.fundo, cor: b.cor, raio: b.raio, padding: b.padding };
    for (const x of botoes) { contar(mBotFundo, x.fundo); if (x.cor) contar(mBotCor, x.cor); }
  }

  // ---------- cards ----------
  const paddingDe = (el) => {
    const cs = estilo(el);
    const v = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
    return v.every((x) => x === v[0]) ? v[0] : v.join(' ');
  };
  const pares = [];
  let aninhados = 0, raioFilhoMaior = 0;
  for (const c of cardsLista) {
    contar(mPad, paddingDe(c));
    let pai = c.parentElement;
    while (pai && pai !== corpo && !cardsSet.has(pai)) pai = pai.parentElement;
    if (pai && pai !== corpo) {
      aninhados++;
      if (raioMax(estilo(c)) > raioMax(estilo(pai))) raioFilhoMaior++;
      if (pares.length < 20) pares.push({ filho: seletorDe(c), pai: seletorDe(pai) });
    }
  }
  const padOrd = ordenado(mPad);
  const padChaves = Object.keys(padOrd);
  const exemplosCards = cardsLista.slice(0, 10).map((c) => ({ seletor: seletorDe(c), largura: Math.round(caixa.get(c).width), padding: paddingDe(c), raio: estilo(c).borderTopLeftRadius, sombra: temSombra(estilo(c)) }));

  // ---------- seções ----------
  const secEls = Array.prototype.slice.call(doc.querySelectorAll('section,header,footer,main>div')).filter((e) => visivelEl(e)).slice(0, 60);
  const secoesItens = secEls.map((e) => {
    const cs = estilo(e);
    return { seletor: seletorDe(e), tag: e.tagName.toLowerCase(), paddingTopPx: arred(num(cs.paddingTop)), paddingBottomPx: arred(num(cs.paddingBottom)), alturaPx: Math.round(caixa.get(e).height) };
  });
  const mPares = new Map();
  for (const s of secoesItens) contar(mPares, s.paddingTopPx + 'px/' + s.paddingBottomPx + 'px');
  const paresOrd = ordenado(mPares);
  const parChaves = Object.keys(paresOrd);

  // ---------- layout ----------
  const prof = (el) => { let d = 0, e = el; while (e && e !== corpo) { d++; e = e.parentElement; } return d; };
  const porProf = { 1: { blocos: 0, centralizados: 0 }, 2: { blocos: 0, centralizados: 0 }, 3: { blocos: 0, centralizados: 0 } };
  let blocos = 0, centrados = 0;
  const exCentro = [];
  for (const el of candidatos) {
    const d = prof(el);
    if (d < 1 || d > 3) continue;
    const cs = estilo(el);
    if (cs.display === 'inline') continue;
    if (!norm(el.textContent) && !el.querySelector('img,svg,picture,video,canvas')) continue;
    blocos++; porProf[d].blocos++;
    const flexC = /flex|grid/.test(cs.display) && (/center/.test(cs.justifyContent) || (/column/.test(cs.flexDirection) && /center/.test(cs.alignItems)) || /center/.test(cs.justifyItems));
    if (/center/.test(cs.textAlign) || flexC) { centrados++; porProf[d].centralizados++; if (exCentro.length < 10) exCentro.push(seletorDe(el)); }
  }
  const grades = [];
  const flexLinhas = [];
  for (const el of candidatos) {
    const cs = estilo(el);
    if (/grid/.test(cs.display) && grades.length < 30) {
      const cols = cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none' ? dividirTopo(cs.gridTemplateColumns, ' ').length : 0;
      grades.push({ seletor: seletorDe(el), colunas: cols, filhos: Array.prototype.filter.call(el.children, (c) => visivelEl(c)).length, gap: cs.gap });
    } else if (/flex/.test(cs.display) && /^row/.test(cs.flexDirection) && flexLinhas.length < 30) {
      const fs = Array.prototype.filter.call(el.children, (c) => visivelEl(c));
      if (fs.length >= 3) {
        const ws = fs.map((c) => caixa.get(c).width);
        flexLinhas.push({ seletor: seletorDe(el), filhos: fs.length, larguraIgual: Math.max.apply(null, ws) - Math.min.apply(null, ws) <= 2, wrap: cs.flexWrap !== 'nowrap' });
      }
    }
  }
  const heroes = [];
  if (h1El) {
    let c = h1El.parentElement, escolhido = h1El.parentElement;
    for (let i = 0; c && c !== corpo && i < 5; i++, c = c.parentElement) {
      if (/^(section|header)$/i.test(c.tagName) || /hero|banner|jumbotron|masthead/i.test(classeDe(c))) { escolhido = c; break; }
    }
    if (escolhido && escolhido !== corpo && visivelEl(escolhido)) {
      const cs = estilo(escolhido);
      heroes.push({ seletor: seletorDe(escolhido), tag: escolhido.tagName.toLowerCase(), classe: classeDe(escolhido).slice(0, 80), textAlign: cs.textAlign, alturaPx: Math.round(caixa.get(escolhido).height), temH1: true, topoPx: Math.round(caixa.get(escolhido).top + window.scrollY) });
    }
  }

  // ---------- alvos de toque ----------
  const alvos = [];
  let abaixo24 = 0, abaixo44 = 0, abaixo24SemInline = 0, totalAlvos = 0;
  for (const el of Array.prototype.slice.call(doc.querySelectorAll('a[href],button,input,select,textarea,[role="button"]')).slice(0, 1500)) {
    if (!visivelEl(el)) continue;
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    totalAlvos++;
    const b = caixa.get(el);
    const inline = estilo(el).display === 'inline';
    if (b.width < 24 || b.height < 24) { abaixo24++; if (!inline) abaixo24SemInline++; }
    if (b.width < 44 || b.height < 44) {
      abaixo44++;
      if (alvos.length < 10) alvos.push({ seletor: seletorDe(el), tag: el.tagName.toLowerCase(), larguraPx: arred(b.width, 1), alturaPx: arred(b.height, 1), inline, texto: norm(el.textContent || el.value || el.getAttribute('aria-label') || '').slice(0, 40) });
    }
  }

  // ---------- contraste ----------
  const cacheFundo = new WeakMap();
  const fundoEfetivo = (el) => {
    if (cacheFundo.has(el)) return cacheFundo.get(el);
    const cs = estilo(el);
    let r;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') r = { ind: true };
    else {
      const c = paraRgba(cs.backgroundColor);
      if (c && c[3] >= 0.995) r = { rgb: c.slice(0, 3) };
      else {
        const base = el.parentElement && el !== raiz ? fundoEfetivo(el.parentElement) : { rgb: fundoPagina.rgb || [255, 255, 255] };
        if (base.ind) r = base;
        else if (c && c[3] > 0) r = { rgb: compor(c, base.rgb) };
        else r = base;
      }
    }
    cacheFundo.set(el, r);
    return r;
  };
  let candContraste = textosParaContraste.filter((e) => !(e.disabled || e.closest('[disabled],[aria-disabled="true"]')));
  if (candContraste.length > MAX_CONTRASTE) {
    const passo = candContraste.length / MAX_CONTRASTE;
    const sel = [];
    for (let i = 0; i < MAX_CONTRASTE; i++) sel.push(candContraste[Math.floor(i * passo)]);
    candContraste = sel;
  }
  let avaliados = 0, indeterminados = 0, transparentes = 0, nFalhas = 0, razaoMin = null;
  const falhas = [];
  for (const el of candContraste) {
    const cs = estilo(el);
    const tc = paraRgba(cs.webkitTextFillColor || cs.color);
    if (!tc || tc[3] === 0) { transparentes++; continue; }
    const fe = fundoEfetivo(el);
    if (fe.ind) { indeterminados++; continue; }
    const op = opacidade(el);
    const texto = compor([tc[0], tc[1], tc[2], tc[3] * (op < 1 ? op : 1)], fe.rgb);
    const razao = razaoContraste(texto, fe.rgb);
    const t = num(cs.fontSize), peso = num(cs.fontWeight) || 400;
    const grande = t >= 24 || (t >= 18.66 && peso >= 700);
    const minimo = grande ? 3 : 4.5;
    avaliados++;
    if (razaoMin === null || razao < razaoMin) razaoMin = razao;
    if (razao < minimo) {
      nFalhas++;
      falhas.push({ seletor: seletorDe(el), texto: textoProprio(el).slice(0, 60), corTexto: hexDe(texto.concat([1])), corFundo: hexDe(fe.rgb.concat([1])), razao: arred(razao, 2), minimo, tamanhoPx: arred(t), peso: String(cs.fontWeight), grande });
    }
  }
  falhas.sort((a, b) => a.razao - b.razao);

  // ---------- emojis (todos os nós de texto visíveis) ----------
  const reEmoji = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*/gu;
  const reExcluir = /^[©®™‼⁉←-⇿⤴⤵⬅-⬇➡➔✓✔✖]/u;
  const emTipo = { titulo: 0, botao: 0, link: 0, span: 0, paragrafo: 0, outro: 0 };
  const emUnicos = new Set();
  const emLista = [];
  let emTotal = 0;
  const twE = doc.createTreeWalker(corpo, NodeFilter.SHOW_TEXT);
  let nE, nosVistos = 0;
  const porPai = new Map();
  while ((nE = twE.nextNode()) && nosVistos < 30000) {
    nosVistos++;
    const v = nE.nodeValue;
    if (!v || v.length > 5000 || !/[^\u0000- ]/.test(v)) continue;
    const ms = (v.match(reEmoji) || []).filter((x) => !reExcluir.test(x));
    if (!ms.length) continue;
    const pai = nE.parentElement;
    if (!pai || pai.closest('script,style,noscript,template,svg')) continue;
    if (!pai.getClientRects().length || estilo(pai).visibility === 'hidden' || opacidade(pai) < 0.01 || ehClone(pai)) continue;
    const r = porPai.get(pai) || [];
    r.push.apply(r, ms);
    porPai.set(pai, r);
  }
  for (const [pai, ms] of porPai) {
    const t = pai.tagName.toLowerCase();
    const tipo = /^h[1-6]$/.test(t) ? 'titulo' : (t === 'button' || pai.getAttribute('role') === 'button') ? 'botao' : t === 'a' ? 'link' : t === 'span' ? 'span' : t === 'p' ? 'paragrafo' : 'outro';
    emTipo[tipo] += ms.length;
    emTotal += ms.length;
    ms.forEach((x) => emUnicos.add(x));
    if (emLista.length < 30) emLista.push({ seletor: seletorDe(pai), tag: t, emojis: ms, texto: norm(pai.textContent).slice(0, 60) });
  }

  // ---------- imagens ----------
  const imgs = Array.prototype.slice.call(doc.images).slice(0, 500);
  let imgVis = 0, imgDist = 0, imgGrande = 0, imgSemNat = 0;
  const imgEx = [];
  for (const img of imgs) {
    if (!visivelEl(img)) continue;
    imgVis++;
    const b = caixa.get(img);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) { imgSemNat++; continue; }
    const fit = estilo(img).objectFit;
    const rAsp = b.width / b.height, rNat = nw / nh;
    const dist = (fit === 'fill' || fit === '') && Math.abs(rAsp / rNat - 1) > 0.05;
    const grande = nw > b.width * 2 && nh > b.height * 2;
    if (dist) imgDist++;
    if (grande) imgGrande++;
    if ((dist || grande) && imgEx.length < 10) imgEx.push({ seletor: seletorDe(img), renderW: Math.round(b.width), renderH: Math.round(b.height), naturalW: nw, naturalH: nh, razaoAspecto: arred(rAsp, 3), razaoNatural: arred(rNat, 3), objectFit: fit });
  }

  // ---------- overflow horizontal ----------
  // Em modo mobile o Chromium alarga o viewport de layout (innerWidth) quando o conteúdo estoura; por isso a referência é
  // min(innerWidth, screen.width) e não só innerWidth.
  const larguraRef = Math.min(vw, (window.screen && window.screen.width) || vw);
  const larguraDoc = raiz.scrollWidth;
  const ativoOverflow = larguraDoc > larguraRef;
  const culpados = [];
  if (ativoOverflow) {
    for (const el of candidatos) {
      const b = caixa.get(el);
      if (b.right + window.scrollX <= larguraRef + 1) continue;
      let preso = false;
      for (let a = el.parentElement; a && a !== raiz; a = a.parentElement) { const ov = estilo(a).overflowX; if (ov !== 'visible') { preso = true; break; } }
      if (!preso) culpados.push({ seletor: null, el, direitaPx: Math.round(b.right + window.scrollX) });
    }
    culpados.sort((a, b) => b.direitaPx - a.direitaPx);
  }

  // ---------- montagem ----------
  const tamOrd = ordenado(mTam);
  const tamLista = Array.from(mTam.keys()).map((k) => parseFloat(k)).sort((a, b) => a - b);
  const raioOrd = ordenado(mRaio);
  const raioChaves = Object.keys(raioOrd);
  const nomesAnim = Array.from(animPorNome.values()).sort((a, b) => b.elementos - a.elementos || a.nome.localeCompare(b.nome)).map((a) => {
    const kf = keyframes.get(a.nome) || null;
    return { nome: a.nome, elementos: a.elementos, duracaoMs: a.duracaoMs, easing: a.easing, iteracoes: a.iteracoes, anima: kf ? kf.props : null, ehEntrada: kf ? (kf.comecaInvisivel || (kf.props.indexOf('opacity') !== -1 || kf.props.indexOf('transform') !== -1)) : null };
  });
  const sombrasDet = Array.from(detSombra.values()).sort((a, b) => b.elementos - a.elementos).slice(0, 20).map((d) => ({ raw: d.raw, x: d.x, y: d.y, blur: d.blur, spread: d.spread, inset: d.inset, cor: d.cor, alfa: d.alfa, elementos: d.elementos, difusaGenerica: d.difusaGenerica, glow: d.glow }));
  const easingTr = ordenado(mTrEasing);
  const soPadrao = Object.keys(easingTr).length > 0 && Object.keys(easingTr).every((k) => k === 'ease');
  const matizOrd = ordenado(mMatiz);

  return {
    versao: 1,
    viewport: { largura: vw, altura: vh },
    amostra: { totalElementos: todos.length, visiveis: candidatos.length, amostrados: amostra.length, comTexto, truncado: candidatos.length > MAX_EL, fatorAmostragem: arred(candidatos.length / (amostra.length || 1), 2) },
    tipografia: {
      familias: { valores: ordenado(mFam), nDistintas: mFam.size, body: famBody, h1: famH1, pilhaBody: csBody.fontFamily.slice(0, 200), pilhaH1 },
      fontes: {
        declaradas: fontesDecl, carregadas: fontesDecl.filter((f) => f.status === 'loaded').length, temFonteCustom: fontesDecl.length > 0,
        bodyUsaFonteCustom: famCustom.has(famBody.toLowerCase()), h1UsaFonteCustom: famH1 ? famCustom.has(famH1.toLowerCase()) : false,
      },
      tamanhos: { valores: tamOrd, nDistintos: mTam.size, lista: tamLista, menorPx: tamLista.length ? tamLista[0] : null, maiorPx: tamLista.length ? tamLista[tamLista.length - 1] : null, abaixo12: { tamanhos: Array.from(tamPequenosSet).sort((a, b) => a - b), elementos: elementosPequenos, exemplos: tamanhosPequenos } },
      pesos: { valores: ordenado(mPeso), nDistintos: mPeso.size },
      body: { familia: famBody, tamanhoPx: arred(num(csBody.fontSize)), peso: String(csBody.fontWeight), lineHeightPx: lhPx(csBody), lineHeightRazao: csBody.lineHeight === 'normal' ? null : arred(num(csBody.lineHeight) / (num(csBody.fontSize) || 1), 3), cor: corBody ? hexDe(corBody) : null, fundo: fundoPagina.hex },
      h1,
      lineHeightCorpo: { amostras: lhRazoes.length, medianaRazao: lhRazoes.length ? arred(mediana(lhRazoes), 3) : null, normal: lhNormal },
      titulos,
      titulosGrandes: { minimoPx: 36, total: titulosGrandes, comTrackingNegativo: titulosGrandesNeg },
      paragrafos: { amostras: cpl.length, caracteresPorLinhaMediana: cpl.length ? mediana(cpl) : null, caracteresPorLinhaMax: cpl.length ? Math.max.apply(null, cpl) : null, exemplosLongos: longos.slice(0, 5).map((l) => ({ seletor: seletorDe(l.el), caracteresPorLinha: l.caracteresPorLinha, linhas: l.linhas })) },
    },
    cores: {
      texto: topCores(mCorTexto), fundo: topCores(mCorFundo), borda: topCores(mCorBorda), nDistintasTexto: mCorTexto.size, nDistintasFundo: mCorFundo.size,
      paginaFundo: { hex: fundoPagina.hex, indeterminado: fundoPagina.indeterminado },
      temaEscuro: fundoPagina.rgb ? lum(fundoPagina.rgb) < 0.2 : null,
      familiasDeMatiz: matizOrd,
      links: { total: linksTotal.n, porCor: ordenado(mLinks) },
      botoes: { total: botoes.length, porFundo: ordenado(mBotFundo), porCorTexto: ordenado(mBotCor), primario },
    },
    raios: {
      valores: raioOrd, nDistintos: raioChaves.length, dominante: raioChaves.length ? raioChaves[0] : null, fracaoDominante: raioComRaio ? arred(raioOrd[raioChaves[0]] / raioComRaio, 3) : 0, comRaio: raioComRaio, pilulas,
      porTipo: { botao: ordenado(mRaioTipo.botao), card: ordenado(mRaioTipo.card), campo: ordenado(mRaioTipo.campo), imagem: ordenado(mRaioTipo.imagem), outro: ordenado(mRaioTipo.outro) },
    },
    sombras: { elementos: nSombraEl, valores: ordenado(mSombra), detalhes: sombrasDet, elementosComDifusaGenerica: nSombraDifusa, elementosComGlow: nSombraGlow, elementosComSombraDura: nSombraDura, exemplosDifusa },
    cards: {
      total: cardsLista.length, padding: padOrd, paddingDominante: padChaves.length ? padChaves[0] : null, fracaoPaddingDominante: cardsLista.length ? arred(padOrd[padChaves[0]] / cardsLista.length, 3) : 0, nPaddingDistintos: padChaves.length,
      exemplos: exemplosCards, aninhados: { total: aninhados, raioFilhoMaiorQuePai: raioFilhoMaior, pares },
    },
    secoes: { itens: secoesItens, n: secoesItens.length, pares: paresOrd, nParesDistintos: parChaves.length, uniforme: secoesItens.length >= 2 && parChaves.length === 1, valorDominante: parChaves.length ? parChaves[0] : null, fracaoDominante: secoesItens.length ? arred(paresOrd[parChaves[0]] / secoesItens.length, 3) : 0 },
    layout: { centralizacao: { profundidadeMax: 3, blocos, centralizados: centrados, fracao: blocos ? arred(centrados / blocos, 3) : 0, porProfundidade: porProf, exemplos: exCentro }, grades, flexLinhas, heroes },
    gradientes: { elementos: gradEl, itens: gradItens, texto: { elementos: gradTextoEl, itens: gradTexto }, porTipo: ordenado(mGrad) },
    efeitos: { backdropBlur: { elementos: backdropN, exemplos: backdropEx }, filtros: { blur: blurN, blurGrande: blurGrandeN, dropShadow: dropShadowN }, textShadow: { elementos: tsN, saturados: tsSat }, willChange: { elementos: willN } },
    movimento: {
      animacoes: { elementos: animEl, porNome: nomesAnim, easing: ordenado(mAnimEasing), infinitas: animInfinitas },
      transicoes: { elementos: trEl, propriedades: ordenado(mTrProp), easing: easingTr, duracoesMs: ordenado(mTrDur), all: trAll, temCubicBezier: trCubic > 0, temEasingCustom: trCustom > 0, soEasingPadrao: soPadrao },
    },
    alvosToque: { total: totalAlvos, abaixo24, abaixo44, abaixo24SemInline, exemplos: alvos },
    contraste: { avaliados, indeterminados, textoTransparente: transparentes, falhas: nFalhas, razaoMinima: razaoMin === null ? null : arred(razaoMin, 2), itens: falhas.slice(0, 50) },
    emojis: { contagem: emTotal, unicos: Array.from(emUnicos), porTipo: emTipo, elementos: emLista },
    imagens: { total: imgs.length, visiveis: imgVis, distorcidas: imgDist, naturalMuitoMaiorQueRender: imgGrande, semTamanhoNatural: imgSemNat, exemplos: imgEx },
    overflowHorizontal: { ativo: ativoOverflow, larguraDocumento: larguraDoc, larguraViewport: vw, larguraReferencia: larguraRef, culpados: culpados.slice(0, 10).map((c) => ({ seletor: seletorDe(c.el), direitaPx: c.direitaPx })) },
  };
}
