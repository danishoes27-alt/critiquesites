// Medidor 'robots-ia': o que o robots.txt do site diz sobre rastreadores de IA, mais llms.txt e sitemap.xml.
// Só FATOS: nunca recomenda bloquear nem liberar (SPEC §2 item 4 e §5.1). llms.txt é informativo (peso 0).
import { readFileSync } from 'node:fs';
import { buscarSeguro } from '../rede-segura.mjs';
import { parseRobots, grupoPara, podeRastrear } from '../robots.mjs';
import { saidaMedidor } from '../contexto.mjs';

export const id = 'robots-ia';
export const versao = '1';

const CONFIG = JSON.parse(readFileSync(new URL('../../config/rastreadores-ia.json', import.meta.url), 'utf8'));
export const RASTREADORES = CONFIG.rastreadores;

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const NOTA_LLMS = 'Informativo, peso 0: o Google Search diz que o llms.txt não é necessário para recursos de IA; o arquivo não ajuda nem prejudica o ranking.';

const pareceHtml = (tipoMime, texto) => /html/i.test(tipoMime || '') || /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(texto || '');

// Busca um arquivo na raiz do site. Devolve sempre um objeto simples (nunca lança).
async function buscarArquivo(ctx, caminho) {
  const url = new URL(caminho, ctx.site.origem).toString();
  try {
    const r = await buscarSeguro(url, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, permitidos: ctx.rede?.permitidos || [], permitirLocal: !!ctx.rede?.permitirLocal });
    const tipoMime = String(r.cabecalhos['content-type'] || '');
    const texto = r.texto();
    const html = pareceHtml(tipoMime, texto);
    let presente = r.status === 200 && !html && texto.trim().length > 0;
    let motivo = presente ? null : r.status !== 200 ? `status HTTP ${r.status}` : html ? 'a resposta é HTML (soft 404), tratada como ausente' : 'arquivo vazio';
    return { url, status: r.status, urlFinal: r.url, tipoMime, bytes: r.corpo.length, texto, presente, motivoAusencia: motivo, erro: null };
  } catch (e) {
    return { url, status: null, urlFinal: null, tipoMime: '', bytes: 0, texto: '', presente: false, motivoAusencia: `falha na requisição: ${e.message}`, erro: e.message };
  }
}

export function avaliarRastreador(robots, rastreador, { robotsDisponivel, status }) {
  const base = { id: rastreador.id, nome: rastreador.nome, empresa: rastreador.empresa, categoria: rastreador.categoria, userAgent: rastreador.userAgent, documentacao: rastreador.documentacao, tokenSomente: !!rastreador.tokenSomente };
  if (!robotsDisponivel) {
    const indeterminado = status !== null && status >= 500;
    return { ...base, situacao: indeterminado ? 'indeterminado' : 'liberado', parcial: false, grupo: indeterminado ? 'robots.txt com erro do servidor (5xx): situação indeterminada' : 'sem robots.txt: liberado por omissão', agentesDoGrupo: [], restricoes: { disallow: [], allow: [] } };
  }
  const g = grupoPara(robots, rastreador.userAgent);
  if (!g) return { ...base, situacao: 'liberado', parcial: false, grupo: 'sem regra: liberado por omissão', agentesDoGrupo: [], restricoes: { disallow: [], allow: [] } };
  const disallow = g.regras.filter((r) => r.tipo === 'disallow' && r.caminho !== '').map((r) => r.caminho);
  const allow = g.regras.filter((r) => r.tipo === 'allow' && r.caminho !== '').map((r) => r.caminho);
  const liberado = podeRastrear(robots, rastreador.userAgent, '/');
  const curinga = g.agentes.length === 1 && g.agentes[0] === '*';
  const nomeado = g.agentes.some((a) => a !== '*');
  return {
    ...base,
    situacao: liberado ? 'liberado' : 'bloqueado',
    parcial: liberado ? disallow.length > 0 : allow.length > 0,
    grupo: curinga ? 'grupo curinga (User-agent: *)' : nomeado ? `grupo específico (User-agent: ${g.agentes.join(', ')})` : 'grupo',
    origemDoGrupo: curinga ? 'curinga' : 'especifico',
    agentesDoGrupo: g.agentes,
    restricoes: { disallow, allow },
  };
}

