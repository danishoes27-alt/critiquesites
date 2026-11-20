# SPEC.md v1 — critiquesites

Status: Fase 1 (SPEC). Base: CLAUDE.md v3. Escopo COMPLETO (não a versão enxuta).
Convenção: "script" = código determinístico em Node/Playwright; "modelo" = o Claude rodando a skill.

---------------------------------------------------------------------------
## 1. Objetivo e público

Skill pública (MIT, GitHub), em português do Brasil, que critica sites inteiros para quem não é dev. Entrega relatório completo, Tell Score (0 a 100, menor é melhor), card de nota, modo reanalisar, modo "sem dó" e um prompt de correção por crítica.

Princípio central: **scripts medem, o modelo julga**. Nota é sinal, não veredito; nunca prometer 100% de acerto.

## 2. O que NÃO entra (fora de escopo)

1. Páginas atrás de login, áreas de membros, checkout real. (CLAUDE.md: limite duro.)
2. Qualquer chave, senha, token ou API paga. Nada de PageSpeed Insights API com chave, nada de serviços pagos.
3. Afirmar que um texto foi "escrito por IA". Só "genérico/batido".
4. Mandar bloquear ou liberar rastreadores de IA; mandar ter ou não ter llms.txt (peso 0, informativo).
5. Proibir algo por lei. A skill avisa e explica o risco; a pessoa decide. Não é parecer jurídico.
6. Executar código do site analisado fora do Chromium isolado do Playwright.
7. Instalar skills de terceiros (Impeccable etc.). Só leitura de regras, com créditos.
8. Correção automática do site. A skill gera prompts de correção; quem aplica é a pessoa/Claude Code.
9. Publicação (push, GitHub, npm). Repositório fica só local até o Berg decidir.
10. Dados de terceiros no repositório: nenhum nome de site de terceiros, nenhum rótulo "feito por IA" aplicado a terceiros.
11. Análise de apps nativos, PDFs, e-mails. Só web (HTML/CSS/JS).
12. Teste A/B, analytics real, dados de tráfego, ranking real no Google (a skill mede sinais, não posição).

## 3. Entradas aceitas

| Entrada | Como funciona | Segurança |
|---|---|---|
| URL | Playwright abre a página; crawler segue links internos do mesmo domínio | Bloqueia IPs privados/metadata (anti-SSRF), robots.txt respeitado por padrão, intervalo entre acessos, limite de páginas e de tempo |
| Pasta ou ZIP do projeto | Servidor estático temporário em 127.0.0.1 (porta aleatória), aberto no Playwright; ZIP extraído em pasta temporária | Proteção zip-slip, limite de tamanho (200 MB) e de arquivos (5.000), nada é executado fora do navegador |
| Código colado | Salvo como `index.html` em pasta temporária e tratado como pasta | Mesmo que acima |

Tipo de site: detectado por heurística (script) e confirmado/ajustado pelo modelo. Tipos: `site-institucional`, `landing-page`, `blog`, `catalogo`, `loja`, `cardapio`, `agendamento`, `pagina-de-vendas`, `portfolio`, `link-na-bio`, `area-de-membros` (mesma lista da skill 1-prompt-1-site).

## 4. Leitura da página (Marco M1)

### 4.1 Três versões
Para cada página, o script grava três instantâneos:
1. `cru`: HTML da resposta HTTP, sem JS.
2. `dom250`: DOM serializado 250 ms após o evento `DOMContentLoaded` (relógio do script).
3. `final`: DOM após `load` + espera de rede ociosa (máx. 8 s) + rolagem completa (para disparar lazy/animações) + 1,5 s.

Do `final`, também: estilos computados dos elementos relevantes, caixas (bounding boxes), screenshots (desktop 1440 e mobile 390) para o card/relatório.

