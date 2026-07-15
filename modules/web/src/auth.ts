import { signIn as amplifySignIn, signOut as amplifySignOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

export async function signIn(email: string, password: string): Promise<void> {
  await amplifySignIn({ username: email, password });
}

export async function signOut(): Promise<void> {
  await amplifySignOut();
}

export async function currentEmail(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.signInDetails?.loginId ?? user.username ?? null;
  } catch {
    return null;
  }
}

export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}
