{
  "name": "@{{AUTHOR}}/{{NAME}}",
  "version": "0.1.0",
  "private": true,
  "description": "An independent Amiba DSH plugin.",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "README.md"],
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@amiba/dsh-plugin-ui-shell"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json && vite build",
    "dev": "amiba plugin dev",
    "pack": "amiba plugin pack",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.6",
    "react": "18.3.1"
  },
  "devDependencies": {
    "@amiba/cli": "^0.1.0",
    "@amiba/extension-sdk": "^0.1.0",
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.6",
    "@types/node": "22.9.0",
    "@types/react": "18.3.12",
    "react": "18.3.1",
    "typescript": "5.6.3",
    "vite": "^5.4.11"
  }
}
