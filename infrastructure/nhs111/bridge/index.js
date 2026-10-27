/**
 * PharmStation NHS 111 AMQP → Supabase Bridge
 * =============================================
 * Consumes FHIR STU3 JSON bundles from the RabbitMQ "encounter-report" queue
 * (published by the NHS 111 Adaptor) and forwards them to the Supabase
 * nhs111-receive Edge Function via HTTPS POST.
 *
 * Environment Variables:
 *   RABBITMQ_URL          — amqp://user:pass@host:port
 *   RABBITMQ_QUEUE        — Queue name (default: encounter-report)
 *   SUPABASE_FUNCTION_URL — Full URL to nhs111-receive edge function
 *   SUPABASE_ANON_KEY     — Supabase anon/public key for Authorization header
 *   NHS111_BRIDGE_SECRET  — Shared secret sent as x-bridge-secret; must match
 *                           the nhs111-receive function secret of the same name
 *   LOG_LEVEL             — "debug" | "info" | "warn" | "error" (default: info)
 */

const amqplib = require('amqplib');

// ─── Configuration ─────────────────────────────────────────────────
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const QUEUE_NAME = process.env.RABBITMQ_QUEUE || 'encounter-report';
const SUPABASE_FUNCTION_URL = process.env.SUPABASE_FUNCTION_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const NHS111_BRIDGE_SECRET = process.env.NHS111_BRIDGE_SECRET;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

function log(level, msg, data) {
  if (LOG_LEVELS[level] >= currentLevel) {
    const prefix = `[${level.toUpperCase()}]`;
    if (data) {
      console.log(`${prefix} ${msg}`, JSON.stringify(data));
    } else {
      console.log(`${prefix} ${msg}`);
    }
  }
}

// ─── Validation ────────────────────────────────────────────────────
if (!SUPABASE_FUNCTION_URL) {
  log('error', 'SUPABASE_FUNCTION_URL is required');
  process.exit(1);
}
if (!SUPABASE_ANON_KEY) {
  log('error', 'SUPABASE_ANON_KEY is required');
  process.exit(1);
}
if (!NHS111_BRIDGE_SECRET) {
  log('error', 'NHS111_BRIDGE_SECRET is required');
  process.exit(1);
}

// ─── Stats ─────────────────────────────────────────────────────────
let stats = { forwarded: 0, failed: 0, started: new Date().toISOString() };

// ─── Main ──────────────────────────────────────────────────────────
async function start() {
  log('info', 'PharmStation NHS 111 Bridge starting', {
    queue: QUEUE_NAME,
    target: SUPABASE_FUNCTION_URL,
  });

  let connection;
  let channel;
  const MAX_RETRIES = 10;
  let retries = 0;

  // Retry loop for RabbitMQ connection (it may not be ready yet)
  while (retries < MAX_RETRIES) {
    try {
      connection = await amqplib.connect(RABBITMQ_URL);
      log('info', 'Connected to RabbitMQ');
      break;
    } catch (err) {
      retries++;
      const delay = Math.min(retries * 2, 30);
      log('warn', `RabbitMQ not ready, retry ${retries}/${MAX_RETRIES} in ${delay}s`, {
        error: err.message,
      });
      await sleep(delay * 1000);
    }
  }

  if (!connection) {
    log('error', 'Failed to connect to RabbitMQ after max retries');
    process.exit(1);
  }

  channel = await connection.createChannel();

  // The NHS 111 adaptor uses the RabbitMQ JMS client which publishes to
  // the "jms.durable.queues" exchange (default for RMQDestination with amqp=true).
  // We need to:
  // 1. Ensure the exchange exists
  // 2. Assert the queue
  // 3. Bind the queue to the JMS exchange with the correct routing key
  const JMS_EXCHANGE = 'jms.durable.queues';
  
  try {
    await channel.assertExchange(JMS_EXCHANGE, 'direct', { durable: true });
    log('info', `Exchange "${JMS_EXCHANGE}" confirmed`);
  } catch (err) {
    log('warn', `Could not assert exchange "${JMS_EXCHANGE}", it may already exist with different settings`, { error: err.message });
    // Reconnect channel if it was closed by the error
    channel = await connection.createChannel();
  }

  await channel.assertQueue(QUEUE_NAME, { durable: true });
  
  // Check how many messages are already in the queue
  const queueInfo = await channel.checkQueue(QUEUE_NAME);
  log('info', `Queue "${QUEUE_NAME}" has ${queueInfo.messageCount} messages waiting, ${queueInfo.consumerCount} consumers`);

  // Bind the queue to the JMS exchange so messages from the adaptor arrive here
  await channel.bindQueue(QUEUE_NAME, JMS_EXCHANGE, QUEUE_NAME);
  log('info', `Queue "${QUEUE_NAME}" bound to exchange "${JMS_EXCHANGE}" with routing key "${QUEUE_NAME}"`);

  // Also bind to default exchange (in case adaptor config changes)
  // Default exchange auto-binds by queue name, so no explicit bind needed.

  // Process one message at a time to ensure reliability
  channel.prefetch(1);

  log('info', `Waiting for messages on queue "${QUEUE_NAME}"...`);

  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return;

    const messageId = msg.properties.messageId || 'unknown';
    const contentType = msg.properties.contentType || 'application/json';

    log('debug', 'Received message from queue', {
      messageId,
      contentType,
      sizeBytes: msg.content.length,
    });

    try {
      // The adaptor publishes FHIR Bundle JSON to the queue
      const fhirBundle = msg.content.toString('utf-8');

      // Validate it's parseable JSON
      JSON.parse(fhirBundle);

      // Forward to Supabase Edge Function
      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'x-bridge-secret': NHS111_BRIDGE_SECRET,
        },
        body: fhirBundle,
      });

      if (response.ok) {
        const result = await response.json();
        stats.forwarded++;
        log('info', 'Successfully forwarded FHIR bundle to Supabase', {
          messageId,
          referralId: result.referral?.id,
          status: response.status,
          totalForwarded: stats.forwarded,
        });
        channel.ack(msg);
      } else {
        const errorBody = await response.text();
        stats.failed++;
        log('error', 'Supabase edge function returned error', {
          messageId,
          status: response.status,
          error: errorBody,
          totalFailed: stats.failed,
        });
        // Nack and requeue — the edge function might be temporarily down
        channel.nack(msg, false, true);

        // Back off before processing next message
        await sleep(5000);
      }
    } catch (err) {
      stats.failed++;
      log('error', 'Failed to process message', {
        messageId,
        error: err.message,
        totalFailed: stats.failed,
      });
      // Nack and requeue
      channel.nack(msg, false, true);
      await sleep(5000);
    }
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────
  const shutdown = async (signal) => {
    log('info', `Received ${signal}, shutting down gracefully`, stats);
    try {
      await channel.close();
      await connection.close();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle connection errors
  connection.on('error', (err) => {
    log('error', 'RabbitMQ connection error', { error: err.message });
  });

  connection.on('close', () => {
    log('warn', 'RabbitMQ connection closed, exiting (container will restart)');
    process.exit(1);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Start ─────────────────────────────────────────────────────────
start().catch((err) => {
  log('error', 'Bridge fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
