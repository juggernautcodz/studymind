interface AccountDeletionResponse {
  ok: boolean;
}

interface AccountDeletionDependencies {
  getAuthToken: () => Promise<string | null>;
  deleteFromServer: (token: string) => Promise<AccountDeletionResponse>;
  clearLocalAccount: () => Promise<void>;
  detachActiveUser: () => void;
  clearQueryCache: () => void;
  clearUserState: () => void;
}

export async function deleteAccountAfterServerConfirmation({
  getAuthToken,
  deleteFromServer,
  clearLocalAccount,
  detachActiveUser,
  clearQueryCache,
  clearUserState,
}: AccountDeletionDependencies): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Authentication required");
  }

  const response = await deleteFromServer(token);
  if (!response.ok) {
    throw new Error("Server deletion failed");
  }

  await clearLocalAccount();
  detachActiveUser();
  clearQueryCache();
  clearUserState();
}
