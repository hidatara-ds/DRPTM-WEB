# Setup Project di Visual Studio Code

## Prasyarat
- Node.js versi 18 atau lebih baru
- npm atau yarn
- PostgreSQL (opsional, project saat ini menggunakan in-memory storage)

## Langkah Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
Buat file `.env` di root project dan tambahkan:
```env
# Antares IoT Configuration
ANTARES_API_KEY=your_api_key_here
ANTARES_APPLICATION_ID=your_app_id_here
ANTARES_BASE_URL=https://platform.antares.id:8443
ANTARES_DEVICE_ID=your_device_id_here

# Database (opsional, saat ini menggunakan in-memory storage)
DATABASE_URL=postgresql://username:password@localhost:5432/hydroponic_db

# Development
NODE_ENV=development
```

### 3. Jalankan Development Server
```bash
npm run dev
```

Project akan berjalan di `http://localhost:5000`

## Struktur Project

### Frontend (React + TypeScript)
- **Lokasi**: `client/src/`
- **Framework**: React 18 dengan Vite
- **Routing**: Wouter
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: TanStack Query

### Backend (Node.js + Express)
- **Lokasi**: `server/`
- **Framework**: Express.js
- **Database**: Drizzle ORM (in-memory storage saat ini)
- **API**: RESTful endpoints

### Shared
- **Schema**: `shared/schema.ts` - Type definitions untuk TypeScript

## Commands yang Tersedia

```bash
# Development
npm run dev          # Jalankan frontend + backend

# Build
npm run build        # Build production
npm run preview      # Preview production build

# Database (jika menggunakan PostgreSQL)
npm run db:generate  # Generate database schema
npm run db:migrate   # Run database migrations
npm run db:studio    # Open Drizzle Studio
```

## Extensions VS Code yang Direkomendasikan

1. **TypeScript and JavaScript Language Features** (built-in)
2. **ES7+ React/Redux/React-Native snippets**
3. **Tailwind CSS IntelliSense**
4. **Auto Rename Tag**
5. **Prettier - Code formatter**
6. **Thunder Client** (untuk testing API)

## Debugging

### Frontend
- Buka Developer Tools di browser
- Source maps sudah dikonfigurasi untuk debugging

### Backend
- Tambahkan breakpoints di VS Code
- Gunakan terminal untuk melihat logs server

## API Endpoints

- `GET /api/sensor-readings` - Ambil semua data sensor
- `GET /api/sensor-readings/latest` - Ambil data sensor terbaru
- `POST /api/sensor-readings/sync` - Sync data dari Antares
- `GET /api/system-status` - Status sistem
- `GET /api/alert-settings` - Pengaturan alert

## Troubleshooting

### Port sudah digunakan
Jika port 5000 sudah digunakan, ubah di `server/index.ts`:
```typescript
const port = process.env.PORT || 5001;
```

### Module tidak ditemukan
Pastikan semua dependencies sudah terinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Environment variables tidak terbaca
Pastikan file `.env` ada di root project dan format variabel benar.

## Integrasi dengan Antares IoT

Project ini terintegrasi dengan platform Antares IoT untuk monitoring sensor hidroponik:
- **Temperature**: Suhu dalam Celsius
- **pH Level**: Tingkat keasaman
- **TDS Level**: Total Dissolved Solids dalam ppm

Data akan di-sync otomatis setiap 5 menit, atau bisa manual sync melalui tombol di dashboard.