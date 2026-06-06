// Smoke test for the cleanChat filter in js/engine/context.js
// (the snapshot used as the source of truth for {{chat_history}} and {{cc_all_prompts}}).
//
// Run with:  node tests/cleanChat.test.mjs
//
// The test re-derives the filter expression from the source file so it fails loudly
// if the production code drifts. Each case below targets a real bug pattern observed
// in the wild:
//
//   1. polyceph_typing assistant messages (placeholder)        → dropped
//   2. polyceph_typing user messages (real fix, 205c9d2)       → KEPT
//   3. is_system messages                                       → dropped
//   4. slash commands (e.g. /sys, /setstatus)                   → dropped
//   5. character messages whose mes is the streaming placeholder → dropped
//      (THIS is the bug Eva hit: a previous polyceph swipe run left msg.mes='...'
//       and the next {{cc_all_prompts}} would leak that '...' into history)
//   6. polyceph_streaming messages with real, partial streamed text → KEPT
//      (we don't want to drop messages mid-stream)
//   7. polyceph_hidden background messages                      → KEPT (used by {{chat_history|bg_last:N}})
//   8. ordinary character messages                              → KEPT
//   9. ordinary user messages                                   → KEPT (205c9d2 fix)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTEXT_JS = resolve(__dirname, '../js/engine/context.js');

// ---------------------------------------------------------------------------
// Step 1. Re-derive the filter predicate from the production source.
// ---------------------------------------------------------------------------
// The filter lives on line 23 of context.js as a `.filter(m => EXPR)` call.
// We extract EXPR by finding the opening `.filter(m =>`, then matching
// parens until depth returns to 0. This is robust against nested parens
// inside the predicate (e.g. !m.is_user has a paren inside).
const contextSrc = readFileSync(CONTEXT_JS, 'utf8');
const openIdx = contextSrc.search(/\.filter\(\s*m\s*=>/);
assert.ok(openIdx !== -1, `Could not locate the .filter(m => …) call in ${CONTEXT_JS}`);

// Skip past `.filter(m =>`
const arrowIdx = contextSrc.indexOf('=>', openIdx) + 2;

// Walk forward, tracking paren depth, until we close the .filter() call.
// Start at depth 1 — we are *inside* the `.filter(` paren that opened before
// arrowIdx; we want to find the matching close, not the first close in EXPR.
let depth = 1, endIdx = -1, inStr = null, inTpl = false;
for (let i = arrowIdx; i < contextSrc.length; i++) {
    const c = contextSrc[i];
    const prev = contextSrc[i - 1];
    if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
    } else if (inTpl) {
        if (c === '`') inTpl = false;
    } else if (c === "'" || c === '"') {
        inStr = c;
    } else if (c === '`') {
        inTpl = true;
    } else if (c === '(') {
        depth++;
    } else if (c === ')') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
    }
}
assert.ok(endIdx !== -1, `Could not find the closing paren of the .filter(m => …) call`);

const predicateBody = contextSrc.slice(arrowIdx, endIdx).trim();
// When the predicate body is a brace block (e.g. `m => { if (...) return false; ... }`)
// we cannot wrap it in `( ... )` because that parses as a parenthesised object
// literal. Use a thin wrapper function instead, so the body is a function body.
const filterFn = new Function('m', predicateBody.startsWith('{')
    ? `const f = (m) => ${predicateBody}; return f(m);`
    : `return (${predicateBody});`
);

function cleanChat(stChat) {
    return stChat.filter(m => m && filterFn(m));
}

// ---------------------------------------------------------------------------
// Step 2. Fixture messages covering each real-world case.
// ---------------------------------------------------------------------------
const fixtures = {
    // Case 1: typing indicator placeholder on a character message — drop it.
    typingAssistant: {
        is_user: false, is_system: false,
        mes: '...',
        extra: { polyceph_typing: true },
    },

    // Case 2: typing indicator on a USER message — keep it (this is the
    // 205c9d2 fix; previously the !m.is_user guard was missing and
    // polyceph_typing user-anchors got stripped, causing {{user_input}}
    // dependency to silently break).
    typingUser: {
        is_user: true, is_system: false,
        mes: 'Tell me about the lighthouse.',
        extra: { polyceph_typing: true },
    },

    // Case 3: a system note (e.g. injected lorebook entry) — drop.
    system: {
        is_user: false, is_system: true,
        mes: 'A reminder of the setting.',
    },

    // Case 4: a slash command — drop. ST treats /xxx lines as commands
    // and the LLM should not see them in history.
    slashCmd: {
        is_user: true, is_system: false,
        mes: '/setstatus awake',
    },

    // Case 5: THE BUG. A character message that is the polyceph streaming
    // placeholder '...' — drop. This appears in the next run's cleanChat
    // snapshot when a prior polyceph swipe was abandoned or in flight,
    // and previously the filter let it through into {{cc_all_prompts}}.
    swipeStreamingPlaceholder: {
        is_user: false, is_system: false,
        mes: '...',
        extra: { polyceph_streaming: true, polyceph_batch: 'batch_42' },
    },

    // Case 6: streaming message that has received some real text — keep.
    // We must not drop partial streams; downstream readers want the
    // current visible text. (Currently the filter has no special handling
    // for this — it keeps by default — and we want to lock that in.)
    swipeStreamingPartial: {
        is_user: false, is_system: false,
        mes: 'She paused at the',
        extra: { polyceph_streaming: true, polyceph_batch: 'batch_42' },
    },

    // Case 7: polyceph-hidden background thought — keep. Some templates
    // (and {{chat_history|bg_last:N}}) want to see these.
    hiddenBackground: {
        is_user: false, is_system: false,
        mes: 'Internal: the protagonist is hiding a letter.',
        extra: { polyceph_hidden: true },
    },

    // Case 8: ordinary character message — keep.
    ordinaryAssistant: {
        is_user: false, is_system: false,
        mes: '"I never asked for this," she said.',
    },

    // Case 9: ordinary user message — keep.
    ordinaryUser: {
        is_user: true, is_system: false,
        mes: 'Tell me about the lighthouse.',
    },

    // Case 10: a finalised swipe text from a previous polyceph run. The
    // swipes[] array carries alternatives but msg.mes is the active swipe.
    // This should be kept so the model has continuity context.
    priorSwipeFinalised: {
        is_user: false, is_system: false,
        mes: 'A new swipe response, fully rendered.',
        swipes: ['first swipe', 'A new swipe response, fully rendered.'],
        swipe_id: 1,
        extra: { polyceph_source: 'polyceph', polyceph_batch: 'batch_99' },
    },
};

