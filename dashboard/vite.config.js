import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'

// Automatically start the API server alongside Vite
export default defineConfig(({ command }) => {
  if (command === 'serve') {
    const apiServer = spawn('node', ['api-server.mjs'], { 
      stdio: 'inherit'
    });
    process.on('exit', () => apiServer.kill());
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: process.env.BACKEND_URL || 'http://localhost:3900',
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.error('\x1b[31m[proxy] Backend unreachable:\x1b[0m', err.message);
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: `Backend server unreachable (${err.code || err.message}). Make sure api-server is running: node dashboard/api-server.mjs`
                }));
              }
            });
          },
        },
      },
    },
  };
});
