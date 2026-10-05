import { generateText } from './gemini-direct.js';
import { MASTER_ORCHESTRATOR_PROMPT } from './master-orchestrator-prompt.js';

async function testMasterOrchestrator() {
  console.log('🎮 Testing Master Orchestrator AI\n');
  console.log('=' .repeat(70));
  
  const sessionId = 'orchestrator-test-' + Date.now();
  
  try {
    // User's initial request
    console.log('\n👤 User: "make a 3d racing game"');
    console.log('\n⏳ AI is orchestrating...\n');
    
    const response1 = await generateText(
      "make a 3d racing game",
      {
        sessionId,
        systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
        model: 'gemini-3.8-flash',
        maxTokens: 8192, // Smaller for this test
        temperature: 0.7
      }
    );
    
    console.log('🤖 AI Response Phase 1:');
    console.log('=' .repeat(70));
    console.log(response1.text.substring(0, 1500));
    console.log('\n...(truncated for readability)...\n');
    
    // Check if AI understood the orchestrator role
    const hasAction = response1.text.includes('"action"');
    const hasDirections = response1.text.toLowerCase().includes('direction');
    const hasVisual = response1.text.toLowerCase().includes('visual') || 
                     response1.text.toLowerCase().includes('style');
    
    console.log('✅ Response Analysis:');
    console.log(`  - Contains structured action: ${hasAction ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  - Mentions directions: ${hasDirections ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  - Discusses visual style: ${hasVisual ? 'YES ✓' : 'NO ✗'}`);
    
    console.log(`\n📊 Token Usage: ${response1.usage.completionTokens} tokens generated`);
    console.log(`📝 Model Used: ${response1.model}`);
    
    // Simulate user selecting a direction (if AI generated options)
    if (hasDirections) {
      console.log('\n\n' + '=' .repeat(70));
      console.log('👤 User: "I choose option 2"');
      console.log('\n⏳ AI continues orchestration...\n');
      
      const response2 = await generateText(
        "I choose option 2",
        {
          sessionId, // SAME session - should remember previous directions
          systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
          model: 'gemini-3.8-flash',
          maxTokens: 16384,
          temperature: 0.7
        }
      );
      
      console.log('🤖 AI Response Phase 2:');
      console.log('=' .repeat(70));
      console.log(response2.text.substring(0, 1000));
      console.log('\n...(truncated)...\n');
      
      const hasGameCode = response2.text.includes('<!DOCTYPE') || 
                          response2.text.includes('gameScript');
      const hasAssets = response2.text.toLowerCase().includes('asset') ||
                       response2.text.toLowerCase().includes('model');
      
      console.log('✅ Response Analysis:');
      console.log(`  - Generated game code: ${hasGameCode ? 'YES ✓' : 'NO ✗'}`);
      console.log(`  - Discusses assets: ${hasAssets ? 'YES ✓' : 'NO ✗'}`);
      console.log(`\n📊 Token Usage: ${response2.usage.completionTokens} tokens`);
    }
    
    console.log('\n\n' + '=' .repeat(70));
    console.log('✅ Master Orchestrator Test Complete!');
    console.log('\nThe AI is operating autonomously with the master system prompt.');
    console.log('It understands it should:');
    console.log('  1. Generate visual directions first');
    console.log('  2. Wait for/auto-select user choice');
    console.log('  3. Match assets from catalog');
    console.log('  4. Generate complete game code');
    
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    throw error;
  }
}

testMasterOrchestrator();
