-- ============================================================
-- We Glue – Add year to profiles
-- Migration: 009_add_year_to_profiles.sql
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS year TEXT;
