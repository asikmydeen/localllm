// src/components/AIModelComponent.js
import React, { useState, useEffect, useRef } from 'react';
import {
  CreateMLCEngine,
  prebuiltAppConfig,
  hasModelInCache,
  deleteModelInCache
} from '@mlc-ai/web-llm';
import './AIModelComponent.css';

function AIModelComponent() {
    const [input, setInput] = useState('Explain how machine learning works in 3 sentences.');
    const [output, setOutput] = useState('');
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
    const outputRef = useRef(null);

    // Get available models from prebuilt config
    const availableModels = prebuiltAppConfig.model_list || [];

    // Save selected model to localStorage when it changes
    useEffect(() => {
        if (selectedModelId) {
            localStorage.setItem('selectedModelId', selectedModelId);
        }
    }, [selectedModelId]);

    // Check which models are cached
    useEffect(() => {
        async function checkCachedModels() {
            const cached = [];
            for (const model of availableModels) {
                const isCached = await hasModelInCache(model.model_id);
                if (isCached) {
                    cached.push(model.model_id);
                }
            }
            setCachedModels(cached);

            // Only set default model if no model is currently selected
            if (!selectedModelId) {
                // First try to use a cached model
                if (cached.length > 0) {
                    setSelectedModelId(cached[0]);
                }
                // If no cached models, use the first available model
                else if (availableModels.length > 0) {
                    setSelectedModelId(availableModels[0].model_id);
                }
            }
        }

        checkCachedModels();
    }, []); // Run only once on component mount

    // Load a model
    const loadModel = async (modelId) => {
        if (!modelId) return;

        // Skip if already loading this model
        if (loadingModels[modelId]) {
            console.log(`Model ${modelId} is already loading, skipping`);
            return;
        }

        // Skip if we already have an active LLM for this model
        // Note: The engine might store the model name in different properties
        if (llm && (
            modelId === llm._model_name ||
            modelId === llm.model_name ||
            modelId === llm.modelId
        )) {
            console.log(`Model ${modelId} is already loaded and active, skipping`);
            return;
        }

        try {
            // Set loading state for this specific model
            setLoadingModels(prev => ({
                ...prev,
                [modelId]: {
                    status: 'Initializing WebLLM...',
                    progress: 0
                }
            }));

            // Clear any previous errors for this model
            setModelErrors(prev => {
                const newErrors = {...prev};
                delete newErrors[modelId];
                return newErrors;
            });

            console.log("Loading model:", modelId);

            // Initialize the LLM with the selected model
            const engine = await CreateMLCEngine(modelId, {
                use_web_worker: true,
                progress_callback: (progress) => {
                    console.log(`Progress for ${modelId}:`, progress);
                    if (progress.type === "download") {
                        setLoadingModels(prev => ({
                            ...prev,
                            [modelId]: {
                                status: `Downloading model files (${progress.file})...`,
                                progress: Math.round(progress.progress * 100)
                            }
                        }));
                    } else if (progress.type === "initialize") {
                        setLoadingModels(prev => ({
                            ...prev,
                            [modelId]: {
                                status: 'Initializing model...',
                                progress: 50 + Math.round(progress.progress * 50)
                            }
                        }));
                    }
                }
            });

            // If this is the selected model, set it as the active LLM
            if (modelId === selectedModelId) {
                setLLM(engine);
            }

            // Remove from loading models
            setLoadingModels(prev => {
                const newLoading = {...prev};
                delete newLoading[modelId];
                return newLoading;
            });

            console.log(`Model ${modelId} loaded successfully!`);

            // Update cached models list - only if not already in the list
            setCachedModels(prev => {
                if (prev.includes(modelId)) {
                    return prev;
                }
                return [...prev, modelId];
            });

        } catch (err) {
            console.error(`Failed to initialize model ${modelId}:`, err);

            // Set error for this specific model
            setModelErrors(prev => ({
                ...prev,
                [modelId]: `Failed to initialize: ${err.message}`
            }));

            // Remove from loading models
            setLoadingModels(prev => {
                const newLoading = {...prev};
                delete newLoading[modelId];
                return newLoading;
            });
        }
    };

    // Initialize the WebLLM engine when selectedModelId changes
    useEffect(() => {
        async function initLLM() {
            if (!selectedModelId) return;

            // Skip if we already have an active LLM for this model
            // Note: The engine might store the model name in different properties
            if (llm && (
                selectedModelId === llm._model_name ||
                selectedModelId === llm.model_name ||
                selectedModelId === llm.modelId
            )) {
                console.log(`Model ${selectedModelId} is already loaded and active`);
                return;
            }

            // If the model is already cached, load it
            if (cachedModels.includes(selectedModelId)) {
                await loadModel(selectedModelId);
            }
            // If not cached, start loading it
            else if (!loadingModels[selectedModelId]) {
                loadModel(selectedModelId);
            }
        }

        initLLM();

        // Clean up function
        return () => {
            if (llm) {
                // Clean up resources if needed
            }
        };
    }, [selectedModelId]); // Only reinitialize when selected model changes

    // Generate text using the model
    const generateText = async () => {
        if (!llm || !input.trim()) return;

        try {
            setGenerating(true);
            setOutput('');

            // Log the engine object
            console.log("Engine object:", llm);

            // Check which methods are available on the model
            const hasCompletion = typeof llm.completion === 'function';
            const hasChatCompletion = typeof llm.chatCompletion === 'function';
            const hasGenerate = typeof llm.generate === 'function';

            console.log("Available methods:", {
                hasCompletion,
                hasChatCompletion,
                hasGenerate
            });

            let responseText = '';

            // Try the available methods in order of preference
            if (hasChatCompletion) {
                try {
                    console.log("Using chatCompletion method");
                    const chatResponse = await llm.chatCompletion({
                        messages: [{ role: 'user', content: input }],
                        temperature: 0.7,
                        max_tokens: 256
                    });

                    console.log("Chat response:", chatResponse);

                    if (chatResponse && chatResponse.choices && chatResponse.choices.length > 0) {
                        const message = chatResponse.choices[0].message;
                        responseText = message.content || "No content in response";
                    } else {
                        throw new Error("Unexpected chat response format");
                    }
                } catch (chatError) {
                    console.error("Chat completion failed:", chatError);
                    throw chatError; // Re-throw to try next method
                }
            } else if (hasCompletion) {
                try {
                    console.log("Using completion method");
                    const completionResponse = await llm.completion({
                        prompt: input,
                        temperature: 0.7,
                        max_tokens: 256
                    });

                    console.log("Completion response:", completionResponse);

                    if (completionResponse && completionResponse.choices && completionResponse.choices.length > 0) {
                        responseText = completionResponse.choices[0].text || '';
                    } else {
                        throw new Error("Unexpected completion response format");
                    }
                } catch (completionError) {
                    console.error("Completion failed:", completionError);
                    throw completionError; // Re-throw to try next method
                }
            } else if (hasGenerate) {
                try {
                    console.log("Using generate method");
                    // Some models might use a different API
                    const generateResponse = await llm.generate(input, {
                        temperature: 0.7,
                        max_length: 256
                    });

                    console.log("Generate response:", generateResponse);

                    // Handle different response formats
                    if (typeof generateResponse === 'string') {
                        responseText = generateResponse;
                    } else if (generateResponse && generateResponse.text) {
                        responseText = generateResponse.text;
                    } else if (generateResponse && generateResponse.response) {
                        responseText = generateResponse.response;
                    } else {
                        throw new Error("Unexpected generate response format");
                    }
                } catch (generateError) {
                    console.error("Generate failed:", generateError);
                    throw generateError;
                }
            } else {
                throw new Error("No compatible generation method found on this model");
            }

            setOutput(responseText);
            setGenerating(false);
        } catch (err) {
            console.error("Generation failed:", err);
            // Update model errors for the selected model
            setModelErrors(prev => ({
                ...prev,
                [selectedModelId]: `Generation failed: ${err.message}`
            }));
            setOutput("Failed to generate text. Please try a different model or input.");
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

    // Delete a model from cache
    const handleDeleteModel = async (modelId, e) => {
        e.stopPropagation(); // Prevent triggering model selection

        if (modelId === selectedModelId) {
            alert("Cannot delete the currently loaded model. Please select another model first.");
            return;
        }

        try {
            await deleteModelInCache(modelId);

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
            const isCached = await hasModelInCache(model.model_id);
            if (isCached) {
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
                    <h3>Select Model</h3>
                    <div className="model-search">
                        <input
                            type="text"
                            placeholder="Search models..."
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
                        <div className="model-info">
                            <h3>Current Model: {
                                availableModels.find(m => m.model_id === selectedModelId)?.model_name ||
                                selectedModelId.split('/').pop() ||
                                selectedModelId ||
                                "Unknown"
                            }</h3>

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

                    <div className="input-area">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter your prompt here..."
                            disabled={generating}
                        />
                        <button
                            onClick={generateText}
                            disabled={generating || !input.trim() || !llm || loadingModels[selectedModelId]}
                            className="generate-button"
                        >
                            {generating ? (
                                <>
                                    <span className="spinner-small"></span>
                                    Generating...
                                </>
                            ) : loadingModels[selectedModelId] ? (
                                <>
                                    <span className="spinner-small"></span>
                                    Loading Model...
                                </>
                            ) : !llm ? (
                                'Select a Cached Model'
                            ) : (
                                'Generate'
                            )}
                        </button>
                    </div>

                    <div className="output-area" ref={outputRef}>
                        {output ? (
                            <div className="output-content">{output}</div>
                        ) : generating ? (
                            <div className="generating">
                                <span className="spinner-small"></span>
                                Generating response...
                            </div>
                        ) : (
                            <div className="empty-output">
                                Response will appear here...
                            </div>
                        )}
                    </div>

                    {Object.keys(loadingModels).length > 0 && (
                        <div className="loading-models-summary">
                            <h4>Models Loading in Background:</h4>
                            <ul>
                                {Object.entries(loadingModels).map(([modelId, info]) => (
                                    <li key={modelId}>
                                        {availableModels.find(m => m.model_id === modelId)?.model_name ||
                                         modelId.split('/').pop() ||
                                         modelId}: {info.progress}%
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default AIModelComponent;