# PharmStation Logo Assets

This directory should contain all logo files and variants for the PharmStation brand.

## Required Logo Files

### SVG Files (Vector - Preferred for Web)

All SVG files should be optimized, with clean paths and minimal file size.

#### 1. `logo-light.svg`
- **Description**: Full logo (mortar & pestle + "PharmStation" text) in light colors
- **Usage**: For use on dark backgrounds (e.g., Deep Blue, gradients, dark images)
- **Colors**: Icon in light tones, "Pharm" in light blue, "Station" in cyan
- **Specifications**:
  - Viewbox: Maintain original aspect ratio
  - Format: Optimized SVG
  - Text: Convert to paths for consistency

#### 2. `logo-dark.svg`
- **Description**: Full logo (mortar & pestle + "PharmStation" text) in dark colors
- **Usage**: For use on light backgrounds (e.g., Off-White, Pure White, light images)
- **Colors**: "Pharm" in Deep Blue (#257BB4), "Station" in Electric Cyan (#04B0FF)
- **Specifications**:
  - Viewbox: Maintain original aspect ratio
  - Format: Optimized SVG
  - Text: Convert to paths for consistency

#### 3. `logo-icon-only.svg`
- **Description**: Just the mortar & pestle icon without text
- **Usage**: For favicons, app icons, compact spaces where text isn't needed
- **Specifications**:
  - Square viewbox (1:1 aspect ratio)
  - Format: Optimized SVG
  - Clean, simple paths suitable for small sizes

### PNG Files (Raster - High Resolution)

All PNG files should have transparent backgrounds and be exported at high resolution.

#### 4. `logo-light.png`
- **Description**: Full logo in light colors (raster version of logo-light.svg)
- **Specifications**:
  - Width: 1024px (maintain aspect ratio for height)
  - Format: PNG-24 (24-bit with alpha transparency)
  - Background: Transparent
  - DPI: 72 for web, 300 for print applications

#### 5. `logo-dark.png`
- **Description**: Full logo in dark colors (raster version of logo-dark.svg)
- **Specifications**:
  - Width: 1024px (maintain aspect ratio for height)
  - Format: PNG-24 (24-bit with alpha transparency)
  - Background: Transparent
  - DPI: 72 for web, 300 for print applications

#### 6. `logo-icon-only.png`
- **Description**: Icon only (raster version of logo-icon-only.svg)
- **Specifications**:
  - Dimensions: 512×512px (square)
  - Format: PNG-24 (24-bit with alpha transparency)
  - Background: Transparent
  - DPI: 72 for web, 300 for print applications

### Favicons (Web Browser Icons)

#### 7. `favicon.ico`
- **Description**: Multi-resolution ICO file for browser compatibility
- **Specifications**:
  - Format: ICO
  - Contains: 16×16px, 32×32px, and 48×48px sizes
  - Based on: logo-icon-only design
  - Background: Transparent where supported

#### 8. `favicon-16x16.png`
- **Specifications**: 16×16px, PNG, transparent background

#### 9. `favicon-32x32.png`
- **Specifications**: 32×32px, PNG, transparent background

#### 10. `favicon-192x192.png`
- **Description**: Android Chrome icon
- **Specifications**: 192×192px, PNG, transparent background

#### 11. `favicon-512x512.png`
- **Description**: High-resolution Android Chrome icon
- **Specifications**: 512×512px, PNG, transparent background

### Apple Touch Icon

#### 12. `apple-touch-icon.png`
- **Description**: iOS home screen icon
- **Specifications**:
  - Dimensions: 180×180px
  - Format: PNG
  - Background: Should include background color (iOS adds its own radius)
  - Recommended: Icon on Deep Blue (#257BB4) background

### Social Media

#### 13. `og-image.png`
- **Description**: Open Graph image for social media sharing (Twitter, Facebook, LinkedIn)
- **Specifications**:
  - Dimensions: 1200×630px
  - Format: PNG or JPG
  - Contains: Logo + tagline "Your Digital Pharmacy Workstation"
  - Background: Branded gradient or Off-White
  - Safe zones: Keep important content within center 1200×600px
  - File size: Under 1MB for optimal loading

## File Naming Conventions

- Use lowercase
- Use hyphens (kebab-case) for spaces
- Be descriptive and consistent
- Match the names specified above exactly

## Optimization Guidelines

### SVG Optimization
- Remove unnecessary metadata
- Simplify paths where possible
- Use relative units (viewBox) rather than fixed dimensions
- Remove comments and editor data
- Optimize with tools like SVGO or SVGOMG

### PNG Optimization
- Use PNG-24 for transparency
- Compress with tools like ImageOptim, TinyPNG, or pngquant
- Balance quality and file size
- Ensure crisp edges at specified dimensions

## Usage in Code

### Web/Next.js Example
```jsx
// Light logo on dark background
<Image src="/logos/logo-light.svg" alt="PharmStation - Your Digital Pharmacy Workstation" />

// Dark logo on light background
<Image src="/logos/logo-dark.svg" alt="PharmStation - Your Digital Pharmacy Workstation" />

// Icon only
<Image src="/logos/logo-icon-only.svg" alt="PharmStation" />
```

### HTML Head (Favicons)
```html
<link rel="icon" type="image/x-icon" href="/logos/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/logos/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/logos/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/logos/favicon-192x192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/logos/apple-touch-icon.png">
<meta property="og:image" content="/logos/og-image.png">
```

## To Add Logo Files

1. Export logos from design software (Adobe Illustrator, Figma, Sketch, etc.)
2. Follow the specifications listed above for each file
3. Optimize files before committing
4. Place all files in this `/branding/logos/` directory
5. Test logos at various sizes to ensure clarity
6. Verify transparent backgrounds render correctly on different colored backgrounds

## Quality Checklist

Before committing logo files, verify:

- [ ] All required files are present and named correctly
- [ ] SVG files are optimized and clean
- [ ] PNG files have transparent backgrounds (where specified)
- [ ] Logos are crisp and clear at minimum sizes
- [ ] Colors match the brand guidelines exactly
- [ ] Files are optimized for web use (reasonable file sizes)
- [ ] Favicon displays correctly in browser tabs
- [ ] Apple touch icon works on iOS devices
- [ ] OG image displays correctly when sharing links

## Questions

For questions about logo creation or specifications, refer to the main brand guidelines in `/branding/README.md` or contact the brand owner.
