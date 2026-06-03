{
  "name": "@{{AUTHOR}}/{{NAME}}",
  "version": "0.1.0",
  "private": true,
  "description": "A hermes-x extension.",
  "type": "module",
  "scripts": {
    "build": "hermes-x-ext build",
    "dev": "hermes-x-ext dev",
    "pack": "hermes-x-ext pack",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@hermes-x/extension-api": "*",
    "@hermes-x/extension-host": "*",
    "@hermes-x/extension-cli": "*",
    "@types/node": "^20.0.0",
    "@types/react": "18.3.12",
    "@vitejs/plugin-react": "^4.3.3",
    "react": "^18.3.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
