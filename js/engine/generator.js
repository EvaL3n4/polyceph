import { logger } from '../logger.js';
import { settings } from '../state.js';
import { waitForApiReady } from '../utils.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi, generateViaApiStreaming, isChatCompletionApi } from '../compat-shared.js';
import { parsePromptToMessages } from './parser.js';
import { LoopDetector } from './loop-detector.js';

import { getToolCallingModule } from '../compat-st.js';

/**
 * Executes a generation request through the SillyTavern API in "quiet" mode.
 * This avoids the main generation UI and allows background processing.
 *
 * @param {string} profileName - Connection profile to use.
 * @param {string} prompt - The assembled prompt text (with [[ROLE:...]] tags).
 * @param {string} [api=''] - API identifier.
 * @param {AbortSignal} [signal=null] - Abort signal.
 * @param {object} [options={}] - Streaming and loop detection options.
 * @param {boolean} [options.streaming] - Whether to attempt streaming (default: from settings).
 * @param {function} [options.onStream] - Called with {text, done} on each chunk.
 * @param {boolean} [options.antiLoop] - Enable loop detection (default: true).
 * @param {number} [options.loopThreshold] - Repetitions to trigger abort (default: from settings).
 * @returns {Promise<string>} The generated response text.
 */
export async function generateQuietly(profileName, prompt, api = '', signal = null, options = {}) {
    if (!profileName || profileName === 'none') return prompt;

    // Ensure API is ready and settled before starting generation
    await waitForApiReady(3000);

    if (signal && signal.aborted) throw new Error('Aborted');

    // Resolve streaming options from settings + overrides
    const useStreaming = options.streaming !== undefined ? options.streaming : (settings.enableStreaming !== false);
    const antiLoop = options.antiLoop !== undefined ? options.antiLoop : true;
    const loopThreshold = options.loopThreshold || settings.loopDetectionThreshold || 3;
    const onStream = options.onStream || null;

    try {
        const context = SillyTavern.getContext();

        // --- Compatibility: Token limit check ---
        const maxContext = await getMaxContextTokens();
        const maxResponse = getMaxResponseTokens();
        const maxPromptTokens = maxContext - maxResponse;

        const promptTokens = await countTokens(prompt);
        if (promptTokens > maxPromptTokens) {
            const errorMsg = `Prompt (${promptTokens} tokens) exceeds context budget (${maxPromptTokens} tokens). Generation aborted for safety.`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        let responseData = "";

        // Parse prompt into role-based messages
        const messages = [...parsePromptToMessages(prompt, api)];

        // --- Tool Calling Support ---
        let ToolManager;
        try {
            const tmModule = await getToolCallingModule();
            ToolManager = tmModule?.ToolManager;
            if (!ToolManager) {
                logger.warn('SillyTavern ToolManager not found. Tool calling features will be disabled for this generation.');
            }
        } catch (e) {
            logger.error('Failed to load SillyTavern ToolManager:', e);
        }

        let depth = 0;
        const maxDepth = settings.toolRecursionLimit !== undefined ? settings.toolRecursionLimit : 5;
        let finalResponse = "";

        while (depth < maxDepth) {
            if (signal && signal.aborted) throw new Error('Aborted');

            let tools = null;
            let tool_choice = null;

            if (ToolManager && typeof ToolManager.isToolCallingSupported === 'function' && ToolManager.isToolCallingSupported()) {
                tools = ToolManager.getFunctionTools();
                tool_choice = (tools && tools.length > 0) ? 'auto' : null;

                if (tools && tools.length > 0 && context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
                    const generateData = {
                        model: api === 'openai' ? (context.chatCompletionSettings?.openai_model || '') : '',
                        messages: messages,
                        tools: tools,
                        tool_choice: tool_choice,
                        // Passing additional settings to satisfy potential listeners (e.g. loggers/converters)
                        temperature: context.chatCompletionSettings?.temp_openai,
                        max_tokens: context.chatCompletionSettings?.openai_max_tokens || context.chatCompletionSettings?.max_tokens_openai,
                    };
                    await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generateData);
                    tools = generateData.tools;
                    tool_choice = generateData.tool_choice;
                }
            }

            // --- Determine whether to use streaming or non-streaming ---
            const canStream = useStreaming && isChatCompletionApi(api);
            let loopDetector = null;

            if (canStream && antiLoop) {
                loopDetector = new LoopDetector(loopThreshold);
            }

            let responseData;
            const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 120000;

            if (canStream) {
                // ========== STREAMING PATH ==========
                logger.debug('Using streaming generation path.');

                const streamingChunkHandler = async (chunk) => {
                    // Feed loop detector
                    if (loopDetector && !chunk.done) {
                        loopDetector.feed(chunk.text.slice(loopDetector.getFullText().length));
                        if (loopDetector.isLooping()) {
                            const info = loopDetector.getLoopInfo();
                            logger.warn(`Loop detected during streaming: "${info.pattern}" (${info.repetitions}× at period ${info.patternLength})`);
                            throw new Error('Loop detected');
                        }
                    }

                    // Forward to caller's stream handler
                    if (onStream) {
                        await onStream({ text: chunk.text, done: chunk.done });
                    }
                };

                const streamingPromise = generateViaApiStreaming(messages, signal, streamingChunkHandler, tools, tool_choice, api);

                // Build race array for timeout + abort
                const raceArr = [streamingPromise];

                if (timeoutMs > 0) {
                    raceArr.push(new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs)));
                }

                const abortPromise = signal ? new Promise((_, reject) => {
                    if (signal.aborted) reject(new Error('Aborted'));
                    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
                }) : null;
                if (abortPromise) raceArr.push(abortPromise);

                const streamResult = await Promise.race(raceArr);

                if (streamResult === null) {
                    // Streaming unavailable — fallback to non-streaming in next loop pass
                    logger.info('Streaming returned null (unavailable). Falling back to non-streaming.');
                    responseData = await _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs);
                } else {
                    logger.debug('Streaming path successfully returned result object.');
                    responseData = streamResult;
                }
            } else {
                // ========== NON-STREAMING PATH (unchanged) ==========
                logger.debug(`Streaming disabled or unsupported for API: ${api}. Using non-streaming generation path.`);
                responseData = await _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs);
            }

            if (!responseData) {
                finalResponse = "(Generation returned empty)";
                break;
            }

            // Extract tool calls from response
            // ST's generateRawData returns the raw API response
            const toolCalls = responseData?.choices?.[0]?.message?.tool_calls || responseData?.tool_calls;

            if (toolCalls && toolCalls.length > 0 && ToolManager) {
                logger.debug(`Tool calls detected (depth ${depth}):`, toolCalls);

                // 1. Add assistant message with tool calls to history
                messages.push({
                    role: 'assistant',
                    content: responseData?.choices?.[0]?.message?.content || '',
                    tool_calls: toolCalls
                });

                // 2. Execute tools
                const results = await ToolManager.executeToolCalls(toolCalls);

                // 3. Add tool results to history
                if (results && Array.isArray(results)) {
                    messages.push(...results);
                }

                depth++;
                continue; // Loop again with tool results
            }

            // No more tool calls, clean up and return
            if (responseData?._streaming) {
                // Streaming path: text is already extracted
                const rawText = responseData.choices?.[0]?.message?.content || '';
                if (typeof context.cleanUpMessage === 'function') {
                    finalResponse = context.cleanUpMessage({
                        getMessage: rawText,
                        isImpersonate: false,
                        isContinue: false,
                        displayIncompleteSentences: true,
                        includeUserPromptBias: false,
                        trimNames: true,
                        trimWrongNames: true,
                    });
                } else {
                    finalResponse = rawText;
                }
            } else if (typeof context.extractMessageFromData === 'function' && typeof context.cleanUpMessage === 'function') {
                const rawText = context.extractMessageFromData(responseData, api || context.main_api);
                finalResponse = context.cleanUpMessage({
                    getMessage: rawText,
                    isImpersonate: false,
                    isContinue: false,
                    displayIncompleteSentences: true,
                    includeUserPromptBias: false,
                    trimNames: true,
                    trimWrongNames: true,
                });
            } else {
                finalResponse = responseData?.choices?.[0]?.message?.content || responseData?.choices?.[0]?.text || String(responseData);
            }
            break;
        }

        if (finalResponse) return finalResponse;
        return "(Generation returned empty)";

    } catch (err) {
        if (err.message === 'Aborted') throw err;
        if (err.message === 'Loop detected') throw err;

        // Parse deep SillyTavern/API error responses if available
        let errorDetail = err.message || 'Unknown error';
        if (err.response) {
            try {
                const parsed = typeof err.response === 'string' ? JSON.parse(err.response) : err.response;
                errorDetail = parsed.error?.message || parsed.message || JSON.stringify(parsed);
            } catch (e) {
                errorDetail = err.response;
            }
        }

        logger.error('Generation failed:', errorDetail, err);
        throw new Error(errorDetail);
    }
}

/**
 * Internal helper: runs the non-streaming generation path with timeout/abort racing.
 * Extracted to avoid code duplication between the streaming fallback and non-streaming branch.
 */
async function _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs) {
    const apiPromise = generateViaApi(messages, tools, tool_choice);

    const abortPromise = signal ? new Promise((_, reject) => {
        if (signal.aborted) reject(new Error('Aborted'));
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }) : null;

    if (timeoutMs > 0) {
        const raceArr = [
            apiPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
        ];
        if (abortPromise) raceArr.push(abortPromise);
        return await Promise.race(raceArr);
    } else {
        return await (abortPromise ? Promise.race([apiPromise, abortPromise]) : apiPromise);
    }
}
