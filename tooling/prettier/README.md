# Prettier Configuration

This directory contains shared Prettier configuration for the PharmStation monorepo.

## TODO: Add Prettier Configuration

Create shared Prettier config for consistent code formatting:

### Files to Create:
- `.prettierrc.js` - Prettier configuration
- `.prettierignore` - Files/directories to ignore
- `package.json` - Package config for this tooling package

### Example Config:
```js
// .prettierrc.js
module.exports = {
  semi: false,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',
}
```

### Example Ignore:
```
# .prettierignore
node_modules
dist
build
.next
.turbo
coverage
*.min.js
```

### Usage:
Apps and packages extend from this shared config.

```json
// package.json in app/package
{
  "prettier": "../../tooling/prettier/.prettierrc.js"
}
```
