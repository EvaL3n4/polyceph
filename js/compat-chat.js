/**
 * compat-chat.js
 * Compatibility layer for Chat Completion API settings.
 * Reads from SillyTavern's oai_settings (exposed as ctx.chatCompletionSettings).
 *
 * IMPORTANT: SillyTavern's generateRaw() internally dispatches to sendOpenAIRequest(),
 * which calls createGenerationParameters() (openai.js:L2529) to build the full API
 * payload from the active preset. This means ALL sampler settings (temperature, top_p,
 * penalties, logit bias, stop strings, reasoning effort, etc.) are applied by ST
 * automatically — Polyceph does NOT need to pass them.
 *
 * This module provides:
 *   1. Active limit introspection (context size, response length) for prompt budgeting.
 *   2. Feature flag reading (streaming, reasoning) for Polyceph UI/logic decisions.
 *
 * Reference:
 *   oai_settings definition       — openai.js:L389-490 (default_settings)
 *   createGenerationParameters()  — openai.js:L2529 (maps oai_settings → API payload)
 *   calculateLogitBias()          — openai.js:L3166 (processes bias presets)
 *   st-context.js:L222            — chatCompletionSettings = oai_settings
 */

import { MODULE_NAME } from './constants.js';
import { logger } from './logger.js';
import { getOpenAIModule, getSSEModule } from './compat-st.js';
import { getActiveApi } from './compat-shared.js';

/**
 * Reads the active Chat Completion generation parameters from SillyTavern.
 * These reflect the CURRENTLY SELECTED preset, not defaults.
 *
 * The ctx.chatCompletionSettings object is a LIVE reference to oai_settings,
 * which is mutated in-place when the user selects a new preset. No manual
 * refresh is needed.
 *
 * @returns {object} Chat Completion parameters from the active preset.
 */
export function getChatCompletionParams() {
    const ctx = SillyTavern.getContext();
    const cc = ctx.chatCompletionSettings;

    if (!cc) {
        logger.warn('chatCompletionSettings not available.');
        return {};
    }

    return {
        // --- Limits (used by Polyceph for budgeting) ---
        maxContextTokens: Number(cc.openai_max_context) || 4096,
        maxResponseTokens: Number(cc.openai_max_tokens) || 300,
        unlockedContext: !!cc.max_context_unlocked,

        // --- Model identification ---
        model: typeof ctx.getChatCompletionModel === 'function'
            ? ctx.getChatCompletionModel(cc)
            : (cc.openai_model || cc.claude_model || cc.google_model || ''),
        chatCompletionSource: cc.chat_completion_source || '',
        presetName: cc.preset_settings_openai || '',

        // --- Sampling (informational — ST applies these internally) ---
        temperature: Number(cc.temp_openai) ?? 1,
        topP: Number(cc.top_p_openai) ?? 1,
        topK: Number(cc.top_k_openai) ?? 0,
        minP: Number(cc.min_p_openai) ?? 0,
        topA: Number(cc.top_a_openai) ?? 0,
        frequencyPenalty: Number(cc.freq_pen_openai) ?? 0,
        presencePenalty: Number(cc.pres_pen_openai) ?? 0,
        repetitionPenalty: Number(cc.repetition_penalty_openai) ?? 1,
        seed: Number(cc.seed) ?? -1,

        // --- Feature flags (used by Polyceph for behavior decisions) ---
        stream: !!cc.stream_openai,
        showThoughts: !!cc.show_thoughts,
        reasoningEffort: cc.reasoning_effort || 'auto',
        verbosity: cc.verbosity || 'auto',
        mediaInlining: !!cc.media_inlining,
        inlineImageQuality: cc.inline_image_quality || 'auto',
    };
}

/**
 * Gets the effective max prompt tokens for Chat Completion.
 * This is context window minus reserved response tokens.
 *
 * @returns {number} Maximum prompt tokens for Chat Completion.
 */
export function getChatCompletionMaxPromptTokens() {
    const params = getChatCompletionParams();
    return params.maxContextTokens - params.maxResponseTokens;
}

/**
 * Checks if the current or specified API is a Chat Completion (OpenAI-compatible) API.
 * Uses SillyTavern's internal CONNECT_API_MAP to resolve aliases.
 *
 * @param {string|null} apiOverride - Optional API ID to check.
 * @returns {boolean}
 */
export function isChatCompletionApi(apiOverride = null) {
    let api = apiOverride || getActiveApi();
    const ctx = SillyTavern.getContext();
    if (ctx.CONNECT_API_MAP && ctx.CONNECT_API_MAP[api]) {
        if (ctx.CONNECT_API_MAP[api].selected) {
            api = ctx.CONNECT_API_MAP[api].selected;
        }
    }
    return api === 'openai';
}

