// Proteção anti-SSRF e busca HTTP segura (usada no "HTML cru", robots.txt, sitemap, links).
import dns from 'node:dns/promises';
import net from 'node:net';

export const UA = 'critiquesites/0.1 (analise de sites; leitura apenas)';
export const LIMITE_CORPO = 5 * 1024 * 1024; // 5 MB por resposta lida em Node

const HOSTS_BLOQUEADOS = new Set(['metadata.google.internal', 'metadata', 'instance-data', 'localhost.localdomain']);

// Faixas privadas/internas (IPv4 e IPv6). IPv6 que embute IPv4 (mapeado, compatível, NAT64, 6to4) é convertido e checado.
const LISTA = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) LISTA.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) LISTA.addSubnet(a, p, 'ipv6');

function hextetos(v6) {
  // expande "::" e devolve 8 números de 16 bits (aceita sufixo IPv4 pontilhado)
  let s = v6.toLowerCase();
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const [a, b, c, d] = m[2].split('.').map(Number); s = `${m[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`; }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(':') : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const falta = 8 - esq.length - dir.length;
  if (partes.length === 1 ? esq.length !== 8 : falta < 0) return null;
  const todos = partes.length === 1 ? esq : [...esq, ...Array(falta).fill('0'), ...dir];
  const nums = todos.map((h) => parseInt(h, 16));
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : nums;
}

export function ehEnderecoPrivado(ip) {
  let v = String(ip).trim().toLowerCase();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  v = v.split('%')[0]; // zona IPv6 (fe80::1%eth0)
  if (net.isIPv4(v)) return LISTA.check(v, 'ipv4');
  if (!net.isIPv6(v)) return false;
  const h = hextetos(v);
  if (!h) return true; // não consegui interpretar: tratar como interno (falha segura)
  const v4de = (alto, baixo) => `${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`;
  const zerosAte = (n) => h.slice(0, n).every((x) => x === 0);
  if (zerosAte(5) && h[5] === 0xffff) return LISTA.check(v4de(h[6], h[7]), 'ipv4'); // ::ffff:a.b.c.d (e a forma hexadecimal)
  if (zerosAte(6) && !(h[6] === 0 && h[7] <= 1)) return LISTA.check(v4de(h[6], h[7]), 'ipv4'); // ::a.b.c.d (compatível)
  return LISTA.check(v.includes('::') || v.includes(':') ? v : v, 'ipv6');
}

// permitidos: array de "host:porta" liberados (o servidor local do próprio projeto).
export async function urlPermitida(url, { permitidos = [], permitirLocal = false } = {}) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, motivo: 'URL inválida' }; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { ok: true };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, motivo: `protocolo não permitido: ${u.protocol}` };
  const hostPorta = u.host.toLowerCase();
  if (permitidos.includes(hostPorta)) return { ok: true };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (HOSTS_BLOQUEADOS.has(host)) return { ok: false, motivo: 'host interno bloqueado' };
  if (net.isIP(host)) {
    if (!permitirLocal && ehEnderecoPrivado(host)) return { ok: false, motivo: `endereço privado/interno bloqueado (${host})` };
    return { ok: true };
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return permitirLocal ? { ok: true } : { ok: false, motivo: 'host local bloqueado' };
  }
  if (permitirLocal) return { ok: true };
  try {
    const enderecos = await dns.lookup(host, { all: true });
    const ruim = enderecos.find((e) => ehEnderecoPrivado(e.address));
    if (ruim) return { ok: false, motivo: `o nome aponta para endereço privado (${ruim.address})` };
  } catch {
    return { ok: false, motivo: 'não foi possível resolver o nome' };
  }
  return { ok: true };
}

// fetch com: validação de cada redirecionamento, limite de tamanho, timeout e UA próprio.
export async function buscarSeguro(url, { timeoutMs = 20000, maxBytes = LIMITE_CORPO, permitidos = [], permitirLocal = false, redirecionamentos = 5, metodo = 'GET', cabecalhos = {} } = {}) {
  let atual = url;
  for (let i = 0; i <= redirecionamentos; i++) {
    const perm = await urlPermitida(atual, { permitidos, permitirLocal });
    if (!perm.ok) { const e = new Error(`bloqueado: ${perm.motivo}`); e.bloqueado = true; throw e; }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const resp = await fetch(atual, { method: metodo, redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept: '*/*', ...cabecalhos } });
      if ([301, 302, 303, 307, 308].includes(resp.status) && resp.headers.get('location')) {
        atual = new URL(resp.headers.get('location'), atual).toString();
        continue;
      }
      let corpo = Buffer.alloc(0);
      if (metodo !== 'HEAD' && resp.body) {
        const partes = [];
        let total = 0;
        for await (const parte of resp.body) {
          total += parte.length;
          if (total > maxBytes) { ctl.abort(); const e = new Error(`resposta maior que ${maxBytes} bytes`); e.grande = true; throw e; }
          partes.push(parte);
        }
        corpo = Buffer.concat(partes);
      }
      return { url: atual, status: resp.status, cabecalhos: Object.fromEntries(resp.headers), corpo, texto: () => corpo.toString('utf8') };
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error('redirecionamentos demais');
}
