# SPEC-SEO.md (v1): módulo "Subir no Google"

Atualizado em 2026-11-20. Complementa o SPEC.md; não substitui nada dele.

## 1. Objetivo
Nota de SEO própria (0 a 100, maior é melhor), separada do Tell Score e da nota geral, com achados, plano "como subir" por tipo de site e um prompt de correção por achado. Em português, para quem não é dev. Aprofunda o que a skill já mede; não refaz.

## 2. O que já existe e é reaproveitado (nada disto é recriado)
- 22 regras `seo-*` (título, descrição, canonical, noindex, robots, sitemap, links quebrados, hreflang, dados estruturados, etc.) e medidores `seo`, `jsonld`, `links`, `imagens`, `robots-ia`, `html`.
- Regras de outras áreas que contam para SEO e entram na nota por referência (lista em `config/seo-google.json`): `a11y-imagem-sem-alt`, `a11y-titulos-vazios-ou-fora-de-ordem`, `seg-pagina-sem-https`, `perf-imagem-maior-que-o-exibido`, `perf-imagem-formato-pouco-eficiente`, `perf-imagem-sem-dimensoes`, `cont-contato-visivel`, `lei-cnpj-ausente`.
- Carregador de seções por tipo (`regras/secoes/`), verificador de citações, selos, campo `interpretacao`, aviso "Referência não é cópia" e `seg-fonte-google-servidores`. Nada disso é duplicado.
- `ia-llms-txt-informativo` e rastreadores de IA continuam informativos (peso 0) e fora da nota de SEO.

## 3. Escopo (o que o módulo faz)
A. **Nota de SEO** determinística: `100 − 100·S/(S+C)` (mesma fórmula das notas por área, C = 30) sobre as regras de SEO disparadas; sem Lighthouse (que varia) e sem modelo. Aparece no relatório HTML, no PDF e no card, com os 5 achados que mais tiram pontos e o selo de cada um.
B. **SEO técnico por página** (regras novas só onde falta): H1, viewport, Open Graph e dados estruturados recomendados por tipo de página. O resto vem das regras existentes.
C. **Palavras-chave sem API**: o termo que cada página parece querer ranquear (title, H1, subtítulos, termos mais frequentes) e se o conteúdo entrega essa intenção. Volume, dificuldade e posição: sempre "não verificável".
D. **Conteúdo e E-E-A-T**: autor, página "sobre", data visível, fontes citadas; contato, CNPJ e políticas por regras já existentes. Selo opinião/heurística.
E. **SEO local**: nome, endereço e telefone entre páginas, LocalBusiness, mapa incorporado, links `tel:` e WhatsApp. O Perfil da Empresa no Google exige login: a skill só orienta o que conferir lá, nunca acessa.
F. **CSV do Search Console** (exportado pela pessoa): oportunidades por posição média entre 4 e 20, CTR abaixo do esperado, consultas sem página própria. Roda só local. Sem CSV aparece "precisa do CSV do Search Console".
G. **Plano "como subir"**: ordem por impacto e esforço, com o carregador de seções por tipo (funciona sem a camada local) e um prompt de correção por achado, sempre com o aviso "Referência não é cópia".
H. **Reanalisar**: a variação da nota de SEO entra no comparativo que já existe.
I. **Regra de ouro**: nunca prometer posição. Aviso fixo no relatório, teste automático que falha se qualquer texto gerado prometer "topo do Google", "1º lugar" ou resultado.

## 4. O que NÃO entra
Volume de busca, dificuldade, posição real, tráfego, backlinks e concorrentes (exigem serviço pago ou API); Perfil da Empresa no Google (exige login); IndexNow; Core Web Vitals de campo (CrUX); qualquer ordem de copiar texto, código ou design de terceiros; qualquer garantia de resultado; recomendação de FAQPage (ver 5).