/**
 * Sends a message array to SillyTavern's generation API using Chat Completion logic.
 *
 * @param {object[]} messages - Array of {role, content, invocations} message objects.
 * @param {object[]} [tools] - Optional tool definitions.
 * @param {object|string} [tool_choice] - Optional tool choice setting.
 * @param {boolean} [noEmissions=false] - Whether to skip extension prompt injection events.
 * @returns {Promise<object>} The generated response data.
 */
export async function generateViaCC(messages, tools = null, tool_choice = null, noEmissions = false, options = {}) {
    const context = SillyTavern.getContext();
    const api = context.mainApi;

    // Only chat completion APIs support our robust parameter building path
    if (api !== 'openai') {
        logger.debug('Using fallback path for non-openai API:', api);
        if (typeof context.generateRawData === 'function') {
            const params = { prompt: messages, systemPrompt: '' };
            if (tools) params.tools = tools;
            if (tool_choice) params.tool_choice = tool_choice;
            return await context.generateRawData(params);
        }
        const flattened = messages.map(m => m.content).join('\n\n');
        return await context.generateQuietPrompt({ quietPrompt: flattened });
    }

    // Import ST internal module
    const openaiModule = await getOpenAIModule();
    if (!openaiModule?.createGenerationParameters) {
        logger.warn('Required ST generation functions not found. Falling back to simple path.');
        const flattened = messages.map(m => m.content).join('\n\n');
        return await context.generateQuietPrompt({ quietPrompt: flattened });
    }

    const { createGenerationParameters, oai_settings, getChatCompletionModel } = openaiModule;

    // Resolve model
    const model = typeof getChatCompletionModel === 'function'
        ? getChatCompletionModel(oai_settings)
        : (oai_settings?.openai_model || '');

    // Emit CHAT_COMPLETION_PROMPT_READY (unless emissions are disabled)
    if (!noEmissions && context.eventSource && context.eventTypes?.CHAT_COMPLETION_PROMPT_READY) {
        const eventData = { chat: messages, dryRun: false };
        await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, eventData);
        messages = eventData.chat;
    }

    // Build payload using ST's own function
    const { generate_data } = await createGenerationParameters(oai_settings, model, 'quiet', messages);

    // Override tools if provided by Polyceph's loop
    if (tools && tools.length > 0) {
        generate_data.tools = tools;
        generate_data.tool_choice = tool_choice || 'auto';
    }

    // Emit CHAT_COMPLETION_SETTINGS_READY (unless emissions are disabled)
    if (!noEmissions && context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
        await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generate_data);
    }

    // NEW: Polyceph-specific payload event (includes all ST injections)
    if (!noEmissions && context.eventSource) {
        if (!generate_data.extra) generate_data.extra = {};
        generate_data.extra.polyceph_task_id = options.polyceph_task_id || 'unknown';
        generate_data.extra.polyceph_task_label = options.polyceph_task_label || 'Unnamed Task';
        context.eventSource.emit('polyceph-task-payload-ready', generate_data);
    }

    logger.debug('Non-streaming generation payload:', generate_data);

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        body: JSON.stringify(generate_data),
        headers: context.getRequestHeaders(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Generation request failed with status ${response.status}: ${errorText}`);
    }

    return await response.json();
}

/**
 * Streaming variant of generateViaCC for Chat Completion APIs.
 *
 * @param {object[]} messages - Chat-style message array [{role, content}, ...].
 * @param {AbortSignal} signal - Abort signal for cancellation.
 * @param {function} onChunk - Called with {text: string, toolCalls: any[], done: boolean} per delta.
 * @param {object[]} [tools] - Optional tool definitions.
 * @param {string} [tool_choice] - Optional tool choice.
 * @param {string} [apiOverride] - Optional API override.
 * @param {boolean} [noEmissions=false] - Whether to skip extension prompt injection events.
 * @returns {Promise<object|null>} Accumulated response data, or null if streaming unavailable.
 */
export async function generateViaCCStreaming(messages, signal, onChunk, tools = null, tool_choice = null, apiOverride = null, noEmissions = false, options = {}) {
    const context = SillyTavern.getContext();
    let api = apiOverride || context.mainApi;

    if (context.CONNECT_API_MAP && context.CONNECT_API_MAP[api]) {
        if (context.CONNECT_API_MAP[api].selected) {
            api = context.CONNECT_API_MAP[api].selected;
        }
    }

    // Only chat completion APIs support our streaming path
    if (api !== 'openai') {
        logger.debug('Streaming not available for non-chat-completion API:', api);
        return null;
    }

    // Import ST internal modules
    const [openaiModule, sseModule] = await Promise.all([
        getOpenAIModule(),
        getSSEModule(),
    ]);

    if (!openaiModule?.createGenerationParameters || !openaiModule?.getStreamingReply || !sseModule?.getEventSourceStream) {
        logger.warn('Required ST streaming functions not found. Falling back to non-streaming.');
        return null;
    }

    const { createGenerationParameters, getStreamingReply, tryParseStreamingError, oai_settings, getChatCompletionModel } = openaiModule;
    const { getEventSourceStream } = sseModule;

    // Resolve model
    const model = typeof getChatCompletionModel === 'function'
        ? getChatCompletionModel(oai_settings)
        : (oai_settings?.openai_model || '');

    // Emit CHAT_COMPLETION_PROMPT_READY (unless emissions are disabled)
    if (!noEmissions && context.eventSource && context.eventTypes?.CHAT_COMPLETION_PROMPT_READY) {
        const eventData = { chat: messages, dryRun: false };
        await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, eventData);
        messages = eventData.chat;
    }

    // Build payload using ST's own function
    const { generate_data } = await createGenerationParameters(oai_settings, model, 'quiet', messages);

    // Force stream on
    generate_data.stream = true;

    // Inject tools if provided
    if (tools && tools.length > 0) {
        generate_data.tools = tools;
        generate_data.tool_choice = tool_choice || 'auto';
    }

    // Emit CHAT_COMPLETION_SETTINGS_READY (unless emissions are disabled)
    if (!noEmissions && context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
        await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generate_data);
    }

    // NEW: Polyceph-specific payload event (includes all ST injections)
    if (!noEmissions && context.eventSource) {
        context.eventSource.emit('polyceph-task-payload-ready', generate_data);
    }

    logger.debug('Streaming generation payload:', generate_data);

    // Set up abort handling
    const fetchAbortController = new AbortController();
    const abortHook = () => fetchAbortController.abort(new Error('Cancelled by stop event'));

    if (signal) {
        if (signal.aborted) fetchAbortController.abort(new Error('Aborted'));
        else signal.addEventListener('abort', () => fetchAbortController.abort(new Error('Aborted')), { once: true });
    }

    if (context.eventSource && context.eventTypes?.GENERATION_STOPPED) {
        context.eventSource.on(context.eventTypes.GENERATION_STOPPED, abortHook);
    }

    try {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            body: JSON.stringify(generate_data),
            headers: context.getRequestHeaders(),
            signal: fetchAbortController.signal,
        });

        if (!response.ok) {
            if (typeof tryParseStreamingError === 'function') tryParseStreamingError(response, await response.text());
            throw new Error(`Streaming request failed with status ${response.status}`);
        }

        const eventStream = getEventSourceStream();
        response.body.pipeThrough(eventStream);
        const reader = eventStream.readable.getReader();

        let text = '';
        const state = { reasoning: '', images: [], signature: '', toolSignatures: {} };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value.event === 'error') {
                logger.error('SSE Error:', value.data);
                continue;
            }

            if (value.data === '[DONE]') break;

            let parsed;
            try {
                parsed = JSON.parse(value.data);
            } catch (e) {
                logger.warn('Failed to parse SSE data:', value.data);
                continue;
            }

            if (parsed.error) {
                const err = parsed.error;
                throw new Error(`API returned error in stream: ${err.message || JSON.stringify(err)} (Code: ${err.code})`);
            }

            const delta = getStreamingReply(parsed, state);
            if (delta) {
                text += delta;
                if (onChunk) onChunk({ 
                    text, 
                    reasoning: state.reasoning,
                    toolCalls: state.toolCalls || [], 
                    done: false 
                });
            }
        }

        if (onChunk) onChunk({ 
            text, 
            reasoning: state.reasoning,
            toolCalls: state.toolCalls || [], 
            done: true 
        });

        return { 
            choices: [{ 
                message: { 
                    content: text, 
                    reasoning_content: state.reasoning,
                    signature: state.signature,
                    toolSignatures: state.toolSignatures,
                    tool_calls: state.toolCalls 
                } 
            }] 
        };
    } finally {
        if (context.eventSource && context.eventTypes?.GENERATION_STOPPED) {
            context.eventSource.removeListener(context.eventTypes.GENERATION_STOPPED, abortHook);
        }
    }
}
