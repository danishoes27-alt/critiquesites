// Medidor "js" (SPEC §5, PLAN M2.3): bibliotecas/frameworks, scripts, JS próprio baixado, erros de console,
// requisições falhadas e TAGS DE ANALYTICS (GA4, GTM, UA, Meta Pixel, TikTok, Hotjar, Clarity, Google Ads).
//
// Princípio: o script MEDE (fato + evidência reproduzível), o modelo julga. Nada do site é executado em Node:
// só varredura de texto sobre o que o extrator já trouxe (extr.scripts, extr.noscript, ctx.ativos, console, requisições).
//
// Campos principais de `dados`:
//   bibliotecas[]            { id, nome, tipo, versao|null, deteccoes[{origem,pagina,trecho}] }
//   scripts                  { porPagina[], externosUnicos, propriosUnicos, terceirosUnicos, inlineUnicos, inlineBytes }
//   jsProprio                { quantidade, bytesTotal, arquivos[{url,bytes,status}], naoBaixados[] }
//   dominiosTerceiros[]      { host, scripts, rastreador, categoria|null }
//   console                  { erros, pageErros, avisos, porPagina[], amostra[] }
//   requisicoesFalhadas[]    { pagina, url, motivo }   (+ requisicoesBloqueadasPeloAnalisador)
//   tags[]                   { tipo, id, valido, vazio, problema, vistas[{pagina,origem,versoes,trecho,executavel}] }
//   analytics                { porTipo, vazias[], validas[], invalidas[], temTagVazia }
//   scriptsDeRastreamentoPresentes, rastreadores[]
import { saidaMedidor } from '../contexto.mjs';

export const id = 'js';
export const VERSAO = '1';

const NOMES_TAG = {
  ga4: 'Google Analytics 4', gtm: 'Google Tag Manager', ua: 'Universal Analytics (antigo)', ads: 'Google Ads',
  'meta-pixel': 'Meta Pixel', tiktok: 'TikTok Pixel', hotjar: 'Hotjar', clarity: 'Microsoft Clarity', 'gtag-outro': 'gtag (id desconhecido)',
};

// ---------------------------------------------------------------------------------------------------------
// ID de analytics: classificação de formato / vazio / placeholder
// ---------------------------------------------------------------------------------------------------------
const PREFIXOS = { ga4: 'G-', gtm: 'GTM-', ua: 'UA-', ads: 'AW-' };
const FORMATOS = {
  ga4: /^G-[A-Z0-9]{6,12}$/,
  gtm: /^GTM-[A-Z0-9]{4,9}$/,
  ua: /^UA-\d{4,10}-\d{1,3}$/,
  ads: /^AW-\d{8,12}$/,
  'meta-pixel': /^\d{10,20}$/,
  tiktok: /^[A-Z0-9]{16,24}$/,
  hotjar: /^\d{5,10}$/,
  clarity: /^[a-z0-9]{8,12}$/,
};

function ehPlaceholder(corpo) {
  const s = String(corpo);
  if (/^[0\-_xX9]+$/.test(s)) return true; // 0000, XXXX, 9999, ----
  if (/^(1234567890?|123456789012345|abcdef?|abc123)$/i.test(s)) return true;
  if (/x{4,}/i.test(s)) return true; // G-XXXXXXXXXX, UA-XXXXX-Y
  if (/(seu|sua|your|exemplo|example|aqui|here|insert|replace|troque|placeholder|changeme|pixel_?id|tag_?id|meu_?id|measurement|id_?aqui)/i.test(s)) return true;
  if (/[{}$<>%\[\]]/.test(s)) return true; // {{pixel_id}}, ${id}, <ID>, [ID]
  return false;
}

