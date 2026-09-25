/**
 * Test WebSocket message flow to verify client receives assistant responses
 */

const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');

console.log('=== Testing WebSocket Message Flow ===\n');

const ws = new WebSocket('ws://localhost:3000');
let conversationId = null;
let receivedChunks = '';
let hasAssistantMessage = false;

ws.on('open', () => {
  console.log('[WS] Connected');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(
    `[WS] Received: ${msg.type}`,
    msg.type === 'chunk' ? `"${msg.text?.substring(0, 30)}..."` : ''
  );

  switch (msg.type) {
    case 'init':
      console.log(`[WS] Init - ${msg.conversations.length} existing conversations`);
      // Create new conversation
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
      console.log(`[WS] Conversation created: ${conversationId}`);
      // Send test message
      console.log('[WS] Sending test message...');
      ws.send(
        JSON.stringify({
          type: 'queue_message',
          // send_message was deleted (T14b); queue_message is the one send path and needs a commandId.
          commandId: crypto.randomUUID(),
          conversationId,
          content: 'Say "hello test" and nothing else.',
        })
      );
      break;

    case 'message':
      console.log(`[WS] Message: role=${msg.role}, content="${msg.content?.substring(0, 50)}..."`);
      if (msg.role === 'assistant') {
        hasAssistantMessage = true;
        console.log('[SUCCESS] Received assistant message broadcast!');
      }
      break;

    case 'chunk':
      receivedChunks += msg.text || '';
      break;

    case 'status':
      console.log(`[WS] Status: isRunning=${msg.isRunning}`);
      if (!msg.isRunning && hasAssistantMessage) {
        console.log('\n=== Results ===');
        console.log(`Received assistant message: ${hasAssistantMessage}`);
        console.log(`Total chunk text: "${receivedChunks}"`);
        console.log('\n=== TEST PASSED ===');
        ws.close();
        process.exit(0);
      }
      break;
  }
});

ws.on('error', (err) => {
  console.error('[WS] Error:', err.message);
  process.exit(1);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('\n[TIMEOUT] Test timed out');
  console.log(`Received assistant message: ${hasAssistantMessage}`);
  console.log(`Total chunk text: "${receivedChunks}"`);
  console.log('\n=== TEST FAILED ===');
  ws.close();
  process.exit(1);
}, 30000);
