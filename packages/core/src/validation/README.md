# Validation

Entry validation rules, constraints, and validation logic for PharmStation.

## Overview

This directory contains all validation logic used to ensure data integrity and enforce business rules across the PharmStation system. It provides a single source of truth for validation rules.

## What Goes Here

### Validation Rules
- Inventory entry constraints
- Quantity and pricing validation
- Date and expiry date checks
- User permission and role-based validation
- Regulatory compliance checks
- Format validation (codes, names, numbers)

### Validators
- Entry validators for CD Register
- RP Log validators
- POM medication validators
- Batch and product code validators
- Supplier information validators
- Patient data validators

### Error Handling
- Custom validation error types
- Descriptive error messages
- Error code system for API responses
- Multilingual error message support

## Key Responsibilities

1. **Rule Enforcement**: Implement business rules consistently across the application
2. **Data Integrity**: Prevent invalid data from entering the system
3. **Error Messages**: Provide clear, actionable error messages to users
4. **Type Safety**: Leverage TypeScript for compile-time checks before runtime validation
5. **Reusability**: Share validation logic between frontend and backend

## Key Validation Rules

### Inventory Entry Validation
- Quantity must be positive
- Unit price must be non-negative
- Date must not be in the future (for past entries)
- Required fields must be present
- Product ID must reference a valid product

### Expiry Date Validation
- Expiry date must be in the future
- Warn if expiry is within 3 months
- Alert if expiry is within 1 week
- Block if already expired

### Pricing Validation
- Unit price must match expected range
- Total cost = quantity × unit price
- Price changes require audit trail
- Negative prices not allowed

### Quantity Validation
- Must be a positive number
- Must match available stock
- Stock adjustment must maintain accuracy
- Transfers must balance (from/to match)

### Permission Validation
- User role must allow operation
- Pharmacist approval required for POM medications
- Manager approval for price adjustments
- Audit logging of permission checks

## Usage Examples

### Basic Validation
```typescript
import { validateCDRegisterEntry, ValidationError } from '@pharmstation/core/validation';

try {
  const errors = validateCDRegisterEntry(entry);
  if (errors.length > 0) {
    console.error('Validation errors:', errors);
  }
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

### Detailed Error Handling
```typescript
import { validateInventoryEntry, ValidationErrorCode } from '@pharmstation/core/validation';

const result = validateInventoryEntry(entry);
if (!result.isValid) {
  result.errors.forEach(error => {
    switch (error.code) {
      case ValidationErrorCode.EXPIRED:
        // Handle expiry date error
        break;
      case ValidationErrorCode.INSUFFICIENT_STOCK:
        // Handle stock error
        break;
      case ValidationErrorCode.INVALID_PERMISSION:
        // Handle permission error
        break;
    }
  });
}
```

### Custom Validator Creation
```typescript
import { createValidator } from '@pharmstation/core/validation';

const myValidator = createValidator({
  rules: [
    { field: 'quantity', rule: (val) => val > 0, message: 'Quantity must be positive' },
    { field: 'date', rule: (val) => val <= new Date(), message: 'Date cannot be in future' }
  ]
});

const errors = myValidator(myObject);
```

### Async Validation (with Database)
```typescript
import { validateWithDatabase } from '@pharmstation/core/validation';

const result = await validateWithDatabase(entry, supabaseClient);
// Checks against actual database constraints
```

## Error Types

### ValidationError
- Specific field that failed validation
- Error code for programmatic handling
- User-friendly error message
- Severity level (error, warning, info)

### Error Codes
- `INVALID_FORMAT`: Data format incorrect
- `OUT_OF_RANGE`: Value outside acceptable range
- `EXPIRED`: Item has passed expiry date
- `INSUFFICIENT_STOCK`: Not enough inventory
- `INVALID_PERMISSION`: User not authorized
- `DUPLICATE_ENTRY`: Record already exists
- `REQUIRED_FIELD_MISSING`: Mandatory field empty
- `INVALID_REFERENCE`: Related record doesn't exist

## Validation Strategy

### Frontend Validation
- Real-time validation as user types
- Immediate feedback on format errors
- Visual error indicators
- Disable submit until valid

### Backend Validation
- Complete re-validation on server
- Security-sensitive checks
- Database constraint verification
- Audit logging of validation failures

### Offline Validation
- Works without network connection
- Uses local rules only
- Marks entries for re-validation when online
- Queue for validation when syncing

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js, Browser
- **Pattern**: Visitor pattern for composable validators
- **Testing**: Jest with snapshot testing for error messages

## Related Documentation

- [Models Documentation](../models/README.md)
- [Sync Engine Documentation](../sync/README.md)
- [Supabase Client Package](../../supabase-client/README.md)

## Contributing Guidelines

When adding validation rules:
1. Keep rules focused and single-purpose
2. Provide clear error messages
3. Write comprehensive tests
4. Consider both frontend and backend use
5. Document any database dependencies
6. Update error code enums
7. Add examples to this README

## Best Practices

1. **Validate Early**: Check data as soon as it enters the system
2. **Validate Everywhere**: Never trust the source, validate at each boundary
3. **Clear Messages**: Users should understand what's wrong and how to fix it
4. **Type Safety**: Use TypeScript to catch errors before runtime
5. **Performance**: Optimize validators to prevent UI lag
6. **Consistency**: Keep validation rules consistent across UI, API, and database
