{
  "name": "@{{AUTHOR}}/{{NAME}}",
  "version": "0.1.0",
  "private": true,
  "description": "An Amiba Extension.",
  "scripts": {
    "build": "rm -rf dist && vite build -c vite.main.config.ts && vite build -c vite.ui.config.ts",
    "dev": "amiba dev",
    "pack": "amiba pack",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "electron": "*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@amiba/extension-api": "^0.1.0",
    "@amiba/cli": "^0.1.0",
    "@amiba/tailwind-preset": "^0.1.0",
    "@types/node": "^20.0.0",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.3",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.49",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3",
    "vite": "5.4.10"
  }
}
