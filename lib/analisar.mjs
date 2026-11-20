// ORQUESTRAÇÃO: entrada -> leitura (3 versões) -> medidores -> motor -> verificador -> notas -> pacote.
// Fase 2 (finalizar): julgamento do modelo -> validação -> relatório, PDF e cards.
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './navegador.mjs';
import { servirPasta, extrairZipSeguro, salvarCodigoColado } from './servidor-local.mjs';
import { descobrirPaginas } from './crawler.mjs';
import { lerPagina } from './ler-pagina.mjs';
import { buscarSeguro } from './rede-segura.mjs';
import { montarContexto } from './contexto.mjs';
import { carregarRegras, carregarMedidores, carregarDetectores, executarMedidores, rodarMotor } from './motor.mjs';
import { dirLocalPadrao, carregarRegrasLocais, carregarDetectoresLocais, versaoDaCamadaLocal } from './camada-local.mjs';
import { verificarAchados } from './verificador.mjs';
import { aplicarPrompts } from './prompts-correcao.mjs';
import { calcularTellScore } from './tell-score.mjs';
import { calcularNotas } from './notas.mjs';
import { criarCarimbo, nomeDaPasta, versaoDasRegras } from './carimbo.mjs';
import { criarCache, hashDaVersao } from './cache.mjs';
import { montarPacote, estimarTokens } from './pacote.mjs';
import { validarJulgamento } from './julgamento.mjs';
import { gerarEntregas } from './entrega.mjs';
import { acharAnaliseAnterior, compararAnalises } from './reanalisar.mjs';
import { carregarConfigCustos, estimarCusto, rodapeDeCusto, textoAviso } from './custo.mjs';
import { sha256, slugDe, gravarJson, lerJson, log } from './util.mjs';
import { calcularNotaSeo, montarPlanoSeo } from './seo-nota.mjs';
import { analisarSearchConsole } from './search-console.mjs';
import { TITULO_AVISO_POSICAO, AVISO_POSICAO } from './avisos.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_SAIDAS = join(raiz, 'saidas');

// Pasta de projeto -> pasta estática servível (index.html na raiz, ou dist/build/public/out/docs).
export function acharRaizEstatica(dir) {
  const d = resolve(dir);
  if (existsSync(join(d, 'index.html'))) return d;
  for (const sub of ['dist', 'build', 'out', 'public', 'docs', '_site', 'site']) if (existsSync(join(d, sub, 'index.html'))) return join(d, sub);
  const filhos = readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory() && existsSync(join(d, n, 'index.html')));
  if (filhos.length === 1) return join(d, filhos[0]);
  throw new Error('Não achei um index.html nesta pasta. Se for um projeto que precisa de "build", gere a versão estática (pasta dist, build ou out) e aponte para ela.');
}

