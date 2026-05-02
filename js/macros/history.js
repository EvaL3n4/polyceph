import { logger } from './utils.js';
import { countTokens, getMaxPromptTokens } from '../compat-shared.js';

/**
 * Weaves extension-injected prompts into a message list based on depth and position.
 * Mimics SillyTavern's populationInjectionPrompts logic.
 */
export function weaveInjections(messages, extensionPrompts) {
    if (!extensionPrompts) return messages.map(m => ({ ...m, is_injection: false }));

    const injections = [];
    Object.keys(extensionPrompts).forEach(key => {
        const prompt = extensionPrompts[key];
        if (prompt && prompt.value && prompt.value.trim()) {
            injections.push({
                id: key,
                value: prompt.value.trim(),
                depth: Number(prompt.depth || 0),
                // SillyTavern extension_prompt_types: 0=IN_PROMPT (After), 1=IN_CHAT (Depth), 2=BEFORE_PROMPT (Top)
                position: Number(prompt.position === undefined ? 2 : prompt.position), 
                role: Number(prompt.role || 0)
            });
        }
    });

    const finalMessages = [];

    // 1. BEFORE_PROMPT (Position 2 in ST) - Top of everything
    injections.filter(inj => inj.position === 2).forEach(inj => {
        finalMessages.push({ mes: inj.value, role: inj.role, is_injection: true });
    });

    // 2. Chat History with IN_CHAT (Position 1 in ST) @ Depth
    // In SillyTavern, depth 0 is the most recent message.
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const depthFromBottom = messages.length - 1 - i;

        // In-Chat Injections go BEFORE the message at that depth (closer to top)
        injections.filter(inj => inj.position === 1 && inj.depth === depthFromBottom).forEach(inj => {
            finalMessages.push({ mes: inj.value, role: inj.role, is_injection: true });
        });

        finalMessages.push({ ...msg, is_injection: false });
    }

    // 3. IN_PROMPT (Position 0 in ST) - Bottom of everything
    injections.filter(inj => inj.position === 0).forEach(inj => {
        finalMessages.push({ mes: inj.value, role: inj.role, is_injection: true });
    });

    // 4. Handle depths beyond chat length
    injections.filter(inj => inj.position === 1 && inj.depth >= messages.length).forEach(inj => {
        finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
    });

    return finalMessages;
}

/**
 * Resolves Polyceph-specific chat history macros.
 * Handles: {{chat_history}}, {{chat_history|last:N}}, etc.
 * 
 * @param {string} text - The template text containing macros.
 * @param {object[]} cleanChat - The sanitized chat history.
 * @param {object} stContext - SillyTavern context.
 * @param {boolean} isDryRun - Whether this is a preview.
 * @param {string} userInput - The pending user input.
 * @param {boolean} shouldInjectWI - If false, World Info will NOT be injected into this history block.
 * @param {number} overheadTokens - Tokens already consumed by other parts of the prompt template.
 */
