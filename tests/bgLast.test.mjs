// Smoke test for the {{chat_history|bg_last:N}} filter in js/macros/history.js.
//
// Background: as of 2026-06 the filter had a bug where, if a chat had zero
// <background> messages, the macro returned the ENTIRE visible chat history
// instead of an empty string. The fix narrows the result to ONLY the most
// recent N background messages; this test pins that behaviour.
//
// Run with:  node tests/bgLast.test.mjs
//
// Like tests/cleanChat.test.mjs, the test re-derives the production logic
// from the source file rather than copy-pasting it, so it fails loudly if
// history.js drifts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HISTORY_JS = resolve(__dirname, '../js/macros/history.js');

// ---------------------------------------------------------------------------
// Tiny test harness (mirrors tests/cleanChat.test.mjs so both files can be
// invoked with bare `node` — no npm install needed).
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const test = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); pass++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
};

// ---------------------------------------------------------------------------
// Extract the `if (options.bg_last !== undefined) { if (!isNaN(...) ...) { ... } }`
// block from history.js as raw source. Brace-aware and string/comment aware
// so braces inside string literals or comments don't fool us. Returns the
// inner body (the contents of the second `if`, not the outer guard) — the
// body that actually mutates `filteredMessages`.
// ---------------------------------------------------------------------------
function extractBgLastBlock(src) {
    const markerIdx = src.indexOf('options.bg_last !== undefined');
    assert.ok(markerIdx !== -1,
        `Could not find the bg_last guard in ${HISTORY_JS}`);

    // Walk to the first `{` (outer if-block's opening brace), brace-match
    // through strings/templates/comments to find its close.
    const openIdx = src.indexOf('{', markerIdx);
    assert.ok(openIdx !== -1, 'Could not find the opening brace of the bg_last if-block');

    function matchBraces(slice, start) {
        let depth = 0, end = -1;
        let inStr = null, inTpl = false, inLineCmt = false, inBlkCmt = false;
        for (let i = start; i < slice.length; i++) {
            const c = slice[i], next = slice[i + 1], prev = slice[i - 1];
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
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i; return end; }
            }
        }
        return end;
    }

    const outerEnd = matchBraces(src, openIdx);
    assert.ok(outerEnd !== -1, 'Could not find the outer if-block closing brace');
    // The whole body inside the outer `if (options.bg_last !== undefined)`
    // is self-contained: it declares `bgLimit`, has an inner `if (!isNaN &&
    // >= 0)` block that mutates `filteredMessages`. Returning it as a
    // single trimmed slice means the inner `if {...}` is intact and
    // re-eval-able in a `new Function` body.
    return src.slice(openIdx + 1, outerEnd).trim();
}

// ---------------------------------------------------------------------------
// Build a function that takes (source, optionsBgLast) and returns the
// filtered message list — by literally `new Function`ing the production
// body. The production body references `options` and declares `bgLimit`
// internally, so we pass `options.bg_last` in via a local `options` const
// of the same shape ST's macro parser produces.
// ---------------------------------------------------------------------------
const historySrc = readFileSync(HISTORY_JS, 'utf8');
const body = extractBgLastBlock(historySrc);
const fn = new Function('source', 'optionsBgLast', `
    const options = { bg_last: String(optionsBgLast) };
    let filteredMessages = source;
    ${body}
    return filteredMessages;
`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const fixtures = {
    userTurn: { is_user: true,  is_system: false, mes: 'Hello there.' },
    charTurn: { is_user: false, is_system: false, mes: 'General Kenobi.' },
    bg1: { is_user: false, is_system: false, mes: 'Tracker ledger: Ki beat established.',
           extra: { polyceph_hidden: true } },
    bg2: { is_user: false, is_system: false, mes: 'Tracker ledger: Shō development.',
           extra: { polyceph_hidden: true } },
    bg3: { is_user: false, is_system: false, mes: 'Tracker ledger: Ten twist.',
           extra: { polyceph_hidden: true } },
};
const chatWith = (...messages) => messages;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
console.log('bg_last filter — smoke test');
console.log('---------------------------');

test('zero background messages → empty result (the bug)', () => {
    const source = chatWith(fixtures.userTurn, fixtures.charTurn, fixtures.userTurn, fixtures.charTurn);
    const out = fn(source, 1);
    assert.equal(out.length, 0,
        '{{chat_history|bg_last:1}} must return empty when no <background> messages exist');
});

test('one background message, bg_last:1 → just that one', () => {
    const source = chatWith(fixtures.userTurn, fixtures.bg1, fixtures.charTurn);
    const out = fn(source, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0], fixtures.bg1);
});

