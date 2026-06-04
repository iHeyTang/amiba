{
  "name": "@{{AUTHOR}}/{{NAME}}",
  "version": "0.1.0",
  "private": true,
  "description": "A hermes-x extension.",
  "scripts": {
    "build": "rm -rf dist && vite build -c vite.main.config.ts && vite build -c vite.ui.config.ts",
    "dev": "hermes-x-ext dev",
    "pack": "hermes-x-ext pack",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "electron": "*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@hermes-x/extension-api": "*",
    "@hermes-x/extension-cli": "*",
    "@hermes-x/tailwind-preset": "*",
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
