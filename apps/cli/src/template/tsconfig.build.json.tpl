{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src/index.ts"],
  "exclude": ["src/client"]
}
