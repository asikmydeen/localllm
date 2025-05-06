/**
 * Web Worker for LLM Processing
 *
 * This worker handles model loading and inference in a separate thread
 * to keep the main UI thread responsive.
 */

import { CreateMLCEngine } from '@mlc-ai/web-llm';

// State variables
let engine = null;
let modelId = null;
let isLoading = false;

// Get the worker scope
/* eslint-disable no-restricted-globals */
const workerScope = self;

/**
 * Handle messages from the main thread
 */
workerScope.onmessage = async (event) => {
  const { type, id, modelId: requestModelId, options, prompt, messages } = event.data;

  try {
    let result;

    // Handle different message types
    switch (type) {
      case 'loadModel':
        result = await loadModel(requestModelId, options);
        break;

      case 'generateText':
        result = await generateText(prompt, options);
        break;

      case 'chatCompletion':
        result = await chatCompletion(messages, options);
        break;

      case 'unloadModel':
        result = await unloadModel();
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // Send result back to main thread
    workerScope.postMessage({
      type,
      id,
      result
    });
  } catch (error) {
    // Send error back to main thread
    workerScope.postMessage({
      type,
      id,
      error: error.message || 'Unknown error in worker'
    });
  }
};

/**
 * Load a model into the worker
 * @param {string} requestModelId - ID of the model to load
 * @param {Object} options - Model loading options
 * @returns {Promise<Object>} - Promise resolving to load result
 */
async function loadModel(requestModelId, options = {}) {
  if (isLoading) {
    throw new Error('Already loading a model');
  }

  if (engine && modelId === requestModelId) {
    return {
      success: true,
      modelId: requestModelId,
      message: 'Model already loaded'
    };
  }

  try {
    isLoading = true;
    modelId = requestModelId;

    // Set up progress callback
    const progressCallback = (progress) => {
      // Send progress updates to main thread
      workerScope.postMessage({
        type: 'progress',
        modelId: requestModelId,
        progress
      });
    };

    // Set up options with progress callback
    const engineOptions = {
      ...options,
      progress_callback: progressCallback
    };

    // Create the MLC engine
    engine = await CreateMLCEngine(requestModelId, engineOptions);

    return {
      success: true,
      modelId: requestModelId,
      message: 'Model loaded successfully'
    };
  } catch (error) {
    engine = null;
    modelId = null;

    return {
      success: false,
      modelId: requestModelId,
      error: error.message || 'Unknown error loading model'
    };
  } finally {
    isLoading = false;
  }
}

/**
 * Generate text using the loaded model
 * @param {string} prompt - Text prompt
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Promise resolving to generation result
 */
async function generateText(prompt, options = {}) {
  if (!engine) {
    throw new Error('No model loaded');
  }

  try {
    // Check if the engine has the generate method
    if (typeof engine.generate === 'function') {
      const result = await engine.generate(prompt, options);
      return { success: true, text: result };
    }
    // Fall back to completion if generate is not available
    else if (typeof engine.completion === 'function') {
      const result = await engine.completion(prompt, options);
      return { success: true, text: result.choices[0].text };
    } else {
      throw new Error('Model does not support text generation');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error during text generation'
    };
  }
}

/**
 * Chat completion using the loaded model
 * @param {Array} messages - Chat messages
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Promise resolving to chat completion result
 */
async function chatCompletion(messages, options = {}) {
  if (!engine) {
    throw new Error('No model loaded');
  }

  try {
    // Check if the engine has the chatCompletion method
    if (typeof engine.chatCompletion === 'function') {
      // Extract system prompt from options if provided
      const { systemPrompt, ...otherOptions } = options;

      // Prepare messages array with system prompt if provided
      let chatMessages = [...messages];

      // Add system message at the beginning if systemPrompt is provided
      if (systemPrompt && systemPrompt.trim()) {
        // Check if there's already a system message
        const hasSystemMessage = chatMessages.some(msg => msg.role === 'system');

        if (!hasSystemMessage) {
          // Add system message at the beginning
          chatMessages.unshift({ role: 'system', content: systemPrompt });
        } else {
          // Replace existing system message
          chatMessages = chatMessages.map(msg =>
            msg.role === 'system' ? { role: 'system', content: systemPrompt } : msg
          );
        }
      }

      const result = await engine.chatCompletion({
        messages: chatMessages,
        ...otherOptions
      });

      return { success: true, ...result };
    } else {
      throw new Error('Model does not support chat completion');
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error during chat completion'
    };
  }
}

/**
 * Unload the current model
 * @returns {Promise<boolean>} - Promise resolving to true if successful
 */
async function unloadModel() {
  if (!engine) {
    return true; // No model to unload
  }

  try {
    // Some engines have a dispose method
    if (typeof engine.dispose === 'function') {
      await engine.dispose();
    }

    engine = null;
    modelId = null;

    return true;
  } catch (error) {
    console.error('Error unloading model:', error);

    // Reset anyway
    engine = null;
    modelId = null;

    return false;
  }
}
/* eslint-enable no-restricted-globals */
