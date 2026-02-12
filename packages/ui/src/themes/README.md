# Themes

Design system configuration including colors, typography, spacing, and other design tokens.

## Overview

This directory contains the complete design system and theme configuration for PharmStation. It defines all visual constants used across the application, ensuring consistency and making it easy to maintain a unified look and feel.

## What Goes Here

### Color System
- **Brand Colors**: Primary, secondary, accent colors
- **Semantic Colors**: Success, warning, error, info
- **Neutral Colors**: Grays for backgrounds, borders, text
- **Gradients**: Color gradients for special effects
- **States**: Colors for hover, active, disabled states

### Typography
- **Font Families**: Base fonts and fallbacks
- **Font Sizes**: Consistent type scale
- **Font Weights**: Weights for different emphasis
- **Line Heights**: Proper vertical spacing
- **Letter Spacing**: Tracking for readability

### Spacing
- **Scale**: Consistent spacing increments
- **Padding**: Component internal spacing
- **Margin**: Component external spacing
- **Gaps**: Spacing between flex/grid items

### Breakpoints
- **Mobile**: Small screens (< 640px)
- **Tablet**: Medium screens (640px - 1024px)
- **Desktop**: Large screens (> 1024px)
- **4K**: Extra large screens (> 1920px)

### Shadows
- **Elevation Levels**: Consistent shadow depths
- **Hover Effects**: Shadows on interaction
- **Focus States**: Visual focus indicators

### Border Radius
- **Small**: Subtle corner radius
- **Medium**: Default corner radius
- **Large**: Prominent corner radius
- **Full**: Fully rounded elements

### Other Design Tokens
- **Animations**: Transition timings and easing
- **Zindex**: Stacking context scale
- **Opacity**: Transparency levels

## Brand Color Palette

```typescript
colors: {
  // Primary - PharmStation brand color
  primary: {
    50: '#f0f4ff',
    100: '#e6eeff',
    200: '#c7daff',
    300: '#a8c5ff',
    400: '#6fa3ff',
    500: '#3680ff', // Main brand color
    600: '#1e5ae6',
    700: '#173fcc',
    800: '#102a99',
    900: '#0a1a66'
  },

  // Secondary - Complementary color
  secondary: {
    50: '#f0fdf4',
    100: '#dffcec',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e', // Main secondary color
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#134e4a'
  },

  // Semantic colors
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  // Neutral colors
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827'
  },

  // Semantic backgrounds
  background: '#ffffff',
  surface: '#f9fafb',
  border: '#e5e7eb',
  text: '#111827',
  textSecondary: '#6b7280',
  textDisabled: '#9ca3af'
}
```

## Typography Scale

```typescript
typography: {
  fontFamily: {
    base: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'Fira Code', 'Courier New', monospace"
  },

  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem'  // 36px
  },

  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700
  },

  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2
  },

  letterSpacing: {
    tight: '-0.02em',
    normal: '0em',
    wide: '0.02em'
  }
}
```

## Spacing Scale

```typescript
// Base unit: 4px
spacing: {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem'      // 96px
}
```

## Responsive Breakpoints

```typescript
breakpoints: {
  xs: '320px',
  sm: '640px',    // Mobile landscape
  md: '768px',    // Tablet portrait
  lg: '1024px',   // Tablet landscape / Small desktop
  xl: '1280px',   // Desktop
  '2xl': '1536px' // Large desktop
}
```

## Shadow System

```typescript
shadows: {
  // Elevation shadows
  none: 'none',
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  
  // Interactive shadows
  hover: 'inset 0 0 0 9999px rgba(0, 0, 0, 0.05)',
  focus: '0 0 0 3px rgba(54, 128, 255, 0.1)',
  active: 'inset 0 0 0 1px rgba(0, 0, 0, 0.1)'
}
```

## Border Radius

```typescript
borderRadius: {
  none: '0',
  sm: '0.125rem',  // 2px
  base: '0.25rem', // 4px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  full: '9999px'   // Fully rounded
}
```

