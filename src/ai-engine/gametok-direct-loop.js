/**
 * GameTok Direct Generation Loop - No CLI
 * 
 * Replaces gametok-generation-loop.js AGY-based flow with direct Gemini API + Master Orchestrator
 * 
 * Single AI agent orchestrates:
 * 1. Visual direction conceptualization
 * 2. Image generation for each direction
 * 3. User selection (or auto-select after 60s timeout)
 * 4. Asset matching from catalog
 * 5. Complete game code generation
 */

import { generateText, clearConversation } from './gemini-direct.js';
import { MASTER_ORCHESTRATOR_PROMPT } from './master-orchestrator-prompt.js';
import { generateConceptCardImage } from './openai-image-client.js';
import { sendPushToTokenOrUser } from '../notifications.js';

/**
 * Run direct Gemini generation with master orchestrator
 * 
 * @param {object} params
 * @param {string} params.jobId - Job ID for tracking
 * @param {string} params.prompt - User's game idea
 * @param {string} [params.sessionId] - Session ID for conversation memory
 * @param {string} [params.orientation] - portrait | landscape
 * @param {object} [params.selectedDirection] - Pre-selected visual direction (skips Phase 1)
 * @param {object} [params.selected3DModel] - Pre-selected 3D model asset
 * @param {Array} [params.selectedAssets] - Pre-selected assets
 * @param {boolean} [params.skipDirections] - Skip visual direction generation, auto-select immediately
 * @param {function} [params.onProgress] - Progress callback
 * @param {function} [params.onDirectionsReady] - Callback when directions are ready for user selection
 * @returns {Promise<object>} Final game state or directions for selection
 */
