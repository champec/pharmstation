# @pharmstation/ui

Reusable React UI components and design system for PharmStation applications.

## Overview

This package provides a comprehensive collection of reusable React components, hooks, and theme configuration that ensure consistency across all PharmStation applications. It implements the PharmStation design system with accessible, responsive components.

## What Goes Here

This package includes:

- **Reusable Components**: Buttons, forms, modals, tables, and more
- **Hooks**: Custom React hooks for common patterns
- **Theme System**: Brand colors, typography, spacing, and breakpoints
- **Utilities**: Helper functions for styling and component composition
- **Documentation**: Component storybook and usage examples

## Key Features & Responsibilities

### Components (`src/components/`)

#### Form Components
- **Input**: Text, number, email, password fields
- **Select**: Dropdown selections with search
- **Checkbox**: Single and multiple selections
- **Radio**: Mutually exclusive options
- **DatePicker**: Date and date-range selection
- **Form**: Form wrapper with validation
- **FormField**: Reusable field wrapper with label and error

#### Layout Components
- **Container**: Responsive container with max-width
- **Grid**: CSS Grid wrapper with responsive columns
- **Flex**: Flexbox layout utilities
- **Stack**: Vertical and horizontal spacing
- **Sidebar**: Two-column layout with sidebar

#### Data Display
- **Table**: Sortable, filterable tables
- **Card**: Content cards with headers and footers
- **Badge**: Status and category badges
- **Pill**: Inline labels and tags
- **List**: Ordered and unordered lists
- **Timeline**: Chronological event display

#### Feedback Components
- **Alert**: Information, warning, error, success messages
- **Toast**: Temporary notifications
- **Spinner**: Loading indicators
- **Skeleton**: Placeholder loading states
- **Progress**: Progress bars and circular indicators
- **Tooltip**: Hover information

#### Navigation
- **Navbar**: Top navigation bar
- **Breadcrumb**: Navigation path
- **Pagination**: Page navigation
- **Tabs**: Tabbed content
- **Menu**: Dropdown and context menus

#### Dialog & Overlay
- **Modal**: Dialog boxes
- **Drawer**: Slide-out panels
- **Popover**: Positioned content popups
- **Dropdown**: Dropdown menus

#### Pharmacy-Specific
- **InventoryTable**: Product inventory display
- **InvoiceForm**: Invoice processing form
- **PrescriptionViewer**: Prescription display
- **ProductSelector**: Product search and selection
- **StockLevelIndicator**: Visual stock level indicator

### Theme System (`src/themes/`)
- **Colors**: Brand colors, semantic colors, palettes
- **Typography**: Font families, sizes, weights, line heights
- **Spacing**: Consistent spacing scale
- **Breakpoints**: Responsive design breakpoints
- **Shadows**: Elevation shadows
- **Border Radius**: Consistent border radiuses
- **Transitions**: Animation timing functions
- **Z-Index**: Stacking context scale

### Hooks (`src/hooks/`)
- **useForm**: Form state management
- **useTable**: Table sorting, filtering, pagination
- **useModal**: Modal state management
- **useToast**: Toast notification management
- **useAsync**: Async operation handling
- **useLocalStorage**: Browser local storage
- **usePrevious**: Previous value reference
- **useDebounce**: Debounced values

## Usage Examples

### Using Form Components
```typescript
import { Form, FormField, Input, Select, Button } from '@pharmstation/ui';

export function ProductForm() {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    quantity: 0
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
  };

  return (
    <Form onSubmit={handleSubmit}>
      <FormField
        label="Product Name"
        required
        error={formData.name === '' ? 'Required' : ''}
      >
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter product name"
        />
      </FormField>

      <FormField label="Category">
        <Select
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          options={[
            { label: 'Antibiotics', value: 'antibiotics' },
            { label: 'Pain Relief', value: 'painrelief' }
          ]}
        />
      </FormField>

      <Button type="submit" variant="primary">
        Save Product
      </Button>
    </Form>
  );
}
```

### Using Table Component
```typescript
import { Table, Badge } from '@pharmstation/ui';

export function InventoryTable({ products }) {
  return (
    <Table
      data={products}
      columns={[
        { key: 'name', label: 'Product Name', sortable: true },
        { key: 'quantity', label: 'In Stock', sortable: true },
        {
          key: 'status',
          label: 'Status',
          render: (value) => (
            <Badge variant={value === 'low' ? 'warning' : 'success'}>
              {value}
            </Badge>
          )
        }
      ]}
      sortable
      filterable
      selectable
      onRowClick={(row) => console.log('Clicked:', row)}
    />
  );
}
```

### Using Modal Component
```typescript
import { useModal, Modal, Button } from '@pharmstation/ui';

export function ConfirmDialog({ onConfirm }) {
  const { isOpen, open, close } = useModal();

  return (
    <>
      <Button onClick={open}>Delete Product</Button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        title="Confirm Deletion"
        actions={[
          { label: 'Cancel', onClick: close },
          { label: 'Delete', onClick: onConfirm, variant: 'danger' }
        ]}
      >
        <p>Are you sure you want to delete this product?</p>
      </Modal>
    </>
  );
}
```

