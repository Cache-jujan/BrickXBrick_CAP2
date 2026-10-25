# Brick x Brick

**Construction Management Information System with Blockchain-Secured Financial Controls**

> A hybrid web and mobile platform for micro-SME construction contractors in the Philippines — combining project management, OCR-powered expense tracking, BIR-compliant receipt validation, multi-layer fraud screening, and a private blockchain audit trail, all designed to work offline on remote construction sites.

**Developed by:** FourLoop() — Carl Rey Tibon · Chelsie Faith Maranga · Judd Jala · Jan Louise Baroro  
**Institution:** Cebu Technological University – Main Campus  
**Pilot Partner:** JJC-R Blueprints and Drafting Services, Consolacion, Northern Cebu

---

## What Problem Does It Solve?

Micro-construction firms (2–20 workers, 2–5 concurrent projects) in the Philippines rely on **paper receipts, Messenger group chats, and spreadsheets** to manage finances and projects. This causes:

- **Lost receipts** — physical documents damaged, altered, or misplaced during audits
- **Duplicate expense submissions** — no automated validation to catch duplicate receipts
- **No budget tracking** — the General Manager can't tell if a project is over budget in real time
- **Untracked work directives** — Site Managers receive instructions via Messenger with no accountability trail
- **No financial audit trail** — contractors can't prove financial integrity to clients or the BIR
- **Field communication failures** — internet outages at remote construction sites stop all work tracking

**Brick x Brick solves all six problems** in one integrated system.

---

## Core Features

### 1. **Role-Based Access Control** (F1)
- **General Manager** — oversees budgets, financial reports, approves blockchain verification
- **Project Manager** — manages milestones, tickets, reviews flagged expenses
- **Site Managers** — submit task progress, photo evidence, work updates in the field
- **Purchaser** — submits receipts via OCR, allocates costs across projects, receives material requests

### 2. **Project Initialization & Milestone Management** (F2, F3)
- Create projects with budget targets and timelines
- Define milestones and tasks assigned to Site Managers
- Auto-calculate completion percentages and trigger schedule variance alerts

### 3. **Structured Project Tickets** (F4)
Replaces Messenger with **two ticket types**:
- **Material Request tickets** → routed to Purchaser for procurement
- **Work Item tickets** → routed to Site Managers for task execution
- Full audit trail on every ticket status change

### 4. **OCR-Powered Expense Submission** (F6)
- Purchaser captures receipt via camera, gallery, or PDF upload
- Google Gemini automatically extracts fields (vendor, amount, date)
- Manual confirmation before submission prevents extraction errors

### 5. **BIR Compliance Validation** (F7)
Automatically verifies three required fields:
- Tax Identification Number (TIN)
- BIR Permit Number
- Official Receipt or Sales Invoice Number (OR/SI)

Classifies receipts as:
- **Formal-Tax-Deductible** — compliant with BIR audit standards
- **Informal** — missing required fields

### 6. **Split Receipt Allocation** (F8)
- Single bulk receipt split across multiple active projects
- Enforced mathematical reconciliation (no unallocated funds)
- Tracks which cost belongs to which project

### 7. **Multi-Layer Fraud Screening** (F9)
Three sequential automated checks before approval:
1. **BIR Receipt Duplicate Check** — same receipt submitted twice?
2. **Vendor List Validation** — vendor on approved list?
3. **Ticket-Receipt Mismatch Detection** — does amount match the material request?

### 8. **Offline-First Mobile Operation** (F10)
- Site Managers and Purchaser can submit task updates and expenses **without internet**
- SQLite-backed local queue stores up to **100 entries or 72 continuous hours**
- Automatic sync when connection restored
- Ideal for Northern Cebu construction sites with unreliable connectivity

### 9. **Financial Analytics & Reporting** (F11)
- Budget-vs-actual comparison charts
- Cost variance analysis per project
- BIR tax-deductible expense summary (only Formal-classified receipts)
- Downloadable PDF financial reports
- Real-time dashboard for General Manager

