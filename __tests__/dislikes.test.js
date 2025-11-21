/*
 * Unit tests for the dislike extraction logic in chat-utils.
 */

import assert from 'node:assert';

async function run() {
  const chatUtils = await import('../pages/api/chat-utils.js');
  const { parseContext } = chatUtils;

  async function testCase(description, input, expectedDislikes) {
    const ctx = parseContext([], input);
    try {
      assert.deepStrictEqual(
        ctx.dislikes.sort(),
        expectedDislikes.sort(),
        `${description}: expected dislikes ${JSON.stringify(expectedDislikes)} but got ${JSON.stringify(ctx.dislikes)}`,
      );
      console.log(`✓ ${description}`);
    } catch (err) {
      console.error(`✗ ${description}\n  ${err.message}`);
      throw err;
    }
  }

  await testCase(
    'Typo and article removal ("t novablast")',
    "I didn't like t novablast, it felt odd.",
    ['novablast'],
  );
  await testCase('Exact match of Pegasus model', "I don't like the Pegasus 41", ['pegasus 41']);
  await testCase('Plural form of Pegasus', "I'm not a fan of the Pegasus shoes", ['pegasus']);
  await testCase('Non‑shoe complaint should not register', 'I hated the laces and the fit', []);
  await testCase(
    'Multiple shoes in one dislike statement',
    "I didn't like the Asics Novablast and Gel-Cumulus 26",
    ['asics novablast', 'gel-cumulus 26'],
  );
}

run().catch((err) => {
  process.exitCode = 1;
});
