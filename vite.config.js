import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
    sourcemap: false,        
    minify: 'terser',        
    terserOptions: {
      compress: {
        drop_console: true,  
        drop_debugger: true, 
      },
      mangle: {
        toplevel: true,      
      },
      format: {
        comments: false,    
      }
    }
  },
})