### 4.2 Diferença entre versões = achado próprio
Para cada elemento com identidade estável (seletor CSS gerado + texto-âncora), compara valores numéricos/texto entre `cru`, `dom250`, `final`. Se um valor muda, vira achado `leitura-valor-muda-entre-versoes` (selo: fato verificado), com as três leituras. Ex.: contador animado que começa em `0` e termina em `54`. Cobre o item do gabarito "contadores animados que começam em 0 e mostram valor errado em captura rápida".

### 4.3 Visível × oculto × clone
Cada nó de texto/imagem recebe: `visivel` (display/visibility/opacity/hidden/aria-hidden/tamanho zero/fora da tela por posicionamento negativo/clip), `oculto_por` (motivo), e `clone` (verdadeiro quando está sob ancestral `aria-hidden="true"` E o texto normalizado duplica um irmão/primo visível, padrão de carrossel infinito). Regras:
- Achados de **conteúdo/copy/preço/duplicidade** consideram só nós `visivel=true` e `clone=false`.
- Texto oculto é guardado separadamente e só gera achado se a regra for sobre ocultos (ex.: texto oculto com preço divergente do visível = achado de consistência, nunca "preço errado").
- Clones nunca contam para "depoimento duplicado", "conteúdo repetido" etc. Cobre o exemplo nº 1 (depoimentos duplicados são clones aria-hidden; "0% OFF" e "oferta encerrada R$ 89" são texto oculto).

### 4.3.1 Contagens são recalculadas, nunca estimadas
Número de imagens, imagens com `loading=lazy`, dados estruturados, links: todos calculados no DOM `final` e `cru`, com a contagem e o seletor guardados como evidência.

### 4.4 Crawler
- Descoberta: links `<a href>` internos, `sitemap.xml` (se existir), `robots.txt` respeitado.
- Normalização de URL (sem hash, sem utm, barra final), deduplicação.
- Amostragem: **rápido** até 8 páginas; **completo** até 30. Seleção: home + páginas legais (privacidade, termos, contato, sobre) + 1 representante por "assinatura de template" (hash da estrutura de tags de topo) até o limite.
- Limites duros: tempo por página 25 s, tempo total 10 min (rápido 4 min), intervalo mínimo de 1 s entre acessos ao mesmo host (configurável; 3 s para sites de terceiros nos testes), profundidade 3.
- Cache por página: chave = SHA-256 do HTML cru + versão do medidor; mudou o hash, remedir.

### 4.5 Segurança do navegador
Contexto novo e efêmero a cada análise; sem cookies persistentes; downloads bloqueados; permissões (câmera, geolocalização, notificações) negadas; `acceptDownloads:false`; roteamento bloqueia requests para IPs privados/loopback/link-local/metadata exceto quando a entrada é pasta/ZIP/colado (127.0.0.1 próprio); limite de tamanho de resposta; timeouts em tudo; nenhum arquivo do site é executado em Node.

### 4.6 Injeção de prompt no site analisado
Todo texto extraído entra no modelo dentro de blocos `<dados-do-site>` rotulados como DADO. Script procura texto dirigido a IA/agente (ex.: "ignore as instruções anteriores", "você é um assistente", "system prompt", "ignore previous instructions", "do not tell the user") em texto visível, oculto, comentários HTML, `alt`, `aria-label`, meta tags, JSON-LD e `llms.txt`. Cada ocorrência vira achado `seguranca-injecao-de-prompt` (selo fato) e o trecho é **removido** do pacote enviado ao modelo.

## 5. Medição (Marco M2)

Todos os medidores produzem `medicoes/<id>.json` com valores e evidências (trecho, seletor, versão da página, visível?).

