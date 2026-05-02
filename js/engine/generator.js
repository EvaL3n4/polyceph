import { logger } from '../logger.js';
import { settings } from '../state.js';
import { waitForApiReady } from '../utils.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi } from '../compat-shared.js';
import { parsePromptToMessages } from './parser.js';

import { getToolCallingModule } from '../compat-st.js';

/**
 * Executes a generation request through the SillyTavern API in "quiet" mode.
 * This avoids the main generation UI and allows background processing.
 */
export async function generateQuietly(profileName, prompt, api = '', signal = null) {
    if (!profileName || profileName === 'none') return prompt;

    // Ensure API is ready and settled before starting generation
    await waitForApiReady(3000);

    if (signal && signal.aborted) throw new Error('Aborted');

    try {
        const context = SillyTavern.getContext();

        // --- Compatibility: Token limit check ---
        const maxPromptTokens = getMaxContextTokens() - getMaxResponseTokens();
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
                logger.warn('[Polyceph] SillyTavern ToolManager not found. Tool calling features will be disabled for this generation.');
            }
        } catch (e) {
            logger.error('[Polyceph] Failed to load SillyTavern ToolManager:', e);
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

            const apiPromise = generateViaApi(messages, tools, tool_choice);
            const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

            const abortPromise = signal ? new Promise((_, reject) => {
                if (signal.aborted) reject(new Error('Aborted'));
                signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
            }) : null;

            let responseData;
            if (timeoutMs > 0) {
                const raceArr = [
                    apiPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
                ];
                if (abortPromise) raceArr.push(abortPromise);
                responseData = await Promise.race(raceArr);
            } else {
                responseData = await (abortPromise ? Promise.race([apiPromise, abortPromise]) : apiPromise);
            }

            if (!responseData) {
                finalResponse = "(Generation returned empty)";
                break;
            }

            // Extract tool calls from response
            // ST's generateRawData returns the raw API response
            const toolCalls = responseData?.choices?.[0]?.message?.tool_calls || responseData?.tool_calls;

            if (toolCalls && toolCalls.length > 0 && ToolManager) {
                logger.debug(`[Polyceph] Tool calls detected (depth ${depth}):`, toolCalls);
                
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
            if (typeof context.extractMessageFromData === 'function' && typeof context.cleanUpMessage === 'function') {
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
        
        // Parse deep SillyTavern/API error responses if available
        let errorDetail = err.message;
        if (err.response) {
            try {
                const parsed = JSON.parse(err.response);
                errorDetail = parsed.error?.message || parsed.message || err.response;
            } catch (e) {
                errorDetail = err.response;
            }
        }
        
        logger.error('[Polyceph] Generation failed:', errorDetail);
        throw new Error(errorDetail);
    }
}
