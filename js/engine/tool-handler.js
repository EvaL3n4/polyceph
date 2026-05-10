import { logger } from '../logger.js';
import { mcpService } from './generator/services/mcp-service.js';

/**
 * Extracts tool calls from various LLM API response formats.
 * Supports OpenAI, Anthropic (Claude), and Google (Gemini) formats as returned by ST's generateRawData.
 */
export function extractToolCalls(data) {
    if (!data) return [];

    // 1. Standard OpenAI format (non-streaming or accumulated)
    if (data.choices?.[0]?.message?.tool_calls) {
        return data.choices[0].message.tool_calls;
    }

    // 3. Anthropic (Claude) format
    if (Array.isArray(data.content)) {
        return data.content
            .filter(c => c.type === 'tool_use')
            .map(c => ({
                id: c.id,
                function: {
                    name: c.name,
                    arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input)
                }
            }));
    }

    // 4. Google (Gemini) format
    if (Array.isArray(data.responseContent?.parts)) {
        return data.responseContent.parts
            .filter(p => p.functionCall)
            .map(p => ({
                id: `gemini-${Math.random().toString(36).substring(2, 9)}`,
                function: {
                    name: p.functionCall.name,
                    arguments: JSON.stringify(p.functionCall.args)
                }
            }));
    }

    // 5. Fallback for raw tool_calls at top level (some providers)
    if (Array.isArray(data.tool_calls)) {
        return data.tool_calls;
    }

    return [];
}

/**
 * Heuristically detects if a tool's output indicates a logical failure.
 * Matches the status pill logic in the UI.
 */
function isToolOutputError(output) {
    if (!output) return false;
    if (output instanceof Error) return true;
    let data = output;

    if (typeof output === 'string') {
        const trimmed = output.trim();
        const lower = trimmed.toLowerCase();

        // 1. Direct string error markers
        if (lower.startsWith('error:') ||
            lower.startsWith('failure:') ||
            lower.startsWith('exception:')) {
            return true;
        }

        // 2. Try JSON parsing if it looks like an object/array
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                data = JSON.parse(trimmed);
            } catch (e) {
                // If it fails to parse, it's just a regular string which we already checked for error markers
                return false;
            }
        } else {
            // It's a plain string that didn't match our error markers
            return false;
        }
    }

    // 3. Object/Array analysis
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;

    const statusKeys = ['status', 'success', 'ok', 'error', 'errors'];
    const keys = Object.keys(data);
    for (const key of keys) {
        const kLower = key.toLowerCase();
        if (statusKeys.includes(kLower)) {
            const val = data[key];
            if (kLower === 'error' || kLower === 'errors') {
                // Error field: true, non-empty string, or non-empty list is an error
                if (val === true || (typeof val === 'string' && val.trim() !== '' && val !== 'false' && val !== '[]' && val !== 'none')) return true;
                if (Array.isArray(val) && val.length > 0) return true;
            } else {
                // Status/Success/Ok field: false, "error", "fail" is an error
                const isOk = (val === true || String(val).toLowerCase() === 'ok' || String(val).toLowerCase() === 'success' || String(val).toLowerCase() === 'true');
                if (!isOk) return true;
            }
        }
    }
    return false;
}

/**
 * Executes multiple tool calls in parallel using the provided ToolManager.
 * Returns an array of message objects compatible with the chat history.
 */
export async function executeToolCallsParallel(ToolManager, toolCalls) {
    if (!ToolManager || !Array.isArray(toolCalls) || toolCalls.length === 0) {
        return { results: [], hasErrors: false };
    }

    logger.debug(`Executing ${toolCalls.length} tool calls in parallel...`);

    let hasErrors = false;
    const results = await Promise.all(toolCalls.map(async (tc) => {
        const name = tc.function.name;
        const parameters = tc.function.arguments;
        const id = tc.id;

        try {
            const paramType = typeof parameters;
            logger.info(`[Tool] Executing: ${name}`, { id, paramType });
            if (paramType === 'string') {
                logger.debug(`[Tool] Raw arguments for ${name}:`, parameters.substring(0, 200) + (parameters.length > 200 ? '...' : ''));
            }

            let output;
            if (name.startsWith('mcp__')) {
                output = await mcpService.callTool(name, parameters);
            } else {
                output = await ToolManager.invokeFunctionTool(name, parameters);
            }

            logger.debug(`[Tool] Result for ${name} (${id}):`, typeof output === 'object' ? JSON.stringify(output).substring(0, 200) : String(output).substring(0, 200));

            // Check for logical errors in the output to control recursion
            if (isToolOutputError(output)) {
                logger.warn(`[Tool] Logical error detected in result for ${name} (${id})`);
                hasErrors = true;
            }

            // Return tool role message
            let content = typeof output === 'string' ? output : JSON.stringify(output);
            if (output instanceof Error) {
                content = output.toString();
            }

            return {
                role: 'tool',
                tool_call_id: id,
                name: name,
                content
            };
        } catch (err) {
            logger.error(`[Tool] Failed to execute ${name} (${id}):`, err);
            hasErrors = true;
            return {
                role: 'tool',
                tool_call_id: id,
                name: name,
                content: `Error: ${err.message}`
            };
        }
    }));

    logger.debug(`[Tool] Finished parallel execution of ${toolCalls.length} tools. hasErrors=${hasErrors}`);
    return { results, hasErrors };
}

/**
 * Resolves a tool's internal API name to its human-readable display name.
 * Checks both MCP tool mapping and native SillyTavern ToolManager.
 * @param {string} name - Internal API name of the tool.
 * @returns {string} Human-readable display name.
 */
export function getToolDisplayName(name) {
    if (!name) return 'Unknown Tool';

    // 1. Check MCP mapping first (includes original ST tools proxied via MCP)
    const mcpMapping = mcpService.currentToolMapping?.get(name);
    if (mcpMapping?.displayName) {
        logger.debug(`[Tool] Resolved ${name} via MCP mapping: ${mcpMapping.displayName}`);
        return mcpMapping.displayName;
    }

    // 2. Check native SillyTavern ToolManager
    try {
        const context = SillyTavern.getContext();
        const tools = context.ToolManager?.tools || [];
        
        // Find tool by name (checking both standard and private-backed field patterns if necessary)
        const nativeTool = tools.find(t => {
            const tName = t.name || t._name; // standard or common underscore prefix
            return tName === name;
        });

        if (nativeTool) {
            // Prefer displayName, then name, then _displayName
            const dName = nativeTool.displayName || nativeTool._displayName || nativeTool.name || nativeTool._name;
            if (dName) {
                logger.debug(`[Tool] Resolved ${name} via ST ToolManager: ${dName}`);
                return dName;
            }
        }
    } catch (e) {
        logger.debug(`[Tool] Failed to access ST ToolManager for ${name}`, e);
    }

    // Fallback: cleaning up the name for a nicer look
    const fallback = name
        .replace(/^mcp__.*?__/i, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    
    logger.debug(`[Tool] No display name found for ${name}, using fallback: ${fallback}. MCP Mapping size: ${mcpService.currentToolMapping?.size || 0}`);
    return fallback;
}

