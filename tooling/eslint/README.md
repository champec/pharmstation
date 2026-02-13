# ESLint Configuration

This directory contains shared ESLint configuration for the PharmStation monorepo.

## TODO: Add ESLint Configuration

Create shared ESLint configs that can be extended by apps and packages:

### Files to Create:
- `base.js` - Base ESLint rules for all JavaScript/TypeScript
- `react.js` - Additional rules for React projects
- `node.js` - Rules for Node.js/backend code
- `package.json` - Package config for this tooling package

### Example Base Config:
```js
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    // Custom rules
  }
}
```

### Usage in Apps:
```js
// apps/web/.eslintrc.js
module.exports = {
  extends: ['../../tooling/eslint/base.js', '../../tooling/eslint/react.js']
}
```