| Medidor | Faz | Ferramenta |
|---|---|---|
| html | estrutura, headings, landmarks, lang, title, meta, canonical, OG, viewport, atributos | parse5/cheerio sobre `cru` e `final` |
| css | cores, fontes, tamanhos, raios, sombras, espaçamentos, @font-face, pseudo-estados, tokens | parse de CSS (postcss) + estilos computados |
| js | bibliotecas, tamanho, IDs de analytics, console errors | varredura de texto + Playwright (console) |
| jsonld | tipos e propriedades obrigatórias/recomendadas | parse JSON-LD |
| axe | acessibilidade (WCAG 2.x A/AA) por página | axe-core no Playwright |
| lighthouse | performance, SEO, acessibilidade, boas práticas (home mobile no rápido; até 3 páginas no completo) | lighthouse + chrome-launcher com o Chromium local |
| links | internos/externos quebrados (HEAD/GET com limite), links repetidos com mesmo texto e destinos diferentes, texto de link sem contexto | fetch |
| imagens | alt, dimensões, formato, peso, lazy, srcset | DOM + HEAD |
| seo | title/description (tamanho), h1 único, canonical, hreflang, robots meta, sitemap, status HTTP, estrutura de URL | script |
| robots | `robots.txt`: rastreadores liberados/bloqueados; diferença treino × busca (informativo); `llms.txt` presente? (peso 0) | script |
| lei | CNPJ/razão social visíveis, política de privacidade, termos de uso, aviso/banner de cookies, contato do encarregado (LGPD), formulários que coletam dados sem aviso, promessas de ganho/resultado, preços com condição omitida, escassez/oferta falsa suspeita, IDs de analytics vazios | script + texto |
| texto | clichês PT-BR, especificidade, travessão, repetição, legibilidade (Flesch adaptado) | script (ver §6.4) |
| secoes | seções esperadas por tipo de site | carregador de regras (§6.3) |
| ia-visibilidade | JSON-LD, SSR (conteúdo no HTML cru), `robots`, sitemap, headings semânticos | script |
| injecao | texto dirigido a IA (§4.6) | script |

### 5.1 Fontes e peso das regras de SEO/IA (CLAUDE.md)
- llms.txt: regra **informativa, peso 0**. Texto fixo: o Google Search diz que não é necessário para recursos de IA; o arquivo não ajuda nem prejudica o ranking. Fonte e data registradas na regra.
- Rastreadores de IA no `robots.txt`: o relatório **só informa** o que está liberado/bloqueado e explica a diferença entre treino (ex.: GPTBot, ClaudeBot, Google-Extended) e busca/consulta (ex.: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot). Nunca recomenda bloquear nem liberar.

### 5.2 Lei brasileira (avisar, nunca proibir)
Cada regra legal traz: o que foi visto, qual artigo é relevante, o risco em linguagem simples, e a frase fixa "Isto não é parecer jurídico; a decisão é sua". Base documentada (lida na fonte oficial do Planalto):
- CDC art. 37 (publicidade enganosa/abusiva, inclusive por omissão), Lei 8.078/1990.
- Decreto 7.962/2013 art. 2º (comércio eletrônico: nome empresarial e CNPJ/CPF, endereço, características, custos extras, condições, restrições da oferta em destaque).
- LGPD, Lei 13.709/2018: arts. 7º-9º (bases legais, consentimento, informação clara), 18 (direitos do titular), 41 (encarregado com identidade e contato divulgados).
- Cookies/consentimento: guia da ANPD para cookies; regra de confiança média (documentada, não lei expressa).
Selo: `regra documentada` (com artigo e URL), nunca `fato verificado` de ilegalidade; o que se verifica é a **presença/ausência de elemento no código**.

## 6. Regras e notas (Marco M3)

### 6.1 Regras em JSON
Todas em `regras/*.json`, nunca no texto da skill. Esquema (JSON Schema em `regras/schema/regra.schema.json`):

```json
{
  "id": "cor-roxo-padrao-ia",
  "categoria": "visual-tells",
  "titulo": "Paleta índigo/violeta padrão",
  "descricao": "texto em PT-BR, 1-2 frases, para leigo",
  "deteccao": {
    "tipo": "script | julgamento | misto",
    "medidor": "css",
    "metodo": "descrição objetiva do que o script mede",
    "parametros": {}
  },
  "peso": 9,
  "severidade": "tell | smell | info",
  "selo": "fato | regra | opiniao | nao-verificavel",
  "confianca": "alta | media | baixa",
  "tipos_de_site": ["*"],
  "modo": ["rapido", "completo"],
  "correcao": "o que fazer, em PT-BR simples",
  "prompt_correcao": "prompt pronto p/ colar no Claude Code, com {{placeholders}}",
  "fonte": [{"nome": "...", "url": "...", "licenca": "MIT", "data_consulta": "2026-11-18"}],
  "origem_ids": ["ai-design-tells:A1"],
  "citacoes": ["numero", "trecho"],
  "notas": ""
}
```
Regras sem `fonte` não são aceitas pelo validador (teste automático). Regra com `selo: fato` precisa de `deteccao.tipo: script`.

