import { Amplify } from 'aws-amplify';

export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  graphqlUrl: string;
  envName: string;
}

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
  return res.json() as Promise<AppConfig>;
}

export function configureAmplify(cfg: AppConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.userPoolId,
        userPoolClientId: cfg.userPoolClientId,
        signUpVerificationMethod: 'code',
        loginWith: { email: true },
      },
    },
  });
}