### 10. **Blockchain Audit Trail** (F12)
- Every approved expense generates a **SHA-256 cryptographic hash**
- Hash submitted to **private three-node Geth Proof-of-Authority blockchain**
- General Manager can **verify** expense against on-chain record to prove tamper-proof integrity
- Three validator nodes hosted on separate AWS EC2 instances for decentralization

### 11. **Task Progress Updates with Photo Evidence** (F5)
- Site Managers submit: completion percentage, photo evidence (JPEG/PNG, max 10 MB), issue reports
- Offline queue-enabled for field work without connectivity

### 12. **User Management & Role-Based Access Control** (F1)
- Admin-managed account provisioning
- Role assignment and session management
- System Administrator role (handled by FourLoop team during pilot)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                            │
├─────────────────────────┬─────────────────────────────────┤
│   Web Dashboard         │   Mobile Application (Android)  │
│   React.js              │   React Native                  │
│   localhost:5173        │   API 8.0+                      │
│   (GM, PM roles)        │   (SM, Purchaser roles)         │
└──────────────┬──────────┴──────────────┬───────────────────┘
               │ HTTP/REST + JWT         │
               └──────────────┬──────────┘
                              │
              ┌───────────────▼────────────────┐
              │    API LAYER                   │
              │  Node.js + Express.js          │
              │  localhost:3000                │
              │                                │
              │  ┌──────────────────────────┐  │
              │  │ Modules:                 │  │
              │  │ • Auth                   │  │
              │  │ • Projects               │  │
              │  │ • Tickets                │  │
              │  │ • Expenses               │  │
              │  │ • Tasks                  │  │
              │  │ • OCR Processing         │  │
              │  │ • BIR Validation         │  │
              │  │ • Blockchain Bridge      │  │
              │  └──────────────────────────┘  │
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴───────────────────────────┐
              │                                           │
    ┌─────────▼────────┐                    ┌────────────▼──────┐
    │  PostgreSQL DB   │                    │  Geth Blockchain  │
    │  (Neon)          │                    │  3-node PoA       │
    │                  │                    │  Network          │
    │  Users           │                    │                   │
    │  Projects        │                    │  Expense Hashes   │
    │  Expenses        │                    │  Audit Trail      │
    │  Tasks           │                    └───────────────────┘
    │  Audit Logs      │
    └──────────────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend Runtime** | Node.js 20 LTS |
| **Backend Framework** | Express.js |
| **Web Frontend** | React.js + Vite |
| **Mobile Frontend** | React Native (Android, API 8.0+) |
| **Database** | PostgreSQL (Neon — serverless) |
| **ORM** | Prisma |
| **Authentication** | JWT tokens + bcrypt password hashing |
| **File Upload** | Multer (local storage) |
| **OCR** | Google Gemini API |
| **Blockchain** | Geth (Proof-of-Authority, 3 validators) |
| **Containerization** | Docker + Docker Compose |
| **Cloud Hosting** | AWS EC2 t2 instances (VPS) |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 20 LTS
- PostgreSQL 16
- Git
- Docker (optional, for blockchain nodes)

### Installation (5 minutes)

```bash
# 1. Clone repo
git clone https://github.com/YOUR_ORG/brick-x-brick.git
cd brick-x-brick

# 2. Set up database
psql -U postgres -c "CREATE DATABASE brickxbrick;"

# 3. Install dependencies
npm run setup

# 4. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your database password

# 5. Run migrations
cd backend
npx prisma migrate dev --name init
npx prisma db seed  # optional: populate test data
```

### Run Locally

Open three terminals:

```bash
# Terminal 1: Backend API
cd backend && npm run dev
# Runs on http://localhost:3000

# Terminal 2: Web Dashboard
cd web && npm run dev
# Runs on http://localhost:5173

# Terminal 3: Mobile App
cd mobile && npx expo start
# Scan QR with Expo Go on phone
```

---

## API Reference

**Base URL:** `http://localhost:3000`

