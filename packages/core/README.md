# @pharmstation/core

Shared business logic, data models, and core utilities for the PharmStation application.

## Overview

This package contains the fundamental data structures, validation rules, synchronization logic, and utility functions that are shared across the entire PharmStation ecosystem. It serves as the foundation for all other packages and applications.

## What Goes Here

This package is home to:

- **Data Models**: TypeScript interfaces and types for core domain entities
- **Validation Rules**: Entry validation logic and constraint enforcement
- **Sync Engine**: Offline-first synchronization logic for handling network disconnections
- **Utility Functions**: Reusable helpers used across the application

## Key Features & Responsibilities

### Data Models (`src/models/`)
- **CD Register**: Central Dispensary register definitions for pharmacy operations
- **RP Log**: Receiving and Procurement log structures
- **POM (Prescription Only Medicine)**: Type definitions for controlled medications
- Domain entities for core pharmacy operations

### Validation (`src/validation/`)
- Entry validation rules for inventory operations
- Constraint enforcement for pharmacy regulations
- Type-safe validation functions
- Error handling and messaging

### Sync Engine (`src/sync/`)
- Offline-first database synchronization
- Queue management for pending operations
- Conflict resolution strategies
- Network state detection and handling

### Utils (`src/utils/`)
- Date/time utilities
- Number formatting and calculations
- String manipulation helpers
- Common type guards and assertions

## Usage Examples

### Using Data Models
```typescript
import { CDRegisterEntry, RPLogEntry, POMProduct } from '@pharmstation/core';

const entry: CDRegisterEntry = {
  id: 'entry-001',
  productName: 'Aspirin',
  quantity: 100,
  date: new Date(),
  // ... other fields
};
```

### Using Validation
```typescript
import { validateInventoryEntry, ValidationError } from '@pharmstation/core';

try {
  const isValid = validateInventoryEntry(entry);
} catch (error: ValidationError) {
  console.error('Validation failed:', error.message);
}
```

### Using Sync Engine
```typescript
import { SyncEngine } from '@pharmstation/core';

const syncEngine = new SyncEngine();
await syncEngine.sync();
```

### Using Utils
```typescript
import { formatDate, calculateDosage, slugify } from '@pharmstation/core';

const formatted = formatDate(new Date());
const dosage = calculateDosage(quantity, strength);
const slug = slugify('Product Name');
```

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js (for server-side utilities)
- **Database**: Supabase (models designed to match schema)
- **Testing**: Jest (recommended)

## Directory Structure

```
packages/core/
├── README.md
├── package.json
├── src/
│   ├── models/           # Data models and types
│   ├── validation/       # Validation rules and logic
│   ├── sync/            # Offline sync engine
│   ├── utils/           # Utility functions
│   └── index.ts         # Main entry point
├── dist/                # Compiled JavaScript (generated)
└── tsconfig.json        # TypeScript configuration
```

## Related Documentation

- [Models Documentation](./src/models/README.md)
- [Validation Documentation](./src/validation/README.md)
- [Sync Engine Documentation](./src/sync/README.md)
- [Utils Documentation](./src/utils/README.md)
- [Supabase Client Package](./../supabase-client/README.md)
- [Types Package](./../types/README.md)

## Dependencies

This package should have **minimal external dependencies** to keep it lightweight and ensure it can be used in various environments (web, mobile, server).

## Contributing

When adding to this package:
1. Keep domain logic separated by concern (models, validation, sync, utils)
2. Write comprehensive JSDoc comments
3. Include TypeScript types for all exports
4. Add validation logic for data models
5. Create unit tests in `__tests__` directories

## License

Proprietary - PharmStation
