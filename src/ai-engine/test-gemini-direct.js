import { generateText } from './gemini-direct.js';

async function testBasicGeneration() {
  console.log('Testing basic Gemini API call...\n');
  
  try {
    const result = await generateText(
      'Write a simple "Hello World" HTML page with a red background and centered text. Keep it under 50 lines.',
      {
        model: 'gemini-3.8-flash',
        maxTokens: 65536
      }
    );
    
    console.log('✓ Success!');
    console.log('Generated text length:', result.text.length, 'characters');
    console.log('Token usage:', result.usage);
    console.log('\nFirst 500 characters:');
    console.log(result.text.substring(0, 500));
    console.log('\nLast 200 characters:');
    console.log(result.text.substring(result.text.length - 200));
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    throw error;
  }
}

testBasicGeneration();