// Devolve { valido: true|false|null, vazio, problema: null|'vazio'|'placeholder'|'formato-invalido'|'id-nao-numerico'|'id-dinamico' }.
// vazio = tag instalada com ID vazio ou placeholder. valido = formato correto (e não é placeholder).
export function classificarId(tipo, idBruto, { dinamico = false } = {}) {
  const v = String(idBruto ?? '').trim();
  const prefixo = PREFIXOS[tipo];
  const corpo = prefixo && v.toUpperCase().startsWith(prefixo) ? v.slice(prefixo.length) : v;
  if (v === '' || corpo === '') return { valido: false, vazio: true, problema: 'vazio' };
  if (dinamico) return { valido: null, vazio: false, problema: 'id-dinamico' }; // variável JS (sem aspas): não dá para saber o valor
  if (ehPlaceholder(corpo)) return { valido: false, vazio: true, problema: 'placeholder' };
  if (tipo === 'gtag-outro') return { valido: null, vazio: false, problema: null };
  const fmt = FORMATOS[tipo];
  if (fmt && fmt.test(v)) return { valido: true, vazio: false, problema: null };
  if (tipo === 'meta-pixel' && !/^\d+$/.test(v)) return { valido: false, vazio: false, problema: 'id-nao-numerico' };
  return { valido: false, vazio: false, problema: 'formato-invalido' };
}

// Tipo da tag a partir do valor de gtag('config', X) ou de gtag/js?id=X.
function tipoPeloValor(v) {
  const s = String(v ?? '');
  if (/^G-/i.test(s)) return { tipo: 'ga4', assumido: false };
  if (/^UA-/i.test(s)) return { tipo: 'ua', assumido: false };
  if (/^AW-/i.test(s)) return { tipo: 'ads', assumido: false };
  if (/^GTM-/i.test(s)) return { tipo: 'gtm', assumido: false };
  if (s === '' || ehPlaceholder(s)) return { tipo: 'ga4', assumido: true };
  return { tipo: 'gtag-outro', assumido: false };
}

