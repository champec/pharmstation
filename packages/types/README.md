# @pharmstation/types

Shared TypeScript type definitions and interfaces for all PharmStation packages.

## Overview

This package provides centralized TypeScript type definitions used across all PharmStation packages. It ensures type consistency, reduces duplication, and makes it easy to maintain shared contracts between different parts of the system.

## What Goes Here

This package includes:

- **Domain Types**: Business entities and value objects
- **API Types**: Request/response interfaces
- **UI Types**: Component prop interfaces
- **Database Types**: Schema and query result types
- **Utility Types**: Generic helpers and utilities
- **Enum Types**: Application enums and constants

## Key Type Categories

### Domain Types
- **User & Auth**: User profiles, roles, permissions
- **Pharmacy**: Pharmacy information and settings
- **Products**: Product definitions and metadata
- **Inventory**: Stock tracking and movements
- **Transactions**: Sales, orders, transfers
- **Prescriptions**: Prescription details

### API Types
- **Request Payloads**: Data for API requests
- **Response Envelopes**: Standard response format
- **Error Types**: Error responses
- **Pagination**: Pagination parameters and responses
- **Filtering**: Filter criteria types

### Database Types
- **Tables**: Row types for database tables
- **Queries**: Query result types
- **Mutations**: Mutation input/output types
- **Transactions**: Transaction-related types

### Component Types
- **Props**: React component prop interfaces
- **States**: Component state types
- **Events**: Event handler types
- **Context**: Context value types

### Utility Types
- **Async**: Promise and async helper types
- **Collections**: Array and object utilities
- **Validation**: Validation result types
- **Error Handling**: Error and exception types

## Usage Examples

### Using Domain Types

```typescript
import {
  User,
  Pharmacy,
  Product,
  Inventory,
  CDRegisterEntry
} from '@pharmstation/types';

// User with role
const user: User = {
  id: 'user-001',
  email: 'pharmacist@example.com',
  name: 'Dr. Jane Smith',
  role: 'pharmacist',
  pharmacy: { id: 'pharm-001', name: 'Main Branch' },
  createdAt: new Date(),
  updatedAt: new Date()
};

// Product
const product: Product = {
  id: 'prod-001',
  name: 'Aspirin 500mg',
  genericName: 'aspirin',
  category: 'pain-relief',
  strength: '500mg',
  form: 'tablet',
  manufacturer: 'Bayer',
  isControlled: false
};

// Inventory entry
const entry: CDRegisterEntry = {
  id: 'entry-001',
  pharmacyId: 'pharm-001',
  productId: 'prod-001',
  quantity: 10,
  unitPrice: 2.50,
  patientName: 'John Doe',
  date: new Date(),
  notes: 'Customer purchase'
};
```

### Using API Types

```typescript
import {
  CreateProductRequest,
  CreateProductResponse,
  ApiError,
  PaginatedResponse
} from '@pharmstation/types';

// Request
const request: CreateProductRequest = {
  name: 'New Product',
  category: 'antibiotics',
  strength: '500mg'
};

// Response
const response: CreateProductResponse = {
  success: true,
  data: {
    id: 'prod-002',
    name: 'New Product',
    // ... other fields
  }
};

// Error response
const error: ApiError = {
  code: 'INVALID_INPUT',
  message: 'Invalid product data',
  details: {
    field: 'strength',
    error: 'Invalid strength format'
  }
};

// Paginated results
const paginated: PaginatedResponse<Product> = {
  data: [],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 100,
    totalPages: 5
  }
};
```

### Using Validation Types

```typescript
import {
  ValidationResult,
  ValidationError,
  ValidationErrorCode
} from '@pharmstation/types';

// Validation result
const result: ValidationResult = {
  isValid: false,
  errors: [
    {
      field: 'name',
      code: ValidationErrorCode.REQUIRED,
      message: 'Product name is required'
    }
  ]
};

// Check results
if (!result.isValid) {
  result.errors.forEach((error) => {
    console.log(`${error.field}: ${error.message}`);
  });
}
```

### Using Database Types

```typescript
import {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate
} from '@pharmstation/types/database';

// Table row
type ProductRow = Tables<'products'>;

// Insert type (no id, timestamps)
type NewProduct = TablesInsert<'products'>;

// Update type (all optional)
type ProductUpdate = TablesUpdate<'products'>;

// Database functions
type Product = Database['public']['Tables']['products']['Row'];
```

### Using Component Types

```typescript
import {
  ButtonProps,
  InputProps,
  FormProps,
  ModalProps
} from '@pharmstation/types/ui';

// Use in components
interface MyButtonProps extends ButtonProps {
  customProp?: string;
}

const MyButton: React.FC<MyButtonProps> = (props) => {
  // component implementation
};
```

## Type Hierarchy

```
types/
├── domain/              # Business entities
│   ├── user.ts
│   ├── pharmacy.ts
│   ├── product.ts
│   ├── inventory.ts
│   └── transaction.ts
├── api/                 # API contracts
│   ├── request.ts
│   ├── response.ts
│   ├── error.ts
│   └── pagination.ts
├── database/            # Database schema
│   ├── schema.ts
│   └── queries.ts
├── ui/                  # UI component types
│   ├── props.ts
│   ├── states.ts
│   └── events.ts
├── utils/              # Utility types
│   ├── async.ts
│   ├── collections.ts
│   └── validation.ts
└── index.ts            # Main export
```

