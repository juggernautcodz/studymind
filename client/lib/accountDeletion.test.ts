import assert from "node:assert/strict";
import test from "node:test";

import { deleteAccountAfterServerConfirmation } from "./accountDeletion";

function createHarness({
  token = "valid-token",
  serverOk = true,
  serverError,
}: {
  token?: string | null;
  serverOk?: boolean;
  serverError?: Error;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      getAuthToken: async () => token,
      deleteFromServer: async (receivedToken: string) => {
        calls.push(`server:${receivedToken}`);
        if (serverError) throw serverError;
        return { ok: serverOk };
      },
      clearLocalAccount: async () => {
        calls.push("clear-local");
      },
      detachActiveUser: () => {
        calls.push("detach-user");
      },
      clearQueryCache: () => {
        calls.push("clear-cache");
      },
      clearUserState: () => {
        calls.push("clear-user-state");
      },
    },
  };
}

test("missing authentication fails before server deletion or local cleanup", async () => {
  const harness = createHarness({ token: null });

  await assert.rejects(
    deleteAccountAfterServerConfirmation(harness.dependencies),
    /Authentication required/,
  );
  assert.deepEqual(harness.calls, []);
});

test("server rejection is propagated without clearing local account state", async () => {
  const harness = createHarness({ serverOk: false });

  await assert.rejects(
    deleteAccountAfterServerConfirmation(harness.dependencies),
    /Server deletion failed/,
  );
  assert.deepEqual(harness.calls, ["server:valid-token"]);
});

test("network failure is propagated without clearing local account state", async () => {
  const harness = createHarness({
    serverError: new Error("network unavailable"),
  });

  await assert.rejects(
    deleteAccountAfterServerConfirmation(harness.dependencies),
    /network unavailable/,
  );
  assert.deepEqual(harness.calls, ["server:valid-token"]);
});

test("confirmed server deletion clears local account state in order", async () => {
  const harness = createHarness();

  await deleteAccountAfterServerConfirmation(harness.dependencies);

  assert.deepEqual(harness.calls, [
    "server:valid-token",
    "clear-local",
    "detach-user",
    "clear-cache",
    "clear-user-state",
  ]);
});