### 6.2 Esquema do achado
```json
{
  "id": "ach-0007",
  "regra_id": "...",
  "selo": "fato | regra | opiniao | nao-verificavel",
  "severidade": "P0 | P1 | P2 | P3",
  "pagina": "/",
  "mensagem": "texto PT-BR, leigo",
  "evidencias": [
    {"versao": "cru|dom250|final", "visivel": true, "seletor": "...", "trecho": "...", "valor": "...", "contagem": 0}
  ],
  "citacoes": [{"tipo": "trecho|numero|contagem", "valor": "...", "escopo": ["final"], "seletor": "..."}],
  "peso_aplicado": 6,
  "correcao": "...",
  "prompt_correcao": "...",
  "verificado": true
}
```

### 6.3 Seções esperadas por tipo de site
Carregador `regras/secoes/<tipo>.json`: lista de seções esperadas (id, nome, como detectar por seletor/palavras, peso, fonte). Os arquivos públicos são preenchidos com fontes abertas (Nielsen Norman Group, Google Search Central, web.dev, WCAG), citando fonte e peso. Quem tem método próprio usa a camada local opcional `local/secoes-por-tipo/<tipo>.json`, que vale mais que o arquivo público do tipo (D-028 e `docs/secoes-locais.md`).

### 6.4 Módulo de texto "genérico/batido"
- **Nunca** afirma autoria por IA. Veredito possível: "texto genérico/batido".
- Script mede: densidade de clichês PT-BR (`regras/texto/cliches-pt-br.json`, calibrada em teste), travessão (—) por 1.000 palavras (peso baixo), proporção de frases com número/nome próprio/unidade (especificidade), repetição de estruturas ("não é X, é Y", tricolons), CTAs genéricos.
- Teste da troca: o script gera, para as 5 frases mais genéricas, a pergunta "se eu trocar o nome desta empresa pelo do concorrente, a frase continua verdadeira?"; o **modelo** responde só sobre essas frases (zona cinza).
- A lista de clichês é dado, com `peso`, `fonte` (quando existe) e `confianca`; entradas sem evidência de calibração ficam `baixa`.

### 6.5 Tell Score
- Escala 0 a 100, **menor é melhor** (menos cara de IA).
- Fórmula objetiva: `TellScore = 100 × Σ(peso_i × disparou_i × intensidade_i) / Σ(peso_i aplicáveis)`, onde `intensidade` ∈ [0,1] vem do medidor (ex.: fração de cards com mesmo padding). Só entram regras `visual-tells`, `texto-generico` e `estrutura-padrao` com detecção por script; regras de julgamento ajustam no máximo ±10 pontos e sempre marcadas como opinião.
- "Créditos de craft" (fonte própria, tracking negativo em títulos, hierarquia de raio, foco visível) reduzem o peso de tells correlatos, para não punir quem escolheu de propósito.
- Faixas: A < 12, B < 28, C < 45, D < 65, F ≥ 65 (ponto de partida; calibrar no teste de acerto).
- Determinismo: mesma entrada (mesmo hash) → mesma nota na parte objetiva. Partes instáveis (ex.: carrossel com horário) ficam marcadas `instavel` e fora da nota.
- Outras notas (0-100, maior é melhor): acessibilidade, performance, SEO, conteúdo/texto, lei/transparência, estrutura. Nível geral (Iniciante, Em evolução, Sólido, Excelente) a partir delas.

