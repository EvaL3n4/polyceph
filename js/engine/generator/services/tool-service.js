import { logger } from '../../../logger.js';
import { isChatCompletionApi } from '../../../compat-chat.js';
import { getToolCallingModule } from '../../../compat-st.js';
import { mcpService } from './mcp-service.js';

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
export async function registerTools(ToolManager, api, messages, options = {}) {
    const context = SillyTavern.getContext();
    const isOaiCompatible = isChatCompletionApi(api);
    const isMcpTask = options.outputType === 'mcp';

    // Prepare metadata for event listeners
    const generateData = {
        model: isOaiCompatible ? (context.chatCompletionSettings?.openai_model || '') : '',
        messages: messages,
        tools: null,
        tool_choice: null,
        temperature: context.chatCompletionSettings?.temp_openai,
        max_tokens: context.chatCompletionSettings?.openai_max_tokens || context.chatCompletionSettings?.max_tokens_openai,
    };

    // 1. Native ST Tool Registration (Skipped in MCP mode to allow "replacement")
    if (!isMcpTask) {
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

        // Emit event to allow other extensions to modify native tools
        if (context.eventSource && context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) {
            await context.eventSource.emit(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generateData);
        }
    }

    // 2. MCP Tool Integration
    if (mcpService.transports.size > 0 || isMcpTask) {
        const mcpTools = await mcpService.listTools(options.mcpSources);
        if (mcpTools.length > 0) {
            generateData.tools = [...(generateData.tools || []), ...mcpTools];
            generateData.tool_choice = generateData.tool_choice || 'auto';
            logger.info(`Registered ${mcpTools.length} MCP tools (Mode: ${isMcpTask ? 'MCP Replacement' : 'Additive'}).`);
        }
    }

    return {
        tools: generateData.tools,
        tool_choice: generateData.tool_choice
    };
}
