-- EXECUTAR ESTO EN EL 'SQL EDITOR' DE SUPABASE

-- Extension para UUIDs (opcional pero recomendado)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de Usuarios
-- Comandos para actualizar tablas existentes si ya tenías la base de datos de antes:
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- O puedes ejecutar todo el script de nuevo para crear las tablas desde cero:
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Events Table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    time TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: RLS is disabled to allow manual userId management via the app's backend.
-- In a production environment with Supabase Auth, you would use auth.uid() instead.
ALTER TABLE events DISABLE ROW LEVEL SECURITY;

-- Tabla de Media (Fotos/Videos)
CREATE TABLE IF NOT EXISTS media (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  url TEXT NOT NULL,
  author TEXT DEFAULT 'Invitado',
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Desactivar RLS para pruebas rápidas (Opcional, pero recomendado para prototipos)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE media DISABLE ROW LEVEL SECURITY;
