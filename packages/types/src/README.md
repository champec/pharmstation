# TypeScript Type Definitions

Centralized TypeScript type definitions and interfaces for PharmStation.

## Overview

This directory contains all TypeScript type definitions used throughout the PharmStation ecosystem. These types provide the contracts between different packages and ensure type safety across the application.

## What Goes Here

### Domain Types
- User and authentication types
- Pharmacy entities
- Product definitions
- Inventory records
- Transactions and orders
- Prescriptions

### API Types
- Request/response interfaces
- Error types
- Pagination types
- Filter and search types
- Status codes and constants

### Database Types
- Table row types
- Insert types (new records)
- Update types (partial updates)
- Query result types
- Relationship types

### UI Types
- Component prop interfaces
- Event handler types
- State management types
- Theme and styling types

### Utility Types
- Generic helper types
- Validation types
- Async/Promise types
- Collection types

## Key Type Files

### domain/
```
user.ts              # User, UserRole, Auth types
pharmacy.ts          # Pharmacy, PharmacySettings
product.ts           # Product, Category, Strength
inventory.ts         # InventoryItem, Stock, Movement
transaction.ts       # Sale, Order, Transfer, Return
prescription.ts      # Prescription, Dosage, Patient
```

### api/
```
request.ts           # Request payload types
response.ts          # Response envelope types
error.ts             # Error types and codes
pagination.ts        # Pagination, Filter types
constants.ts         # Status codes, enums
```

### database/
```
schema.ts            # Supabase schema types
tables.ts            # Table row types
queries.ts           # Query result types
mutations.ts         # Insert/update types
```

### ui/
```
props.ts             # Component prop types
events.ts            # Event handler types
states.ts            # Component state types
theme.ts             # Theme and style types
```

### utils/
```
async.ts             # Promise, Async types
validation.ts        # Validation result types
collections.ts       # Array, Set, Map utilities
common.ts            # Common utility types
```

## Type Organization Pattern

```typescript
// Standard export pattern
export type TypeName = {
  // fields
};

export interface InterfaceName {
  // properties
}

export enum EnumName {
  Value1 = 'value1',
  Value2 = 'value2'
}

// Type guards
export function isTypeName(value: unknown): value is TypeName {
  // check logic
}
```

## Using Types Effectively

### Strict Type Checking

```typescript
// Enable strict mode in tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitAny": true,
    "noImplicitThis": true
  }
}
```

### Type Guards

```typescript
// Define type guards for runtime validation
export function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'email' in value &&
    'role' in value
  );
}

// Use in code
if (isUser(data)) {
  console.log(data.name); // Type safe
}
```

### Generic Types

```typescript
// Create reusable generic types
export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type AsyncResult<T, E = Error> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: E }
  | { status: 'pending' };

// Use with different types
const userResponse: ApiResponse<User> = { ... };
const productResult: AsyncResult<Product> = { ... };
```

### Discriminated Unions

```typescript
// Type-safe union types with discriminator field
export type Transaction =
  | { type: 'sale'; amount: number; customer: string }
  | { type: 'refund'; amount: number; orderId: string }
  | { type: 'adjustment'; reason: string; quantity: number };

// Use with type guards
function handleTransaction(transaction: Transaction) {
  switch (transaction.type) {
    case 'sale':
      console.log(transaction.customer); // Available
      break;
    case 'refund':
      console.log(transaction.orderId); // Available
      break;
  }
}
```

### Const Assertions

```typescript
// Create readonly types with as const
export const USER_ROLES = {
  admin: 'admin',
  manager: 'manager',
  pharmacist: 'pharmacist',
  staff: 'staff'
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
```

## Type Definition Best Practices

### 1. Clear Naming
```typescript
// Good
interface UserProfile { ... }
type UserRole = 'admin' | 'pharmacist';
interface CreateUserRequest { ... }

// Avoid
interface User { ... } // Too generic
type Role = 'admin'; // Too simple
```

