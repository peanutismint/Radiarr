import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './client/context/AuthContext.tsx';
import './index.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);

  // Online demo (GitHub Pages): a service worker stands in for the Radiarr server.
  if (import.meta.env.MODE === 'demo') {
    const { startDemoWorker, DemoBanner } = await import('./client/demo/demo.tsx');
    try {
      await startDemoWorker();
    } catch (err) {
      root.render(<DemoBanner error={String((err as Error)?.message ?? err)} />);
      return;
    }
    root.render(
      <>
        <DemoBanner />
        <AuthProvider>
          <App />
        </AuthProvider>
      </>
    );
    return;
  }

  root.render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

void start();
