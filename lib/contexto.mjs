// Contexto de análise: o objeto que TODOS os medidores recebem.
//
// ctx = {
//   site:   { urlInicial, origem, host, tipoDeSite|null, modo: 'rapido'|'completo' },
//   paginas:[ resultado de lerPagina() ... ]  // cada uma: { url, cru:{html,status,cabecalhos,hash,extr}, dom250:{extr,html},
//                                              //   final:{extr,html,estilos?}, nav, console, requisicoes, erros }
//   ativos: [ { url, tipo:'css'|'js', terceiro, status, bytes, hash, texto|null, erro } ],
//   rede:   { permitidos:[], permitirLocal:false },
//   navegador: objeto de abrirNavegador() (só para medidores que precisam: axe, lighthouse),
// }
//
// Todo medidor exporta:  export const id = '...';  export async function medir(ctx) -> { id, versao, dados, evidencias }
// evidencias: [{ pagina, versao:'cru'|'dom250'|'final', seletor, trecho, valor, contagem, visivel }]
import { carregarAtivos } from './ativos.mjs';

export async function montarContexto({ urlInicial, paginas, modo = 'rapido', tipoDeSite = null, permitidos = [], permitirLocal = false, navegador = null, buscarAtivos = true }) {
  const u = new URL(urlInicial);
  const paginasOk = paginas.filter((p) => p.cru && p.final);
  const ativos = buscarAtivos ? await carregarAtivos(paginasOk, { hostSite: u.host, permitidos, permitirLocal }) : [];
  return {
    site: { urlInicial, origem: u.origin, host: u.host, tipoDeSite, modo },
    paginas: paginasOk,
    paginasComErro: paginas.filter((p) => !(p.cru && p.final)),
    ativos,
    rede: { permitidos, permitirLocal },
    navegador,
  };
}

export const saidaMedidor = (id, dados, evidencias = [], versao = '1') => ({ id, versao, dados, evidencias });
