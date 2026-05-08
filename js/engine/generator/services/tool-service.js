import { logger } from '../../../logger.js';
import { isChatCompletionApi } from '../../../compat-chat.js';
import { getToolCallingModule } from '../../../compat-st.js';

/**
 * Initializes and returns the SillyTavern ToolManager.
 */
export async function getToolManager(allowTools) {
    try {
        const tmModule = await getToolCallingModule();
        const ToolManager = tmModule?.ToolManager;
        if (!ToolManager && allowTools) {
            logger.warn('SillyTavern ToolManager not found. Tool calling features will be disabled for this generation.');
        }
        return ToolManager;
    } catch (e) {
        logger.error('Failed to load SillyTavern ToolManager:', e);
        return null;
    }
}

/**
 * Registers tools with SillyTavern and Polyceph listeners.
 */
export async function registerTools(ToolManager, api, messages) {
    const context = SillyTavern.getContext();
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

    return {
        tools: generateData.tools,
        tool_choice: generateData.tool_choice
    };
}