export async function runDirectGenerationLoop({
  jobId,
  prompt,
  sessionId = null,
  orientation = 'portrait',
  selectedDirection = null,
  selected3DModel = null,
  selectedAssets = [],
  skipDirections = false,
  onProgress = null,
  onDirectionsReady = null,
}) {
  const effectiveSessionId = sessionId || `job-${jobId}`;
  
  console.log(`🚀 [Direct Loop] Starting generation for job ${jobId}`);
  console.log(`   Prompt: "${prompt}"`);
  console.log(`   Session: ${effectiveSessionId}`);
  console.log(`   Skip Directions: ${skipDirections}`);
  console.log(`   Pre-selected Direction: ${selectedDirection ? selectedDirection.name : 'none'}`);
  
  const gameState = {
    jobId,
    prompt,
    sessionId: effectiveSessionId,
    orientation,
    attemptCount: 0,
    maxAttempts: 3,
    errorHistory: [],
    metadata: {
      title: null,
      thumbnailPrompt: null,
      controls: null,
    },
  };
  
  // Clear any existing conversation for this session
  clearConversation(effectiveSessionId);
  
  try {
    // Build initial message with all context
    let initialMessage = prompt;
    
    // Add asset context if provided
    if (selectedAssets && selectedAssets.length > 0) {
      initialMessage += '\n\nPre-selected Assets:\n';
      selectedAssets.forEach(asset => {
        initialMessage += `- ${asset.role || asset.type}: ${asset.label || asset.url}\n`;
      });
    }
    
    if (selected3DModel) {
      initialMessage += `\nSelected 3D Model: ${selected3DModel.label || selected3DModel.url}\n`;
    }
    
    // Add orientation requirement
    initialMessage += `\nOrientation: ${orientation}`;
    
    // Modify prompt based on whether we want directions or instant game
    if (skipDirections || selectedDirection) {
      // User wants instant game or already selected direction
      initialMessage += '\n\nIMPORTANT: Generate the complete game immediately. Skip visual direction selection.';
      
      if (selectedDirection) {
        initialMessage += `\nUser has pre-selected visual direction: "${selectedDirection.name}"`;
        initialMessage += `\nStyle: ${selectedDirection.instruction || selectedDirection.modifier}`;
        initialMessage += `\nColors: ${JSON.stringify(selectedDirection.colors)}`;
      }
    } else {
      // Interactive mode - generate directions for user selection
      initialMessage += '\n\nFirst, generate 4 visual direction options for the user to choose from.';
    }
    
    if (onProgress) onProgress(10, 'conceptualizing', 'AI is conceptualizing your game...');
    
    // Phase 1: Initial generation
    console.log(`🧠 [Direct Loop] Phase 1: ${skipDirections || selectedDirection ? 'Instant generation' : 'Direction conceptualization'}...`);
    
    const response = await generateText(initialMessage, {
      sessionId: effectiveSessionId,
      systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
      model: 'gemini-3.8-flash',
      maxTokens: skipDirections || selectedDirection ? 65536 : 4096, // Less tokens for directions phase
      temperature: 0.7,
    });
    
    console.log(`✅ [Direct Loop] Generated ${response.usage.completionTokens} tokens with ${response.model}`);
    
    // Parse AI response
    const parsed = parseOrchestratorResponse(response.text);
    
    // Check if AI is waiting for direction selection
    if (parsed.action === 'generate_visual_directions' && !skipDirections && !selectedDirection) {
      console.log(`🎨 [Direct Loop] AI generated ${parsed.directions?.length || 0} visual directions`);
      
      if (parsed.directions && parsed.directions.length > 0) {
        // Generate preview images for each direction using GPT Image 2.5 Flare
        console.log(`🖼️ [Direct Loop] Generating preview images with GPT Image 2.5 Flare...`);
        
        if (onProgress) onProgress(40, 'generating_images', 'Generating preview images...');
        
        const directionsWithImages = await Promise.all(
          parsed.directions.map(async (dir, index) => {
            try {
              const imagePrompt = dir.imagePrompt || dir.modifier || `${dir.name} style game screenshot`;
              console.log(`  🎨 Image ${index + 1}/4: ${dir.name}`);
              
              const imageResult = await generateConceptCardImage({
                prompt: imagePrompt,
                size: orientation === 'landscape' ? '1792x1024' : '1024x1024',
                prefix: `visual-directions/${jobId}`,
              });
              
              return {
                ...dir,
                id: `dir-${jobId}-${index}`, // Add ID for frontend compatibility
                imageUrl: imageResult.url,
              };
            } catch (imgError) {
              console.error(`❌ [Direct Loop] Image generation FAILED for "${dir.name}":`, imgError);
              console.error(`   Error details:`, imgError.message);
              console.error(`   Stack:`, imgError.stack);
              // Return direction without image
              return {
                ...dir,
                id: `dir-${jobId}-${index}`, // Add ID even on error
                imageUrl: null,
              };
            }
          })
        );
        
        console.log(`✅ [Direct Loop] Generated ${directionsWithImages.filter(d => d.imageUrl).length}/${directionsWithImages.length} images`);
        
        if (onDirectionsReady) {
          // Notify caller that directions with images are ready
          onDirectionsReady(directionsWithImages);
          
          // Return partial state - waiting for user selection
          return {
            ...gameState,
            waitingForSelection: true,
            directions: directionsWithImages,
            success: false,
          };
        }
      }
    }
    
    // If we reach here, we should have game code
    if (!parsed.gameScript) {
      // Try prompting AI to continue with game generation
      console.log(`🔄 [Direct Loop] No game code yet, prompting AI to continue...`);
      
      if (onProgress) onProgress(40, 'generating', 'AI is building your game...');
      
      const continueMessage = 'Now generate the complete game code.';
      const continueResponse = await generateText(continueMessage, {
        sessionId: effectiveSessionId,
        systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
        model: 'gemini-3.8-flash',
        maxTokens: 65536,
        temperature: 0.7,
      });
      
      const continueParsed = parseOrchestratorResponse(continueResponse.text);
      
      if (!continueParsed.gameScript) {
        throw new Error('AI did not generate game code after continuation prompt');
      }
      
      return finalizeGameState(gameState, continueParsed, onProgress);
    }
    
    return finalizeGameState(gameState, parsed, onProgress);
    
  } catch (error) {
    console.error(`❌ [Direct Loop] Generation failed:`, error.message);
    
    gameState.errorHistory.push({
      attempt: gameState.attemptCount,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    
    // Retry logic (up to maxAttempts)
    if (gameState.attemptCount < gameState.maxAttempts) {
      gameState.attemptCount++;
      
      console.log(`🔄 [Direct Loop] Retrying (${gameState.attemptCount}/${gameState.maxAttempts})...`);
      
      if (onProgress) onProgress(30, 'retrying', `Retrying generation (${gameState.attemptCount}/${gameState.maxAttempts})...`);
      
      // Ask AI to fix the error
      const fixMessage = `The previous generation failed with error: ${error.message}\n\nPlease generate a COMPLETE, WORKING game. Output the entire game code from <!DOCTYPE html> to </html>.`;
      
      const retryResponse = await generateText(fixMessage, {
        sessionId: effectiveSessionId, // Same session - AI remembers previous attempt
        systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
        model: 'gemini-3.8-flash',
        maxTokens: 65536,
        temperature: 0.7,
      });
      
      const retryParsed = parseOrchestratorResponse(retryResponse.text);
      
      if (retryParsed.gameScript) {
        return finalizeGameState(gameState, retryParsed, onProgress);
      }
    }
    
    // All retries exhausted
    throw new Error(`Game generation failed after ${gameState.attemptCount} attempts: ${error.message}`);
  }
}

/**
 * Continue generation after user selects a direction
 */
export async function continueWithSelectedDirection({
  sessionId,
  selectedDirection,
  autoSelected = false,
  onProgress = null,
}) {
  console.log(`▶️ [Direct Loop] Continuing with ${autoSelected ? 'auto-' : ''}selected direction: ${selectedDirection.name}`);
  
  if (onProgress) onProgress(50, 'building', `Building ${selectedDirection.name} game...`);
  
  // Build message with BOTH text and image (agentic pattern like ChatGPT)
  const messageContent = [
    {
      type: 'text',
      text: autoSelected
        ? `The user didn't respond in time. Auto-selecting "${selectedDirection.name}" as it best fits the concept. Now generate the complete game matching this visual style.`
        : `The user selected "${selectedDirection.name}". Now generate the complete game matching this visual style exactly.`
    }
  ];
  
  // Add the actual image to conversation so Gemini can SEE it
  if (selectedDirection.imageUrl) {
    messageContent.push({
      type: 'image_url',
      image_url: { url: selectedDirection.imageUrl }
    });
    console.log(`  🖼️ Including selected image in Gemini's context: ${selectedDirection.imageUrl.substring(0, 60)}...`);
  }
  
  const response = await generateText(messageContent, {
    sessionId, // Same session - AI remembers the directions it generated
    systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
    model: 'gemini-3.8-flash',
    maxTokens: 65536,
    temperature: 0.7,
  });
  
  const parsed = parseOrchestratorResponse(response.text);
  
  if (!parsed.gameScript) {
    throw new Error('AI did not generate game code after direction selection');
  }
  
  return {
    gameScript: parsed.gameScript,
    title: parsed.title,
    thumbnailPrompt: parsed.thumbnailPrompt,
    controls: parsed.controls,
    success: true,
  };
}

/**
 * Finalize game state with parsed response
 */
function finalizeGameState(gameState, parsed, onProgress) {
  gameState.metadata.title = parsed.title || 'Untitled Game';
  gameState.metadata.thumbnailPrompt = parsed.thumbnailPrompt || gameState.prompt;
  gameState.metadata.controls = parsed.controls || {};
  
  if (onProgress) onProgress(80, 'finalizing', 'Finalizing game...');
  
  console.log(`✅ [Direct Loop] Game generated successfully`);
  console.log(`   Title: ${gameState.metadata.title}`);
  console.log(`   Code length: ${parsed.gameScript.length} characters`);
  
  return {
    ...gameState,
    gameScript: parsed.gameScript,
    success: true,
  };
}

/**
 * Parse AI orchestrator response - handles both JSON and raw HTML
 */
function parseOrchestratorResponse(text) {
  const result = {
    gameScript: null,
    title: null,
    thumbnailPrompt: null,
    controls: null,
    action: null,
    directions: null, // For visual direction generation phase
  };
  
  // Try parsing as JSON first
  try {
    // Extract JSON from markdown code blocks if present
    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      const match = jsonText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (match) jsonText = match[1];
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\w*\s*/, '').replace(/\s*```$/, '');
    }
    
    const json = JSON.parse(jsonText);
    
    result.action = json.action;
    result.title = json.title;
    result.thumbnailPrompt = json.thumbnailPrompt;
    result.controls = json.controls;
    result.directions = json.directions; // Visual directions array
    
    // Extract game script from JSON
    if (json.gameScript) {
      result.gameScript = json.gameScript;
    }
    
    return result;
    
  } catch (jsonError) {
    // Not JSON, check if it's raw HTML
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      result.gameScript = text;
      // Try to extract title from HTML
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) result.title = titleMatch[1];
      return result;
    }
    
    // Check if gameScript is embedded in text
    const htmlMatch = text.match(/<!DOCTYPE[\s\S]*<\/html>/i);
    if (htmlMatch) {
      result.gameScript = htmlMatch[0];
      return result;
    }
    
    // Fallback: return as-is
    console.warn('⚠️ Could not parse orchestrator response as JSON or HTML');
    return result;
  }
}

/**
 * Retry helper for failed generations
 */
export async function retryGenerationWithFix({
  sessionId,
  error,
  onProgress = null,
}) {
  console.log(`🔄 [Direct Loop] Retrying with error fix...`);
  
  if (onProgress) onProgress(40, 'fixing', 'AI is fixing the error...');
  
  const fixMessage = `The game had an error: ${error}\n\nFix it and output a COMPLETE working game.`;
  
  const response = await generateText(fixMessage, {
    sessionId, // Uses conversation memory
    systemPrompt: MASTER_ORCHESTRATOR_PROMPT,
    model: 'gemini-3.8-flash',
    maxTokens: 65536,
    temperature: 0.7,
  });
  
  return parseOrchestratorResponse(response.text);
}
