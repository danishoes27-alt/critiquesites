// Função que roda DENTRO do navegador (page.evaluate). Precisa ser autossuficiente: nada de closures nem imports.
// Devolve um instantâneo serializável da página: textos, imagens, links, formulários, metadados,
// cada um marcado com visivel / ocultoPor / ariaOculto / clone.
export function extrairNoDom(opcoes) {
  const MAX_NOS = (opcoes && opcoes.maxNos) || 6000;
  const norm = (s) => (s || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const baixa = (s) => norm(s).toLowerCase();
  const doc = document;
  const raiz = doc.documentElement;

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

  // ---------- clones de carrossel ----------
  const raizesClone = new Set();
  const dicaClone = /(^|[-_ ])(clone|cloned|duplicate|duplicated)([-_ ]|$)/i;
  const todosAria = Array.prototype.slice.call(doc.querySelectorAll('[aria-hidden="true"]'));
  for (const e of todosAria) {
    if (e.parentElement && e.parentElement.closest('[aria-hidden="true"]')) continue; // só o topo
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

  // ---------- visibilidade ----------
  const cacheVis = new WeakMap();
  const temTransformacao = (el) => {
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 10; i++, e = e.parentElement) {
      const cs = getComputedStyle(e);
      if ((cs.transform && cs.transform !== 'none') || (cs.animationName && cs.animationName !== 'none')) return true;
    }
    return false;
  };
  const visInfo = (el) => {
    if (cacheVis.has(el)) return cacheVis.get(el);
    let r = { v: true, m: '' };
    const cs = getComputedStyle(el);
    if (cs.display === 'none') r = { v: false, m: 'display:none' };
    else if (cs.visibility === 'hidden' || cs.visibility === 'collapse') r = { v: false, m: 'visibility:hidden' };
    else if (parseFloat(cs.opacity) === 0) r = { v: false, m: 'opacity:0' };
    else {
      const pai = el.parentElement;
      if (pai && pai.nodeType === 1 && pai !== raiz) {
        const rp = visInfo(pai);
        if (!rp.v && /display|opacity|recortado|visibility|hidden/.test(rp.m)) r = { v: false, m: 'ancestral:' + rp.m };
      }
      if (r.v) {
        const rects = el.getClientRects();
        if (!rects.length) r = { v: false, m: 'display:none (ancestral)' };
        else {
          const b = el.getBoundingClientRect();
          const sx = window.scrollX, sy = window.scrollY;
          const dir = b.right + sx, topo = b.bottom + sy;
          if (b.width <= 1 && b.height <= 1 && cs.overflow !== 'visible') r = { v: false, m: 'somente-leitor-de-tela' };
          else if (b.width === 0 || b.height === 0) {
            // elementos inline sem caixa própria (ex.: <span> vazio) não contam como oculto por tamanho
            if (el.textContent && norm(el.textContent) && cs.display !== 'inline') r = { v: false, m: 'tamanho-zero' };
          } else if ((dir <= 0 || topo <= 0) && !temTransformacao(el)) r = { v: false, m: 'fora-da-tela' };
          else if (cs.clipPath && /inset\(\s*(50|100)%/.test(cs.clipPath)) r = { v: false, m: 'clip-path' };
        }
      }
      if (r.v && pai && pai.nodeType === 1) {
        // ancestral que recorta (overflow) com altura/largura zero: acordeão fechado, etc.
        let a = pai;
        for (let i = 0; a && a !== raiz && i < 6; i++, a = a.parentElement) {
          const ca = getComputedStyle(a);
          if (ca.overflow !== 'visible' || ca.overflowY !== 'visible' || ca.overflowX !== 'visible') {
            const ba = a.getBoundingClientRect();
            if (ba.height === 0 || ba.width === 0) { r = { v: false, m: 'recortado-por-ancestral' }; break; }
          }
        }
      }
    }
    cacheVis.set(el, r);
    return r;
  };
  const ariaOculto = (el) => !!el.closest('[aria-hidden="true"]');

  // ---------- nós de texto ----------
  const nos = [];
  let exibidosVistos = 0;
  const IGNORAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK']);
  const porElemento = new Map();
  const tw = doc.createTreeWalker(doc.body || raiz, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const pai = n.parentElement;
    if (!pai || IGNORAR.has(pai.tagName)) continue;
    if (pai.closest('script,style,noscript,template')) continue;
    const t = norm(n.nodeValue);
    if (!t) continue;
    if (!porElemento.has(pai)) porElemento.set(pai, []);
    porElemento.get(pai).push(t);
  }
  for (const [el, partes] of porElemento) {
    if (nos.length >= MAX_NOS) break;
    const vi = visInfo(el);
    // assinatura estável (classe + data-*): serve para casar o mesmo elemento entre versões quando o JS reestrutura o DOM
    const dadosAttr = Array.prototype.filter.call(el.attributes, (a) => a.name.indexOf('data-') === 0).slice(0, 4).map((a) => a.name + '=' + String(a.value).slice(0, 30)).join(';');
    // Valor EXIBIDO quando o texto real está invisível e o número é desenhado por CSS (::before/::after com content: attr(...)).
    // Só olhamos elementos com data-* (contadores, rótulos animados), no máximo 400, para não custar caro.
    let exibido = null;
    if (dadosAttr && exibidosVistos < 400) {
      exibidosVistos++;
      const corTexto = getComputedStyle(el).color;
      const transparente = /rgba\([^)]*,\s*0\)$/.test(corTexto) || corTexto === 'transparent';
      if (transparente) {
        for (const pseudo of ['::after', '::before']) {
          const c = getComputedStyle(el, pseudo).content;
          if (c && c !== 'none' && c !== 'normal') { const t = c.replace(/^["']|["']$/g, ''); if (t) { exibido = t.slice(0, 200); break; } }
        }
      }
    }
    nos.push({
      seletor: seletorDe(el),
      classe: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      dados: dadosAttr,
      exibido,
      tag: el.tagName.toLowerCase(),
      texto: partes.join(' ').slice(0, 600),
      visivel: vi.v,
      ocultoPor: vi.v ? '' : vi.m,
      ariaOculto: ariaOculto(el),
      clone: ehClone(el),
    });
  }

  // ---------- imagens ----------
  const imagens = Array.prototype.slice.call(doc.images).slice(0, 1500).map((img) => {
    const vi = visInfo(img);
    const b = img.getBoundingClientRect();
    const src = img.currentSrc || img.getAttribute('src') || '';
    return {
      seletor: seletorDe(img),
      src: src.startsWith('data:') ? 'data:' + src.slice(5, 30) + '…(' + src.length + ' chars)' : src.slice(0, 300),
      alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
      loading: img.getAttribute('loading'),
      fetchpriority: img.getAttribute('fetchpriority'),
      decoding: img.getAttribute('decoding'),
      temSrcset: img.hasAttribute('srcset') || (img.parentElement && img.parentElement.tagName === 'PICTURE'),
      larguraAttr: img.getAttribute('width'),
      alturaAttr: img.getAttribute('height'),
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      renderW: Math.round(b.width),
      renderH: Math.round(b.height),
      topo: Math.round(b.top + window.scrollY),
      visivel: vi.v,
      ocultoPor: vi.v ? '' : vi.m,
      ariaOculto: ariaOculto(img),
      clone: ehClone(img),
    };
  });

  // ---------- links ----------
  const links = Array.prototype.slice.call(doc.querySelectorAll('a[href]')).slice(0, 3000).map((a) => {
    const vi = visInfo(a);
    let interno = false;
    try { interno = new URL(a.href, location.href).host === location.host; } catch (e) { /* href estranho */ }
    const lb = a.getAttribute('aria-labelledby');
    let labelledbyTexto = '';
    if (lb) labelledbyTexto = norm(lb.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' '));
    const ctx = a.closest('li,p,td,section,article,div');
    return {
      seletor: seletorDe(a),
      hrefAttr: a.getAttribute('href'),
      href: a.href,
      texto: norm(a.textContent).slice(0, 200),
      ariaLabel: a.getAttribute('aria-label'),
      ariaLabelledbyTexto: labelledbyTexto,
      title: a.getAttribute('title'),
      rel: a.getAttribute('rel'),
      target: a.getAttribute('target'),
      interno,
      contexto: ctx ? norm(ctx.textContent).slice(0, 120) : '',
      visivel: vi.v,
      ocultoPor: vi.v ? '' : vi.m,
      ariaOculto: ariaOculto(a),
      clone: ehClone(a),
    };
  });

  // ---------- formulários ----------
  const formularios = Array.prototype.slice.call(doc.forms).slice(0, 50).map((f) => {
    const campos = Array.prototype.slice.call(f.elements).slice(0, 60).map((c) => {
      const id = c.id;
      const rotulo = (id && doc.querySelector('label[for="' + CSS.escape(id) + '"]')) || c.closest('label');
      return {
        tag: c.tagName.toLowerCase(), tipo: c.getAttribute('type'), nome: c.getAttribute('name'),
        obrigatorio: c.required === true, autocomplete: c.getAttribute('autocomplete'),
        temRotulo: !!(rotulo || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')),
        placeholder: c.getAttribute('placeholder'),
      };
    });
    const vi = visInfo(f);
    return { seletor: seletorDe(f), action: f.getAttribute('action'), metodo: (f.getAttribute('method') || 'get').toLowerCase(), campos, textoAoRedor: norm(f.textContent).slice(0, 300), visivel: vi.v, clone: ehClone(f) };
  });

  // ---------- headings ----------
  const headings = Array.prototype.slice.call(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 300).map((h) => {
    const vi = visInfo(h);
    return { nivel: Number(h.tagName[1]), texto: norm(h.textContent).slice(0, 200), seletor: seletorDe(h), visivel: vi.v, clone: ehClone(h) };
  });

  // ---------- metadados ----------
  const metas = Array.prototype.slice.call(doc.querySelectorAll('meta')).slice(0, 200).map((m) => ({
    nome: m.getAttribute('name'), propriedade: m.getAttribute('property'), httpEquiv: m.getAttribute('http-equiv'), conteudo: m.getAttribute('content'), charset: m.getAttribute('charset'),
  }));
  const linksHead = Array.prototype.slice.call(doc.querySelectorAll('link')).slice(0, 200).map((l) => ({
    rel: l.getAttribute('rel'), href: l.getAttribute('href'), hreflang: l.getAttribute('hreflang'), tipo: l.getAttribute('type'), as: l.getAttribute('as'), media: l.getAttribute('media'),
  }));

  // ---------- dados estruturados ----------
  const jsonld = Array.prototype.slice.call(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0, 50).map((s) => (s.textContent || '').slice(0, 60000));
  const microdata = Array.prototype.slice.call(doc.querySelectorAll('[itemtype]')).slice(0, 200).map((e) => e.getAttribute('itemtype'));
  const rdfa = Array.prototype.slice.call(doc.querySelectorAll('[typeof]')).slice(0, 200).map((e) => e.getAttribute('typeof'));

  // ---------- scripts e estilos ----------
  const scripts = Array.prototype.slice.call(doc.querySelectorAll('script')).filter((s) => s.type !== 'application/ld+json').slice(0, 200).map((s) => ({
    src: s.getAttribute('src'), tipo: s.getAttribute('type'), async: s.async, defer: s.defer, integrity: s.getAttribute('integrity'),
    inline: s.getAttribute('src') ? '' : (s.textContent || '').slice(0, 20000), tamanhoInline: s.getAttribute('src') ? 0 : (s.textContent || '').length,
  }));
  const folhas = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"]')).map((l) => l.getAttribute('href'));
  const estilosInline = Array.prototype.slice.call(doc.querySelectorAll('style')).slice(0, 100).map((s) => (s.textContent || '').slice(0, 200000));

  // ---------- comentários e atributos de texto ----------
  const comentarios = [];
  const tc = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  let c;
  while ((c = tc.nextNode()) && comentarios.length < 200) comentarios.push((c.nodeValue || '').slice(0, 600));
  const atributos = [];
  for (const el of Array.prototype.slice.call(doc.querySelectorAll('[alt],[title],[aria-label],[placeholder]')).slice(0, 800)) {
    for (const a of ['alt', 'title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) atributos.push({ seletor: seletorDe(el), atributo: a, valor: v.slice(0, 400) });
    }
  }
  const noscript = Array.prototype.slice.call(doc.querySelectorAll('noscript')).slice(0, 30).map((e) => (e.textContent || '').slice(0, 2000));

  return {
    url: location.href,
    titulo: doc.title,
    lang: raiz.getAttribute('lang'),
    dir: raiz.getAttribute('dir'),
    doctype: doc.doctype ? doc.doctype.name : null,
    viewportMeta: (doc.querySelector('meta[name="viewport"]') || {}).content || null,
    totalElementos: doc.getElementsByTagName('*').length,
    alturaDocumento: Math.max(raiz.scrollHeight, doc.body ? doc.body.scrollHeight : 0),
    larguraDocumento: Math.max(raiz.scrollWidth, doc.body ? doc.body.scrollWidth : 0),
    nos, imagens, links, formularios, headings, metas, linksHead, jsonld, microdata, rdfa, scripts, folhas, estilosInline, comentarios, atributos, noscript,
    clonesDetectados: raizesClone.size,
  };
}
