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
//  10. ST "Hide from context" toggled messages                  → dropped
//      (These are flagged with extra[Symbol.for('ignore')] which
//       is the IGNORE_SYMBOL constant in ST's constants.js. Without
//       this filter they survive cleanChat and bloat {{cc_all_prompts}}.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTEXT_JS = resolve(__dirname, '../js/engine/context.js');
const HISTORY_JS = resolve(__dirname, '../js/macros/history.js');

// ---------------------------------------------------------------------------
// Shared tokenizer for paren-walking through a `.filter(m => …)` predicate.
// The walker recognizes JS string literals, template literals, and both
// line/block comments so that a comment containing an apostrophe (e.g.
// "ST's toggle") does not leave the walker stuck in string mode to EOF.
// ---------------------------------------------------------------------------
function walkFilterPredicate(src, openIdx) {
    // Skip past `.filter(m =>`
    const arrowIdx = src.indexOf('=>', openIdx) + 2;
    let depth = 1, endIdx = -1;
    let inStr = null, inTpl = false, inLineCmt = false, inBlkCmt = false;
    for (let i = arrowIdx; i < src.length; i++) {
        const c = src[i];
        const next = src[i + 1];
        const prev = src[i - 1];
        if (inStr) {
            if (c === inStr && prev !== '\\') inStr = null;
            continue;
        }
        if (inTpl) { if (c === '`') inTpl = false; continue; }
        if (inLineCmt) { if (c === '\n') inLineCmt = false; continue; }
        if (inBlkCmt) {
            if (c === '*' && next === '/') { inBlkCmt = false; i++; }
            continue;
        }
        if (c === '/' && next === '/') { inLineCmt = true; i++; continue; }
        if (c === '/' && next === '*') { inBlkCmt = true; i++; continue; }
        if (c === "'" || c === '"') { inStr = c; continue; }
        if (c === '`') { inTpl = true; continue; }
        if (c === '(') { depth++; continue; }
        if (c === ')') {
            depth--;
            if (depth === 0) { endIdx = i; break; }
        }
    }
    assert.ok(endIdx !== -1, 'Could not find the closing paren of the .filter(m => …) call');
    return src.slice(arrowIdx, endIdx).trim();
}

// ---------------------------------------------------------------------------
// Step 1. Re-derive the cleanChat filter predicate from context.js.
// ---------------------------------------------------------------------------
const contextSrc = readFileSync(CONTEXT_JS, 'utf8');
const contextFilterOpenIdx = contextSrc.search(/\.filter\(\s*m\s*=>/);
assert.ok(contextFilterOpenIdx !== -1, `Could not locate the .filter(m => …) call in ${CONTEXT_JS}`);
const predicateBody = walkFilterPredicate(contextSrc, contextFilterOpenIdx);
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

    // Case 11: ST "Hide from context" toggled on a character message.
    // The flag is the IGNORE_SYMBOL (Symbol.for('ignore')) from
    // ST's public/scripts/constants.js, set on the live chat object
    // when the user clicks the eye icon. Drop it.
    stHiddenAssistant: {
        is_user: false, is_system: false,
        mes: 'A long exposition block the user marked hidden.',
        extra: { [Symbol.for('ignore')]: true },
    },

    // Case 12: same as 11 but on a user message — also drop.
    // (We confirm we don't accidentally mirror the 205c9d2 user-keeps
    // pattern: the user-keeps fix is for polyceph_typing only, not for
    // the ST 'ignore' symbol.)
    stHiddenUser: {
        is_user: true, is_system: false,
        mes: 'Old message I do not want in context anymore.',
        extra: { [Symbol.for('ignore')]: true },
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

test('drops ST "Hide from context" character messages', () => {
    // The eye-icon toggle in ST sets extra[Symbol.for('ignore')] (the
    // IGNORE_SYMBOL constant from public/scripts/constants.js). Without
    // a filter for it, hidden messages survive cleanChat, get past
    // the budget trim in {{cc_all_prompts}}, and bloat the LLM context.
    const out = cleanChat([fixtures.stHiddenAssistant]);
    assert.equal(out.length, 0,
        'an ST-hidden character message must be filtered out of cleanChat');
});

test('drops ST "Hide from context" user messages', () => {
    // Mirrors case 11 but for user role. The 205c9d2 user-keeps fix
    // applies only to polyceph_typing, not the ST 'ignore' symbol.
    const out = cleanChat([fixtures.stHiddenUser]);
    assert.equal(out.length, 0,
        'an ST-hidden user message must be filtered out of cleanChat');
});

test('does not drop a regular message that just happens to have a Symbol-keyed extra', () => {
    // Sanity check: the predicate only fires on the IGNORE_SYMBOL
    // *value* being truthy. A different Symbol on extra, or an
    // extra with the symbol set to false, must not trigger the filter.
    const out = cleanChat([{
        is_user: false, is_system: false,
        mes: 'A normal message with an unrelated Symbol extra.',
        extra: { [Symbol.for('something_else')]: true },
    }]);
    assert.equal(out.length, 1,
        'only the IGNORE_SYMBOL (Symbol.for(\'ignore\')) flag should trigger the filter');
});

test('does not drop when extra has [ignore] symbol set to false', () => {
    // Defensive: explicit false on the symbol must not be coerced.
    const out = cleanChat([{
        is_user: false, is_system: false,
        mes: 'A normal message with the symbol explicitly set to false.',
        extra: { [Symbol.for('ignore')]: false },
    }]);
    assert.equal(out.length, 1);
});

test('does not crash on a message with no extra at all', () => {
    // Defensive: optional chaining must hold. m.extra?. should be
    // undefined, and undefined?.[anything] must be undefined → not drop.
    const out = cleanChat([{
        is_user: false, is_system: false,
        mes: 'A normal message with no extras at all.',
    }]);
    assert.equal(out.length, 1);
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
        fixtures.stHiddenAssistant,           // drop (ST eye-icon toggle)
        fixtures.stHiddenUser,                // drop (ST eye-icon toggle)
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

// ---------------------------------------------------------------------------
// Step 4. Live-source filter in macros/history.js (the {{chat_history|live:true}}
// path). This is a one-liner subset of the cleanChat predicate — it only
// handles the cheap "definitely drop" cases. We assert it agrees with the
// main cleanChat filter on the ST "Hide from context" flag, so a future drift
// in the live filter is caught by the test instead of producing mysterious
// `{{chat_history|live:true}}` bloat in the LLM context.
// ---------------------------------------------------------------------------
const historySrc = readFileSync(HISTORY_JS, 'utf8');
const liveFilterOpenIdx = historySrc.search(/\.filter\(\s*m\s*=>/);
assert.ok(liveFilterOpenIdx !== -1, `Could not locate the .filter(m => …) call in ${HISTORY_JS}`);
const livePredicateBody = walkFilterPredicate(historySrc, liveFilterOpenIdx);
const liveFilterFn = new Function('m', `return (${livePredicateBody});`);

function liveFilter(chat) {
    return chat.filter(m => m && liveFilterFn(m));
}

test('live filter drops ST "Hide from context" character messages', () => {
    const out = liveFilter([fixtures.stHiddenAssistant]);
    assert.equal(out.length, 0,
        '{{chat_history|live:true}} must drop ST-hidden messages just like the main cleanChat does');
});

test('live filter drops ST "Hide from context" user messages', () => {
    const out = liveFilter([fixtures.stHiddenUser]);
    assert.equal(out.length, 0);
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