## Animations & Transitions

```typescript
transitions: {
  // Timing functions
  easing: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
  },

  // Duration
  duration: {
    75: '75ms',
    100: '100ms',
    150: '150ms',
    200: '200ms',
    300: '300ms',
    500: '500ms',
    700: '700ms',
    1000: '1000ms'
  }
}
```

## Usage Examples

### Using the Theme in Components

```typescript
import { useTheme } from '@pharmstation/ui';
import styled from 'styled-components';

const StyledCard = styled.div`
  padding: ${(props) => props.theme.spacing(4)};
  background-color: ${(props) => props.theme.colors.background};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: ${(props) => props.theme.borderRadius.lg};
  box-shadow: ${(props) => props.theme.shadows.md};
`;

export function MyComponent() {
  const theme = useTheme();

  return (
    <StyledCard>
      <h2 style={{ color: theme.colors.primary }}>
        Welcome to PharmStation
      </h2>
    </StyledCard>
  );
}
```

### Responsive Styling

```typescript
const ResponsiveGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: ${(props) => props.theme.spacing(4)};

  @media (min-width: ${(props) => props.theme.breakpoints.md}) {
    grid-template-columns: 1fr 1fr;
  }

  @media (min-width: ${(props) => props.theme.breakpoints.lg}) {
    grid-template-columns: 1fr 1fr 1fr;
  }
`;
```

### Color Usage

```typescript
// Success state
const successColor = theme.colors.success;

// Primary action
const buttonColor = theme.colors.primary;

// Disabled state
const disabledColor = theme.colors.textDisabled;

// Semantic variants
const colors = {
  success: theme.colors.success,
  warning: theme.colors.warning,
  error: theme.colors.error,
  info: theme.colors.info
};
```

## Theme Customization

Themes can be extended or overridden:

```typescript
import { createTheme } from '@pharmstation/ui/themes';

const customTheme = createTheme({
  colors: {
    primary: '#FF6B35', // Custom primary
    secondary: '#004E89' // Custom secondary
  },
  typography: {
    fontFamily: {
      base: "'Roboto', sans-serif"
    }
  }
});

export function App() {
  return (
    <ThemeProvider theme={customTheme}>
      <Component />
    </ThemeProvider>
  );
}
```

## Dark Mode Support

Theme system supports dark mode:

```typescript
const themes = {
  light: createTheme({ /* light colors */ }),
  dark: createTheme({ /* dark colors */ })
};

export function App() {
  const [isDark, setIsDark] = useState(false);
  const theme = isDark ? themes.dark : themes.light;

  return (
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  );
}
```

## Accessibility

Colors meet WCAG AA contrast requirements:
- Text on background: 4.5:1 ratio
- UI components: 3:1 ratio
- Large text: 3:1 ratio

Use semantic colors for meaning:
- Success: Green
- Warning: Amber/Yellow
- Error: Red
- Info: Blue

## Related Documentation

- [UI Components](../components/README.md)
- [UI Package Overview](../README.md)
- [Design System Guide](#)

## Design Tools

Export theme for design tools:
```typescript
// Can be used in Figma, Adobe XD, etc.
const themeTokens = exportThemeTokens(theme);
```

## Best Practices

1. **Use Theme Values**: Always use theme for styling
2. **Maintain Scale**: Use predefined spacing, sizes
3. **Color Semantics**: Use semantic color names
4. **Responsive First**: Mobile-first breakpoints
5. **Contrast**: Ensure accessibility compliance
6. **Consistency**: Keep spacing and sizing consistent
7. **Documentation**: Document custom values
8. **Testing**: Test light and dark modes

## Contributing Guidelines

When updating theme:
1. Maintain backward compatibility
2. Document changes
3. Update all references
4. Test across components
5. Update design system documentation
6. Export updated tokens
7. Notify design team

## Related Files

- Theme provider
- ThemeContext
- useTheme hook
- Theme utilities
