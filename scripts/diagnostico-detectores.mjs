#!/usr/bin/env node
// Diagnóstico: roda medidores + detectores + verificador em fixtures e mostra cobertura, erros e achados descartados.
//   node scripts/diagnostico-detectores.mjs fixture1 fixture2 ...
import { lerFixture } from '../tests/helpers/ler-fixture.mjs';
import { carregarRegras, carregarMedidores, carregarDetectores, executarMedidores, rodarMotor } from '../lib/motor.mjs';
import { verificarAchados } from '../lib/verificador.mjs';
import { calcularTellScore } from '../lib/tell-score.mjs';

const nomes = process.argv.slice(2);
const detectores = await carregarDetectores();
const medidores = await carregarMedidores();
for (const nome of nomes) {
  const { ctx, fechar, servidor } = await lerFixture(nome, { manterAberto: true });
  try {
    const med = await executarMedidores(ctx, { medidores, ignorar: ['lighthouse'] });
    const regras = carregarRegras({ modo: 'completo', tipoDeSite: null });
    const motor = rodarMotor({ ctx, med, regras, detectores });
    const v = verificarAchados(motor.achados, ctx);
    const t = calcularTellScore(motor.tells);
    console.log(`\n== ${nome}: achados ${motor.achados.length}, aprovados ${v.aprovados.length}, descartados ${v.descartados.length}, tell ${t.nota} | avaliadas ${motor.cobertura.avaliadas}/${motor.cobertura.regrasDeScript}, semDetector ${motor.cobertura.semDetector.length}, nulas ${motor.cobertura.naoAvaliadas.length}, erro ${motor.cobertura.comErro.length}`);
    for (const e of motor.cobertura.comErro) console.log('   ERRO detector', e.regra_id, e.erro.slice(0, 160));
    for (const d of v.descartados) console.log('   DESCARTADO', d.regra_id, '|', d.motivo.slice(0, 170));
    for (const [id, m] of Object.entries(med)) if (m.erro) console.log('   MEDIDOR com erro', id, m.erro.slice(0, 120));
    if (nome === nomes[0]) console.log('   semDetector:', motor.cobertura.semDetector.join(', ').slice(0, 600));
  } finally { await fechar(); }
}
