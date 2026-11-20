# CREDITS.md (v1)

O critiquesites é MIT. As **regras** deste projeto foram **reescritas em português e reimplementadas**; não há cópia de texto ou código das fontes abaixo no repositório. Cada regra em `regras/*.json` guarda suas fontes (`fonte`) e os ids de origem (`origem_ids`). Os repositórios de referência ficam só em `referencias/` (fora do git) e nenhuma dessas skills é instalada.

Dados lidos em 2026-11-18.

## Fontes de ideias e regras (somente leitura)

| Fonte | Autor / titular | Licença | Último commit lido | Observação |
|---|---|---|---|---|
| [hankimis/ai-design-tells](https://github.com/hankimis/ai-design-tells) | Han Kim / IOV Labs | MIT | `e14e9c1` (2026-06-03) | Taxonomia e peso dos "tells" visuais. As pastas `data/` e `paper/` (dados e capturas de sites de terceiros) **não foram usadas**: sem licença separada declarada. |
| [iamneilroberts/claude-skills](https://github.com/iamneilroberts/claude-skills) (skill unslop-ui) | Neil Roberts; LICENSE.upstream: Carter Johnson | MIT | `947953f` (2026-08-20) | O upstream avisa que a MIT não cobre os textos do Reddit usados nos dados; **nenhum texto ou número de evidência foi reaproveitado**. |
| [jezweb/claude-skills](https://github.com/jezweb/claude-skills) (design-review, ux-audit) | Jeremy Dawes (Jezweb) | MIT | `1260fa7` (2026-10-09) | Checagens de layout, tipografia, cor, interação. |
| [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | Hallmark contributors | MIT | `04977e1` (2026-11-11) | Gates por camada (Floor/Reflex/Finish). |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Vercel Labs | MIT (declarada no README; sem arquivo LICENSE) | `1a2c79d` (2026-10-27) | A skill web-design-guidelines só aponta para o repositório abaixo. |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | Vercel Labs | MIT | `434b7f9` (2026-10-05) | Diretrizes de interface (acessibilidade, formulários, performance). Algumas regras de copy são preferência de marca da Vercel e não foram tratadas como norma. |
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | AgriciDaniel (Copyright (c) 2026 agricidaniel) | MIT | `468ed5b` (2026-11-15), lido em 2026-11-20 | Categorias de auditoria de SEO técnico, teste "quem, como, por quê" e ideia de NAP e schema por tipo para o módulo "Subir no Google". Reescrito em português e reimplementado; nenhum texto ou código copiado e nenhuma extensão que exija chave ou serviço pago foi usada. |
| unslop (heydamir), skill local | Damir Sokolovsky (@heydamir), heydamir.design/unslop | **CC-BY-4.0** | sem versão | **Exige crédito**: este arquivo cumpre o crédito. Regras adaptadas e traduzidas, com indicação de origem em `origem_ids`. Licença declarada no frontmatter da skill; sem arquivo LICENSE. |
| Impeccable (skill local, v4.3.1) | autoria conforme o SKILL.md | **Apache-2.0** (declarada no frontmatter; a pasta local não traz LICENSE nem NOTICE) | n/a | Usado para as 10 heurísticas de Nielsen com escala 0 a 4, carga cognitiva, personas e severidade P0-P3. O detector binário **não foi executado**. Crédito mantido por cortesia e conforme Apache-2.0. |

## Documentação pública e normas (citadas por URL em cada regra)

- Google Search Central (Do you need an SEO?, Guia inicial de SEO, dados estruturados de Product, Organization e negócio local, datas de publicação, conteúdo útil, FAQ) e ajuda do Search Console e do Perfil da Empresa no Google; The Open Graph protocol (ogp.me); IETF RFC 3966; Código de Defesa do Consumidor, art. 37 (planalto.gov.br). Consultados em 2026-11-20.
- W3C: WCAG 2.2 e técnicas (W3C Document License).
- Google Search Central e web.dev (Core Web Vitals) e documentação do Lighthouse (Chrome for Developers).
- Nielsen Norman Group (10 heurísticas de usabilidade; texto parafraseado).
- Deque: documentação das regras do axe-core.
- OpenAI, Anthropic, Google e Perplexity: documentação oficial dos rastreadores.
- OWASP e MDN Web Docs (conteúdo do MDN sob CC-BY-SA 2.5: crédito "Mozilla Contributors"; só descrito em palavras próprias).
- Legislação brasileira em planalto.gov.br (CDC Lei 8.078/1990, Decreto 7.962/2013, LGPD Lei 13.709/2018) e guias da ANPD em gov.br/anpd. Normas públicas; o projeto **não é parecer jurídico**.
- Baymard Institute e outras fontes de UX citadas por URL nas regras de seções por tipo.

## Ferramentas usadas (dependências, não redistribuídas no repositório)

| Ferramenta | Licença |
|---|---|
| Playwright / playwright-core 1.65 | Apache-2.0 |
| axe-core 4.14 (Deque) | MPL-2.0 (usado como biblioteca, sem alterações) |
| Lighthouse 13.6 e chrome-launcher | Apache-2.0 |
| ajv, ajv-formats | MIT |
| adm-zip 0.6 | MIT |
| postcss 8 | MIT |

- Decisão do Landgericht München I (20/01/2022, 3 O 17493/20), citada só por referência; README do repositório google/fonts (licenças das fontes), descrito em palavras próprias.

## Como corrigir um crédito
Abra uma issue ou edite este arquivo. Se algum titular pedir remoção, remova a regra correspondente (`origem_ids`) e registre em `DECISOES.md`.

## Observações de licença (v2)
- **Impeccable:** a pasta local não traz arquivo LICENSE nem NOTICE; a licença Apache-2.0 vem só do cabeçalho do SKILL.md. Nenhum texto foi copiado; as regras são reescritas.
- **ai-design-tells e unslop-ui:** os dados de sites de terceiros e os textos de Reddit desses repositórios não foram usados.
- **Lista de clichês em português:** cerca de metade das entradas é "proposta do projeto" (confiança baixa), e as demais citam artigos públicos como apoio; nenhuma lista foi copiada.
- **web.dev e developer.chrome.com:** a licença das páginas não foi confirmada; usadas só como referência de números (citados com URL), sem cópia de texto.