### 6.6 Selos
| Selo | Significado | Exemplo |
|---|---|---|
| fato verificado | medido por script, com evidência reproduzível | "45 de 57 imagens usam loading=lazy" |
| regra documentada | baseada em norma/guia com fonte citada | WCAG 1.4.3, CDC art. 37 |
| opinião/heurística | julgamento do modelo ou limiar empírico | "o hero parece genérico" |
| não verificável | não dá para provar no código | "a promessa de ganho é real?" |

O que não dá para provar no código **nunca** é afirmado; vira pergunta ou "não verificável".

## 7. Confiança e entrega (Marco M4)

### 7.1 Verificador de citações
Script `verificar-citacoes` roda **antes** de qualquer relatório. Para cada achado, cada `citacao`:
- `trecho`: normaliza (NFKC, espaços, entidades HTML, caixa) e procura no corpus do escopo declarado (cru/dom250/final, CSS, JS, JSON-LD).
- `numero`: procura como token numérico (aceita `9,90` ≡ `9.90`) no escopo.
- `contagem`: **recalcula** com o seletor/função declarado e compara.
- Citação cujo escopo é "visível" só vale se o nó for visível e não clone.
Falhou → achado **descartado** e registrado em `verificacao.json` (motivo). Sem citações em achado `selo: fato` → descartado. Achado `opinião` precisa citar ao menos um trecho que exista. O relatório mostra "N achados descartados pelo verificador".

### 7.2 Relatório
- Montado por **template** (`templates/relatorio.html`) por script; o modelo escreve só os campos de julgamento (resumos, elogios, críticas redigidas, plano) em `julgamento.json`, validado por schema.
- Seções: capa com nota e nível, carimbo (data, hora, hash, versão da skill, modo), pontos fortes, pontos fracos, Tell Score com evidências, elogios, críticas (cada uma com selo, severidade, evidência, correção e prompt), comparações (por categoria e, se houver, com análise anterior), plano do que melhorar (ordenado por impacto/esforço), achados descartados, limites da análise, rodapé com tokens gastos e custo em R$.
- Saídas: HTML autocontido, PDF (Playwright), card PNG. Todos em `saidas/<slug>/<AAAAMMDD-HHMM>-<hash8>/`.
- Carimbo: data/hora local ISO, SHA-256 da versão analisada (HTML cru de todas as páginas amostradas, ordenadas, + CSS/JS referenciados), versão da skill e dos conjuntos de regras.

### 7.3 Card de nota
Template `templates/card.html` (1080×1350 e 1200×630), com nota, nível, 3 números-chave, carimbo. Sem logo de terceiros. Gerado por screenshot do Playwright.

### 7.4 Modos
| | Rápido (padrão) | Completo |
|---|---|---|
| Páginas | até 8 | até 30 |
| Lighthouse | home mobile | até 3 páginas, mobile+desktop na home |
| axe | todas as amostradas | todas |
| Julgamento do modelo | só evidências + zona cinza ≤ 12 trechos | evidências + zona cinza ≤ 40 trechos + 1 resumo barato por página |
| Teste da troca (texto) | 3 frases | 5 frases por página-chave |

### 7.5 Custo
- Antes de rodar: `custo --estimar` mostra tokens estimados e **R$**, usando `config/custos.json` (preço do modelo em US$ por milhão de tokens, cotação US$→R$, **data e fonte** de ambos). Pergunta "rodar?" quando acima do teto.
- Teto configurável (`teto_reais`, padrão R$ 2,00). Acima do teto: pede confirmação ou reduz para o modo rápido.
- Rodapé do relatório: tokens de entrada/saída por etapa e custo em R$.
- Estimativa de referência do Berg para comparação: R$ 0,80 a R$ 1,00 por site médio no modo completo (será comparada com a medição real, §10).

### 7.6 Funil (como gasta pouco)
1. Script lê 100% (fonte + DOM). 2. Modelo lê só o pacote de evidências (JSON compacto, trechos curtos). 3. Leitura crua só na zona cinza (achados de confiança média/baixa com peso alto, ou conflito entre medidores). Regras carregadas só do tipo de site; amostragem; cache por hash; modelo barato (Haiku) para resumo por página; relatório por template.

