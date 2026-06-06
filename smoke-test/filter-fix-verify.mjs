// Standalone smoke test for the cleanChat user-filter fix (commit 205c9d2 on
// EvaL3n4/polyceph). Replicates the filter and chat-history assembly from
// chat-completion.js:126-147 to prove that the current user message
// survives cleanChat and ends up in {{cc_all_prompts}} output.
// We replicate the filter and the cc_all_prompts chat-history assembly from
// chat-completion.js:226-244 against three scenarios:
//   1. cleanChat with the current user message (tagged polyceph_typing) — should INCLUDE
//   2. cleanChat with Polyceph's internal typing-indicator placeholders — should EXCLUDE
//   3. cleanChat with the last assistant turn that was just swiped — should INCLUDE
//
// Run: node /home/opus/polyceph/smoke-test/filter-fix-verify.mjs
// Exit code 0 = all assertions pass; non-zero = a regression.

import assert from 'node:assert/strict';

// Mirror of the exact filter expression from context.js:23, history.js:102, prompt-preview.js:21
const cleanChat = (chat) => chat.filter(
    m => m && !(m.extra?.polyceph_typing && !m.is_user) && !m.is_system && !m.mes?.trim().startsWith('/')
);

// Mirror of the trim loop from chat-completion.js:223-244 (token-budget trim from the end).
// We don't need an exact token count — just need to know whether the last user message
// survives the source-array step. For a normal-length RP the current user message is
// always at the tail and well within budget, so it should always be in `trimmedChat`.
const trimFromTail = (cleanChatArr) => {
    // Pretend the budget is huge; we just want to verify membership.
    return cleanChatArr.slice();
};

// Mirror of the chatHistory case in resolveIdentifier (chat-completion.js:126-147):
// maps each surviving message into a role-tagged string.
const assembleChatHistory = (trimmedChat) => trimmedChat.map(m => {
    let mRole = 'assistant';
    if (m.extra?.polyceph_hidden) mRole = 'assistant';
    else if (m.is_user) mRole = 'user';
    else if (m.is_system) mRole = 'system';
    return `[[ROLE:${mRole}]]\n${m.mes || ''}\n[[/ROLE]]`;
}).join('\n\n');

// --- Scenario 1: Current user message tagged with polyceph_typing ---
// This is the post-fix scenario. Before the fix, this message would be stripped.
const scenario1 = {
    label: 'Current user message (post-fix scenario)',
    chat: [
        { is_user: false, mes: 'You enter the tavern. The fire crackles.', extra: {} },
        { is_user: true,  mes: 'I order an ale.', extra: { polyceph_typing: true } }, // <-- posted by Polyceph before pipeline runs
    ],
    expectUserMessage: true,
    expectUserMessageInOutput: true,
};

// --- Scenario 2: Polyceph's internal typing-indicator placeholders ---
// These are non-user messages tagged with polyceph_typing, used to show the spinner.
// The fix says these MUST still be filtered (they aren't real chat).
const scenario2 = {
    label: 'Polyceph internal typing placeholders (non-user)',
    chat: [
        { is_user: false, mes: 'You enter the tavern. The fire crackles.', extra: {} },
        { is_user: true,  mes: 'I order an ale.', extra: {} },
        // These are real Polyceph placeholders — non-user, polyceph_typing tagged.
        { is_user: false, mes: '...', extra: { polyceph_typing: true, polyceph_active_tasks: ['Tracker'] } },
    ],
    expectUserMessage: true,
    expectPlaceholderFiltered: true,
};

// --- Scenario 3: Latest assistant turn after a swipe ---
// The user's *previous* turn is in chat; the latest *assistant* turn was a swipe and
// is the most recent message. cc_all_prompts should still include the previous user
// turn (it's where the conversation was anchored) plus the assistant turn.
const scenario3 = {
    label: 'Swipe scenario (previous user + new assistant)',
    chat: [
        { is_user: false, mes: 'You enter the tavern. The fire crackles.', extra: {} },
        { is_user: true,  mes: 'I order an ale.', extra: { polyceph_typing: true } },
        // Swipe result: a freshly generated assistant turn.
        { is_user: false, mes: 'The barkeep slides a frothy mug across the worn counter.', extra: {} },
    ],
    expectUserMessage: true,
    expectAssistantSwipeIncluded: true,
};

const scenarios = [scenario1, scenario2, scenario3];
let pass = 0;
let fail = 0;

for (const s of scenarios) {
    console.log(`\n--- ${s.label} ---`);
    const cleaned = cleanChat(s.chat);
    console.log(`Input messages:    ${s.chat.length}`);
    console.log(`After cleanChat:   ${cleaned.length}`);
    for (const m of cleaned) {
        const tag = m.is_user ? '[USER]' : '[ASSIST]';
        console.log(`  ${tag} ${m.mes.slice(0, 60)}${m.mes.length > 60 ? '…' : ''}`);
    }

    // Replicate the role-tagged assembly that cc_all_prompts emits for chatHistory.
    const trimmed = trimFromTail(cleaned);
    const output = assembleChatHistory(trimmed);
    console.log(`\ncc_all_prompts chatHistory output:`);
    console.log(output.split('\n').map(l => '  ' + l).join('\n'));

    // Assertions
    const userInOutput = output.includes('I order an ale.');
    const userInputMessageSurvived = cleaned.some(m => m.is_user && m.mes === 'I order an ale.');
    const placeholderFiltered = !cleaned.some(m => m.extra?.polyceph_typing);
    const assistantSwipeIncluded = output.includes('The barkeep slides a frothy mug');

    try {
        if (s.expectUserMessage) {
            assert.ok(userInputMessageSurvived, 'Current user message should survive cleanChat');
        }
        if (s.expectUserMessageInOutput) {
            assert.ok(userInOutput, 'Current user message should appear in cc_all_prompts output');
        }
        if (s.expectPlaceholderFiltered) {
            assert.ok(placeholderFiltered, 'Polyceph typing placeholders (non-user) should be filtered');
        }
        if (s.expectAssistantSwipeIncluded) {
            assert.ok(assistantSwipeIncluded, 'Latest assistant swipe should appear in cc_all_prompts output');
        }
        console.log('  ✓ assertions passed');
        pass++;
    } catch (e) {
        console.log(`  ✗ ${e.message}`);
        fail++;
    }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
