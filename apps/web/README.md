# PharmStation Web App

**Framework**: Next.js 14+ (App Router)  
**Package Name**: `@pharmstation/web`

## Overview

The main web application for PharmStation. This is the primary user interface for pharmacy compliance management, accessible via web browser on desktop and mobile devices.

## What Goes Here

### Core Features
- User authentication and account management
- Responsive Pharmacist (RP) Log
- Controlled Drug (CD) Register
- Patient Returns Log
- Private CD Register
- SOP Library
- Handover Notes board
- Compliance logs (fridge, cleaning, date checking, etc.)
- Near miss / incident reporting

### Future Features (Phase 2+)
- Genie AI assistant interface
- Natural language search
- AI-powered entry suggestions
- Export and print functionality
- Multi-pharmacy dashboard (Enterprise)

## Tech Stack

- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **UI Library**: React 18+
- **Styling**: Tailwind CSS (PharmStation brand colors)
- **State Management**: React Context / Zustand
- **Forms**: React Hook Form + Zod validation
- **API Client**: `@pharmstation/supabase-client`
- **UI Components**: `@pharmstation/ui`
- **Business Logic**: `@pharmstation/core`
- **Types**: `@pharmstation/types`

## Key Dependencies

```json
{
  "next": "^14.x",
  "react": "^18.x",
  "react-dom": "^18.x",
  "typescript": "^5.x",
  "tailwindcss": "^3.x",
  "@supabase/supabase-js": "^2.x",
  "zustand": "^4.x",
  "react-hook-form": "^7.x",
  "zod": "^3.x"
}
```

## Project Structure

```
apps/web/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication routes
│   │   ├── login/
│   │   ├── signup/
│   │   └── layout.tsx
│   ├── (dashboard)/       # Main app routes (requires auth)
│   │   ├── rp-log/
│   │   ├── cd-register/
│   │   ├── returns/
│   │   ├── sops/
│   │   ├── handover/
│   │   └── layout.tsx
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # Shadcn UI components
│   ├── forms/            # Form components
│   └── layouts/          # Layout components
├── lib/                  # Utilities
│   ├── supabase.ts      # Supabase client setup
│   ├── utils.ts         # Helper functions
│   └── validation.ts    # Zod schemas
├── public/               # Static assets
│   ├── logos/           # PharmStation logos
│   └── images/
├── styles/              # Global styles
│   └── globals.css      # Tailwind imports
├── next.config.js       # Next.js configuration
├── tailwind.config.js   # Tailwind configuration (brand colors)
├── tsconfig.json        # TypeScript configuration
├── package.json         # Dependencies
└── README.md           # This file
```

## Setup Instructions

**Note**: This is a scaffold. Actual setup will be documented once development begins.

### Prerequisites
- Node.js 20+
- pnpm 9+

### Installation (Coming Soon)
```bash
# From monorepo root
pnpm install

# Run dev server
pnpm --filter @pharmstation/web dev
```

### Environment Variables
```env
# .env.local (not committed)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## Development Guidelines

### Routing
- Use Next.js App Router (not Pages Router)
- Group routes with folders: `(auth)`, `(dashboard)`
- Server Components by default, Client Components when needed

### Styling
- Use Tailwind CSS with PharmStation brand colors
- Import colors from `branding/colors.json`
- Responsive design (mobile-first)
- Dark mode support (optional Phase 2)

### State Management
- Server state: React Server Components
- Client state: React Context or Zustand
- Form state: React Hook Form

### Data Fetching
- Use Supabase client from `@pharmstation/supabase-client`
- Server-side rendering where possible
- Optimistic updates for better UX

### Offline Support
- Service Worker for offline capability
- Local storage for critical data
- Sync when online (see `@pharmstation/core` sync module)

## Features to Implement

### Phase 1: MVP
- [ ] Authentication (login, signup, password reset)
- [ ] RP Log (sign in/out, view history, export)
- [ ] CD Register (entry, correction, multiple books, export)
- [ ] Returns Log (record, track, disposal)
- [ ] Private CD Register
- [ ] SOP Library (upload, view, search)
- [ ] Handover Notes (canvas, create, edit, assign)
- [ ] Compliance Logs (fridge, cleaning, date checking, guest, near miss)
- [ ] User settings (profile, pharmacy details)
- [ ] Multi-user permissions (owner, pharmacist, technician, staff)

### Phase 2: Genie AI (Future)
- [ ] Natural language search UI
- [ ] AI entry suggestions UI
- [ ] Task suggestions panel
- [ ] Reconciliation assistant UI

## Performance Targets

- Lighthouse score: 90+ (all categories)
- First Contentful Paint: <1.5s
- Time to Interactive: <3s
- Bundle size: <300KB (initial)

## Accessibility

- WCAG 2.1 Level AA compliance
- Keyboard navigation
- Screen reader support
- High contrast mode
- Minimum 4.5:1 text contrast ratios

## Browser Support

- Chrome/Edge: Last 2 versions
- Firefox: Last 2 versions
- Safari: Last 2 versions
- Mobile: iOS Safari 14+, Android Chrome 90+

## Testing (Future)

- Unit tests: Vitest
- Component tests: React Testing Library
- E2E tests: Playwright
- Integration tests: Supabase local testing

## Deployment (Future)

- Platform: Vercel (recommended) or self-hosted
- Preview deployments for PRs
- Production deployment from main branch

## Links

- [Product Vision](../../documentation/product/PRODUCT_VISION.md)
- [Architecture Overview](../../documentation/technical/architecture-overview.md)
- [Brand Guidelines](../../branding/README.md)
- [Monorepo Structure](../../documentation/technical/monorepo-structure.md)
