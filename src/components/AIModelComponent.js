// src/components/AIModelComponent.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  prebuiltAppConfig,
  hasModelInCache,
  deleteModelInCache
} from '@mlc-ai/web-llm';
import { LLMWorkerPool } from '../utils/workerModule';
import {
  hasModelInDB,
  saveModelMetadata,
  deleteModel
} from '../utils/indexedDBModule';
import {
  downloadModelInChunks,
  isModelDownloadComplete
} from '../utils/chunkingModule';
import {
  registerServiceWorker,
  addConnectivityListeners
} from '../utils/serviceWorkerRegistration';
import { formatOutput } from '../utils/formatOutput';
import ReactMarkdown from 'react-markdown';
import CodeBlock from './CodeBlock';
import './AIModelComponent.css';

function AIModelComponent() {
    const [input, setInput] = useState('Explain how machine learning works in 3 sentences.');
    const [output, setOutput] = useState('');
    const [formattedOutput, setFormattedOutput] = useState({ formattedContent: '', type: 'text' });
    const [llm, setLLM] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState(() => {
        // Try to load the previously selected model from localStorage
        return localStorage.getItem('selectedModelId') || '';
    });
    const [cachedModels, setCachedModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState({});
    const [modelErrors, setModelErrors] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [workerPool, setWorkerPool] = useState(null);
    const [activeWorkerId, setActiveWorkerId] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState({});
    const [usingIndexedDB, setUsingIndexedDB] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState(() => {
        // Try to load the system prompt from localStorage
        return localStorage.getItem('systemPrompt') || '';
    });
    const outputRef = useRef(null);

    // Add refs to track current values without causing dependency issues
    const llmRef = useRef(null);
    const loadingModelsRef = useRef({});
    const workerPoolRef = useRef(null);

    // Keep refs in sync with state
    useEffect(() => {
        llmRef.current = llm;
    }, [llm]);

    useEffect(() => {
        loadingModelsRef.current = loadingModels;
    }, [loadingModels]);

    useEffect(() => {
        workerPoolRef.current = workerPool;
    }, [workerPool]);

    // Initialize worker pool
    useEffect(() => {
        // Determine optimal number of workers based on hardware
        const optimalWorkers = Math.max(1, Math.min(
            navigator.hardwareConcurrency || 4,
            // Limit based on device memory if available
            navigator.deviceMemory ? Math.floor(navigator.deviceMemory / 2) : 4
        ));

        console.log(`Initializing worker pool with ${optimalWorkers} workers`);
        const pool = new LLMWorkerPool(optimalWorkers);
        setWorkerPool(pool);

        // Clean up worker pool on unmount
        return () => {
            if (pool) {
                pool.terminate();
            }
        };
    }, []);

    // Handle online/offline status
    useEffect(() => {
        const handleOnline = () => {
            console.log('App is online');
            setIsOnline(true);
        };

        const handleOffline = () => {
            console.log('App is offline');
            setIsOnline(false);
        };

        // Register service worker if not already registered
        registerServiceWorker();

        // Add event listeners for online/offline events
        const removeListeners = addConnectivityListeners(handleOnline, handleOffline);

        // Initial check
        setIsOnline(navigator.onLine);

        return () => {
            removeListeners();
        };
    }, []);

    // Wrap availableModels in useMemo
    const availableModels = useMemo(() => {
        return prebuiltAppConfig.model_list || [];
    }, []);

    // Save selected model to localStorage when it changes
    useEffect(() => {
        if (selectedModelId) {
            localStorage.setItem('selectedModelId', selectedModelId);
        }
    }, [selectedModelId]);

    // Save system prompt to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('systemPrompt', systemPrompt);
    }, [systemPrompt]);

    // Check which models are cached and start download if needed
    useEffect(() => {
        async function checkCachedModels() {
            const cached = [];

            // Check both traditional cache and IndexedDB
            for (const model of availableModels) {
                const isCachedTraditional = await hasModelInCache(model.model_id);
                const isCachedIndexedDB = await hasModelInDB(model.model_id);

                if (isCachedTraditional || isCachedIndexedDB) {
                    cached.push(model.model_id);

                    // If it's in IndexedDB but not in traditional cache, mark it
                    if (isCachedIndexedDB && !isCachedTraditional) {
                        console.log(`Model ${model.model_id} is cached in IndexedDB`);
                    }
                }
            }

            setCachedModels(cached);

            // Handle model selection and download
            if (!selectedModelId && availableModels.length > 0) {
                // First try to use a cached model
                if (cached.length > 0) {
                    setSelectedModelId(cached[0]);
                    console.log(`Using cached model: ${cached[0]}`);
                }
                // If no cached models, select the first available model and start downloading it
                else {
                    const firstModelId = availableModels[0].model_id;
                    setSelectedModelId(firstModelId);
                    console.log(`No cached models found. Starting download of: ${firstModelId}`);

                    // Start downloading the model
                    if (isOnline && !loadingModelsRef.current[firstModelId]) {
                        setLoadingModels(prev => ({
                            ...prev,
                            [firstModelId]: {
                                status: 'Starting download...',
                                progress: 0
                            }
                        }));

                        // We'll trigger the actual download in the loadModel effect
                    }
                }
            }
        }

        checkCachedModels();
    }, [availableModels, selectedModelId, isOnline]);

    // Load a model using worker pool
    const loadModel = useCallback(async (modelId) => {
        if (!modelId || !workerPoolRef.current) return;

        // Use refs instead of state directly
        const isLoading = loadingModelsRef.current[modelId];
        if (isLoading) {
            console.log(`Model ${modelId} is already loading, skipping`);
            return;
        }

        // Check if model is already loaded in a worker
        if (activeWorkerId && llmRef.current) {
            const currentLLM = llmRef.current;
            if (modelId === currentLLM._model_name ||
                modelId === currentLLM.model_name ||
                modelId === currentLLM.modelId) {
                console.log(`Model ${modelId} is already loaded and active, skipping`);
                return;
            }
        }

        try {
            setLoadingModels(prev => ({
                ...prev,
                [modelId]: {
                    status: 'Initializing model in worker...',
                    progress: 0
                }
            }));

            setModelErrors(prev => {
                const newErrors = {...prev};
                delete newErrors[modelId];
                return newErrors;
            });

            console.log("Loading model in worker:", modelId);

            // First check if model is available in IndexedDB
            const isInIndexedDB = await hasModelInDB(modelId);
            const isDownloadComplete = isInIndexedDB && await isModelDownloadComplete(modelId);

            // Set flag for UI to show we're using IndexedDB
            setUsingIndexedDB(isDownloadComplete);

            // Create progress callback
            const progressCallback = (progress) => {
                if (progress.phase === 'downloading') {
                    setDownloadProgress(prev => ({
                        ...prev,
                        [modelId]: {
                            phase: 'downloading',
                            chunk: progress.chunk,
                            numChunks: progress.numChunks,
                            progress: progress.progress
                        }
                    }));

                    setLoadingModels(prev => ({
                        ...prev,
                        [modelId]: {
                            status: `Downloading model (chunk ${progress.chunk}/${progress.numChunks})...`,
                            progress: progress.progress
                        }
                    }));
                } else if (progress.phase === 'complete') {
                    setDownloadProgress(prev => ({
                        ...prev,
                        [modelId]: {
                            phase: 'complete',
                            progress: 100
                        }
                    }));

                    setLoadingModels(prev => ({
                        ...prev,
                        [modelId]: {
                            status: 'Download complete, initializing model...',
                            progress: 50
                        }
                    }));
                }
            };

            // If model is not in IndexedDB and we're online, download it
            if (!isDownloadComplete && isOnline) {
                // Find model URL from available models
                const modelInfo = availableModels.find(m => m.model_id === modelId);
                if (modelInfo && modelInfo.model_url) {
                    try {
                        // Save model metadata
                        await saveModelMetadata({
                            id: modelId,
                            name: modelInfo.model_name || modelId,
                            url: modelInfo.model_url
                        });

                        // Download model in chunks
                        await downloadModelInChunks(modelInfo.model_url, modelId, {
                            progressCallback
                        });
                    } catch (downloadError) {
                        console.error(`Failed to download model ${modelId}:`, downloadError);
                    }
                }
            }

            // Set up a progress handler for this worker
            workerPoolRef.current.setProgressHandler((progressData) => {
                if (progressData.modelId === modelId && progressData.progress) {
                    const progress = progressData.progress;
                    setLoadingModels(prev => ({
                        ...prev,
                        [modelId]: {
                            status: progress.type === "download"
                                ? `Downloading model files (${progress.file})...`
                                : 'Initializing model...',
                            progress: progress.type === "download"
                                ? Math.round(progress.progress * 100)
                                : 50 + Math.round(progress.progress * 50)
                        }
                    }));
                }
            });

            // Load the model in a worker
            const result = await workerPoolRef.current.loadModel(modelId, {
                use_web_worker: true
            });

            if (!result.success) {
                throw new Error(result.error || 'Failed to load model in worker');
            }

            // If this is the selected model, update the active worker ID
            if (modelId === selectedModelId) {
                setActiveWorkerId(result.workerId);
                setLLM({
                    // Create a proxy object that will forward calls to the worker
                    chatCompletion: (params) => workerPoolRef.current.chatCompletion(result.workerId, params.messages, params),
                    completion: (params) => workerPoolRef.current.generateText(result.workerId, params.prompt, params),
                    generate: (prompt, params) => workerPoolRef.current.generateText(result.workerId, prompt, params),
                    unload: () => workerPoolRef.current.unloadModel(result.workerId),
                    modelId: modelId
                });
            }

            setLoadingModels(prev => {
                const newLoading = {...prev};
                delete newLoading[modelId];
                return newLoading;
            });

            console.log(`Model ${modelId} loaded successfully in worker!`);

            setCachedModels(prev =>
                prev.includes(modelId) ? prev : [...prev, modelId]
            );

        } catch (err) {
            console.error(`Failed to initialize model ${modelId}:`, err);
            setModelErrors(prev => ({
                ...prev,
                [modelId]: `Failed to initialize: ${err.message}`
            }));
            setLoadingModels(prev => {
                const newLoading = {...prev};
                delete newLoading[modelId];
                return newLoading;
            });
        }
    }, [selectedModelId, availableModels, isOnline, activeWorkerId]);

    // Initialize the WebLLM engine when selectedModelId changes
    useEffect(() => {
        if (!selectedModelId) return;

        const currentLLM = llmRef.current;
        if (currentLLM && (
            selectedModelId === currentLLM._model_name ||
            selectedModelId === currentLLM.model_name ||
            selectedModelId === currentLLM.modelId
        )) {
            console.log(`Model ${selectedModelId} is already loaded and active`);
            return;
        }

        // Check if the model is already loading
        if (loadingModelsRef.current[selectedModelId]) {
            console.log(`Model ${selectedModelId} is already loading`);
            return;
        }

        // Always try to load the selected model, whether it's cached or not
        console.log(`Initiating load for model: ${selectedModelId}`);
        loadModel(selectedModelId);

        return () => {
            // Cleanup if needed
        };
    }, [selectedModelId, loadModel]); // Removed cachedModels from dependencies

    // Generate text using the model in worker
    const generateText = async () => {
        if (!llm || !input.trim() || !activeWorkerId || !workerPoolRef.current) return;

        try {
            setGenerating(true);
            setOutput('');
            setFormattedOutput({ formattedContent: '', type: 'text' });

            console.log("Generating text using worker:", activeWorkerId);

            // We'll try chat completion first, then fall back to completion or generate
            let responseText = '';
            let result;

            try {
                // Try chat completion
                console.log("Attempting chat completion");

                // Prepare chat completion options
                const chatOptions = {
                    temperature: 0.7,
                    max_tokens: 256
                };

                // Add system prompt if provided
                if (systemPrompt && systemPrompt.trim()) {
                    chatOptions.systemPrompt = systemPrompt.trim();
                }

                result = await llm.chatCompletion({
                    messages: [{ role: 'user', content: input }],
                    ...chatOptions
                });

                if (result && result.success === false) {
                    throw new Error(result.error || "Chat completion failed");
                }

                if (result && result.choices && result.choices.length > 0) {
                    const message = result.choices[0].message;
                    responseText = message.content || "No content in response";
                } else {
                    throw new Error("Unexpected chat response format");
                }
            } catch (chatError) {
                console.error("Chat completion failed, trying completion:", chatError);

                try {
                    // Fall back to completion
                    result = await llm.completion({
                        prompt: input,
                        temperature: 0.7,
                        max_tokens: 256
                    });

                    if (result && result.success === false) {
                        throw new Error(result.error || "Completion failed");
                    }

                    if (result && result.choices && result.choices.length > 0) {
                        responseText = result.choices[0].text || '';
                    } else {
                        throw new Error("Unexpected completion response format");
                    }
                } catch (completionError) {
                    console.error("Completion failed, trying generate:", completionError);

                    try {
                        // Last resort: try generate
                        result = await llm.generate(input, {
                            temperature: 0.7,
                            max_length: 256
                        });

                        if (result && result.success === false) {
                            throw new Error(result.error || "Generate failed");
                        }

                        // Handle different response formats
                        if (typeof result === 'string') {
                            responseText = result;
                        } else if (result && result.text) {
                            responseText = result.text;
                        } else if (result && result.response) {
                            responseText = result.response;
                        } else {
                            throw new Error("Unexpected generate response format");
                        }
                    } catch (generateError) {
                        console.error("Generate failed:", generateError);
                        throw generateError;
                    }
                }
            }

            // Format the output based on content type
            const formatted = formatOutput(responseText);

            setOutput(responseText);
            setFormattedOutput(formatted);
            setGenerating(false);
        } catch (err) {
            console.error("Generation failed:", err);
            // Update model errors for the selected model
            setModelErrors(prev => ({
                ...prev,
                [selectedModelId]: `Generation failed: ${err.message}`
            }));
            setOutput("Failed to generate text. Please try a different model or input.");
            setFormattedOutput({
                formattedContent: "Failed to generate text. Please try a different model or input.",
                type: 'text'
            });
            setGenerating(false);
        }
    };

    // Scroll to bottom of output when it changes
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    // Handle model selection
    const handleModelChange = (modelId) => {
        if (modelId === selectedModelId) return;

        // If the model is cached, we can switch to it immediately
        if (cachedModels.includes(modelId)) {
            // Unload current model before loading new one
            if (llm) {
                llm.unload();
                setLLM(null);
            }

            setSelectedModelId(modelId);
        }
        // If the model is not cached but not loading, start loading it
        else if (!loadingModels[modelId]) {
            // Start loading the model in the background
            loadModel(modelId);

            // Don't switch to it yet - we'll keep using the current model
            // until the new one is ready
        }
        // If already loading, do nothing (continue loading)
    };

    // Delete a model from cache and IndexedDB
    const handleDeleteModel = async (modelId, e) => {
        e.stopPropagation(); // Prevent triggering model selection

        if (modelId === selectedModelId) {
            alert("Cannot delete the currently loaded model. Please select another model first.");
            return;
        }

        try {
            // Delete from traditional cache
            await deleteModelInCache(modelId);

            // Also delete from IndexedDB if it exists there
            if (await hasModelInDB(modelId)) {
                await deleteModel(modelId);
            }

            // Update cached models list
            setCachedModels(prev => prev.filter(id => id !== modelId));

            alert(`Model ${modelId} has been deleted from cache.`);
        } catch (err) {
            console.error("Failed to delete model:", err);
            alert(`Failed to delete model: ${err.message}`);
        }
    };

    // Refresh cached models list
    const refreshCachedModels = async () => {
        const cached = [];
        for (const model of availableModels) {
            // Check both traditional cache and IndexedDB
            const isCachedTraditional = await hasModelInCache(model.model_id);
            const isCachedIndexedDB = await hasModelInDB(model.model_id);

            if (isCachedTraditional || isCachedIndexedDB) {
                cached.push(model.model_id);
            }
        }
        setCachedModels(cached);
    };

    return (
        <div className="ai-model-component">
            <div className="chat-interface">
                {/* Left side - Model selector */}
                <div className="model-selector">
                    <h3>🎯 Pick Your Brain!</h3>
                    <div className="model-search">
                        <input
                            type="text"
                            placeholder="🔍 Find your perfect neural companion..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                        {searchQuery && (
                            <button
                                className="clear-search-btn"
                                onClick={() => setSearchQuery('')}
                            >
                                ×
                            </button>
                        )}
                    </div>
                    {!isOnline && (
                        <div className="offline-notice">
                            <p>📵 You're offline! Only cached models are available.</p>
                        </div>
                    )}

                    {usingIndexedDB && (
                        <div className="optimization-notice">
                            <p>⚡ Using IndexedDB for faster model loading</p>
                        </div>
                    )}

                    <div className="model-list">
                        {availableModels
                            // Sort models: selected model first, then cached models, then others
                            .sort((a, b) => {
                                // Selected model always comes first
                                if (a.model_id === selectedModelId) return -1;
                                if (b.model_id === selectedModelId) return 1;

                                // Then cached models
                                const aIsCached = cachedModels.includes(a.model_id);
                                const bIsCached = cachedModels.includes(b.model_id);
                                if (aIsCached && !bIsCached) return -1;
                                if (!aIsCached && bIsCached) return 1;

                                // Maintain original order within groups
                                return 0;
                            })
                            // Filter models based on search query
                            .filter(model => {
                                if (!searchQuery) return true;
                                const query = searchQuery.toLowerCase();
                                const modelName = (model.model_name || '').toLowerCase();
                                const modelId = model.model_id.toLowerCase();
                                const modelDesc = (model.description || '').toLowerCase();
                                return modelName.includes(query) ||
                                       modelId.includes(query) ||
                                       modelDesc.includes(query);
                            })
                            .map(model => {
                            const isCached = cachedModels.includes(model.model_id);
                            const isSelected = model.model_id === selectedModelId;
                            const isLoading = !!loadingModels[model.model_id];
                            const hasError = !!modelErrors[model.model_id];
                            const isActive = isSelected && !isLoading && !hasError && llm;

                            // Extract model name from model_id if model_name is not available
                            const displayName = model.model_name || model.model_id.split('/').pop() || model.model_id;

                            // Get loading info if model is loading
                            const loadingInfo = loadingModels[model.model_id];

                            // Format model size if available
                            const formatSize = (sizeInBytes) => {
                                if (!sizeInBytes) return null;

                                const sizes = ['B', 'KB', 'MB', 'GB'];
                                let i = 0;
                                let size = sizeInBytes;

                                while (size >= 1024 && i < sizes.length - 1) {
                                    size /= 1024;
                                    i++;
                                }

                                return `${size.toFixed(1)} ${sizes[i]}`;
                            };

                            // Get model size from model.model_size or estimate from model type
                            const getModelSize = (model) => {
                                if (model.model_size) {
                                    return formatSize(model.model_size);
                                }

                                // More comprehensive size estimation based on model ID
                                const modelId = model.model_id.toLowerCase();

                                // Check for specific model sizes
                                if (modelId.includes('7b')) {
                                    return '~4 GB';
                                } else if (modelId.includes('13b')) {
                                    return '~8 GB';
                                } else if (modelId.includes('3b') || modelId.includes('3B')) {
                                    return '~2 GB';
                                } else if (modelId.includes('1b') || modelId.includes('1B')) {
                                    return '~1 GB';
                                } else if (modelId.includes('gemma-2b')) {
                                    return '~1.5 GB';
                                } else if (modelId.includes('gemma')) {
                                    return '~2 GB';
                                } else if (modelId.includes('llama-2')) {
                                    if (modelId.includes('7b')) {
                                        return '~4 GB';
                                    } else if (modelId.includes('13b')) {
                                        return '~8 GB';
                                    } else {
                                        return '~4-13 GB';
                                    }
                                } else if (modelId.includes('mistral')) {
                                    return '~4 GB';
                                } else if (modelId.includes('phi')) {
                                    return '~1.5 GB';
                                } else if (modelId.includes('tiny')) {
                                    return '~0.5 GB';
                                } else if (modelId.includes('small')) {
                                    return '~1 GB';
                                } else if (modelId.includes('base')) {
                                    return '~2 GB';
                                } else if (modelId.includes('large')) {
                                    return '~4 GB';
                                } else {
                                    return '~2-4 GB';  // Better default than "varies"
                                }
                            };

                            // Get Hugging Face URL for the model
                            const getHuggingFaceUrl = (model) => {
                                const modelId = model.model_id;

                                // Extract organization/model format if present
                                if (modelId.includes('/')) {
                                    return `https://huggingface.co/${modelId}`;
                                }

                                // Handle special cases
                                if (modelId.startsWith('Llama-2')) {
                                    return 'https://huggingface.co/meta-llama';
                                } else if (modelId.startsWith('gemma')) {
                                    return 'https://huggingface.co/google/gemma';
                                } else if (modelId.startsWith('mistral')) {
                                    return 'https://huggingface.co/mistralai';
                                } else if (modelId.startsWith('phi')) {
                                    return 'https://huggingface.co/microsoft/phi';
                                }

                                // Default to search
                                return `https://huggingface.co/models?search=${encodeURIComponent(modelId)}`;
                            };

                            const modelSize = getModelSize(model);

                            return (
                                <div
                                    key={model.model_id}
                                    className={`model-item ${isSelected ? 'selected' : ''} ${isCached ? 'cached' : ''} ${isLoading ? 'loading' : ''} ${hasError ? 'error' : ''}`}
                                    onClick={() => handleModelChange(model.model_id)}
                                >
                                    <div className="model-details">
                                        <div className="model-name">
                                            {displayName}
                                            {isActive && <span className="active-indicator"> (Active)</span>}
                                        </div>
                                        <div className="model-id">{model.model_id}</div>
                                        <div className="model-description">
                                            {model.description || 'This is an AI model that runs directly in your browser.'}
                                        </div>
                                        <div className="model-size">
                                            <span className="size-label">Size:</span> {modelSize}
                                        </div>
                                        <div className="model-links">
                                            <a
                                                href={getHuggingFaceUrl(model)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="hf-link"
                                            >
                                                <span className="hf-icon">🤗</span> View on Hugging Face
                                            </a>
                                        </div>
                                        <div className="model-status">
                                            {isLoading ? (
                                                <span className="loading-badge">
                                                    <span className="spinner-tiny"></span>
                                                    Loading... {loadingInfo?.progress}%
                                                </span>
                                            ) : hasError ? (
                                                <span className="error-badge">
                                                    Error
                                                </span>
                                            ) : isCached ? (
                                                <span className="cached-badge">Cached</span>
                                            ) : (
                                                <span className="download-badge">Will download</span>
                                            )}
                                            {isActive && <span className="active-badge">Current</span>}
                                        </div>
                                        {hasError && (
                                            <div className="model-error-message">
                                                {modelErrors[model.model_id]}
                                                <button
                                                    className="retry-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        loadModel(model.model_id);
                                                    }}
                                                >
                                                    Retry
                                                </button>
                                            </div>
                                        )}
                                        {isLoading && (
                                            <div className="model-loading-progress">
                                                <div className="progress-bar-small">
                                                    <div
                                                        className="progress-fill"
                                                        style={{ width: `${loadingInfo?.progress || 0}%` }}
                                                    ></div>
                                                </div>
                                                <div className="loading-status-small">
                                                    {loadingInfo?.status || 'Loading...'}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {isCached && !isSelected && (
                                        <button
                                            className="delete-model-btn"
                                            onClick={(e) => handleDeleteModel(model.model_id, e)}
                                        >
                                            Delete
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <button
                        className="refresh-models-btn"
                        onClick={refreshCachedModels}
                    >
                        Refresh Cached Models
                    </button>
                </div>

                {/* Right side - Chat interface */}
                <div className="chat-container">
                    {selectedModelId && (
                        <div className={`model-info ${loadingModels[selectedModelId] ? 'loading' : ''} ${modelErrors[selectedModelId] ? 'error' : ''} ${llm && activeWorkerId ? 'ready' : ''}`}>
                            <h3>
                                Current Model: {
                                    availableModels.find(m => m.model_id === selectedModelId)?.model_name ||
                                    selectedModelId.split('/').pop() ||
                                    selectedModelId ||
                                    "Unknown"
                                }
                                {loadingModels[selectedModelId] && (
                                    <span className="model-status-badge loading">
                                        <span className="spinner-tiny"></span>
                                        Loading...
                                    </span>
                                )}
                                {modelErrors[selectedModelId] && (
                                    <span className="model-status-badge error">Error</span>
                                )}
                                {llm && activeWorkerId && !loadingModels[selectedModelId] && !modelErrors[selectedModelId] && (
                                    <span className="model-status-badge ready">Ready</span>
                                )}
                                {!llm && !activeWorkerId && !loadingModels[selectedModelId] && !modelErrors[selectedModelId] && (
                                    <span className="model-status-badge pending">Pending Download</span>
                                )}
                            </h3>

                            <div className="model-info-details">
                                {/* Display model size and ID for the selected model */}
                                {(() => {
                                    const selectedModel = availableModels.find(m => m.model_id === selectedModelId);
                                    if (selectedModel) {
                                        // Reuse the same size calculation logic
                                        const getModelSize = (model) => {
                                            if (model.model_size) {
                                                const formatSize = (sizeInBytes) => {
                                                    if (!sizeInBytes) return null;

                                                    const sizes = ['B', 'KB', 'MB', 'GB'];
                                                    let i = 0;
                                                    let size = sizeInBytes;

                                                    while (size >= 1024 && i < sizes.length - 1) {
                                                        size /= 1024;
                                                        i++;
                                                    }

                                                    return `${size.toFixed(1)} ${sizes[i]}`;
                                                };
                                                return formatSize(model.model_size);
                                            }

                                            // Estimate size based on model name/type
                                            if (model.model_id.includes('7b')) {
                                                return '~4 GB';
                                            } else if (model.model_id.includes('13b')) {
                                                return '~8 GB';
                                            } else if (model.model_id.includes('3b') || model.model_id.includes('3B')) {
                                                return '~2 GB';
                                            } else if (model.model_id.includes('1b') || model.model_id.includes('1B')) {
                                                return '~1 GB';
                                            } else if (model.model_id.includes('gemma')) {
                                                return '~1.5 GB';
                                            } else {
                                                return 'Size varies';
                                            }
                                        };

                                        const modelSize = getModelSize(selectedModel);

                                        // Get Hugging Face URL for the model
                                        const getHuggingFaceUrl = (model) => {
                                            const modelId = model.model_id;

                                            // Extract organization/model format if present
                                            if (modelId.includes('/')) {
                                                return `https://huggingface.co/${modelId}`;
                                            }

                                            // Handle special cases
                                            if (modelId.startsWith('Llama-2')) {
                                                return 'https://huggingface.co/meta-llama';
                                            } else if (modelId.startsWith('gemma')) {
                                                return 'https://huggingface.co/google/gemma';
                                            } else if (modelId.startsWith('mistral')) {
                                                return 'https://huggingface.co/mistralai';
                                            } else if (modelId.startsWith('phi')) {
                                                return 'https://huggingface.co/microsoft/phi';
                                            }

                                            // Default to search
                                            return `https://huggingface.co/models?search=${encodeURIComponent(modelId)}`;
                                        };

                                        const hfUrl = getHuggingFaceUrl(selectedModel);

                                        return (
                                            <>
                                                <div className="model-info-row">
                                                    <span className="model-id-display">ID: {selectedModel.model_id}</span>
                                                    <span className="model-size-display">Size: <span className="size-value">{modelSize}</span></span>
                                                </div>
                                                <p className="model-hf-link">
                                                    <a
                                                        href={hfUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="hf-link-large"
                                                    >
                                                        <span className="hf-icon">🤗</span> View on Hugging Face
                                                    </a>
                                                </p>
                                            </>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>

                            <div className="model-info-actions">
                                <p>Runs in browser</p>
                            </div>
                        </div>
                    )}

                    {selectedModelId && loadingModels[selectedModelId] && (
                        <div className="model-loading-info">
                            <p>
                                <span className="spinner-small"></span>
                                Loading model: {loadingModels[selectedModelId].status}
                            </p>
                            <div className="progress-bar">
                                <div
                                    className="progress-fill"
                                    style={{ width: `${loadingModels[selectedModelId].progress}%` }}
                                ></div>
                            </div>
                            <p className="loading-percent">{loadingModels[selectedModelId].progress}% complete</p>
                        </div>
                    )}

                    {selectedModelId && modelErrors[selectedModelId] && (
                        <div className="model-error-info">
                            <p className="error-message-small">Error: {modelErrors[selectedModelId]}</p>
                            <button
                                onClick={() => loadModel(selectedModelId)}
                                className="retry-button"
                            >
                                Retry Loading
                            </button>
                        </div>
                    )}

                    {/* Advanced Settings Accordion */}
                    <div className="advanced-settings">
                        <button
                            className={`advanced-settings-toggle ${showAdvancedSettings ? 'open' : ''}`}
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                        >
                            <span className="toggle-icon">{showAdvancedSettings ? '▼' : '▶'}</span>
                            Advanced Settings
                        </button>

                        {showAdvancedSettings && (
                            <div className="advanced-settings-content">
                                <div className="setting-group">
                                    <label htmlFor="system-prompt">System Prompt:</label>
                                    <textarea
                                        id="system-prompt"
                                        value={systemPrompt}
                                        onChange={(e) => setSystemPrompt(e.target.value)}
                                        placeholder="Enter a system prompt to guide the model's behavior..."
                                        className="system-prompt-input"
                                        disabled={generating}
                                    />
                                    <p className="setting-description">
                                        The system prompt helps define the AI's behavior and context.
                                        It's sent before your message to guide the model's responses.
                                    </p>
                                    <div className="system-prompt-examples">
                                        <p>Examples:</p>
                                        <button
                                            className="example-prompt-btn"
                                            onClick={() => setSystemPrompt("Always return in Markdown format")}
                                        >
                                            Use Markdown Format
                                        </button>
                                        <button
                                            className="example-prompt-btn"
                                            onClick={() => setSystemPrompt("You are a helpful coding assistant. Always include code examples in your responses.")}
                                        >
                                            Coding Assistant
                                        </button>
                                        <button
                                            className="example-prompt-btn"
                                            onClick={() => setSystemPrompt("Always format your code examples using markdown code blocks with the appropriate language specified. For example: ```javascript\nconst example = 'code';\n```")}
                                        >
                                            Code Blocks with Language
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="input-area">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="🤔 Ask me anything... I'm all ears (and neurons)!"
                            disabled={generating}
                        />
                        <button
                            onClick={generateText}
                            disabled={generating || !input.trim() || !llm || !activeWorkerId || loadingModels[selectedModelId]}
                            className="generate-button"
                        >
                            {generating ? (
                                <>
                                    <span className="spinner-small"></span>
                                    🧪 Brewing thoughts...
                                </>
                            ) : loadingModels[selectedModelId] ? (
                                <>
                                    <span className="spinner-small"></span>
                                    🔄 Loading model... {loadingModels[selectedModelId]?.progress || 0}%
                                </>
                            ) : !llm || !activeWorkerId ? (
                                selectedModelId ? (
                                    <>
                                        <span className="spinner-small"></span>
                                        ⏳ Waiting for model to download...
                                    </>
                                ) : (
                                    '🎯 Pick a model first!'
                                )
                            ) : (
                                '✨ Let\'s Go!'
                            )}
                        </button>
                    </div>

                    <div className="output-area" ref={outputRef}>
                        {output ? (
                            <div className={`output-content output-${formattedOutput.type}`}>
                                {formattedOutput.type === 'markdown' ? (
                                    <div className="markdown-content">
                                        <ReactMarkdown
                                            components={{
                                                // Custom renderer for code blocks
                                                code: ({node, inline, className, children, ...props}) => {
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    const language = match ? match[1] : '';

                                                    // If it's an inline code, render it as is
                                                    if (inline) {
                                                        return (
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        );
                                                    }

                                                    // For code blocks, use our custom CodeBlock component
                                                    return (
                                                        <CodeBlock language={language}>
                                                            {String(children).replace(/\n$/, '')}
                                                        </CodeBlock>
                                                    );
                                                }
                                            }}
                                        >
                                            {formattedOutput.formattedContent}
                                        </ReactMarkdown>
                                    </div>
                                ) : formattedOutput.type === 'json' ? (
                                    <CodeBlock language="json">
                                        {formattedOutput.formattedContent}
                                    </CodeBlock>
                                ) : (
                                    formattedOutput.formattedContent || output
                                )}
                            </div>
                        ) : generating ? (
                            <div className="generating">
                                <span className="spinner-small"></span>
                                🤖 Brain cells firing... Hold tight!
                            </div>
                        ) : (
                            <div className="empty-output">
                                <p>🎭 Stage is set! Ask away, and watch the magic happen...</p>
                            </div>
                        )}
                    </div>

                    {Object.keys(loadingModels).length > 0 && (
                        <div className="loading-models-summary">
                            <h4>Models Loading in Background:</h4>
                            <ul>
                                {Object.entries(loadingModels).map(([modelId, info]) => {
                                    const modelName = availableModels.find(m => m.model_id === modelId)?.model_name ||
                                                     modelId.split('/').pop() ||
                                                     modelId;

                                    // Get download progress info if available
                                    const downloadInfo = downloadProgress[modelId];

                                    return (
                                        <li key={modelId} className="loading-model-item">
                                            <div className="loading-model-name">{modelName}</div>
                                            <div className="loading-model-status">{info.status}</div>
                                            <div className="loading-model-progress-container">
                                                <div
                                                    className="loading-model-progress-bar"
                                                    style={{width: `${info.progress}%`}}
                                                ></div>
                                                <span className="loading-model-progress-text">{info.progress}%</span>
                                            </div>
                                            {downloadInfo && downloadInfo.phase === 'downloading' && (
                                                <div className="loading-model-chunks">
                                                    Chunk {downloadInfo.chunk}/{downloadInfo.numChunks}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {/* Performance metrics display */}
                    <div className="performance-metrics">
                        <h4>Performance Optimizations:</h4>
                        <ul>
                            <li>
                                <span className="metric-name">Web Workers:</span>
                                <span className="metric-value">{workerPool ? `Active (${workerPool.size} workers)` : 'Initializing...'}</span>
                            </li>
                            <li>
                                <span className="metric-name">IndexedDB Storage:</span>
                                <span className="metric-value">{usingIndexedDB ? 'Active' : 'Available'}</span>
                            </li>
                            <li>
                                <span className="metric-name">Service Worker:</span>
                                <span className="metric-value">{navigator.serviceWorker && navigator.serviceWorker.controller ? 'Active' : 'Registering...'}</span>
                            </li>
                            <li>
                                <span className="metric-name">Network Status:</span>
                                <span className="metric-value">{isOnline ? '🟢 Online' : '🔴 Offline'}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AIModelComponent;
