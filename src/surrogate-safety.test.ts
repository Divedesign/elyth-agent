import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Reproduce the exact truncation logic used in logger.ts and dev-session.ts
 * to verify surrogate pair safety.
 */

/** logger.ts:83-87 の再現 */
function loggerPreview(content: string): string {
  const chars = Array.from(content);
  return chars.length > 200
    ? chars.slice(0, 200).join('') + '...'
    : content;
}

/** dev-session.ts:167-169 の再現 */
function historyPreview(content: string): string {
  const chars = Array.from(content);
  let preview = chars.slice(0, 100).join('');
  if (chars.length > 100) preview += '...';
  return preview;
}

/** Verify no lone surrogates exist in a string */
function assertNoLoneSurrogates(str: string): void {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = str.charCodeAt(i + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff,
        `Lone high surrogate at position ${i}: 0x${code.toString(16)}`);
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      const prev = str.charCodeAt(i - 1);
      assert.ok(prev >= 0xd800 && prev <= 0xdbff,
        `Lone low surrogate at position ${i}: 0x${code.toString(16)}`);
    }
  }
}

describe('loggerPreview (200 char truncation)', () => {
  it('does not split emoji at boundary', () => {
    const content = 'a'.repeat(199) + '👍extra';
    const result = loggerPreview(content);

    assert.doesNotThrow(() => JSON.stringify(result));
    assertNoLoneSurrogates(result);
  });

  it('handles all-emoji content', () => {
    const content = '🎉🎊🎈🎁🎂'.repeat(50); // 250 emoji
    const result = loggerPreview(content);

    assert.doesNotThrow(() => JSON.stringify(result));
    assertNoLoneSurrogates(result);
    assert.ok(result.endsWith('...'));
  });

  it('old .slice() would have split surrogate pair (proof)', () => {
    const content = 'a'.repeat(199) + '👍';
    // Old broken behavior
    const broken = content.slice(0, 200);
    const lastCode = broken.charCodeAt(199);
    assert.ok(lastCode >= 0xd800 && lastCode <= 0xdbff,
      'Old .slice() should produce lone high surrogate');

    // Fixed behavior
    const fixed = loggerPreview(content + 'x');
    assertNoLoneSurrogates(fixed);
  });

  it('preserves short content with emoji unchanged', () => {
    const content = 'Hello 👋 World 🌍';
    const result = loggerPreview(content);
    assert.equal(result, content);
  });
});

describe('historyPreview (100 char truncation)', () => {
  it('does not split emoji at boundary', () => {
    const content = 'a'.repeat(99) + '🔥more';
    const result = historyPreview(content);

    assert.doesNotThrow(() => JSON.stringify(result));
    assertNoLoneSurrogates(result);
  });

  it('handles mixed CJK + emoji at boundary', () => {
    const content = 'あ'.repeat(49) + 'a' + '😀tail'; // 52 graphemes
    const result = historyPreview(content);

    assert.doesNotThrow(() => JSON.stringify(result));
    assertNoLoneSurrogates(result);
  });

  it('handles flag emoji (4 UTF-16 code units)', () => {
    const content = 'x'.repeat(99) + '🇯🇵rest';
    const result = historyPreview(content);

    assert.doesNotThrow(() => JSON.stringify(result));
    assertNoLoneSurrogates(result);
  });

  it('old .slice() would have split surrogate pair (proof)', () => {
    const content = 'a'.repeat(99) + '👍';
    // Old broken behavior
    const broken = content.slice(0, 100);
    const lastCode = broken.charCodeAt(99);
    assert.ok(lastCode >= 0xd800 && lastCode <= 0xdbff,
      'Old .slice() should produce lone high surrogate');

    // Fixed behavior
    const fixed = historyPreview(content + 'x');
    assertNoLoneSurrogates(fixed);
  });
});
