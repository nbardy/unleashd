/**
 * Integration test to verify that new conversations do not result in duplicates
 * due to file polling.
 */

const WebSocket = require('ws');
const { randomUUID: uuidv4 } = require('node:crypto');

console.log('=== Testing Duplicate Conversations Issue ===\\n');

const ws = new WebSocket('ws://localhost:3000');
const uniqueMarker = uuidv4();
let createdConversationId = null;
const receivedConversations = new Map();
let isComplete = false;

ws.on('open', () => {
  console.log('[WS] Connected');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'init': {
      for (const conv of msg.conversations) {
        receivedConversations.set(conv.id, conv);
      }
      const initialCount = receivedConversations.size;
      console.log(`[WS] Init - ${initialCount} existing conversations`);

      ws.send(
        JSON.stringify({
          type: 'create_conversation',
          commandId: uuidv4(),
          conversationId: uuidv4(),
          workingDirectory: process.cwd(),
          config: {
            provider: 'codex',
            model: { mode: 'default' },
            reasoning: { mode: 'default' },
          },
        })
      );
      break;
    }

    case 'conversation_created':
      createdConversationId = msg.conversation.id;
      console.log(`[WS] Conversation created: ${createdConversationId}`);
      receivedConversations.set(createdConversationId, msg.conversation);

      console.log(`[WS] Sending test message with marker: ${uniqueMarker}`);
      ws.send(
        JSON.stringify({
          type: 'queue_message',
          // send_message was deleted (T14b); queue_message is the one send path and needs a commandId.
          commandId: crypto.randomUUID(),
          conversationId: createdConversationId,
          content: `Just repeat this exact UUID back to me: ${uniqueMarker}`,
        })
      );
      break;

    case 'conversations_updated':
      for (const conv of msg.conversations) {
        receivedConversations.set(conv.id, conv);
      }
      break;

    case 'status':
      if (!msg.isRunning && createdConversationId === msg.conversationId && !isComplete) {
        console.log('[WS] Process completed. Waiting 6 seconds for file poller...');
        isComplete = true;
        setTimeout(() => {
          checkDuplicates();
        }, 6000);
      }
      break;
  }
});

function checkDuplicates() {
  clearTimeout(testTimeout);
  console.log('\\n=== Checking for duplicates ===');

  const matches = [];
  for (const [_id, conv] of receivedConversations.entries()) {
    const hasMarker = conv.messages.some((m) => m.content?.includes(uniqueMarker));
    if (hasMarker) {
      matches.push(conv);
    }
  }

  console.log(`Found ${matches.length} conversation(s) with the marker.`);
  if (matches.length === 1) {
    console.log('[SUCCESS] No duplicates found! The conversation was properly reconciled.');
    console.log(`Conversation ID: ${matches[0].id}`);
    console.log(`Provider Session ID: ${matches[0].sessionId}`);
    ws.close();
    process.exit(0);
  } else {
    console.log(`[FAILED] Expected 1 conversation, found ${matches.length}`);
    matches.forEach((m, i) => console.log(`Match ${i + 1}: ID=${m.id}, SessionID=${m.sessionId}`));
    ws.close();
    process.exit(1);
  }
}

ws.on('error', (err) => {
  console.error('[WS] Error:', err.message);
  process.exit(1);
});

// Timeout after 45 seconds
const testTimeout = setTimeout(() => {
  console.log('\\n[TIMEOUT] Test timed out');
  ws.close();
  process.exit(1);
}, 45000);
