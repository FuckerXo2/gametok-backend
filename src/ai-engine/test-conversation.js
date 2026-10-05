import { generateText, clearConversation, getConversationHistory } from './gemini-direct.js';

async function testConversationMemory() {
  console.log('🧪 Testing Conversation Memory\n');
  console.log('=' .repeat(60));
  
  const sessionId = 'test-session-123';
  
  try {
    // Turn 1: Set up a game concept
    console.log('\n📝 Turn 1: User sets up a concept');
    const turn1 = await generateText(
      "I want to make a space racing game. Remember this for our conversation.",
      {
        sessionId,
        model: 'gemini-3.8-flash',
        maxTokens: 200,
        temperature: 0.7
      }
    );
    console.log('🤖 AI Response:', turn1.text.substring(0, 150) + '...\n');
    
    // Turn 2: Ask about the concept (tests if AI remembers)
    console.log('\n📝 Turn 2: User asks about the concept (should remember space racing)');
    const turn2 = await generateText(
      "What kind of game did I say I wanted to make?",
      {
        sessionId, // SAME session ID - should remember previous conversation
        model: 'gemini-3.8-flash',
        maxTokens: 200,
        temperature: 0.7
      }
    );
    console.log('🤖 AI Response:', turn2.text.substring(0, 200));
    console.log('\n✅ Memory test: Does response mention "space racing"?', 
      turn2.text.toLowerCase().includes('space') || turn2.text.toLowerCase().includes('racing') ? 'YES ✓' : 'NO ✗');
    
    // Turn 3: Ask for a modification
    console.log('\n📝 Turn 3: User modifies the concept');
    const turn3 = await generateText(
      "Actually, make it cyberpunk themed instead of space.",
      {
        sessionId,
        model: 'gemini-3.8-flash',
        maxTokens: 200,
        temperature: 0.7
      }
    );
    console.log('🤖 AI Response:', turn3.text.substring(0, 200));
    
    // Check conversation history
    console.log('\n\n📚 Full Conversation History:');
    console.log('=' .repeat(60));
    const history = getConversationHistory(sessionId);
    history.forEach((msg, i) => {
      const emoji = msg.role === 'user' ? '👤' : '🤖';
      console.log(`\n${emoji} Message ${i + 1} (${msg.role}):`);
      console.log(msg.content.substring(0, 150) + (msg.content.length > 150 ? '...' : ''));
    });
    
    console.log(`\n\n💾 Total messages in memory: ${history.length}`);
    
    // Clear conversation
    console.log('\n🗑️  Clearing conversation...');
    clearConversation(sessionId);
    console.log('✅ Conversation cleared. History length:', getConversationHistory(sessionId).length);
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    throw error;
  }
}

testConversationMemory();
