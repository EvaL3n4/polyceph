import { MODULE_NAME } from './constants.js';
import { settings, switchProfile } from './state.js';

export async function generateQuietly(profileName, prompt, useSystem) {
    if (!profileName || profileName === 'none') return prompt;

    try {
        const context = SillyTavern.getContext();

        let responseData = "";

        if (useSystem && typeof context.generateQuietPrompt === 'function') {
            responseData = await context.generateQuietPrompt({ quietPrompt: prompt });
        } else if (!useSystem && typeof context.generateRaw === 'function') {
            responseData = await context.generateRaw({ prompt: prompt, systemPrompt: '' });
        } else if (typeof context.generateQuietPrompt === 'function') {
            console.warn(`[${MODULE_NAME}] generateRaw not found, falling back to generateQuietPrompt.`);
            responseData = await context.generateQuietPrompt({ quietPrompt: prompt });
        } else {
            console.warn(`[${MODULE_NAME}] generateQuietPrompt not found, falling back to basic command execution.`);
            // Fallback for older ST versions
            const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            responseData = await context.executeSlashCommandsWithOptions(`/gen ${escaped}`, {
                handleExecutionErrors: false, handleParserErrors: false
            });
        }

        if (responseData) return responseData;
        return "(Generation returned empty)";
    } catch (err) {
        console.error(`[${MODULE_NAME}] generation failed:`, err);
        return "(Error during generation)";
    }
}

export async function runPipeline(userInput) {
    toastr.info('Starting Polyceph Pipeline...', 'Polyceph');
    const contextVault = { 'user_input': userInput };

    try {
        for (let i = 0; i < settings.steps.length; i++) {
            const step = settings.steps[i];
            const isLastStep = i === settings.steps.length - 1;

            if (!step.nodes || step.nodes.length === 0) continue;

            // Group nodes by profile to minimize ST global switches and race conditions
            const profileGroups = {};
            step.nodes.forEach((node, nodeIndex) => {
                const pName = node.profile || 'Target';
                if (!profileGroups[pName]) profileGroups[pName] = [];
                profileGroups[pName].push({ node, nodeIndex });
            });

            const resultsByIndex = [];

            // Process each profile group sequentially
            for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
                if (profileId !== 'none') {
                    await switchProfile(profileId);
                    // Allow ST UI state to settle profile load
                    await new Promise(r => setTimeout(r, 250));
                }

                // Process nodes sequentially to strictly respect rate-limiting
                for (let k = 0; k < groupNodes.length; k++) {
                    const item = groupNodes[k];
                    const { node, nodeIndex } = item;
                    let prompt = node.template || '';

                    // Natively process {{chat_history}} and {{chat_history:X}}
                    prompt = prompt.replace(/\{\{chat_history(?::(\d+))?\}\}/g, (match, count) => {
                        const context = SillyTavern.getContext();
                        if (!context.chat || !Array.isArray(context.chat)) return '';
                        let history = context.chat.map(m => `${m.name}: ${m.mes}`);
                        if (count) {
                            const cap = parseInt(count);
                            history = history.slice(-cap);
                        }
                        return history.join('\n\n');
                    });

                    // Variables from contextVault
                    for (const [key, val] of Object.entries(contextVault)) {
                        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                        prompt = prompt.replace(regex, val);
                    }

                    const res = await generateQuietly(node.profile, prompt, !!node.useSystem);

                    const sIdIndx = i + 1;
                    const tIdIndx = nodeIndex + 1;

                    // Assign to vault variants
                    contextVault[`${step.id}_target_${tIdIndx}`] = res;
                    contextVault[`s${sIdIndx}t${tIdIndx}`] = res;
                    if (node.label) {
                        contextVault[node.label.trim()] = res;
                    }

                    if (node.profile === 'none') {
                        // Keep text completely clean for template-only nodes
                        resultsByIndex[nodeIndex] = res;
                    } else {
                        // Wrap normally without the gigantic API profile names
                        const targetHeader = node.label ? node.label : `Target ${tIdIndx}`;
                        resultsByIndex[nodeIndex] = `[${targetHeader}]\n${res}`;
                    }

                    // Strict rate limit delay between individual requests
                    if (settings.delayMs && settings.delayMs > 0) {
                        await new Promise(r => setTimeout(r, settings.delayMs));
                    }
                }
            }

            const combinedResult = resultsByIndex.join('\n\n---\n\n');
            const sIdIndxOuter = i + 1;

            contextVault[step.id] = combinedResult;
            contextVault[`s${sIdIndxOuter}`] = combinedResult;
            if (step.label) {
                contextVault[step.label.trim()] = combinedResult;
            }

            if (step.persist) {
                const context = SillyTavern.getContext();
                if (step.cleanPersist) {
                    // Send directly into the chat buffer as a character message
                    const charName = context.characters?.[context.characterId]?.name || context.name2 || 'Assistant';
                    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.characters?.[context.characterId] ?
                        context.getThumbnailUrl('avatar', context.characters[context.characterId].avatar) : '';

                    const message = {
                        name: charName,
                        is_user: false,
                        is_system: false,
                        send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
                        mes: combinedResult,
                        force_avatar: avatarStr,
                        extra: { api: 'manual', model: 'polyceph' }
                    };
                    context.chat.push(message);
                    if (context.eventSource && context.eventTypes) {
                        await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, context.chat.length - 1);
                    }
                    if (typeof context.addOneMessage === 'function') context.addOneMessage(message);
                    if (context.eventSource && context.eventTypes) {
                        await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, context.chat.length - 1);
                    }
                    if (typeof context.saveChat === 'function') context.saveChat();
                } else {
                    const stepHeader = step.label ? `[${step.label}]` : `[Polyceph Output: Step ${sIdIndxOuter}]`;
                    await context.executeSlashCommandsWithOptions(`/sys ${stepHeader}\n${combinedResult}`, {
                        handleExecutionErrors: false, handleParserErrors: false
                    });
                }
            }

            if (isLastStep) {
                const stContext = SillyTavern.getContext();
                await stContext.executeSlashCommandsWithOptions(`/echo ${combinedResult}`, {
                    handleExecutionErrors: false, handleParserErrors: false
                });
            }
        }
        toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        console.error(`[${MODULE_NAME}] Pipeline Error`, e);
    }
}