test('one background message, bg_last:3 → just that one (no padding)', () => {
    const source = chatWith(fixtures.userTurn, fixtures.bg1, fixtures.charTurn);
    const out = fn(source, 3);
    assert.equal(out.length, 1);
    assert.equal(out[0], fixtures.bg1);
});

test('three background messages, bg_last:1 → the most recent', () => {
    const source = chatWith(fixtures.userTurn, fixtures.bg1, fixtures.charTurn, fixtures.bg2, fixtures.bg3);
    const out = fn(source, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0], fixtures.bg3);
});

test('three background messages, bg_last:2 → the two most recent, in order', () => {
    const source = chatWith(fixtures.userTurn, fixtures.bg1, fixtures.charTurn, fixtures.bg2, fixtures.bg3);
    const out = fn(source, 2);
    assert.equal(out.length, 2);
    assert.equal(out[0], fixtures.bg2);
    assert.equal(out[1], fixtures.bg3);
});

test('three background messages, bg_last:5 → all three (no padding)', () => {
    const source = chatWith(fixtures.bg1, fixtures.charTurn, fixtures.bg2, fixtures.bg3);
    const out = fn(source, 5);
    assert.equal(out.length, 3);
    assert.deepEqual(out, [fixtures.bg1, fixtures.bg2, fixtures.bg3]);
});

test('non-background messages are dropped, NOT preserved alongside backgrounds', () => {
    // This is the second half of the fix: previously, non-bg messages were
    // preserved whenever there were <= bgLimit backgrounds, which is what
    // made the zero-bg case return the entire chat. Confirm we never do
    // that any more.
    const source = chatWith(fixtures.userTurn, fixtures.charTurn, fixtures.bg1, fixtures.charTurn);
    const out = fn(source, 1);
    assert.equal(out.length, 1, 'must not include non-background messages');
    assert.equal(out[0], fixtures.bg1);
});

test('bg_last:0 → empty (zero backgrounds kept)', () => {
    const source = chatWith(fixtures.bg1, fixtures.bg2, fixtures.bg3);
    const out = fn(source, 0);
    assert.equal(out.length, 0);
});

test('order is preserved (oldest first → newest last)', () => {
    const source = chatWith(fixtures.bg1, fixtures.bg2, fixtures.bg3);
    const out = fn(source, 3);
    assert.deepEqual(out, [fixtures.bg1, fixtures.bg2, fixtures.bg3]);
});

test('mixed chat: only backgrounds survive, in original order', () => {
    const source = chatWith(
        fixtures.userTurn, fixtures.bg1, fixtures.charTurn,
        fixtures.bg2, fixtures.userTurn, fixtures.bg3, fixtures.charTurn
    );
    const out = fn(source, 5);
    assert.deepEqual(out, [fixtures.bg1, fixtures.bg2, fixtures.bg3]);
});

test('non-numeric bg_last falls through gracefully (no crash, no-op)', () => {
    // parseInt('foo') === NaN → the new guard `!isNaN(bgLimit)` short-circuits
    // and filteredMessages stays as the original source. This matches the
    // pre-fix behaviour for the non-numeric case and is safe.
    const source = chatWith(fixtures.userTurn, fixtures.charTurn);
    const out = fn(source, 'foo');
    assert.equal(out.length, source.length);
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