### 7.7 Reanalisar
`reanalisar` compara duas análises do mesmo site (mesmo slug): nota por categoria, achados resolvidos/novos/persistentes (por `regra_id`+âncora), gráfico simples de evolução no relatório e no card ("de 61 para 34"). Se o hash é idêntico, avisa "nada mudou". Se muda só o conjunto de regras, avisa que a comparação não é like-for-like.

### 7.8 Modo "sem dó"
Mesmo conteúdo e mesmos achados; muda só o **tom** do texto do modelo (ácido, direto, com humor). Regras: nunca ofende pessoa, nunca inventa achado, nunca eleva severidade, nunca afirma autoria por IA. Tom aplicado só nos campos do `julgamento.json`.

### 7.9 Prompts de correção
Cada crítica traz `prompt_correcao` pronto: contexto (arquivo/seletor/trecho citado), o que mudar, o que NÃO mudar, critério de pronto verificável. Gerado de template da regra + evidências (script), refinado pelo modelo no máximo em 2 frases.

## 8. Uso (Marco M5)
- `SKILL.md` (Agent Skills, frontmatter `name: critiquesites` e `description`), instruções curtas, carrega regras e scripts sob demanda.
- Comandos: `critiquesites <url|pasta|zip>`, flags `--completo`, `--sem-do`, `--reanalisar`, `--teto`, `--tipo`.
- README em português, com instalação (copiar a pasta para a pasta de skills), exemplo e limites honestos.
- Sem dependência de serviço pago. Node ≥ 20, Playwright, axe-core, Lighthouse instalados na pasta do projeto.

## 9. Fontes das regras e licenças
Detalhe em `CREDITS.md`. Resumo: ai-design-tells (MIT), unslop-ui (MIT), jezweb design-review (MIT), Impeccable (Apache 2.0, só leitura local), outras conforme licença verificada nos resumos. As regras são **reescritas em português e reimplementadas**, não copiadas literalmente; cada regra guarda `origem_ids` e `fonte`. `referencias/` fica no `.gitignore`.

## 10. Critérios de pronto por funcionalidade

| Funcionalidade | Pronto quando |
|---|---|
| 3 versões da página | testes provam: contador 0→N gera achado; cru ≠ final detectado; fixture determinística |
| Visível/oculto/clone | fixture com carrossel clonado e texto oculto: zero achados de duplicidade/preço nesses nós |
| Crawler | respeita robots, limites, dedup, cache; teste com site local de 12 páginas |
| Medidores | cada medidor tem teste com fixture e valores esperados exatos |
| Regras JSON | validador de schema passa; toda regra tem fonte; nenhuma regra dentro do SKILL.md |
| Tell Score | determinístico (3 execuções idênticas); créditos de craft aplicados; faixas documentadas |
| Verificador | achado com número/trecho inexistente é descartado (teste de mutação); contagem recalculada |
| Relatório/PDF/card | gerados por template; HTML válido; PDF abre; card nos 2 tamanhos |
| Reanalisar | duas análises de fixture mostram delta correto |
| Custo | estimativa em R$ com fonte e data; teto respeitado |
| Segurança | teste de SSRF bloqueado; teste de injeção de prompt registrado e removido; ZIP malicioso rejeitado |
| Site de exemplo nº 1 (fictício) | todos os "NÃO pode afirmar" ausentes e todos os "TEM QUE apontar" presentes (§11) |
| Teste de acerto | `docs/teste-de-acerto.md` com números reais e limitações (§11.3) |

## 11. Plano de testes

### 11.1 Automáticos
`node --test` em `tests/`, com fixtures locais em `tests/fixtures/`: um teste por script e por regra de detecção, mais testes de propriedade do verificador (mutação) e de determinismo da nota.