// entrada: URL | pasta | .zip | { codigo: '...' }
export async function resolverEntrada(entrada) {
  if (entrada && typeof entrada === 'object' && 'codigo' in entrada) {
    const pasta = salvarCodigoColado(entrada.codigo);
    const s = await servirPasta(pasta);
    return { tipo: 'colado', rotulo: 'codigo-colado', urlInicial: s.url, permitidos: [`127.0.0.1:${s.porta}`], local: true, fechar: s.fechar };
  }
  const e = String(entrada).trim();
  if (/^https?:\/\//i.test(e)) return { tipo: 'url', rotulo: e, urlInicial: e, permitidos: [], local: false, fechar: async () => {} };
  if (!existsSync(e)) throw new Error(`Entrada não encontrada: ${e}`);
  let pasta = e;
  let tipo = 'pasta';
  if (statSync(e).isFile()) {
    if (!/\.zip$/i.test(e)) throw new Error('Arquivo não suportado: use URL, pasta, .zip ou código colado.');
    pasta = extrairZipSeguro(e);
    tipo = 'zip';
  }
  const raizEstatica = acharRaizEstatica(pasta);
  const s = await servirPasta(raizEstatica);
  return { tipo, rotulo: basename(resolve(e)), urlInicial: s.url, permitidos: [`127.0.0.1:${s.porta}`], local: true, raizEstatica, fechar: s.fechar };
}

// URL que aparece no relatório/card: sem usuário, senha, query nem hash (podem ter token ou dado pessoal).
const urlPublica = (u) => { try { const x = new URL(u); x.username = ''; x.password = ''; x.search = ''; x.hash = ''; return x.toString(); } catch { return String(u); } };

const tira = (leitura) => { const { cru, dom250, final, ...resto } = leitura; return { ...resto, cru: cru && { ...cru }, dom250, final }; };

export async function estimarAntes({ entrada, modo = 'rapido', tetoReais = null, seo = false }) {
  const cfg = carregarConfigCustos();
  if (tetoReais != null) cfg.teto_reais = tetoReais;
  const paginas = modo === 'completo' ? 30 : 8;
  const est = estimarCusto({ modo, paginas, seo, camadaLocal: versaoDaCamadaLocal() !== '' }, cfg);
  return { ...est, aviso: textoAviso(est), entrada: typeof entrada === 'string' ? entrada : 'código colado' };
}

// FASE 1 (scripts): faz tudo que é objetivo e grava a pasta da análise. Devolve o resumo.
export async function analisar({ entrada, modo = 'rapido', tipoInformado = null, permitirLocal = false, respeitarRobots = true, intervaloMs = 1000, saidas = PASTA_SAIDAS, ignorarMedidores = [], limitePaginas = null, usarCache = true, seo = false, csv = [], dirLocal = dirLocalPadrao(), aoProgredir = () => {} }) {
  // Módulo "Subir no Google" (D-021): só no modo completo, com pedido explícito (seo) ou com CSV do Search Console.
  const incluirSeo = modo === 'completo' || seo === true || (csv || []).length > 0;
  const t0 = Date.now();
  const alvo = await resolverEntrada(entrada);
  const nav = await abrirNavegador({ permitidos: alvo.permitidos, permitirLocal });
  try {
    aoProgredir(`descobrindo páginas de ${alvo.urlInicial}`);
    // Entrada local (pasta/ZIP/colado) NÃO libera a rede interna: o servidor próprio já está em `permitidos`.
    const pl = permitirLocal;
    let desc = await descobrirPaginas(alvo.urlInicial, { modo, limitePaginas, intervaloMs: alvo.local ? 0 : intervaloMs, respeitarRobots, permitidos: alvo.permitidos, permitirLocal: pl });
    const cache = usarCache ? criarCache(join(saidas, 'cache')) : null;

    const leituras = [];
    const lerComCache = async (url) => {
      let chaveCache = null;
      if (cache) {
        try {
          const c = await buscarSeguro(url, { permitidos: alvo.permitidos, permitirLocal: pl });
          chaveCache = cache.chave(sha256(c.corpo), modo);
          const hit = cache.obter(chaveCache);
          if (hit) return { ...hit, doCache: true };
        } catch { /* leitura normal reporta o erro */ }
      }
      const l = await lerPagina(url, { nav, permitidos: alvo.permitidos, permitirLocal: pl });
      if (cache && chaveCache && l.cru && l.final && !l.erros.length) cache.gravar(chaveCache, tira(l));
      return l;
    };
    const inicio = await lerComCache(desc.paginas[0].url);
    leituras.push(inicio);
    if (desc.semLinksNoCru && inicio.final?.extr) {
      const extras = inicio.final.extr.links.filter((l) => l.interno && l.visivel && !l.clone).map((l) => l.href);
      desc = await descobrirPaginas(alvo.urlInicial, { modo, limitePaginas, intervaloMs: alvo.local ? 0 : intervaloMs, respeitarRobots, permitidos: alvo.permitidos, permitirLocal: pl, linksExtras: extras });
    }
    for (const p of desc.paginas.slice(1)) { aoProgredir(`lendo ${p.url}`); leituras.push(await lerComCache(p.url)); if (!alvo.local) await new Promise((r) => setTimeout(r, intervaloMs)); }
    if (!leituras.some((l) => l.cru && l.final)) throw new Error(`Não consegui ler nenhuma página: ${leituras.map((l) => l.erros.join('; ')).join(' | ')}`);

    aoProgredir('montando contexto e baixando CSS/JS');
    const ctx = await montarContexto({ urlInicial: alvo.urlInicial, paginas: leituras, modo, tipoDeSite: tipoInformado, permitidos: alvo.permitidos, permitirLocal: pl, navegador: nav });
    let tipoDetectado = null;
    try { const m = await import('./tipo-de-site.mjs'); tipoDetectado = m.detectarTipoDeSite(ctx); } catch { /* módulo opcional */ }
    const tipoDeSite = tipoInformado || tipoDetectado?.tipo || null;
    ctx.site.tipoDeSite = tipoDeSite;
    ctx.dirLocal = dirLocal;

    aoProgredir('rodando medidores');
    const medidores = await carregarMedidores();
    const med = await executarMedidores(ctx, { medidores, ignorar: incluirSeo ? ignorarMedidores : [...ignorarMedidores, 'seo-google'] });
    let regras = carregarRegras({ modo, tipoDeSite }).filter((r) => incluirSeo || r.categoria !== 'seo-google');
    if (incluirSeo && modo !== 'completo') regras = regras.concat(carregarRegras({ modo: 'completo', tipoDeSite }).filter((r) => r.categoria === 'seo-google'));
    const detectores = await carregarDetectores();
    // Camada local opcional (D-028): regras e detectores extras; problema nela vira aviso, nunca erro.
    const regrasLocais = carregarRegrasLocais({ dirLocal, tipoDeSite, modo, idsPublicos: regras.map((r) => r.id) });
    const detLocais = await carregarDetectoresLocais({ dirLocal });
    for (const r of regrasLocais.regras) if (!Object.hasOwn(detectores, r.id) && detLocais.detectores[r.id]) detectores[r.id] = detLocais.detectores[r.id];
    regras = regras.concat(regrasLocais.regras);
    const camadaLocal = { ativa: !!dirLocal && (regrasLocais.regras.length > 0 || Object.keys(detLocais.detectores).length > 0), regras: regrasLocais.regras.length, avisos: [...regrasLocais.avisos, ...detLocais.avisos] };
    aoProgredir('aplicando regras');
    const motor = rodarMotor({ ctx, med, regras, detectores });
    const verif = verificarAchados(motor.achados, ctx);
    verif.aprovados = aplicarPrompts(verif.aprovados, { raizEstatica: alvo.raizEstatica || null, urlBase: alvo.tipo === 'url' ? alvo.urlInicial : '' });

    // tells cujos achados todos foram descartados pelo verificador deixam de contar
    const aprovadosPorRegra = new Set(verif.aprovados.map((a) => a.regra_id));
    const geraramAchado = new Set(motor.achados.map((a) => a.regra_id));
    const tells = motor.tells.map((t) => (t.disparou && geraramAchado.has(t.regra_id) && !aprovadosPorRegra.has(t.regra_id) ? { ...t, disparou: false, intensidade: 0 } : t));
    const tellScore = calcularTellScore(tells);
    let seoGoogle = null;
    if (incluirSeo) {
      const notaSeo = calcularNotaSeo({ tells, regras, achados: verif.aprovados });
      const pagsSeo = (med['seo-google']?.dados?.paginas || []).map((p) => ({ caminho: p.caminho, termo: p.termo.termo, fonte: p.termo.fonte, titulo: p.termo.termo, h1: '' }));
      const h1s = new Map((med.seo?.dados?.paginas || []).map((p) => [p.url, p.final?.h1?.textos?.[0] || '']));
      (med['seo-google']?.dados?.paginas || []).forEach((p, i) => { pagsSeo[i].h1 = h1s.get(p.url) || ''; });
      seoGoogle = { ativo: true, nota: notaSeo, plano: montarPlanoSeo(notaSeo), termos: pagsSeo.map(({ caminho, termo, fonte }) => ({ caminho, termo, fonte })), searchConsole: analisarSearchConsole(csv, pagsSeo), aviso: { titulo: TITULO_AVISO_POSICAO, texto: AVISO_POSICAO }, naoVerificavel: ['volume de busca', 'dificuldade da palavra-chave', 'posição real no Google', 'tráfego', 'concorrência'] };
    }
    const notas = calcularNotas({ tells, tellScore, lighthouse: med.lighthouse?.dados ? { scores: med.lighthouse.dados.scores || med.lighthouse.dados.mediaScores || null } : null });

    // Trava de honestidade: com pouca cobertura de regras a nota geral não pode parecer definitiva.
    const propCobertura = motor.cobertura.regrasDeScript ? motor.cobertura.avaliadas / motor.cobertura.regrasDeScript : 0;
    notas.geral.cobertura = { avaliadas: motor.cobertura.avaliadas, regrasDeScript: motor.cobertura.regrasDeScript, proporcao: Math.round(propCobertura * 100) / 100 };
    if (propCobertura < 0.6) notas.geral.provisoria = true;

    const hashVersao = hashDaVersao(ctx.paginas.map((p) => ({ url: p.url, hashCru: p.cru.hash })), ctx.ativos.filter((a) => a.hash).map((a) => ({ url: a.url, hash: a.hash })));
    const vLocal = versaoDaCamadaLocal(dirLocal);
    const carimbo = criarCarimbo({ hashVersao, modo, ...(vLocal ? { versaoRegras: `${versaoDasRegras()}+local.${vLocal}` } : {}) });
    const slug = slugDe(alvo.tipo === 'url' ? alvo.urlInicial : alvo.rotulo);
    const pasta = join(saidas, slug, nomeDaPasta(carimbo));
    mkdirSync(join(pasta, 'medicoes'), { recursive: true });

    // Perguntas de julgamento: as de UX (públicas) e as que a camada local declarou como julgamento.
    const idsLocais = new Set(regrasLocais.regras.map((r) => r.id));
    const julgamentoRegras = motor.julgamento.filter((r) => r.categoria === 'ux-heuristica' || idsLocais.has(r.id)).map((r) => ({ regra_id: r.id, titulo: r.titulo, descricao: r.descricao }));
    const pacote = await montarPacote({ ctx, tipoDeSite, modo, achados: verif.aprovados, descartados: verif.descartados, regrasJulgamento: julgamentoRegras, notas, tellScore, medTexto: med.texto, cobertura: motor.cobertura });

    const paginasInfo = desc.paginas.map((p) => ({ url: p.url, motivo: p.motivo }));
    const analiseParcial = {
      versao: 1, entrada: { tipo: alvo.tipo, rotulo: alvo.rotulo, urlInicial: alvo.urlInicial },
      site: { url: alvo.tipo === 'url' ? urlPublica(alvo.urlInicial) : alvo.rotulo, host: alvo.tipo === 'url' ? new URL(alvo.urlInicial).host : alvo.rotulo, tipo: tipoDeSite, tipoDetectado, entrada: alvo.tipo },
      carimbo, paginas: paginasInfo, notas: { tell: tellScore, categorias: notas.categorias, geral: notas.geral }, seoGoogle, camadaLocal,
      achados: verif.aprovados, descartados: verif.descartados, cobertura: motor.cobertura,
      julgamentoCriterios: julgamentoRegras.map((r) => r.regra_id),
      descoberta: { candidatas: desc.candidatas, truncado: desc.truncado, bloqueadasPorRobots: desc.bloqueadasPorRobots, avisos: desc.avisos },
      cache: cache?.stats || null, duracaoMs: Date.now() - t0, tokensPacote: pacote.tokensEstimados,
    };
    gravarJson(join(pasta, 'analise-parcial.json'), analiseParcial);
    writeFileSync(join(pasta, 'pacote.txt'), pacote.texto, 'utf8');
    gravarJson(join(pasta, 'verificacao.json'), verif.descartados);
    gravarJson(join(pasta, 'tells.json'), tells); // todos os tells avaliados (permite recalibrar a nota sem reler o site)
    for (const [id, m] of Object.entries(med)) gravarJson(join(pasta, 'medicoes', `${id}.json`), m);
    gravarJson(join(pasta, 'leituras.json'), { paginas: ctx.paginas.map((p) => ({ url: p.url, cru: p.cru, dom250: p.dom250, final: p.final })), ativos: ctx.ativos.map((a) => ({ ...a, texto: a.texto && a.texto.length > 400000 ? a.texto.slice(0, 400000) : a.texto })), site: ctx.site });
    return { pasta, slug, carimbo, resumo: { site: analiseParcial.site, paginas: paginasInfo.length, tell: tellScore.nota, geral: notas.geral, achados: verif.aprovados.length, descartados: verif.descartados.length, cobertura: motor.cobertura, tokensPacote: pacote.tokensEstimados, duracaoMs: analiseParcial.duracaoMs, medidoresComErro: Object.values(med).filter((m) => m.erro).map((m) => ({ id: m.id, erro: m.erro })) } };
  } finally {
    await nav.fechar();
    await alvo.fechar();
  }
}

// FASE 2: lê julgamento.json (escrito pelo modelo), valida, gera relatório/PDF/cards e grava analise.json.
export async function finalizar({ pasta, tokens = null, saidasBase = PASTA_SAIDAS }) {
  const parcial = lerJson(join(pasta, 'analise-parcial.json'));
  const arqJ = join(pasta, 'julgamento.json');
  if (!existsSync(arqJ)) throw new Error(`Falta ${arqJ}: o modelo precisa escrever o julgamento (veja o SKILL.md).`);
  let julgamento;
  try { julgamento = JSON.parse(readFileSync(arqJ, 'utf8')); } catch (e) { return { ok: false, erros: [`julgamento.json não é JSON válido: ${e.message}`] }; }
  const leit = lerJson(join(pasta, 'leituras.json'));
  const ctx = { site: leit.site, paginas: leit.paginas, ativos: leit.ativos };
  const numerosDoRelatorio = [parcial.notas.tell.nota, parcial.notas.tell.objetiva, parcial.notas.geral.nota, ...parcial.notas.categorias.map((c) => c.nota), parcial.achados.length, parcial.descartados.length, parcial.paginas.length, parcial.notas.tell.regrasDisparadas, parcial.notas.tell.regrasAvaliadas];
  const v = validarJulgamento(julgamento, { achadosVerificados: parcial.achados, ctx, numerosDoRelatorio, regrasHeuristica: parcial.julgamentoCriterios });
  if (!v.ok) return { ok: false, erros: v.erros };

  // Tell Score com o ajuste (limitado a ±10) do modelo; a parte objetiva fica registrada à parte
  const notas = parcial.notas;
  if (julgamento.ajuste_tell) {
    const bruto = notas.tell.objetiva;
    const delta = Math.max(-10, Math.min(10, julgamento.ajuste_tell.delta));
    notas.tell = { ...notas.tell, nota: Math.max(0, Math.min(100, Math.round((bruto + delta) * 10) / 10)), ajusteModelo: { aplicado: delta, pedido: julgamento.ajuste_tell.delta, motivo: julgamento.ajuste_tell.motivo, selo: 'opiniao' } };
    const cat = notas.categorias.find((c) => c.id === 'estrutura-visual');
    if (cat) cat.nota = Math.round((100 - notas.tell.nota) * 10) / 10;
  }

  const cfg = carregarConfigCustos();
  const tokensEntrada = tokens?.entrada ?? (cfg.estimativa_tokens.instrucoes_skill_entrada + cfg.estimativa_tokens.saidas_de_ferramentas_entrada + parcial.tokensPacote);
  // saída: o julgamento em si (medido ~3 caracteres por token) + ~2 mil de raciocínio e chamadas de ferramenta
  const tokensSaida = tokens?.saida ?? (Math.ceil(JSON.stringify(julgamento).length / cfg.estimativa_tokens.caracteres_por_token_julgamento) + 2000);
  const custo = rodapeDeCusto([{ etapa: 'julgamento', modelo: cfg.modelo_julgamento, entrada: tokensEntrada, saida: tokensSaida }], cfg);
  custo.medicao = tokens ? 'informada' : 'estimada a partir do tamanho do pacote e do julgamento (a skill não enxerga os tokens reais do modelo)';

  const pastaSite = dirname(pasta);
  const nomeAtual = pasta.split(/[\\/]/).pop();
  const ant = acharAnaliseAnterior(pastaSite, nomeAtual);
  const anterior = ant ? { ...compararAnalises(ant.analise, { ...parcial, notas }), pastaAnterior: ant.nome } : null;

  const dados = { site: parcial.site, carimbo: parcial.carimbo, paginas: parcial.paginas, notas, achados: parcial.achados, descartados: parcial.descartados, julgamento, cobertura: parcial.cobertura, seoGoogle: parcial.seoGoogle || null, custo, anterior };
  const nav = await abrirNavegador();
  let arquivos;
  try { arquivos = await gerarEntregas(dados, pasta, nav); } finally { await nav.fechar(); }
  gravarJson(join(pasta, 'analise.json'), { ...dados, arquivos });
  log.info('relatório gerado em', pasta);
  return { ok: true, pasta, arquivos, notas: { tell: notas.tell.nota, geral: notas.geral }, custo, anterior: anterior && { mensagem: anterior.mensagem, deltaTell: anterior.deltaTell } };
}
