// Simulación de la etapa 4: genera transacciones de prueba contra la Transaction API
// y verifica con la History API que el estado reconstruido coincide.
//
//   node scripts/simular.mjs
//   API_URL=http://mi-servidor:3000 HISTORY_URL=http://mi-servidor:3001 node scripts/simular.mjs

const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const HISTORY_URL = (process.env.HISTORY_URL || 'http://localhost:3001').replace(/\/+$/, '');
const RUN = Date.now().toString(36);

const unexpected = [];
const created = [];

async function send(method, path, body, expectedStatus) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }

  const ok = res.status === expectedStatus;
  const state = json?.state;
  const detail = state
    ? `v${state.version} ${state.status}`
    : json?.message
      ? String(Array.isArray(json.message) ? json.message.join(', ') : json.message)
      : '';
  console.log(`  ${ok ? 'OK ' : 'MAL'} ${method} ${path} -> ${res.status}${ok ? '' : ` (esperaba ${expectedStatus})`}  ${detail}`);

  if (!ok) unexpected.push(`${method} ${path}: ${res.status}, esperaba ${expectedStatus}`);
  return json;
}

async function createTx(name, amount, currency, customerId) {
  const transactionId = `demo-${name}-${RUN}`;
  const res = await send('POST', '/transactions', { transactionId, amount, currency, customerId }, 201);
  return { id: transactionId, state: res?.state };
}

async function step(tx, action, body, status = 200) {
  const res = await send('POST', `/transactions/${tx.id}/${action}`, { ...body, expectedVersion: tx.state.version }, status);
  if (res?.state) tx.state = res.state;
  return res;
}

async function scenario(title, expected, run) {
  console.log(`\n${title}`);
  const tx = await run();
  created.push({ title, id: tx.id, expected, final: tx.state });
}

async function happyPath() {
  const tx = await createTx('feliz', 15000, 'CRC', 'cliente-ana');
  await step(tx, 'request-payment', {});
  await step(tx, 'approve-payment', { approvalCode: 'AUTH-100200' });
  await step(tx, 'complete', {});
  return tx;
}

async function rejectionThenApproval() {
  const tx = await createTx('reintento', 25000, 'CRC', 'cliente-luis');
  await step(tx, 'request-payment', {});
  await step(tx, 'reject-payment', { reason: 'Fondos insuficientes' });
  await step(tx, 'retry-payment', {});
  await step(tx, 'approve-payment', { approvalCode: 'AUTH-982143' });
  await step(tx, 'complete', {});
  return tx;
}

async function rejectedTwice() {
  const tx = await createTx('rechazada', 8500, 'USD', 'cliente-sofia');
  await step(tx, 'request-payment', {});
  await step(tx, 'reject-payment', { reason: 'Tarjeta vencida' });
  await step(tx, 'retry-payment', {});
  await step(tx, 'reject-payment', { reason: 'Límite de crédito excedido' });
  return tx;
}

async function pendingPayment() {
  const tx = await createTx('pendiente', 4200, 'CRC', 'cliente-mario');
  await step(tx, 'request-payment', {});
  return tx;
}

async function onlyCreated() {
  return createTx('creada', 990, 'USD', 'cliente-elena');
}

async function invalidCommands() {
  const tx = await createTx('errores', 15000, 'CRC', 'cliente-pedro');
  console.log('  -- Comandos inválidos: ninguno debe agregar un evento --');
  await send('POST', `/transactions/${tx.id}/request-payment`, { amount: 10, expectedVersion: 1 }, 400);
  await send('POST', `/transactions/${tx.id}/request-payment`, { expectedVersion: 99 }, 409);
  await send('POST', `/transactions/${tx.id}/complete`, { expectedVersion: 1 }, 400);
  await send('POST', '/transactions', { transactionId: tx.id, amount: 1, currency: 'CRC', customerId: 'x' }, 409);
  await send('POST', `/transactions/no-existe-${RUN}/request-payment`, {}, 404);
  return tx;
}

async function verifyWithHistory() {
  console.log(`\nVerificación en la History API (${HISTORY_URL})`);
  try {
    await fetch(`${HISTORY_URL}/history/transactions`);
  } catch {
    console.log('  La History API no responde; se omite la verificación.');
    return;
  }

  const rows = [];
  for (const { title, id, expected } of created) {
    const [stateRes, eventsRes] = await Promise.all([
      fetch(`${HISTORY_URL}/history/transactions/${encodeURIComponent(id)}`),
      fetch(`${HISTORY_URL}/history/transactions/${encodeURIComponent(id)}/events`),
    ]);
    const state = await stateRes.json();
    const events = await eventsRes.json();
    const matches =
      state.status === expected.status &&
      state.version === expected.version &&
      state.attemptCount === expected.attemptCount &&
      Array.isArray(events) &&
      events.length === expected.version;

    if (!matches) unexpected.push(`History API: ${id} no coincide con lo esperado`);
    rows.push({
      escenario: title,
      transactionId: id,
      estado: state.status,
      version: state.version,
      intentos: state.attemptCount,
      eventos: Array.isArray(events) ? events.map((e) => e.type).join(' > ') : '-',
      ok: matches ? 'sí' : 'NO',
    });
  }
  console.table(rows);
}

async function main() {
  console.log(`Transaction API: ${API_URL}`);
  try {
    await fetch(`${API_URL}/transactions`);
  } catch {
    console.error(`No se pudo conectar con la Transaction API en ${API_URL}. ¿Está encendida?`);
    process.exitCode = 1;
    return;
  }

  await scenario('1. Camino feliz', { status: 'COMPLETED', version: 4, attemptCount: 1 }, happyPath);
  await scenario('2. Rechazo, reintento y aprobación', { status: 'COMPLETED', version: 6, attemptCount: 2 }, rejectionThenApproval);
  await scenario('3. Rechazada dos veces', { status: 'PAYMENT_REJECTED', version: 5, attemptCount: 2 }, rejectedTwice);
  await scenario('4. Pago pendiente', { status: 'PAYMENT_PENDING', version: 2, attemptCount: 1 }, pendingPayment);
  await scenario('5. Recién creada', { status: 'CREATED', version: 1, attemptCount: 0 }, onlyCreated);
  await scenario('6. Errores esperados', { status: 'CREATED', version: 1, attemptCount: 0 }, invalidCommands);

  await verifyWithHistory();

  if (unexpected.length > 0) {
    console.error('\nResultados inesperados:');
    for (const line of unexpected) console.error(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nSimulación terminada sin resultados inesperados.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
