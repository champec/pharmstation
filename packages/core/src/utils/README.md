# Utils

Reusable utility functions and helpers for PharmStation.

## Overview

This directory contains general-purpose utility functions that are used throughout the PharmStation application. These utilities focus on common operations like date formatting, calculations, string manipulation, and type checking.

## What Goes Here

### Date & Time Utilities
- Date formatting and parsing
- Timezone handling
- Duration calculations
- Expiry date checks
- Age calculations

### Number Utilities
- Currency formatting
- Percentage calculations
- Dosage calculations
- Stock quantity validation
- Price rounding

### String Utilities
- Text slugification
- Name capitalization
- Code generation
- Validation pattern helpers
- Text truncation

### Type Guards & Assertions
- Type narrowing functions
- Null/undefined checks
- Data type validators
- Safe type conversions
- Type-safe object access

### Array & Object Utilities
- Deduplication
- Filtering and sorting
- Object merging
- Grouping operations
- Pagination helpers

### Error Utilities
- Error wrapping and chaining
- Stack trace formatting
- Error logging helpers

## Key Responsibilities

1. **Code Reuse**: Provide single implementations of common operations
2. **Type Safety**: Maintain TypeScript type safety across utilities
3. **Performance**: Optimize for efficiency without compromising readability
4. **Consistency**: Ensure uniform behavior across the application
5. **Documentation**: Provide clear examples and use cases

## Usage Examples

### Date Utilities
```typescript
import {
  formatDate,
  formatDateTime,
  isExpired,
  daysUntilExpiry,
  calculateAge
} from '@pharmstation/core/utils';

// Format dates for display
const formatted = formatDate(new Date());           // "2024-01-15"
const fullDate = formatDateTime(new Date());        // "2024-01-15 14:30:00"

// Check expiry
const expired = isExpired(expiryDate);              // true/false
const daysLeft = daysUntilExpiry(expiryDate);       // number of days

// Calculate age
const patientAge = calculateAge(dateOfBirth);       // age in years
```

### Number Utilities
```typescript
import {
  formatCurrency,
  formatPercentage,
  calculateDosage,
  roundPrice,
  formatQuantity
} from '@pharmstation/core/utils';

// Format for display
const price = formatCurrency(1234.567);             // "$1,234.57"
const percent = formatPercentage(0.156);            // "15.6%"
const dosage = calculateDosage(10, 500);            // "2 tablets"

// Price calculations
const rounded = roundPrice(19.999);                  // 20.00

// Quantity formatting
const qty = formatQuantity(1000, 'mg');            // "1000 mg"
```

### String Utilities
```typescript
import {
  slugify,
  capitalize,
  generateCode,
  truncate,
  escapeHtml
} from '@pharmstation/core/utils';

// Format product names
const slug = slugify('Paracetamol 500mg');          // "paracetamol-500mg"
const title = capitalize('paracetamol');            // "Paracetamol"

// Generate codes
const code = generateCode('BATCH');                 // "BATCH-2024-001-ABC123"

// Text manipulation
const short = truncate('Long product name', 20);    // "Long product na..."
const safe = escapeHtml('<script>alert(1)</script>'); // Safe HTML
```

### Type Guards
```typescript
import {
  isValidEmail,
  isValidPhone,
  isValidProductCode,
  isDefined,
  isNonEmpty,
  isValidDate
} from '@pharmstation/core/utils';

// Type checking
const email = 'user@example.com';
if (isValidEmail(email)) {
  // Email is valid
}

// Null/undefined checks
if (isDefined(value)) {
  // Value is not null or undefined
}

// Array checks
if (isNonEmpty(array)) {
  // Array has items
}

// Date validation
if (isValidDate(dateString)) {
  // Date is valid
}
```

### Array & Object Utilities
```typescript
import {
  deduplicateBy,
  groupBy,
  filterNullValues,
  mergeObjects,
  paginateArray,
  sortBy
} from '@pharmstation/core/utils';

// Array operations
const unique = deduplicateBy(products, (p) => p.id);
const grouped = groupBy(entries, (e) => e.date);
const filtered = filterNullValues(array);

// Object operations
const merged = mergeObjects(obj1, obj2);

// Pagination
const page = paginateArray(items, 1, 10);          // items 0-9

// Sorting
const sorted = sortBy(products, (p) => p.name);
```

### Safe Type Access
```typescript
import { safeGet, safeParse, hasPath } from '@pharmstation/core/utils';

// Safe object access
const value = safeGet(obj, 'nested.property.path', 'default');

// Safe JSON parsing
const data = safeParse(jsonString, {});

// Check if path exists
if (hasPath(obj, 'nested.property')) {
  // Path exists
}
```

## Utility Categories

### 1. Date/Time (`date.ts`)
- Format, parse, validate dates
- Timezone conversions
- Duration calculations
- Expiry and age checks

### 2. Number (`number.ts`)
- Currency and percentage formatting
- Dosage and quantity calculations
- Rounding and precision handling
- Stock calculations

### 3. String (`string.ts`)
- Case conversions
- Slugification
- Truncation and ellipsis
- Code generation
- HTML escaping

### 4. Validation (`validation.ts`)
- Format validation (email, phone, code)
- Data type checking
- Pattern matching
- Range validation

### 5. Type Guards (`type-guards.ts`)
- Type narrowing functions
- Null/undefined checks
- Array and object checks
- Safe type assertions

### 6. Array/Object (`array.ts`, `object.ts`)
- Deduplication and filtering
- Grouping and sorting
- Merging and transforming
- Safe access patterns

### 7. Error (`error.ts`)
- Error wrapping
- Stack trace formatting
- Error logging helpers

## Performance Notes

- All utilities are optimized for performance
- No external dependencies except TypeScript stdlib
- Functions are pure where possible
- Memoization for expensive operations
- Tree-shakeable exports

## TypeScript Support

- Full TypeScript support with proper types
- Generics for reusable, type-safe utilities
- Type guards that narrow types properly
- Overloads for different input types

## Testing

Each utility includes:
- Unit tests with comprehensive coverage
- Edge case handling
- Performance benchmarks for critical functions
- Examples in test files

## Related Documentation

- [Models Documentation](../models/README.md)
- [Validation Documentation](../validation/README.md)
- [Types Package](../../types/README.md)

## Contributing Guidelines

When adding new utilities:
1. Keep functions small and focused
2. Provide comprehensive JSDoc comments
3. Add TypeScript types for all parameters and returns
4. Include unit tests with edge cases
5. Document performance implications
6. Provide usage examples
7. Keep external dependencies minimal
8. Ensure functions are pure where practical

## Best Practices

1. **Type Safety**: Always use TypeScript types
2. **Pure Functions**: Avoid side effects when possible
3. **Documentation**: Include JSDoc comments
4. **Testing**: Comprehensive unit tests required
5. **Performance**: Consider memory and CPU impact
6. **Reusability**: Design for general use cases
7. **Consistency**: Follow naming conventions