## 5. Fontes conferidas em 2026-11-20 (nenhuma regra entra sem fonte)
| Assunto | Fonte | O que foi confirmado |
|---|---|---|
| Promessa de primeiro lugar | Google Search Central, "Do you need an SEO?" (developers.google.com/search/docs/fundamentals/do-i-need-seo) | "No one can guarantee a #1 ranking on Google." e o conselho de procurar outra pessoa se prometerem o primeiro lugar |
| Publicidade enganosa | CDC, Lei 8.078/1990, art. 37 (planalto.gov.br/ccivil_03/leis/l8078compilado.htm) | caput: "É proibida toda publicidade enganosa ou abusiva."; §1º define enganosa a informação ou comunicação publicitária inteira ou parcialmente falsa, ou capaz de induzir em erro por omissão. Texto lido em 2026-11-20 |
| Títulos | Google, SEO Starter Guide | a ordem dos títulos não importa para a busca e não há número ideal: a regra de H1 é **heurística** (leitor e leitor de tela), confiança baixa |
| Viewport | Chrome/Lighthouse, auditoria "meta viewport" | sem a tag, celulares mostram a página em largura de desktop. O Google não cita a tag nas páginas de mobile-first lidas: regra de confiança média |
| Open Graph | ogp.me | propriedades obrigatórias: og:title, og:type, og:image, og:url. Não afeta posição; afeta a prévia ao compartilhar |
| Produto | Google, "Product snippet structured data" | obrigatórios: `name` e ao menos um entre `review`, `aggregateRating`, `offers` |
| Organização | Google, "Organization structured data" | nenhuma propriedade obrigatória; recomendadas name, url, logo, sameAs, contactPoint, address |
| Negócio local | Google, "Local business structured data" | obrigatórias: `name` e `address`; recomendadas `telephone`, `openingHoursSpecification`, `geo`, `url`. O Google não garante que o recurso apareça |
| FAQPage | Google, "FAQ structured data" | rich result de FAQ descontinuado: "deixa de aparecer a partir de 7 de maio de 2026". A skill NÃO recomenda FAQPage por SEO |
| Autor e como o conteúdo foi feito | Google, "Creating helpful content" | pede deixar claro quem criou (byline com link para informações do autor) e como foi produzido; não recomenda mostrar datas |
| Datas | Google, "Publication dates" | recomenda data visível e, em artigos, `datePublished`/`dateModified` iguais às da página |
| Search Console | Ajuda do Search Console, "Performance report" | métricas Cliques, Impressões, CTR, Posição média; abas Consultas, Páginas, etc. A página não lista os cabeçalhos do arquivo exportado: aceitamos variações em português e inglês e avisamos o que não reconhecemos |
| Referência de ideias | claude-seo (AgriciDaniel, MIT, último commit 2026-11-15) | categorias de auditoria e teste Quem/Como/Por quê; reescrito, sem copiar texto nem código |

Heurísticas sem fonte oficial (E-E-A-T de "página sobre", fontes citadas, NAP entre páginas, mapa e `tel:`) entram como **opinião/heurística**, confiança baixa ou média, e dizem isso.

## 6. Decisões de projeto (resumo; detalhes em DECISOES.md)
Regras novas em `regras/seo-google.json` (categoria `seo-google`, ids `seo-`), fora das áreas da nota geral (a nota geral e o Tell Score não mudam). O módulo só carrega no modo completo ou com pedido explícito de SEO. CSV lido por parser próprio, com limite de tamanho. CTR "esperado" = mediana do próprio CSV por faixa de posição (nenhuma curva externa inventada).

## 7. Critérios de pronto
1. `npm test` verde (562 antigos + novos), `npm audit` limpo, validador de regras ok.
2. Nota de SEO: mesma entrada, mesma nota; `seo-boa` fica muito acima de `seo-ruim`.
3. Regressão do exemplo nº 1 por contagem em código (dados estruturados e lazy): a skill não afirma "sem dados estruturados" nem "sem lazy loading".
4. Teste de promessa proibida falha de verdade quando se injeta uma frase assim.
5. CSV em português e em inglês lido; sem CSV nada é inventado.
6. Nenhum termo proibido em arquivo versionado; `referencias/`, `saidas/`, `entrada/`, `local/` fora do git.
7. `docs/limites-seo.md` diz o que a nota mede e o que não mede.

## 8. Riscos
- Sobrepor regras existentes: mitigado pela lista de reaproveitamento e por um teste que impede id duplicado.
- Heurística parecer fato: todo achado heurístico tem selo e texto "pode ser que".
- Pessoa entender a nota como previsão de posição: aviso fixo + `docs/limites-seo.md`.
- CSV malicioso ou enorme: limite de tamanho e de linhas, parser sem avaliação de fórmulas, nada vai para a rede.
- Mudança do Google: cada regra tem fonte e data de consulta.

## 9. Plano de testes
Um teste por medidor, por detector, pela nota, pela leitura do CSV (arquivos de exemplo inventados em PT e EN), pelo aviso e pela promessa proibida; duas fixtures fictícias (`seo-ruim`, `seo-boa`); regressão do exemplo nº 1; custo real medido; suíte completa e `npm audit`.