### 11.2 Regressão do site de exemplo nº 1 (fictício)
Site de exemplo totalmente fictício, na fixture `tests/fixtures/exemplo1`: empresa "Estúdio Aurora", produto "Guia de Receitas Caseiras", R$ 39, domínio exemplo.com.
**NÃO pode afirmar:** "sem dados estruturados" (há WebSite, WebPage, Product, Offer, FAQPage, VideoObject); "sem lazy loading" (45 de 57 imagens usam `loading=lazy`); "depoimentos duplicados" (clones aria-hidden); "0% OFF" e "oferta encerrada R$ 89" (texto oculto); "Guia R$ 97 e 200+ receitas" (texto fora da tela; o visível é R$ 39 e 50 receitas).
**TEM QUE apontar:** contadores animados que começam em 0 e mostram valor errado em captura rápida; "Ganhe R$ 3.000 por mês" no título como possível promessa de ganho (CDC art. 37); links repetidos "R$ 39" sem contexto para leitor de tela; ausência de CNPJ, termos e política de privacidade; IDs de GA4 e pixel da Meta vazios.
Nota: o HTML cru da fixture tem 31 `<img>` e 30 com `loading=lazy`; os números 57/45 referem-se ao DOM final. O teste confere o **DOM final** e a skill registra as duas contagens (cru e final).
Conferência contra um site real é opcional e local: `node scripts/regressao-caso1.mjs vivo <url>` (a URL vem do argumento ou de `CRITIQUESITES_URL_VIVO`; nenhum endereço fica no repositório) e o resultado fica só em `saidas/`, fora do git.

### 11.3 Teste de acerto
- 20 sites "gerados por IA" criados localmente com prompts genéricos: 5 tipos × 4.
- 20 sites "bons" de lista pública de premiados, **só a home**, respeitando robots.txt e com intervalo entre acessos; ficam só no teste local (nenhum nome no repositório; só números agregados).
- Métricas: média/mediana do Tell Score por grupo, separação (AUC e diferença de medianas), falsos positivos/negativos no melhor limiar, intervalo por tipo. Se a nota **não** separar bem, o documento diz isso com clareza.
- Limitação declarada: mede sites genéricos gerados por IA contra sites premiados, não toda a realidade; premiados tendem a ser mais pesados em JS/animação; sites gerados por IA com bom prompt podem passar.
- Calibração de pesos e da lista de clichês em conjunto separado (treino/validação) para evitar ajustar ao próprio teste.

### 11.4 Custo real
Medir tokens e R$ de uma análise rápida e de uma completa, com cotação do dia (fonte citada), comparar com R$ 0,80–1,00.

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Falso positivo de "cara de IA" em site bom | créditos de craft, peso máximo de julgamento, teste de acerto honesto, nota como sinal |
| Alegação factual errada | verificador de citações, selos, achado sem evidência é descartado |
| Sites SPA/animados com conteúdo mutável | 3 versões da página, itens `instavel` fora da nota |
| Custo estourar | funil, teto, modo rápido, aviso em R$ |
| Prompt injection no site | dados delimitados, detector, remoção do trecho, achado próprio |
| SSRF / abuso do crawler | bloqueio de IPs privados, robots, intervalo, limites |
| Licença das fontes | só regras reescritas, créditos em CREDITS.md, referencias/ fora do repo; dados de terceiros dos repos de origem não reaproveitados |
| Lei virar "parecer" | linguagem de aviso, frase fixa, selo "regra documentada" |
| Lighthouse instável | rodar mediana de 1 execução e marcar variação; nota de performance usa faixas, não valor exato |
| Windows (caminhos, PDF) | testar no Windows do Berg, usar `path`, sem shell específico |
| Dependências de terceiros mudam | versões fixas no `package-lock.json` |

## 13. Pendências conhecidas
As seções públicas (`regras/secoes/`) usam só fontes abertas; o método próprio do Berg entra pela camada local opcional (D-028), que não é versionada. Preços de modelos e cotação são configuráveis e com data; o Berg deve atualizar `config/custos.json` ao publicar.

