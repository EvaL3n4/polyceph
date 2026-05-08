import { logger } from '../../logger.js';
import { getMaxContextTokens, getMaxResponseTokens, countTokens } from '../../compat-shared.js';

/**
 * Validates if the prompt fits within the context budget.
 */
export async function validateTokenBudget(prompt) {
    const maxContext = await getMaxContextTokens();
    const maxResponse = getMaxResponseTokens();
    const maxPromptTokens = maxContext - maxResponse;

    const promptTokens = await countTokens(prompt);
    if (promptTokens > maxPromptTokens) {
        const errorMsg = `Prompt (${promptTokens} tokens) exceeds context budget (${maxPromptTokens} tokens). Generation aborted for safety.`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }
    
    return { promptTokens, maxPromptTokens };
}
