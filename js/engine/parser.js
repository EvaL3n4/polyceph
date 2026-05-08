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
                const nameMatch = segment.match(/name="([\s\S]+?)"/i);
                const argsMatch = segment.match(/args='([\s\S]+)'\s*>/i);
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

                // Include tool results in clean output for use in macros and task chaining
                if (response) {
                    cleanParts.push(response);
                    persistentParts.push(response);
                }
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
 * Parses a prompt string with [[user]], [[system]], [[assistant]], [[tool]] tags into a SillyTavern message array.
 * Supports both divider style (lasts until next tag) and enclosure style (ends with [[/]]).
 * Manual tags are forcing by default (ignore internal role tags in macros).
 * Use [[role?]] for permissive mode.
 *
 * @param {string} text - The raw prompt text.
 * @param {string} api - The target API (e.g. 'openai').
 * @param {string} defaultRole - The role to assign to text outside explicit tags (default: 'system').
 * @returns {object[]} Array of {role, content, name?, tool_call_id?} message objects.
 */
export function parsePromptToMessages(text, api = '', defaultRole = 'system') {
    const messages = [];
    
    // Combined regex for start tags, end tags, and shorthands
    // Group 1: Optional escape backslash
    // Group 2: Role name, Group 3: Optional Name or tool_call_id, Group 4: Permissive flag (?)
    const tagRegex = /(\\)?(?:\[\[(?:ROLE:)?(system|user|assistant|tool)(?::([^\]?]+))?(\?)?\]\]|\[\[\/(?:system|user|assistant|tool|ROLE)?\]\]|\[\[\/\]\])/gi;

    let lastIndex = 0;
    let match;
    
    let currentRole = defaultRole;
    let currentName = null;
    let isForced = false;
    
    const appendToMessages = (content) => {
        if (!content || !content.trim()) return;
        
        // Cleanup escape backslashes
        const cleanContent = content.replace(/\\\[\[/g, '[[').trim();
        if (!cleanContent) return;

        const role = currentRole;
        const msg = { role, content: cleanContent };
        if (role === 'tool' && currentName) msg.tool_call_id = currentName;
        else if (currentName) msg.name = currentName;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === msg.role && (lastMsg.name === msg.name || (!lastMsg.name && !msg.name)) && msg.role !== 'tool') {
            lastMsg.content += '\n\n' + msg.content;
        } else {
            messages.push(msg);
        }
    };

    while ((match = tagRegex.exec(text)) !== null) {
        const isEscaped = !!match[1];
        
        if (isEscaped) {
            // If escaped, we don't treat it as a tag. 
            // We just keep going, letting the next loop (or the end) handle it as text.
            continue;
        }

        const precedingText = text.substring(lastIndex, match.index);
        const isEndTag = match[0].startsWith('[[/');
        const isEngineTag = match[0].includes('ROLE:');
        const role = match[2]?.toLowerCase();
        const permissive = match[4] === '?';

        if (isForced) {
            // In forced mode, we ignore engine-style [[ROLE:...]] tags 
            // but we still honor manual shorthands [[user]] and terminators [[/]]
            if (isEndTag || (role && !isEngineTag)) {
                appendToMessages(precedingText);
                
                if (isEndTag) {
                    currentRole = defaultRole;
                    currentName = null;
                    isForced = false;
                } else {
                    currentRole = role;
                    currentName = match[3] || null;
                    isForced = !permissive;
                }
                lastIndex = tagRegex.lastIndex;
            } else {
                // Ignore engine tag, keep accumulating
                continue;
            }
        } else {
            // Permissive mode or default mode: process tags normally
            if (precedingText) appendToMessages(precedingText);

            if (isEndTag) {
                currentRole = defaultRole;
                currentName = null;
                isForced = false;
            } else if (role) {
                currentRole = role;
                currentName = match[3] || null;
                isForced = !permissive;
            }
            lastIndex = tagRegex.lastIndex;
        }
    }

    const remainingText = text.substring(lastIndex);
    if (remainingText) {
        appendToMessages(remainingText);
    }

    if (messages.length === 0) {
        return [{ role: defaultRole, content: text.trim() }];
    }

    // Second pass: Process [[INVOCATIONS:...]] tags in the content of each message
    const invocationRegex = /\[\[INVOCATIONS:([\s\S]*?)\]\]/gi;

    for (const msg of messages) {
        let invocations = [];
        msg.content = msg.content.replace(invocationRegex, (m, hex) => {
            const parsed = decodeInvocations(hex);
            if (parsed && Array.isArray(parsed)) invocations.push(...parsed);
            return '';
        }).trim();

        if (invocations.length > 0) {
            msg.tool_calls = (msg.tool_calls || []).concat(invocations);
        }
    }

    return messages;
}
