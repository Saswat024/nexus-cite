# Nexus Cite — Web Application (Frontend)

Production-grade research console built with TanStack Start, React 19, and Vite. Connects directly to MongoDB Atlas for state and session storage, and interfaces with the Python RAG Engine for document indexing and grounded generation.

---

## Tech Stack

- **Framework**: TanStack Start (SSR / Server Functions) + TanStack Router
- **UI & State**: React 19, TanStack Query (`@tanstack/react-query`), Lucide Icons
- **Styling**: Tailwind CSS v4, Radix UI primitives, shadcn/ui components
- **Build & Nitro**: Vite + Nitro (configured with `preset: "vercel"`)
- **Database & Auth**: Native MongoDB Atlas driver (`mongodb`), PBKDF2 password hashing, JWT sessions

---

## Features

- **Document Library**: Drag-and-drop document upload (PDF, DOCX) directly into MongoDB GridFS, status indicators, and full batch deletion ("Delete All Documents").
- **Grounded Research Chat**: Interactive chat interface with inline citation badges (`[1]`, `[2]`).
- **Source Inspection Sheet**: Clicking any citation opens a slide-over panel displaying the exact retrieved document chunk, similarity score, page number, and section heading.
- **Session Management**: File-based conversation switching, automatic LLM-powered title generation, and title renaming.
- **Custom Branding**: Branded favicon assets (`favicon.ico`, `favicon.png`, `apple-touch-icon.png`) and in-app logo.

---

## Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create `.env` in this directory:
```env
# MongoDB Atlas Connection
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=nexus_cite

# JWT Secret for Session Authentication
JWT_SECRET=your_secure_jwt_secret_key_here

# Python Backend Service URL
PYTHON_RAG_URL=http://127.0.0.1:8000
```

### 3. Start Development Server
```bash
npm run dev
```
Visit `http://localhost:8080/` in your browser.

### 4. Build for Production
```bash
npm run build
```
Generates `.vercel/output` using Nitro's Vercel preset for serverless deployment.

---

## Vercel Deployment

1. Connect your repository on [vercel.com](https://vercel.com).
2. Configure project settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Other` (or `Vite`)
   - **Build Command**: `npm run build`
   - **Output Directory**: (leave empty / auto-detected `.vercel/output`)
3. Set environment variables:
   - `PYTHON_RAG_URL`: URL of your deployed Python backend (e.g. `https://nexus-cite-backend.onrender.com`)
   - `MONGODB_URI`: MongoDB Atlas connection string
   - `MONGODB_DB_NAME`: `nexus_cite`
   - `JWT_SECRET`: Random 32+ character string
4. Click **Deploy**.
