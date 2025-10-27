import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  plugins: [
    react(),
    {
      // copy manifest.json after build
      name: 'copy-manifest',
      closeBundle() {
        try {
          mkdirSync('dist', { recursive: true })
          copyFileSync('manifest.json', 'dist/manifest.json')
          console.log('🟢 manifest.json copied to dist/')
        } catch (err) {
          console.error('Failed to copy manifest.json:', err)
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, 'sidebar.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js'
          if (chunk.name === 'content') return 'content.js'
          return '[name].js'
        },
        assetFileNames: 'assets/[name][extname]',
      },
    },
    emptyOutDir: true,
  },
})
