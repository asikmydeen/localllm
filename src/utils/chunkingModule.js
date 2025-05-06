/**
 * Chunking Module for LLM Models
 *
 * This module provides functionality to download and process large model files
 * in chunks for better memory efficiency and download resumability.
 */

import {
  saveModelChunk,
  getModelChunk,
  hasModelInDB,
  saveModelMetadata,
  getModelMetadata
} from './indexedDBModule';

// Default chunk size: 50MB
const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024;

/**
 * Download a model file in chunks
 * @param {string} url - URL of the model file
 * @param {string} modelId - ID of the model
 * @param {Object} options - Download options
 * @param {number} options.chunkSize - Size of each chunk in bytes
 * @param {Function} options.progressCallback - Progress callback function
 * @returns {Promise<boolean>} - Promise resolving to true if successful
 */
export async function downloadModelInChunks(url, modelId, options = {}) {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    progressCallback = null
  } = options;

  try {
    // Get file size using HEAD request
    const headResponse = await fetch(url, { method: 'HEAD' });

    if (!headResponse.ok) {
      throw new Error(`Failed to get model file size: ${headResponse.status} ${headResponse.statusText}`);
    }

    const contentLength = parseInt(headResponse.headers.get('content-length') || '0', 10);

    if (!contentLength) {
      throw new Error('Could not determine model file size');
    }

    // Save model metadata
    await saveModelMetadata({
      id: modelId,
      url,
      size: contentLength,
      chunkSize,
      chunks: Math.ceil(contentLength / chunkSize)
    });

    // Calculate number of chunks
    const numChunks = Math.ceil(contentLength / chunkSize);

    if (progressCallback) {
      progressCallback({
        phase: 'init',
        totalSize: contentLength,
        chunkSize,
        numChunks
      });
    }

    // Download each chunk
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(contentLength, start + chunkSize - 1);

      if (progressCallback) {
        progressCallback({
          phase: 'downloading',
          chunk: i + 1,
          numChunks,
          start,
          end,
          progress: (i / numChunks) * 100
        });
      }

      // Check if chunk already exists in IndexedDB
      const existingChunk = await getModelChunk(modelId, i);

      if (existingChunk) {
        console.log(`Chunk ${i + 1}/${numChunks} already exists, skipping`);
        continue;
      }

      // Download this chunk
      const chunkResponse = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`
        }
      });

      if (!chunkResponse.ok) {
        throw new Error(`Failed to download chunk ${i + 1}/${numChunks}: ${chunkResponse.status} ${chunkResponse.statusText}`);
      }

      const chunkData = await chunkResponse.blob();

      // Save chunk to IndexedDB
      await saveModelChunk(modelId, i, chunkData);

      if (progressCallback) {
        progressCallback({
          phase: 'chunk_saved',
          chunk: i + 1,
          numChunks,
          progress: ((i + 1) / numChunks) * 100
        });
      }
    }

    if (progressCallback) {
      progressCallback({
        phase: 'complete',
        progress: 100
      });
    }

    return true;
  } catch (error) {
    console.error('Error downloading model in chunks:', error);

    if (progressCallback) {
      progressCallback({
        phase: 'error',
        error: error.message || 'Unknown error during download'
      });
    }

    throw error;
  }
}

/**
 * Check if a model download is complete
 * @param {string} modelId - ID of the model
 * @returns {Promise<boolean>} - Promise resolving to true if all chunks are downloaded
 */
export async function isModelDownloadComplete(modelId) {
  try {
    // Check if model exists in IndexedDB
    const modelExists = await hasModelInDB(modelId);

    if (!modelExists) {
      return false;
    }

    // Get model metadata
    const metadata = await getModelMetadata(modelId);

    if (!metadata) {
      return false;
    }

    // Check if all chunks exist
    for (let i = 0; i < metadata.chunks; i++) {
      const chunk = await getModelChunk(modelId, i);

      if (!chunk) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error checking model download status:', error);
    return false;
  }
}

/**
 * Resume a model download
 * @param {string} modelId - ID of the model
 * @param {Object} options - Download options
 * @param {Function} options.progressCallback - Progress callback function
 * @returns {Promise<boolean>} - Promise resolving to true if successful
 */
export async function resumeModelDownload(modelId, options = {}) {
  try {
    // Get model metadata
    const metadata = await getModelMetadata(modelId);

    if (!metadata) {
      throw new Error(`Model ${modelId} not found in database`);
    }

    // Resume download
    return downloadModelInChunks(metadata.url, modelId, {
      chunkSize: metadata.chunkSize,
      ...options
    });
  } catch (error) {
    console.error('Error resuming model download:', error);
    throw error;
  }
}
