import { logger } from '../../logger.js';
import { DEFAULT_TOOL_RECURSION_LIMIT } from '../../constants.js';
import { settings } from '../../state.js';
import { waitForApiReady } from '../../utils.js';
import { parsePromptToMessages } from '../parser.js';
import { executeToolCallsParallel } from '../tool-handler.js';

import { validateTokenBudget } from './token-budget.js';
import { getToolManager, registerTools } from './services/tool-service.js';
import { executeGeneration } from './api-client.js';
import { extractResponseDetails, extractRawText } from './extractors/response-extractor.js';
import { cleanMessage } from './message-cleaner.js';
import { reconstructOutput } from './formatters/output-formatter.js';

/**
 * Executes a generation request through the SillyTavern API in "quiet" mode.
 */
export async function generateQuietly(profileName, prompt, api = '', signal = null, options = {}) {
    if (!profileName || profileName === 'none') {
        logger.debug('Template-only task detected (No LLM). Returning expanded template.');
        return prompt;
    }

    await waitForApiReady(3000);

    if (signal && signal.aborted) throw new Error('Aborted');

    const outputType = options.outputType || 'internal';
    const allowTools = options.allowTools !== false;
    const forceNoStreaming = outputType === 'tool';
    const useStreaming = !forceNoStreaming && (options.streaming !== undefined ? options.streaming : (settings.enableStreaming !== false));
    const antiLoop = options.antiLoop !== undefined ? options.antiLoop : true;
    const loopThreshold = options.loopThreshold || settings.loopDetectionThreshold || 3;
    const onStream = options.onStream || null;
    const onStatusUpdate = options.onStatusUpdate || null;

    let taskMessages = [];
    let finalResponse = "";

    try {
        const context = SillyTavern.getContext();

        // 1. Token limit check
        await validateTokenBudget(prompt);

        // 2. Initialize Tool Calling Support
        const ToolManager = await getToolManager(allowTools);
        const stCCSettings = context.chatCompletionSettings || {};
        const stRecurseLimit = stCCSettings.tool_call_recurse_limit;
        const toolReasoningMode = stCCSettings.tool_reasoning_mode || 'disabled';

        logger.debug(`Tool Reasoning Mode (Interleaved Thinking) in current preset: ${toolReasoningMode}`);

        let depth = 0;
        const maxDepth = stRecurseLimit !== undefined ? Number(stRecurseLimit) : (settings.toolRecursionLimit !== undefined ? settings.toolRecursionLimit : DEFAULT_TOOL_RECURSION_LIMIT);
        
        let anyToolError = false;
        
        // Determine default role for orphaned text (Default to system for all quiet tasks)
        const defaultRole = 'system';
        const messages = [...parsePromptToMessages(prompt, api, defaultRole)];
        
        // 3. Main Tool Recursion Loop
        const toolDisplayNames = {};
        if (ToolManager && ToolManager.tools) {
            for (const t of ToolManager.tools) {
                if (t.name && t.displayName) toolDisplayNames[t.name] = t.displayName;
            }
        }
        options.toolDisplayNames = toolDisplayNames;

        while (depth < maxDepth) {
            depth++;
            logger.info(`Starting tool recursion depth ${depth}/${maxDepth}`);

            if (signal && signal.aborted) throw new Error('Aborted');

            // --- Tool Registration ---
            let tools = null;
            let tool_choice = null;
            if (allowTools && ToolManager && typeof ToolManager.isToolCallingSupported === 'function' && ToolManager.isToolCallingSupported()) {
                const registration = await registerTools(ToolManager, api, messages);
                tools = registration.tools;
                tool_choice = registration.tool_choice;
                if (tools && tools.length > 0) logger.debug('Tools to be sent:', tools);
            }

            // --- API Call Execution ---
            const responseData = await executeGeneration(messages, tools, tool_choice, api, signal, {
                useStreaming, 
                antiLoop, 
                loopThreshold, 
                onStream, 
                depth,
                polyceph_task_id: options.polyceph_task_id,
                polyceph_task_label: options.polyceph_task_label
            });

            if (!responseData) {
                logger.warn(`Turn ${depth} returned no data.`);
                finalResponse = "(Generation returned empty)";
                break;
            }

            // --- Response Processing ---
            const { reasoning: turnReasoning, toolCalls } = extractResponseDetails(responseData);
            logger.debug(`Turn ${depth} response:`, responseData);
            if (turnReasoning) logger.debug(`Turn ${depth} reasoning found: ${turnReasoning.length} chars.`);

            // API Error Checks
            if (responseData.choices?.[0]?.finish_reason === 'error') {
                const errorDetail = responseData.choices[0].native_finish_reason || 'Unknown API Error';
                throw new Error(`API returned an error: ${errorDetail}`);
            }

            // --- Tool Execution Branch ---
            if (toolCalls && toolCalls.length > 0 && ToolManager) {
                logger.debug(`Tool calls detected (depth ${depth}):`, toolCalls);

                const assistantMessage = responseData?.choices?.[0]?.message;
                const assistantHistoryItem = {
                    role: 'assistant',
                    content: assistantMessage?.content || '',
                    tool_calls: toolCalls
                };

                if (toolReasoningMode !== 'disabled') {
                    assistantHistoryItem.reasoning_content = turnReasoning;
                    assistantHistoryItem.signature = assistantMessage?.signature || '';
                    assistantHistoryItem.toolSignatures = assistantMessage?.toolSignatures || {};
                }

                messages.push(assistantHistoryItem);
                taskMessages.push(assistantHistoryItem);

                const { results, hasErrors } = await executeToolCallsParallel(ToolManager, toolCalls);
                if (hasErrors) anyToolError = true;

                if (onStatusUpdate) {
                    onStatusUpdate('executing tools');
                }

                if (results && Array.isArray(results)) {
                    messages.push(...results);
                    taskMessages.push(...results);
                }

                depth++;
                logger.info(`Continuing generation loop: ${toolCalls.length} tool calls executed, Turn ${depth} follows.`);

                if (options.skipSuccessRecursion && !hasErrors) {
                    logger.info('skipSuccessRecursion is true and tools succeeded. Ending task early.');
                    break;
                }
                if (onStatusUpdate) {
                    onStatusUpdate('generating');
                }
                continue;
            }

            // --- Final Response Branch ---
            finalResponse = extractRawText(responseData, api);
            break;
        }

        // --- Post-Generation Logic ---
        if (anyToolError && options.outputType === 'tool') {
            logger.warn('Tool execution encountered errors in a Tool Processor task. Proceeding to reconstruct history for UI visibility.');
        }

        const finalOutput = reconstructOutput(taskMessages, finalResponse, options);
        return { text: finalOutput, isPartial: false };

    } catch (err) {
        if (err.message === 'Aborted' || err.message === 'Loop detected') throw err;

        let errorDetail = err.message || 'Unknown error';
        if (err.response) {
            try {
                const parsed = typeof err.response === 'string' ? JSON.parse(err.response) : err.response;
                errorDetail = parsed.error?.message || parsed.message || JSON.stringify(parsed);
            } catch (e) {
                errorDetail = String(err.response);
            }
        }

        logger.error('Generation failed:', errorDetail, err);
        
        if (taskMessages && taskMessages.length > 0) {
            logger.warn('Reconstructing partial history after generation failure.');
            // We reconstruct the history but DO NOT include the literal error message in the text 
            // that might be used by macros. We pass the error separately.
            const partialText = reconstructOutput(taskMessages, '', options);
            return { text: partialText, isPartial: true, error: errorDetail };
        } else {
            return { text: '', isPartial: true, error: errorDetail };
        }
    }
}
