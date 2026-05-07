import { logger } from '../logger.js';

/**
 * Extracts tool calls from various LLM API response formats.
 * Supports OpenAI, Anthropic (Claude), and Google (Gemini) formats as returned by ST's generateRawData.
 */
export function extractToolCalls(data) {
    if (!data) return [];

    // 1. Standard OpenAI format (non-streaming)
    if (data.choices?.[0]?.message?.tool_calls) {
        return data.choices[0].message.tool_calls;
    }

    // 2. ST streaming-accumulated format
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
 * Executes multiple tool calls in parallel using the provided ToolManager.
 * Returns an array of message objects compatible with the chat history.
 */
export async function executeToolCallsParallel(ToolManager, toolCalls) {
    if (!ToolManager || !Array.isArray(toolCalls) || toolCalls.length === 0) {
        return [];
    }

    logger.debug(`Executing ${toolCalls.length} tool calls in parallel...`);

    let hasErrors = false;
    const results = await Promise.all(toolCalls.map(async (tc) => {
        const name = tc.function.name;
        const parameters = tc.function.arguments;
        const id = tc.id;

        try {
            logger.info(`[Tool] Executing: ${name}`, { id, parameters });
            const output = await ToolManager.invokeFunctionTool(name, parameters);
            
            logger.debug(`[Tool] Result for ${name} (${id}):`, output);

            // Return tool role message
            return {
                role: 'tool',
                tool_call_id: id,
                name: name,
                content: typeof output === 'string' ? output : JSON.stringify(output)
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
