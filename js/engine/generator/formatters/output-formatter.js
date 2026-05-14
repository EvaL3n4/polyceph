import { logger } from '../../../logger.js';
import { encodeInvocations } from '../../../macros/utils.js';
import { getToolDisplayName } from '../../tool-handler.js';

/**
 * Reconstructs the final output string from the accumulated task messages.
 */
export function reconstructOutput(taskMessages, finalResponse, options) {
    if (options.hideSuccessResponse) {
        return '';
    }

    if (options.hideToolHistory) {
        return _formatHiddenToolHistory(taskMessages, finalResponse, options);
    } else {
        return _formatFullToolHistory(taskMessages, finalResponse, options);
    }
}

function _formatHiddenToolHistory(taskMessages, finalResponse, options) {
    // Only send the "success object" (last turn's results or final response)
    if (options.skipSuccessRecursion) {
        const lastToolResults = taskMessages.filter(m => m.role === 'tool');
        if (lastToolResults.length > 0) {
            return lastToolResults.map(res => `[[ROLE:tool:${res.tool_call_id}]]\n${res.content}\n[[/ROLE]]`).join('\n\n');
        }
    }

    let accumulatedReasoning = '';
    let accumulatedContent = '';

    for (const m of taskMessages) {
        if (m.role === 'assistant') {
            if (m.reasoning_content) {
                accumulatedReasoning += (accumulatedReasoning ? '\n' : '') + m.reasoning_content;
            }
            if (m.content) {
                accumulatedContent += (accumulatedContent ? '\n\n' : '') + m.content;
            }
        }
    }

    const finalResult = (accumulatedContent ? (accumulatedContent + '\n\n') : '') + (finalResponse || '');

    if (finalResult.trim() || accumulatedReasoning.trim()) {
        let output = `[[ROLE:assistant]]\n`;
        if (accumulatedReasoning) {
            output += `<think>\n${accumulatedReasoning}\n</think>\n\n`;
        }
        output += finalResult.trim();

        // Inject all tool calls
        for (const m of taskMessages) {
            if (m.role === 'assistant' && m.tool_calls) {
                for (const tc of m.tool_calls) {
                    const resultMsg = taskMessages.find(rm => rm.role === 'tool' && rm.tool_call_id === tc.id);
                    const result = resultMsg ? resultMsg.content : '(No result found)';
                    const dispName = getToolDisplayName(tc.function.name);
                    output += `\n\n<tool_call name="${tc.function.name}" displayName="${dispName}" args='${tc.function.arguments}'>\n${result}\n</tool_call>`;
                }
            }
        }
        return output + `\n[[/ROLE]]`;
    }
    
    return "(Generation returned empty)";
}

function _formatFullToolHistory(taskMessages, finalResponse, options = {}) {
    let parts = [];

    if (taskMessages.length > 0) {
        parts = taskMessages.map(m => {
            const role = m.role;
            const roleSuffix = (role === 'tool' && m.tool_call_id) ? `:${m.tool_call_id}` : '';
            let content = m.content || '';

            if (role === 'assistant' && m.reasoning_content) {
                content = `<think>\n${m.reasoning_content}\n</think>\n\n${content}`;
            }

            if (role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                for (const tc of m.tool_calls) {
                    const resultMsg = taskMessages.find(rm => rm.role === 'tool' && rm.tool_call_id === tc.id);
                    const result = resultMsg ? resultMsg.content : '(No result found)';
                    const dispName = getToolDisplayName(tc.function.name);
                    content += `\n\n<tool_call name="${tc.function.name}" displayName="${dispName}" args='${tc.function.arguments}'>\n${result}\n</tool_call>`;
                }
                if (m.tool_calls && Array.isArray(m.tool_calls)) {
                    content += `\n[[INVOCATIONS:${encodeInvocations(m.tool_calls)}]]`;
                }
            }
            return `[[ROLE:${role}${roleSuffix}]]\n${content.trim()}\n[[/ROLE]]`;
        });
    }
    
    if (finalResponse && finalResponse.trim()) {
        parts.push(`[[ROLE:assistant]]\n${finalResponse.trim()}\n[[/ROLE]]`);
    }

    if (parts.length > 0) {
        return parts.join('\n\n');
    }
    
    return "(Generation returned empty)";
}