**Authentication:** Include `Authorization: Bearer <token>` header on all protected routes.

### Auth
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/auth/register` | `{ name, email, password, role }` |
| POST | `/api/auth/login` | `{ email, password }` |

### Projects
| Method | Endpoint | Role |
|--------|----------|------|
| GET | `/api/projects` | All |
| POST | `/api/projects` | General Manager |
| GET | `/api/projects/:id` | Members only |
| PATCH | `/api/projects/:id` | General Manager |

### Project Tickets
| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/material-requests` | Project Manager |
| GET | `/api/material-requests?projectId=` | Project members |
| PATCH | `/api/material-requests/:id/status` | Purchaser |
| POST | `/api/work-items` | Project Manager |
| GET | `/api/work-items?projectId=` | Project members |

### Expenses (with OCR & BIR Validation)
| Method | Endpoint | Content-Type | Role |
|--------|----------|--------------|------|
| POST | `/api/expenses` | multipart/form-data | Purchaser |
| GET | `/api/expenses?projectId=` | application/json | Project members |
| POST | `/api/expenses/:id/split-allocate` | application/json | Purchaser |
| PATCH | `/api/expenses/:id/verify-blockchain` | application/json | General Manager |

### Blockchain Audit
| Method | Endpoint | Role |
|--------|----------|------|
| GET | `/api/blockchain/verify/:expenseId` | General Manager |
| GET | `/api/audit-logs` | General Manager |

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── tickets/
│   │   ├── expenses/
│   │   ├── tasks/
│   │   └── blockchain/
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── upload.js
│   │   ├── ocr.js
│   │   ├── birValidator.js
│   │   └── auditLog.js
│   ├── config/
│   │   ├── db.js
│   │   └── blockchain.js
│   └── app.js
├── .env
└── server.js

web/
├── src/
│   ├── pages/
│   │   ├── ProjectsPage.jsx
│   │   ├── ExpensesPage.jsx
│   │   ├── FinancialReportsPage.jsx
│   │   └── AuditLogPage.jsx
│   └── components/

mobile/
├── app/
│   ├── (auth)/
│   │   └── login.jsx
│   ├── (app)/
│   │   ├── tasks.jsx
│   │   ├── expenses.jsx
│   │   └── offline-queue.jsx
│   └── _layout.jsx
└── services/
    └── api.js
```

---

## Deployment

### Cloud Setup
1. Create PostgreSQL on Neon, Supabase, or RDS
2. Deploy backend to AWS, Railway, or Render
3. Deploy web to Vercel
4. Set up 3-node Geth blockchain on separate AWS EC2 instances
5. Update API URLs in mobile app

**No code changes needed** — only `.env` variables and database URLs change.

---

## Evaluation & Research

This system was developed and evaluated using:
- **Design-Science Research** methodology
- **ISO/IEC 25010** quality dimensions (Functional Suitability, Usability, Reliability, Performance Efficiency, Security)
- **One-group pretest-posttest** evaluation with pilot partner JJC-R Blueprints and Drafting Services
- **Wilcoxon Signed-Rank test** for statistical significance at p < 0.05

See CHAPTER_I.md for full capstone documentation.

---

## Troubleshooting

**Backend won't start**
```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1;"
# Or change PORT=3001 in .env
```

**OCR not working**
```bash
# Verify Google Gemini API credentials in .env
# GOOGLE_GEMINI_API_KEY=your-key-here
```

**Mobile can't reach backend**
```bash
# Update IP in mobile/services/api.js
baseURL: 'http://YOUR_MACHINE_IP:3000'
# Phone and laptop must be on same Wi-Fi
```

**Offline queue not syncing**
```bash
# Clear local SQLite cache and reconnect
# Or restart Expo app after regaining connection
```

---

## License

Capstone project for Cebu Technological University – Main Campus. All rights reserved by FourLoop().

---

*Built with PostgreSQL · Prisma · Express · React · React Native · Geth Blockchain*  
*FourLoop() — CTU-Main BSIS Capstone 2024–2025*
