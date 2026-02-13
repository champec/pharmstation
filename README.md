# PharmStation

**"Your Digital Pharmacy Workstation"**

PharmStation is a comprehensive digital platform for UK pharmacy compliance management, featuring Controlled Drug (CD) registers, Responsible Pharmacist (RP) logs, patient returns tracking, and AI-powered assistance.

---

## 🎨 Brand Colors

| Color | Hex | Preview | Usage |
|-------|-----|---------|-------|
| **Deep Blue** (Primary) | `#257BB4` | ![#257BB4](https://via.placeholder.com/80x20/257BB4/FFFFFF?text=+) | Primary brand color, main CTAs, headers |
| **Mid Blue** | `#378FC2` | ![#378FC2](https://via.placeholder.com/80x20/378FC2/FFFFFF?text=+) | Secondary elements, hover states |
| **Soft Blue** | `#619AB8` | ![#619AB8](https://via.placeholder.com/80x20/619AB8/FFFFFF?text=+) | Tertiary elements, disabled states |
| **Electric Cyan** (Accent) | `#04B0FF` | ![#04B0FF](https://via.placeholder.com/80x20/04B0FF/FFFFFF?text=+) | Highlights, interactive elements |
| **Slate Mist** | `#8FA7B3` | ![#8FA7B3](https://via.placeholder.com/80x20/8FA7B3/FFFFFF?text=+) | Subtle backgrounds, borders |
| **Steel Blue** | `#7DA0B1` | ![#7DA0B1](https://via.placeholder.com/80x20/7DA0B1/FFFFFF?text=+) | Alternative backgrounds |
| **Cloud Blue** | `#9FCADE` | ![#9FCADE](https://via.placeholder.com/80x20/9FCADE/000000?text=+) | Glow effects, highlights |
| **Off-White** | `#E5F2F7` | ![#E5F2F7](https://via.placeholder.com/80x20/E5F2F7/000000?text=+) | Main backgrounds, cards |
| **Pure White** | `#FDFEFF` | ![#FDFEFF](https://via.placeholder.com/80x20/FDFEFF/000000?text=+) | Pure white surfaces, overlays |

See full brand guidelines in [`branding/README.md`](./branding/README.md).

---

## 📂 Monorepo Structure

```
pharmstation/
├── apps/                      # Applications
│   ├── web/                  # Next.js web application (primary UI)
│   ├── desktop/              # Tauri desktop app (offline-first)
│   └── mobile/               # React Native mobile app
│
├── packages/                  # Shared packages
│   ├── core/                 # Business logic, models, validation
│   ├── supabase-client/      # Supabase queries, auth, realtime
│   ├── ai/                   # AI/LLM integration layer
│   ├── ui/                   # Shared UI components (React)
│   └── types/                # TypeScript type definitions
│
├── supabase/                  # Backend (Supabase)
│   ├── migrations/           # Database migrations
│   ├── functions/            # Edge functions (Deno)
│   └── seed.sql             # Development seed data
│
├── tooling/                   # Shared configuration
│   ├── eslint/              # ESLint configs
│   ├── tsconfig/            # TypeScript configs
│   └── prettier/            # Prettier config
│
├── branding/                  # Brand assets & guidelines
│   ├── README.md            # Brand guidelines
│   ├── colors.json          # Machine-readable color palette
│   └── logos/               # Logo files (to be added)
│
└── documentation/             # All documentation
    ├── business/            # Business plan, pricing, GTM strategy
    ├── legal-and-compliance/  # GPhC guidelines, MDR 2001
    ├── pharmacy-knowledge/    # CD registers, RP role, SOPs
    ├── technical/           # Architecture, AI, offline sync
    ├── product/             # Product vision, roadmap, personas
    └── reference/           # Glossary, links, contacts
```

---

## 🚀 Tech Stack

### Core Technologies
- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage)
- **CI/CD**: GitHub Actions

### Applications
- **Web**: Next.js 14+ (App Router), React 18, Tailwind CSS
- **Desktop**: Tauri 2.x (Rust + Web), SQLite
- **Mobile**: React Native 0.73+

### Key Libraries
- **State**: Zustand / React Context
- **Forms**: React Hook Form + Zod
- **UI**: Shadcn UI (web), React Native Paper (mobile)
- **AI**: OpenAI / Anthropic Claude (Genie assistant)
- **Testing**: Vitest, React Testing Library, Playwright

---

## 📖 Documentation

Comprehensive documentation is available in the [`documentation/`](./documentation/) directory:

- **[Product Vision](./documentation/product/PRODUCT_VISION.md)** ⭐ Start here
- [Business Documentation](./documentation/business/) - Business plan, pricing, go-to-market
- [Legal & Compliance](./documentation/legal-and-compliance/) - GPhC guidelines, MDR 2001
- [Pharmacy Knowledge](./documentation/pharmacy-knowledge/) - CD registers, RP role, SOPs
- [Technical Documentation](./documentation/technical/) - Architecture, AI, sync strategy
- [Reference](./documentation/reference/) - Glossary, useful links

---

## 🎯 Core Features

### Phase 1: MVP (Launch)
✅ **Registers** (The Main Sell)
- Responsible Pharmacist (RP) Record
- Controlled Drug (CD) Register
- Patient Returns Log (including disposal)
- Private CD Register

✅ **Supporting Features**
- SOP Library (lightweight)
- Handover Notes (digital sticky-note board)
- Compliance Logs (fridge, cleaning, date checking, guest, near miss)

### Phase 2: Genie AI Assistant
🤖 **AI-Powered Features**
- Natural language search across all records
- Invoice/prescription scanning → draft entries (human-approved)
- Proactive task suggestions and compliance alerts
- Reconciliation assistant
- Regulatory Q&A

### Phase 3: Multi-Platform
📱 **Mobile App** (React Native)
- Quick RP sign-in/out
- Photo-based entry
- Fridge logging on the go
- Push notifications

💻 **Desktop App** (Tauri)
- Full feature parity with web
- Offline-first architecture
- Barcode scanner integration
- Print optimization

### Phase 4: Service Delivery Platform
🏥 **Future Vision**
- Remote consultations (video calling)
- Service delivery workflows (vaccinations, minor ailments, etc.)
- Patient booking management
- Custom service builder
- Communication hub

---

## 🏁 Getting Started

**Note**: This repository is currently a scaffold. Development instructions will be added once implementation begins.

### Prerequisites
- Node.js 20+
- pnpm 9+
- For desktop: Rust 1.70+
- For mobile: Xcode (iOS) / Android Studio (Android)

### Installation (Coming Soon)
```bash
# Clone the repository
git clone https://github.com/champec/pharmstation.git
cd pharmstation

# Install dependencies
pnpm install

# Start development
pnpm dev
```

---

## 🤝 Contributing

Contribution guidelines will be added soon.

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 🔗 Links

- **Brand Guidelines**: [branding/README.md](./branding/README.md)
- **Product Vision**: [documentation/product/PRODUCT_VISION.md](./documentation/product/PRODUCT_VISION.md)
- **Documentation Index**: [documentation/README.md](./documentation/README.md)
- **Architecture Overview**: [documentation/technical/architecture-overview.md](./documentation/technical/architecture-overview.md)

---

## 📞 Support

For questions or support, please contact [support email to be added].

---

**PharmStation** - Transforming pharmacy compliance from burden to streamlined efficiency.

*Version 0.1.0 | Last Updated: February 2026*