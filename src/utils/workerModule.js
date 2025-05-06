/**
 * Web Worker Module for LLM Processing
 *
 * This module provides functionality to offload LLM processing to web workers,
 * keeping the main thread responsive for UI interactions.
 */

/**
 * Create a worker for LLM processing
 * @returns {Worker} - The created worker
 */
export function createLLMWorker() {
  return new Worker(new URL('../workers/llmWorker.js', import.meta.url), { type: 'module' });
}

/**
 * Worker pool for managing multiple LLM workers
 */
export class LLMWorkerPool {
  constructor(size = navigator.hardwareConcurrency || 4) {
    this.size = Math.max(1, Math.min(size, 16)); // Limit between 1 and 16 workers
    this.workers = [];
    this.idle = [];
    this.busy = new Map();
    this.taskQueue = [];
    this.progressHandler = null;
    this.initialize();
  }

  /**
   * Initialize the worker pool
   */
  initialize() {
    console.log(`Initializing LLM worker pool with ${this.size} workers`);

    for (let i = 0; i < this.size; i++) {
      try {
        const worker = createLLMWorker();

        // Set up message handler for this worker
        worker.onmessage = (event) => {
          const { type, id, result, error, modelId, progress } = event.data;

          // Handle progress updates
          if (type === 'progress' && this.progressHandler) {
            this.progressHandler({ modelId, progress });
            return;
          }

          // Find the callback for this message
          const callback = this.callbacks.get(id);
          if (callback) {
            if (error) {
              callback.reject(new Error(error));
            } else {
              callback.resolve(result);
            }
            this.callbacks.delete(id);
          }
        };

        this.workers.push({
          worker,
          id: `worker-${i}`
        });

        this.idle.push(this.workers[i]);
      } catch (error) {
        console.error(`Failed to initialize worker ${i}:`, error);
      }
    }

    // Initialize callbacks map
    this.callbacks = new Map();
    this.nextCallbackId = 1;
  }

  /**
   * Get an available worker from the pool
   * @returns {Promise<Object>} - Promise resolving to worker object
   */
  async getWorker() {
    if (this.idle.length > 0) {
      const worker = this.idle.shift();
      this.busy.set(worker.id, worker);
      return worker;
    }

    // If no idle workers, queue the request
    return new Promise((resolve) => {
      this.taskQueue.push(resolve);
    });
  }

  /**
   * Release a worker back to the idle pool
   * @param {string} workerId - ID of the worker to release
   */
  releaseWorker(workerId) {
    const worker = this.busy.get(workerId);

    if (!worker) {
      console.warn(`Worker ${workerId} not found in busy pool`);
      return;
    }

    this.busy.delete(workerId);

    // If there are queued tasks, assign this worker to the next task
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.busy.set(worker.id, worker);
      nextTask(worker);
    } else {
      // Otherwise, return to idle pool
      this.idle.push(worker);
    }
  }

  /**
   * Send a message to a worker and wait for response
   * @param {Worker} worker - Worker to send message to
   * @param {string} type - Message type
   * @param {Object} data - Message data
   * @returns {Promise<any>} - Promise resolving to worker response
   */
  sendWorkerMessage(worker, type, data = {}) {
    return new Promise((resolve, reject) => {
      const callbackId = this.nextCallbackId++;

      // Store callback
      this.callbacks.set(callbackId, { resolve, reject });

      // Send message to worker
      worker.worker.postMessage({
        type,
        id: callbackId,
        ...data
      });
    });
  }

  /**
   * Load a model in a worker
   * @param {string} modelId - Model ID to load
   * @param {Object} options - Model loading options
   * @returns {Promise<Object>} - Promise resolving to load result
   */
  async loadModel(modelId, options = {}) {
    const worker = await this.getWorker();

    try {
      const result = await this.sendWorkerMessage(worker, 'loadModel', {
        modelId,
        options
      });

      return {
        ...result,
        workerId: worker.id,
        success: true
      };
    } catch (error) {
      this.releaseWorker(worker.id);
      return {
        success: false,
        error: error.message || 'Unknown error loading model'
      };
    }
  }

  /**
   * Generate text using a loaded model
   * @param {string} workerId - ID of the worker with loaded model
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} - Promise resolving to generation result
   */
  async generateText(workerId, prompt, options = {}) {
    const worker = this.busy.get(workerId);

    if (!worker) {
      throw new Error(`Worker ${workerId} not found or not busy`);
    }

    try {
      return await this.sendWorkerMessage(worker, 'generateText', {
        prompt,
        options
      });
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Unknown error generating text'
      };
    }
  }

  /**
   * Chat completion using a loaded model
   * @param {string} workerId - ID of the worker with loaded model
   * @param {Array} messages - Chat messages
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} - Promise resolving to chat completion result
   */
  async chatCompletion(workerId, messages, options = {}) {
    const worker = this.busy.get(workerId);

    if (!worker) {
      throw new Error(`Worker ${workerId} not found or not busy`);
    }

    try {
      return await this.sendWorkerMessage(worker, 'chatCompletion', {
        messages,
        options
      });
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Unknown error in chat completion'
      };
    }
  }

  /**
   * Unload a model from a worker
   * @param {string} workerId - ID of the worker to unload model from
   * @returns {Promise<boolean>} - Promise resolving to true if successful
   */
  async unloadModel(workerId) {
    const worker = this.busy.get(workerId);

    if (!worker) {
      console.warn(`Worker ${workerId} not found in busy pool`);
      return false;
    }

    try {
      await this.sendWorkerMessage(worker, 'unloadModel');
      this.releaseWorker(workerId);
      return true;
    } catch (error) {
      console.error(`Error unloading model from worker ${workerId}:`, error);
      this.releaseWorker(workerId);
      return false;
    }
  }

  /**
   * Set a handler for progress events from workers
   * @param {Function} handler - Function to handle progress events
   */
  setProgressHandler(handler) {
    this.progressHandler = handler;
  }

  /**
   * Terminate all workers in the pool
   */
  terminate() {
    for (const { worker } of this.workers) {
      worker.terminate();
    }

    this.workers = [];
    this.idle = [];
    this.busy.clear();
    this.taskQueue = [];
    this.callbacks.clear();
    this.progressHandler = null;
  }
}
