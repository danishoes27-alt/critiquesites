// Utilitários puros usados por todo o projeto.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function sha256(dados) {
  return createHash('sha256').update(dados).digest('hex');
}

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export function decodificarEntidades(txt) {
  return String(txt)
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Normaliza texto para comparação: NFKC, entidades, espaços (inclusive NBSP e zero-width), caixa.
export function normalizarTexto(txt, { caixa = true } = {}) {
  let t = decodificarEntidades(txt ?? '').normalize('NFKC');
  t = t.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  return caixa ? t.toLowerCase() : t;
}

// Extrai tokens numéricos ("R$ 9,90" -> 9.9, "1.234,50" -> 1234.5, "54" -> 54).
export function extrairNumeros(txt) {
  const achados = String(txt ?? '').match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g) || [];
  return achados.map(paraNumero).filter((n) => Number.isFinite(n));
}

export function paraNumero(token) {
  let t = String(token).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.'); // 9,90
  return Number(t);
}

// Dois números "iguais" para fins de citação (9,90 ≡ 9.90).
export function numerosIguais(a, b) {
  return Math.abs(paraNumero(a) - paraNumero(b)) < 1e-9;
}

// Slug seguro para pastas/arquivos a partir de uma URL ou nome.
export function slugDe(entrada) {
  let s = String(entrada).trim();
  try {
    const u = new URL(s);
    s = u.host + u.pathname;
  } catch { /* não é URL */ }
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 80) || 'site';
}

// Normaliza URL para deduplicar: sem hash, sem utm_*, host minúsculo, sem barra final (exceto raiz).
export function normalizarUrl(url, base) {
  let u;
  try { u = new URL(url, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/index\.(html?|php)$/i, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  u.pathname = path;
  return u.toString();
}

// JSON com chaves ordenadas (saída estável, bom para hash e diff).
export function jsonEstavel(obj, espacos = 2) {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
    return v;
  };
  return JSON.stringify(ordenar(obj), null, espacos);
}

export function gravarJson(caminho, obj) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, jsonEstavel(obj) + '\n', 'utf8');
}

export function lerJson(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8'));
}

export function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const log = {
  info: (...a) => console.error('[critiquesites]', ...a),
  aviso: (...a) => console.error('[critiquesites][aviso]', ...a),
};

// ---------- processamento LINEAR de texto não confiável (sem regex com retrocesso) ----------
// Remove blocos "<inicio ... fim>" (comentários, script, style...). Sem fecho, remove até o fim (como o navegador).
// inicios: ex.: ['<script', '<style']; fim correspondente: '</script', '</style' (procura também o '>' final).
export function removerBlocos(html, inicio, fim) {
  const h = String(html ?? '');
  const baixa = h.toLowerCase();
  const ini = inicio.toLowerCase(), fm = fim.toLowerCase();
  let saida = '';
  let pos = 0;
  for (;;) {
    let i = baixa.indexOf(ini, pos);
    // para tags (<script), exige que o próximo caractere termine o nome da tag
    while (i >= 0 && /^<[a-z]/.test(ini) && !/[\s>/]/.test(baixa[i + ini.length] ?? '>')) i = baixa.indexOf(ini, i + 1);
    if (i < 0) { saida += h.slice(pos); break; }
    saida += h.slice(pos, i);
    const j = baixa.indexOf(fm, i + ini.length);
    if (j < 0) break; // sem fecho: descarta o resto
    let fimIdx = j + fm.length;
    if (/^<\//.test(fm)) { const g = baixa.indexOf('>', fimIdx); fimIdx = g < 0 ? baixa.length : g + 1; }
    pos = fimIdx;
  }
  return saida;
}

// Troca cada <tag ...> por espaço em tempo linear; "<" sem ">" por perto é só texto.
export function tirarTags(html, substituto = ' ', maxTag = 4000) {
  const h = String(html ?? '');
  const n = h.length;
  const prox = new Int32Array(n + 1);
  prox[n] = -1;
  for (let i = n - 1; i >= 0; i--) prox[i] = h.charCodeAt(i) === 62 ? i : prox[i + 1];
  let saida = '';
  let pos = 0;
  for (let i = 0; i < n; i++) {
    if (h.charCodeAt(i) !== 60) continue;
    const c = h.charCodeAt(i + 1);
    const abreTag = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33 || c === 63;
    const j = prox[i];
    if (!abreTag || j < 0 || j - i > maxTag) continue;
    saida += h.slice(pos, i) + substituto;
    pos = j + 1;
    i = j;
  }
  return saida + h.slice(pos);
}

// E-mails por tokens curtos: evita o custo quadrático da regex sobre uma "palavra" gigante.
export function acharEmails(texto, maxToken = 320) {
  const re = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[A-Za-z]{2,24}/g;
  const saida = [];
  let ini = 0;
  const t = String(texto ?? '');
  for (let i = 0; i <= t.length; i++) {
    if (i === t.length || /\s/.test(t[i])) {
      if (i - ini > 0 && i - ini <= maxToken && t.slice(ini, i).includes('@')) for (const m of t.slice(ini, i).matchAll(re)) saida.push({ valor: m[0], indice: ini + m.index });
      ini = i + 1;
    }
  }
  return saida;
}