### Using Toast Notifications
```typescript
import { useToast, Button } from '@pharmstation/ui';

export function NotificationExample() {
  const { success, error, info } = useToast();

  return (
    <div>
      <Button onClick={() => success('Product saved successfully!')}>
        Show Success
      </Button>
      <Button onClick={() => error('Failed to save product')}>
        Show Error
      </Button>
      <Button onClick={() => info('Processing invoice...')}>
        Show Info
      </Button>
    </div>
  );
}
```

### Using Custom Hooks
```typescript
import { useForm, useAsync } from '@pharmstation/ui';

export function ProfileForm() {
  const { values, errors, handleChange, handleSubmit } = useForm(
    {
      name: '',
      email: ''
    },
    async (values) => {
      await saveProfile(values);
    }
  );

  const { data, loading, error } = useAsync(fetchUserProfile, []);

  if (loading) return <Spinner />;
  if (error) return <Alert variant="error">{error.message}</Alert>;

  return (
    <form onSubmit={handleSubmit}>
      <Input
        name="name"
        value={values.name}
        onChange={handleChange}
        error={errors.name}
      />
      <Input
        name="email"
        value={values.email}
        onChange={handleChange}
        error={errors.email}
      />
      <Button type="submit">Save</Button>
    </form>
  );
}
```

### Using Theme
```typescript
import { useTheme, styled } from '@pharmstation/ui';

export function ThemedComponent() {
  const theme = useTheme();

  const StyledBox = styled('div')`
    padding: ${theme.spacing(2)};
    background-color: ${theme.colors.background};
    color: ${theme.colors.text};
    border-radius: ${theme.borderRadius.md};
    font-family: ${theme.typography.fontFamily};
  `;

  return (
    <StyledBox>
      Content with theme styling
    </StyledBox>
  );
}
```

## Component Library

### Complete Component List

**Form Inputs**
- Input, TextArea, Select, Checkbox, Radio, Toggle, DatePicker, TimePicker, DateRangePicker, FileUpload

**Buttons**
- Button, ButtonGroup, IconButton, SplitButton

**Layout**
- Container, Grid, Flex, Stack, Spacer, Divider, Sidebar

**Data Display**
- Table, Card, Badge, Pill, List, Timeline, Progress, Stat

**Feedback**
- Alert, Toast, Spinner, Skeleton, Modal, Drawer

**Navigation**
- Navbar, Breadcrumb, Tabs, Menu, Dropdown, Pagination

**Pharmacy-Specific**
- InventoryTable, StockLevelIndicator, PrescriptionViewer, InvoiceForm, ProductSelector

## Theme Configuration

```typescript
interface Theme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
  };
  
  typography: {
    fontFamily: string;
    fontFamilyMono: string;
    sizes: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
    };
  };
  
  spacing: (scale: number) => string;
  
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  
  breakpoints: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}
```

## Accessibility

All components follow WAI-ARIA guidelines:
- Semantic HTML
- Keyboard navigation
- Screen reader support
- Focus management
- Color contrast compliance
- Label associations

## Responsive Design

Components use mobile-first approach:
- Mobile optimized by default
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Flexible spacing and typography
- Touch-friendly targets

## Tech Stack

- **React**: 18+
- **TypeScript**: For type safety
- **Styled Components** or **Emotion**: CSS-in-JS styling
- **React Hook Form**: Form state management
- **Framer Motion**: Animations (optional)

## Directory Structure

```
packages/ui/
├── README.md
├── package.json
├── src/
│   ├── components/          # React components
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Table/
│   │   ├── Modal/
│   │   └── ...
│   ├── hooks/              # Custom React hooks
│   ├── themes/             # Theme configuration
│   ├── utils/              # Helper utilities
│   ├── types/              # TypeScript types
│   └── index.ts            # Main export
├── stories/                # Storybook stories (optional)
├── dist/                   # Compiled output (generated)
└── tsconfig.json          # TypeScript configuration
```

## Related Documentation

- [Components Documentation](./src/components/README.md)
- [Themes Documentation](./src/themes/README.md)
- [Types Package](../types/README.md)
- [Design System Guide](#)

## Testing

Include comprehensive tests:
- Unit tests for components
- Integration tests for forms
- Visual regression tests
- Accessibility tests

## Contributing Guidelines

When adding components:
1. Follow component patterns
2. Include TypeScript types
3. Write comprehensive documentation
4. Add Storybook stories
5. Include unit tests
6. Ensure accessibility compliance
7. Test on multiple devices
8. Update this README

## Best Practices

1. **Type Safety**: Use TypeScript for all props
2. **Composability**: Build small, composable components
3. **Accessibility**: Ensure WCAG compliance
4. **Performance**: Memoize when appropriate
5. **Documentation**: Include usage examples
6. **Testing**: Comprehensive test coverage
7. **Consistency**: Follow design system
8. **Responsive**: Mobile-first design

## License

Proprietary - PharmStation
