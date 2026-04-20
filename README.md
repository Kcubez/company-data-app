# Next.js + Supabase + Prisma Starter Kit

A beautiful, modern, feature-rich authentication and administration starter kit.

## 🚀 Built With

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **Authentication**: Better Auth (Email/Password + Roles)
- **UI Components**: Shadcn UI + Tailwind CSS v4
- **State Management & Data Fetching**: TanStack Query
- **Form Validation**: React Hook Form + Zod

## ✨ Features

- **Full Auth Flow**: Login, Register, Middleware Protection
- **Role-Based Access**: Standard User and Admin roles builtin
- **Admin Dashboard**:
  - View all users
  - Create new users manually
  - Edit user roles & details
  - Ban/Unban users with reasons
  - Delete users permanently
- **Beautiful UI**: Modern dark mode tailored with vibrant accents, responsive sidebars, animated components

## 🛠️ Getting Started

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Setup Environment**: Copy `.env.example` to `.env` and fill in your Supabase DB connection paths.
4. **Initialize DB**: 
   ```bash
   npx prisma generate
   npx prisma db push
   ```
5. **Run Development Server**: `npm run dev`

## 👨‍💻 Initial Admin User Setup

Create your first user normally through `/register`. They will default to a 'user' role. 
To mark them as admin, you can log into your Supabase dashboard and directly alter the `role` column in the `user` table to `admin`. After that, you will have access to the Admin User Management panel to manage everyone else!
