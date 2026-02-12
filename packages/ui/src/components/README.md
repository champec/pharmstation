# UI Components

Reusable React components for building PharmStation interfaces.

## Overview

This directory contains all reusable UI components used throughout PharmStation. Each component is self-contained, fully typed, accessible, and thoroughly documented.

## What Goes Here

### Basic Components
- **Button**: Primary, secondary, danger, ghost variants
- **Input**: Text, number, email, password, search
- **Select**: Dropdown selections with search
- **Checkbox**: Single and multi-select
- **Radio**: Mutually exclusive selections
- **Toggle**: On/off switches
- **TextArea**: Multi-line text input

### Form Components
- **Form**: Form wrapper with validation
- **FormField**: Field wrapper with label and error
- **FormGroup**: Grouped form fields
- **DatePicker**: Date selection
- **TimePicker**: Time selection
- **FileUpload**: File input with drag-drop

### Layout Components
- **Container**: Responsive container
- **Grid**: CSS Grid layout
- **Flex**: Flexbox layout
- **Stack**: Vertical/horizontal stacking
- **Spacer**: Spacing element
- **Divider**: Visual separator

### Data Display
- **Table**: Sortable, filterable tables
- **Card**: Content cards
- **Badge**: Status badges
- **Pill**: Inline labels
- **List**: Ordered/unordered lists
- **Stat**: Statistics display

### Feedback Components
- **Alert**: Messages and alerts
- **Toast**: Temporary notifications
- **Spinner**: Loading indicator
- **Skeleton**: Loading placeholder
- **Progress**: Progress bar
- **Tooltip**: Hover information

### Navigation
- **Navbar**: Top navigation
- **Breadcrumb**: Navigation path
- **Tabs**: Tabbed content
- **Pagination**: Page navigation
- **Menu**: Dropdown menus

### Dialog & Modals
- **Modal**: Dialog box
- **Drawer**: Slide-out panel
- **Popover**: Popup content

### Pharmacy-Specific
- **InventoryTable**: Inventory display
- **ProductSelector**: Product search
- **StockIndicator**: Stock level visual
- **PrescriptionViewer**: Prescription display
- **InvoiceForm**: Invoice processing

## Component Structure

Each component follows this structure:

```
ComponentName/
├── ComponentName.tsx       # Main component
├── ComponentName.types.ts  # TypeScript types
├── ComponentName.styles.ts # Styled components
├── ComponentName.stories.tsx # Storybook story
└── __tests__/
    └── ComponentName.test.tsx # Unit tests
```

## Usage Patterns

### Basic Button
```typescript
import { Button } from '@pharmstation/ui/components/Button';

export function MyComponent() {
  return (
    <>
      <Button variant="primary">Primary Button</Button>
      <Button variant="secondary">Secondary Button</Button>
      <Button variant="danger">Delete Button</Button>
      <Button disabled>Disabled Button</Button>
    </>
  );
}
```

### Form Field
```typescript
import { FormField, Input } from '@pharmstation/ui/components';

export function ProductForm() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  return (
    <FormField
      label="Product Name"
      required
      error={error}
      helpText="Enter the full product name"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!value) setError('Required');
        }}
      />
    </FormField>
  );
}
```

### Data Table
```typescript
import { Table } from '@pharmstation/ui/components/Table';

const products = [
  { id: 1, name: 'Aspirin', quantity: 100 },
  { id: 2, name: 'Ibuprofen', quantity: 50 }
];

export function ProductTable() {
  return (
    <Table
      data={products}
      columns={[
        { key: 'name', label: 'Name', sortable: true },
        { key: 'quantity', label: 'Quantity', sortable: true }
      ]}
      onRowClick={(row) => console.log(row)}
    />
  );
}
```

### Modal Dialog
```typescript
import { Modal, Button } from '@pharmstation/ui/components';

export function DeleteConfirm({ onConfirm, onCancel }) {
  return (
    <Modal
      title="Confirm Delete"
      isOpen={true}
      onClose={onCancel}
      actions={[
        { label: 'Cancel', onClick: onCancel },
        { label: 'Delete', onClick: onConfirm, variant: 'danger' }
      ]}
    >
      <p>Are you sure you want to delete this item?</p>
    </Modal>
  );
}
```

