// Baixa os arquivos CSS e JS referenciados pelas páginas (só para ANÁLISE de texto; nada é executado em Node).
// CSS: todos (até o limite). JS: só do mesmo domínio do site; scripts de terceiros entram só como URL.
import { buscarSeguro } from './rede-segura.mjs';
import { sha256 } from './util.mjs';

export async function carregarAtivos(paginas, { hostSite, permitidos = [], permitirLocal = false, maxAtivos = 40, maxBytes = 3 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  const vistos = new Map(); // url -> { tipo, terceiro }
  const mais = (href, base, tipo) => {
    if (!href) return;
    let u;
    try { u = new URL(href, base); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    u.hash = '';
    const url = u.toString();
    if (!vistos.has(url)) vistos.set(url, { tipo, terceiro: u.host !== hostSite });
  };
  for (const p of paginas) {
    const ex = p.final?.extr || p.cru?.extr;
    if (!ex) continue;
    const base = p.final?.extr?.url || p.url;
    for (const f of ex.folhas || []) mais(f, base, 'css');
    for (const s of ex.scripts || []) mais(s.src, base, 'js');
  }
  const saida = [];
  let n = 0;
  for (const [url, info] of vistos) {
    const item = { url, tipo: info.tipo, terceiro: info.terceiro, status: null, bytes: 0, hash: null, texto: null, erro: null };
    if (info.tipo === 'js' && info.terceiro) { item.erro = 'terceiro: não baixado'; saida.push(item); continue; }
    if (n >= maxAtivos) { item.erro = 'limite de ativos'; saida.push(item); continue; }
    n++;
    try {
      const r = await buscarSeguro(url, { permitidos, permitirLocal, maxBytes, timeoutMs });
      item.status = r.status;
      item.bytes = r.corpo.length;
      item.hash = sha256(r.corpo);
      if (r.status === 200) item.texto = r.texto();
      else item.erro = `status ${r.status}`;
    } catch (e) {
      item.erro = e.message;
    }
    saida.push(item);
  }
  return saida;
}