export async function resolveChatHistory(text, cleanChat, stContext, isDryRun = false, userInput = null, shouldInjectWI = true, overheadTokens = 0) {
    if (!text) return text;

    const isCC = stContext.mainApi === 'openai';

    // We use a regex replace with an async function
    const matches = [...text.matchAll(/\{\{chat_history(?:\|([^}]+))?\}\}/g)];
    let newText = text;

    for (const match of matches) {
        const fullMatch = match[0];
        const params = match[1];
        const options = {};
        if (params) {
            params.split('|').forEach(p => {
                const [key, val] = p.split(':').map(s => s.trim().toLowerCase());
                if (key) options[key] = val;
            });
        }

        const includeInjections = options.no_extensions !== 'true';

        // 1. Select Source
        let source = (options.live === 'true') ?
            stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/')) :
            cleanChat;

        // 2. Filter Background Messages
        let filteredMessages = source;
        if (options.bg_last !== undefined) {
            const bgLimit = parseInt(options.bg_last);
            const backgroundMsgs = source.filter(m => m && m.extra?.polyceph_hidden);

            if (backgroundMsgs.length > bgLimit) {
                const keepBgs = backgroundMsgs.slice(-bgLimit);
                filteredMessages = source.filter(m => {
                    if (!m.extra?.polyceph_hidden) return true;
                    return keepBgs.includes(m);
                });
            }
        }

        // 3. Token-Aware Trimming (if last:N is not specified or as a safety layer)
        const budget = await getMaxPromptTokens();
        let injectionPrompts = includeInjections ? { ...stContext.extensionPrompts } : null;

        // Trigger Lorebook (World Info) if requested and NOT already present as a standalone macro
        if (includeInjections && shouldInjectWI) {
            try {
                const { getWorldInfoForChat } = await import('../compat-shared.js');
                const wi = await getWorldInfoForChat(filteredMessages, isDryRun, 'normal', userInput);
                
                if (wi) {
                    // 1. Add depth-based entries
                    if (Array.isArray(wi.depthEntries)) {
                        wi.depthEntries.forEach((entry, idx) => {
                            const joined = entry.entries.join('\n');
                            injectionPrompts[`wi_depth_${entry.depth}_${idx}`] = {
                                value: joined,
                                depth: entry.depth,
                                position: 1, // IN_CHAT (ST enum)
                                role: entry.role
                            };
                        });
                    }

                    // 2. Add top/bottom entries (legacy or non-depth)
                    if (wi.worldInfoString) {
                        injectionPrompts['polyceph_wi'] = { 
                            value: wi.worldInfoString, 
                            depth: 0, 
                            position: 2, // BEFORE_PROMPT (ST enum)
                            role: 0 
                        };
                    }
                }
            } catch (e) {
                logger.warn('Failed to resolve Lorebook for prompt expansion:', e);
            }
        }
        
        // Calculate Injection Overhead
        let injectionTokens = 0;
        if (injectionPrompts) {
            const injectionText = Object.values(injectionPrompts).map(p => p.value || '').join('\n');
            injectionTokens = await countTokens(injectionText);
        }

        // Usable budget = Total - Injections - Template Overhead - Safety Buffer
        // We use a progressive safety buffer (5% of total budget, min 2000) to account for 
        // tokenizer drift and hidden API-side overhead (System Prompts, Formatting).
        const safetyBuffer = Math.max(2000, Math.ceil(budget * 0.05)); 
        const usableBudget = budget - injectionTokens - overheadTokens - safetyBuffer;
        
        logger.debug(`[Polyceph] History Budget Breakdown:
            Total context budget: ${budget}
            Injection tokens: ${injectionTokens}
            Template overhead: ${overheadTokens}
            Safety buffer (5%): ${safetyBuffer}
            Final usable for history: ${usableBudget}`);

        if (usableBudget <= 0) {
            logger.warn('[Polyceph] Usable budget for chat history is zero or negative. Returning empty history.');
            newText = newText.replace(fullMatch, '');
            continue;
        }

        let trimmedMessages = filteredMessages;
        if (options.last !== undefined) {
            const lastN = parseInt(options.last);
            if (!isNaN(lastN)) {
                trimmedMessages = filteredMessages.slice(-lastN);
            }
        }

        // Final token-aware trim for the history source itself
        const finalSource = [];
        let currentTokens = 0;
        for (let i = trimmedMessages.length - 1; i >= 0; i--) {
            const m = trimmedMessages[i];
            
            // Account for message formatting overhead + invocations
            let mContent = m.mes || '';
            if (m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                mContent += `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
            }
            
            const t = await countTokens(mContent);
            const overhead = 30; // Estimated formatting overhead (Role markers, Names, separators)
            
            if (currentTokens + t + overhead > usableBudget) break;
            finalSource.unshift(m);
            currentTokens += t + overhead;
        }

        // 4. Map and Weave
        const finalMessages = weaveInjections(finalSource, injectionPrompts);

        // 5. Format to strings
        let history = finalMessages.map(m => {
            let mRole = 'assistant';
            if (m.is_injection) {
                if (m.role === 1) mRole = 'user';
                else if (m.role === 2) mRole = 'assistant';
                else mRole = 'system';
            } else {
                if (m.extra?.polyceph_hidden) mRole = 'assistant';
                else if (m.is_user) mRole = 'user';
                else if (m.is_system) mRole = 'system';
            }

            let encodedInvocations = '';
            if (m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                encodedInvocations = `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
            }

            if (isCC) {
                return `[[ROLE:${mRole}]]\n${m.mes}${encodedInvocations}\n[[/ROLE]]`;
            }

            if (mRole === 'system') return `### System Instruction:\n${m.mes}${encodedInvocations}`;
            return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}${encodedInvocations}`;
        });

        const resolvedHistory = history.join('\n\n');
        newText = newText.replace(fullMatch, resolvedHistory);
        logger.debug(`Resolved {{chat_history}} with ${finalSource.length} messages. Budget: ${usableBudget}, Injections: ${injectionTokens}`);
    }

    return newText;
}