// ---------------------------------------------------------------------------
// Step 3. The actual test cases.
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const test = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); pass++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
};

console.log('cleanChat filter — smoke test');
console.log('-----------------------------');
console.log(`Predicate (from ${CONTEXT_JS}):`);
console.log(`  m => ${predicateBody.replace(/\s+/g, ' ')}`);
console.log('');

test('drops polyceph_typing assistant placeholder', () => {
    const out = cleanChat([fixtures.typingAssistant]);
    assert.equal(out.length, 0, 'expected the typing assistant to be filtered out');
});

test('keeps polyceph_typing user message (205c9d2 fix)', () => {
    const out = cleanChat([fixtures.typingUser]);
    assert.equal(out.length, 1, 'user messages must survive the filter, even with polyceph_typing');
    assert.equal(out[0].mes, 'Tell me about the lighthouse.');
});

test('drops is_system messages', () => {
    const out = cleanChat([fixtures.system]);
    assert.equal(out.length, 0);
});

test('drops slash commands', () => {
    const out = cleanChat([fixtures.slashCmd]);
    assert.equal(out.length, 0);
});

test('drops character messages whose mes is the streaming placeholder', () => {
    // This is the case Eva hit: a previous polyceph swipe run left
    // msg.mes='...' on a character message, and the next run's
    // {{cc_all_prompts}} would leak a stray '...' into the LLM context.
    const out = cleanChat([fixtures.swipeStreamingPlaceholder]);
    assert.equal(out.length, 0,
        'a character message that is still the "..." streaming placeholder must be filtered out');
});

test('keeps streaming messages with real, partial text', () => {
    const out = cleanChat([fixtures.swipeStreamingPartial]);
    assert.equal(out.length, 1,
        'partial streams should pass through unchanged so downstream readers see the latest text');
    assert.equal(out[0].mes, 'She paused at the');
});

test('keeps polyceph-hidden background messages', () => {
    const out = cleanChat([fixtures.hiddenBackground]);
    assert.equal(out.length, 1, 'hidden backgrounds are addressable via {{chat_history|bg_last:N}}');
});

test('keeps ordinary assistant messages', () => {
    const out = cleanChat([fixtures.ordinaryAssistant]);
    assert.equal(out.length, 1);
});

test('keeps ordinary user messages', () => {
    const out = cleanChat([fixtures.ordinaryUser]);
    assert.equal(out.length, 1);
});

test('keeps finalised swipes from prior polyceph runs', () => {
    const out = cleanChat([fixtures.priorSwipeFinalised]);
    assert.equal(out.length, 1,
        'a previous run\'s finalised swipe text is the active msg.mes and should remain in history');
});

// Integration: a realistic mixed chat.  The expectation is that after filtering,
// the only surviving items are those the LLM should actually see as conversation
// turns or hidden/addressable background.
test('mixed chat: yields only the conversation turns + hidden bg', () => {
    const chat = [
        fixtures.swipeStreamingPlaceholder,   // drop (the bug)
        fixtures.typingAssistant,             // drop
        fixtures.ordinaryUser,                // keep
        fixtures.ordinaryAssistant,           // keep
        fixtures.swipeStreamingPartial,       // keep
        fixtures.hiddenBackground,            // keep
        fixtures.system,                      // drop
        fixtures.slashCmd,                    // drop
        fixtures.typingUser,                  // keep (fix)
        fixtures.priorSwipeFinalised,         // keep
    ];
    const out = cleanChat(chat);
    const kept = out.map(m => m.mes);
    assert.deepEqual(kept, [
        'Tell me about the lighthouse.',
        '"I never asked for this," she said.',
        'She paused at the',
        'Internal: the protagonist is hiding a letter.',
        'Tell me about the lighthouse.',  // the typingUser fixture repeats the same text
        'A new swipe response, fully rendered.',
    ]);
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
