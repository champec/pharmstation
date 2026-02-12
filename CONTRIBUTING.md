# Contributing to PharmStation

Thank you for your interest in contributing to PharmStation! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)
- [Questions?](#questions)

## Code of Conduct

We expect all contributors to:
- Be respectful and inclusive
- Focus on constructive feedback
- Prioritize patient safety and data security
- Maintain compliance with UK pharmacy regulations

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Git
- For desktop development: Rust 1.70+
- For mobile development: Xcode (iOS) / Android Studio (Android)

### Initial Setup

```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/YOUR_USERNAME/pharmstation.git
cd pharmstation

# Add upstream remote
git remote add upstream https://github.com/champec/pharmstation.git

# Install dependencies
pnpm install

# Create a branch for your work
git checkout -b feature/your-feature-name
```

## Development Workflow

### 1. Stay Up to Date

```bash
# Fetch latest changes from upstream
git fetch upstream

# Rebase your branch on upstream/main
git rebase upstream/main
```

### 2. Make Changes

- Write code following our [coding standards](#coding-standards)
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

### 3. Test Your Changes

```bash
# Run linting
pnpm lint

# Run type checking
pnpm type-check

# Run tests
pnpm test

# Test specific package
pnpm --filter @pharmstation/core test
```

### 4. Commit Your Changes

Follow our [commit guidelines](#commit-guidelines)

### 5. Push and Create PR

```bash
# Push your branch
git push origin feature/your-feature-name

# Create a Pull Request on GitHub
```

## Project Structure

```
pharmstation/
├── apps/           # Applications (web, desktop, mobile)
├── packages/       # Shared packages (core, ui, types, etc.)
├── supabase/       # Backend (database, functions)
├── tooling/        # Shared configuration
├── branding/       # Brand assets
└── documentation/  # All documentation
```

See [Monorepo Structure](./documentation/technical/monorepo-structure.md) for details.

## Coding Standards

### TypeScript

- Use TypeScript for all code
- Enable strict mode
- Define explicit return types for functions
- Use interfaces over types (except for unions)
- Avoid `any` — use `unknown` if type is truly unknown

**Good:**
```typescript
interface CDEntry {
  id: string
  drugName: string
  quantity: number
}

function createEntry(data: CDEntry): CDEntry {
  return { ...data }
}
```

**Bad:**
```typescript
function createEntry(data: any) {
  return data
}
```

### React

- Use functional components with hooks
- Use TypeScript for props
- Keep components small and focused
- Extract reusable logic to custom hooks
- Use proper prop drilling or context for state

**Good:**
```typescript
interface ButtonProps {
  onClick: () => void
  children: React.ReactNode
  variant?: 'primary' | 'secondary'
}

export function Button({ onClick, children, variant = 'primary' }: ButtonProps) {
  return (
    <button onClick={onClick} className={variant}>
      {children}
    </button>
  )
}
```

### Naming Conventions

- **Files**: `kebab-case.tsx` or `kebab-case.ts`
- **Components**: `PascalCase` (e.g., `CDRegisterEntry`)
- **Functions**: `camelCase` (e.g., `calculateBalance`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_CD_BALANCE`)
- **Types/Interfaces**: `PascalCase` (e.g., `CDEntry`, `PharmacyData`)

### File Organization

```typescript
// 1. Imports (external, then internal)
import React from 'react'
import { useState } from 'react'

import { CDEntry } from '@pharmstation/types'
import { validateEntry } from './utils'

// 2. Types/Interfaces
interface ComponentProps {
  // ...
}

// 3. Component
export function Component({ }: ComponentProps) {
  // ...
}

// 4. Helper functions (if not extracted)
function helperFunction() {
  // ...
}
```

### Comments

- Use comments sparingly — code should be self-documenting
- Add comments for:
  - Complex algorithms
  - Regulatory requirements
  - Non-obvious business logic
  - TODOs with context

```typescript
// Calculate running balance according to MDR 2001 requirements
// Balance must be updated with each supply or receipt
function calculateRunningBalance(entries: CDEntry[]): number {
  // TODO: Add reconciliation check for discrepancies
  return entries.reduce((balance, entry) => {
    return entry.type === 'receipt' 
      ? balance + entry.quantity
      : balance - entry.quantity
  }, 0)
}
```

## Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks
- **ci**: CI/CD changes

### Examples

```
feat(cd-register): add correction workflow

Implement the correction workflow for CD register entries that
maintains audit trail by creating a new entry referencing the
original incorrect entry.

Closes #123
```

```
fix(rp-log): prevent duplicate sign-in entries

Add validation to prevent pharmacists from signing in twice
without signing out first.

Fixes #456
```

### Compliance-Related Commits

For commits affecting compliance features, add a footer:

```
feat(cd-register): add Schedule 3 support

Extends CD register to support Schedule 3 controlled drugs
with appropriate validation rules.

Compliance: Meets MDR 2001 Schedule 3 requirements
Closes #789
```

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated
- [ ] No console warnings or errors
- [ ] Compliance considerations addressed (if applicable)
- [ ] Self-review completed

### PR Template

Use the provided PR template (`.github/PULL_REQUEST_TEMPLATE.md`)

### Review Process

1. **Automated Checks**: CI must pass (tests, linting, type-checking)
2. **Code Review**: At least one approval required
3. **Compliance Review**: For compliance features, additional review by pharmacy expert
4. **Testing**: Reviewer may request additional testing
5. **Merge**: Squash and merge (maintainers only)

### After Merge

Your branch will be automatically deleted. Pull latest `main`:

```bash
git checkout main
git pull upstream main
```

## Testing

### Unit Tests

- Test business logic in isolation
- Mock external dependencies
- Use descriptive test names

```typescript
describe('calculateBalance', () => {
  it('should calculate correct balance with mixed entries', () => {
    const entries = [
      { type: 'receipt', quantity: 100 },
      { type: 'supply', quantity: 25 },
      { type: 'supply', quantity: 10 },
    ]
    
    expect(calculateBalance(entries)).toBe(65)
  })
  
  it('should handle empty entries array', () => {
    expect(calculateBalance([])).toBe(0)
  })
})
```

### Integration Tests

- Test interactions between components/modules
- Use realistic data
- Test error scenarios

### E2E Tests

- Test complete user workflows
- Focus on critical paths (CD entry, RP sign-in, etc.)
- Run on multiple browsers (web) or devices (mobile)

## Documentation

### Code Documentation

- Add JSDoc comments for public APIs
- Include examples where helpful
- Document parameters and return types

```typescript
/**
 * Creates a new CD register entry with validation
 * 
 * @param data - The entry data to create
 * @returns The created entry with generated ID
 * @throws {ValidationError} If entry data is invalid
 * 
 * @example
 * ```typescript
 * const entry = await createCDEntry({
 *   drugName: 'Morphine Sulphate',
 *   strength: '10mg',
 *   quantity: 100,
 *   type: 'receipt'
 * })
 * ```
 */
export async function createCDEntry(data: CDEntryInput): Promise<CDEntry> {
  // ...
}
```

### README Updates

- Update README.md if you add/change features
- Keep documentation in sync with code
- Add examples for new functionality

### Architecture Decisions

For significant architectural changes, create an ADR (Architecture Decision Record) in `documentation/technical/adr/`.

## Compliance Considerations

### When Working on Compliance Features

If your contribution affects:
- CD Register
- RP Log
- Patient Returns
- Private CD Register

You **must**:

1. **Understand Regulations**:
   - Read relevant documentation in `documentation/legal-and-compliance/`
   - Understand GPhC requirements
   - Understand Misuse of Drugs Regulations 2001

2. **Maintain Audit Trail**:
   - Never delete or overwrite historical records
   - Always use correction workflows
   - Include user_id and timestamps

3. **Validate Thoroughly**:
   - Add validation rules
   - Test edge cases
   - Prevent invalid data entry

4. **Document Compliance**:
   - Note which regulation is being met
   - Reference specific requirements
   - Explain compliance rationale in comments

## Security

### Reporting Security Issues

**DO NOT** create a public issue for security vulnerabilities.

Instead:
1. Email security@pharmstation.co.uk (to be added)
2. Or use GitHub Security Advisories (private)

### Security Guidelines

- Never commit secrets or API keys
- Validate all user inputs
- Use parameterized queries
- Follow OWASP best practices
- Consider GDPR implications

## Questions?

- **Documentation**: Check [documentation/](./documentation/)
- **Discussions**: Use GitHub Discussions
- **Slack**: [Join our Slack](#) (to be added)
- **Email**: dev@pharmstation.co.uk (to be added)

---

Thank you for contributing to PharmStation! 🎉

Every contribution, no matter how small, helps improve pharmacy compliance and patient safety.
