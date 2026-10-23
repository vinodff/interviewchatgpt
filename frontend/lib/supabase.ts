import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vcpvpzxytleafevindjb.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjcHZwenh5dGxlYWZldmluZGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MzM0ODIsImV4cCI6MjEwODMwOTQ4Mn0.jchA-KBIWj6bPMiVEVNp9M4qkE2Lg_TF76Toe7Q6TFE";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
