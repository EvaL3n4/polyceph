import { logger } from '../logger.js';

/**
 * Parses raw LLM output to extract special tags like <think>, <ramble>, and <background>.
 */
export function parseOutputTags(rawOutput, taskId, profileDisplayName, isThinkingTask) {
    const thoughts = [];
    const hiddenBackgrounds = [];

    // Extract backgrounds first (always extracted)
    const backgroundRegex = /<background>([\s\S]*?)<\/background>/gi;
    let bgMatch;
    while ((bgMatch = backgroundRegex.exec(rawOutput)) !== null) {
        const content = bgMatch[1].trim();
        if (content) hiddenBackgrounds.push(content);
    }

    // Interleaved parsing for think/ramble and text
    const tokenRegex = /(<think>[\s\S]*?<\/think>|<ramble>[\s\S]*?<\/ramble>)/gi;
    const segments = rawOutput.split(tokenRegex);

    let cleanParts = [];
    let persistentParts = [];

    segments.forEach(segment => {
        if (!segment) return;

        if (segment.toLowerCase().startsWith('<think>')) {
            const content = segment.replace(/<\/?think>/gi, '').trim();
            if (content) {
                thoughts.push({ title: `Thinking`, content, isSilent: true, profile: profileDisplayName });
            }
        } else if (segment.toLowerCase().startsWith('<ramble>')) {
            const content = segment.replace(/<\/?ramble>/gi, '').trim();
            if (content) {
                thoughts.push({ title: `Rambling`, content, isSilent: true, profile: profileDisplayName });
                cleanParts.push(content);
            }
        } else {
            // Regular text (remove backgrounds from it)
            const content = segment.replace(backgroundRegex, '').trim();
            if (content) {
                cleanParts.push(content);
                persistentParts.push(content);

                // If it's a "Thinking" task, everything goes into the thoughts list in order
                if (isThinkingTask) {
                    thoughts.push({ title: taskId || `Task Output`, content, isSilent: false, profile: profileDisplayName });
                }
            }
        }
    });

    return {
        cleanOutput: cleanParts.join('\n\n').trim(),
        persistentOutput: persistentParts.join('\n\n').trim(),
        thoughts,
        hiddenBackgrounds
    };
}

/**
 * Parses a prompt string with [[ROLE:name]] tags into a SillyTavern message array.
 * Validates tag structure and warns about content outside role tags.
 */
export function parsePromptToMessages(text, api = '') {
    const messages = [];
    const roleRegex = /\[\[ROLE:(system|user|assistant|tool)(?::([^\]]+))?\]\]([\s\S]*?)\[\[\/ROLE\]\]/gi;
    let lastIndex = 0;
    let match;
    let hasRoleTags = false;
    let hasOrphanedContent = false;

    while ((match = roleRegex.exec(text)) !== null) {
        hasRoleTags = true;
        const precedingText = text.substring(lastIndex, match.index).trim();
        if (precedingText) {
            hasOrphanedContent = true;
            messages.push({ role: 'system', content: precedingText });
        }

        const role = match[1].toLowerCase();
        const toolCallId = match[2];
        let content = match[3].trim();

        const msg = { role, content };
        if (role === 'tool' && toolCallId) {
            msg.tool_call_id = toolCallId;
        }

        // Extract and remove [[INVOCATIONS:...]] tags
        const invocationRegex = /\[\[INVOCATIONS:([\s\S]*?)\]\]/gi;
        const invocations = [];
        content = content.replace(invocationRegex, (m, json) => {
            try {
                const parsed = JSON.parse(json);
                if (Array.isArray(parsed)) invocations.push(...parsed);
            } catch (e) {
                logger.warn('Failed to parse [[INVOCATIONS]] tag in prompt:', e);
            }
            return '';
        }).trim();

        if (invocations.length > 0) {
            msg.tool_calls = invocations;
        }
        msg.content = content;

        messages.push(msg);
        lastIndex = roleRegex.lastIndex;
    }

    const remainingText = text.substring(lastIndex).trim();
    if (remainingText && hasRoleTags) {
        hasOrphanedContent = true;
        messages.push({ role: 'system', content: remainingText });
    } else if (remainingText) {
        messages.push({ role: 'system', content: remainingText });
    }

    if (messages.length === 0) {
        return [{ role: 'system', content: text.trim() }];
    }

    // Validation: check for content outside role tags (only for Chat Completion)
    if (hasOrphanedContent && remainingText.trim().length > 0 && api === 'openai') {
        logger.debug("Prompt contains implicit 'system' content outside [[ROLE:...]] tags.");
    }

    // Validation: check for malformed tags that the regex didn't match
    if (hasRoleTags) {
        const openCount = (text.match(/\[\[ROLE:/gi) || []).length;
        const closeCount = (text.match(/\[\[\/ROLE\]\]/gi) || []).length;
        if (openCount !== closeCount) {
            logger.warn(`Mismatched role tags: ${openCount} opening vs ${closeCount} closing. Some content may be incorrectly assigned.`);
        }
    }

    const mergedMessages = [];
    const invocationRegex = /\[\[INVOCATIONS:([\s\S]*?)\]\]/gi;

    for (const msg of messages) {
        // Extract invocations from content
        let invocations = null;
        msg.content = msg.content.replace(invocationRegex, (match, json) => {
            try {
                invocations = JSON.parse(json);
            } catch (e) {
                logger.warn("Failed to parse encoded invocations:", e);
            }
            return ""; // Remove tag from content
        }).trim();

        const lastMsg = mergedMessages[mergedMessages.length - 1];
        if (lastMsg && lastMsg.role === msg.role) {
            lastMsg.content += '\n\n' + msg.content;
            // Merge invocations if both exist
            if (invocations) {
                lastMsg.invocations = (lastMsg.invocations || []).concat(invocations);
            }
        } else {
            if (invocations) msg.invocations = invocations;
            mergedMessages.push(msg);
        }
    }
    return mergedMessages;
}