export async function medir(ctx) {
  const [robotsArq, llmsArq, sitemapArq] = await Promise.all([buscarArquivo(ctx, '/robots.txt'), buscarArquivo(ctx, '/llms.txt'), buscarArquivo(ctx, '/sitemap.xml')]);
  const evidencias = [];

  const robotsDisponivel = robotsArq.presente;
  const robots = robotsDisponivel ? parseRobots(robotsArq.texto) : { grupos: [], sitemaps: [] };
  const rastreadores = RASTREADORES.map((r) => avaliarRastreador(robots, r, { robotsDisponivel, status: robotsArq.status }));

  const resumo = { treinoLiberado: 0, treinoBloqueado: 0, buscaLiberado: 0, buscaBloqueado: 0, consultaPorUsuarioLiberado: 0, consultaPorUsuarioBloqueado: 0, indeterminado: 0, total: rastreadores.length };
  const chave = { treino: 'treino', busca: 'busca', 'consulta-por-usuario': 'consultaPorUsuario' };
  for (const r of rastreadores) {
    if (r.situacao === 'indeterminado') { resumo.indeterminado++; continue; }
    resumo[chave[r.categoria] + (r.situacao === 'liberado' ? 'Liberado' : 'Bloqueado')]++;
    if (r.situacao === 'bloqueado' || r.parcial) evidencias.push({ pagina: '/robots.txt', versao: 'cru', seletor: null, trecho: `${r.nome}: ${r.situacao}${r.parcial ? ' (parcial)' : ''}; ${r.grupo}`, valor: r.situacao, contagem: null, visivel: null });
  }

  const llmsLinhas = llmsArq.presente ? llmsArq.texto.split(/\r?\n/) : [];
  const tituloLlms = llmsLinhas.find((l) => /^#\s+\S/.test(l));
  const llms = {
    presente: llmsArq.presente, status: llmsArq.status, url: llmsArq.url, bytes: llmsArq.presente ? llmsArq.bytes : 0,
    linhas: llmsArq.presente ? llmsLinhas.filter((l) => l.trim() !== '').length : 0,
    tituloMarkdown: tituloLlms ? tituloLlms.replace(/^#\s+/, '').trim().slice(0, 120) : null,
    motivoAusencia: llmsArq.presente ? null : llmsArq.motivoAusencia,
    nota: NOTA_LLMS,
  };

  const locs = sitemapArq.presente ? (sitemapArq.texto.match(/<loc>\s*[^<\s][^<]*<\/loc>/gi) || []).length : 0;
  const sitemapEhXml = sitemapArq.presente && /<(urlset|sitemapindex)[\s>]/i.test(sitemapArq.texto);
  const sitemap = {
    presente: sitemapArq.presente && sitemapEhXml, status: sitemapArq.status, url: sitemapArq.url, bytes: sitemapArq.presente ? sitemapArq.bytes : 0,
    tipo: sitemapEhXml ? (/<sitemapindex[\s>]/i.test(sitemapArq.texto) ? 'indice' : 'urlset') : null,
    entradas: sitemapEhXml ? locs : 0,
    motivoAusencia: sitemapArq.presente && sitemapEhXml ? null : (sitemapArq.presente ? 'o arquivo não é um sitemap XML' : sitemapArq.motivoAusencia),
    declaradoNoRobots: robots.sitemaps,
  };

  const dados = {
    robots: {
      presente: robotsDisponivel, status: robotsArq.status, url: robotsArq.url, bytes: robotsDisponivel ? robotsArq.bytes : 0,
      motivoAusencia: robotsDisponivel ? null : robotsArq.motivoAusencia,
      grupos: robots.grupos.length,
      agentesDeclarados: [...new Set(robots.grupos.flatMap((g) => g.agentes))],
      sitemaps: robots.sitemaps,
    },
    rastreadores,
    resumo,
    llms,
    sitemap,
    fonteDaLista: { arquivo: 'config/rastreadores-ia.json', consultadoEm: CONFIG.consultado_em },
    nota: 'Apenas fatos do robots.txt na raiz ("/"). Sem recomendação de bloquear ou liberar.',
  };
  return saidaMedidor(id, dados, evidencias, versao);
}
