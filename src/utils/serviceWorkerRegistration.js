/**
 * Service Worker Registration Module
 *
 * This module handles the registration and communication with the service worker
 * for caching and offline support.
 */

// Check if service workers are supported
const isServiceWorkerSupported = 'serviceWorker' in navigator;

// Communication channel with service worker
let swRegistration = null;
let messageChannel = null;

/**
 * Register the service worker
 * @returns {Promise<ServiceWorkerRegistration|null>} - Promise resolving to the registration or null if not supported
 */
export async function registerServiceWorker() {
  if (!isServiceWorkerSupported) {
    console.warn('Service workers are not supported in this browser');
    return null;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('/service-worker.js');
    
    console.log('Service worker registered successfully:', swRegistration);
    
    // Set up communication channel
    await setupMessageChannel();
    
    return swRegistration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}

/**
 * Set up a message channel for communication with the service worker
 * @returns {Promise<MessageChannel|null>} - Promise resolving to the message channel or null if failed
 */
export async function setupMessageChannel() {
  if (!swRegistration) {
    console.warn('Service worker not registered');
    return null;
  }

  try {
    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    
    // Create a message channel
    messageChannel = new MessageChannel();
    
    // Set up message handler
    messageChannel.port1.onmessage = handleServiceWorkerMessage;
    
    // Send the port to the service worker
    navigator.serviceWorker.controller.postMessage({
      type: 'INIT_PORT'
    }, [messageChannel.port2]);
    
    return messageChannel;
  } catch (error) {
    console.error('Failed to set up message channel:', error);
    return null;
  }
}

/**
 * Handle messages from the service worker
 * @param {MessageEvent} event - Message event
 */
function handleServiceWorkerMessage(event) {
  const { data } = event;
  
  console.log('Message from service worker:', data);
  
  // Dispatch custom event for components to listen to
  window.dispatchEvent(new CustomEvent('serviceWorkerMessage', { detail: data }));
  
  // Handle specific message types
  switch (data.type) {
    case 'READY':
      console.log('Service worker is ready');
      break;
      
    case 'MODEL_CACHED':
      console.log(`Model ${data.modelId} cached:`, data.success);
      break;
      
    case 'MODEL_DELETED':
      console.log(`Model ${data.modelId} deleted:`, data.success);
      break;
      
    default:
      // Unknown message type
      break;
  }
}

/**
 * Send a message to the service worker
 * @param {Object} message - Message to send
 * @returns {boolean} - True if message was sent, false otherwise
 */
export function sendMessageToServiceWorker(message) {
  if (!navigator.serviceWorker.controller || !messageChannel) {
    console.warn('Service worker not active or message channel not established');
    return false;
  }

  try {
    messageChannel.port1.postMessage(message);
    return true;
  } catch (error) {
    console.error('Failed to send message to service worker:', error);
    return false;
  }
}

/**
 * Cache a model file using the service worker
 * @param {string} modelId - Model ID
 * @param {string} modelUrl - URL of the model file
 * @returns {boolean} - True if request was sent, false otherwise
 */
export function cacheModel(modelId, modelUrl) {
  return sendMessageToServiceWorker({
    type: 'CACHE_MODEL',
    modelId,
    modelUrl
  });
}

/**
 * Delete a model from the service worker cache
 * @param {string} modelId - Model ID
 * @returns {boolean} - True if request was sent, false otherwise
 */
export function deleteModelFromCache(modelId) {
  return sendMessageToServiceWorker({
    type: 'DELETE_MODEL',
    modelId
  });
}

/**
 * Check if the app is running in offline mode
 * @returns {boolean} - True if offline, false if online
 */
export function isOffline() {
  return !navigator.onLine;
}

/**
 * Add event listeners for online/offline events
 * @param {Function} onlineCallback - Callback for online event
 * @param {Function} offlineCallback - Callback for offline event
 * @returns {Function} - Function to remove the event listeners
 */
export function addConnectivityListeners(onlineCallback, offlineCallback) {
  window.addEventListener('online', onlineCallback);
  window.addEventListener('offline', offlineCallback);
  
  return () => {
    window.removeEventListener('online', onlineCallback);
    window.removeEventListener('offline', offlineCallback);
  };
}

// Register service worker when this module is imported
if (process.env.NODE_ENV === 'production') {
  registerServiceWorker();
}
