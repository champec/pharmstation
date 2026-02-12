# TypeScript Configuration

This directory contains shared TypeScript configuration for the PharmStation monorepo.

## TODO: Add TypeScript Configuration

Create shared TypeScript configs that can be extended by apps and packages:

### Files to Create:
- `base.json` - Base TypeScript config
- `nextjs.json` - Config for Next.js projects
- `react.json` - Config for React projects
- `node.json` - Config for Node.js projects
- `package.json` - Package config for this tooling package

### Example Base Config:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

### Usage in Apps:
```json
// apps/web/tsconfig.json
{
  "extends": "../../tooling/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```
