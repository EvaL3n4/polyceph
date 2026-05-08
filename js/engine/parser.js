import { logger } from '../logger.js';
import { decodeInvocations } from '../macros/utils.js';

/**
 * Parses raw LLM output to extract special tags like <think>, <ramble>, and <background>.
 */
export function parseOutputTags(rawOutput, taskId, profileDisplayName, isThinkingTask) {
    const thoughts = [];
    const hiddenBackgrounds = [];
    let cleanParts = [];
    let persistentParts = [];

    // 1. Detect if we have role-tagged turn history (recursion)
    const roleRegex = /\[\[ROLE:(system|user|assistant|tool)(?::([^\]]+))?\]\]([\s\S]*?)\[\[\/ROLE\]\]/gi;
    const turns = [];
    let match;
    let lastIndex = 0;

    while ((match = roleRegex.exec(rawOutput)) !== null) {
        turns.push({
            role: match[1],
            id: match[2] || null,
            content: match[3].trim()
        });
        lastIndex = roleRegex.lastIndex;
    }

    // If no role tags found, treat the whole thing as one assistant turn
    if (turns.length === 0) {
        turns.push({ role: 'assistant', id: null, content: rawOutput.trim() });
    }

    // 2. Process each turn
    let recursionIndex = 0;
    for (const turn of turns) {
        if (turn.role === 'assistant') recursionIndex++;

        const turnLabel = turn.role === 'assistant' ? `Recursion ${recursionIndex}` : 'Turn';
        const turnContent = turn.content;

        // 2a. Skip tool results in thoughts (they are already interleaved in assistant turns)
        if (turn.role === 'tool') continue;

        // Extract backgrounds (always extracted globally)
        const backgroundRegex = /<background>([\s\S]*?)<\/background>/gi;
        const invocationRegex = /\[\[INVOCATIONS:([\s\S]*?)\]\]/gi;
        let bgMatch;
        while ((bgMatch = backgroundRegex.exec(turnContent)) !== null) {
            const content = bgMatch[1].trim();
            if (content) hiddenBackgrounds.push(content);
        }

        // Interleaved parsing for think/ramble, tool calls, and text
        const tokenRegex = /(<think>[\s\S]*?<\/think>|<ramble>[\s\S]*?<\/ramble>|<tool_call[\s\S]*?<\/tool_call>)/gi;
        const segments = turnContent.split(tokenRegex);

        segments.forEach(segment => {
            if (!segment) return;

            if (segment.toLowerCase().startsWith('<think>')) {
                const content = segment.replace(/<\/?think>/gi, '').trim();
                if (content) {
                    thoughts.push({ title: `Thinking (${turnLabel})`, content, isSilent: true, profile: profileDisplayName, turnIndex: recursionIndex });
                }
            } else if (segment.toLowerCase().startsWith('<ramble>')) {
                const content = segment.replace(/<\/?ramble>/gi, '').trim();
                if (content) {
                    thoughts.push({ title: `Rambling (${turnLabel})`, content, isSilent: true, profile: profileDisplayName, turnIndex: recursionIndex });
                    cleanParts.push(content);
                }
            } else if (segment.toLowerCase().startsWith('<tool_call')) {
                const nameMatch = segment.match(/name="([^"]+)"/i);
                const argsMatch = segment.match(/args='([^']+)'/i);
                const name = nameMatch ? nameMatch[1] : 'Unknown Tool';
                const args = argsMatch ? argsMatch[1] : '';
                const response = segment.replace(/<tool_call[\s\S]*?>/i, '').replace(/<\/tool_call>/i, '').trim();

                thoughts.push({
                    title: `Tool: ${name}`,
                    content: { args, response },
                    type: 'tool',
                    isSilent: true,
                    profile: profileDisplayName,
                    turnIndex: recursionIndex
                });
            } else {
                // Regular text (remove backgrounds and invocations)
                const content = segment.replace(backgroundRegex, '').replace(invocationRegex, '').trim();
                if (content) {
                    cleanParts.push(content);
                    persistentParts.push(content);

                    // If it's a "Thinking" task, or if we have multiple turns, add to thoughts list
                    if (isThinkingTask || turns.length > 1) {
                        thoughts.push({ title: turnLabel, content, isSilent: false, profile: profileDisplayName, turnIndex: recursionIndex });
                    }
                }
            }
        });
    }

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
        content = content.replace(invocationRegex, (m, hex) => {
            const parsed = decodeInvocations(hex);
            if (parsed && Array.isArray(parsed)) invocations.push(...parsed);
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
        msg.content = msg.content.replace(invocationRegex, (match, hex) => {
            invocations = decodeInvocations(hex);
            return ""; // Remove tag from content
        }).trim();

        const lastMsg = mergedMessages[mergedMessages.length - 1];
        if (lastMsg && lastMsg.role === msg.role && msg.role !== 'tool') {
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
