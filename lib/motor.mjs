// MOTOR DE REGRAS: carrega as regras (JSON), roda os medidores, aplica os detectores e produz achados.
//
// Contrato de um detector (lib/deteccoes/<categoria>.mjs):
//   export const detectores = {
//     '<regra_id>': ({ ctx, med, regra }) => null | {
//        disparou: boolean,
//        intensidade: número 0..1 (força do sinal; usado no Tell Score),
//        achados: [{ pagina, mensagem, evidencias:[...], citacoes:[...], severidade?, instavel?, numeros_permitidos? }],
//     }
//   }
//   - `med` = { <idDoMedidor>: { dados, evidencias, erro? } }  (saídas dos medidores)
//   - retornar null = regra não aplicável/medidor indisponível (vira "não avaliada", nunca "ok").
//   - Detector NUNCA opina além do que o medidor mediu; cita sempre trecho/número/contagem verificável.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarAchado } from './achado.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function carregarRegras({ dir = join(raiz, 'regras'), tipoDeSite = null, modo = 'rapido' } = {}) {
  const regras = [];
  for (const nome of readdirSync(dir).sort()) {
    if (!nome.endsWith('.json')) continue;
    const a = JSON.parse(readFileSync(join(dir, nome), 'utf8'));
    if (Array.isArray(a)) regras.push(...a);
  }
  return regras.filter((r) => r.modo.includes(modo) && (r.tipos_de_site.includes('*') || !tipoDeSite || r.tipos_de_site.includes(tipoDeSite)));
}

async function importarPasta(pasta) {
  const saida = [];
  if (!existsSync(pasta)) return saida;
  for (const nome of readdirSync(pasta).sort()) {
    if (nome.endsWith('.mjs')) saida.push(await import(pathToFileURL(join(pasta, nome)).href));
  }
  return saida;
}

export async function carregarMedidores(pasta = join(raiz, 'lib', 'medidores')) {
  const mods = await importarPasta(pasta);
  return mods.filter((m) => m.id && typeof m.medir === 'function');
}

export async function carregarDetectores(pasta = join(raiz, 'lib', 'deteccoes')) {
  const mods = await importarPasta(pasta);
  const mapa = {};
  for (const m of mods) Object.assign(mapa, m.detectores || {});
  return mapa;
}

export async function executarMedidores(ctx, { medidores = null, ignorar = [], timeoutMs = 240000 } = {}) {
  const lista = (medidores || await carregarMedidores()).filter((m) => !ignorar.includes(m.id));
  const med = {};
  for (const m of lista) {
    const t0 = Date.now();
    let timer;
    try {
      const r = await Promise.race([
        m.medir(ctx),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`medidor ${m.id} passou de ${timeoutMs} ms`)), timeoutMs); }),
      ]);
      med[m.id] = { ...r, ms: Date.now() - t0 };
    } catch (e) {
      med[m.id] = { id: m.id, dados: null, evidencias: [], erro: String(e.message || e), ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  }
  return med;
}

// Medições de estilo computado (cores, sombras, raios) não aparecem como texto no código, então o verificador não
// tem o que conferir. Para o achado não ficar sem NENHUMA citação, ancoramos nele um trecho que existe (o título da
// página). A âncora garante que a página existe e foi lida; a medição em si continua em `evidencias`.
export function ancorarCitacoes(achado, ctx) {
  const temTrecho = (achado.citacoes || []).some((c) => c.tipo === 'trecho');
  const precisa = (achado.selo === 'opiniao' && !temTrecho) || (achado.selo === 'fato' && !(achado.citacoes || []).length);
  if (!precisa) return achado;
  const pag = (ctx?.paginas || []).find((p) => p.url === achado.pagina || p.final?.extr?.url === achado.pagina || new URL(p.url).pathname === achado.pagina) || ctx?.paginas?.[0];
  const titulo = pag?.final?.extr?.titulo;
  const ancora = titulo ? { tipo: 'trecho', valor: titulo, onde: 'html', versoes: ['final'], pagina: pag.url } : { tipo: 'trecho', valor: '<body', onde: 'html', versoes: ['final'], pagina: pag?.url };
  return { ...achado, citacoes: [...(achado.citacoes || []), ancora], citacao_de_ancora: true };
}

// Roda os detectores das regras de script/misto. Regras de julgamento viram "perguntas ao modelo".
export function rodarMotor({ ctx, med, regras, detectores }) {
  const achados = [];
  const tells = [];
  const naoAvaliadas = [];
  const semDetector = [];
  const comErro = [];
  const julgamento = [];
  let avaliadas = 0;
  for (const regra of regras) {
    if (regra.deteccao.tipo === 'julgamento') { julgamento.push(regra); continue; }
    const fn = detectores[regra.id];
    if (!fn) { semDetector.push(regra.id); continue; }
    let r;
    try { r = fn({ ctx, med, regra }); } catch (e) { comErro.push({ regra_id: regra.id, erro: String(e.message || e) }); continue; }
    if (r === null || r === undefined) { naoAvaliadas.push(regra.id); continue; }
    avaliadas++;
    tells.push({ regra_id: regra.id, categoria: regra.categoria, peso: regra.peso, severidade: regra.severidade, disparou: !!r.disparou, intensidade: r.disparou ? Math.max(0, Math.min(1, r.intensidade ?? 1)) : 0 });
    if (r.disparou) {
      for (const a of r.achados || []) achados.push(ancorarCitacoes(criarAchado(regra, a), ctx));
    }
  }
  const script = regras.filter((r) => r.deteccao.tipo !== 'julgamento').length;
  return {
    achados, tells, julgamento,
    cobertura: { regrasTotal: regras.length, regrasDeScript: script, avaliadas, semDetector, naoAvaliadas, comErro, perguntasAoModelo: julgamento.length },
  };
}
