// service-worker.js
// Enhanced service worker for local LLM chat application

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

const APP_CACHE = 'llm-app-cache-v1';
const MODEL_CACHE = 'llm-model-cache-v1';
const OFFLINE_URL = '/index.html';

// Skip waiting and claim clients immediately
self.skipWaiting();
workbox.core.clientsClaim();

// Precache static assets
workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);

// Cache app shell
workbox.routing.registerRoute(
  ({ request }) => request.mode === 'navigate',
  new workbox.strategies.NetworkFirst({
    cacheName: APP_CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
      }),
    ],
  })
);

// Cache CSS, JS, and Web Worker files
workbox.routing.registerRoute(
  ({ request }) => 
    request.destination === 'style' || 
    request.destination === 'script' || 
    request.destination === 'worker',
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: APP_CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
      }),
    ],
  })
);

// Cache images
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new workbox.strategies.CacheFirst({
    cacheName: APP_CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Special handling for model files
workbox.routing.registerRoute(
  ({ url }) => url.pathname.includes('/models/') || url.pathname.endsWith('.bin'),
  new workbox.strategies.CacheFirst({
    cacheName: MODEL_CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
      }),
    ],
  })
);

// Handle API requests
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new workbox.strategies.NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 1 * 24 * 60 * 60, // 1 day
      }),
    ],
  })
);

// Communication channel with main thread
let messageChannel = null;

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'INIT_PORT') {
    messageChannel = event.ports[0];
    messageChannel.postMessage({ status: 'READY' });
  }
  
  // Handle model caching commands
  if (event.data && event.data.type === 'CACHE_MODEL') {
    const { modelId, modelUrl } = event.data;
    cacheModel(modelId, modelUrl);
  }
  
  // Handle model deletion commands
  if (event.data && event.data.type === 'DELETE_MODEL') {
    const { modelId } = event.data;
    deleteModelFromCache(modelId);
  }
});

// Cache a model file
async function cacheModel(modelId, modelUrl) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const response = await fetch(modelUrl);
    await cache.put(modelUrl, response.clone());
    
    if (messageChannel) {
      messageChannel.postMessage({ 
        type: 'MODEL_CACHED', 
        modelId, 
        success: true 
      });
    }
  } catch (error) {
    console.error('Failed to cache model:', error);
    if (messageChannel) {
      messageChannel.postMessage({ 
        type: 'MODEL_CACHED', 
        modelId, 
        success: false, 
        error: error.message 
      });
    }
  }
}

// Delete a model from cache
async function deleteModelFromCache(modelId) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const keys = await cache.keys();
    const modelKeys = keys.filter(key => key.url.includes(modelId));
    
    for (const key of modelKeys) {
      await cache.delete(key);
    }
    
    if (messageChannel) {
      messageChannel.postMessage({ 
        type: 'MODEL_DELETED', 
        modelId, 
        success: true 
      });
    }
  } catch (error) {
    console.error('Failed to delete model from cache:', error);
    if (messageChannel) {
      messageChannel.postMessage({ 
        type: 'MODEL_DELETED', 
        modelId, 
        success: false, 
        error: error.message 
      });
    }
  }
}