## Core Types Reference

### User Type
```typescript
interface User {
  id: string;
  email: string;
  name: string;
  phoneNumber?: string;
  role: UserRole;
  pharmacy: Pharmacy;
  avatar?: string;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

type UserRole = 'admin' | 'pharmacy_manager' | 'pharmacist' | 'staff';
```

### Product Type
```typescript
interface Product {
  id: string;
  name: string;
  genericName?: string;
  category: ProductCategory;
  strength?: string;
  form?: string;
  manufacturer?: string;
  ndc?: string; // National Drug Code
  isControlled: boolean;
  scheduleName?: string;
  requiresPrescription: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type ProductCategory =
  | 'antibiotics'
  | 'painrelief'
  | 'vitamins'
  | 'supplements'
  | 'other';
```

### Inventory Type
```typescript
interface InventoryItem {
  id: string;
  productId: string;
  pharmacyId: string;
  quantity: number;
  reorderLevel: number;
  reorderQuantity: number;
  unitPrice: number;
  lastUpdated: Date;
  lastStockCheck?: Date;
  batchNumber?: string;
  expiryDate?: Date;
}
```

### Transaction Types
```typescript
interface Transaction {
  id: string;
  type: TransactionType;
  pharmacyId: string;
  items: TransactionItem[];
  total: number;
  createdAt: Date;
  createdBy: string;
  notes?: string;
}

type TransactionType = 'sale' | 'return' | 'transfer' | 'adjustment';

interface TransactionItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  total: number;
}
```

## Enum Types

```typescript
enum UserRole {
  Admin = 'admin',
  PharmacyManager = 'pharmacy_manager',
  Pharmacist = 'pharmacist',
  Staff = 'staff'
}

enum TransactionType {
  Sale = 'sale',
  Return = 'return',
  Transfer = 'transfer',
  Adjustment = 'adjustment'
}

enum ValidationErrorCode {
  Required = 'REQUIRED',
  InvalidFormat = 'INVALID_FORMAT',
  OutOfRange = 'OUT_OF_RANGE',
  Duplicate = 'DUPLICATE',
  InvalidReference = 'INVALID_REFERENCE'
}
```

## Generic Utility Types

```typescript
// Async result types
type AsyncResult<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Pagination
interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Paginated response
interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// API response envelope
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}
```

## Type Guards

```typescript
import { isUser, isProduct, isValidEmail } from '@pharmstation/types';

// Check if value is User
if (isUser(value)) {
  console.log(value.name); // Type is narrowed
}

// Check if value is Product
if (isProduct(value)) {
  console.log(value.name); // Type is narrowed
}

// Validate email format
if (isValidEmail(email)) {
  // Email is valid
}
```

## Database Schema Types

Auto-generated from Supabase schema:

```typescript
import { Database } from '@pharmstation/types/database';

// Access table types
type Users = Database['public']['Tables']['users']['Row'];
type Products = Database['public']['Tables']['products']['Row'];

// Use in functions
async function getUser(id: string): Promise<Users> {
  // Fetch from database
}
```

## Contributing Guidelines

When adding types:
1. Place in appropriate subdirectory
2. Include JSDoc comments
3. Export from index.ts
4. Create type guards if needed
5. Add test cases
6. Document in this README
7. Keep types focused and single-purpose
8. Use strict null/undefined checks

## Best Practices

1. **Type Safety**: Use strict TypeScript settings
2. **Documentation**: JSDoc for public types
3. **Consistency**: Follow naming conventions
4. **Reusability**: Create generic types when possible
5. **Validation**: Provide type guards
6. **Exports**: Export from index.ts
7. **Organization**: Group related types
8. **Testing**: Test type assertions

## Import Examples

```typescript
// Import specific types
import { User, Product, CDRegisterEntry } from '@pharmstation/types';

// Import from subdirectories
import { CreateProductRequest } from '@pharmstation/types/api';
import { ValidationResult } from '@pharmstation/types/validation';
import { ButtonProps } from '@pharmstation/types/ui';

// Import database types
import type { Database, Tables } from '@pharmstation/types/database';

// Import utility types
import type { AsyncResult, PaginatedResponse } from '@pharmstation/types/utils';
```

## Related Documentation

- [Core Package Models](../core/src/models/README.md)
- [Validation Rules](../core/src/validation/README.md)
- [UI Components](../ui/src/components/README.md)

## Version Management

Types follow semantic versioning:
- **Major**: Breaking type changes
- **Minor**: New types added
- **Patch**: Type fixes and improvements

Keep types stable to avoid breaking dependent packages.

## Testing Types

Test type definitions with `tsd`:

```typescript
import { expectType, expectAssignable } from 'tsd';
import type { User } from '@pharmstation/types';

const user: User = {
  id: 'user-001',
  email: 'test@example.com',
  // ...
};

expectType<User>(user);
```

## Maintenance

- Review types regularly for accuracy
- Update when database schema changes
- Keep documentation current
- Deprecate old types properly
- Plan major version updates
