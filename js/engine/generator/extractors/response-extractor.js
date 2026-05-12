import { extractToolCalls } from '../../tool-handler.js';

/**
 * Extracts reasoning and tool calls from the API response.
 */
export function extractResponseDetails(responseData) {
    const assistantMessage = responseData?.choices?.[0]?.message;
    let reasoning = assistantMessage?.reasoning_content || assistantMessage?.reasoning || '';
    
    // Extract from reasoning_details if present (common in OpenRouter/Gemini)
    if (!reasoning && Array.isArray(assistantMessage?.reasoning_details)) {
        reasoning = assistantMessage.reasoning_details
            .map(rd => rd.reasoning || rd.text || rd.data || '')
            .join('\n');
    } else if (!reasoning && Array.isArray(responseData?.reasoning_details)) {
        reasoning = responseData.reasoning_details
            .map(rd => rd.reasoning || rd.text || rd.data || '')
            .join('\n');
    }

    const toolCalls = extractToolCalls(responseData);
    
    return { reasoning, toolCalls };
}

/**
 * Extracts the raw message text from the response data.
 */
export function extractRawText(responseData, api) {
    const context = SillyTavern.getContext();
    
    if (responseData?._streaming) {
        // Streaming path: text is already extracted in choices
        return responseData.choices?.[0]?.message?.content || '';
    }

    // Non-streaming path: extract message from data using ST helpers
    let rawText = '';
    if (typeof context.extractMessageFromData === 'function') {
        rawText = context.extractMessageFromData(responseData, api || context.main_api);
    }

    // Fallback extraction
    if (typeof rawText !== 'string' || !rawText) {
        rawText = responseData?.choices?.[0]?.message?.content || responseData?.choices?.[0]?.text || '';
    }

    return rawText;
}