---------------------------------------------------------------------------
## 14. Ajuste v1: fonte do Google e aviso de referência (2026-11-19)

Escopo mínimo, sem mudar a arquitetura. Dois itens.

### 14.1 Item A: regra "fonte carregada dos servidores do Google" (`seg-fonte-google-servidores`)
- **Detecção só por script.** Procura em HTML cru, DOM final, CSS inline e arquivos CSS baixados: `<link>` (stylesheet, preconnect, preload, dns-prefetch), `@import` e `url()` de `@font-face` para `fonts.googleapis.com` e `fonts.gstatic.com`. Evidência: a URL exata e onde aparece (seletor, `@import` em CSS inline ou em qual arquivo CSS). Fonte servida do próprio domínio: nenhum achado.
- **Dois níveis no mesmo achado.** (1) O **fato** "a página carrega fonte dos servidores do Google" (selo "fato verificado", com citação verificável). (2) A **interpretação** "isso pode enviar o IP do visitante ao Google" fica em campo próprio (`interpretacao`, selo "opinião/heurística"). O texto nunca diz que o site "viola a lei" ou "está ilegal".
- **Base citada na interpretação** (conferida em 2026-11-19, ver `DECISOES.md`): decisão do Landgericht München I de 20/01/2022, processo 3 O 17493/20 (100 euros de indenização, com base no art. 82, item 1, do GDPR); é decisão **alemã**, de um tribunal, e em 19/11/2026 **não foi encontrada decisão brasileira equivalente**. LGPD, art. 5º, inciso I, só no que o texto diz: dado pessoal é "informação relacionada a pessoa natural identificada ou identificável".
- **Gravidade baixa (P3), sem efeito nas notas.** A categoria `seguranca-conteudo` não entra no Tell Score nem nas notas por área; teste garante que o Tell Score não muda.
- **Prompt de correção:** baixar os arquivos das fontes usadas, guardar numa pasta do projeto, trocar o link por `@font-face` com `font-display: swap`, remover os links do Google e conferir que o visual não mudou; antes, conferir a licença de cada fonte (segundo o README do repositório google/fonts: a maioria usa a SIL Open Font License 1.1, algumas Apache 2.0 e a família Ubuntu usa a Ubuntu Font License 1.0; cada família traz o arquivo de licença).
- **Critério de pronto:** achado só com Google Fonts por link ou por `@import`; evidência traz a URL; fonte própria e página sem fonte externa não geram achado; Tell Score idêntico com e sem o achado; regra válida no schema.

### 14.2 Item B: aviso "referência não é cópia"
- Bloco de texto fixo e curto (`lib/avisos.mjs`), escrito com palavras do projeto, mostrado **no fim do relatório** e **dentro de qualquer prompt de correção que mencione referência ou inspiração**.
- Conteúdo: olhar, medir e se inspirar é uma coisa; reproduzir o que é de outra pessoa depende de autorização de quem criou. Cita (conferido no texto oficial do Planalto em 2026-11-19): Lei 9.610/1998, arts. 7º, 8º inciso I e 29; Lei 9.609/1998, art. 2º e § 3º; e, para marca, Lei 9.279/1996, art. 129 (o direito de propriedade sobre a marca nasce do registro válido). Inclui "isto não é parecer jurídico" e "a decisão é sua"; sem promessa absoluta.
- **Teste anti-cópia:** nenhum prompt de correção (das regras e os gerados) pode mandar copiar, clonar, reproduzir ou deixar "igual" a um site específico. Medir uma referência e adaptar à marca da pessoa é permitido. O teste também precisa **falhar** quando se injeta uma frase proibida.

### 14.3 O que não entra
Nenhum material externo foi copiado para este repositório. Nenhuma afirmação de ilegalidade. Sem mudança no Tell Score.

## 15. Módulo "Subir no Google"
Especificação, plano e limites em `SPEC-SEO.md`, `PLAN-SEO.md` e `docs/limites-seo.md` (nota de SEO própria, separada do Tell Score; só no modo completo ou com `--seo`).
