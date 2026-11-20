// Pré-carregado pelo `npm test` (node --import): a suíte pública é hermética e igual em qualquer máquina,
// então a camada local opcional (pasta local/, D-028) fica DESLIGADA aqui. Os testes do mecanismo passam
// as pastas de exemplo explicitamente (tests/fixtures/secoes-locais-exemplo).
process.env.CRITIQUESITES_LOCAL = process.env.CRITIQUESITES_LOCAL_TESTES || 'off';