### Inventory Table (Pharmacy-Specific)
```typescript
import { InventoryTable } from '@pharmstation/ui/components/InventoryTable';

export function InventoryPage() {
  const inventory = await fetchInventory();

  return (
    <InventoryTable
      items={inventory}
      onLowStockAlert={(product) => {
        console.log(`${product.name} is running low`);
      }}
      onExpiringAlert={(product) => {
        console.log(`${product.name} is expiring soon`);
      }}
    />
  );
}
```

## Styling

Components use styled-components or emotion for styling:

```typescript
// Example styled component
import styled from 'styled-components';
import { theme } from '@pharmstation/ui/themes';

const StyledButton = styled.button`
  padding: ${theme.spacing(2)} ${theme.spacing(4)};
  background-color: ${(props) => theme.colors[props.variant]};
  color: white;
  border: none;
  border-radius: ${theme.borderRadius.md};
  font-family: ${theme.typography.fontFamily};
  cursor: pointer;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
```

## Type Definitions

All components are fully typed:

```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({ ... }) => { ... }
```

## Accessibility

All components follow accessibility best practices:

- **Semantic HTML**: Use appropriate HTML elements
- **ARIA**: Proper ARIA labels and roles
- **Keyboard Navigation**: Full keyboard support
- **Focus Management**: Visible focus indicators
- **Color Contrast**: WCAG AA compliance
- **Screen Readers**: Proper announcements

Example accessible button:

```typescript
<button
  aria-label="Delete product"
  aria-pressed={selected}
  role="button"
  onClick={handleClick}
>
  Delete
</button>
```

## Responsive Design

Components use responsive utilities:

```typescript
// Responsive styling example
const ResponsiveGrid = styled(Grid)`
  @media (max-width: ${theme.breakpoints.md}) {
    grid-template-columns: 1fr;
  }
`;
```

## Component Composition

Build complex UIs by composing components:

```typescript
export function InventoryForm() {
  return (
    <Form onSubmit={handleSubmit}>
      <Stack direction="vertical" spacing={4}>
        <FormField label="Product Name">
          <Input name="productName" />
        </FormField>

        <FormField label="Category">
          <Select
            name="category"
            options={categories}
          />
        </FormField>

        <FormField label="Quantity">
          <Input name="quantity" type="number" />
        </FormField>

        <Flex gap={2}>
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary">Cancel</Button>
        </Flex>
      </Stack>
    </Form>
  );
}
```

## Performance Optimization

Components use React best practices:

- **Memoization**: useMemo for expensive calculations
- **Callbacks**: useCallback for stable function references
- **Lazy Loading**: Code splitting for large components
- **Virtualization**: Virtual scrolling for large lists

## Testing

Components include comprehensive tests:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick handler', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByText('Click me'));
    expect(onClick).toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByText('Click me')).toBeDisabled();
  });
});
```

## Storybook Integration

Components have Storybook stories for documentation:

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  component: Button,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Click me',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Click me',
  },
};
```

## Related Documentation

- [Themes Documentation](../themes/README.md)
- [UI Package Overview](../README.md)
- [Types Package](../../types/README.md)

## Contributing Guidelines

When creating components:
1. Follow component structure
2. Include TypeScript types
3. Write Storybook stories
4. Add unit tests
5. Ensure accessibility
6. Document props with JSDoc
7. Test responsiveness
8. Update this README

## Best Practices

1. **Single Responsibility**: One purpose per component
2. **Composition**: Build with smaller components
3. **Props**: Make components configurable
4. **Accessibility**: Always consider a11y
5. **Performance**: Optimize rendering
6. **Testing**: Test behavior, not implementation
7. **Documentation**: Clear usage examples
8. **Consistency**: Follow design system

## Browser Support

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Metrics

- Initial load: < 100kb gzip
- Time to interactive: < 2s
- Lighthouse score: > 90
