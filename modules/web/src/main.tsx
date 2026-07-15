import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadConfig, configureAmplify } from './config';
import { setGraphqlUrl } from './graphql';
import App from './App';

async function boot() {
  const cfg = await loadConfig();
  configureAmplify(cfg);
  setGraphqlUrl(cfg.graphqlUrl);

  const root = document.getElementById('root')!;
  createRoot(root).render(
    <StrictMode>
      <App config={cfg} />
    </StrictMode>,
  );
}

boot().catch((err) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px">${err}</pre>`;
});
