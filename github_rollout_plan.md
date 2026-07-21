# 10-Day GitHub Rollout Plan

To build up a clean project history and showcase an active commit timeline, you can push your files incrementally. This document outlines a logical 10-day roadmap and provides the exact Git staging patterns you need.

> [!CAUTION]
> **Credential Safety First**
> Never upload your `node_modules` or `.env` files (which contain your Gemini API keys and Supabase credentials). The Git repository already contains `.gitignore` rules, but always make sure files like [backend/.env](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/backend/.env) are kept out of your commits.

---

## 🛠️ Step 0: Initial Git Setup
Before starting the timeline, initialize your Git repository locally and link it to your GitHub remote.

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
```

---

## 📅 The 10-Day Rollout Schedule

### **Day 1: Project Skeleton & Ignores**
Add the core project configuration, entry scripts, and Git ignore rules to ensure a clean baseline.
* **Files to stage:**
  - [.gitignore](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/frontend/.gitignore)
  - [package.json](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/package.json)
  - [package-lock.json](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/package-lock.json)
* **Commands:**
  ```bash
  git add .gitignore package.json package-lock.json
  git commit -m "chore: initial project setup and git ignores"
  git push -u origin main
  ```

---

### **Day 2: Root Runner & Tools**
Add the entry-point script that launches the services and the inspect scripts.
* **Files to stage:**
  - [worker.js](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/worker.js)
  - `tools/`
* **Commands:**
  ```bash
  git add worker.js tools/
  git commit -m "feat: add main worker script and debugger tools"
  git push origin main
  ```

---

### **Day 3: Docker Environment**
Commit the container configuration for users who want to run databases locally.
* **Files to stage:**
  - [docker-compose.yml](file:///c:/Users/hp/OneDrive/Desktop/Projects/podseek/docker-compose.yml)
* **Commands:**
  ```bash
  git add docker-compose.yml
  git commit -m "feat: add docker-compose for database/redis environment"
  git push origin main
  ```

---

### **Day 4: Backend Configuration**
Stage the environment loader config files in the backend.
* **Files to stage:**
  - `backend/config/`
* **Commands:**
  ```bash
  git add backend/config/
  git commit -m "feat(backend): add environment loader configuration"
  git push origin main
  ```

---

### **Day 5: Backend Package Configuration**
Upload the backend dependencies list.
* **Files to stage:**
  - `backend/package.json`
  - `backend/package-lock.json`
* **Commands:**
  ```bash
  git add backend/package.json backend/package-lock.json
  git commit -m "chore(backend): add backend dependencies and package logs"
  git push origin main
  ```

---

### **Day 6: Backend Worker Engine**
Upload the actual Express server and transcription indexing logic.
* **Files to stage:**
  - `backend/worker.js`
  - `backend/tmp-process.mjs`
* **Commands:**
  ```bash
  git add backend/worker.js backend/tmp-process.mjs
  git commit -m "feat(backend): implement semantic search backend & transcription processor"
  git push origin main
  ```

---

### **Day 7: Frontend Framework Skeleton**
Upload Next.js configuration and base template configurations.
* **Files to stage:**
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/next.config.ts`
  - `frontend/tsconfig.json`
  - `frontend/postcss.config.mjs`
* **Commands:**
  ```bash
  git add frontend/package.json frontend/package-lock.json frontend/next.config.ts frontend/tsconfig.json frontend/postcss.config.mjs
  git commit -m "chore(frontend): configure Next.js typescript and postcss compiler configurations"
  git push origin main
  ```

---

### **Day 8: Frontend Global Layout & Styling**
Commit styles, global configs, icons, and base Next.js folders.
* **Files to stage:**
  - `frontend/app/globals.css`
  - `frontend/app/layout.tsx`
  - `frontend/app/favicon.ico`
  - `frontend/public/`
* **Commands:**
  ```bash
  git add frontend/app/globals.css frontend/app/layout.tsx frontend/app/favicon.ico frontend/public/
  git commit -m "style(frontend): establish base layout and global styles"
  git push origin main
  ```

---

### **Day 9: Interactive Showcase Component**
Deploy the interactive product demo component.
* **Files to stage:**
  - `frontend/components/ProductDemo.tsx`
* **Commands:**
  ```bash
  git add frontend/components/ProductDemo.tsx
  git commit -m "feat(frontend): implement visual interactive product walkthrough demo"
  git push origin main
  ```

---

### **Day 10: Landing Page & Documentation**
Upload the main watch page and documentation, completing the deployment.
* **Files to stage:**
  - `frontend/app/page.tsx`
  - `frontend/app/watch/`
  - `frontend/README.md`
* **Commands:**
  ```bash
  git add frontend/app/page.tsx frontend/app/watch/ frontend/README.md
  git commit -m "feat(frontend): integrate landing search flow and update documentation"
  git push origin main
  ```
