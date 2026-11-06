const SAFE_ITEM_ID_PATTERN = /^[\w-]+$/;

function assertSafeItemId(itemId, errorMessage) {
  if (!itemId || !SAFE_ITEM_ID_PATTERN.test(itemId)) {
    throw new Error(errorMessage);
  }
}

module.exports = { assertSafeItemId, SAFE_ITEM_ID_PATTERN };
