/**
 * Test multi-turn WebSocket conversation to verify --resume works
 */

const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');

console.log('=== Testing Multi-Turn WebSocket Conversation ===\n');

const ws = new WebSocket('ws://localhost:3000');
let conversationId = null;
let messageCount = 0;
const responses = [];

ws.on('open', () => {
  console.log('[WS] Connected');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'chunk') {
    console.log(`[WS] chunk: "${msg.text?.substring(0, 40)}..."`);
  } else {
    console.log(`[WS] ${msg.type}`);
  }

  switch (msg.type) {
    case 'init':
      ws.send(
        JSON.stringify({
          type: 'create_conversation',
          commandId: randomUUID(),
          conversationId: randomUUID(),
          workingDirectory: process.cwd(),
          config: {
            provider: 'claude',
            model: { mode: 'default' },
            reasoning: { mode: 'default' },
          },
        })
      );
      break;

    case 'conversation_created':
      conversationId = msg.conversation.id;
      console.log('\n--- Turn 1: Sending first message ---');
      ws.send(
        JSON.stringify({
          type: 'queue_message',
          // send_message was deleted (T14b); queue_message is the one send path and needs a commandId.
          commandId: crypto.randomUUID(),
          conversationId,
          content: 'Remember the secret word: ELEPHANT. Just say "OK, I will remember ELEPHANT"',
        })
      );
      break;

    case 'message':
      if (msg.role === 'assistant' && msg.content === '') {
        // Assistant message started
      }
      break;

    case 'chunk':
      if (responses[messageCount] === undefined) {
        responses[messageCount] = '';
      }
      responses[messageCount] += msg.text || '';
      break;

    case 'status':
      if (!msg.isRunning && messageCount === 0 && responses[0]) {
        // First message complete, send second
        messageCount++;
        console.log(`\n[Turn 1 Response]: "${responses[0]}"\n`);
        console.log('--- Turn 2: Asking for the secret word ---');
        ws.send(
          JSON.stringify({
            type: 'queue_message',
            // send_message was deleted (T14b); queue_message is the one send path and needs a commandId.
            commandId: crypto.randomUUID(),
            conversationId,
            content: 'What was the secret word I asked you to remember? Just say the word.',
          })
        );
      } else if (!msg.isRunning && messageCount === 1 && responses[1]) {
        // Second message complete
        console.log(`\n[Turn 2 Response]: "${responses[1]}"\n`);

        // Check if ELEPHANT is in the response
        const hasElephant = responses[1].toUpperCase().includes('ELEPHANT');
        console.log('\n=== Results ===');
        console.log(`Turn 1: ${responses[0].substring(0, 60)}...`);
        console.log(`Turn 2: ${responses[1]}`);
        console.log(`Context preserved (contains ELEPHANT): ${hasElephant}`);
        console.log(hasElephant ? '\n=== TEST PASSED ===' : '\n=== TEST FAILED ===');
        ws.close();
        process.exit(hasElephant ? 0 : 1);
      }
      break;

    case 'error':
      console.error('[ERROR]', msg.message);
      ws.close();
      process.exit(1);
      break;
  }
});

ws.on('error', (err) => {
  console.error('[WS] Error:', err.message);
  process.exit(1);
});

// Timeout after 60 seconds
setTimeout(() => {
  console.log('\n[TIMEOUT] Test timed out');
  console.log('Responses:', responses);
  console.log('\n=== TEST FAILED ===');
  ws.close();
  process.exit(1);
}, 60000);
