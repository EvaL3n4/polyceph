import { logger } from '../logger.js';
import { DEFAULT_TOOL_RECURSION_LIMIT } from '../constants.js';
import { settings, getCapturedPresetName } from '../state.js';
import { waitForApiReady } from '../utils.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, getActiveApi } from '../compat-shared.js';
import { generateViaCC, generateViaCCStreaming, isChatCompletionApi } from '../compat-chat.js';
import { parsePromptToMessages } from './parser.js';
import { LoopDetector } from './loop-detector.js';
import { extractToolCalls, executeToolCallsParallel } from './tool-handler.js';

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
    if (!profileName || profileName === 'none') {
        logger.debug('Template-only task detected (No LLM). Returning expanded template.');
        return prompt;
    }

    // Ensure API is ready and settled before starting generation
    // We only wait if we are actually calling an LLM
    await waitForApiReady(3000);

    if (signal && signal.aborted) throw new Error('Aborted');

    // Resolve streaming options from settings + overrides
    const outputType = options.outputType || 'internal';
    const allowTools = options.allowTools !== false;

    // Force non-streaming for tool-heavy tasks per requirement
    const forceNoStreaming = outputType === 'tool';
    const useStreaming = !forceNoStreaming && (options.streaming !== undefined ? options.streaming : (settings.enableStreaming !== false));

    const antiLoop = options.antiLoop !== undefined ? options.antiLoop : true;
    const loopThreshold = options.loopThreshold || settings.loopDetectionThreshold || 3;
    const onStream = options.onStream || null;
    const skipSuccessRecursion = !!options.skipSuccessRecursion;
    const hideSuccessResponse = !!options.hideSuccessResponse;

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
            if (!ToolManager && allowTools) {
                logger.warn('SillyTavern ToolManager not found. Tool calling features will be disabled for this generation.');
            }
        } catch (e) {
            logger.error('Failed to load SillyTavern ToolManager:', e);
        }

        const stCCSettings = context.chatCompletionSettings || {};
        const stRecurseLimit = stCCSettings.tool_call_recurse_limit;
        const interleavedThinking = stCCSettings.interleaved_thinking;
        
        if (interleavedThinking !== undefined) {
            logger.debug(`Interleaved Thinking status in current preset: ${interleavedThinking}`);
        }

        let depth = 0;
        // Priority: 1. ST Preset Limit, 2. Existing Polyceph Setting (legacy), 3. Constant Fallback
        const maxDepth = stRecurseLimit !== undefined ? Number(stRecurseLimit) : (settings.toolRecursionLimit !== undefined ? settings.toolRecursionLimit : DEFAULT_TOOL_RECURSION_LIMIT);
        let finalResponse = "";
        let anyToolError = false;

        while (depth < maxDepth) {
            if (signal && signal.aborted) throw new Error('Aborted');

            let tools = null;
            let tool_choice = null;

            // Only request tools if allowed for this task
            if (allowTools && ToolManager && typeof ToolManager.isToolCallingSupported === 'function' && ToolManager.isToolCallingSupported()) {
                const isOaiCompatible = isChatCompletionApi(api);

                // Prepare metadata for event listeners
                const generateData = {
                    model: isOaiCompatible ? (context.chatCompletionSettings?.openai_model || '') : '',
                    messages: messages,
                    tools: null,
                    tool_choice: null,
                    temperature: context.chatCompletionSettings?.temp_openai,
                    max_tokens: context.chatCompletionSettings?.openai_max_tokens || context.chatCompletionSettings?.max_tokens_openai,
                };

                // Use native ST registration if available (most robust)
                if (typeof ToolManager.registerFunctionToolsOpenAI === 'function') {
                    await ToolManager.registerFunctionToolsOpenAI(generateData);
                } else {
                    // Fallback: Manual collection
                    const availableTools = [];
                    for (const tool of (ToolManager.tools || [])) {
                        try {
                            if (typeof tool.shouldRegister === 'function' ? await tool.shouldRegister() : true) {
                                const toolDef = typeof tool.toFunctionOpenAI === 'function' ? tool.toFunctionOpenAI() : tool;
                                if (toolDef) availableTools.push(toolDef);
                            }
                        } catch (e) {
                            logger.warn('Failed to process tool definition:', tool, e);
                        }
                    }
                    if (availableTools.length > 0) {
                        generateData.tools = availableTools;
                        generateData.tool_choice = 'auto';
                    }
                }

                // Emit event to allow other extensions (like specialized tool managers) to modify
                if (context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
                    await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generateData);
                }

                tools = generateData.tools;
                tool_choice = generateData.tool_choice;

                if (tools && tools.length > 0) {
                    logger.debug('Tools to be sent:', JSON.stringify(tools, null, 2));
                }
            }

            // --- Determine whether to use streaming or non-streaming ---
            const canStream = useStreaming && isChatCompletionApi(api);
            let loopDetector = null;

            if (canStream && antiLoop) {
                loopDetector = new LoopDetector(loopThreshold);
            }

            let responseData;
            const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

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

                const streamingPromise = generateViaCCStreaming(messages, signal, streamingChunkHandler, tools, tool_choice, api);

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
                // ========== NON-STREAMING PATH ==========
                logger.debug(`Streaming disabled or unsupported for API: ${api}. Using non-streaming generation path.`);
                responseData = await _generateNonStreaming(messages, tools, tool_choice, signal, timeoutMs);
            }

            if (!responseData) {
                logger.warn(`Turn ${depth} returned no data.`);
                finalResponse = "(Generation returned empty)";
                break;
            }

            logger.debug(`Turn ${depth} response:`, responseData);

            // Extract tool calls from response
            const toolCalls = extractToolCalls(responseData);

            // Check for API-level errors in choices
            if (responseData.choices?.[0]?.finish_reason === 'error') {
                const errorDetail = responseData.choices[0].native_finish_reason || 'Unknown API Error';
                throw new Error(`API returned an error: ${errorDetail}`);
            }

            if (toolCalls && toolCalls.length > 0 && ToolManager) {
                logger.debug(`Tool calls detected (depth ${depth}):`, toolCalls);

                // 1. Add assistant message with tool calls to history
                messages.push({
                    role: 'assistant',
                    content: responseData?.choices?.[0]?.message?.content || '',
                    tool_calls: toolCalls
                });

                // 2. Execute tools in parallel
                const { results, hasErrors } = await executeToolCallsParallel(ToolManager, toolCalls);
                if (hasErrors) anyToolError = true;

                // 3. Add tool results to history
                if (results && Array.isArray(results)) {
                    messages.push(...results);
                }

                depth++;
                logger.info(`Continuing generation loop: ${toolCalls.length} tool calls executed, Turn ${depth} follows.`);

                // If "No Success Recursion" is enabled and all tools succeeded, we can stop here
                if (options.skipSuccessRecursion && !hasErrors) {
                    logger.info('skipSuccessRecursion is true and tools succeeded. Ending task early.');
                    // Return empty if success response is hidden, otherwise return a status
                    finalResponse = options.hideSuccessResponse ? '' : 'Tools executed successfully, see console "[polyceph] [Tool]" debug logs for details.\nFor generated output following tool success, disable "No Success Recursion" in the Task settings in your pipeline.\nTo hide this message, which appears in place of the generated success response, enable "Hide Success Response".';
                    break;
                }

                continue; // Loop again with tool results
            }

            // No more tool calls, clean up and return
            if (responseData?._streaming) {
                // Streaming path: text is already extracted
                const rawText = responseData.choices?.[0]?.message?.content || '';
                if (typeof context.cleanUpMessage === 'function') {
                    finalResponse = context.cleanUpMessage({
                        getMessage: String(rawText),
                        isImpersonate: false,
                        isContinue: false,
                        displayIncompleteSentences: true,
                        includeUserPromptBias: false,
                        trimNames: true,
                        trimWrongNames: true,
                    });
                } else {
                    finalResponse = String(rawText);
                }
            } else {
                // Non-streaming path: extract message from data
                let rawText = '';
                if (typeof context.extractMessageFromData === 'function') {
                    rawText = context.extractMessageFromData(responseData, api || context.main_api);
                }

                // Fallback extraction if extractMessageFromData fails or returns something non-string
                if (typeof rawText !== 'string' || !rawText) {
                    rawText = responseData?.choices?.[0]?.message?.content || responseData?.choices?.[0]?.text || '';
                }

                if (typeof context.cleanUpMessage === 'function') {
                    finalResponse = context.cleanUpMessage({
                        getMessage: String(rawText),
                        isImpersonate: false,
                        isContinue: false,
                        displayIncompleteSentences: true,
                        includeUserPromptBias: false,
                        trimNames: true,
                        trimWrongNames: true,
                    });
                } else {
                    finalResponse = String(rawText);
                }
            }
            break;
        }

        logger.debug('Generation loop finished. Final Response length:', finalResponse?.length || 0);

        // --- Success Enforcement ---
        // If tools were enabled and any failed, and we are in a strict mode, abort.
        // For now, we'll log it. If outputType is 'tool', success is critical.
        if (anyToolError && outputType === 'tool') {
            logger.warn('Tool execution encountered errors in a Tool Processor task.');
            return "(Error during tool execution)";
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
    const apiPromise = generateViaCC(messages, tools, tool_choice);

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