### 2. Comprehensive Documentation
```typescript
/**
 * User account in the system
 * @property id - Unique identifier
 * @property email - User email address
 * @property role - User role with permissions
 */
interface User {
  id: string;
  email: string;
  role: UserRole;
}
```

### 3. Consistent Field Naming
```typescript
// Good - consistent naming
interface Product {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

// Avoid - inconsistent
interface Product {
  id: string;
  productName: string;
  created: Date;
  modified: Date;
}
```

### 4. Proper Nullability
```typescript
// Good - explicit about optional fields
interface User {
  id: string;
  email: string;
  phoneNumber?: string; // Optional
  lastLogin: Date | null; // Nullable
}

// Avoid - implicit optionals
interface User {
  id?: string; // Should not be optional
  email: string;
  phone: any; // Should be typed
}
```

### 5. Use Union Types Appropriately
```typescript
// Good - discriminated union
type Result<T, E> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: E };

// Avoid - boolean flags
interface Result<T> {
  success: boolean;
  data?: T;
  error?: Error;
}
```

## Exporting from index.ts

```typescript
// Re-export all types from subdirectories
export type * from './domain/user';
export type * from './domain/product';
export type * from './domain/inventory';
export type * from './api/request';
export type * from './api/response';
export * from './database';
export * from './ui/props';
export * from './utils/validation';
```

## Common Type Patterns

### Request/Response Pattern
```typescript
export interface CreateProductRequest {
  name: string;
  category: string;
  strength?: string;
}

export interface CreateProductResponse {
  id: string;
  name: string;
  category: string;
  createdAt: Date;
}
```

### CRUD Types
```typescript
export interface CreateInput {
  // All required fields
}

export interface UpdateInput {
  // All fields optional
}

export interface ListResponse {
  data: T[];
  total: number;
}

export interface GetResponse {
  data: T;
}
```

### State Types
```typescript
type LoadingState = { status: 'loading' };
type SuccessState<T> = { status: 'success'; data: T };
type ErrorState = { status: 'error'; error: Error };
type State<T> = LoadingState | SuccessState<T> | ErrorState;
```

## Testing Types

```typescript
// Use tsd for type testing
import { expectType, expectAssignable } from 'tsd';
import type { User } from './user';

// Verify type
const user: User = { ... };
expectType<User>(user);

// Verify assignability
const anyUser: any = { ... };
expectAssignable<User>(anyUser);
```

## Related Documentation

- [Core Package Models](../core/src/models/README.md)
- [UI Components](../ui/src/components/README.md)
- [Supabase Integration](../supabase-client/README.md)

## Contributing Guidelines

When adding types:
1. Place in appropriate subdirectory
2. Export from directory index.ts
3. Include JSDoc comments
4. Provide type guards when needed
5. Write tests for complex types
6. Update main README
7. Consider backward compatibility
8. Validate against actual usage

## Best Practices

1. **Explicit Types**: Avoid implicit any types
2. **Strict Mode**: Use TypeScript strict mode
3. **Type Guards**: Provide runtime validation
4. **Documentation**: JSDoc all public types
5. **Consistency**: Follow naming conventions
6. **Reusability**: Create generic types
7. **Testing**: Test type safety
8. **Evolution**: Plan for type changes

## Performance Tips

1. Avoid overly deep nesting
2. Use union discriminators efficiently
3. Keep type checking fast
4. Use type-only imports: `import type { ... }`
5. Avoid circular dependencies
6. Keep type definitions focused

## Troubleshooting

**Type not assignable:**
```typescript
// Check if type guard is accurate
// Verify property existence
// Ensure proper null handling
```

**Circular dependencies:**
```typescript
// Move shared types to separate file
// Use type-only imports
// Reorganize module structure
```

**Performance issues:**
```typescript
// Simplify complex unions
// Avoid deep recursion
// Use type-only imports
// Split large type files
```
