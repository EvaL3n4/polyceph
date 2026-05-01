import { logger } from '../logger.js';
import { settings } from '../state.js';
import { waitForApiReady } from '../utils.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens, generateViaApi } from '../compat-shared.js';
import { parsePromptToMessages } from './parser.js';

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
            logger.warn(`Prompt (${promptTokens} tokens) exceeds max prompt budget (${maxPromptTokens} tokens). Generation may be truncated by the API.`);
        }

        let responseData = "";

        // Parse prompt into role-based messages
        const messages = parsePromptToMessages(prompt, api);

        // --- Tool Calling Support ---
        let tools = null;
        let tool_choice = null;

        try {
            // Attempt to import ToolManager dynamically to avoid breaking if not present
            let ToolManager;
            try {
                const tmModule = await import('../../../tool-calling.js');
                ToolManager = tmModule.ToolManager;
            } catch (e) {
                // Fallback or ignore if SillyTavern version is too old for tools
            }

            if (ToolManager && typeof ToolManager.isToolCallingSupported === 'function' && ToolManager.isToolCallingSupported()) {
                tools = ToolManager.getFunctionTools();
                tool_choice = (tools && tools.length > 0) ? 'auto' : null;

                if (tools && tools.length > 0) {
                    // Emit CHAT_COMPLETION_SETTINGS_READY so extensions like TunnelVision 
                    // can perform late-stage modifications (like Anthropic conversion).
                    if (context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
                        const generateData = {
                            model: api === 'openai' ? (context.chatCompletionSettings?.openai_model || '') : '',
                            tools: tools,
                            tool_choice: tool_choice
                        };
                        await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generateData);
                        
                        // Use the modified tools/choice from extensions
                        tools = generateData.tools;
                        tool_choice = generateData.tool_choice;
                    }
                }
            }
        } catch (err) {
            logger.warn('Failed to resolve tools for generation:', err);
        }

        const apiPromise = generateViaApi(messages, tools, tool_choice);

        const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

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

            responseData = await Promise.race(raceArr);
        } else {
            responseData = await (abortPromise ? Promise.race([apiPromise, abortPromise]) : apiPromise);
        }

        if (responseData) return responseData;
        return "(Generation returned empty)";
    } catch (err) {
        logger.error('generation failed:', err);
        return "(Error during generation)";
    }
}
