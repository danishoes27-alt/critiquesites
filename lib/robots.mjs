// Parser de robots.txt (RFC 9309, o suficiente): grupos por User-agent, Allow/Disallow com
// curingas (* e $), regra mais específica vence (e Allow vence empate), Sitemap.

export function parseRobots(texto) {
  const grupos = [];
  const sitemaps = [];
  let atual = null;
  let lendoAgentes = false;
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    if (chave === 'user-agent') {
      if (!lendoAgentes || !atual) { atual = { agentes: [], regras: [] }; grupos.push(atual); }
      atual.agentes.push(valor.toLowerCase());
      lendoAgentes = true;
    } else if (chave === 'allow' || chave === 'disallow') {
      lendoAgentes = false;
      if (atual) atual.regras.push({ tipo: chave, caminho: valor });
    } else if (chave === 'sitemap') {
      sitemaps.push(valor);
    } else {
      lendoAgentes = false;
    }
  }
  return { grupos, sitemaps };
}

// Casamento de curingas (* e $ final) SEM regex: o robots.txt é controlado pelo site e uma regex com vários "*"
// pode levar minutos (ReDoS). Aqui o custo é linear (indexOf) e o número de curingas é limitado.
function casa(caminhoRegra, path) {
  if (caminhoRegra === '') return false;
  let regra = caminhoRegra;
  let ancoradoNoFim = false;
  if (regra.endsWith('$')) { ancoradoNoFim = true; regra = regra.slice(0, -1); }
  const partes = regra.split('*');
  if (partes.length > 16) return false; // regra absurda: ignora
  if (partes.length === 1) return ancoradoNoFim ? path === partes[0] : path.startsWith(partes[0]);
  if (!path.startsWith(partes[0])) return false;
  let pos = partes[0].length;
  for (let i = 1; i < partes.length; i++) {
    const p = partes[i];
    if (i === partes.length - 1) {
      if (ancoradoNoFim) return path.length - p.length >= pos && path.endsWith(p);
      return path.indexOf(p, pos) >= 0;
    }
    const k = path.indexOf(p, pos);
    if (k < 0) return false;
    pos = k + p.length;
  }
  return true;
}

// Escolhe o grupo que mais especificamente nomeia o agente (ou "*").
export function grupoPara(robots, agente) {
  const ag = String(agente).toLowerCase();
  let melhor = null;
  let tamanho = -1;
  for (const g of robots.grupos) {
    for (const a of g.agentes) {
      if (a === '*' ? tamanho < 0 : ag.includes(a) && a.length > tamanho) {
        if (a === '*') { if (!melhor) { melhor = g; tamanho = 0; } } else { melhor = g; tamanho = a.length; }
      }
    }
  }
  return melhor;
}

// path inclui query ("/a?b=1"). Sem regra aplicável => permitido.
export function podeRastrear(robots, agente, path) {
  const g = grupoPara(robots, agente);
  if (!g) return true;
  let melhor = null;
  for (const r of g.regras) {
    if (!casa(r.caminho, path)) continue;
    const peso = r.caminho.length;
    if (!melhor || peso > melhor.peso || (peso === melhor.peso && r.tipo === 'allow')) melhor = { peso, tipo: r.tipo };
  }
  return !melhor || melhor.tipo === 'allow';
}
