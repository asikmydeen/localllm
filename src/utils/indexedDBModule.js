/**
 * IndexedDB Storage Module for LLM Models
 *
 * This module provides a lightweight interface for storing and retrieving
 * model files and chunks in IndexedDB for efficient browser-based storage.
 */

import { openDB } from 'idb';

/**
 * Default database configuration
 */
const DEFAULT_DB_CONFIG = {
  name: 'LLMModelStorage',
  version: 1,
  stores: {
    models: 'id, name, size, timestamp',
    chunks: 'id, modelId, index, size, timestamp',
    metadata: 'id'
  }
};

/**
 * Opens a connection to the IndexedDB database
 * @param {Object} config - Database configuration (optional)
 * @returns {Promise<IDBDatabase>} - Promise resolving to the database connection
 */
export async function openModelDB(config = DEFAULT_DB_CONFIG) {
  return openDB(config.name, config.version, {
    upgrade(db) {
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('models')) {
        const modelStore = db.createObjectStore('models', { keyPath: 'id' });
        modelStore.createIndex('name', 'name', { unique: false });
        modelStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('chunks')) {
        const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
        chunkStore.createIndex('modelId', 'modelId', { unique: false });
        chunkStore.createIndex('index', 'index', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'id' });
      }
    }
  });
}

/**
 * Save model metadata to IndexedDB
 * @param {Object} model - Model metadata object
 * @returns {Promise<void>}
 */
export async function saveModelMetadata(model) {
  if (!model || !model.id) {
    throw new Error('Invalid model metadata: missing ID');
  }
  
  const db = await openModelDB();
  await db.put('models', {
    ...model,
    timestamp: Date.now()
  });
}

/**
 * Get model metadata from IndexedDB
 * @param {string} modelId - Model ID
 * @returns {Promise<Object|null>} - Promise resolving to model metadata or null if not found
 */
export async function getModelMetadata(modelId) {
  const db = await openModelDB();
  return db.get('models', modelId);
}

/**
 * List all models in the database
 * @returns {Promise<Array>} - Promise resolving to array of model metadata
 */
export async function listModels() {
  const db = await openModelDB();
  return db.getAll('models');
}

/**
 * Delete a model and all its chunks from IndexedDB
 * @param {string} modelId - Model ID
 * @returns {Promise<boolean>} - Promise resolving to true if successful
 */
export async function deleteModel(modelId) {
  const db = await openModelDB();
  
  // Use a transaction to ensure atomicity
  const tx = db.transaction(['models', 'chunks'], 'readwrite');
  
  // Delete model metadata
  await tx.objectStore('models').delete(modelId);
  
  // Get all chunks for this model
  const chunkIndex = tx.objectStore('chunks').index('modelId');
  const chunks = await chunkIndex.getAll(modelId);
  
  // Delete each chunk
  const chunkStore = tx.objectStore('chunks');
  for (const chunk of chunks) {
    await chunkStore.delete(chunk.id);
  }
  
  // Commit the transaction
  await tx.done;
  
  return true;
}

/**
 * Save a model chunk to IndexedDB
 * @param {string} modelId - Model ID
 * @param {number} index - Chunk index
 * @param {Blob|ArrayBuffer} data - Chunk data
 * @returns {Promise<string>} - Promise resolving to chunk ID
 */
export async function saveModelChunk(modelId, index, data) {
  if (!modelId) {
    throw new Error('Model ID is required');
  }
  
  const chunkId = `${modelId}_chunk_${index}`;
  const db = await openModelDB();
  
  await db.put('chunks', {
    id: chunkId,
    modelId,
    index,
    data,
    size: data instanceof Blob ? data.size : data.byteLength,
    timestamp: Date.now()
  });
  
  return chunkId;
}

/**
 * Get a model chunk from IndexedDB
 * @param {string} modelId - Model ID
 * @param {number} index - Chunk index
 * @returns {Promise<Blob|ArrayBuffer|null>} - Promise resolving to chunk data or null if not found
 */
export async function getModelChunk(modelId, index) {
  const chunkId = `${modelId}_chunk_${index}`;
  const db = await openModelDB();
  const chunk = await db.get('chunks', chunkId);
  
  return chunk ? chunk.data : null;
}

/**
 * Check if a model exists in IndexedDB
 * @param {string} modelId - Model ID
 * @returns {Promise<boolean>} - Promise resolving to true if model exists
 */
export async function hasModelInDB(modelId) {
  const db = await openModelDB();
  const model = await db.get('models', modelId);
  return !!model;
}

/**
 * Get the total size of a model in IndexedDB
 * @param {string} modelId - Model ID
 * @returns {Promise<number>} - Promise resolving to total size in bytes
 */
export async function getModelSize(modelId) {
  const db = await openModelDB();
  const chunkIndex = db.transaction('chunks').objectStore('chunks').index('modelId');
  const chunks = await chunkIndex.getAll(modelId);
  
  return chunks.reduce((total, chunk) => total + chunk.size, 0);
}

/**
 * Save application metadata
 * @param {string} key - Metadata key
 * @param {any} value - Metadata value
 * @returns {Promise<void>}
 */
export async function saveMetadata(key, value) {
  const db = await openModelDB();
  await db.put('metadata', {
    id: key,
    value,
    timestamp: Date.now()
  });
}

/**
 * Get application metadata
 * @param {string} key - Metadata key
 * @returns {Promise<any>} - Promise resolving to metadata value or null if not found
 */
export async function getMetadata(key) {
  const db = await openModelDB();
  const entry = await db.get('metadata', key);
  return entry ? entry.value : null;
}
