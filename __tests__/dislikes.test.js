/*
 * Unit tests for the dislike extraction logic in chat.js.
 *
 * These tests cover common misspellings, plural and singular forms,
 * low confidence paths and rejection of non‑shoe complaints.  They
 * dynamically import the chat module (an ES module) and execute its
 * exported parseContext function.  If a test fails an assertion
 * error will be thrown and the process will exit with a non‑zero
 * status.
 */

const assert = require('assert');

async function run() {
  // Import from chat-utils to avoid pulling in the OpenAI client.  The
  // helpers exported here are pure and do not depend on external APIs.
  const chatUtils = await import('../pages/api/chat-utils.js');
  const { parseContext } = chatUtils;

  // Helper to run a single test case
  async function testCase(description, input, expectedDislikes, expectedClarificationsLength = 0) {
    const ctx = parseContext([], input);
    try {
      assert.deepStrictEqual(
        ctx.dislikes.sort(),
        expectedDislikes.sort(),
        `${description}: expected dislikes ${JSON.stringify(expectedDislikes)} but got ${JSON.stringify(ctx.dislikes)}`,
      );
      assert.strictEqual(
        ctx.dislikeClarifications.length,
        expectedClarificationsLength,
        `${description}: expected ${expectedClarificationsLength} clarifications but got ${ctx.dislikeClarifications.length}`,
      );
      console.log(`✓ ${description}`);
    } catch (err) {
      console.error(`✗ ${description}\n  ${err.message}`);
      throw err;
    }
  }

  // Known failures and fixes
  await testCase(
    'Typo and article removal ("t novablast")',
    "I didn't like t novablast, it felt odd.",
    ['novablast 4'],
  );
  await testCase(
    'Exact match of Pegasus model',
    "I don't like the Pegasus 41",
    ['pegasus 41'],
  );
  await testCase(
    'Plural form of Pegasus',
    "I'm not a fan of the Pegasus shoes",
    ['pegasus 41'],
  );
  await testCase(
    'Misspelled Pegasus ("pegasu 41")',
    "I hated the pegasu 41", 
    ['pegasus 41'],
  );
  await testCase(
    'Non‑shoe complaint should not register',
    "I hated the laces and the fit",
    [],
    0,
  );
  await testCase(
    'Ambiguous shoe ("xblast") should trigger clarification',
    "I didn't like xblast",
    [],
    1,
  );
  await testCase(
    'Multiple shoes in one dislike statement',
    "I didn't like the Asics Novablast and Gel-Cumulus 26",
    ['novablast 4', 'gel-cumulus 26'],
  );
  await testCase(
    'Non‑shoe complaints only',
    "The price and the laces were terrible",
    [],
    0,
  );
}

run().catch((err) => {
  process.exitCode = 1;
});