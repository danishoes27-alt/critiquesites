// Helper de testes: lê uma fixture (pasta em tests/fixtures) e devolve o ctx pronto para os medidores.
import { abrirNavegador } from '../../lib/navegador.mjs';
import { servirPasta } from '../../lib/servidor-local.mjs';
import { lerPagina } from '../../lib/ler-pagina.mjs';
import { montarContexto } from '../../lib/contexto.mjs';

const fixtures = new URL('../fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const caminhoFixture = (nome) => fixtures + nome;

// caminhos: lista de caminhos ('/' , '/sobre.html'...) a ler. Padrão: só a home.
// manterAberto: devolve também { fechar } para quem precisa do navegador/servidor (axe, lighthouse).
export async function lerFixture(nome, { caminhos = ['/'], modo = 'rapido', tipoDeSite = null, manterAberto = false, buscarAtivos = true } = {}) {
  const servidor = await servirPasta(fixtures + nome);
  const hp = `127.0.0.1:${servidor.porta}`;
  const nav = await abrirNavegador({ permitidos: [hp], timeoutMs: 20000 });
  const fechar = async () => { await nav.fechar(); await servidor.fechar(); };
  try {
    const paginas = [];
    for (const c of caminhos) paginas.push(await lerPagina(new URL(c, servidor.url).toString(), { nav, permitidos: [hp] }));
    const ctx = await montarContexto({ urlInicial: servidor.url, paginas, modo, tipoDeSite, permitidos: [hp], navegador: nav, buscarAtivos });
    if (manterAberto) return { ctx, fechar, servidor, nav };
    await fechar();
    return { ctx };
  } catch (e) {
    await fechar();
    throw e;
  }
}
