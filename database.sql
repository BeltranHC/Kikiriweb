-- 1. Create the students table
CREATE TABLE public.students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    dni TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create the tickets table
CREATE TABLE public.tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_number INTEGER NOT NULL UNIQUE,
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    is_picked_up BOOLEAN DEFAULT false NOT NULL,
    picked_up_at TIMESTAMP WITH TIME ZONE,
    picked_up_by UUID, 
    is_extra BOOLEAN DEFAULT false NOT NULL,
    is_paid BOOLEAN DEFAULT false NOT NULL,
    payment_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================
-- 🚨 MIGRACIÓN: Ejecutar esto en Supabase SQL Editor
-- ALTER TABLE public.tickets ADD COLUMN is_paid BOOLEAN DEFAULT false NOT NULL;
-- ALTER TABLE public.tickets ADD COLUMN payment_method TEXT;
-- ==============================================

-- 3. Disable Row Level Security (RLS) for testing and development
-- (In production, you should enable this and configure policies)
ALTER TABLE public.students DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