// Detectores aplicados ao ATRIBUTO src de scripts (e ao conteúdo de <noscript>, que traz marcação).
const DET_SRC = [
  { re: /googletagmanager\.com\/gtag\/js\?(?:[^#"'\s]*&)?id=([^&#"'\s<>]*)/gi, tipo: (v) => tipoPeloValor(v).tipo },
  { re: /googletagmanager\.com\/gtm\.js\?(?:[^#"'\s]*&)?id=([^&#"'\s<>]*)/gi, tipo: () => 'gtm' },
  { re: /googletagmanager\.com\/ns\.html\?(?:[^#"'\s]*&)?id=([^&#"'\s<>]*)/gi, tipo: () => 'gtm' },
  { re: /facebook\.com\/tr\/?\?(?:[^#"'\s>]*&)?id=([^&#"'\s<>]*)/gi, tipo: () => 'meta-pixel' },
  { re: /analytics\.tiktok\.com\/i18n\/pixel\/[\w.]+\?(?:[^#"'\s]*&)?sdkid=([^&#"'\s<>]*)/gi, tipo: () => 'tiktok' },
  { re: /static\.hotjar\.com\/c\/hotjar-([^./"'\s?]*)\.js/gi, tipo: () => 'hotjar' },
  { re: /clarity\.ms\/tag\/([^?#"'\s<>/]*)/gi, tipo: () => 'clarity' },
];

// Detectores aplicados a código JavaScript (inline ou arquivo próprio baixado).
const DET_CODIGO = [
  { re: /gtag\(\s*['"]config['"]\s*,\s*['"]([^'"]*)['"]/g, tipo: (v) => tipoPeloValor(v).tipo },
  { re: /\(\s*window\s*,\s*document\s*,\s*['"]script['"]\s*,\s*['"][\w$]+['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g, tipo: () => 'gtm' },
  { re: /['"](GTM-[A-Za-z0-9]*)['"]/g, tipo: () => 'gtm' },
  { re: /fbq\(\s*['"]init['"]\s*,\s*['"]([^'"]*)['"]/g, tipo: () => 'meta-pixel' },
  { re: /fbq\(\s*['"]init['"]\s*,\s*(\d+)\s*[,)]/g, tipo: () => 'meta-pixel' },
  { re: /fbq\(\s*['"]init['"]\s*,\s*([A-Za-z_$][\w$.]*)\s*[,)]/g, tipo: () => 'meta-pixel', dinamico: true },
  { re: /ttq\.load\(\s*['"]([^'"]*)['"]/g, tipo: () => 'tiktok' },
  { re: /hjid\s*:\s*['"]?([^,'"}\s]*)['"]?/g, tipo: () => 'hotjar' },
  { re: /['"]clarity['"]\s*,\s*['"]script['"]\s*,\s*['"]([^'"]*)['"]/g, tipo: () => 'clarity' },
  { re: /\bga\(\s*['"]create['"]\s*,\s*['"]([^'"]*)['"]/g, tipo: () => 'ua' },
  { re: /_setAccount['"]\s*,\s*['"]([^'"]*)['"]/g, tipo: () => 'ua' },
];

const corta = (s, n = 200) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; };

// Procura tags de analytics em um texto. modo: 'src' (atributo src / <noscript>) ou 'codigo' (JS).
// Devolve [{ tipo, id, trecho }]. Exportada para reuso (ex.: medidor de lei).
export function detectarTagsEmTexto(texto, modo = 'codigo') {
  const out = [];
  const lista = modo === 'src' ? DET_SRC : DET_CODIGO;
  const t = String(texto ?? '');
  for (const d of lista) {
    d.re.lastIndex = 0;
    let m;
    while ((m = d.re.exec(t))) {
      const idBruto = (m[1] ?? '').trim();
      out.push({ tipo: d.tipo(idBruto), id: idBruto, trecho: corta(m[0]), ...(d.dinamico ? { dinamico: true } : {}) });
      if (m[0].length === 0) d.re.lastIndex++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Bibliotecas e frameworks
// ---------------------------------------------------------------------------------------------------------
const ASSINATURAS = [
  { id: 'jquery', nome: 'jQuery', tipo: 'biblioteca', url: /jquery(?:[-.@]?\d+\.\d+(?:\.\d+)?)?(?:\.slim)?(?:\.min)?\.js/i, codigo: /jQuery(?: JavaScript Library)? v(\d+\.\d+\.\d+)|\bjQuery\.fn\.jquery\b/, versaoCodigo: /jQuery(?: JavaScript Library)? v(\d+\.\d+\.\d+)/ },
  { id: 'react', nome: 'React', tipo: 'framework', url: /\/react(?:-dom)?(?:@[\d.]+)?\/umd\/|react(?:-dom)?\.(?:production|development)(?:\.min)?\.js|unpkg\.com\/react(?:-dom)?@|cdn\.jsdelivr\.net\/npm\/react(?:-dom)?@/i, codigo: /__REACT_DEVTOOLS_GLOBAL_HOOK__|ReactDOM\.(?:render|hydrate|createRoot|hydrateRoot)\s*\(|React\.createElement\s*\(/, html: /\sdata-reactroot\b|\sdata-react-helmet\b/ },
  { id: 'next', nome: 'Next.js', tipo: 'framework', url: /\/_next\/static\//, html: /id=["']__next["']|__NEXT_DATA__/ },
  { id: 'nuxt', nome: 'Nuxt', tipo: 'framework', url: /\/_nuxt\//, html: /id=["']__nuxt["']|window\.__NUXT__/ },
  { id: 'vue', nome: 'Vue', tipo: 'framework', url: /(?:^|[\/@._-])vue(?:\.global|\.runtime(?:\.global)?|\.esm-browser)?(?:\.prod)?(?:\.min)?\.js|\/vue@\d/i, codigo: /Vue\.createApp\s*\(|new Vue\s*\(|__VUE_DEVTOOLS_GLOBAL_HOOK__/, html: /\sdata-v-[0-9a-f]{6,}|\sdata-server-rendered=["']true/ },
  { id: 'angular', nome: 'Angular', tipo: 'framework', url: /\/angular(?:js)?(?:[.\/@-][\d.]+)?(?:\.min)?\.js|@angular\//i, codigo: /angular\.module\s*\(/, html: /\sng-version=["']([\d.]+)["']|\sng-app\b|\sng-controller=/, versaoHtml: /\sng-version=["']([\d.]+)["']/ },
  { id: 'alpine', nome: 'Alpine.js', tipo: 'framework', url: /alpinejs|\/alpine(?:\.min)?\.js/i, codigo: /Alpine\.(?:start|data)\s*\(/, html: /\sx-data=/ },
  { id: 'svelte', nome: 'Svelte', tipo: 'framework', url: /\/_app\/immutable\//, html: /\sclass=["'][^"']*\bsvelte-[a-z0-9]{5,}/ },
  { id: 'htmx', nome: 'htmx', tipo: 'biblioteca', url: /htmx(?:\.min)?\.js|htmx\.org|\/htmx@/i, html: /\shx-(?:get|post|trigger|target|swap)=/ },
  { id: 'gsap', nome: 'GSAP', tipo: 'animacao', url: /gsap(?:\.min)?\.js|\/gsap@|TweenMax|TweenLite|ScrollTrigger|ajax\/libs\/gsap/i, codigo: /gsap\.(?:to|from|fromTo|timeline|registerPlugin|set)\s*\(|TweenMax\./ },
  { id: 'swiper', nome: 'Swiper', tipo: 'biblioteca', url: /swiper(?:-bundle)?(?:\.min)?\.js|\/swiper@\d|\/swiper\//i, codigo: /new Swiper\s*\(/, html: /\bswiper-wrapper\b/ },
  { id: 'aos', nome: 'AOS (Animate On Scroll)', tipo: 'animacao', url: /\baos(?:\.min)?\.js|\/aos@|\/aos\/\d/i, codigo: /AOS\.init\s*\(/, html: /\sdata-aos=/ },
  { id: 'lottie', nome: 'Lottie', tipo: 'animacao', url: /lottie(?:-player|\.min)?(?:\.js)?|dotlottie|lottiefiles/i, html: /<(?:dot)?lottie-player/ },
  { id: 'three', nome: 'three.js', tipo: 'biblioteca', url: /\/three(?:\.module)?(?:\.min)?\.js|\/three@\d/i },
  { id: 'tailwind-cdn', nome: 'Tailwind (CDN/JIT no navegador)', tipo: 'css', url: /cdn\.tailwindcss\.com|@tailwindcss\/browser/i, codigo: /tailwind\.config\s*=/ },
  { id: 'bootstrap', nome: 'Bootstrap', tipo: 'css', url: /bootstrap(?:\.bundle)?(?:\.min)?\.js|bootstrap@\d[\d.]*\/dist\/js/i, css: /bootstrap(?:\.min)?\.css|bootstrap@\d[\d.]*\/dist\/css/i, codigo: /Bootstrap v(\d+\.\d+\.\d+)/, versaoCodigo: /Bootstrap v(\d+\.\d+\.\d+)/ },
  { id: 'lodash', nome: 'Lodash', tipo: 'biblioteca', url: /lodash(?:\.core)?(?:\.min)?\.js|\/lodash@/i },
  { id: 'axios', nome: 'axios', tipo: 'biblioteca', url: /axios(?:\.min)?\.js|\/axios@/i, codigo: /axios\.(?:get|post|create)\s*\(/ },
  { id: 'moment', nome: 'Moment.js', tipo: 'biblioteca', url: /moment(?:\.min|-with-locales(?:\.min)?)?\.js|\/moment@/i },
  { id: 'wordpress', nome: 'WordPress', tipo: 'cms', url: /\/wp-(?:content|includes)\//, html: /\/wp-content\/|\/wp-includes\/|<meta[^>]+name=["']generator["'][^>]+WordPress/i },
];

function versaoDaUrl(url) {
  const m = String(url).match(/@(\d+\.\d+(?:\.\d+)?)/) || String(url).match(/[-\/](\d+\.\d+\.\d+)(?:[\/.]|$)/) || String(url).match(/[-.](\d+\.\d+(?:\.\d+)?)(?=\.min\.js|\.js|\.min\.css|\.css)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------------------------------------
// Domínios de rastreamento (para a regra de cookies/consentimento)
// ---------------------------------------------------------------------------------------------------------
const RASTREADORES = [
  ['googletagmanager.com', 'analytics'], ['google-analytics.com', 'analytics'], ['analytics.google.com', 'analytics'],
  ['hotjar.com', 'analytics'], ['clarity.ms', 'analytics'], ['cdn.segment.com', 'analytics'], ['mixpanel.com', 'analytics'],
  ['amplitude.com', 'analytics'], ['fullstory.com', 'analytics'], ['mouseflow.com', 'analytics'], ['plausible.io', 'analytics'],
  ['connect.facebook.net', 'publicidade'], ['facebook.net', 'publicidade'], ['doubleclick.net', 'publicidade'],
  ['googleadservices.com', 'publicidade'], ['googlesyndication.com', 'publicidade'], ['analytics.tiktok.com', 'publicidade'],
  ['snap.licdn.com', 'publicidade'], ['px.ads.linkedin.com', 'publicidade'], ['static.ads-twitter.com', 'publicidade'],
  ['bat.bing.com', 'publicidade'], ['s.pinimg.com', 'publicidade'], ['criteo.com', 'publicidade'], ['taboola.com', 'publicidade'],
  ['outbrain.com', 'publicidade'],
];
export function categoriaRastreador(host) {
  const h = String(host).toLowerCase().replace(/:\d+$/, '');
  for (const [suf, cat] of RASTREADORES) if (h === suf || h.endsWith('.' + suf)) return cat;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Utilidades de contexto
// ---------------------------------------------------------------------------------------------------------
const VERSOES = ['cru', 'dom250', 'final'];
const caminhoDe = (p) => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url || '/'; } };
const extrDe = (p, v) => p[v]?.extr || null;

function ehExecutavel(tipo) {
  const t = String(tipo ?? '').trim().toLowerCase();
  return t === '' || t === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(t);
}

function hostDe(src, base) {
  try { return new URL(src, base).host; } catch { return null; }
}

function semWww(h) { return String(h).toLowerCase().replace(/^www\./, ''); }
function ehProprio(host, hostSite) {
  if (!host) return false;
  if (host.toLowerCase() === String(hostSite).toLowerCase()) return true;
  const a = semWww(host.replace(/:\d+$/, ''));
  const b = semWww(String(hostSite).replace(/:\d+$/, ''));
  if (/^[\d.]+$/.test(b) || b.includes(':')) return a === b && host.split(':')[1] === String(hostSite).split(':')[1];
  return a === b || a.endsWith('.' + b);
}

// ---------------------------------------------------------------------------------------------------------
// medir
// ---------------------------------------------------------------------------------------------------------
export async function medir(ctx) {
  const evidencias = [];
  const hostSite = ctx.site?.host || '';
  const paginas = ctx.paginas || [];

  // ---- tags de analytics -----------------------------------------------------------------------------
  const tags = new Map(); // tipo|id -> registro
  const registrar = (tipo, idBruto, vista) => {
    const dinamico = vista.dinamico === true;
    const chave = `${tipo}|${idBruto}|${dinamico}`;
    let reg = tags.get(chave);
    if (!reg) {
      reg = { tipo, nome: NOMES_TAG[tipo] || tipo, id: idBruto, ...classificarId(tipo, idBruto, { dinamico }), vistas: [] };
      if (tipo === 'ga4' && reg.tipoAssumido === undefined) reg.tipoAssumido = tipoPeloValor(idBruto).assumido;
      tags.set(chave, reg);
    }
    // uma vista por (página, origem): a mesma tag citada duas vezes no mesmo trecho de código não vira duas ocorrências
    const existente = reg.vistas.find((x) => x.pagina === vista.pagina && x.origem === vista.origem && (x.origem !== 'src' || x.trecho === vista.trecho) && (x.origem !== 'ativo' || x.ativo === vista.ativo));
    if (existente) { if (!existente.versoes.includes(vista.versao)) existente.versoes.push(vista.versao); return; }
    reg.vistas.push({ pagina: vista.pagina, origem: vista.origem, versoes: [vista.versao], trecho: vista.trecho, executavel: vista.executavel, ...(vista.ativo ? { ativo: vista.ativo } : {}) });
  };

  // ---- bibliotecas ------------------------------------------------------------------------------------
  const bibs = new Map();
  const marcarBib = (assin, origem, pagina, trecho, versao) => {
    let b = bibs.get(assin.id);
    if (!b) { b = { id: assin.id, nome: assin.nome, tipo: assin.tipo, versao: null, deteccoes: [] }; bibs.set(assin.id, b); }
    if (versao && !b.versao) b.versao = versao;
    if (b.deteccoes.length < 12 && !b.deteccoes.some((d) => d.origem === origem && d.pagina === pagina && d.trecho === trecho)) b.deteccoes.push({ origem, pagina, trecho: corta(trecho) });
  };
  const bibsEmUrl = (url, origem, pagina) => {
    for (const a of ASSINATURAS) if (a.url && a.url.test(url)) marcarBib(a, origem, pagina, url, versaoDaUrl(url));
  };
  const bibsEmCodigo = (codigo, origem, pagina) => {
    for (const a of ASSINATURAS) {
      if (!a.codigo) continue;
      const m = a.codigo.exec(codigo);
      if (m) { const v = a.versaoCodigo ? (a.versaoCodigo.exec(codigo) || [])[1] : null; marcarBib(a, origem, pagina, m[0], v || null); }
    }
  };

  // ---- scripts por página / domínios -----------------------------------------------------------------
  const porPagina = [];
  const externos = new Map(); // url resolvida -> { proprio }
  const inlines = new Set();
  let inlineBytes = 0;
  const dominios = new Map(); // host -> { scripts:Set(url), executavel }
  const consolePorPagina = [];
  const amostraConsole = [];
  const falhadas = [];
  const vistasFalha = new Set();
  let bloqueadasAnalisador = 0;

  for (const p of paginas) {
    const pagina = caminhoDe(p);
    const base = p.final?.extr?.url || p.url;

    // varredura de tags e bibliotecas em todas as versões disponíveis
    for (const versao of VERSOES) {
      const ex = extrDe(p, versao);
      if (!ex) continue;
      for (const s of ex.scripts || []) {
        const executavel = ehExecutavel(s.tipo);
        if (s.src) {
          for (const d of detectarTagsEmTexto(s.src, 'src')) registrar(d.tipo, d.id, { pagina, origem: 'src', versao, trecho: corta(s.src), executavel });
          bibsEmUrl(s.src, 'src', pagina);
        } else if (s.inline) {
          for (const d of detectarTagsEmTexto(s.inline, 'codigo')) registrar(d.tipo, d.id, { pagina, origem: 'inline', versao, trecho: d.trecho, executavel, dinamico: d.dinamico });
          bibsEmCodigo(s.inline, 'inline', pagina);
        }
      }
      for (const ns of ex.noscript || []) {
        for (const d of detectarTagsEmTexto(ns, 'src')) registrar(d.tipo, d.id, { pagina, origem: 'noscript', versao, trecho: d.trecho, executavel: true });
      }
      if (versao === 'final') for (const f of ex.folhas || []) {
        for (const a of ASSINATURAS) if (a.css && a.css.test(f || '')) marcarBib(a, 'css', pagina, f, versaoDaUrl(f));
      }
    }
    const htmlMarcadores = p.final?.html || p.cru?.html || '';
    for (const a of ASSINATURAS) {
      if (!a.html) continue;
      const m = a.html.exec(htmlMarcadores);
      if (m) marcarBib(a, 'html', pagina, m[0], a.versaoHtml ? (a.versaoHtml.exec(htmlMarcadores) || [])[1] || null : null);
    }

    // contagem de scripts no DOM final (fallback: dom250, cru)
    const exConta = extrDe(p, 'final') || extrDe(p, 'dom250') || extrDe(p, 'cru');
    const linha = { pagina, total: 0, inline: 0, externos: 0, proprios: 0, terceiros: 0, async: 0, defer: 0, bloqueantes: 0, modulos: 0, naoExecutaveis: 0 };
    for (const s of exConta?.scripts || []) {
      if (!ehExecutavel(s.tipo)) { linha.naoExecutaveis++; }
      else linha.total++;
      if (s.src) {
        const host = hostDe(s.src, base);
        let url = s.src;
        try { url = new URL(s.src, base).toString(); } catch { /* mantém o original */ }
        const proprio = ehProprio(host, hostSite);
        if (host) {
          if (!dominios.has(host)) dominios.set(host, { scripts: new Set(), proprio });
          dominios.get(host).scripts.add(url);
        }
        if (!ehExecutavel(s.tipo)) continue;
        linha.externos++;
        if (proprio) linha.proprios++; else linha.terceiros++;
        const modulo = String(s.tipo || '').toLowerCase() === 'module';
        if (modulo) linha.modulos++;
        if (s.async) linha.async++;
        if (s.defer) linha.defer++;
        if (!s.async && !s.defer && !modulo) linha.bloqueantes++;
        if (!externos.has(url)) externos.set(url, { proprio });
      } else if (ehExecutavel(s.tipo)) {
        linha.inline++;
        const chave = s.inline || '';
        if (chave && !inlines.has(chave)) { inlines.add(chave); inlineBytes += s.tamanhoInline || chave.length; }
      }
    }
    porPagina.push(linha);

    // console
    const cs = { pagina, erros: 0, pageErros: 0, avisos: 0 };
    for (const c of p.console || []) {
      if (c.tipo === 'error') cs.erros++;
      else if (c.tipo === 'pageerror') cs.pageErros++;
      else if (c.tipo === 'warning') cs.avisos++;
      if ((c.tipo === 'error' || c.tipo === 'pageerror') && amostraConsole.length < 20) amostraConsole.push({ pagina, tipo: c.tipo, texto: corta(c.texto) });
    }
    consolePorPagina.push(cs);

    // requisições falhadas
    for (const r of p.requisicoes || []) {
      let motivo = null;
      if (r.falhou) {
        if (/ERR_BLOCKED_BY_CLIENT/i.test(r.falhou)) { bloqueadasAnalisador++; continue; }
        motivo = r.falhou;
      } else if (typeof r.status === 'number' && r.status >= 400) motivo = `status ${r.status}`;
      if (!motivo) continue;
      const chave = `${pagina}|${r.url}|${motivo}`;
      if (vistasFalha.has(chave) || falhadas.length >= 100) continue;
      vistasFalha.add(chave);
      falhadas.push({ pagina, url: r.url, motivo });
    }
  }

  // ---- ativos baixados (JS próprio) ------------------------------------------------------------------
  const jsProprioArquivos = [];
  const naoBaixados = [];
  for (const a of ctx.ativos || []) {
    if (a.tipo !== 'js') continue;
    if (a.terceiro) continue;
    if (a.texto == null) { naoBaixados.push({ url: a.url, motivo: a.erro || 'sem conteúdo' }); continue; }
    jsProprioArquivos.push({ url: a.url, bytes: a.bytes, status: a.status });
    for (const d of detectarTagsEmTexto(a.texto, 'codigo')) registrar(d.tipo, d.id, { pagina: null, origem: 'ativo', versao: 'js', trecho: d.trecho, executavel: true, ativo: a.url, dinamico: d.dinamico });
    bibsEmCodigo(a.texto, 'ativo', null);
  }

  // ---- montagem ----------------------------------------------------------------------------------------
  const listaTags = [...tags.values()].sort((a, b) => (a.tipo + '|' + a.id).localeCompare(b.tipo + '|' + b.id, 'en'));
  const rastreioTipos = new Set(listaTags.map((t) => t.tipo));
  const dominiosTerceiros = [...dominios.entries()]
    .filter(([, v]) => !v.proprio)
    .map(([host, v]) => { const cat = categoriaRastreador(host); return { host, scripts: v.scripts.size, rastreador: cat !== null, categoria: cat }; })
    .sort((a, b) => a.host.localeCompare(b.host, 'en'));

  const executaveisRastreio = listaTags.some((t) => t.vistas.some((v) => v.executavel)) || dominiosTerceiros.some((d) => {
    if (!d.rastreador) return false;
    // há ao menos um script executável desse domínio? (tipo text/plain = bloqueado até consentimento)
    for (const p of paginas) for (const v of VERSOES) for (const s of extrDe(p, v)?.scripts || []) {
      if (s.src && ehExecutavel(s.tipo) && hostDe(s.src, p.final?.extr?.url || p.url) === d.host) return true;
    }
    return false;
  });

  const porTipo = {};
  for (const t of listaTags) {
    const o = (porTipo[t.tipo] ||= { encontradas: 0, validas: 0, vazias: 0, invalidas: 0, naoVerificaveis: 0 });
    o.encontradas++;
    if (t.vazio) o.vazias++;
    else if (t.valido === true) o.validas++;
    else if (t.valido === false) o.invalidas++;
    else o.naoVerificaveis++;
  }
  const resumoTag = (t) => ({ tipo: t.tipo, id: t.id, problema: t.problema });
  const analytics = {
    porTipo,
    validas: listaTags.filter((t) => t.valido === true).map(resumoTag),
    vazias: listaTags.filter((t) => t.vazio).map(resumoTag),
    invalidas: listaTags.filter((t) => !t.vazio && t.valido === false).map(resumoTag),
    temTagVazia: listaTags.some((t) => t.vazio),
  };

  const sum = (k) => consolePorPagina.reduce((a, c) => a + c[k], 0);
  const dados = {
    paginasAnalisadas: paginas.length,
    bibliotecas: [...bibs.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    scripts: {
      porPagina,
      externosUnicos: externos.size,
      propriosUnicos: [...externos.values()].filter((x) => x.proprio).length,
      terceirosUnicos: [...externos.values()].filter((x) => !x.proprio).length,
      inlineUnicos: inlines.size,
      inlineBytes,
    },
    jsProprio: {
      quantidade: jsProprioArquivos.length,
      bytesTotal: jsProprioArquivos.reduce((a, x) => a + (x.bytes || 0), 0),
      arquivos: jsProprioArquivos,
      naoBaixados,
    },
    dominiosTerceiros,
    console: { erros: sum('erros'), pageErros: sum('pageErros'), avisos: sum('avisos'), porPagina: consolePorPagina, amostra: amostraConsole },
    requisicoesFalhadas: falhadas,
    requisicoesBloqueadasPeloAnalisador: bloqueadasAnalisador,
    tags: listaTags,
    analytics,
    rastreadores: [...rastreioTipos].sort(),
    scriptsDeRastreamentoPresentes: executaveisRastreio,
  };

  // ---- evidências ---------------------------------------------------------------------------------------
  for (const t of listaTags) {
    for (const v of t.vistas.slice(0, 2)) {
      evidencias.push({
        pagina: v.pagina, versao: v.versoes[0], seletor: v.origem === 'src' ? `script[src="${v.trecho}"]` : v.origem === 'noscript' ? 'noscript' : 'script',
        trecho: v.trecho, valor: `${t.tipo}:${t.id}`, contagem: t.vistas.length, visivel: null,
      });
    }
  }
  for (const b of dados.bibliotecas) {
    const d = b.deteccoes[0];
    if (d) evidencias.push({ pagina: d.pagina, versao: 'final', seletor: d.origem === 'src' ? `script[src="${d.trecho}"]` : d.origem, trecho: d.trecho, valor: `lib:${b.id}${b.versao ? '@' + b.versao : ''}`, contagem: b.deteccoes.length, visivel: null });
  }
  for (const a of dados.console.amostra.slice(0, 10)) evidencias.push({ pagina: a.pagina, versao: 'final', seletor: 'console', trecho: a.texto, valor: a.tipo, contagem: 1, visivel: null });

  return saidaMedidor(id, dados, evidencias, VERSAO);
}
